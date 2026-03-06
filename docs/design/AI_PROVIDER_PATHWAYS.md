# AI Provider Pathways

How AI providers (Claude Agent SDK, Codex, OpenClaw, OpenCode) are used across all Astro interaction modes. This is the canonical reference for understanding where providers are invoked, what capabilities they have, what prompts/skills they receive, and what data they produce.

**Last updated:** 2026-03-05

---

## 1. Pathway Classification

Astro has **11 provider-agnostic pathways** where an AI model is invoked. All pathways route through the relay server to the agent runner — there are no direct API calls from the server process. Every pathway supports all registered AI providers.

### Class A: Agentic (multi-turn, tools, files, long-running)

Full agentic sessions. The AI reads/writes files, runs commands, iterates across turns, and may take minutes to complete. They require a working directory, skills, and compute environment context.

| # | Pathway | API Endpoint | Workflow |
|---|---------|--------------|----------|
| 1 | **Task Execution** | `POST /api/dispatch/task` | Dispatch -> Agent session -> tool loop -> result -> PR/push/branch |
| 2 | **Playground** | `POST /api/dispatch/task` | Same as #1 but ephemeral project, supports steering for follow-ups |
| 3 | **Interactive Plan** | `POST /api/dispatch/task` | Dispatch -> Agent session -> brainstorm -> extract plan JSON |
| 4 | **HPC/Slurm Dispatch** | `POST /api/relay/slurm/dispatch` | Dispatch -> Agent session ON HPC machine -> Slurm job submission |

### Class B: Conversational (multi-turn chat, read-only tools)

Chat sessions. The AI can read files but not write. They support multi-turn via message history (5) or adapter-level session resume (6). Used for discussion, plan refinement, and analysis — not execution.

| # | Pathway | API Endpoint | Workflow |
|---|---------|--------------|----------|
| 5 | **Project Chat** | `POST /api/agent/project-chat` | Stream chat about project/plan with read-only tools; handles plan generation follow-ups, rephrasing, re-planning after partial execution |
| 6 | **Task Chat** | `POST /api/agent/task-chat` | Stream chat about task output, supports adapter session resume |

### Class C: One-Shot (single turn, no tools, fire-and-forget)

Simple single-turn completions. No tools, no file access, no skills needed. They go through the relay (`executeViaRelay()`) with `maxTurns: 1` and `type: 'summarize'`. All have graceful fallbacks if the AI call fails.

| # | Pathway | API Endpoint | Fallback if AI fails |
|---|---------|--------------|---------------------|
| 7 | **Task Summary** | `POST /api/agent/summarize` | Truncated execution output |
| 8 | **Title Generation** | `POST /api/agent/generate-title` | First 80 chars of description |
| 9 | **Refine** | `POST /api/agent/refine` | Original title + description unchanged |
| 10 | **Label Suggestion** | `POST /api/agent/suggest-labels` | Empty array `[]` |

### Class D: Control Signal (no AI invocation itself)

| # | Pathway | API Endpoint | What it does |
|---|---------|--------------|-------------|
| 11 | **Steering** | `POST /api/dispatch/steer` | Injects message into running task or resumes completed task |

---

## 2. Changes from Previous Architecture (16 -> 11 Pathways)

### Removed Pathways

| Old # | Pathway | Reason for Removal |
|-------|---------|-------------------|
| P5 | **Plan Generation** (`/api/agent/generate-plan`) | Dead code. `UseTemplateSheet` was never rendered; `startGeneration()` was never called. Backend route had zero UI callers. Removed in PR #648. |
| P6+P7 | **Project Chat** + **Plan Chat** | Merged into single **Project Chat** (`/api/agent/project-chat`). The two routes were functionally identical — same schema, same system prompt builder, same streaming logic. The only difference was the task ID prefix (`chat-` vs `plan-chat-`). |
| P9 | **Compact** (`/api/agent/compact`) | Dead code. Zero callers anywhere — not from frontend, stores, API client, agent-runner, or relay. Context compression is handled internally by provider adapters (Claude SDK has built-in compaction). |
| P15 | **Plan Extraction Retry** | Direct Anthropic API call (`plan-extraction-retry.ts`). Called `claude-haiku-4-5-20251001` directly, bypassing the relay. Required `ANTHROPIC_API_KEY` on the server, breaking provider-agnosticism. Plan extraction now relies on regex (`extractPlanJsonFromText`) which succeeds in the common case; if regex fails, the plan generation is surfaced as an error to the user rather than silently retrying with a hardcoded provider. |
| P16 | **Server-Side Summary** | Direct Anthropic API call (`summary-utils.ts:generateServerSideSummary()`). Layer 3 of the PR summary fallback chain. Used outdated `claude-3-haiku-20240307`. Removal is safe because Layer 4 (git diff summary) and Layer 5 (task description) always succeed — no AI needed for acceptable PR body generation. |

