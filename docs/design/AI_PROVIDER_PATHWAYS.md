# AI Provider Pathways

How AI providers (Claude Agent SDK, Codex, OpenClaw, OpenCode) are used across all Astro interaction modes. This is the canonical reference for understanding where providers are invoked, what capabilities they have, and what gaps exist.

**Last updated:** 2026-03-05

---

## 1. Interaction Modes

Astro has **9 distinct pathways** where an AI provider is invoked. They fall into 4 categories:

### A. Task Execution (full agentic coding)

| # | Pathway | Frontend Trigger | API Endpoint | Task Type | Description |
|---|---------|-----------------|--------------|-----------|-------------|
| 1 | **Task Execution** | "Execute" button on plan node | `POST /api/dispatch/task` | `execution` | Full agentic session: reads/writes files, runs commands, creates PRs. The core work loop. |
| 2 | **Playground** | Submit in playground | `POST /api/dispatch/task` | `execution` | Same dispatch path as task execution, but with an ephemeral project (`projectType: 'playground'`). |

### B. Planning (structured plan generation)

| # | Pathway | Frontend Trigger | API Endpoint | Task Type | Description |
|---|---------|-----------------|--------------|-----------|-------------|
| 3 | **Plan Generation** | "Create Plan" dialog submit | `POST /api/agent/generate-plan` | `plan` | Generates a DAG of tasks with dependencies. Uses structured JSON output (plan graph schema). |

### C. Chat (conversational, may use tools)

| # | Pathway | Frontend Trigger | API Endpoint | Task Type | Description |
|---|---------|-----------------|--------------|-----------|-------------|
| 4 | **Project Chat** | Chat sidebar | `POST /api/agent/chat` | `chat` | General conversation about the project. Has read-only tool access. |
| 5 | **Plan Chat** | "Ask AI" in plan view | `POST /api/agent/plan-chat` | `chat` | Refine plan decomposition. Receives plan nodes/edges as context. Defaults to Haiku for speed. |
| 6 | **Task Chat** | Chat panel in task detail | `POST /api/agent/task-chat` | `chat` | Discuss a specific task's execution output. Receives task title, description, output, branch/PR context. |

### D. Auxiliary (lightweight, single-turn)

| # | Pathway | Frontend Trigger | API Endpoint | Task Type | Description |
|---|---------|-----------------|--------------|-----------|-------------|
| 7 | **Task Summary** | Auto after execution | `POST /api/agent/summarize` | `summarize` | Generates structured `ExecutionSummary` (status, findings, artifacts). |
| 8 | **Title Generation** | Auto on project load | `POST /api/agent/generate-title` | `chat` | Single-turn: generates concise title from description. |
| 9 | **Steering** | Send message during execution | `POST /api/dispatch/steer` | — | Mid-execution guidance injected into running session. Not a new task — modifies active one. |

---

## 2. Data Flow

All pathways follow the same architecture:

```
Frontend Store          Astro Server              Relay (WebSocket)         Agent Runner
─────────────          ────────────              ──────────────────        ─────────────
api-client.ts    →     routes/agent.ts      →    relayServer            → websocket-client.ts
execution-store  →     routes/dispatch.ts   →    .dispatchTask()        → task-executor.ts
agent-store      →                          →    .steerTask()           → provider adapter
                                                                          ├─ claude-sdk-adapter
                                                                          ├─ codex-adapter
                                                                          ├─ openclaw-adapter
                                                                          ├─ opencode-adapter
                                                                          └─ claude-code-adapter
```

**Key routing decisions:**

1. **Server builds system prompt** (`prompt-templates.ts`) and injects: vision doc, skills, env context, dependency outputs, repo context.
2. **Relay dispatches** to the correct machine via WebSocket (machine selection based on `targetMachineId` or first available).
3. **Task executor** selects adapter based on `preferredProvider` or auto-detection order.
4. **Adapter executes** via SDK (in-process) or CLI subprocess, streams events back.

---

## 3. Provider Routing in Agent Runner

### Adapter Selection

