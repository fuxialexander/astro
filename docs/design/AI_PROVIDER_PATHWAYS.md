# AI Provider Pathways

How AI providers (Claude Agent SDK, Codex, OpenClaw, OpenCode) are used across all Astro interaction modes. This is the canonical reference for understanding where providers are invoked, what capabilities they have, and what gaps exist.

**Last updated:** 2026-03-05

---

## 1. Interaction Modes

Astro has **14 relay-dispatched pathways** + **2 direct Anthropic API calls** where an AI model is invoked. They fall into 6 categories:

### A. Task Execution (full agentic coding)

| # | Pathway | Frontend Trigger | API Endpoint | Task Type | Description |
|---|---------|-----------------|--------------|-----------|-------------|
| 1 | **Task Execution** | "Execute" button on plan node | `POST /api/dispatch/task` | `execution` | Full agentic session: reads/writes files, runs commands, creates PRs. The core work loop. |
| 2 | **Playground** | Submit in playground | `POST /api/dispatch/task` | `execution` | Same dispatch path as task execution, but with an ephemeral project (`projectType: 'playground'`). |
| 3 | **Interactive Plan** | "Brainstorm" button | `POST /api/dispatch/task` | `execution` (interactive) | Brainstorm/plan interactively without worktree. Uses `buildInteractivePlanPrompt()`. Skips working directory requirement. |
| 4 | **HPC/Slurm Dispatch** | HPC dispatch UI | `POST /api/relay/slurm/dispatch` | `execution` | Dispatch tasks to HPC clusters with Slurm resource config (partition, GPU, nodes). Forces `claude-sdk` provider. Requires `hpcCapability` on target machine. |

### B. Planning (structured plan generation)

| # | Pathway | Frontend Trigger | API Endpoint | Task Type | Description |
|---|---------|-----------------|--------------|-----------|-------------|
| 5 | **Plan Generation** | "Create Plan" dialog submit | `POST /api/agent/generate-plan` | `plan` | Generates a DAG of tasks with dependencies. Uses structured JSON output (`PLAN_GRAPH_SCHEMA`). Falls back to `retryPlanExtractionWithHaiku()` if JSON extraction fails. |

### C. Chat (conversational, may use tools)

| # | Pathway | Frontend Trigger | API Endpoint | Task Type | Description |
|---|---------|-----------------|--------------|-----------|-------------|
| 6 | **Project Chat** | Chat sidebar | `POST /api/agent/chat` | `chat` | General conversation about the project. Has read-only tool access. |
| 7 | **Plan Chat** | "Ask AI" in plan view | `POST /api/agent/plan-chat` | `chat` | Refine plan decomposition. Receives plan nodes/edges as context. Defaults to Haiku for speed. |
| 8 | **Task Chat** | Chat panel in task detail | `POST /api/agent/task-chat` | `chat` | Discuss a specific task's execution output. Receives task title, description, output, branch/PR context. Supports session resume. |
| 9 | **Compact** | Auto when context exceeds limit | `POST /api/agent/compact` | `chat` | Summarizes conversation history for context compression. Single-turn (`maxTurns: 1`). Preserves decisions, action items, technical details. |

### D. Auxiliary (lightweight, single-turn via relay)

| # | Pathway | Frontend Trigger | API Endpoint | Task Type | Description |
|---|---------|-----------------|--------------|-----------|-------------|
| 10 | **Task Summary** | Auto after execution | `POST /api/agent/summarize` | `summarize` | Generates structured `ExecutionSummary` (status, findings, artifacts). Uses `executeViaRelay()`. |
| 11 | **Title Generation** | Auto on project load | `POST /api/agent/generate-title` | `summarize` | Single-turn: generates concise title from description (max 80 chars). |
| 12 | **Refine** | "Refine" button on task/project | `POST /api/agent/refine` | `summarize` | Improves task/project title and description. Returns `{ refinedTitle, refinedDescription, confidence }`. |
| 13 | **Label Suggestion** | Auto on task creation | `POST /api/agent/suggest-labels` | `summarize` | Suggests category labels (Frontend, Backend, Testing, Infrastructure, Research) for tasks. Returns 0-2 label IDs. |

