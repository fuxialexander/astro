# AI Provider Pathways

How AI providers (Claude Agent SDK, Codex, OpenClaw, OpenCode) are used across all Astro interaction modes. This is the canonical reference for understanding where providers are invoked, what capabilities they have, and what gaps exist.

**Last updated:** 2026-03-05

---

## 1. Pathway Classification

Astro has **14 relay-dispatched pathways** + **2 direct Anthropic API calls** where an AI model is invoked. They are classified by **complexity** and **purpose**:

### Class A: Agentic (multi-turn, tools, files, long-running)

These are full agentic sessions. The AI reads/writes files, runs commands, iterates across turns, and may take minutes to complete. They require a working directory, skills, and compute environment context.

| # | Pathway | API Endpoint | Workflow |
|---|---------|--------------|----------|
| 1 | **Task Execution** | `POST /api/dispatch/task` | Dispatch -> Agent session -> tool loop -> result -> PR/push/branch |
| 2 | **Playground** | `POST /api/dispatch/task` | Same as #1 but ephemeral project, supports steering for follow-ups |
| 3 | **Interactive Plan** | `POST /api/dispatch/task` | Dispatch -> Agent session -> brainstorm -> extract plan JSON |
| 4 | **HPC/Slurm Dispatch** | `POST /api/relay/slurm/dispatch` | Dispatch -> Agent session ON HPC machine -> Slurm job submission |

### Class B: Conversational (multi-turn chat, read-only tools)

These are chat sessions. The AI can read files but not write. They support multi-turn via message history (6-7) or adapter-level session resume (8). Used for discussion and analysis, not execution.

| # | Pathway | API Endpoint | Workflow |
|---|---------|--------------|----------|
| 5 | **Plan Generation** | `POST /api/agent/generate-plan` | Stream -> structured JSON plan output -> extract nodes/edges |
| 6 | **Project Chat** | `POST /api/agent/chat` | Stream chat with read-only tools, message history continuity |
| 7 | **Plan Chat** | `POST /api/agent/plan-chat` | Stream chat about plan, defaults to Haiku, history continuity |
| 8 | **Task Chat** | `POST /api/agent/task-chat` | Stream chat about task output, supports adapter session resume |
| 9 | **Compact** | `POST /api/agent/compact` | Single-turn summarization of conversation history |

### Class C: One-Shot (single turn, no tools, fire-and-forget)

These are simple single-turn completions. No tools, no file access, no skills needed. They go through the relay (`executeViaRelay()`) but use `maxTurns: 1` and `type: 'summarize'`. All have graceful fallbacks if the AI call fails.

| # | Pathway | API Endpoint | Fallback if AI fails |
|---|---------|--------------|---------------------|
| 10 | **Task Summary** | `POST /api/agent/summarize` | Truncated execution output |
| 11 | **Title Generation** | `POST /api/agent/generate-title` | First 80 chars of description |
| 12 | **Refine** | `POST /api/agent/refine` | Original title + description unchanged |
| 13 | **Label Suggestion** | `POST /api/agent/suggest-labels` | Empty array `[]` |

### Class D: Control Signal (no AI invocation itself)

| # | Pathway | API Endpoint | What it does |
|---|---------|--------------|-------------|
| 14 | **Steering** | `POST /api/dispatch/steer` | Injects message into running task or resumes completed task |

### Class E: Direct API Fallbacks (bypass relay, server-side only)

These call the Anthropic API directly from the server process. They are **non-blocking fallbacks** that gracefully return `null` if no `ANTHROPIC_API_KEY` is set. They do NOT require an agent runner or relay connection.

| # | Pathway | When triggered | Model | If no API key |
|---|---------|---------------|-------|---------------|
| 15 | **Plan Extraction Retry** | Plan JSON regex fails | `claude-haiku-4-5-20251001` | Returns `null`, plan extraction fails gracefully |
| 16 | **Server-Side Summary** | PR body needs summary, layers 1-2 failed | `claude-3-haiku-20240307` | Returns `null`, falls to layer 4 (git diff) then layer 5 (task description) |