### Key Principle: All Pathways Are Provider-Agnostic

Every remaining pathway routes through the relay to the agent runner, which selects the appropriate provider adapter. There are **zero direct Anthropic API calls** from the server process. This means:

- Any registered AI provider (Claude SDK, Codex, OpenClaw, OpenCode) can serve any pathway
- The user's selected provider at the project level is respected everywhere
- No pathway requires a specific API key on the server

---

## 3. Prompt and Skill Injection per Pathway

Each pathway receives a different combination of system prompt content, skills, and context. There are three layers of skill/context injection:

1. **Pathway-specific prompt** — The system prompt template unique to each pathway type (see per-pathway details below)
2. **Provider skills** — Loaded by the adapter itself (settingSources for Claude SDK, native loading for CLI providers). Includes `~/.claude/skills/`, `~/.codex/skills/`, and project `.claude/` directories. These are loaded by the agent runner, not the server.
3. **Compute backend skills** — Injected server-side into the system prompt by `skillManager.getBackendScopedSkillInjection()`. Filtered by the project's `computeBackends` setting. Format: `<skills><skill name="astro/{name}">{instructions}</skill></skills>`. Users can customize these per compute backend (e.g., conda environment setup for `direct`, module loads for `slurm`, kubectl context for `k8s-exec`). All environment-specific context (virtual environments, dependencies, SSH details, module loads) should be authored as compute backend skills — there is no separate "environment context" layer.

> **Note on `environmentConfigs` table:** A legacy `environment_configs` table exists with per-backend `customContext` free-text fields, loaded by `loadEnvironmentContext()`. This overlaps with compute backend skills and is superseded by the skill system. Users should put environment details (conda envs, module loads, etc.) into their compute backend skill documents instead.

### P1-2: Task Execution / Playground

**Prompt builder:** Ad-hoc assembly in `dispatch.ts` (no single template function)

**System prompt contents:**
- Vision document (if set on project)
- Project knowledge entries (capped at 8K chars, most recent first)
- Dependency outputs (completed upstream task results: titles, PR URLs, branch names, output text)
- Workspace delivery mode instructions (PR creation, branch strategy, worktree layout)
- "Push to GitHub" special instructions (if title matches push pattern)
- Acceptance criteria
- Executive summary format expectations

**Skills injected:**
- Provider skills: **Yes** — adapter loads `settingSources` or native skills
- Compute backend skills: **Yes** — `getBackendScopedSkillInjection(teamId, backends)`

**Relay dispatch type:** `undefined` (defaults to `'execution'`)

### P3: Interactive Plan

**Prompt builder:** `buildInteractivePlanPrompt(description, options)` in `packages/core/src/prompt-templates.ts`

**System prompt contents:**
- Planning instructions + JSON schema constraints for plan output
- Vision document
- Repo context: CLAUDE.md, README.md, package.json, file tree
- Git state: current branch, target branch, dirty status
- Skills summary (readable text, not XML)
- GitHub context: repo URL, owner
- Replan context: lessons from prior plan execution (if re-planning)

**Skills injected:**
- Provider skills: **Yes** — adapter loads `settingSources`
- Compute backend skills: **Optional** — injected as readable skills summary

**Relay dispatch type:** `'plan'`

### P5: Project Chat

**Prompt builder:** `buildChatSystemPrompt(visionDoc, planNodes, planEdges, skillsInjection, envContext)` in `packages/core/src/prompt-templates.ts`

**System prompt contents:**
- Conversational planning instructions
- Vision document (wrapped in `<user_vision>` delimiters)
- Plan nodes list with metadata (title, status, priority, estimate, verification, milestone, dependencies)
- Available milestones reference
- Current edges/dependencies
- Skills injection XML
- Compute environment context

**Skills injected:**
- Provider skills: **Yes** — settingSources + `Skill` tool in allowedTools
- Compute backend skills: **Yes** — `getBackendScopedSkillInjection(teamId, backends)`

**Relay dispatch type:** `'chat'`

**Covers:** Plan discussion, plan regeneration, task rephrasing, re-planning after partial execution (keeping finished nodes, changing the rest)

### P6: Task Chat

**Prompt builder:** `buildTaskChatSystemPrompt(context: TaskChatContext)` in `packages/core/src/prompt-templates.ts`

**System prompt contents:**
- Task-focused conversation instructions
- Vision document (wrapped in `<user_vision>`)
- Current task details: title, description (wrapped in `<user_task>`)
- Task execution output (wrapped in `<agent_output>`, truncated to 10K chars)
- Resumed session context: worktree cleanup note, branch name, PR URL
- Skills injection XML
- Compute environment context

**Skills injected:**
- Provider skills: **Yes** — settingSources + `Skill` tool
- Compute backend skills: **Yes** — `getBackendScopedSkillInjection(teamId, backends)`

**Relay dispatch type:** `'chat'`

### P7: Task Summary