### E. Steering (modifies active execution)

| # | Pathway | Frontend Trigger | API Endpoint | Task Type | Description |
|---|---------|-----------------|--------------|-----------|-------------|
| 14 | **Steering** | Send message during execution | `POST /api/dispatch/steer` | -- | Mid-execution guidance injected into running session. Not a new task -- modifies active one. Routes to `injectMessage()` (running) or `resumeTask()` (completed). |

### F. Direct Anthropic API Calls (bypass relay)

These do NOT go through the relay/agent-runner pipeline. They call the Anthropic API directly from the server process.

| # | Pathway | Trigger | Location | Model | Description |
|---|---------|---------|----------|-------|-------------|
| 15 | **Plan Extraction Retry** | Auto when plan JSON extraction fails | `packages/core/src/plan-extraction-retry.ts` | `claude-haiku-4-5-20251001` | Fallback: sends accumulated plan text to Haiku for structured JSON extraction. 30s timeout. Non-blocking (returns null on error). |
| 16 | **Server-Side Summary** | Auto during PR body generation | `packages/core/src/dispatch/summary-utils.ts` | `claude-3-haiku-20240307` | Layer 3 of 5-layer PR summary fallback chain. Generates `ExecutionSummary` from task output. 15s timeout. Only called if layers 1-2 (cached/regex) fail. |

---

## 2. Data Flow

### Relay-Dispatched Pathways (1-14)

```
Frontend Store          Astro Server              Relay (WebSocket)         Agent Runner
----                    ----                      ----                      ----
api-client.ts    ->     routes/agent.ts      ->   relayServer            -> websocket-client.ts
execution-store  ->     routes/dispatch.ts   ->   .dispatchTask()        -> task-executor.ts
agent-store      ->     routes/relay.ts      ->   .steerTask()           -> provider adapter
                                                                           |-- claude-sdk-adapter
                                                                           |-- codex-adapter
                                                                           |-- openclaw-adapter
                                                                           |-- opencode-adapter
                                                                           +-- claude-code-adapter
```

### Direct API Calls (15-16)

```
Astro Server                          Anthropic API
----                                  ----
plan-extraction-retry.ts    ->        messages.create() [Haiku 4.5]
dispatch/summary-utils.ts   ->        messages.create() [Haiku 3]
```

**Key routing decisions:**

1. **Server builds system prompt** (`prompt-templates.ts`) and injects: vision doc, skills, env context, dependency outputs, repo context.
2. **Relay dispatches** to the correct machine via WebSocket (machine selection based on `targetMachineId` or first available).
3. **Task executor** selects adapter based on `preferredProvider` or auto-detection order.
4. **Adapter executes** via SDK (in-process) or CLI subprocess, streams events back.
5. **Direct API calls** are fire-and-forget fallbacks that bypass the relay entirely. They use the server's `ANTHROPIC_API_KEY`, not the agent runner's credentials.

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
  |-- execution -> full path: settingSources, all tools, MCP, sandbox, summary
  |-- plan     -> text-only fast path (runTextOnlyQuery): no tools, no settingSources
  |-- chat     -> text-only fast path: read-only tools + Skill, settingSources loaded
  +-- summarize -> text-only fast path: no tools, json_schema output

CLI Adapters (Codex, OpenClaw, OpenCode, Claude Code):
  +-- All types -> same execute() path: spawn CLI with prompt