---

## 2. Workflow Diagrams

### Class A: Agentic Workflow (Pathways 1-4)

```
User clicks "Execute"
        |
        v
  ┌─────────────────────────┐
  │   Astro Server           │
  │   routes/dispatch.ts     │
  │                          │
  │  1. Build system prompt  │
  │     - vision doc         │
  │     - skills (backend-   │
  │       scoped)            │
  │     - env context        │
  │     - dependency outputs │
  │  2. Select machine       │
  │  3. Dispatch via relay   │
  └──────────┬──────────────┘
             │ WebSocket
             v
  ┌─────────────────────────┐
  │   Agent Runner            │
  │   task-executor.ts        │
  │                           │
  │  1. Select adapter        │
  │  2. adapter.execute()     │
  │                           │
  │  ┌─────────────────────┐  │
  │  │  Agent Loop          │  │
  │  │  (multi-turn)        │  │
  │  │                      │  │
  │  │  LLM -> tool_use ->  │  │
  │  │  tool_result -> LLM  │  │
  │  │  -> tool_use -> ...  │  │
  │  │                      │  │
  │  │  Skills loaded via   │  │
  │  │  settingSources or   │  │
  │  │  native CLI loading  │  │
  │  └─────────────────────┘  │
  │                           │
  │  Stream events back:      │
  │  text, tool_use,          │
  │  tool_result, file_change │
  └──────────┬───────────────┘
             │
             v
  ┌─────────────────────────┐
  │  SSE -> Frontend          │
  │  + streaming_events DB    │
  │  + taskExecutions DB      │
  │  + planNodes DB           │
  └───────────────────────────┘
```

### Class B: Chat Workflow (Pathways 6-8)

```
User sends message
        |
        v
  ┌─────────────────────────┐
  │   Astro Server            │
  │   routes/agent.ts         │
  │                           │
  │  1. Build system prompt   │
  │     (vision doc, plan     │
  │      context, task output)│
  │  2. streamChatViaRelay()  │
  └──────────┬───────────────┘
             │ WebSocket
             v
  ┌─────────────────────────┐
  │   Agent Runner            │
  │   runTextOnlyQuery()      │
  │                           │
  │  - Read-only tools        │
  │    [Read, Grep, Glob,     │
  │     WebSearch, WebFetch,  │
  │     Skill]                │
  │  - settingSources loaded  │
  │  - maxTurns: 10 (default) │
  │                           │
  │  No file writes,          │
  │  no command execution     │
  └──────────┬───────────────┘
             │
             v
  ┌─────────────────────────┐
  │  SSE -> Frontend          │
  │  + streaming_events DB    │
  │  (NO taskExecutions)      │
  └───────────────────────────┘
```

### Class C: One-Shot Workflow (Pathways 10-13)

```
Server needs summary/title/labels
        |
        v
  ┌─────────────────────────┐
  │   executeViaRelay()       │
  │                           │
  │  - maxTurns: 1            │
  │  - type: 'summarize'      │
  │  - No tools               │
  │  - No skills              │
  │  - No streaming to client │
  │  - 120s timeout           │
  └──────────┬───────────────┘
             │ WebSocket
             v
  ┌─────────────────────────┐
  │  Agent Runner             │
  │  runTextOnlyQuery()       │
  │  - No tools               │
  │  - No settingSources      │
  │  - json_schema output     │
  │  - Single completion      │
  └──────────┬───────────────┘
             │
             v
  ┌─────────────────────────┐
  │  JSON response to caller  │
  │  (NOT persisted to DB)    │
  │  Falls back on failure    │
  └───────────────────────────┘
```

### Class E: Direct API Fallback (Pathways 15-16)