**Prompt builder:** `buildSummaryPrompt(context)` in `packages/core/src/prompt-templates.ts`

**System prompt contents:**
- Summarization instructions
- Task title and description
- Last 15K chars of execution output
- File changes list
- Status (success/failure)

**Expected output:** JSON with `workCompleted`, `keyFindings`, `filesChanged`, `status`, `followUps`

**Skills injected:** None.
**Relay dispatch type:** `'summarize'` | **Max turns:** 1

### P8: Title Generation

**Prompt builder:** `buildTitleGenerationPrompt(description)` in `packages/core/src/prompt-templates.ts`

**System prompt contents:**
- Title generation instructions
- Task description

**Expected output:** Plain text title (max 80 chars)

**Skills injected:** None.
**Relay dispatch type:** `'summarize'` | **Max turns:** 1

### P9: Refine

**Prompt builder:** `buildRefinementPrompt(input: RefinementInput)` in `packages/core/src/prompt-templates.ts`

**System prompt contents:**
- Refinement instructions (imperative form, markdown formatting rules)
- Original title and description
- Context type (`'task'` or `'project'`)

**Expected output:** JSON with `refinedTitle`, `refinedDescription`, optional `clarification`, `confidence`

**Skills injected:** None.
**Relay dispatch type:** `'summarize'` | **Max turns:** 1

### P10: Label Suggestion

**Prompt builder:** `buildLabelSuggestionPrompt(title, description)` in `packages/core/src/prompt-templates.ts`

**System prompt contents:**
- Classification instructions
- Task title and description
- Label options (l1-l5: Frontend, Backend, Testing, Infrastructure, Research)

**Expected output:** JSON with `labelIds` array

**Skills injected:** None.
**Relay dispatch type:** `'summarize'` | **Max turns:** 1

### Skill Injection Summary

| # | Pathway | System Prompt Template | Provider Skills | Backend Skills | Relay Type |
|---|---------|----------------------|----------------|---------------|------------|
| 1-2 | Execution/Playground | Ad-hoc (dispatch.ts) | Yes | Yes | (default) |
| 3 | Interactive Plan | `buildInteractivePlanPrompt()` | Yes | Optional | `'plan'` |
| 4 | HPC/Slurm | Ad-hoc (dispatch.ts) | Yes | Yes (HPC) | (default) |
| 5 | Project Chat | `buildChatSystemPrompt()` | Yes | Yes | `'chat'` |
| 6 | Task Chat | `buildTaskChatSystemPrompt()` | Yes | Yes | `'chat'` |
| 7 | Summary | `buildSummaryPrompt()` | No | No | `'summarize'` |
| 8 | Title Gen | `buildTitleGenerationPrompt()` | No | No | `'summarize'` |
| 9 | Refine | `buildRefinementPrompt()` | No | No | `'summarize'` |
| 10 | Labels | `buildLabelSuggestionPrompt()` | No | No | `'summarize'` |
| 11 | Steering | N/A | N/A | N/A | N/A |

---

## 4. Data Storage and Observability

### Database Tables

Three tables store AI pathway outputs:

**`streaming_events`** — Append-only event log for SSE catch-up on reconnection.

| Column | Type | Purpose |
|--------|------|---------|
| `seq` | integer (PK, auto-increment) | Sequence number for ordering and catch-up |
| `executionId` | text | Routing key linking events to a task/stream |
| `eventType` | text | Event type (see below) |
| `data` | jsonb | Event-specific structured data |
| `createdAt` | timestamp | When event was inserted |

**Event types stored:** `text`, `tool_use`, `tool_result`, `file_change`, `session_init`, `progress`, `result`, `error`, `approval_request`, `approval_response`, `safety_prompt`, `safety_response`, `steer_message`, `plan_result`, `init`

**`taskExecutions`** — Execution results and metrics.

| Column | Type | Purpose |
|--------|------|---------|
| `executionId` | text (unique) | Routing key |
| `nodeClientId` | text | Plan node this execution belongs to |
| `projectId` | uuid (FK) | Project reference |
| `status` | text | `'pending' | 'running' | 'success' | 'failure' | 'cancelled'` |
| `streamText` | text | All concatenated text output |
| `error` | text | Error message if failed |
| `sessionId` | text | Relay/SDK session ID |
| `machineId` | text | Which machine ran the task |
| `providerId` | text | Provider type used |
| `model` | text | LLM model used |
| `durationMs` | integer | Total execution duration |
| `inputTokens` | integer | Input tokens consumed |
| `outputTokens` | integer | Output tokens produced |
| `tokensUsed` | integer | Total tokens |
| `estimatedCostUsd` | real | Estimated cost in USD |
| `turnsUsed` | integer | Number of conversational turns |
| `markdownSummary` | text | Generated markdown summary |

**`observationEvents`** — Structured observability traces (for Langfuse export, safety rails, usage tracking).

