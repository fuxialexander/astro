# Refresh Robustness

How Astro preserves running agent state across page refreshes, SSE disconnects, and tab switches — and what needs to improve for mobile, offline, and multi-device scenarios.

## Problem

Agent workflows (task execution, plan generation, chat) run server-side and stream results via SSE. A page refresh destroys all in-memory frontend state: Zustand stores, SSE connections, pending approval dialogs. Without recovery, the user sees a blank screen while the agent continues working — and loses the ability to steer, approve, or observe the execution.

## Three-Layer Recovery Architecture

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Live SSE                                  │
│  EventSource → realtime-store / execution-store     │
│  (in-memory, lost on refresh)                       │
├─────────────────────────────────────────────────────┤
│  Layer 2: streaming_events table                    │
│  Append-only log, seq-indexed                       │
│  (survives refresh, primary recovery path)          │
├─────────────────────────────────────────────────────┤
│  Layer 3: Observation fallback                      │
│  Langfuse trace → observation-activity-bridge       │
│  (legacy data only, when streaming_events is empty) │
└─────────────────────────────────────────────────────┘
```

**Layer 1** is the hot path during normal operation. **Layer 2** is the primary recovery mechanism. **Layer 3** exists only for backward compatibility with executions that predate the streaming_events table.

## The Persistence Contract

### What Gets Persisted

Every structural SSE event is written to `streaming_events` *before* being sent to the client. The `seq` returned by `streamingEventLog.append()` becomes the SSE event's `id` field, enabling cursor-based catch-up.

| Event Type | Persisted | Contains |
|---|---|---|
| `init` | Yes | `executionId`, `nodeId`, `machineId`, `providerId`, `computeBackend` |
| `text` | Yes (batched) | Concatenated LLM token output |
| `session_init` | Yes | `sessionId`, `model` |
| `progress` | Yes | `progress` percentage, `message` |
| `tool_use` | Yes | `toolName`, `toolInput` |
| `tool_result` | Yes | `toolName`, `result`, `success` |
| `file_change` | Yes | `path`, `action`, `linesAdded`, `linesRemoved`, `diff` |
| `result` | Yes | `status`, `output`, `error`, `branchName`, `prUrl`, `summary` |
| `approval_request` | Yes | `requestId`, `question`, `options`, `machineId` |
| `approval_response` | Yes | `requestId`, `answer` |
| `steer_message` | Yes | `message`, `action`, `interrupt` |
| `heartbeat` | No | SSE keepalive only |
| `error` | Yes | `error`, `recoverable` |
| `aborted` | No | Client-side handler only; cancellation flows through `result` with failure status |
| `done` | No | Stream termination signal only |
| `safety_prompt` | Yes | `safetyTier`, `warning`, `options`, `machineId` |
| `safety_response` | Yes | `decision` |

### Text Batching

LLM tokens arrive one at a time. Writing a row per token would overwhelm the DB. Instead:

1. `streamingEventLog.appendText()` accumulates tokens in an in-memory buffer (`Map<string, string[]>`)
2. `streamingEventLog.flushText()` concatenates the buffer and writes a single `text` row
3. Flushing happens automatically before any structural event (`append()` calls `flushText()` first)
4. On SSE stream abort (page navigation), `stream.onAbort` calls `flushText()` to prevent data loss

This ensures text appears in the DB in chronological order relative to tool calls and other structural events.

### The Persist-Then-Send Pattern

```typescript
// server/routes/dispatch.ts — every persisted event follows this pattern:
const seq = await streamingEventLog.append(executionId, 'tool_use', data)
await stream.writeSSE({
  id: String(seq),      // SSE event ID = DB sequence number
  event: 'tool_use',
  data: JSON.stringify(data),
})
```

If the persist fails, the SSE event is never sent — the client never sees data that isn't recoverable. If the SSE send fails (client disconnected), the data is already in the DB.

## Recovery Flows

### Flow 1: Page Refresh

```
User refreshes page
  → DataLoader mounts
    → Phase 1: loadTeams() (sets X-Team-Id header)
    → Phase 2: loadExecutions() + connectRealtime() + loadAll()
      → execution-store.load() restores TaskExecution records from DB
        (includes executionId, machineId, status — enough for approval routing)
      → useRestoredExecution hook fires per active execution
        → hydrateFromCatchUp([executionId], afterSeq=0)
          → GET /api/events/catch-up?executionIds=X&afterSeq=0
          → hydrateStreamingEvents(rows) → HydratedStreamData
          → Populates taskStream: stdout, activityEvents, toolTraces,
            fileChanges, machineId, sessionId, model, status, ...
          → Rebuilds dynamicApprovals map from pending approval_request events
        → If streaming_events empty → fallback to observation store (Layer 3)
      → RealtimeClient.connect() opens new SSE connection
        → New live events append to the hydrated base
