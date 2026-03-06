# Observability — Design Document

> **Status: IMPLEMENTED** — Core observability infrastructure is live across all 11 AI pathways.
>
> Related docs: [AI_PROVIDER_PATHWAYS.md](./AI_PROVIDER_PATHWAYS.md), [COST_TRACKING.md](./COST_TRACKING.md), [DATA_MODEL.md](./DATA_MODEL.md)

## 1. Overview

Astro's observability system captures, persists, and surfaces data from every AI interaction. The system answers three questions:

1. **What happened?** — Full trajectory of every AI session (prompts, responses, tool calls, file changes)
2. **What did it cost?** — Token counts, model, duration, and estimated cost per pathway
3. **Can I recover?** — Page refresh, SSE disconnect, and crash resilience via event replay

The system operates across three storage layers, each serving different query patterns:

```
┌─────────────────────────────────────────────────────────────┐
│                     STORAGE LAYERS                          │
├──────────────────┬──────────────────┬───────────────────────┤
│ streaming_events │ taskExecutions   │ observationEvents     │
│ (append-only log)│ (summary record) │ (structured traces)   │
├──────────────────┼──────────────────┼───────────────────────┤
│ SSE catch-up     │ Cost dashboards  │ Trace viewer          │
│ Page refresh     │ Usage metrics    │ Langfuse export       │
│ Activity replay  │ Project totals   │ Turn-level analysis   │
└──────────────────┴──────────────────┴───────────────────────┘
```

## 2. The 11 AI Pathways

Each pathway is classified by its execution model and observability depth:

| # | Pathway | Route | Type | Turns | Streaming | Observability Level |
|---|---------|-------|------|-------|-----------|-------------------|
| P1 | Task Execution | `POST /api/dispatch/task` | Agentic | Multi | SSE | Full |
| P2 | Playground | `POST /api/dispatch/task` | Agentic | Multi | SSE | Full |
| P3 | Interactive Plan | `POST /api/dispatch/task` | Agentic | Multi | SSE | Full |
| P4 | HPC | `POST /api/dispatch/task` | Agentic | Multi | SSE | Full |
| P5 | Project Chat | `POST /api/agent/project-chat` | Chat | Multi | SSE | Standard |
| P6 | Task Chat | `POST /api/agent/task-chat` | Chat | Multi | SSE | Standard |
| P7 | Summarize | `POST /api/agent/summarize` | One-shot | 1 | JSON | Minimal |
| P8 | Title Gen | `POST /api/agent/generate-title` | One-shot | 1 | JSON | Minimal |
| P9 | Refine | `POST /api/agent/refine` | One-shot | 1 | JSON | Minimal |
| P10 | Label Suggest | `POST /api/agent/suggest-labels` | One-shot | 1 | JSON | Minimal |
| P11 | Abort | `POST /api/agent/abort` | Steering | 0 | JSON | None |

**Observability levels:**
- **Full** — init event, session_init, per-turn text/tool/file events, result with metrics, taskExecutions record, observation traces (turn-level generations), Langfuse export
- **Standard** — init event, steer_message, text/tool events, result with metrics, taskExecutions record, metrics in SSE done event
- **Minimal** — init event, result event (stored in streaming_events for trajectory), no SSE stream
- **None** — No AI invocation, no events stored

## 3. Data Flow Diagrams

### 3.1 Agentic Pathways (P1–P4): Full Observability