| Column | Type | Purpose |
|--------|------|---------|
| `id` | text (PK) | Time-prefixed UUID |
| `traceId` | text | Links to executionId (many observations per execution) |
| `parentObservationId` | text | Parent for nested tool calls |
| `type` | text | `'generation' | 'tool' | 'event' | 'span'` |
| `name` | text | e.g., `'generation:turn-0'`, `'tool:bash'`, `'task:completed'` |
| `input` | jsonb | Structured input |
| `output` | jsonb | Structured output |
| `model` | text | Model used |
| `inputTokens` | integer | Tokens consumed |
| `outputTokens` | integer | Tokens produced |
| `estimatedCostUsd` | real | Cost for this observation |
| `metadata` | jsonb | turnIndex, sessionId, toolUseId, etc. |

### What Gets Stored per Pathway

| # | Pathway | `streaming_events` | `taskExecutions` | `observationEvents` | System prompt stored? | User message stored? | AI response stored? | Tool traces stored? | Costs tracked? |
|---|---------|-------------------|------------------|--------------------|--------------------|--------------------|--------------------|-------------------|---------------|
| 1-2 | Execution | **Yes** — all event types | **Yes** — full metrics | **Yes** — turn-based traces | **No** (gap!) | N/A (task prompt) | **Yes** (text events) | **Yes** (tool_use + tool_result) | **Yes** |
| 3 | Interactive Plan | **Yes** — text, tool_use, tool_result, plan_result | **Yes** | **Yes** | **No** (gap!) | N/A (task prompt) | **Yes** | **Yes** | **Yes** |
| 4 | HPC/Slurm | **Yes** — same as P1 | **Yes** | **Yes** | **No** (gap!) | N/A | **Yes** | **Yes** | **Yes** |
| 5 | Project Chat | **Yes** — text, tool_use, tool_result, session_init, steer_message | **No** | **No** | **No** (gap!) | **Partial** (steer_message per turn, but conversation history not stored) | **Yes** (text) | **Yes** (tool_use + tool_result) | **No** (gap!) |
| 6 | Task Chat | **Yes** — same as P5 | **No** | **No** | **No** (gap!) | **Partial** (same as P5) | **Yes** (text) | **Yes** (tool_use + tool_result) | **No** (gap!) |
| 7 | Summary | **No** | **No** | **No** | **No** | N/A | **No** | N/A | **No** |
| 8 | Title Gen | **No** | **No** | **No** | **No** | N/A | **No** | N/A | **No** |
| 9 | Refine | **No** | **No** | **No** | **No** | N/A | **No** | N/A | **No** |
| 10 | Labels | **No** | **No** | **No** | **No** | N/A | **No** | N/A | **No** |
| 11 | Steering | **Yes** (steer_message only) | **No** | **No** | N/A | **Yes** | N/A | N/A | **No** |

### Pathway Type Tagging

**Currently, `streaming_events` has no explicit pathway type column.** The pathway type is only implicitly encoded in the `executionId` prefix:
- Execution: `{executionId}` (UUID-based)
- Project Chat: `chat-{projectId}-{timestamp}`
- Plan Chat: `plan-chat-{projectId}-{timestamp}`
- Task Chat: `task-chat-{nodeId}-{timestamp}`
- Interactive Plan: `{executionId}` (same as execution, indistinguishable)

This makes it impossible to query "show me all project chat sessions" or "show me all task executions" without parsing the executionId string. Each pathway should have an explicit `pathwayType` field (or equivalent) in its events so trajectories can be queried by type.

### Event Persistence Flow

**Class A (Execution) — Full persistence pipeline:**

```
Agent Runner streams events
        |
        v
  streamingEventLog (server/lib/streaming-event-log.ts)
  +-- onText -> appendText() -> [buffered in memory]
  +-- onToolTrace -> append('tool_use') + append('tool_result')
  +-- onFileChange -> append('file_change')
  +-- onSessionInit -> append('session_init', {sessionId, model})
  +-- onProgress -> append('progress')
  +-- onResult -> flushText() + append('result')
  +-- Heartbeat (every 15s) -> flushText() to DB
        |
        v
  streaming_events table (seq-indexed, append-only)
        |
        v
  executionEventBus -> observationCollector
  +-- Groups text + tools into "generation turns"
  +-- Batch flushes to observationEvents (50 events or 5s)
  +-- On completion: generates markdownSummary
        |
        v
  taskExecutions table (final metrics: tokens, cost, duration, model)
```

**Class B (Chat) — Partial persistence:**

```
Agent Runner streams events
        |
        v
  streamingEventLog
  +-- onText -> appendText() -> [buffered, flushed at tool boundaries]
  +-- onToolTrace -> append('tool_use') + append('tool_result')
  +-- onSessionInit -> append('session_init')
  +-- onResult -> append('result')
  +-- User messages: append('steer_message')
        |
        v
  streaming_events table (queryable via streamId after refresh)
        |
        X  NO observationEvents, NO taskExecutions, NO cost tracking
```