```

The "text-only fast path" in the Claude SDK adapter (`runTextOnlyQuery()`) is an optimization that skips heavy setup (MCP servers, sandbox, full tool list) to minimize time-to-first-token.

---

## 4. Provider Capabilities Matrix

### Operations Support

|                      | execute | resumeTask | injectMessage | generateSummary | text-only path |
|----------------------|---------|------------|---------------|-----------------|----------------|
| **Claude SDK**       | Yes     | Yes        | Yes           | Yes             | Yes            |
| **Codex**            | Yes     | Yes (PR #42) | No (returns false) | No        | No             |
| **OpenClaw**         | Yes     | Yes (PR #52) | No (returns false) | No        | No             |
| **OpenCode**         | Yes     | Yes (PR #52) | No (returns false) | No        | No             |
| **Claude Code CLI**  | Yes     | No         | No            | No              | No             |

### Skills & Plugin Loading

| Provider | Skill System | Storage | Loaded During Execution? | Loaded During Chat? |
|----------|-------------|---------|--------------------------|---------------------|
| **Claude SDK** | `settingSources: ['user','project','local']` + `Skill` tool | `~/.claude/skills/` | **Yes** (full path) | **Yes** (chat path now loads `settingSources` + `Skill`) |
| **Codex** | Native (stable, no feature flag) | `~/.codex/skills/` | **Yes** (CLI loads natively) | Yes (same CLI path) |
| **OpenClaw** | Workspace-scoped skill system | Managed skills dir | **Yes** (CLI loads natively) | Yes (same CLI path) |
| **OpenCode** | Claude-compatible | `~/.claude/skills/` | **Yes** (reads `.claude/` by default) | Yes (same CLI path) |
| **Claude Code CLI** | Native | `~/.claude/skills/` | **Yes** (CLI loads natively) | Yes (same CLI path) |

### Multi-Turn / Resume Support

| Provider | How Resume Works | Session ID Source | Resume Command |
|----------|-----------------|-------------------|----------------|
| **Claude SDK** | SDK `resume` option on `query()` | SDK session ID from `session_init` event | In-process `query({ options: { resume: sessionId } })` |
| **Codex** | `codex exec resume <threadId> <prompt>` | `thread_id` from `thread.started` JSONL event | `codex exec resume <id> --json <prompt>` |
| **OpenClaw** | Gateway WebSocket `chat.send` to same `sessionKey` | `session_id` from `session.start` event | `chat.send` with preserved `sessionKey` |
| **OpenCode** | `opencode run --session <id> --print` | `session_id` from `system` JSONL event | `opencode run --session <id> --print --output-format json <prompt>` |
| **Claude Code CLI** | Not supported (CLI is fire-and-forget) | N/A | N/A |

### Steering Support

| Provider | Mid-Execution (injectMessage) | Post-Completion (resumeTask) |
|----------|-------------------------------|------------------------------|
| **Claude SDK** | Yes -- `Query.streamInput()` | Yes -- SDK `resume` |
| **Codex** | No (returns false) | Yes -- `exec resume` (PR #42) |
| **OpenClaw** | No (returns false) | Yes -- gateway `chat.send` (PR #52) |
| **OpenCode** | No (returns false) | Yes -- `--session <id>` (PR #52) |
| **Claude Code CLI** | No | No |

---

## 5. Pathway x Provider Detail

### Pathways 1-2: Task Execution + Playground

```
POST /api/dispatch/task
  -> routes/dispatch.ts builds system prompt (buildTaskExecutionPrompt)
  -> Injects: vision doc, skills (backend-scoped), env context, dependency outputs
  -> relayServer.dispatchTask() -> agent-runner
  -> task-executor selects adapter -> adapter.execute()
  -> Events stream back: text, tool_use, tool_result, file_change, session_init, result
```

**Provider skills:** All providers load native skills (Claude SDK via `settingSources`, CLI providers via native CLI loading).

**Multi-turn:** Playground uses steering (`POST /api/dispatch/steer`) for follow-up messages. Maps to `injectMessage()` (running) or `resumeTask()` (completed).

### Pathway 3: Interactive Plan

```
POST /api/dispatch/task (isInteractivePlan=true)
  -> routes/dispatch.ts builds system prompt (buildInteractivePlanPrompt)
  -> Injects: vision doc, skills, GitHub context, replan context
  -> Skips working directory validation
  -> relayServer.dispatchTask() -> agent-runner
  -> Events: text (streaming plan discussion), plan_result (extracted plan JSON)
  -> Server-side plan extraction via retryPlanExtractionWithHaiku() if needed