```
Trigger: regex extraction fails / PR body needed
        |
        v
  ┌─────────────────────────┐
  │  Server Process            │
  │                            │
  │  if (!ANTHROPIC_API_KEY)   │
  │    return null  ──────────►  Fallback path
  │                            │  (no AI, use heuristics)
  │  Anthropic.messages.create │
  │  model: haiku              │
  │  timeout: 15-30s           │
  │                            │
  │  Parse JSON from response  │
  │  Return structured result  │
  └────────────────────────────┘

  NO relay, NO agent runner, NO provider adapter.
  Just a direct HTTP call to api.anthropic.com.
```

---

## 3. Answering Key Questions

### Q: Why does Pathway 9 (Compact) not need skills?

Compact is a **summarization task**, not an execution task. It receives the full conversation transcript as input and produces a compressed summary. It doesn't need to read files, invoke tools, or follow specialized workflows. The AI's job is purely textual: distill key decisions, facts, and action items from a conversation. Loading skills would add latency for no benefit.

However, Compact **does use an LLM** via relay dispatch (`streamChatViaRelay` with `type: 'chat'`, `maxTurns: 1`). It just doesn't need skills or tools.

### Q: Pathway 10 (Task Summary) -- does it extract from output without needing a model?

No -- **it does use an LLM**. `POST /api/agent/summarize` calls `executeViaRelay()` which dispatches to an agent runner, which runs `runTextOnlyQuery()` on the Claude SDK adapter. The LLM reads the raw execution output and produces a structured `ExecutionSummary` JSON.

The confusion may be that it has a **fallback**: if the relay call fails (timeout, no agent runner), it returns a degraded summary using the first 500 chars of execution output + file change paths. So it _can_ work without an LLM, but the quality is much worse.

### Q: Why does Pathway 15 (Plan Extraction Retry) exist? Not all machines have Haiku/Anthropic API key.

You're right to question this. Pathway 15 is a **non-critical, graceful-degradation fallback**:

```typescript
// plan-extraction-retry.ts line 19
if (!apiKey) return null  // No API key? Just skip, no error.
```

**What actually happens:**
1. Plan generation (Pathway 5) streams text from the agent runner
2. Server tries to extract plan JSON from the streamed text using regex (`extractPlanJsonFromText`)
3. **If regex succeeds** (the common case): done, no Haiku call needed
4. **If regex fails** (malformed/truncated output): fire-and-forget Haiku call to clean up the JSON
5. **If no `ANTHROPIC_API_KEY`**: returns `null`, plan extraction fails, user sees an error

So this pathway is:
- **Not required** for normal operation (regex usually works)
- **Not required** if you don't have an Anthropic API key (gracefully skips)
- **Only useful** as a recovery mechanism for edge cases where the agent's output was truncated or malformed

**Recommendation**: This could be made more robust by using the agent runner itself (via relay) for retry, instead of requiring a server-side API key. That way it would work with any provider.

### Q: Why does Pathway 4 (HPC/Slurm) need a language model?

The AI doesn't run ON the HPC cluster. The AI runs on the **agent-runner machine** that has access to the Slurm cluster. The workflow is:

```
Agent Runner (has Claude SDK installed)
    |
    |  Agent uses tools (Bash, Write, etc.) to:
    |  1. Write Slurm job scripts (.sbatch files)
    |  2. Submit them via `sbatch` command
    |  3. Monitor with `squeue`, `sacct`
    |  4. Collect results from shared filesystem
    |
    v
Slurm Cluster (GPU nodes, compute nodes)
    |  No AI here -- just computational workloads
    v
Results back to agent via shared filesystem
```

The `hpcCapability` flag means: "this machine has Slurm tools installed (`sbatch`, `squeue`, etc.) and can submit jobs to a cluster." It's auto-detected when the agent-runner starts by checking if Slurm commands are available.

The constraint `claude-sdk` only is because only the Claude SDK adapter has the full tool access needed to write job scripts and run Slurm commands interactively.

### Q: Which pathways are one-shot vs multi-step?