**Class C (One-Shot) — Zero persistence:**

```
executeViaRelay()
  +-- Waits for onText + onResult synchronously
  +-- Returns JSON to caller
  +-- Result used immediately, then discarded
        |
        X  NO streaming_events, NO taskExecutions, NO observationEvents
        X  No cost, no tokens, no model, no audit trail
```

### Trajectory Storage Gaps

The current system stores AI *output* (text, tool traces) but not *input* (system prompts, full conversation context). This makes it impossible to replay or audit what the AI was told.

**GAP-TRAJ-1: System prompts are never stored.**
For ALL pathways (execution, chat, one-shot), the system prompt is built server-side and sent to the relay, but never persisted to `streaming_events`, `taskExecutions`, or `observationEvents`. This includes:
- Vision doc injection
- Skills injection (compute backend skills)
- Dependency context (upstream task outputs)
- Workspace/delivery mode instructions

**Impact:** Cannot audit what instructions the AI received. Cannot replay a session. Cannot debug why the AI did something wrong — the "why" context is lost.

**Fix:** Persist the full system prompt as an `init` or `system_prompt` event in `streaming_events` at the start of each pathway. For executions, also store it in `taskExecutions` or `observationEvents`.

**GAP-TRAJ-2: Chat conversation history not durably stored.**
For project chat (P5) and task chat (P6), each user message gets a `steer_message` event, but:
- The conversation history (`messages` array from request body) is NOT stored
- On multi-turn conversations, only the latest user message is persisted, not the full context window
- After page refresh, reconstructing the conversation requires parsing interleaved `steer_message` + `text` events

**Fix:** Store the full conversation session as a first-class entity. Each chat session should have an `init` event recording the pathway type, project context, and initial message, then subsequent turns as paired user/assistant events.

**GAP-TRAJ-3: No pathway type tagging on events.**
`streaming_events` has no column distinguishing pathway types. Execution events and interactive plan events share the same `executionId` format and are indistinguishable. Chat pathways rely on ID prefix conventions (`chat-`, `plan-chat-`, `task-chat-`) which are fragile.

**Fix:** Add a `pathwayType` field to the init event of each streaming session: `'execution' | 'interactive-plan' | 'project-chat' | 'task-chat' | 'summarize' | 'title-gen' | 'refine' | 'labels'`.

**GAP-TRAJ-4: Chat pathways (P5, P6) have no cost tracking.**
User/AI messages are stored in `streaming_events`, but there's no `taskExecutions` record and no `observationEvents` trace. Token counts, cost, model used, and turn counts are lost.

**Fix:** Create a `taskExecutions` record (or lighter-weight `ai_metrics` record) for each chat session. Extract metrics from the `result` event.

**GAP-TRAJ-5: One-shot pathways (P7-P10) have ZERO observability.**
`executeViaRelay()` produces no persisted data. No way to audit call frequency, cost, failures.

**Fix:** Add lightweight persistence — log pathway type, input length, output length, model, duration, success/failure.

### Recommendations Summary

| Gap | What's Missing | Priority | Fix |
|-----|---------------|----------|-----|
| TRAJ-1 | System prompts | **High** | Persist as `system_prompt` event at session start |
| TRAJ-2 | Full conversation history | **High** | Store conversation session as first-class entity |
| TRAJ-3 | Pathway type tagging | **Medium** | Add `pathwayType` to init event |
| TRAJ-4 | Chat cost tracking | **Medium** | Create `taskExecutions` record for chat sessions |
| TRAJ-5 | One-shot observability | **Low** | Add lightweight metrics logging |

---

## 5. Workflow Diagrams

### Class A: Agentic Workflow (Pathways 1-4)

```
User clicks "Execute"
        |
        v
  +---------------------------------+
  |   Astro Server                  |
  |   routes/dispatch.ts            |
  |                                 |
  |  1. Build system prompt         |
  |     - vision doc                |
  |     - skills (backend-scoped)   |
  |     - env context               |
  |     - dependency outputs        |
  |  2. Select machine              |
  |  3. Read project providerId     |
  |  4. dispatchViaRelay()          |
  +--------+------------------------+
           | WebSocket
           v
  +---------------------------------+
  |   Agent Runner                  |
  |   task-executor.ts              |
  |                                 |
  |  1. Select adapter by           |
  |     preferredProvider            |
  |  2. adapter.execute()           |
  |                                 |
  |  +---------------------------+  |
  |  |  Agent Loop (multi-turn)  |  |
  |  |                           |  |
  |  |  LLM -> tool_use ->      |  |
  |  |  tool_result -> LLM      |  |
  |  |  -> tool_use -> ...      |  |
  |  |                           |  |
  |  |  Skills loaded by adapter |  |
  |  +---------------------------+  |
  |                                 |
  |  Stream events back:            |
  |  text, tool_use,                |
  |  tool_result, file_change       |
  +--------+------------------------+
           |
           v
  +---------------------------------+
  |  SSE -> Frontend                |
  |  + streaming_events DB          |
  |  + observationEvents DB         |
  |  + taskExecutions DB            |
  |  + planNodes DB                 |
  +---------------------------------+
```

