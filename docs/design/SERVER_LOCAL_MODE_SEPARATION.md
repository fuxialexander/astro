# Server/Local Mode Separation — Detailed Design

> **Status (2026-02-22):** Core goals **ACHIEVED**. The server is a thin web host — all AI execution routes through the relay to agent runners. Provider code deleted from server (~3500 lines). Relay protocol extended with `messages`, `systemPrompt`, `model`, `type` fields. The procedure pipeline (§3) was intentionally dropped rather than moved — the agent runner uses its own task execution approach without subroutine pipelines.

## 1. Guiding Principles

1. **The agent contains all AI logic.** The agent runner (packages/agent-runner/) holds providers, tools, prompt construction, execution strategies, worktree management, PR creation, and task steering. It is the only process that calls Claude.

2. **The server is a web host.** It receives HTTP requests from the browser, persists data, emits SSE events, and dispatches work. It never calls AI directly.

3. **The relay handles networking.** In server mode (Fly.io), the relay bridges the internet between the server and remote agent runners via authenticated WebSocket. In local mode, the relay still exists but is a localhost pass-through — the overhead is negligible, and having one code path simplifies everything.

4. **Don't delete working logic — move it.** If a feature exists only in the server's local path today (like the procedure pipeline), the right approach is to move it to the agent runner, not delete it.

---

## 2. Current Architecture: Where AI Gets Called

### 2.1 Call Sites on the Server

| # | Location | What it does | Has relay path? |
|---|----------|-------------|-----------------|
| 1 | `agent.ts:132-351` `/generate-plan` | Plan generation | Yes (generatePlanViaRelay, line 361) |
| 2 | `agent.ts:410-499` `/chat` | Plan-level chat | **No** |
| 3 | `agent.ts:505-616` `/task-chat` | Task-level chat | **No** |
| 4 | `agent.ts:645-874` `/dispatch` | Task execution with tools | **No** |
| 5 | `agent.ts:880-937` `/summarize` | Summarize results | **No** |
| 6 | `dispatch.ts:308-792` `dispatchLocal()` | Full task execution with worktree, procedures, PR | Yes (dispatchViaRelay, line 800) |
| 7 | `procedure-classifier.ts:25-87` `classifyTask()` | Task type classification | **No** (direct Anthropic SDK) |

### 2.2 The Fork Pattern

Endpoints that have both paths use this decision:

```
/generate-plan:  useRelay = !!targetMachineId && !isLocalDir    (agent.ts:115)
/dispatch/task:  useRelay = environment !== 'local' || targetMachineId  (dispatch.ts:210)
```

Endpoints 2-5 and 7 are **local-only** — they have no relay path at all.

### 2.3 What the Agent Runner Already Does

The agent runner (`packages/agent-runner/src/lib/task-executor.ts`) is a complete execution engine:

| Feature | Agent runner | Server local path | Notes |
|---------|-------------|-------------------|-------|
| Provider selection | Yes (claude-code, claude-sdk, codex, slurm) | Yes | Same |
| Worktree creation | Yes (`createWorktree()`, line 607) | Yes (`createServerWorktree()`) | Duplicate |
| PR creation | Yes (`pushAndCreatePR()`, line 523) | Yes (`pushAndCreatePR()`) | Duplicate |
| Safety checks | Yes (tier system, line 105) | No | Agent runner is better |
| Sandboxing | Yes (copy-on-write, line 409) | No | Agent runner is better |
| Git URL cloning | Yes (`resolveWorkingDirectory()`, line 674) | Yes (`resolveWorkingDirectory()`) | Duplicate |
| Steering | Yes (`steerTask()` → `adapter.injectMessage()`, line 239) | Yes (`steerLocalTask()`) | Duplicate |
| Task queuing | Yes (max concurrent, line 135) | No | Agent runner is better |
| Procedure pipeline | **No** | Yes (dispatch.ts:591-677) | **Gap — must be moved** |
| Task classification | **No** | Yes (procedure-classifier.ts) | **Gap — must be moved** |
| Chat (plan/task) | **No** | Yes (agent.ts chat endpoints) | **Gap — must be added** |
| Summarize | **No** | Yes (agent.ts:880-937) | **Gap — must be added** |

---

## 3. The Procedure Pipeline — What It Is and Where It Goes

### 3.1 What It Is