| Pathway | Turns | Workflow Complexity |
|---------|-------|---------------------|
| **1-4** (Execution) | Multi-turn (10-100+) | Full agent loop: think -> tool -> result -> think -> ... |
| **5** (Plan Generation) | Multi-turn (5-20) | Generate structured plan, may iterate on JSON schema |
| **6-8** (Chat) | Multi-turn (1-10) | Conversational, may read files |
| **9** (Compact) | **1 turn** | Single summarization pass |
| **10** (Summary) | **1 turn** | Single structured extraction |
| **11** (Title Gen) | **1 turn** | Single text generation |
| **12** (Refine) | **1 turn** | Single structured generation |
| **13** (Labels) | **1 turn** | Single classification |
| **14** (Steering) | **0 turns** (control signal) | Injects message, no AI invocation |
| **15** (Plan Retry) | **1 turn** | Single extraction |
| **16** (Server Summary) | **1 turn** | Single structured extraction |

**Pathways 10-13 are structurally identical**: single-turn, no tools, `type: 'summarize'`, via `executeViaRelay()`, each with a different prompt builder and fallback.

---

## 4. Model and Skill Requirements Matrix

### Which providers/models are supported?

| # | Pathway | Supported Providers | Model Selection | Default Model |
|---|---------|--------------------|-----------------|--------------|
| 1-3 | Execution/Playground/Interactive | All 5 (SDK, Codex, OpenClaw, OpenCode, CC CLI) | User override via UI | Agent runner default |
| 4 | HPC/Slurm | **Claude SDK only** | User override | Agent runner default |
| 5 | Plan Generation | All 5 | User override via UI | Agent runner default |
| 6 | Project Chat | All 5 | User override via UI | Agent runner default |
| 7 | Plan Chat | All 5 | User override via UI | **Haiku** (hardcoded default) |
| 8 | Task Chat | All 5 | User override via UI | Agent runner default |
| 9 | Compact | All 5 | **Bug: `model` param accepted but discarded** | Agent runner default |
| 10-13 | Summary/Title/Refine/Labels | All 5 | **No model param** (uses agent runner default) | Agent runner default |
| 14 | Steering | N/A (control signal) | N/A | N/A |
| 15 | Plan Extract Retry | **Anthropic API only** (not via relay) | Hardcoded | `claude-haiku-4-5-20251001` |
| 16 | Server Summary | **Anthropic API only** (not via relay) | Hardcoded | `claude-3-haiku-20240307` (outdated) |

### Which pathways need skills?

| # | Pathway | Provider Skills | Compute Backend Skills | User Skills | Rationale |
|---|---------|----------------|----------------------|-------------|-----------|
| 1-3 | Execution | **Yes** (settingSources) | **Yes** (backend-scoped) | **Yes** | Full agentic work needs all context |
| 4 | HPC/Slurm | **Yes** (settingSources) | **Yes** (HPC-specific) | **Yes** | Agent needs HPC workflow knowledge |
| 5 | Plan Generation | **No** (text-only path) | **Yes** (server-side injection) | CLI providers: Yes | Plan prompt includes skills summary |
| 6-8 | Chat | **Yes** (settingSources + Skill tool) | **Yes** (server-side) | **Yes** | Users may invoke skills in chat |
| 9 | Compact | **No** | **No** | **No** | Pure summarization, no tool use |
| 10-13 | One-shots | **No** | **No** | **No** | Simple completion, no tools needed |
| 14 | Steering | N/A | N/A | N/A | Control signal, not a task |
| 15-16 | Direct API | **No** | **No** | **No** | Server-side fallback, no adapter |

**Key distinction:**
- **Provider skills** = loaded by the adapter itself (settingSources for Claude SDK, native loading for CLI providers)
- **Compute backend skills** = injected server-side into the system prompt by `skillManager.getBackendScopedSkillInjection()`
- **User skills** = custom skills in `~/.claude/skills/` or `~/.codex/skills/` loaded by the provider

---

## 5. Data Storage and Observability

### What is persisted to Supabase?