```

**Key detail:** `afterSeq=0` triggers "full hydration" mode — hydrated data is used only when existing in-memory data is empty (preferring live data if any arrived before hydration completed).

### Flow 2: SSE Disconnect + Reconnect

```
Network blip → EventSource.onerror
  → RealtimeClient.disconnect()
  → scheduleReconnect(3000ms)
  → 3 seconds later: RealtimeClient.connect(projectId)
    → EventSource.onopen fires (wasReconnect=true)
    → onReconnect callback:
      → Collects executionIds from active (non-terminal) taskStreams
      → hydrateFromCatchUp(activeIds, realtimeClient.lastSeq)
        → GET /api/events/catch-up?afterSeq=lastSeq
        → Only events with seq > lastSeq are returned
        → Appended to existing in-memory data (not replaced)
```

**Key detail:** `afterSeq > 0` triggers "reconnect" mode — caught-up events are *appended* to existing data, filling the gap without duplicating anything.

### Flow 3: Tab Switch (Visibility Change)

When a tab is backgrounded, browsers may throttle or kill the SSE connection. The `execution-store` guards against false failure marking:

```typescript
// execution-store.ts — SSE error handler
if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
  console.log('[execution] SSE interrupted by page unload, skipping failure marking')
  return  // Don't mark as failed — agent is still running server-side
}
```

When the tab returns to foreground, the SSE reconnection flow (Flow 2) fills in any missed events.

## Critical State: machineId

`machineId` identifies which agent runner machine is executing a task. It's required to:
- Send steer messages
- Respond to dynamic approvals (`ask_user_question`)
- Respond to safety prompts
- Route any user interaction back to the correct running agent

### machineId Recovery Chain

After refresh, multiple paths can recover `machineId`. The approval handlers try them in order:

```
1. approval.machineId       ← from dynamicApprovals map (hydrated from approval_request event)
2. executionStore.machineId ← from execution-store (persisted to DB on init)
3. executions scan          ← linear scan of all executions for matching executionId
4. taskStream.machineId     ← from realtime-store TaskStream (hydrated from init event)
```

The `init` event is persisted to `streaming_events`, so even if the execution store hasn't loaded yet, `hydrateFromCatchUp` extracts `machineId` from the `init` row and sets it on the TaskStream.

## Approval System Recovery

Pending approvals (agent asking `ask_user_question`) must survive refresh so the user can still answer.

### Persistence

Both sides of the approval conversation are persisted:
- `approval_request`: persisted when the agent runner sends an approval question
- `approval_response`: persisted when the user answers via `/api/dispatch/approval`

### Reconstruction

`hydrateStreamingEvents()` tracks both:
```
approvalRequests: Map<requestId, PendingApproval>   ← from approval_request events
answeredApprovals: Set<requestId>                   ← from approval_response events
pendingApprovals = approvalRequests.filter(r => !answeredApprovals.has(r.requestId))
```

After hydration, `hydrateFromCatchUp` rebuilds the `dynamicApprovals` map from `pendingApprovals`. The approval dialog reappears in the UI with the original question, options, and `machineId` — the user can answer as if nothing happened.

### Activity Timeline vs Pending State

Approval cards in the UI depend on **two independent data structures**:

1. **`taskStream.activityEvents`** — the full timeline. Contains both `approval_request` and `approval_response` entries. Used by `plan-chat-phase.tsx` to render `InlineApprovalCard` components and determine answered state via `answeredRequestIds`.

2. **`dynamicApprovals` Map** — the pending state. Contains only unanswered approvals. Used for the "waiting" header badge and routing responses to the correct machine.

These must stay consistent. In particular:

- **Activity events are append-only history.** Live SSE handlers must never delete historical `approval_request` or `approval_response` events from `taskStream.activityEvents`. Removing a historical `approval_request` causes the card to vanish; removing a historical `approval_response` causes the card to revert to unanswered.

- **The `dynamicApprovals` map is transient state.** It's correct to clear stale entries (e.g., removing old pending approvals when a new one arrives for the same task). This only controls whether the "pending" dialog UI appears — it does not affect the timeline.

- **Deduplication on the live path.** When a `task:approval_request` SSE event arrives for a `requestId` that already exists in `taskStream.activityEvents` (e.g., from hydration), it should be skipped rather than appended again.

## Execution Store vs Streaming Events

These serve different purposes:

| Concern | execution-store (DB) | streaming_events (DB) |
|---|---|---|
| **What** | Metadata: status, machineId, sessionId, branchName, prUrl, metrics | Full event timeline: every text chunk, tool call, file change |
| **When written** | On `init` and `result` events | On every structural event |
| **Size** | Small (one row per execution) | Large (hundreds of rows per execution) |
| **Loaded on refresh** | Immediately via `loadExecutions()` | On-demand via `hydrateFromCatchUp()` |
| **Used for** | Routing (machineId), status display, PR links | Activity feed reconstruction, approval recovery |

Both are needed. The execution store provides immediate metadata for routing. Streaming events provide the full timeline for UI reconstruction.

## Invariants

These properties must hold for refresh robustness to work:

1. **Every structural event is persisted before being sent via SSE.** If persist fails, the event must not be sent. This is the persist-then-send pattern.

2. **The `init` event must be persisted.** It carries `machineId`, which is required for all user interactions with the running agent. Without it, steer/approval/safety responses fail after refresh.

3. **SSE event IDs must equal `streaming_events.seq`.** The frontend tracks `lastSeq` from SSE event IDs. On reconnect, `afterSeq=lastSeq` fetches exactly the missed events — no duplicates, no gaps.

4. **Text must be flushed before structural events.** `flushText()` before `append()` ensures chronological ordering in the DB. Without this, hydrated text would appear after the tool call it preceded.

5. **`approval_request` and `approval_response` must both be persisted.** The hydrator subtracts answered approvals from requested ones to find pending approvals. Missing either side causes phantom or stuck approval dialogs.

6. **Page unload must not mark executions as failed.** The visibility check in the SSE error handler prevents false failure states when the user refreshes or switches tabs.

7. **Hydration must merge, not discard.** `afterSeq=0` (full hydration) uses hydrated events as the base and appends only genuinely new live events. `afterSeq>0` (reconnect) appends caught-up events to existing data. Neither mode may discard hydrated data — doing so loses historical events like `approval_response` when SSE races ahead of catch-up.

8. **`safety_prompt` and `safety_response` must both be persisted.** Same pattern as approvals: the hydrator subtracts responded prompts from requested ones to find pending safety prompts. Missing either side causes phantom or stuck safety dialogs.

9. **`taskStream.activityEvents` is append-only.** Live SSE handlers must never remove historical activity events. Deleting a past `approval_request` causes its card to vanish; deleting a past `approval_response` causes the card to revert to unanswered. The `dynamicApprovals` map (transient pending state) may be cleaned up freely, but the activity timeline must only grow.

10. **Hydrated `tool_use` and `tool_result` must share IDs.** The UI pairs tool events by `tool_result.id === tool_use.id` to determine completion. The hydrator must assign matching IDs (by walking back to find the most recent unmatched `tool_use` with the same `toolName`). Independent IDs cause every hydrated tool to render as perpetually "running."

---

## Known Gaps

Audit of current implementation against the invariants above. Ordered by impact.

### ~~GAP-1: `error` events not persisted~~ — FIXED

All three error paths in `dispatch.ts` (`onMachineDisconnected`, dispatch failure, activity timeout) now call `streamingEventLog.append(executionId, 'error', data)` before sending via SSE. The hydrator has a `case 'error':` handler that sets `status = 'error'` and pushes an error activity event.

### ~~GAP-2: `safety_prompt` not persisted~~ — FIXED

`onSafetyPrompt` in `dispatch.ts` now persists `safety_prompt` events. The `/api/dispatch/safety-decision` endpoint persists `safety_response` events. The hydrator tracks both and reconstructs `pendingSafetyPrompts` (same pattern as `pendingApprovals`). `hydrateFromCatchUp` rebuilds the `safetyPrompts` map from pending prompts.

### ~~GAP-3: `flushText` buffer deletion ordering~~ — FIXED

`this.textBuffers.delete(executionId)` now runs *after* successful `db.insert()`, not before. If the insert fails, the buffer is preserved for retry.

### ~~GAP-4: Catch-up limited to 1000 rows with no pagination~~ — FIXED

Server catch-up response now includes `hasMore: true` when `events.length >= limit`. Client-side `fetchStreamingEventsCatchUp` paginates automatically, fetching until `hasMore === false`. Default limit raised from 1000 to 2000 per page.

### ~~GAP-5: `lastSeq` from catch-up response is discarded~~ — FIXED

`RealtimeClient` now has a `lastSeq` setter (only updates if new value > current). `hydrateFromCatchUp` updates `realtimeClient.lastSeq` with the returned `lastSeq` after every catch-up.

### ~~GAP-6: No reconnect backoff~~ — FIXED

Exponential backoff: 3s → 6s → 12s → 24s → 48s → 60s cap, resets on successful connect. Reconnection is deferred when `document.visibilityState === 'hidden'` and resumes on visibility change.

### ~~GAP-6.5: Full hydration discards historical events~~ — FIXED

**Caused approval cards to revert to unanswered after refresh.** The old full-hydration logic (`afterSeq=0`) used "prefer existing" semantics: if *any* live SSE events arrived before hydration completed, all hydrated events were discarded. This caused historical `approval_response` events (and other historical data) to be lost when SSE reconnect raced ahead of catch-up hydration. Fixed by switching to a merge strategy: hydrated events (full DB history) form the base, and only genuinely new live events (by timestamp) are appended.

### ~~GAP-6.6: Live SSE handler deletes historical approval events~~ — FIXED

**Caused approval cards to disappear entirely after refresh.** The `task:approval_request` SSE handler in `realtime-store.ts` removed all previous `approval_request` activity events (with different `requestId`s) from `taskStream.activityEvents` when a new approval arrived. Intent was to clear "stale" retries, but effect was destructive: after page refresh, hydration restored the full approval timeline, then the next live `task:approval_request` event wiped all historical approvals. Without the `approval_request` in the timeline, `InlineApprovalCard` never renders — the card vanishes. The matching `approval_response` block renders as `null`, so it's invisible too.

**Symptoms (all three observed together):**
- **Cards vanish** — historical `approval_request` deleted by the filter, card gone
- **Cards show unanswered** — `approval_request` survived (from hydration or SSE) but `approval_response` was lost (GAP-6.5 race or deleted alongside)
- **Cards show completed** — both events survived (no new SSE approval arrived to trigger the destructive filter)

**Fix:** The `task:approval_request` handler now appends new events without removing old ones (invariant 9). Deduplication by `requestId` prevents double-rendering when hydration and SSE both produce the same event. The `dynamicApprovals` map cleanup (removing stale pending entries) was already correct and unchanged.

### ~~GAP-6.7: Hydrated tool_use/tool_result have mismatched IDs~~ — FIXED

**Caused all hydrated tool calls to render as perpetually "running" after refresh.** The hydrator assigned independent auto-incrementing IDs to `tool_use` and `tool_result` events (`hydrated-1`, `hydrated-2`, ...). The UI (`groupActivityEvents` → `ToolBlock`) pairs them by `tool_result.id === tool_use.id`. Since IDs never matched, `hasResult` was always `false` — every tool showed a spinning animation, even completed ones with results.

**Fix:** When hydrating a `tool_result`, the hydrator now walks backward through activity events to find the most recent unmatched `tool_use` with the same `toolName` and reuses its ID (invariant 10). This mirrors the same matching logic already used for `toolTraces`.

### GAP-7: `hydrateFromCatchUp` has no inflight deduplication

**Severity: Low-Medium**

Two independent callers invoke `hydrateFromCatchUp`:
1. `useRestoredExecution` hook (per-component, `afterSeq=0`)
2. `realtimeClient.onReconnect` callback (all active executions, `afterSeq=lastSeq`)

There is no mutex, no `Set<string>` of in-flight IDs, and no abort. Concurrent calls for the same executionId can race. The full-hydration guard (`existing.activityEvents.length > 0`) prevents duplicate activity events, but metadata fields (`status`, `output`, `error`) are applied unconditionally — a stale full-hydration response arriving after a live `task:result` could temporarily overwrite the correct terminal status.

**Fix:** Cache the `Promise` for each in-flight executionId. If `hydrateFromCatchUp` is called for an executionId that already has a pending fetch, return the existing promise instead of starting a new one.

### GAP-8: `hydrateStreamingEvents` called 3x for same events

**Severity: Low**

Inside `hydrateFromCatchUp`, `hydrateStreamingEvents(execEvents)` is called three times per execution: once for taskStreams, once for dynamicApprovals reconstruction, and once for `reconcileResultFromCatchUp`. The function is pure and deterministic, so results are identical — this is wasteful but not incorrect.

**Fix:** Call once, cache the result, reuse across all three phases.

### ~~GAP-9: `events.ts` `onAbort` doesn't call `flushText`~~ — FIXED

**Severity: Low**

The global SSE fan-out stream in `events.ts` buffers text via `streamingEventLog.appendText()` on the relay-direct fallback path, but its `onAbort` handler did not call `flushText()`. Text buffered via this path was lost when the client disconnected. Only affected the relay-direct fallback case (after page refresh when the dispatch stream is gone but the relay is still running).

**Fix:** Added `streamingEventLog.flushAll()` call in the `events.ts` `onAbort` handler to flush all pending text buffers before cleanup.

### GAP-10: Cleanup deletes events by age, not by execution status

**Severity: Low**

`cleanupOldStreamingEvents` deletes all rows older than 7 days regardless of execution status. A task queued for 7+ days could have its `init` event deleted, breaking `machineId` recovery.

**Fix:** Join against execution status or add a `NOT IN (select executionId from active_executions)` filter. Alternatively, exempt `init` and `result` events from age-based cleanup since they carry critical metadata.

### ~~GAP-11: `visibilityState` unreliable during page refresh, causing false failure marking~~ — FIXED

**Severity: High**

When the page refreshes during task execution, the SSE fetch connection is dropped, causing `parseSSEStream` to throw a `TypeError` (e.g., "Failed to fetch" or "NetworkError when attempting to fetch resource"). The catch block in `execution-store.ts` checked `document.visibilityState === 'hidden'` to detect page unload, but `visibilityState` can still be `'visible'` when the fetch error fires — the `visibilitychange` event fires AFTER `beforeunload` in the navigation lifecycle.

**Symptom:** After every page refresh during execution, the task was falsely marked as `failure` with the network error message, and the node status was set to `awaiting_judgment`. The judgment banner (Approve/Reset/Prune) appeared with the error text, even though the agent runner was still running normally.

**Fix:** Added a module-level `isPageUnloading` flag set by a `beforeunload` event listener. `beforeunload` fires deterministically BEFORE fetch connections are dropped, so the flag is always set in time. The catch block now checks `isPageUnloading` first, falling back to `visibilityState` as a secondary guard. Applied to all three SSE catch blocks (task execution, plan-session, plan-session-forProject).

---

## Future: Mobile, Offline, and Multi-Device

The current architecture is web-browser-centric. An iOS/mobile app connecting to the same backend introduces new constraints: unreliable networks, app suspension, offline viewing, and multiple devices observing or interacting with the same execution simultaneously.

### Transport: Frontend SSE Is Not Enough for Mobile

**Current architecture:** The app already uses WebSocket — but only on the server side. Agent runners connect to the relay server via WebSocket (port 3002, `ws` package). The **frontend**, however, uses SSE exclusively:
- Global event stream: `EventSource` → `GET /api/events/stream` (via `RealtimeClient`)
- Per-task execution stream: `fetch()` + chunked `ReadableStream` → `POST /api/dispatch/task`
- User actions (steer, approval, safety): separate `fetch()` POST calls

This split works on desktop but has problems on mobile:
- iOS aggressively kills background connections. SSE streams are severed when the app is suspended (within seconds of backgrounding).
- Mobile networks (cellular handoffs, tunnel transitions) cause frequent disconnects — far more than desktop WiFi.
- SSE is unidirectional (server → client). The POST calls for steer/approval can have different connectivity states than the SSE stream — the user may see the approval question (SSE worked) but fail to submit the answer (POST fails on a flaky connection).
- `EventSource` doesn't support custom headers — the auth token is passed as a query parameter, which is less secure and doesn't support token refresh without reconnecting.

**Recommendation:** Extend the existing relay WebSocket pattern to the frontend. The backend already runs a `WebSocketServer` on port 3002 for agent runners. Add a frontend-facing WebSocket endpoint (or reuse port 3001 via HTTP upgrade) that replaces both SSE paths and the POST calls with a single bidirectional connection:

```
Current:
  Agent-runner ──[WebSocket]──> Relay (3002)
  Frontend     ──[SSE + POST]──> Hono (3001)