The procedure pipeline is a **multi-step workflow system** for task execution. Instead of running a single Claude session to "implement feature X", it breaks the work into discrete subroutines:

**`full-development` procedure:**
```
1. implement — Write code (with validation loop: run `npm run build`, retry up to 3x on failure)
2. verify — Read-only code review (check correctness, no changes)
3. git-commit — Stage and commit with conventional commit message
4. gh-pr — Create a GitHub pull request
5. summary — Generate structured JSON summary of work done
```

**`bug-fix` procedure:**
```
1. implement — Debug and fix (with validation loop)
2. git-commit — Commit the fix
3. summary — Generate fix summary
```

**`research` procedure:**
```
1. gather — Explore codebase, read files, take notes
2. summary — Write research report
```

Each subroutine can have:
- `singleTurn: true` — one LLM call, no tools
- `usesValidationLoop: true` — run a command (e.g., `npm run build`), retry on failure
- `disallowAllTools: true` — text-only output
- `requiresApproval: true` — ask user before proceeding
- Session threading — `sessionId` carries context across subroutines

### 3.2 Where It Lives Today

- **Definitions:** `server/lib/dispatch/procedure-types.ts` (329 lines) — `BUILT_IN_PROCEDURES`, `ProcedureState`, `SubroutineDefinition`
- **Executor utilities:** `server/lib/dispatch/procedure-executor.ts` (217 lines) — `interpolatePrompt()`, `runValidationCommand()`, `isValidationPassed()`, `buildFixerPrompt()`
- **Classifier:** `server/lib/dispatch/procedure-classifier.ts` (87 lines) — direct Anthropic API call to classify tasks
- **Orchestration:** `server/routes/dispatch.ts:591-677` — the loop that runs subroutines in sequence

### 3.3 Where It Should Go

**Move to the agent runner.** The procedure pipeline is execution logic — it decides what prompts to send, runs validation commands, and controls the flow of multi-step work. This belongs in the agent, not the server.

**Migration plan:**
1. Copy `procedure-types.ts` and `procedure-executor.ts` into `packages/agent-runner/src/lib/`
2. Add a `ProcedureRunner` class to the agent runner that orchestrates subroutines
3. When the agent runner receives a task with `procedure: 'full-development'`, it runs the pipeline locally
4. The server's `classifyTask()` call moves to the agent runner (or the task dispatch includes a `procedure` hint from the server)
5. Keep the server-side files as reference until the migration is verified

**Note:** The procedure files in `server/lib/dispatch/` don't call AI directly — they're pure orchestration logic and utility functions. The only direct AI call is in `procedure-classifier.ts`. The orchestration in `dispatch.ts:591-677` calls `provider.stream()` for each subroutine, which is the part that moves to the agent runner.

---

## 4. Observability — How Turn Tracking Works

### 4.1 Current Architecture

The observability system uses an internal event bus (`executionEventBus`) that both local and relay execution paths emit to:

```
Local path (dispatch.ts:507-556):      executionEventBus.emit('task:stdout', ...)
Relay path (dispatch-engine.ts:467-513): executionEventBus.emit('task:stdout', ...)
                                                ↓
Observation Collector (observation-collector.ts:160-164) listens on executionEventBus
                                                ↓
Turn-based generation tracking (Trace → Generation → Tool observations)
                                                ↓
Langfuse exporter (langfuse-exporter.ts) batch exports to Langfuse
```

### 4.2 Turn Model

Each LLM interaction is tracked as discrete "turns":
```
Turn 0: [context] → assistant text + tool_calls
Turn 1: [tool_results] → assistant text + tool_calls
Turn N: [tool_results] → final assistant text
```