| # | Pathway | `streaming_events` | `taskExecutions` | `planNodes` | Queryable after refresh? |
|---|---------|-------------------|------------------|-------------|--------------------------|
| 1-3 | Execution | **Yes** (full event log) | **Yes** (result, metrics, cost) | **Yes** (output, error, timestamps) | **Yes** -- hydrated via `useRestoredExecution` |
| 4 | HPC/Slurm | **Yes** (same as execution) | **Yes** | **Yes** | **Yes** |
| 5 | Plan Generation | **Yes** (text, plan_result) | No | No (plan stored in frontend state) | **Yes** -- via streamId |
| 6-8 | Chat | **Yes** (text, tool_use, tool_result, session_init) | No | No | **Yes** -- via streamId |
| 9 | Compact | **Yes** (same handler as chat) | No | No | **Yes** -- via streamId |
| 10 | Summary | **No** | No | No | **No** -- result returned to caller only |
| 11 | Title Gen | **No** | No | No | **No** -- result returned to caller only |
| 12 | Refine | **No** | No | No | **No** -- result returned to caller only |
| 13 | Labels | **No** | No | No | **No** -- result returned to caller only |
| 14 | Steering | **Yes** (`steer_message` event) | No | No | **Yes** -- included in event replay |
| 15 | Plan Retry | **Yes** (`plan_result` event if successful) | No | No | **Yes** -- appended to existing stream |
| 16 | Server Summary | **No** | No | No | **No** -- result used for PR body only |

### Observability Gaps

**Pathways 10-13 (One-Shots) have ZERO observability.** They use `executeViaRelay()` which:
- Does NOT persist events to `streaming_events`
- Does NOT create `taskExecutions` records
- Does NOT track cost, tokens, or model used
- Result is returned to caller and discarded

This means:
- No way to audit how many summary/title/refine/label calls are made
- No way to track cost of these auxiliary AI calls
- No way to debug failures (timeout? bad output? wrong model?)

**Recommendation**: Add lightweight persistence to `executeViaRelay()` -- at minimum, log the task type, input length, output length, model used, duration, and success/failure to a metrics table.

---

## 6. Data Flow Architecture

### Full Architecture Diagram

```
┌──────────────┐     ┌──────────────────────────────────────────────────────────┐
│  Frontend     │     │  Astro Server                                            │
│              │     │                                                          │
│  api-client  │────►│  routes/agent.ts                                         │
│  stores      │     │  ├── /generate-plan ─► streamChatViaRelay() ──────────┐  │
│              │     │  ├── /chat ──────────► streamChatViaRelay() ──────────┤  │
│              │     │  ├── /plan-chat ─────► streamChatViaRelay() ──────────┤  │
│              │     │  ├── /task-chat ─────► streamChatViaRelay() ──────────┤  │
│              │     │  ├── /compact ───────► streamChatViaRelay() ──────────┤  │
│              │     │  ├── /summarize ─────► executeViaRelay() ────────────┤  │
│              │     │  ├── /generate-title ► executeViaRelay() ────────────┤  │
│              │     │  ├── /refine ────────► executeViaRelay() ────────────┤  │
│              │     │  └── /suggest-labels ► executeViaRelay() ────────────┤  │
│              │     │                                                      │  │
│              │     │  routes/dispatch.ts                                   │  │
│              │────►│  ├── /task ──────────► dispatchViaRelay() ───────────┤  │
│              │     │  └── /steer ─────────► relayServer.steerTask() ─────┤  │
│              │     │                                                      │  │
│              │     │  routes/relay.ts                                      │  │
│              │────►│  └── /slurm/dispatch ► relayServer.dispatchTask() ──┤  │
│              │     │                                                      │  │
│              │     │  ┌─────────────────────────────────────────────────┐ │  │
│              │     │  │  streamChatViaRelay()          SSE streaming    │ │  │
│              │◄────│  │  - Persists to streaming_events DB              │ │  │
│              │     │  │  - Streams SSE to browser                       │ │  │
│              │     │  │  - Heartbeat + activity timeout                 │ │  │
│              │     │  └─────────────────────────────────────────────────┘ │  │
│              │     │                                                      │  │
│              │     │  ┌─────────────────────────────────────────────────┐ │  │
│              │     │  │  executeViaRelay()              Non-streaming   │ │  │
│              │     │  │  - NO persistence (gap!)                        │ │  │
│              │     │  │  - Returns JSON to caller                       │ │  │
│              │     │  │  - 120s timeout                                 │ │  │
│              │     │  └─────────────────────────────────────────────────┘ │  │
│              │     │                                                      │  │
│              │     │  Direct API (no relay):                              │  │
│              │     │  ├── plan-extraction-retry.ts → Haiku 4.5            │  │
│              │     │  └── summary-utils.ts → Haiku 3 (outdated)           │  │
│              │     └──────────────────────────────┬───────────────────────┘  │
└──────────────┘                                    │                          │
                                                    │ WebSocket                │
                                              ┌─────▼──────────────────┐       │
                                              │  Agent Runner            │      │
                                              │                          │      │
                                              │  task-executor.ts        │      │
                                              │  ├── ClaudeSdkAdapter    │      │
                                              │  ├── CodexAdapter        │      │
                                              │  ├── OpenClawAdapter     │      │
                                              │  ├── OpenCodeAdapter     │      │
                                              │  └── ClaudeCodeAdapter   │      │
                                              │                          │      │
                                              │  Type routing:           │      │
                                              │  execution → full path   │      │
                                              │  plan → text-only        │      │
                                              │  chat → text-only+tools  │      │
                                              │  summarize → text-only   │      │
                                              └──────────────────────────┘      │
```