```
Browser                    Hono Backend                 Relay              Agent Runner
  │                            │                          │                     │
  │  POST /api/dispatch/task   │                          │                     │
  ├───────────────────────────►│                          │                     │
  │                            │                          │                     │
  │                            │ ┌──────────────────────┐ │                     │
  │                            │ │ Build system prompt   │ │                     │
  │                            │ │ + vision doc          │ │                     │
  │                            │ │ + dependency outputs  │ │                     │
  │                            │ │ + skills injection    │ │                     │
  │                            │ └──────────┬───────────┘ │                     │
  │                            │            │             │                     │
  │                            │ ┌──────────▼───────────┐ │                     │
  │                            │ │ Persist init event    │ │                     │
  │                            │ │ streaming_events:     │ │                     │
  │                            │ │  pathwayType          │ │                     │
  │                            │ │  systemPrompt         │ │                     │
  │                            │ │  model, providerId    │ │                     │
  │                            │ │  machineId            │ │                     │
  │                            │ └──────────┬───────────┘ │                     │
  │                            │            │             │                     │
  │                            │  dispatch ─┼────────────►│  dispatch ─────────►│
  │                            │            │             │                     │
  │◄────── SSE: init ─────────│            │             │                     │
  │                            │            │             │                     │
  │                            │◄───────────┼── session_init ──────────────────│
  │◄── SSE: session_init ─────│            │             │                     │
  │                            │ persist ───┤             │                     │
  │                            │            │             │                     │
  │                            │◄───────────┼──── text ───┼────────────────────│
  │◄────── SSE: text ─────────│            │             │  (buffered, flushed │
  │                            │ appendText─┤             │   on structural evt)│
  │                            │            │             │                     │
  │                            │◄───────────┼── tool_use ─┼────────────────────│
  │◄──── SSE: tool_use ───────│            │             │                     │
  │                            │ persist ───┤             │                     │
  │                            │ eventBus ──┤             │                     │
  │                            │            │             │                     │
  │                            │◄───────────┼─ tool_result┼────────────────────│
  │◄──── SSE: tool_result ────│            │             │                     │
  │                            │ persist ───┤             │                     │
  │                            │ eventBus ──┤             │                     │
  │                            │            │             │                     │
  │                            │◄───────────┼─file_change─┼────────────────────│
  │◄── SSE: file_change ──────│            │             │                     │
  │                            │ persist ───┤             │                     │
  │                            │            │             │                     │
  │                            │◄───────────┼── result ───┼────────────────────│
  │                            │            │             │                     │
  │                            │ ┌──────────▼───────────┐ │                     │
  │                            │ │ Persist result event  │ │                     │
  │                            │ │  status, metrics      │ │                     │
  │                            │ │                       │ │                     │
  │                            │ │ Create taskExecutions │ │                     │
  │                            │ │  executionId          │ │                     │
  │                            │ │  tokens, cost, model  │ │                     │
  │                            │ │  duration, turns      │ │                     │
  │                            │ │                       │ │                     │
  │                            │ │ Emit lifecycle event  │ │                     │
  │                            │ │  → observation hooks  │ │                     │
  │                            │ │  → usage metrics hook │ │                     │
  │                            │ │  → langfuse export    │ │                     │
  │                            │ └──────────┬───────────┘ │                     │
  │                            │            │             │                     │
  │◄─── SSE: result ──────────│            │             │                     │
  │◄─── SSE: done ────────────│            │             │                     │
  │     (with metrics)         │            │             │                     │
```

### 3.2 Chat Pathways (P5–P6): Standard Observability

```
Browser                    Hono Backend                 Relay              Agent Runner
  │                            │                          │                     │
  │  POST /agent/project-chat  │                          │                     │
  │  or /agent/task-chat       │                          │                     │
  ├───────────────────────────►│                          │                     │
  │                            │                          │                     │
  │                            │ ┌──────────────────────┐ │                     │
  │                            │ │ Build system prompt   │ │                     │
  │                            │ │ + visionDoc/planNodes │ │                     │
  │                            │ │ + skills injection    │ │                     │
  │                            │ │ + task context (P6)   │ │                     │
  │                            │ └──────────┬───────────┘ │                     │
  │                            │            │             │                     │
  │                            │ persist steer_message ───┤ (user's message)    │
  │                            │ persist init event ──────┤ (pathwayType, etc.) │
  │                            │            │             │                     │
  │                            │  dispatch ─┼────────────►│  dispatch ─────────►│
  │                            │            │             │                     │
  │                            │◄───────────┼── events ───┼────────────────────│
  │◄──── SSE: text ───────────│            │             │                     │
  │◄──── SSE: tool_use ───────│ persist ───┤             │                     │
  │◄──── SSE: tool_result ────│ persist ───┤             │                     │
  │                            │            │             │                     │
  │                            │◄───────────┼── result ───┼────────────────────│
  │                            │            │             │                     │
  │                            │ persist result ──────────┤                     │
  │                            │ create taskExecutions ───┤                     │
  │                            │            │             │                     │
  │◄── SSE: done + metrics ───│            │             │                     │
  │                            │            │             │                     │
  │ ┌────────────────────┐     │            │             │                     │
  │ │ onMetrics callback │     │            │             │                     │
  │ │ → addTaskMetrics() │     │            │             │                     │
  │ │ → usage-store      │     │            │             │                     │
  │ │ → dataClient sync  │     │            │             │                     │
  │ └────────────────────┘     │            │             │                     │
```