### Class B: Chat Workflow (Pathways 5-6)

```
User sends message
        |
        v
  +---------------------------------+
  |   Astro Server                  |
  |   routes/agent.ts               |
  |                                 |
  |  1. Build system prompt         |
  |     (vision doc, plan context,  |
  |      skills, env context)       |
  |  2. Read project providerId     |
  |  3. Store user message as       |
  |     steer_message event         |
  |  4. streamChatViaRelay()        |
  +--------+------------------------+
           | WebSocket
           v
  +---------------------------------+
  |   Agent Runner                  |
  |   runTextOnlyQuery()            |
  |                                 |
  |  - Provider selected by         |
  |    preferredProvider             |
  |  - Read-only tools              |
  |    [Read, Grep, Glob,           |
  |     WebSearch, WebFetch, Skill] |
  |  - settingSources loaded        |
  |  - maxTurns: 10 (default)       |
  |                                 |
  |  No file writes,                |
  |  no command execution           |
  +--------+------------------------+
           |
           v
  +---------------------------------+
  |  SSE -> Frontend                |
  |  + streaming_events DB          |
  |  (NO taskExecutions)            |
  |  (NO observationEvents)         |
  |  (NO cost tracking -- gap!)     |
  +---------------------------------+
```

### Class C: One-Shot Workflow (Pathways 7-10)

```
Server needs summary/title/labels
        |
        v
  +---------------------------------+
  |   executeViaRelay()             |
  |                                 |
  |  - maxTurns: 1                  |
  |  - type: 'summarize'           |
  |  - No tools                     |
  |  - No skills                    |
  |  - No streaming to client       |
  |  - 120s timeout                 |
  |  - Provider from project        |
  +--------+------------------------+
           | WebSocket
           v
  +---------------------------------+
  |  Agent Runner                   |
  |  runTextOnlyQuery()             |
  |  - Provider selected by         |
  |    preferredProvider             |
  |  - No tools                     |
  |  - No settingSources            |
  |  - json_schema output           |
  |  - Single completion            |
  +--------+------------------------+
           |
           v
  +---------------------------------+
  |  JSON response to caller        |
  |  (NOT persisted to ANY DB)      |
  |  Falls back on failure          |
  +---------------------------------+
```

---

## 6. Provider Selection Flow

All pathways share the same provider resolution logic:

```
1. User selects provider in project settings (stored as project.providerId)
2. Some pathways allow per-request override (model param in chat endpoints)
3. Server passes preferredProvider to relay TaskDispatch
4. Agent runner selects adapter:
   - If preferredProvider specified -> use that adapter
   - Else -> use agent runner's default adapter
5. Adapter uses its own default model unless overridden
```

**No hardcoded model IDs on the server.** The server never specifies model IDs like `claude-haiku-4-5-20251001`. Model selection is the adapter's responsibility. Each adapter knows its own default model.

### Provider Threading

`providerId` flows through the system as `preferredProvider` on `TaskDispatch`:

| Component | Field | Purpose |
|-----------|-------|---------|
| Frontend | `providerId` in API params | User's selected provider |
| Server | `preferredProvider` on `TaskDispatch` | Routes to correct adapter |
| Agent Runner | `task.preferredProvider` | Selects adapter in `task-executor.ts` |
| Adapter | Internal model defaults | Each adapter knows its models |

---

## 7. Answering Key Questions

### Q: Why was Plan Chat merged into Project Chat?

The `/api/agent/chat` and `/api/agent/plan-chat` routes were **functionally identical**: same Zod schema, same `buildChatSystemPrompt()` call, same `streamChatViaRelay()` invocation. The only difference was the task ID prefix (`chat-` vs `plan-chat-`). This distinction served no purpose — both were conversations about the project/plan with read-only tools.

**Project Chat** now covers all conversational interactions with the plan:
- Discussing the plan after generation
- Asking the model to regenerate parts of the plan
- Rephrasing tasks
- Re-planning after partial execution (keeping finished nodes, changing the rest)

### Q: Why were direct API calls (P15, P16) removed?

1. **Provider lock-in**: They hardcoded Anthropic API calls, meaning they only worked if the server had `ANTHROPIC_API_KEY`. Users running Codex, OpenClaw, or OpenCode got silent failures.
2. **Outdated models**: P16 used `claude-3-haiku-20240307`, which was a year outdated.
3. **Unnecessary**: P15's plan extraction retry was a band-aid for rare regex failures — better to surface the error. P16 was Layer 3 of a 5-layer fallback chain where Layers 4+5 always succeed.
4. **Architecture violation**: Every other pathway routes through relay -> agent runner -> adapter. Direct API calls were the only exception, creating an inconsistency that required special configuration.