The task executor picks the adapter in this priority:
1. `task.preferredProvider` if specified (user's default provider setting)
2. First available from registered providers list
3. For `claude-code` type: prefers `ClaudeSdkAdapter` over `ClaudeCodeAdapter` (CLI fallback)

### Task Type Routing (inside adapters)

```
Claude SDK Adapter:
  ├─ execution → full path: settingSources, all tools, MCP, sandbox, summary
  ├─ plan     → text-only fast path (runTextOnlyQuery): no tools, no settingSources
  ├─ chat     → text-only fast path: read-only tools, no settingSources
  └─ summarize → text-only fast path: no tools, json_schema output

CLI Adapters (Codex, OpenClaw, OpenCode, Claude Code):
  └─ All types → same execute() path: spawn CLI with prompt
```

The "text-only fast path" in the Claude SDK adapter (`runTextOnlyQuery()`) is an optimization that skips heavy setup (MCP servers, sandbox, settingSources, full tool list) to minimize time-to-first-token.

---

## 4. Provider Capabilities Matrix

### Operations Support

|                      | execute | resumeTask | injectMessage | generateSummary | text-only path |
|----------------------|---------|------------|---------------|-----------------|----------------|
| **Claude SDK**       | Yes     | Yes        | Yes           | Yes             | Yes            |
| **Codex**            | Yes     | Yes (PR #42) | No (returns false) | No        | No             |
| **OpenClaw**         | Yes     | **No**     | **No**        | No              | No             |
| **OpenCode**         | Yes     | **No**     | **No**        | No              | No             |
| **Claude Code CLI**  | Yes     | No         | No            | No              | No             |

### Skills & Plugin Loading

| Provider | Skill System | Storage | Loaded During Execution? | Loaded During Chat? |
|----------|-------------|---------|--------------------------|---------------------|
| **Claude SDK** | `settingSources: ['user','project','local']` + `Skill` tool | `~/.claude/skills/` | **Yes** (full path) | **No** (fast path skips `settingSources`) |
| **Codex** | Native (stable, no feature flag) | `~/.codex/skills/` | **Yes** (CLI loads natively) | Yes (same CLI path) |
| **OpenClaw** | Workspace-scoped skill system | Managed skills dir | **Yes** (CLI loads natively) | Yes (same CLI path) |
| **OpenCode** | Claude-compatible | `~/.claude/skills/` | **Yes** (reads `.claude/` by default) | Yes (same CLI path) |
| **Claude Code CLI** | Native | `~/.claude/skills/` | **Yes** (CLI loads natively) | Yes (same CLI path) |

### Multi-Turn / Resume Support

| Provider | How Resume Works | Session ID Source | Resume Command |
|----------|-----------------|-------------------|----------------|
| **Claude SDK** | SDK `resume` option on `query()` | SDK session ID from `session_init` event | In-process `query({ options: { resume: sessionId } })` |
| **Codex** | `codex exec resume <threadId> <prompt>` | `thread_id` from `thread.started` JSONL event | `codex exec resume <id> --json <prompt>` |
| **OpenClaw** | **Not implemented** | `session_id` from `session.start` JSONL event | TBD: `openclaw agent --resume <id>` or similar |
| **OpenCode** | **Not implemented** | No session ID emitted currently | TBD: needs investigation |
| **Claude Code CLI** | Not supported (CLI is fire-and-forget) | N/A | N/A |

### Steering Support

| Provider | Mid-Execution (injectMessage) | Post-Completion (resumeTask) |
|----------|-------------------------------|------------------------------|
| **Claude SDK** | Yes — `Query.streamInput()` | Yes — SDK `resume` |
| **Codex** | No (returns false) | Yes — `exec resume` (PR #42) |
| **OpenClaw** | **No** | **No** |
| **OpenCode** | **No** | **No** |
| **Claude Code CLI** | No | No |

---

## 5. Pathway × Provider Detail

### Pathway 1 & 2: Task Execution + Playground

```
POST /api/dispatch/task
  → routes/dispatch.ts builds system prompt (buildTaskExecutionPrompt)
  → Injects: vision doc, skills (backend-scoped), env context, dependency outputs
  → relayServer.dispatchTask() → agent-runner
  → task-executor selects adapter → adapter.execute()
  → Events stream back: text, tool_use, tool_result, file_change, session_init, result
```

**Provider skills:** All providers load native skills (Claude SDK via `settingSources`, CLI providers via native CLI loading).

**Multi-turn:** Playground uses steering (`POST /api/dispatch/steer`) for follow-up messages. Maps to `injectMessage()` (running) or `resumeTask()` (completed).

### Pathway 3: Plan Generation

```
POST /api/agent/generate-plan
  → routes/agent.ts builds system prompt (buildPlanSystemPrompt)
  → Injects: vision doc, skills, env context, file tree, git state, GitHub context
  → relayServer.dispatchTask() with type='plan'
  → agent-runner: Claude SDK uses json_schema structured output
  → CLI adapters: system prompt inlined into user prompt
  → Events: text (streaming plan), plan_result (final graph JSON)
```

**Provider skills:** Claude SDK skips skills (text-only path). CLI providers load skills natively but plan generation doesn't invoke them.

**Multi-turn:** Plan steering via `POST /api/dispatch/steer` during generation.

### Pathway 4-6: Chat (Project / Plan / Task)

```
POST /api/agent/{chat,plan-chat,task-chat}
  → routes/agent.ts builds system prompt (buildChatSystemPrompt / buildTaskChatSystemPrompt)
  → Injects: vision doc, plan context (plan-chat), task output (task-chat), skills, env context
  → streamChatViaRelay() → relayServer.dispatchTask() with type='chat'
  → agent-runner: Claude SDK uses runTextOnlyQuery() (fast path)
  → CLI adapters: standard execute() with prompt
  → Events: text, tool_use, tool_result (read-only tools), session_init, done
```

**Provider skills:** **GAP** — Claude SDK fast path does NOT set `settingSources`, so `~/.claude/skills/` are not loaded. CLI providers load skills natively.

**Multi-turn:** Chat supports `resumeSessionId` for continuing prior conversations. Maps to `resumeTask()` on the adapter. Currently only Claude SDK and Codex (PR #42) support this.

**Tools available in chat (Claude SDK):**
- With working directory: `['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']`
- Without working directory: `['WebSearch', 'WebFetch']`
- **Missing:** `'Skill'` tool (needed for skill invocation)

### Pathway 7: Task Summary

```
POST /api/agent/summarize
  → streamChatViaRelay() with type='summarize'
  → Claude SDK: runTextOnlyQuery() with no tools, json_schema output
  → Returns: ExecutionSummary { status, executiveSummary, keyFindings }
```

**Provider skills:** Not needed (summary is a structured extraction task).

### Pathway 8: Title Generation

```
POST /api/agent/generate-title
  → streamChatViaRelay() with type='chat'
  → Single turn, no tools needed
```

**Provider skills:** Not needed.

### Pathway 9: Steering

```
POST /api/dispatch/steer
  → relayServer.steerTask() → WebSocket TaskSteerMessage
  → agent-runner: task-executor routes to adapter
  → Running task: adapter.injectMessage(taskId, message, interrupt)
  → Completed task: adapter.resumeTask(taskId, message, ...)
```

**Provider support:** Only Claude SDK (both inject + resume) and Codex (resume only, PR #42).

---

## 6. Identified Gaps

### GAP-1: Claude SDK Chat Missing Skills

**Location:** `claude-sdk-adapter.ts:runTextOnlyQuery()` (line ~639)

**Problem:** The text-only fast path for chat/plan/summarize tasks does NOT set `settingSources` and does NOT include `'Skill'` in `allowedTools`. Users cannot invoke their `~/.claude/skills/` (e.g., `/pr-shepherd`) during task chat, plan chat, or project chat.

**Fix:** Add `settingSources: ['user', 'project', 'local']` and `'Skill'` to `allowedTools` in the chat path. Keep summarize as-is (no skills needed).

**Affected pathways:** 4 (Project Chat), 5 (Plan Chat), 6 (Task Chat)

### GAP-2: OpenClaw Missing Resume/Steer

**Location:** `openclaw-adapter.ts`

**Problem:** No `resumeTask()` or `injectMessage()` methods. Multi-turn chat and playground steering don't work with OpenClaw.

**Fix:** Implement `resumeTask()` — need to investigate OpenClaw CLI's session resume mechanism. The CLI emits `session.start` with a `session_id` that could be used.

**Affected pathways:** 2 (Playground steering), 4-6 (Chat resume), 9 (Steering)

### GAP-3: OpenCode Missing Resume/Steer

**Location:** `opencode-adapter.ts`

**Problem:** No `resumeTask()` or `injectMessage()` methods. No session ID emitted currently.

**Fix:** Investigate OpenCode CLI's resume mechanism. Add session tracking and `resumeTask()`.

**Affected pathways:** 2 (Playground steering), 4-6 (Chat resume), 9 (Steering)

### GAP-4: Submodule Behind

**Location:** `packages/agent-runner/` submodule pointer

**Problem:** Submodule points to commit `20a713f` (PR #40) but standalone repo has `7c4f5a2` with Codex multi-turn (PR #42) and other fixes.

**Fix:** Update submodule pointer to latest `main`.

### GAP-5: Codex Multi-Turn Not in Task Executor Resume Check

**Status:** Fixed in PR #42 (in agent-runner repo). Task executor now checks both `ClaudeSdkAdapter` and `CodexAdapter` for resume eligibility. Will be available once submodule is updated (GAP-4).

---

## 7. Provider Skill Systems Reference

### Claude Agent SDK
- **Mechanism:** `settingSources: ['user', 'project', 'local']` in query options
- **What it loads:** `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, `~/.claude/skills/*/SKILL.md`, project `.claude/` dir
- **Tool:** `'Skill'` must be in `allowedTools` for dynamic skill invocation
- **MCP:** Loaded separately via `mcpServers` option in query

### Codex CLI
- **Mechanism:** Native skill discovery at startup. Scans `~/.codex/skills/` for `SKILL.md` files.
- **Feature flags:** Skills graduated to stable (no flag needed). Related flags: `skill_mcp_dependency_install` (stable), `steer` (stable).
- **System skills:** `~/.codex/skills/.system/` contains `skill-creator` and `skill-installer`.
- **CLI flag:** `--enable skills` was the old flag; now default.

### OpenCode CLI
- **Mechanism:** Reads Claude's `.claude/skills/` directory by default (Claude-compatible).
- **Env vars:** `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` to block, `OPENCODE_DISABLE_CLAUDE_CODE` to block all `.claude/` reading.
- **Config:** Agent configuration via `opencode agent create`.

### OpenClaw CLI
- **Mechanism:** Workspace-scoped skill system. `openclaw skills list/info/check` CLI commands.
- **Bundled skills:** Shipped with the CLI, eligibility-gated by platform requirements.
- **User skills:** Managed skills directory, separate from Claude's.
- **Config:** `~/.openclaw/config.json` for model, workspace config for skills.

---

## 8. File Reference

| Component | Path |
|-----------|------|
| Agent routes (chat, plan gen, summary) | `server/routes/agent.ts` |
| Dispatch routes (execution, steer) | `server/routes/dispatch.ts` |
| Relay server | `server/lib/relay-server.ts` |
| Prompt templates | `packages/core/src/prompt-templates.ts` |
| Skill manager | `server/lib/skill-manager.ts` |
| Skill injector | `packages/core/src/skill-injector.ts` |
| Streaming event log | `server/lib/streaming-event-log.ts` |
| Claude SDK adapter | `packages/agent-runner/src/providers/claude-sdk-adapter.ts` |
| Codex adapter | `packages/agent-runner/src/providers/codex-adapter.ts` |
| OpenClaw adapter | `packages/agent-runner/src/providers/openclaw-adapter.ts` |
| OpenCode adapter | `packages/agent-runner/src/providers/opencode-adapter.ts` |
| Claude Code CLI adapter | `packages/agent-runner/src/providers/claude-code-adapter.ts` |
| Task executor | `packages/agent-runner/src/lib/task-executor.ts` |
| WebSocket client | `packages/agent-runner/src/lib/websocket-client.ts` |
| Base adapter interface | `packages/agent-runner/src/providers/base-adapter.ts` |
| Frontend execution store | `src/stores/execution-store.ts` |
| Frontend agent store | `src/stores/agent-store.ts` |
| Frontend API client | `src/lib/api-client.ts` |