### 3.3 One-Shot Pathways (P7–P10): Minimal Observability

```
Browser                    Hono Backend                 Relay              Agent Runner
  │                            │                          │                     │
  │  POST /agent/summarize     │                          │                     │
  │  (or title/refine/labels)  │                          │                     │
  ├───────────────────────────►│                          │                     │
  │                            │                          │                     │
  │                            │ persist init event ──────┤                     │
  │                            │  (pathwayType,           │                     │
  │                            │   systemPrompt)          │                     │
  │                            │            │             │                     │
  │                            │  dispatch ─┼────────────►│  dispatch ─────────►│
  │                            │            │             │                     │
  │                            │◄───────────┼── text ─────┼────────────────────│
  │                            │ accumulate │             │  (buffered in       │
  │                            │ in memory  │             │   closure variable) │
  │                            │            │             │                     │
  │                            │◄───────────┼── result ───┼────────────────────│
  │                            │            │             │                     │
  │                            │ persist result event ────┤                     │
  │                            │  (status, metrics,       │                     │
  │                            │   durationMs)            │                     │
  │                            │            │             │                     │
  │◄── JSON response ─────────│            │             │                     │
  │    { summary/title/etc }   │            │             │                     │
  │                            │            │             │  No SSE stream      │
  │                            │            │             │  No taskExecutions  │
  │                            │            │             │  No frontend metrics│
```

### 3.4 Steering (P11): No Observability

```
Browser                    Hono Backend
  │                            │
  │  POST /agent/abort         │
  ├───────────────────────────►│
  │                            │ relayServer.cancelTask()
  │◄── { aborted: true } ─────│
  │                            │  No events stored
```

## 4. Storage Layer Details

### 4.1 streaming_events (Append-Only Log)

The primary persistence layer for SSE event recovery. All events written here can reconstruct the full activity view on page refresh.

**Schema:** `packages/core/src/db/schema.ts`

```
streaming_events
├── seq          SERIAL PRIMARY KEY
├── executionId  TEXT NOT NULL (routing key — taskId or streamId)
├── eventType    TEXT NOT NULL
├── data         JSONB
└── createdAt    TIMESTAMP DEFAULT now()
```

**Event types by pathway:**

| Event Type | P1-4 | P5-6 | P7-10 | Content |
|------------|------|------|-------|---------|
| `init` | yes | yes | yes | `{ pathwayType, projectId, nodeId, model, providerId, machineId, systemPrompt, computeBackend }` |
| `session_init` | yes | yes | — | `{ sessionId, model }` — Claude SDK session ID |
| `steer_message` | yes* | yes | — | `{ message }` — user's input text |
| `text` | yes | yes | — | `{ text }` — buffered, flushed on structural events |
| `tool_use` | yes | yes | — | `{ toolName, toolInput }` |
| `tool_result` | yes | yes | — | `{ toolName, success, result }` |
| `file_change` | yes | — | — | `{ path, action, linesAdded, linesRemoved }` |
| `progress` | yes | — | — | `{ message, percentage }` |
| `result` | yes | yes | yes | `{ sessionId, status, error?, metrics }` |
| `plan_result` | yes† | yes† | — | `{ nodes, edges }` — extracted plan JSON |
| `approval_request` | yes | — | — | `{ requestId, message, options }` |
| `approval_response` | yes | — | — | `{ requestId, answer }` |
| `safety_prompt` | yes | — | — | `{ tier, message, options }` |
| `safety_response` | yes | — | — | `{ decision }` |
| `error` | yes | yes | — | `{ error, recoverable }` |

\* steer_message for dispatch pathways is written via the `/steer` endpoint
† plan_result only for interactive plan generation pathway

**Text buffering:** Text events are buffered in memory (`appendText()`) and only flushed to DB when a structural event arrives (tool_use, tool_result, file_change, result) or on heartbeat/disconnect. This reduces write frequency dramatically for streaming text.

### 4.2 taskExecutions (Summary Records)

