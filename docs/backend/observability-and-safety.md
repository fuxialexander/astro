# Observability and Safety Guardrails

This document describes Astro's observability system and safety guardrails. It covers how agent execution traces are captured, stored, queried, and displayed, as well as the cost-tracking and tool-restriction mechanisms that protect against runaway executions.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Observation Collector](#observation-collector)
4. [Database Schema](#database-schema)
5. [API Endpoints](#api-endpoints)
6. [Frontend Trace Viewer](#frontend-trace-viewer)
7. [Safety Guardrails](#safety-guardrails)
8. [Viewing Traces](#viewing-traces)
9. [Future Enhancements](#future-enhancements)

---

## Overview

Astro's observability system provides structured tracing for every task execution. When an agent (such as Claude Code) runs a task, the system captures a comprehensive timeline of events: lifecycle transitions, LLM generation turns, tool calls and results, file changes, progress updates, and cost metrics. These observations are persisted to a PostgreSQL database, exposed through a query API, and rendered in a purpose-built trace viewer in the Astro UI.

The system serves three purposes:

1. **Debugging** -- Developers can inspect exactly what an agent did during a task execution, including the full text of each LLM turn, every tool call with its input and output, and any errors encountered.
2. **Cost visibility** -- Token counts and estimated USD costs are tracked per execution and surfaced in both the UI and the API.
3. **Safety** -- Configurable guardrails enforce per-execution cost limits and per-project tool denylists, preventing runaway spend or unauthorized tool usage.

The observation data model is Langfuse-compatible. Observations can optionally be exported to a self-hosted Langfuse instance for advanced analytics, prompt engineering, and evaluation workflows.

---

## Architecture

The observation pipeline flows through four stages:

```
Agent Execution
      |
      v
+----------------------------+
| Observation Collector      |  <-- subscribes to executionEventBus + astroEventTransport
| (server/lib/observability/ |
|  observation-collector.ts) |
+----------------------------+
      |
      | batch flush (size or time)
      v
+----------------------------+
| PostgreSQL                 |
| observation_events table   |
+----------------------------+
      |
      | HTTP API queries
      v
+----------------------------+
| Hono API Routes            |
| GET /api/observations/*    |
| (server/routes/            |
|  observations.ts)          |
+----------------------------+
      |
      | fetch + poll
      v
+----------------------------+
| Frontend Trace Viewer      |
| (observation-store.ts +    |
|  trace-viewer/ components) |
+----------------------------+
```

**Dual event subscription.** The collector bridges two event systems:

- **`astroEventTransport`** -- Lifecycle events (`task.started`, `task.completed`, `task.failed`, `task.cancelled`, `approval.requested`, `approval.responded`). The collector registers as an `EventHook` on this transport.
- **`executionEventBus`** -- Streaming events emitted during agent execution (`task:session_init`, `task:tool_trace`, `task:stdout`, `task:file_change`, `task:progress`). The collector subscribes as an event listener.

Both streams are unified into a single flat table of `ObservationEvent` records, each tagged with a `traceId` (which equals the `executionId`).

**Optional Langfuse export.** When configured, a second `EventHook` on `astroEventTransport` forwards lifecycle events to Langfuse. The collector can also push raw observations to Langfuse via the `LangfuseExporter.exportObservations()` method.

---

## Observation Collector

**Source file:** `server/lib/observability/observation-collector.ts`

The `ObservationCollector` class is a singleton (`observationCollector`) that manages per-trace state and converts raw events into structured observations.

### Initialization and Lifecycle

```typescript
// Singleton + EventHook for astroEventTransport
export const observationCollector = new ObservationCollector()
export const observabilityHook: EventHook = (event) => {
  observationCollector.handleLifecycleEvent(event)
}
```

Call `observationCollector.start()` to subscribe to the `executionEventBus`. Lifecycle events are handled via the exported `observabilityHook` registered on `astroEventTransport`.

### Turn-Based Grouping

The collector groups agent output into discrete **generation turns**. A turn represents one cycle of LLM reasoning:

```
Turn 0: [initial context] --> assistant text + tool calls
Turn 1: [tool results]    --> assistant text + tool calls
Turn 2: [tool results]    --> final assistant text
```

Each turn produces a `generation` observation with structured input and output:

- **Input:** `{ turnIndex, toolResults }` -- the turn index and any tool results from the previous turn that served as input to this turn.
- **Output:** `{ text, toolCalls }` -- the text the LLM produced plus any tool calls it decided to make.

Turn boundaries are detected by tracking a `inToolPhase` flag. When text arrives during tool phase, the current turn is finalized and a new turn begins. The collector accumulates text chunks in `currentTurn.textChunks` and tool calls in `currentTurn.toolCalls`.

### Tool Correlation

Tool observations are correlated using a two-level strategy:

1. **`toolUseId`** -- If the agent SDK provides a unique tool-use identifier, it is used as the correlation key.
2. **`toolName` fallback** -- If no `toolUseId` is available, the tool name is used (suitable for sequential tool calls of different types).

When a `tool_use` event arrives, a partial `ObservationEvent` is stored in `pendingTools`. When the corresponding `tool_result` arrives, the pending observation is completed with `endTime`, `output`, and success/failure status. If no matching `tool_use` is found, a standalone tool observation is created.

Tool observations are parented to their generation turn via `parentObservationId`, creating a hierarchy: trace > generation > tool.

### Batch Buffering

Observations are buffered per-trace and flushed to the database under three conditions:

| Trigger | Threshold |
|---------|-----------|
| Buffer size | 50 events per trace (`BATCH_SIZE`) |
| Time interval | Every 5 seconds (`FLUSH_INTERVAL_MS`) |
| Trace completion | On `task.completed`, `task.failed`, or `task.cancelled` |

On flush, all buffered observations are batch-inserted into the `observation_events` table. If the insert fails, events are re-added to the buffer for retry.

### Context Capture

When a `task.started` lifecycle event arrives, the collector creates a `span` observation with `name: 'context'` containing the initial task context:

- `taskTitle` -- the plan node title
- `taskDescription` -- the plan node description
- `visionDoc` -- the project vision document (truncated to 5000 characters)

This context span appears in the trace viewer as the "input" to the first generation turn.

### Markdown Summary Generation

When a trace completes, the collector generates a markdown summary from all buffered observations. This summary includes:

- Trace ID, model, duration, status, turn count
- Metrics table (tool calls, generations, file changes, token counts, estimated cost)
- Tool call breakdown by name (with failure counts)
- File change list
- Error list

The summary is stored in the `task_executions.markdown_summary` column and is available via the `/api/observations/:traceId/summary` endpoint.

### Observation Types

Every observation has a `type` field:

| Type | Meaning | Examples |
|------|---------|---------|
| `span` | A timed span of activity | `context` (initial task context) |
| `generation` | One LLM generation turn | `generation:turn-0`, `generation:turn-1` |
| `tool` | A tool call with input and output | `tool:Bash`, `tool:Read`, `tool:Edit` |
| `event` | A point-in-time event | `task:started`, `task:completed`, `task:failed`, `task:cancelled`, `task:progress`, `file:change`, `approval:requested`, `approval:responded` |

### Observation Levels

| Level | Meaning |
|-------|---------|
| `debug` | Low-priority (progress events) |
| `default` | Normal operation |
| `warning` | Attention needed (cancellations, orphaned tools) |
| `error` | Failures (task errors, tool failures) |

---

## Database Schema

**Source file:** `server/lib/db/schema.ts`
**Migration:** `drizzle/0006_observation_events.sql`

### Table: `observation_events`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | `text` | PK | Time-prefixed UUID (base-36 timestamp + UUID) for chronological ordering |
| `trace_id` | `text` | NOT NULL | Root container ID, equals the `executionId` of the task execution |
| `parent_observation_id` | `text` | yes | Parent observation for nesting (e.g., tool parented to a generation) |
| `type` | `text` | NOT NULL | One of: `span`, `generation`, `tool`, `event` |
| `name` | `text` | NOT NULL | Human-readable name (e.g., `tool:Bash`, `generation:turn-0`, `task:started`) |
| `start_time` | `timestamp` | NOT NULL | When the observation started |
| `end_time` | `timestamp` | yes | When the observation ended (null for point-in-time events) |
| `input` | `jsonb` | yes | Structured input (tool input, turn context with tool results) |
| `output` | `jsonb` | yes | Structured output (tool result, generation text + tool calls) |
| `model` | `text` | yes | LLM model identifier (e.g., `claude-sonnet-4-20250514`) |
| `input_tokens` | `integer` | yes | Input token count for this observation |
| `output_tokens` | `integer` | yes | Output token count for this observation |
| `estimated_cost_usd` | `real` | yes | Estimated cost in USD |
| `level` | `text` | NOT NULL | Severity: `debug`, `default`, `warning`, `error` (default: `default`) |
| `metadata` | `jsonb` | yes | Arbitrary metadata (taskId, toolUseId, turnIndex, sessionId, etc.) |
| `project_id` | `uuid` | NOT NULL | The project this observation belongs to |
| `node_id` | `text` | yes | The plan node ID, if applicable |
| `status_message` | `text` | yes | Error details or status text |
| `created_at` | `timestamp` | NOT NULL | Row insertion time (auto-set via `DEFAULT now()`) |

### Indexes

Six indexes are defined for efficient querying:

| Index Name | Column(s) | Notes |
|------------|-----------|-------|
| `idx_obs_trace_id` | `trace_id` | Primary lookup path -- all observations for one execution |
| `idx_obs_project_id` | `project_id` | Filter observations by project |
| `idx_obs_type` | `type` | Filter by observation type |
| `idx_obs_start_time` | `start_time` | Time-range queries |
| `idx_obs_level` | `level` | Partial index: `WHERE level != 'default'` (only indexes non-default levels) |
| `idx_obs_name` | `name` | Filter by observation name |

### Related Column on `task_executions`

The migration also adds a `markdown_summary` (`text`, nullable) column to the `task_executions` table. This stores the pre-generated markdown summary produced by the observation collector when a trace completes.

---

## API Endpoints

**Source file:** `server/routes/observations.ts`

All endpoints are mounted under `/api/observations`.

### GET /api/observations

List observations with filtering and pagination.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `executionId` | string | Filter by trace/execution ID |
| `projectId` | string (UUID) | Filter by project |
| `type` | string | Filter by observation type (`span`, `generation`, `tool`, `event`) |
| `level` | string | Filter by severity level (`debug`, `default`, `warning`, `error`) |
| `name` | string | Filter by observation name (exact match) |
| `startAfter` | ISO timestamp | Only observations starting after this time |
| `startBefore` | ISO timestamp | Only observations starting before this time |
| `limit` | number | Max results (default 100, max 1000) |
| `offset` | number | Pagination offset (default 0) |

**Response:** `{ data: ObservationEvent[], limit: number, offset: number }`

**Example:**
```
GET /api/observations?executionId=abc-123&type=tool&limit=50
```

### GET /api/observations/stats

Aggregate statistics across observations.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `executionId` | string | Scope stats to a single execution |
| `projectId` | string (UUID) | Scope stats to a project |

**Response:**
```json
{
  "totalEvents": 42,
  "totalSpans": 1,
  "totalGenerations": 5,
  "totalTools": 28,
  "totalEventType": 8,
  "errorCount": 2,
  "warningCount": 1,
  "totalCostUsd": 0.0523,
  "totalInputTokens": 15234,
  "totalOutputTokens": 4821
}
```

### GET /api/observations/:traceId

All observations for a specific execution, ordered by `start_time` ascending.

**Response:** `{ data: ObservationEvent[], traceId: string }`

**Example:**
```
GET /api/observations/exec-abc-123
```

### GET /api/observations/:traceId/summary

Markdown summary for an execution. Returns the pre-generated summary from `task_executions.markdown_summary` if available. Otherwise generates a basic summary on the fly from the observation data.

**Response:** Plain text (Content-Type: text/plain), markdown-formatted.

**Example response:**
```markdown
# Execution Summary

**Trace ID:** `exec-abc-123`
**Model:** claude-sonnet-4-20250514
**Duration:** 12.3s
**Status:** completed
**Turns:** 3

## Metrics

| Metric | Value |
|--------|-------|
| Tools called | 8 (7 ok, 1 failed) |
| Generations | 3 |
| File changes | 2 |
| Input tokens | 15,234 |
| Output tokens | 4,821 |
| Estimated cost | $0.0523 |
```

---

## Frontend Trace Viewer

**Source files:**
- `src/stores/observation-store.ts` -- Zustand store for fetching and caching trace data
- `src/types/observations.ts` -- TypeScript types for the frontend
- `src/components/task-detail/trace-viewer/index.tsx` -- Main trace viewer component
- `src/components/task-detail/trace-viewer/trace-summary-card.tsx` -- Summary banner
- `src/components/task-detail/trace-viewer/turn-list.tsx` -- Left panel turn list
- `src/components/task-detail/trace-viewer/turn-detail.tsx` -- Right panel turn detail
- `src/components/task-detail/trace-viewer/tool-call-item.tsx` -- Expandable tool call row
- `src/components/task-detail/trace-viewer/collapsible-content.tsx` -- Reusable collapsible section

### Data Flow

1. The `TraceViewer` component receives an `executionId` and `isRunning` flag.
2. On mount, it calls `fetchTrace(executionId)` from `useObservationStore`.
3. `fetchTrace` calls `fetchTraceObservations(traceId)` from the API client, which hits `GET /api/observations/:traceId`.
4. The raw flat array of `RawObservation` objects is transformed into a `TraceTree` by the `buildTraceTree()` function.
5. The `TraceTree` is cached in the Zustand store's `traces` map.

### TraceTree Construction (`buildTraceTree`)

The `buildTraceTree` function in `observation-store.ts` transforms a flat list of observations into a hierarchical structure:

1. Separates observations by type: `span`, `generation`, `tool`, `event`.
2. Finds the context span (`name === 'context'`).
3. Sorts generations by `startTime` -- each generation becomes a "turn."
4. For each generation, finds tool observations where `parentObservationId === generation.id`.
5. Parses generation output for text content (supports `{ text: ... }` and `{ content: ... }` formats).
6. Computes per-tool `durationMs` from `startTime`/`endTime`.
7. Aggregates stats: total turns, total tool calls, total tokens, total cost, duration.

The resulting `TraceTree` type:

```typescript
interface TraceTree {
  traceId: string
  contextSpan: RawObservation | null
  turns: GenerationTurn[]
  events: RawObservation[]
  stats: {
    totalTurns: number
    totalToolCalls: number
    totalTokens: number
    totalCost: number
    model: string | null
    durationMs: number | null
  }
}
```

### UI Layout

The trace viewer uses a **split-panel** layout:

```
+------------------------------------------------------+
|  TraceSummaryCard (banner: turns, tools, model,       |
|  tokens, cost, duration, errors)                      |
+----------------------------+-------------------------+
|  TurnList (40% width)      |  TurnDetail (60% width) |
|                            |                         |
|  [1] First 80 chars...    |  Turn N header (model,  |
|      3 tools, 1.2k tok    |  tokens)                |
|  [2] Next turn preview... |                         |
|      1 tool, 800 tok      |  Generation text        |
|  [3] ...                  |  (rendered as markdown)  |
|                            |                         |
|                            |  Tool Calls (N)         |
|                            |  > Bash     120ms       |
|                            |  > Read     45ms        |
|                            |  > Edit     78ms        |
+----------------------------+-------------------------+
```

**Summary banner** (`TraceSummaryCard`): Displays aggregate stats -- turn count, tool call count, model badge, token count, cost, duration, and error count.

**Turn list** (`TurnList`): Scrollable list of all generation turns. Each row shows a numbered badge, an 80-character text preview, the tool call count with success/failure indicators, and a token count.

**Turn detail** (`TurnDetail`): Shows the selected turn's full content:
- Header with turn number, model badge, and token breakdown (input/output).
- Generation text rendered as markdown.
- Tool call list with expandable input/output sections.

**Tool call expansion** (`ToolCallItem`): Each tool call row shows a status icon (spinner for in-progress, green check for success, red X for failure), the tool name (with the `tool:` prefix stripped), and duration. Clicking expands the row to show input and output as formatted JSON/text (output truncated to 5000 characters).

### Auto-Polling

When `isRunning` is true, the trace viewer polls `fetchTrace(executionId)` every 3 seconds. Polling stops when the component unmounts or `isRunning` becomes false. This ensures the trace viewer shows live progress during active executions.

### Fallback Mode

If the trace has events but no generation observations (e.g., the provider does not emit structured output), the viewer falls back to a flat event list showing timestamps and observation names.

### Frontend API Client Functions

Three functions in `src/lib/api-client.ts` support the trace viewer:

```typescript
// Fetch all observations for a trace
fetchTraceObservations(traceId: string): Promise<RawObservation[]>

// Fetch aggregate stats for a trace
fetchTraceStats(traceId: string): Promise<TraceStats>

// Fetch the markdown summary for a trace
fetchTraceSummary(traceId: string): Promise<string>
```

---

## Safety Guardrails

**Source file:** `server/lib/observability/safety-rails.ts`

The safety rails system provides two protective mechanisms: cost tracking and tool restriction. It is implemented as a lightweight singleton class (`safetyRails`) that the observation collector integrates with.

### Cost Tracking

Every time a `task.completed` event includes cost metrics (`estimatedCostUsd`), the observation collector calls `safetyRails.trackCost(executionId, costUsd)`. The safety rails module:

1. Accumulates cost per execution in an in-memory map.
2. Compares the cumulative cost against a per-execution limit.
3. Logs a warning if the limit is exceeded.
4. Returns a status object indicating whether the limit was exceeded, the current cost, and the limit.

The default cost limit is **$10.00 per execution** (`DEFAULT_MAX_COST`).

```typescript
const result = safetyRails.trackCost(executionId, 0.05)
// result: { exceeded: false, currentCost: 0.05, limit: 10.0 }
```

Cost state is cleaned up when a trace finishes via `safetyRails.resetExecution(executionId)`.

### Tool Denylist

Projects can configure a list of denied tools via `SafetyRailsConfig.deniedTools`. When a `tool_use` event arrives, the observation collector calls `safetyRails.isToolAllowed(projectId, toolName)`. If the tool is in the denylist:

1. A warning is logged.
2. The method returns `false`.

This currently functions as a check-and-warn mechanism. The observation is still recorded, but the warning log provides an audit trail.

### Configuration

Per-project safety configuration can be loaded at runtime:

```typescript
safetyRails.loadConfig(projectId, {
  maxCostPerExecution: 5.0,    // Custom cost limit (USD)
  deniedTools: ['Bash', 'Write']  // Tools denied for this project
})
```

Configuration is stored in-memory. Calling `getConfig(projectId)` returns the configuration for a project, falling back to an empty config (which uses the default cost limit and allows all tools).

### SafetyRailsConfig Type

```typescript
interface SafetyRailsConfig {
  maxCostPerExecution?: number   // USD limit per execution
  deniedTools?: string[]          // Tools denied for this project
}
```

---

---

## Viewing Traces

### In the Astro UI

The trace viewer is embedded in the task detail page. When you navigate to a task that has been executed, the trace viewer tab shows:

1. A **summary banner** with key metrics (turns, tool calls, model, tokens, cost, duration, errors).
2. A **turn list** on the left showing all LLM generation turns with previews and tool counts.
3. A **turn detail** panel on the right showing the full generation text (rendered as markdown) and expandable tool calls.

During active execution (`isRunning = true`), the viewer polls every 3 seconds and updates in near-real-time.

### Via the API

For programmatic access, use the observation API endpoints:

```bash
# Get all observations for an execution
curl http://localhost:3001/api/observations/exec-123

# Get aggregate stats
curl http://localhost:3001/api/observations/stats?executionId=exec-123

# Get the markdown summary
curl http://localhost:3001/api/observations/exec-123/summary

# Filter by type and level
curl "http://localhost:3001/api/observations?executionId=exec-123&type=tool&level=error"
```

### Via Langfuse

When Langfuse export is enabled, all traces are available in the Langfuse UI where you can:

- Browse traces with filtering and search
- Inspect generation turns with token usage breakdowns
- View tool call timelines
- Analyze cost trends across executions
- Build evaluation datasets from trace data
- Set up prompt monitoring and alerting

---

## Future Enhancements

The following improvements are planned or under consideration for the observability and safety systems:

### SDK Hook-Based Collection

The current collector relies on the `executionEventBus` for streaming events and `astroEventTransport` for lifecycle events. A future enhancement could integrate directly with agent SDK hooks (e.g., Claude Agent SDK callbacks) to capture richer metadata -- such as per-turn token counts, content block details, and thinking tokens -- without relying on the dispatch layer to parse and forward them.

### Analytics Dashboard

A dedicated observability dashboard page in the Astro UI could provide:

- Per-project cost trends over time
- Tool usage frequency and failure rate charts
- Average execution duration and turn counts
- Token efficiency metrics (tokens per successful task)
- Error rate monitoring with alerting

### Safety Configuration UI

Currently, safety rails configuration (`maxCostPerExecution`, `deniedTools`) is set programmatically. A settings panel in the project configuration UI would allow users to:

- Set per-project cost limits with visual feedback on current spend
- Manage tool allowlists and denylists with toggle switches
- Configure automatic execution cancellation when cost limits are exceeded (rather than warn-only)
- Set up notifications for safety rail violations

### Evaluation and Scoring

Integration with Langfuse's scoring and evaluation features could enable:

- Automated quality scoring of agent outputs
- Human-in-the-loop evaluation workflows
- A/B testing of different prompt strategies using trace data
- Regression detection when agent behavior changes

### Retention and Archival

As observation data grows, policies for retention and archival would help manage storage:

- Configurable retention periods per project
- Automatic archival of old traces to cold storage
- Summary-only retention (keep markdown summaries, delete raw observations)