```

**Provider skills:** Same as task execution -- loaded via `settingSources` (SDK) or natively (CLI).

### Pathway 4: HPC/Slurm Dispatch

```
POST /api/relay/slurm/dispatch
  -> routes/relay.ts validates Slurm config (partition, GPU, nodes, mem, time)
  -> Forces claude-sdk provider
  -> Verifies target machine has hpcCapability
  -> relayServer.dispatchTask() with slurmConfig in metadata
  -> Events: same as task execution
```

**Special constraints:** Requires `hpcCapability` flag on provider. Machine selection prioritizes HPC-capable machines. Slurm config (partition, nodes, GPU, modules) passed in task metadata.

### Pathway 5: Plan Generation

```
POST /api/agent/generate-plan
  -> routes/agent.ts builds system prompt (buildPlanSystemPrompt)
  -> Injects: vision doc, skills, env context, file tree, git state, GitHub context
  -> relayServer.dispatchTask() with type='plan'
  -> agent-runner: Claude SDK uses json_schema structured output
  -> CLI adapters: system prompt inlined into user prompt
  -> Events: text (streaming plan), plan_result (final graph JSON)
  -> On JSON extraction failure: retryPlanExtractionWithHaiku() (Pathway 15)
```

**Provider skills:** Claude SDK skips skills (text-only path). CLI providers load skills natively but plan generation doesn't invoke them.

**Multi-turn:** Plan steering via `POST /api/dispatch/steer` during generation.

### Pathways 6-8: Chat (Project / Plan / Task)

```
POST /api/agent/{chat,plan-chat,task-chat}
  -> routes/agent.ts builds system prompt (buildChatSystemPrompt / buildTaskChatSystemPrompt)
  -> Injects: vision doc, plan context (plan-chat), task output (task-chat), skills, env context
  -> streamChatViaRelay() -> relayServer.dispatchTask() with type='chat'
  -> agent-runner: Claude SDK uses runTextOnlyQuery() (fast path)
  -> CLI adapters: standard execute() with prompt
  -> Events: text, tool_use, tool_result (read-only tools), session_init, done
```

**Provider skills:** Claude SDK chat path now loads `settingSources` + includes `'Skill'` in allowed tools (fixed in PR #52). CLI providers load skills natively.

**Multi-turn:** Chat supports `resumeSessionId` for continuing prior conversations. Maps to `resumeTask()` on the adapter. Supported by Claude SDK, Codex (PR #42), OpenClaw (PR #52), OpenCode (PR #52).

**Tools available in chat (Claude SDK):**
- With working directory: `['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Skill']`
- Without working directory: `['WebSearch', 'WebFetch', 'Skill']`

### Pathway 9: Compact

```
POST /api/agent/compact
  -> routes/agent.ts builds compact prompt from message transcript
  -> streamChatViaRelay() with type='chat', maxTurns=1
  -> Returns: structured summary of conversation (decisions, facts, action items)
```

**Provider skills:** Not needed (summarization task).

### Pathway 10: Task Summary

```
POST /api/agent/summarize
  -> executeViaRelay() with type='summarize'
  -> Claude SDK: runTextOnlyQuery() with no tools, json_schema output
  -> Returns: ExecutionSummary { status, executiveSummary, keyFindings }
```

**Provider skills:** Not needed (structured extraction task).

### Pathways 11-13: Title Generation, Refine, Label Suggestion

```
POST /api/agent/{generate-title,refine,suggest-labels}
  -> executeViaRelay() with type='summarize', maxTurns=1
  -> Single-turn structured output (title string, refinement JSON, label IDs)