### Q: Why does Pathway 4 (HPC/Slurm) need a language model?

The AI doesn't run ON the HPC cluster. The AI runs on the **agent-runner machine** that has access to the Slurm cluster:

```
Agent Runner (has AI provider installed)
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

The `hpcCapability` flag means: "this machine has Slurm tools installed and can submit jobs to a cluster." It's auto-detected when the agent-runner starts.

### Q: Which pathways are one-shot vs multi-step?

| Pathway | Turns | Workflow Complexity |
|---------|-------|---------------------|
| **1-4** (Execution) | Multi-turn (10-100+) | Full agent loop: think -> tool -> result -> think -> ... |
| **5** (Project Chat) | Multi-turn (1-10) | Conversational, may read files, parses plan mutations |
| **6** (Task Chat) | Multi-turn (1-10) | Conversational, may read files, session resume |
| **7** (Summary) | **1 turn** | Single structured extraction |
| **8** (Title Gen) | **1 turn** | Single text generation |
| **9** (Refine) | **1 turn** | Single structured generation |
| **10** (Labels) | **1 turn** | Single classification |
| **11** (Steering) | **0 turns** (control signal) | Injects message, no AI invocation |

---

## 8. Data Flow Architecture

```
+-----------------+     +----------------------------------------------------------+
|  Frontend       |     |  Astro Server                                            |
|                 |     |                                                          |
|  api-client     |---->|  routes/agent.ts                                         |
|  stores         |     |  +-- /project-chat ---> streamChatViaRelay() ----------+ |
|                 |     |  +-- /task-chat -------> streamChatViaRelay() ---------+| |
|                 |     |  +-- /summarize -------> executeViaRelay() -----------+| |
|                 |     |  +-- /generate-title --> executeViaRelay() ----------+|| |
|                 |     |  +-- /refine ----------> executeViaRelay() ---------+||| |
|                 |     |  +-- /suggest-labels --> executeViaRelay() --------+|||| |
|                 |     |                                                   ||||| |
|                 |     |  routes/dispatch.ts                               ||||| |
|                 |---->|  +-- /task ------------> dispatchViaRelay() ------+||||| |
|                 |     |  +-- /steer -----------> relayServer.steerTask() +||||| |
|                 |     |                                                  ||||||  |
|                 |     |  routes/relay.ts                                 ||||||  |
|                 |---->|  +-- /slurm/dispatch --> relayServer.dispatch() -+||||||  |
|                 |     |                                                  ||||||  |
|                 |     |  All paths carry preferredProvider from project   ||||||  |
|                 |     +-------------------------+----------------------------+  |
+-----------------+                               |                               |
                                                  | WebSocket                     |
                                            +-----v-----------------------+       |
                                            |  Agent Runner               |       |
                                            |                             |       |
                                            |  task-executor.ts           |       |
                                            |  +-- ClaudeSdkAdapter       |       |
                                            |  +-- CodexAdapter           |       |
                                            |  +-- OpenClawAdapter        |       |
                                            |  +-- OpenCodeAdapter        |       |
                                            |  +-- ClaudeCodeAdapter      |       |
                                            |                             |       |
                                            |  Type routing:              |       |
                                            |  execution -> full path     |       |
                                            |  plan -> text-only          |       |
                                            |  chat -> text-only+tools    |       |
                                            |  summarize -> text-only     |       |
                                            +-----------------------------+       |