Per-execution summary with cost metrics. Used for dashboards, project-level cost aggregation, and usage tracking.

**Schema:** `packages/core/src/db/schema.ts`

```
taskExecutions
├── id               UUID PRIMARY KEY
├── executionId      TEXT UNIQUE NOT NULL
├── nodeClientId     TEXT NOT NULL
├── projectId        TEXT NOT NULL
├── status           TEXT (pending, running, success, failure, cancelled)
├── streamText       TEXT (accumulated raw output)
├── error            TEXT
├── startedAt        TIMESTAMP
├── completedAt      TIMESTAMP
├── sessionId        TEXT (Claude SDK session ID)
├── providerId       TEXT
├── model            TEXT
├── durationMs       INTEGER
├── inputTokens      INTEGER
├── outputTokens     INTEGER
├── tokensUsed       INTEGER (input + output)
├── estimatedCostUsd REAL
├── turnsUsed        INTEGER
└── markdownSummary  TEXT (generated by observation collector)
```

**Creation points:**
- **P1-4 (dispatch):** Created by dispatch engine's result handler (`server/lib/dispatch/result-router.ts`)
- **P5-6 (chat):** Created by `streamChatViaRelay.onResult` in `agent.ts`
- **P7-10 (one-shot):** Not created (no project context; these are utility calls)

**nodeClientId sentinel:** For chat pathways without a task node, `nodeClientId` uses the `pathwayType` string (e.g., `'project-chat'`) as a sentinel value. This satisfies the NOT NULL constraint while allowing filtering.

### 4.3 observationEvents (Structured Traces)

Turn-level generation tracking for deep analysis and Langfuse export. Created by the observation collector, not by the route handlers directly.

**Schema:** `packages/core/src/db/schema.ts`

```
observationEvents
├── id                    UUID PRIMARY KEY
├── traceId               TEXT (groups all events for one execution)
├── parentObservationId   UUID (tree structure)
├── type                  TEXT (span, generation, tool, event)
├── name                  TEXT
├── startTime / endTime   TIMESTAMP
├── input / output        JSONB
├── model                 TEXT
├── inputTokens           INTEGER
├── outputTokens          INTEGER
├── estimatedCostUsd      REAL
├── level                 TEXT (debug, default, warning, error)
├── projectId / nodeId    TEXT
├── statusMessage         TEXT
└── metadata              JSONB
```

**Coverage:** Only P1-4 (agentic pathways) get full observation traces. Chat and one-shot pathways have minimal or no observation records.

### 4.4 usageMetrics (Daily Aggregation)

Per-user daily cost totals. Updated incrementally from the frontend.

```
usageMetrics
├── userId         TEXT
├── sessionDate    DATE
├── totalCostUsd   REAL
├── totalInputTokens   INTEGER
├── totalOutputTokens  INTEGER
├── tasksCompleted     INTEGER
└── tasksFailed        INTEGER
```

**Update flow:** Frontend `useUsageStore.addTaskMetrics()` → `dataClient.incrementUsage()` → `POST /api/data/usage/increment` → `usageMetrics` table.

## 5. What Each Pathway Captures

### 5.1 Prompt & System Context

| Pathway | System Prompt | Vision Doc | Skills | Plan Context | Task Context | Dependencies |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|
| P1-4 Dispatch | yes | yes | yes | — | yes | yes |
| P5 Project Chat | yes | yes | yes | planNodes + planEdges | — | — |
| P6 Task Chat | yes | optional | yes | — | title + description + output | — |
| P7-10 One-shot | yes | — | — | — | varies | — |
| P11 Abort | — | — | — | — | — | — |

**System prompt storage:** The full system prompt is stored in the `init` event's `data.systemPrompt` field in `streaming_events`. This means every AI session's prompt is recoverable — including injected skills, vision doc, and context.

### 5.2 AI Provider Input/Output

| Data Point | P1-4 | P5-6 | P7-10 | How Captured |
|------------|:---:|:---:|:---:|---|
| Input tokens | yes | yes | yes* | `metrics.inputTokens` from relay result |
| Output tokens | yes | yes | yes* | `metrics.outputTokens` from relay result |
| Model used | yes | yes | yes* | `metrics.model` from relay result |
| Cost estimate | yes | yes | yes* | `metrics.totalCost` from relay result |
| Duration | yes | yes | yes | `startTime` → result arrival |
| Turn count | yes | yes | 1 | `metrics.numTurns` from relay result |
| Full text output | yes | yes | in memory | streaming_events `text` events |
| Tool calls | yes | yes | — | streaming_events `tool_use` + `tool_result` |
| File changes | yes | — | — | streaming_events `file_change` |