```

All three are lightweight single-turn tasks that use `executeViaRelay()` for synchronous execution. No tools, no skills, no multi-turn.

| Sub-pathway | Prompt Builder | Output |
|-------------|---------------|--------|
| Title Gen | `buildTitleGenerationPrompt()` | Plain text (first line, max 80 chars) |
| Refine | `buildRefinementPrompt()` | JSON: `{ refinedTitle, refinedDescription, confidence }` |
| Labels | `buildLabelSuggestionPrompt()` | JSON: `{ labelIds: ['l1','l3'] }` (0-2 from: Frontend, Backend, Testing, Infrastructure, Research) |

### Pathway 14: Steering

```
POST /api/dispatch/steer
  -> relayServer.steerTask() -> WebSocket TaskSteerMessage
  -> agent-runner: task-executor routes to adapter
  -> Running task: adapter.injectMessage(taskId, message, interrupt)
  -> Completed task: adapter.resumeTask(taskId, message, ...)
```

**Provider support:** Claude SDK (both inject + resume), Codex (resume only), OpenClaw (resume only), OpenCode (resume only).

### Pathway 15: Plan Extraction Retry (Direct API)

```
plan-extraction-retry.ts:retryPlanExtractionWithHaiku()
  -> Called when regex-based plan JSON extraction fails
  -> Truncates text to last 200K chars
  -> Direct Anthropic API: claude-haiku-4-5-20251001, max_tokens=16384
  -> Feeds response through extractPlanJsonFromText()
  -> 30s timeout, returns null on any error
```

**Not relay-dispatched.** Uses server-side `ANTHROPIC_API_KEY`. Called from plan generation post-processing in `dispatch.ts`.

### Pathway 16: Server-Side Summary (Direct API)

```
dispatch/summary-utils.ts:generateServerSideSummary()
  -> Layer 3 of 5-layer PR summary fallback chain:
     L1: Cached structured summary (no API)
     L2: Regex extraction from execution output (no API)
     L3: Direct Anthropic API call (this pathway)
     L4: Git diff summary (no API)
     L5: Raw task description fallback (no API)
  -> Direct Anthropic API: claude-3-haiku-20240307, max_tokens=1024
  -> 15s timeout, returns null on failure (chain continues to L4)