Each turn becomes a **generation observation** (matching Langfuse's model):
- `input`: `{ turnIndex, toolResults }` from previous turn
- `output`: `{ text, toolCalls }` for this turn
- Tool observations are children of their parent generation via `parentObservationId`

### 4.3 Impact of This Refactoring

**No observability loss.** Both execution paths already emit to `executionEventBus`. After the refactoring:
- The relay path (`dispatch-engine.ts`) continues to emit events as relay messages arrive
- The observation collector continues to listen on `executionEventBus`
- Turn tracking, tool correlation, and Langfuse export work unchanged

**For chat endpoints** (newly routed through relay): The relay will emit `task:text` and `task:result` events to `executionEventBus`, which the observation collector will pick up. Chat sessions will get proper trace tracking that they currently lack.

### 4.4 Multi-Turn Chat History

The relay protocol's `TaskDispatch` currently lacks a `messages` field. For chat endpoints, conversation history must be conveyed somehow.

**Option A: Flatten into prompt** — Server serializes `[{role, content}, ...]` into the `prompt` string. Simple but loses structured message boundaries.

**Option B: Add `messages` to relay TaskDispatch** — Extend the relay protocol to carry structured message arrays. The agent runner deserializes them and passes to the provider. Preserves message-level granularity for observability.

**Recommendation: Option B.** This keeps the data structured end-to-end, which matters for:
- Observability (each message is a distinct turn in Langfuse)
- Agent runner can use native provider multi-turn APIs
- No information loss in the protocol

---

## 5. Communication Between Server and Agent

### 5.1 Local Mode

```
Browser ──HTTP/SSE──→ Hono (3001) ──internal dispatch──→ Relay (3002) ←──WebSocket──→ Agent Runner
                                                                         (localhost)
```

The relay runs on `ws://localhost:3002`. No TLS, no authentication needed. The relay is effectively a local IPC bridge using WebSocket protocol — it's not solving a networking problem, it's providing a **uniform dispatch interface** so the server code doesn't need separate local/remote paths.

**Alternative considered:** Direct function calls (no relay for local mode). This would mean the server imports and calls the agent runner's execution engine directly. Rejected because:
- It re-couples the server to AI dependencies (Claude SDK, etc.)
- The server process would need the user's API credentials
- Two code paths to maintain (direct + relay)

### 5.2 Server Mode

```
Browser ──HTTPS──→ Fly.io (Hono + Relay) ←──WSS──→ User's Machine (Agent Runner)
                                                     (over internet)
```

The relay handles TLS, JWT authentication, heartbeat monitoring, and reconnection. This is the real networking problem it solves.

### 5.3 What Flows Over the Relay

**Server → Agent Runner:**
- `task.dispatch` — Execute a task (plan gen, chat, task execution, summarize)
- `task.cancel` — Cancel a running task
- `task.steer` — Inject a message into a running session
- `task.approval_response` — Respond to an approval request

**Agent Runner → Server (via relay events):**
- `task.result` — Task completed (with status, output, metrics, PR info)
- `task.stdout` — Stdout output chunk
- `task.text` — Text output (from provider stream)
- `task.session_init` — Session initialized (sessionId, model)
- `task.tool_use` — Tool invocation
- `task.tool_result` — Tool completion
- `task.file_change` — File modified/created/deleted
- `task.progress` — Progress update
- `task.approval_request` — Agent needs user decision

---

## 6. Relay Protocol Changes Needed

### 6.1 Add `messages` to TaskDispatch

```typescript
// server/types/relay.ts — TaskDispatch
interface TaskDispatch {
  // ... existing fields ...

  /** Structured message history for multi-turn conversations */
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>

  /** System prompt (separate from user prompt) */
  systemPrompt?: string

  /** Model hint (agent runner may override based on provider) */
  model?: string
}
```

### 6.2 Add task types

Currently the relay TaskDispatch doesn't distinguish between plan generation, chat, and task execution. Adding a `type` field lets the agent runner handle each appropriately:

```typescript
type TaskType = 'planning' | 'chat' | 'task-chat' | 'execution' | 'summarize'
```

---

## 7. Files to Change

### Phase 1: Move logic to agent runner (no server changes yet)

| File | Action | What |
|------|--------|------|
| `packages/agent-runner/src/lib/procedures/` | **Create** | Copy procedure-types.ts, procedure-executor.ts |
| `packages/agent-runner/src/lib/procedures/procedure-runner.ts` | **Create** | Orchestration logic from dispatch.ts:591-677 |
| `server/types/relay.ts` | **Modify** | Add `messages`, `systemPrompt`, `model`, `type` to TaskDispatch |
| `packages/agent-runner/src/lib/task-executor.ts` | **Modify** | Handle new task types (chat, summarize), support `messages` field |

### Phase 2: Remove local paths from server

| File | Action | What |
|------|--------|------|
| `server/routes/agent.ts` | **Modify** | Remove local execution from all endpoints; dispatch via relay |
| `server/routes/dispatch.ts` | **Modify** | Remove `dispatchLocal()`; remove local steering; remove classifier call |
| `server/index.ts` | **Modify** | Remove `initializeProviders()` |

### Phase 3: Delete server-side provider code

| File | Action | Reason |
|------|--------|--------|
| `server/lib/providers/adapters/anthropic-direct.ts` | **Delete** | Server never calls Anthropic |
| `server/lib/providers/adapters/claude-code.ts` | **Delete** | Server never runs Claude Code |
| `server/lib/providers/adapters/codex.ts` | **Delete** | Server never runs Codex |
| `server/lib/providers/registry.ts` | **Delete** | No providers on server |
| `server/lib/providers/context.ts` | **Delete** | Context injection in agent runner |
| `server/lib/providers/cache-utils.ts` | **Delete** | Prompt caching in agent runner |
| `server/lib/providers/mcp-loader.ts` | **Delete** | MCP loading in agent runner |
| `server/lib/providers/index.ts` | **Modify** | Keep only type re-exports |
| `server/lib/dispatch/procedure-classifier.ts` | **Delete** | Classification moves to agent runner |

### Keep unchanged

| File | Reason |
|------|--------|
| `server/lib/providers/types.ts` | Types used by relay, events, dispatch engine (15+ importers) |
| `server/lib/dispatch/procedure-types.ts` | Keep as reference; agent runner has its own copy |
| `server/lib/dispatch/procedure-executor.ts` | Keep as reference; agent runner has its own copy |
| `server/lib/relay-server.ts` | Already correct |
| `server/lib/machine-registry.ts` | Already correct |
| `server/lib/dispatch/dispatch-engine.ts` | Orchestrates relay dispatch, emits to executionEventBus |
| `server/lib/observability/*` | Observability layer works via executionEventBus (unaffected) |

---

## 8. Implementation Order

| Step | What | Verify |
|------|------|--------|
| 1 | Extend relay TaskDispatch type with `messages`, `systemPrompt`, `model`, `type` | Types compile |
| 2 | Update agent runner to handle chat/summarize task types and `messages` field | Agent runner unit tests |
| 3 | Copy procedure pipeline to agent runner | Procedure executor unit tests pass in agent runner |
| 4 | Convert `/generate-plan` to relay-only (agent.ts) | Unit test: 400 when no machine, relay dispatch when machine present |
| 5 | Convert `/chat` to relay-only (agent.ts) | Unit test: same pattern |
| 6 | Convert `/task-chat` to relay-only (agent.ts) | Unit test: same pattern |
| 7 | Convert `/summarize` to relay-only (agent.ts) | Unit test: same pattern |
| 8 | Convert `/dispatch` to relay-only (agent.ts) | Unit test: same pattern |
| 9 | Remove `dispatchLocal()` from dispatch.ts, always use `dispatchViaRelay()` | Unit test: relay called for all environments |
| 10 | Remove local steering from dispatch.ts `/steer` | Unit test: relay steer called |
| 11 | Remove `initializeProviders()` from server/index.ts | Server starts cleanly |
| 12 | Delete server-side provider adapter files | `npm run build` passes |
| 13 | Update frontend stores for auto machine selection | Manual test |
| 14 | Full integration test | `npm run build` + `npm run lint` + manual E2E |

---

## 9. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Localhost WebSocket adds latency | Negligible (~0.1ms) | Measure; optimize only if needed |
| Users must run agent runner separately | Medium UX friction | Add to `npm run dev` via concurrently |
| Relay protocol changes break existing agent runners | Breaking change | Version the protocol; update agent runner first |
| Procedure pipeline migration has bugs | Medium | Port with unit tests; keep server-side as reference |
| Chat observability changes | Low | executionEventBus already handles relay events |

---

## 10. Open Questions for Discussion

1. **Phase 1 first or Phase 2 first?** We could extend the agent runner first (safer, no server breakage) or strip the server first (faster, but agent runner must be ready). Recommendation: Phase 1 first.

2. **Should `npm run dev` auto-start the agent runner?** Removes friction for developers but adds complexity to the script.

3. **Should the `/providers` endpoint report connected machine capabilities instead of server-side providers?** This would show what the connected agent runners can do.

4. **Should task classification move to the agent runner or be a server-side hint?** The server could pass `procedure: 'full-development'` as a hint in the relay dispatch, letting the agent runner decide whether to use it.