\* One-shot pathways get metrics from the relay result but don't create `taskExecutions` records (no project context).

### 5.3 Frontend Display

| UI Component | Pathways | Data Source | Shows |
|---|---|---|---|
| Activity feed | P1-4, P5-6 | Live SSE + streaming_events catch-up | Text, tools, files, errors, approvals |
| Trace viewer | P1-4 | observationEvents | Per-turn generations, tool calls, durations |
| Usage sidebar | P1-6 | useUsageStore (in-memory + usageMetrics DB) | Session cost, token counts, task counts |
| Project cost | P1-6 | taskExecutions aggregated by projectId | Total project spend |
| Task execution card | P1-4 | taskExecutions + streaming_events | Status, duration, cost, summary |
| Chat panel | P5-6 | Session messages + SSE | Conversation history |
| Plan result | P3, P5 | plan_result event | Generated plan graph |

## 6. Recovery Mechanisms

### 6.1 Page Refresh Recovery

```
useRestoredExecution hook
  │
  ├─ Primary: fetchStreamingEventsCatchUp([executionIds], lastSeq)
  │    → GET /api/events/catch-up
  │    → Returns streaming_events after lastSeq
  │    → Replay via parseExecutionSSE/parseChatSSE
  │
  └─ Fallback: observationStore.fetchTrace(traceId)
       → GET /api/observations/:traceId
       → Reconstruct activity from observationEvents
       → Uses reconstructActivityFromTrace() bridge
```

### 6.2 SSE Disconnect Catch-Up

When the SSE stream drops mid-execution, the frontend tracks `lastSeq` (from SSE `id:` field) and reconnects:

```
Network reconnects
  → fetchStreamingEventsCatchUp([executionId], lastSeq)
  → Returns only events after lastSeq
  → Replays missed events into activity view
```

### 6.3 Crash Resilience

| Failure Mode | Protection |
|---|---|
| Browser tab close | Text buffer flushed on `stream.onAbort()` |
| SSE timeout | Heartbeat every 15s; flushes text buffer |
| Server SIGTERM/SIGINT | `streamingEventLog.flushAll()` in shutdown handler |
| Uncaught exception | `streamingEventLog.flushAll()` before `process.exit(1)` |
| Unhandled rejection | `streamingEventLog.flushAll()` (non-fatal) |
| Agent runner disconnect | `machine:disconnected` event → error SSE |

### 6.4 Text Buffering Strategy

Text events arrive at high frequency during streaming. Rather than persisting each chunk individually:

1. `appendText()` buffers text in memory (keyed by executionId)
2. Buffer is flushed to a single `text` event when:
   - A structural event arrives (tool_use, tool_result, file_change, result)
   - Heartbeat fires (every 15s)
   - Client disconnects (onAbort)
   - Server shuts down (flushAll)
3. This reduces DB writes by ~100x during active streaming

## 7. Observation Collector Pipeline

The observation collector (`server/lib/observability/observation-collector.ts`) creates structured traces for agentic pathways (P1-4):

```
Execution Events (via executionEventBus)
  │
  ├── session_init → store sessionId, model in trace state
  │
  ├── text (new text after tools) → finalize previous turn → start new turn
  │
  ├── tool_use → create pending tool observation
  │              add to currentTurn.toolCalls
  │
  ├── tool_result → complete pending tool observation
  │                 add to pendingToolResults (input for next turn)
  │
  ├── file_change → addObservation('file:change')
  │
  └── progress → addObservation('task:progress')

Lifecycle Events (via astroEventTransport)
  │
  ├── task.started → initTrace(), captureInitialContext()
  │
  ├── task.completed → finalizeCurrentTurn()
  │                    addObservation('task:completed')
  │                    finishTrace() → flush + generate markdown summary
  │
  ├── task.failed → finishTrace() with error
  │
  └── approval.requested/responded → addObservation()

Flush Pipeline
  │
  ├── Periodic: every 5 seconds (if buffer non-empty)
  ├── Size threshold: buffer >= 50 events
  └── On completion: flush all + generate markdown summary
       └── Summary → taskExecutions.markdownSummary
```