---

## 7. Provider Capabilities Matrix

### Operations Support

|                      | execute | resumeTask | injectMessage | text-only path |
|----------------------|---------|------------|---------------|----------------|
| **Claude SDK**       | Yes     | Yes        | Yes           | Yes            |
| **Codex**            | Yes     | Yes (PR #42) | No          | No             |
| **OpenClaw**         | Yes     | Yes (PR #52) | No          | No             |
| **OpenCode**         | Yes     | Yes (PR #52) | No          | No             |
| **Claude Code CLI**  | Yes     | No         | No            | No             |

### Skills & Plugin Loading

| Provider | Skill System | Storage | Loaded During Execution? | Loaded During Chat? |
|----------|-------------|---------|--------------------------|---------------------|
| **Claude SDK** | `settingSources: ['user','project','local']` + `Skill` tool | `~/.claude/skills/` | **Yes** (full path) | **Yes** (chat path loads settingSources + Skill) |
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

## 8. Comprehensive Pathway Summary

| # | Pathway | Class | Turns | Provider | Skills | Backend Skills | Stored in DB | Model Control |
|---|---------|-------|-------|----------|--------|---------------|-------------|---------------|
| 1 | Task Execution | A | Multi | All 5 | Yes | Yes | streaming_events + taskExecutions + planNodes | User override |
| 2 | Playground | A | Multi | All 5 | Yes | Yes | streaming_events + taskExecutions | User override |
| 3 | Interactive Plan | A | Multi | All 5 | Yes | Yes | streaming_events | User override |
| 4 | HPC/Slurm | A | Multi | SDK only | Yes | Yes (HPC) | streaming_events + taskExecutions | User override |
| 5 | Plan Generation | B | Multi | All 5 | Server-side only | Yes | streaming_events | User override |
| 6 | Project Chat | B | Multi | All 5 | Yes | Yes | streaming_events | User override |
| 7 | Plan Chat | B | Multi | All 5 | Yes | Yes | streaming_events | Default Haiku |
| 8 | Task Chat | B | Multi | All 5 | Yes | Yes | streaming_events | User override |
| 9 | Compact | B | 1 | All 5 | No | No | streaming_events | Bug: discarded |
| 10 | Summary | C | 1 | All 5 | No | No | **None** | Agent default |
| 11 | Title Gen | C | 1 | All 5 | No | No | **None** | Agent default |
| 12 | Refine | C | 1 | All 5 | No | No | **None** | Agent default |
| 13 | Labels | C | 1 | All 5 | No | No | **None** | Agent default |
| 14 | Steering | D | 0 | N/A | N/A | N/A | streaming_events (steer_message) | N/A |
| 15 | Plan Retry | E | 1 | Anthropic only | No | No | streaming_events (plan_result) | Haiku 4.5 |
| 16 | Server Summary | E | 1 | Anthropic only | No | No | **None** | Haiku 3 |

---

## 9. Identified Gaps and Recommendations

### GAP-1: Claude SDK Chat Missing Skills -- FIXED (PR #52)

### GAP-2: OpenClaw Missing Resume/Steer -- FIXED (PR #52)

### GAP-3: OpenCode Missing Resume/Steer -- FIXED (PR #52)

### GAP-4: Submodule Behind

**Fix:** Update submodule pointer to latest `main` after PRs merge.

### GAP-5: Server-Side Summary Uses Outdated Model

**Location:** `packages/core/src/dispatch/summary-utils.ts:489`

**Problem:** Uses `claude-3-haiku-20240307` while plan extraction retry uses `claude-haiku-4-5-20251001`.

**Fix:** Update to `claude-haiku-4-5-20251001`.

### GAP-6: One-Shot Pathways Have Zero Observability

**Location:** `executeViaRelay()` in `server/routes/agent.ts:350`

**Problem:** Pathways 10-13 (Summary, Title, Refine, Labels) produce no persisted data. No cost tracking, no audit trail, no debugging capability. If these are called frequently, untracked costs accumulate silently.

**Fix:** Add lightweight metrics logging -- at minimum: task type, duration, input/output token counts, model, success/failure. Could be a separate `ai_metrics` table or appended to an existing observability table.

### GAP-7: Compact Ignores Model Parameter

**Location:** `server/routes/agent.ts:905-946`

**Problem:** `/compact` endpoint accepts `model` and `providerId` in the request body but never passes them to `streamChatViaRelay()`.

**Fix:** Either pass `model` to `streamChatViaRelay()` or remove the unused parameters from the schema.

### GAP-8: Direct API Calls Require Anthropic API Key

**Location:** Pathways 15 and 16

**Problem:** These call the Anthropic API directly using `process.env.ANTHROPIC_API_KEY`. If the server doesn't have this key (e.g., using only Codex or OpenClaw), these fallbacks silently fail. This is acceptable for pathway 16 (5-layer fallback chain), but pathway 15 means plan extraction retry won't work without an Anthropic key even if the plan was generated by a different provider.

**Recommendation:** Consider routing plan extraction retry through the relay (using the same provider that generated the plan) instead of hardcoding Anthropic.

---

## 10. Provider Skill Systems Reference

### Claude Agent SDK
- **Mechanism:** `settingSources: ['user', 'project', 'local']` in query options
- **What it loads:** `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, `~/.claude/skills/*/SKILL.md`, project `.claude/` dir
- **Tool:** `'Skill'` must be in `allowedTools` for dynamic skill invocation
- **MCP:** Loaded separately via `mcpServers` option in query

### Codex CLI
- **Mechanism:** Native skill discovery at startup. Scans `~/.codex/skills/` for `SKILL.md` files.
- **Feature flags:** Skills graduated to stable (no flag needed).
- **System skills:** `~/.codex/skills/.system/` contains `skill-creator` and `skill-installer`.

### OpenCode CLI
- **Mechanism:** Reads Claude's `.claude/skills/` directory by default (Claude-compatible).
- **Env vars:** `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` to block, `OPENCODE_DISABLE_CLAUDE_CODE` to block all `.claude/` reading.

### OpenClaw CLI
- **Mechanism:** Workspace-scoped skill system. `openclaw skills list/info/check` CLI commands.
- **Bundled skills:** Shipped with the CLI, eligibility-gated by platform requirements.
- **User skills:** Managed skills directory, separate from Claude's.

---

## 11. File Reference

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