Proposed:
  Agent-runner ──[WebSocket]──> Relay (3002)
  Frontend     ──[WebSocket]──> Hono (3001)  (SSE kept as fallback)
    ├── events (server → client)     replaces EventSource
    ├── steer (client → server)      replaces POST /api/dispatch/steer
    ├── approval (client → server)   replaces POST /api/dispatch/approval
    └── heartbeat (bidirectional)    replaces SSE keepalive
```

The `streaming_events` table and `seq`-based catch-up remain unchanged — WebSocket is just a different transport for the same event stream. On reconnect, the same `afterSeq` catch-up logic applies. Keep SSE as a fallback for environments where WebSocket is blocked (corporate proxies).

### Offline Viewing: Client-Side Event Cache

**Problem:** After the app is killed and relaunched without network, the user sees nothing. All activity data is fetched from the server on mount — there is no local cache.

**Recommendation:** Cache `streaming_events` rows on the client in IndexedDB (web) or SQLite (mobile). The cache is a mirror of the server-side `streaming_events` table, indexed by `(executionId, seq)`.

```
Hydration priority:
1. Client-side cache (instant, works offline)
2. Server catch-up (fills gaps since last cached seq)
3. Live SSE/WebSocket (real-time updates, cached as they arrive)
```

**Write path:** Every event received via SSE/WebSocket is written to the local cache before being applied to the Zustand store. On next launch, the client reads from the local cache first (instant UI), then calls catch-up with `afterSeq = max(cached seq)` to fill any gap.

**Eviction:** Mirror the server-side 7-day retention. Delete cached events for completed executions older than 7 days. Keep `init` and `result` events longer (they're small and carry critical metadata).

**Conflict model:** The local cache is append-only and immutable (same as the server table). No conflicts are possible — events are facts that happened, not mutable state.

### Multi-Device: Approval Contention

**Problem:** Two devices (laptop + phone) observe the same execution. An approval prompt appears on both. If the user answers on the phone, the laptop still shows the pending prompt until it receives the `approval_response` event. If the user also clicks on the laptop before the response event arrives, a duplicate response is sent.

**Current mitigation (partial):** The `approval_response` event is persisted and the hydrator filters answered approvals from `pendingApprovals`. But this only works on page refresh — not in real-time across devices.

**Recommendation:**

1. **Server-side idempotency:** The `/api/dispatch/approval` endpoint should reject duplicate responses for the same `requestId` (return 409 Conflict). The relay should only forward the first response to the agent runner.

2. **Real-time cross-device sync:** When an approval is answered, broadcast an `approval_response` event to all connected clients (not just the one that answered). The frontend should immediately dismiss the prompt on all devices when this event arrives.

3. **Optimistic UI with rollback:** When the user clicks "Confirm," immediately show the answered state. If the server returns 409 (already answered by another device), update the UI with the actual answer from the other device.

### Multi-Device: Steer Message Ordering

**Problem:** Two users (or the same user on two devices) send steer messages to the same execution. The agent runner receives them in network-arrival order, which may differ from user-intent order.

**Recommendation:** Steer messages are already fire-and-forget with no ordering guarantee. This is acceptable — the agent processes them as they arrive. No change needed, but document this behavior so users understand that rapid steering from multiple devices may interleave unpredictably.

### Mobile App Suspension

**Problem:** iOS suspends apps within seconds of backgrounding. The WebSocket/SSE connection is killed. When the app resumes, the connection must be re-established and caught up.

**Recommendation:** The existing reconnect + catch-up architecture handles this correctly *if* the client-side cache is in place. The flow becomes:

```
App suspended → connection killed
App resumed → check local cache for last seq
  → reconnect WebSocket/SSE
  → catch-up from lastCachedSeq
  → apply missed events to UI + cache