```

---

## 9. Provider Capabilities Matrix

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

## 10. Comprehensive Pathway Summary

| # | Pathway | Class | Turns | Provider | Skills | Backend Skills | Stored in DB | Cost Tracked? |
|---|---------|-------|-------|----------|--------|---------------|-------------|---------------|
| 1 | Task Execution | A | Multi | All | Yes | Yes | streaming_events + taskExecutions + observationEvents + planNodes | **Yes** |
| 2 | Playground | A | Multi | All | Yes | Yes | streaming_events + taskExecutions + observationEvents | **Yes** |
| 3 | Interactive Plan | A | Multi | All | Yes | Optional | streaming_events + taskExecutions + observationEvents | **Yes** |
| 4 | HPC/Slurm | A | Multi | All | Yes | Yes (HPC) | streaming_events + taskExecutions + observationEvents | **Yes** |
| 5 | Project Chat | B | Multi | All | Yes | Yes | streaming_events only | **No** (gap) |
| 6 | Task Chat | B | Multi | All | Yes | Yes | streaming_events only | **No** (gap) |
| 7 | Summary | C | 1 | All | No | No | **None** | **No** (gap) |
| 8 | Title Gen | C | 1 | All | No | No | **None** | **No** (gap) |
| 9 | Refine | C | 1 | All | No | No | **None** | **No** (gap) |
| 10 | Labels | C | 1 | All | No | No | **None** | **No** (gap) |
| 11 | Steering | D | 0 | N/A | N/A | N/A | streaming_events (steer_message) | N/A |

---

## 11. Identified Gaps and Recommendations

### Trajectory & Observability Gaps

See Section 4 for detailed analysis (GAP-TRAJ-1 through GAP-TRAJ-5). Summary:

| Gap | What's Missing | Priority |
|-----|---------------|----------|
| TRAJ-1 | System prompts never stored for any pathway | **High** |
| TRAJ-2 | Chat conversation history not durably stored | **High** |
| TRAJ-3 | No pathway type tagging on streaming events | **Medium** |
| TRAJ-4 | Chat pathways missing cost/token tracking | **Medium** |
| TRAJ-5 | One-shot pathways have zero observability | **Low** |

### Provider Routing Gaps

### GAP-PROV-1: `providerId` Not Threaded Through Chat Pathways

**Location:** `streamChatViaRelay()` in `server/routes/agent.ts`

**Problem:** Chat endpoints (Project Chat, Task Chat) accept `providerId` in their Zod schema but don't pass it to `RelayTaskDispatch.preferredProvider`. The agent runner uses its default adapter instead of the user's selected provider.

**Fix:** Add `preferredProvider` to the `streamChatViaRelay()` opts type and pass it through to `RelayTaskDispatch`. Same for `executeViaRelay()`.

### GAP-PROV-2: `providerId` Not Threaded Through One-Shot Pathways

**Location:** `executeViaRelay()` in `server/routes/agent.ts`

**Problem:** One-shot pathways (Summary, Title, Refine, Labels) don't read the project's `providerId` or pass `preferredProvider` to the relay dispatch.

**Fix:** Read project's `providerId` and pass as `preferredProvider` on the `TaskDispatch`.

### GAP-PROV-3: Non-Claude Providers Missing Text-Only Path

**Location:** Codex, OpenClaw, OpenCode adapters in `packages/agent-runner/src/providers/`

**Problem:** Only ClaudeSdkAdapter implements `runTextOnlyQuery()`. Other adapters return errors for `type: 'chat'` and `type: 'summarize'` dispatches. This means Pathways 5-10 only work with Claude SDK in practice.

**Recommendation:** Implement `runTextOnlyQuery()` (or equivalent) for Codex, OpenClaw, and OpenCode adapters.

### Legacy Cleanup

### GAP-LEGACY-1: `environmentConfigs` Table Overlaps With Compute Backend Skills

**Location:** `environment_configs` table, `loadEnvironmentContext()` in `server/routes/agent.ts`

**Problem:** The `environmentConfigs` table stores per-backend free-text context (conda env, module loads, SSH details) which is exactly what compute backend skills are for. Two separate systems inject the same kind of content into prompts.

**Recommendation:** Deprecate `loadEnvironmentContext()` and guide users to put environment-specific context into compute backend skill documents instead. Eventually remove the `environmentConfigs` mechanism.

---

## 12. Provider Skill Systems Reference

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

### Backend Skill Tag Mapping

The server filters skills by compute backend using tag matching:

| Backend ID | Matched Tags | Example Skills |
|------------|-------------|----------------|
| `k8s-exec` | `kubernetes`, `k8s` | kubectl exec, pod creation, namespace management |
| `slurm` | `slurm`, `hpc` | sbatch, squeue, module loads |
| `docker` | `docker`, `container` | docker exec, volume mounts |
| `direct` | (none) | No backend-specific skills needed |

Skills without backend tags are **always included** regardless of backend selection. When `computeBackends` is empty/unset, **no backend-specific skills are loaded** (lean default).

---

## 13. File Reference

| Component | Path |
|-----------|------|
| Agent routes (project-chat, task-chat, summary, refine, labels) | `server/routes/agent.ts` |
| Dispatch routes (execution, steer) | `server/routes/dispatch.ts` |
| Relay routes (HPC/Slurm dispatch) | `server/routes/relay.ts` |
| Relay server | `server/lib/relay-server.ts` |
| Relay types (`TaskDispatch`, `TaskDispatchType`) | `server/types/relay.ts` |
| Prompt templates | `packages/core/src/prompt-templates.ts` |
| Summary utilities (PR body fallback chain) | `packages/core/src/dispatch/summary-utils.ts` |
| Skill manager | `server/lib/skill-manager.ts` |
| Skill injector (filtering, backend tags) | `packages/core/src/skill-injector.ts` |
| Streaming event log | `server/lib/streaming-event-log.ts` |
| Observation collector | `server/lib/observability/observation-collector.ts` |
| Streaming event hydrator | `src/lib/streaming-event-hydrator.ts` |
| DB schema (streaming_events, taskExecutions, observationEvents) | `packages/core/src/db/schema.ts` |
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
