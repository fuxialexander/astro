# Refresh Robustness — Design Document

> **Last updated:** 2026-03-01
> **Status:** Implemented. Three-layer recovery architecture is operational.

---

## 1. Problem Statement

Astro runs long-lived AI executions (minutes to hours). Users routinely refresh the page, lose network briefly, or open the same project on a different device. All of these actions destroy in-memory state (Zustand stores, SSE connections). Without a recovery mechanism, users would see blank activity panels and stale task statuses after any interruption.

**Goal:** After a page refresh or SSE reconnection, the UI must show the same execution activity, task statuses, and approval states as if the user had never left.

---

## 2. Architecture Overview

Refresh robustness uses a **three-layer fallback architecture**:

```
Layer 1: Live SSE (in-memory)
    ↓ (lost on refresh)
Layer 2: streaming_events DB (fast catch-up)
    ↓ (fallback if empty)
Layer 3: observation_events DB (full reconstruction)
```

| Layer | Data Source | Speed | Completeness | When Used |
|-------|-----------|-------|-------------|-----------|
| **1. Live SSE** | In-memory Zustand stores | Instant | Full (real-time) | Normal operation, no refresh |
| **2. Streaming Events** | `streaming_events` table | Fast (~100ms) | Full (append-only log) | After page refresh or SSE reconnect |
| **3. Observations** | `observation_events` table | Slower (~300-500ms) | Partial (structured traces) | Legacy executions or if streaming events empty |

---

## 3. Layer 1: Live SSE (In-Memory)

During normal operation, all execution events flow through SSE to the browser:

1. Agent runner produces events → relay → backend `executionEventBus`
2. Backend SSE endpoint (`/api/events/stream`) pushes events to browser
3. `realtime-store.ts` receives events and updates `taskStreams` map
4. `execution-store.ts` updates task status, activity events, tool traces, file changes
5. React components render from Zustand selectors

**Key stores involved:**
- `realtime-store.ts` — `taskStreams[executionId]` holds activity events, tool traces, file changes, approval state
- `execution-store.ts` — `executions` map holds per-node execution metadata
- `plan-store.ts` — `nodes` holds task statuses, execution fields

**Lifetime:** All data lives only in memory. Lost on page refresh, tab close, or navigation away.

---

## 4. Layer 2: Streaming Events (Fast Catch-Up)

### 4.1 Server-Side Persistence

Every SSE event is also persisted to the `streaming_events` table via `StreamingEventLog`:

```
streaming_events (append-only)
├── seq         (auto-increment, primary key)
├── executionId (text, indexed)
├── eventType   (text: 'text' | 'tool_use' | 'tool_result' | 'file_change' | 'session_init' | 'progress' | 'result' | 'approval_request' | 'steer_message' | 'approval_response')
├── data        (jsonb, event payload)
├── createdAt   (timestamp)
└── teamId      (text, for RLS scoping)
```

**Write path:** `StreamingEventLog.append()` is called alongside every SSE event emission. Structural events (tool_use, tool_result, file_change) are persisted immediately. Text tokens are accumulated per-turn and flushed at tool boundaries to avoid excessive writes.

**Chat messages** (steer, plan-chat, task-chat) are also persisted to this table, enabling full conversation recovery after refresh.

### 4.2 Client-Side Catch-Up

**Catch-up API:**
```
GET /api/events/catch-up?executionIds=X,Y&afterSeq=N&limit=1000
→ { events: StreamingEventRow[], lastSeq: number }
```

**Hydration flow (in `realtime-store.hydrateFromCatchUp()`):**

1. Fetch missed events from `streaming_events` after last known sequence number
2. Group events by `executionId`
3. Pass each group through `hydrateStreamingEvents()` (from `streaming-event-hydrator.ts`)
4. Hydrator produces: `activityEvents[]`, `toolTraces[]`, `fileChanges[]`, `pendingApprovals[]`, `status`, `output`, `error`, `sessionId`, `model`
5. Merge into existing `taskStreams` (append mode for reconnect, replace mode for full hydration)
6. Call `reconcileResultFromCatchUp()` to update plan nodes with terminal status, PR/branch metadata

**Two hydration modes:**
- **Reconnect** (`afterSeq > 0`): Append caught-up events to existing stream, preserving live data
- **Full hydration** (`afterSeq === 0`): Only populate if existing stream is empty (live data takes priority)

### 4.3 Trigger Points

| Trigger | Source | Mode |
|---------|--------|------|
| Page refresh | `useRestoredExecution()` hook | Full hydration (afterSeq=0) |
| SSE reconnect | `realtime-store.onReconnect()` | Incremental (afterSeq=lastSeq) |
| Manual | `hydrateFromCatchUp([ids], seq)` | Configurable |

---

## 5. Layer 3: Observations (Legacy Fallback)

If streaming events are empty (e.g., for executions that predate the streaming_events table, or if events were not persisted), the system falls back to observation-based reconstruction:

1. `useRestoredExecution()` detects empty catch-up result
2. Fetches `TraceTree` from `GET /api/observations/{executionId}`
3. `reconstructActivityFromTrace()` (in `observation-activity-bridge.ts`) converts the observation tree into `TaskActivityEvent[]`, `ToolTrace[]`, and `FileChange[]`
4. These are used directly as the restored activity

**Limitations of observation fallback:**
- Slower (requires building hierarchical trace tree from flat observations)
- May miss some event types not captured as observations
- No approval state recovery
- No chat message recovery

---

## 6. Data Lifecycle on Reset

When a user resets a task execution, all layers must be cleaned up to prevent stale data from reappearing:

1. **Server-side reset** (`POST /api/dispatch/reset`):
   - Closes PR, deletes branch, cleans worktree
   - Deletes `streaming_events` rows for the execution
   - Deletes `task_executions` records for the node

2. **Client-side cleanup** (`cleanupNodeZustandState()`):
   - Clears `taskStreams[executionId]` from realtime store
   - Clears chat sessions, steer sessions, text batches
   - Clears observation cache
   - Clears pending approvals
   - Calls `dataClient.deleteExecution(nodeId)` as backup DB cleanup

3. **Plan node reset**:
   - Clears `executionId`, `executionOutput`, `executionError`, `executionStartedAt`, `executionCompletedAt`, `prUrl`, `prNumber`, `branchName`
   - Sets status back to `"planned"`

This ensures that after a reset + page refresh, the task appears clean with no residual execution data.

---

## 7. Store Initialization on Refresh

On page load, the `DataLoader` component (in `app.tsx`) reinitializes all stores:

**Phase 1 — Teams (must load first):**
- Loads teams to set `X-Team-Id` header for all subsequent API calls

**Phase 2 — All other stores (parallel):**
- Projects, plan nodes/edges, settings, user profile, chat sessions, usage, executions, activities, sidebar state, plugins, skills
- Each store calls `dataClient.load()` → `GET /api/data/*`

**Phase 3 — Post-load:**
- Connects SSE via `connectRealtime()`
- Refreshes file trees via `refreshAllFileTrees()`
- Individual task views trigger `useRestoredExecution()` for per-execution recovery

**Plan node dependencies** are rebuilt from edges on load (edges are the source of truth for the dependency graph).

---

## 8. Key Files

| Component | File | Key Functions |
|-----------|------|--------------|
| Streaming event hydration | `src/lib/streaming-event-hydrator.ts` | `hydrateStreamingEvents()` |
| Execution restoration hook | `src/hooks/use-restored-execution.ts` | `useRestoredExecution()` |
| Observation fallback bridge | `src/lib/observation-activity-bridge.ts` | `reconstructActivityFromTrace()` |
| Observation store | `src/stores/observation-store.ts` | `fetchTrace()`, `buildTraceTree()` |
| Realtime store (catch-up) | `src/stores/realtime-store.ts` | `hydrateFromCatchUp()`, `reconcileResultFromCatchUp()` |
| Execution store (cleanup) | `src/stores/execution-store.ts` | `resetExecution()`, `cleanupNodeZustandState()` |
| Streaming event log (server) | `server/lib/events/streaming-event-log.ts` | `StreamingEventLog.append()` |
| Catch-up API endpoint | `server/routes/events.ts` | `GET /api/events/catch-up` |
| Data loader | `src/app.tsx` | `DataLoader()` |

---

## 9. Scenario Matrix

| Scenario | Recovery Path | User Experience |
|----------|--------------|----------------|
| Page refresh during execution | Layer 2 catch-up → full activity restored | Seamless, ~100ms delay |
| Page refresh after completion | Layer 2 catch-up → terminal status shown | Seamless |
| SSE network blip | Layer 2 incremental catch-up (afterSeq=lastSeq) | Brief gap, then events appear |
| Open on different device | Layer 2 full hydration | Full activity visible |
| Legacy execution (pre-streaming) | Layer 3 observation fallback | Activity reconstructed, ~300ms |
| Execution reset + refresh | All layers cleaned up | Clean "planned" state |
| User sign-out/in | `resetAllStores()` → fresh DataLoader | Clean slate, no data leakage |

---

## 10. Ephemeral vs. Persistent Data

Not all frontend state survives refresh. By design, some data is ephemeral:

| Data | Persisted? | Recovery |
|------|-----------|----------|
| Plan nodes, edges, statuses | Yes (DB) | DataLoader on mount |
| Execution activity events | Yes (streaming_events) | useRestoredExecution catch-up |
| Chat messages | Yes (streaming_events) | Session hydration |
| Pending approvals | Yes (streaming_events) | Hydration includes approval_request events |
| File trees | No (ephemeral cache) | Re-fetched within ~100-300ms |
| Machine skills | No (ephemeral cache) | Re-fetched on demand |
| Text token buffer | No (in-memory) | Not needed (text flushed to events at boundaries) |
| SSE connection state | No | Reconnects automatically |

See `FRONTEND_EPHEMERAL_CACHE.md` for the ephemeral cache design rationale.