```

Without the local cache, app resume is equivalent to a cold start — the full hydration path runs. With the cache, it's equivalent to a reconnect — only the gap is fetched.

**Push notifications:** For time-sensitive events (approval requests, execution completion), send a push notification that wakes the app. The app reconnects, catches up, and shows the approval dialog. This is critical for mobile — the user should not need to keep the app open to receive approval prompts.

### API Design for Mobile Clients

The current catch-up API (`GET /api/events/catch-up`) is already mobile-friendly in principle:
- Stateless cursor (`afterSeq`) — no session affinity required
- JSON response — easy to parse on any platform
- Single endpoint for all execution IDs — reduces request count

**Improvements needed for mobile:**

1. **Pagination:** Add `hasMore` to the response. Mobile clients may have limited memory and should paginate through large result sets rather than requesting 5000 rows at once.

2. **Compression:** Enable gzip/brotli on the catch-up endpoint. Mobile networks benefit significantly from smaller payloads.

3. **Conditional GET:** Add `ETag` or `Last-Modified` headers based on the max `seq` in the response. If the client's cache is already up to date, return 304 Not Modified.

4. **Batch metadata endpoint:** A lightweight endpoint that returns only `{ executionId, status, machineId, lastSeq }` for a list of execution IDs — enough for the mobile app to show a status list without fetching the full event timeline. The full timeline is fetched on-demand when the user taps into an execution.

### Summary: What to Build

| Priority | Item | Status |
|---|---|---|
| ~~**P0**~~ | ~~Persist `error` and `safety_prompt` events (GAP-1, GAP-2)~~ | **FIXED** |
| ~~**P0**~~ | ~~Fix `flushText` buffer deletion ordering (GAP-3)~~ | **FIXED** |
| ~~**P0**~~ | ~~Full hydration discards historical events (GAP-6.5)~~ | **FIXED** |
| ~~**P0**~~ | ~~Live SSE handler deletes historical approval events (GAP-6.6)~~ | **FIXED** |
| ~~**P0**~~ | ~~Hydrated tool_use/tool_result ID mismatch (GAP-6.7)~~ | **FIXED** |
| ~~**P1**~~ | ~~Catch-up pagination (GAP-4)~~ | **FIXED** |
| ~~**P1**~~ | ~~Update `lastSeq` from catch-up response (GAP-5)~~ | **FIXED** |
| ~~**P1**~~ | ~~Reconnect backoff + visibility check (GAP-6)~~ | **FIXED** |
| ~~**P0**~~ | ~~False failure marking on page refresh (GAP-11)~~ | **FIXED** |
| **P1** | Server-side approval idempotency | Required for multi-device |
| **P2** | WebSocket transport option | Required for mobile (bidirectional, single connection) |
| **P2** | Client-side event cache (IndexedDB/SQLite) | Offline viewing, instant resume |
| **P2** | Push notifications for approvals | Mobile users need to be woken |
| **P2** | Batch metadata endpoint | Mobile status list without full timeline |
| **P3** | `hydrateFromCatchUp` inflight dedup (GAP-7) | Race condition prevention |
| **P3** | Cache `hydrateStreamingEvents` result (GAP-8) | Performance |
| **P3** | Conditional GET on catch-up endpoint | Bandwidth savings for mobile |

---

## Adding New Persisted Events

When adding a new SSE event type that should survive refresh:

1. **Server:** Add `streamingEventLog.append(executionId, 'new_type', data)` before `stream.writeSSE()`. Use the returned `seq` as the SSE event `id`.

2. **Hydrator:** Add `case 'new_type':` to the switch in `hydrateStreamingEvents()`. Extract relevant fields into `HydratedStreamData` (add new fields to the interface if needed).

3. **Realtime store:** In `hydrateFromCatchUp`, apply the new hydrated fields to the TaskStream or other store state via the `metadata` object.

4. **Test:** Start an agent workflow, refresh mid-execution, verify the new data appears in the UI.

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
| API client (catch-up) | `src/lib/api-client.ts` | `fetchStreamingEventsCatchUp()` |
| Realtime client (SSE) | `src/lib/realtime-client.ts` | `RealtimeClient`: SSE connection, reconnect, `lastSeq` tracking |
| DB schema | `packages/core/src/db/schema.ts` | `streaming_events` table schema |
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

---

## 11. WebSocket Migration Compatibility

The three-layer recovery architecture is **transport-agnostic**. When the frontend transport migrates from SSE to WebSocket (see [WebSocket Roadmap](../websocket.md), [#513](https://github.com/fuxialexander/astro/issues/513)):

| Component | Impact |
|-----------|--------|
| `streaming_events` table | **None** — writes happen in dispatch/relay, not transport |
| `StreamingEventLog` | **None** — append/flush logic unchanged |
| `GET /api/events/catch-up` | **None** — HTTP endpoint, used by both SSE and WS reconnect |
| `hydrateStreamingEvents()` | **None** — converts DB rows to typed state |
| `mergeHydratedAndLive()` | **None** — timestamp-based merge, transport-agnostic |
| `useRestoredExecution` | **None** — 3-source fallback works with any live event source |
| `RealtimeClient` | **Refactored** — transport abstraction (`WsTransport` primary, `SseTransport` fallback) |
| Reconnect flow | **Enhanced** — WS `resume` message as fast first-pass, then same DB catch-up as fallback |

The `seq`-based cursor system maps directly: SSE `id:` field → WS message `id` field, both containing the `streaming_events.seq` value. The `lastSeq` tracking, catch-up pagination, and merge logic all carry over unchanged.