### 7.1 Hook Registration

```typescript
// server/index.ts
astroEventTransport.registerHook('observability', observabilityHook)   // → observation collector
astroEventTransport.registerHook('usage-metrics', usageMetricsHook)    // → cost aggregation
astroEventTransport.registerHook('langfuse', langfuseExportHook)       // → Langfuse export
astroEventTransport.registerHook('sse-notification', sseNotificationHook)
astroEventTransport.registerHook('audit-log', auditLogHook)
// ... plus PR creation, merge queue, git pull, channel notification hooks
```

### 7.2 Langfuse Export

When `LANGFUSE_ENABLED=true`:

```
observationEvents (DB)
  │
  └── langfuseExportHook
       ├── Map traces → Langfuse trace-create
       ├── Map spans → Langfuse span-create
       ├── Map generations → Langfuse generation-create
       └── Batch POST to LANGFUSE_BASE_URL every 10s or 50 events
```

## 8. Frontend Cost Display Pipeline

```
SSE done event (with metrics)
  │
  └── parseChatSSE → onMetrics callback
       │
       └── useUsageStore.addTaskMetrics({
             durationMs, inputTokens, outputTokens,
             estimatedCostUsd, model, turnsUsed
           }, success)
            │
            ├── Update in-memory sessionMetrics
            │    (shown in sidebar usage widget)
            │
            └── dataClient.incrementUsage()
                 → POST /api/data/usage/increment
                 → usageMetrics table (daily aggregation)
```

**Coverage:**
- P1-4: Metrics flow through `execution-store` → `addTaskMetrics` (existing path)
- P5-6: Metrics flow through SSE `done` event → `onMetrics` callback → `addTaskMetrics` (new in this PR)
- P7-10: No frontend cost display (fire-and-forget utility calls)

## 9. Observability Gaps and Future Work

### 9.1 Currently Deferred

| Gap | Description | Priority |
|---|---|---|
| Duplicate event audit | Verify no double-writes when SSE reconnects overlap with global relay fallback | Medium |
| `pathway_type` column | Optional indexed column on streaming_events for efficient filtering by pathway | Low |
| One-shot cost tracking | P7-10 don't create taskExecutions — could be added if cost visibility needed | Low |
| Chat observation traces | P5-6 don't have turn-level observation records (only streaming_events) | Medium |

### 9.2 Data Points Not Yet Captured

| Data Point | Pathways Affected | Potential Value |
|---|---|---|
| Token usage per turn | P5-6 (chat) | Identify expensive conversation turns |
| Prompt template version | All | Track prompt engineering changes |
| Cache hit rate | P1-4 | Measure prompt caching effectiveness |
| Time to first token | P1-6 (streaming) | Latency monitoring |
| Retry count | All | Detect flaky relay/agent issues |

## 10. Key File Reference

| File | Role |
|---|---|
| `server/routes/agent.ts` | Chat + one-shot route handlers, `streamChatViaRelay`, `executeViaRelay` |
| `server/routes/dispatch.ts` | Agentic dispatch, `dispatchViaRelay` |
| `server/routes/events.ts` | Global SSE relay (fallback after dispatch stream closes) |
| `server/lib/streaming-event-log.ts` | Append-only event persistence with text buffering |
| `server/lib/observability/observation-collector.ts` | Turn-based trace construction |
| `server/lib/observability/langfuse-exporter.ts` | Langfuse export hook |
| `server/lib/events/astro-event-transport.ts` | Lifecycle event bus |
| `server/lib/events/hooks/usage-metrics-hook.ts` | Cost aggregation hook |
| `server/routes/observations.ts` | Observation query API |
| `src/stores/execution-store.ts` | Frontend execution state + metrics |
| `src/stores/usage-store.ts` | Frontend session cost tracking |
| `src/lib/sse-parser.ts` | SSE parsing with `onMetrics` callback |
| `src/hooks/use-restored-execution.ts` | Page refresh recovery |
| `src/components/activity-blocks.tsx` | Activity rendering |
| `src/lib/observation-activity-bridge.ts` | Reconstruct activity from observations |
| `packages/core/src/db/schema.ts` | All table schemas |