```

**Not relay-dispatched.** Uses server-side `ANTHROPIC_API_KEY`. Only invoked when layers 1-2 fail to produce a PR body summary.

---

## 6. Identified Gaps

### GAP-1: Claude SDK Chat Missing Skills

**Status:** Fixed in PR #52 (agent-runner repo).

**Location:** `claude-sdk-adapter.ts:runTextOnlyQuery()`

**Problem:** The text-only fast path for chat tasks did NOT set `settingSources` and did NOT include `'Skill'` in `allowedTools`.

**Fix:** Added `settingSources: ['user', 'project', 'local']` and `'Skill'` to `allowedTools` in the chat path. Summarize path unchanged (no skills needed).

**Affected pathways:** 6 (Project Chat), 7 (Plan Chat), 8 (Task Chat)

### GAP-2: OpenClaw Missing Resume/Steer

**Status:** Fixed in PR #52 (agent-runner repo).

**Location:** `openclaw-adapter.ts`

**Problem:** No `resumeTask()` or `injectMessage()` methods.

**Fix:** Implemented `resumeTask()` using gateway WebSocket `chat.send` to same `sessionKey`. Session preserved after successful execution. `injectMessage()` returns false (gateway does not support mid-execution injection).

**Affected pathways:** 2 (Playground steering), 6-8 (Chat resume), 14 (Steering)

### GAP-3: OpenCode Missing Resume/Steer

**Status:** Fixed in PR #52 (agent-runner repo).

**Location:** `opencode-adapter.ts`

**Problem:** No `resumeTask()` or `injectMessage()` methods.

**Fix:** Implemented `resumeTask()` using `opencode run --session <id> --print`. Session ID captured from `system` event. Session preserved after successful execution with 30-minute TTL. `injectMessage()` returns false.

**Affected pathways:** 2 (Playground steering), 6-8 (Chat resume), 14 (Steering)

### GAP-4: Submodule Behind

**Location:** `packages/agent-runner/` submodule pointer

**Problem:** Submodule points to an older commit. Standalone repo has Codex multi-turn (PR #42), OpenClaw/OpenCode resume (PR #52), and Claude SDK chat skills fix.

**Fix:** Update submodule pointer to latest `main` after PRs merge.

### GAP-5: Direct API Calls Use Outdated Models

**Location:** `packages/core/src/dispatch/summary-utils.ts:489`

**Problem:** `generateServerSideSummary()` uses `claude-3-haiku-20240307` (older model), while `retryPlanExtractionWithHaiku()` uses `claude-haiku-4-5-20251001` (current). Both should use the latest Haiku.

**Fix:** Update `generateServerSideSummary()` to use `claude-haiku-4-5-20251001`.

**Affected pathways:** 16 (Server-Side Summary)

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

## 8. Pathway Summary Matrix

| # | Pathway | Endpoint | Task Type | Via Relay? | Skills? | Multi-Turn? | Provider Constraint |
|---|---------|----------|-----------|------------|---------|-------------|---------------------|
| 1 | Task Execution | `POST /api/dispatch/task` | execution | Yes | Yes (all) | Yes (steer) | Any |
| 2 | Playground | `POST /api/dispatch/task` | execution | Yes | Yes (all) | Yes (steer) | Any |
| 3 | Interactive Plan | `POST /api/dispatch/task` | execution | Yes | Yes (all) | Yes (steer) | Any |
| 4 | HPC/Slurm | `POST /api/relay/slurm/dispatch` | execution | Yes | No | No | `claude-sdk` only |
| 5 | Plan Generation | `POST /api/agent/generate-plan` | plan | Yes | CLI only | Yes (steer) | Any |
| 6 | Project Chat | `POST /api/agent/chat` | chat | Yes | Yes (all) | Yes (resume) | Any |
| 7 | Plan Chat | `POST /api/agent/plan-chat` | chat | Yes | Yes (all) | Yes (resume) | Any (default Haiku) |
| 8 | Task Chat | `POST /api/agent/task-chat` | chat | Yes | Yes (all) | Yes (resume) | Any |
| 9 | Compact | `POST /api/agent/compact` | chat | Yes | No | No (1 turn) | Any |
| 10 | Task Summary | `POST /api/agent/summarize` | summarize | Yes | No | No (1 turn) | Any |
| 11 | Title Gen | `POST /api/agent/generate-title` | summarize | Yes | No | No (1 turn) | Any |
| 12 | Refine | `POST /api/agent/refine` | summarize | Yes | No | No (1 turn) | Any |
| 13 | Label Suggestion | `POST /api/agent/suggest-labels` | summarize | Yes | No | No (1 turn) | Any |
| 14 | Steering | `POST /api/dispatch/steer` | -- | Yes | N/A | N/A (modifies) | Any |
| 15 | Plan Extract Retry | (internal) | -- | **No** | No | No | Haiku 4.5 |
| 16 | Server Summary | (internal) | -- | **No** | No | No | Haiku 3 |

---

## 9. File Reference

| Component | Path |
|-----------|------|
| Agent routes (chat, plan gen, summary, compact, refine, labels) | `server/routes/agent.ts` |
| Dispatch routes (execution, steer) | `server/routes/dispatch.ts` |
| Relay routes (HPC/Slurm dispatch) | `server/routes/relay.ts` |
| Relay server | `server/lib/relay-server.ts` |
| Prompt templates | `packages/core/src/prompt-templates.ts` |
| Plan extraction retry (direct API) | `packages/core/src/plan-extraction-retry.ts` |
| Summary utilities (direct API) | `packages/core/src/dispatch/summary-utils.ts` |
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
