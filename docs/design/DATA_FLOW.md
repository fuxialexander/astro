# Astro Data Flow — Design Document

## 1. Overview

Astro uses a **three-channel architecture** to deliver data between the database and the frontend. Every channel ultimately reads from or writes to the same database (PGlite in local mode, PostgreSQL via Supabase in production). This document explains how data moves through each channel, what happens when connections break, and how the system recovers.

**Related documents:**
- `DATA_MODEL.md` — Table definitions and entity relationships
- `RELAY.md` — WebSocket relay protocol details
- `ARCHITECTURE.md` — System-level architecture

---

## 2. The Three Channels

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React + Zustand stores)                                  │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │plan-store │  │execution-    │  │realtime-     │                 │
│  │           │  │store         │  │store         │                 │
│  └─────┬────┘  └──────┬───────┘  └──────┬───────┘                 │
│        │               │                 │                          │
└────────┼───────────────┼─────────────────┼──────────────────────────┘
         │               │                 │
    ┌────┴────┐    ┌─────┴─────┐    ┌──────┴──────┐
    │  REST   │    │    SSE    │    │  WebSocket  │
    │  HTTP   │    │  Stream   │    │  (Relay)    │
    └────┬────┘    └─────┬─────┘    └──────┬──────┘
         │               │                 │
         ▼               ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BACKEND (Hono + Node.js)                                           │
│  ┌──────────────┐  ┌─────────────────┐  ┌────────────────┐        │
│  │ Data Routes   │  │ Streaming Event │  │ Relay Server   │        │
│  │ /api/data/*   │  │ Log + Buffer    │  │ (port 3002)    │        │
│  └──────┬───────┘  └────────┬────────┘  └───────┬────────┘        │
│         │                   │                    │                  │
│         └───────────┬───────┴────────────────────┘                 │
│                     ▼                                               │
│         ┌──────────────────────┐                                   │
│         │  Drizzle ORM         │                                   │
│         │  (dual-driver)       │                                   │
│         └──────────┬───────────┘                                   │
└────────────────────┼────────────────────────────────────────────────┘
                     ▼
         ┌──────────────────────┐
         │  PostgreSQL / PGlite │
         │  (single source of   │
         │   truth)             │
         └──────────────────────┘
```

### 2.1 Channel Summary

| Channel | Protocol | Direction | Purpose | Recovery |
|---------|----------|-----------|---------|----------|
| **REST** | HTTP `GET/POST/PATCH/DELETE` | Bidirectional | CRUD operations, page load hydration | Idempotent — just re-fetch |
| **SSE** | HTTP chunked `text/event-stream` | Server → Client | Live task execution, chat streaming, machine events | Catch-up from `streaming_events` table |
| **WebSocket** | WS on port 3002 | Bidirectional (server ↔ machines) | Relay: dispatch tasks to machines, receive results | Machine reconnect + task re-queue |

---

## 3. REST Channel — CRUD & Page Load

### 3.1 Frontend → Backend → Database

The frontend never touches the database directly. All mutations go through `dataClient` (`src/lib/data-client.ts`) → HTTP endpoints → Drizzle ORM.

```
User action (create project, update node, etc.)
    ↓
dataClient.post('/api/data/projects', { name: '...' })
    ↓
HTTP POST with headers:
  Authorization: Bearer {JWT}
  X-Team-Id: {teamId}
  Content-Type: application/json
    ↓
Backend: requireAuth middleware → teamScopeFilter()
    ↓
Drizzle: db.insert(projects).values({...})
    ↓
Database: INSERT INTO projects ...
    ↓
Response: JSON (snake_case from DB)
    ↓
dataClient: snakeToCamel() conversion
    ↓
Zustand store update
```

### 3.2 Page Load Hydration

When the browser loads (or refreshes), `DataLoader` (`src/components/data-loader.tsx`) triggers a cascade of REST calls. Plan and execution stores use **slim mode** to exclude large text fields, deferring full loads to per-project navigation.

```
DataLoader mounts
  ├─ 1. GET /api/data/teams          → team-store (loads memberships + default team context)
  ├─ 2. GET /api/data/profile        → settings-store
  ├─ 3. GET /api/data/projects       → project-store
  ├─ 4. GET /api/data/plan?slim=1    → plan-store (nodes + edges, no content/executionOutput)
  ├─ 5. GET /api/data/executions?slim=1 → execution-store (no streamText)
  ├─ 6. GET /api/data/chat           → chat-store (keyed by nodeId)
  ├─ 7. GET /api/data/initiatives    → initiative-store
  └─ 8. GET /api/data/machines       → machine-store

Per-project load (triggered by useProjectData hook on navigation):
  ├─ GET /api/data/plan/:projectId   → plan-store.loadForProject (merges full data)
  └─ GET /api/data/executions?projectId=X → execution-store.loadForProject (merges full data)
```

**Core project/task reads are cross-team by membership**: the backend applies an all-teams scope across every team the user belongs to. Team-owned standalone resources still use the default team context when needed.

For example, project and initiative reads behave like:
```sql
WHERE team_id IN (...)
```

This ensures User A never sees data from teams they do not belong to, even if they share a database.

### 3.3 Two-Tier Lazy Loading

To reduce initial page load from ~10-50 MB to ~1-5 MB, plan and execution data uses slim/full tiers:

**Tier 1 — Slim Global Load (startup):**
- `GET /api/data/plan?slim=1` — All nodes/edges across all projects, but `content` and `executionOutput` are null
- `GET /api/data/executions?slim=1` — All execution metadata, but `streamText` is empty string

**Tier 2 — Full Per-Project Load (on navigation):**
- `GET /api/data/plan/:projectId` — Full node data including content and executionOutput for one project
- `GET /api/data/executions?projectId=X` — Full executions including streamText for one project

**What triggers the full load:** The `useProjectData` hook (`src/hooks/use-project-data.ts`) fires when the user navigates to `/project/:id/*` or `/project/:id/task/:nodeId`. It calls `planStore.loadForProject(projectId)` and `executionStore.loadForProject(projectId)` in parallel.

**Merge behavior:**
- **Plan store**: replaces all nodes/edges for the target project, preserves other projects' data. Rebuilds dependency map from edges.
- **Execution store**: replaces completed executions, but **preserves running executions** (they have live SSE streaming buffers that would be lost on replacement).

**Pages using slim data only** (no per-project load):
Dashboard, Projects list, My Tasks, Active Tasks, Initiatives, Environments, Playground, Workflows, Examples

**Pages triggering full per-project load:**
Plan View (`/project/:id/*`), Task Detail (`/project/:id/task/:nodeId`)

See `LAZY_DATA_LOADING.md` for the complete design including content sync patterns, slim-to-full transition handling, and 31 unit tests.

### 3.4 Key REST Endpoints

| Endpoint | Method | Source | Database Table |
|----------|--------|--------|----------------|
| `/api/data/projects` | GET/POST | `server/routes/data.ts` | `projects` |
| `/api/data/plan/:projectId` | GET/PUT | `server/routes/data.ts` | `plan_nodes`, `plan_edges` |
| `/api/data/plan/nodes` | POST | `server/routes/data.ts` | `plan_nodes` |
| `/api/data/plan/nodes/:id` | PATCH/DELETE | `server/routes/data.ts` | `plan_nodes` |
| `/api/data/executions` | GET/POST | `server/routes/data.ts` | `task_executions` |
| `/api/data/sessions` | GET/POST | `server/routes/data.ts` | `sessions` |
| `/api/data/chat` | GET | `server/routes/data.ts` | `task_chat_sessions`, `task_chat_messages` |

---

## 4. SSE Channel — Live Streaming

SSE (Server-Sent Events) delivers real-time data from the backend to the browser during task execution and AI chat. The browser opens a long-lived HTTP connection and receives a stream of typed events.

### 4.1 Event Flow

```
Agent Runner (machine)
    ↓ WebSocket message
Relay Server (port 3002)
    ↓ in-process callback
Backend: Dispatch Engine
    ├─ StreamingEventLog.append()  →  INSERT INTO streaming_events (persist)
    ├─ EventBuffer.push()          →  in-memory ring buffer (fan-out)
    └─ SSE response.write()        →  HTTP chunked to browser
    ↓
Browser: Global SSE bus (single EventSource per session)
    ↓
realtime-store: taskStreams (keyed by executionId/sessionId)
    ↓
useStreamEvents(streamId) hook (src/hooks/use-stream-events.ts)
    ├─ Hydrates from streaming_events on mount (catch-up)
    ├─ Reads live events from realtime-store taskStreams
    ├─ Groups into DisplayBlocks via groupActivityEvents()
    └─ Derives StreamStatus via deriveStreamStatus()
    ↓
React components render
```

### 4.2 SSE Event Types

**Task Execution Events:**

| Event | Payload | Persisted? | Description |
|-------|---------|-----------|-------------|
| `init` | `{ executionId, nodeId, machineId, sessionId }` | Yes | Execution started |
| `session_init` | `{ sessionId, model }` | Yes | Claude session created |
| `text` | `{ text }` | Yes (batched) | Stdout text output |
| `tool_use` | `{ toolName, toolInput }` | Yes | Tool call started |
| `tool_result` | `{ toolName, output, success }` | Yes | Tool call completed |
| `file_change` | `{ path, action, linesAdded, linesRemoved }` | Yes | File modified |
| `progress` | `{ percentage, message }` | Yes | Progress update |
| `result` | `{ status, output, error, branchName, prUrl }` | Yes | Execution finished |
| `error` | `{ message }` | Yes | Execution error |
| `done` | `{}` | No | Stream closing signal |
| `heartbeat` | `{}` | No | Keep-alive pulse |

**Machine Events:**

| Event | Description |
|-------|-------------|
| `machines:snapshot` | Initial list of connected machines |
| `machine:connected` | Machine joined the relay |
| `machine:disconnected` | Machine left the relay |

**Approval Events:**

| Event | Description |
|-------|-------------|
| `task:approval_request` | Agent needs user permission for an action |
| `task:approval_response` | User's approval/denial |
| `task:safety_prompt` | High-tier operation warning |

### 4.3 Event Persistence

Every structural event is persisted to the `streaming_events` table immediately. This table is the **recovery source** when SSE connections drop.

```sql
CREATE TABLE streaming_events (
  seq    INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,  -- immutable ordering
  execution_id  TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  data          JSONB NOT NULL,
  created_at    TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_streaming_events_exec_seq ON streaming_events(execution_id, seq);
```

**Text buffering**: Consecutive `text` events are accumulated in memory and flushed as a single row at structural event boundaries (tool_use, tool_result, etc.). This prevents thousands of tiny rows for long outputs.

**Persistence via `StreamingEventLog`** (`server/lib/streaming-event-log.ts`):
- `append(executionId, eventType, data)` → INSERT
- `getEvents(executionId, afterSeq, limit)` → SELECT for catch-up
- `cleanup(olderThan)` → DELETE old rows (retention policy)

---

## 5. WebSocket Channel — Machine Relay

The WebSocket channel connects the backend to Agent Runner processes on user machines. It is **not directly exposed to the browser** — the browser only sees the effects via SSE.

### 5.1 Relay Architecture

```
Browser ←── SSE ──── Backend ←── WebSocket ──── Machine 1 (laptop)
                         │
                         └──── WebSocket ──── Machine 2 (HPC cluster)
                         │
                         └──── WebSocket ──── Machine 3 (cloud VM)
```

**Relay Server** (`server/lib/relay-server.ts`) runs on port 3002:

| Direction | Message | Description |
|-----------|---------|-------------|
| Backend → Machine | `dispatch:execute` | Send task to run |
| Backend → Machine | `dispatch:cancel` | Abort running task |
| Backend → Machine | `dispatch:steer` | Inject guidance into running task |
| Machine → Backend | `execution:init` | Task started |
| Machine → Backend | `execution:text` | Stdout output |
| Machine → Backend | `execution:tool_use` | Tool call |
| Machine → Backend | `execution:result` | Task completed/failed |
| Machine ↔ Backend | `heartbeat` | Connection keep-alive (30s interval) |

### 5.2 Machine Registration

Machines connect via OAuth2 Device Authorization Grant (RFC 8628):

```
Machine: POST /api/auth/device/code  →  { userCode, deviceCode }
User:    Opens browser, enters userCode
Backend: Verifies, creates refresh token
Machine: Polls POST /api/auth/device/token  →  { accessToken, refreshToken }
Machine: WS connect to wss://relay:3002 with accessToken
Relay:   Registers machine, emits 'machine:connected' to all SSE clients
```

### 5.3 Dispatch Lifecycle

```
User clicks "Run" on task node
    ↓
POST /api/dispatch/execute { nodeId, projectId }
    ↓
DispatchEngine:
  ├─ Validate dependencies satisfied
  ├─ Assemble context (vision doc, dependency outputs, instructions)
  ├─ Select machine (MachineSelector)
  └─ Send via relay: relayServer.sendTaskExecution(machineId, payload)
    ↓
Relay: Forward to machine via WebSocket
    ↓
Agent Runner: Execute task (Claude Code, etc.)
    ├─ Stream events back via WebSocket
    └─ Each event: relay → backend → streaming_events table + SSE stream
    ↓
Result event arrives
    ├─ Update plan_nodes row (status, executionOutput, etc.)
    ├─ Check downstream dependencies → auto-dispatch ready tasks
    └─ Emit task:result via SSE to browser
```

---

## 6. Recovery: When Connections Break

### 6.1 Design Principle

> **The database is always the ground truth.** SSE and WebSocket are delivery optimizations.
> If any delivery channel fails, the system recovers by reading from the database.

This works identically for both modes:
- **Local mode**: PGlite (Postgres-in-WASM) stores data in `~/.astro/pglite/`
- **Production mode**: Supabase PostgreSQL stores data remotely

### 6.2 SSE Disconnection Recovery

When the browser's SSE connection drops (network hiccup, tab backgrounding, server restart):

```
SSE connection drops
    ↓
Browser detects: EventSource error / fetch stream ends
    ↓
realtime-store: detects SSE drop, reconnects global SSE bus
    ↓
useStreamEvents() hook: visibility-change catch-up
  ├─ On tab becoming visible, calls hydrateFromCatchUp(streamId, lastPersistedSeq)
  │         ↓
  │     GET /api/events/catch-up?executionIds=X&afterSeq=123&limit=2000
  │         ↓
  │     Backend: SELECT * FROM streaming_events
  │              WHERE execution_id IN ('X') AND seq > 123
  │              ORDER BY seq LIMIT 2000
  │         ↓
  │     Response: { events: [...], lastSeq: N, hasMore: boolean }
  │         ↓
  │     hydrateStreamingEvents(events):
  │       ├─ Reconstruct stdout from 'text' events
  │       ├─ Pair tool_use ↔ tool_result
  │       ├─ Extract file changes
  │       ├─ Identify pending approvals
  │       └─ Return HydratedStreamData
  │         ↓
  │     Merge into realtime-store taskStreams
  │     useStreamEvents() re-derives displayBlocks + status
  │         ↓
  │     If hasMore: paginate (re-call with afterSeq=N)
  │     If task still running: live events continue via global SSE bus
  └─ Skips catch-up if stream is actively running (avoids race with live SSE)
```

**Key: `seq` column** — The auto-incrementing `seq` on `streaming_events` provides a total ordering. The client tracks its `lastSeq` and asks "give me everything after this." No events are lost or duplicated.

### 6.3 Page Refresh Recovery

When the user refreshes the browser (F5, navigation, tab close + reopen):

```
Page loads
    ↓
DataLoader: REST calls hydrate all stores (projects, plan, executions, chat)
    ↓
plan-store: loads nodes, sees nodes with executionId set
    ↓
execution-store: loads execution metadata from /api/data/executions
    ↓
useStreamEvents(streamId): mounts with streamId, triggers hydration
    ├─ Calls hydrateFromCatchUp(streamId, 0) on mount
    └─ Reconstructs full activity timeline from streaming_events into realtime-store taskStreams
    ↓
UI renders exactly as if the user never left
    ├─ Stdout text appears in the activity feed
    ├─ Tool calls show with their results
    ├─ File changes listed
    └─ If task still running: live events continue via global SSE bus
```

### 6.4 Machine Disconnection Recovery

When a machine's WebSocket connection drops:

```
WebSocket closes
    ↓
Relay: detects disconnect (heartbeat timeout or TCP close)
    ├─ Mark machine as disconnected
    ├─ Emit 'machine:disconnected' to SSE clients
    └─ If task was running on this machine:
        ├─ Keep task in 'running' state (machine may reconnect)
        └─ After timeout (configurable): mark task as failed
    ↓
Machine reconnects:
    ├─ Re-authenticates (refresh token)
    ├─ Re-registers with relay
    └─ Relay emits 'machine:connected'
    ↓
If queued tasks exist for this machine:
    └─ Relay re-dispatches from queue
```

### 6.5 Multi-Instance Production Recovery

In production with 2 Fly.io instances + Upstash Redis:

```
Instance A: handles task dispatch, receives machine results
Instance B: handles user's SSE connection
    ↓
Instance A persists events to DB (streaming_events)
Instance A publishes events to Redis Pub/Sub (relay:task:streaming)
    ↓
Instance B subscribes to Redis, forwards to SSE client
    ↓
If Instance B restarts:
    ├─ Client detects SSE drop
    ├─ Client reconnects (may hit Instance A — round-robin)
    ├─ Client sends GET /api/events/catch-up?afterSeq=lastSeq
    ├─ Any instance can serve catch-up (reads from shared DB)
    └─ No data loss — DB is the shared source of truth
```

**Filesystem requests** (directory listing, file content, repo detection) may also cross instances. If a browser's HTTP request hits Instance A but the machine's WebSocket is on Instance B, the request is proxied via Redis (`relay:ws:proxy:request` → `relay:ws:proxy:response`). This is transparent to the frontend.

**Machine registry** is synchronized: each instance maintains a hybrid in-memory registry — local WebSocket connections + remote machines synced via Redis `relay:machine:state` events. On startup, instances hydrate from `relay:machines` HSET.

---

## 7. Database: Dual-Driver Architecture

### 7.1 Driver Selection

```typescript
// packages/core/src/db/index.ts (simplified)
async function initDb() {
  if (isLocalMode()) {
    const pg = new PGlite(dataDir)     // Postgres-in-WASM
    return drizzle(pg, { schema })
  } else {
    const sql = postgres(databaseUrl)   // TCP connection
    return drizzle(sql, { schema })
  }
}
```

Both drivers use identical Drizzle ORM schemas. The `db` object is a lazy Proxy — it throws `"Database not initialized"` if accessed before `initDb()` completes.

### 7.2 Local Mode (PGlite)

- **Storage**: `~/.astro/pglite/` (persistent directory)
- **Migrations**: Drizzle migrations in `drizzle/*.sql` run on startup
- **Indexes**: Defined in Drizzle schema (`packages/core/src/db/schema.ts`)
- **Checkpointing**: Every 30 seconds (survives abrupt process kills)
- **Limitations**: Single-process only (no concurrent access)

### 7.3 Production Mode (Supabase PostgreSQL)

- **Storage**: Remote PostgreSQL via Supabase
- **Migrations**: SQL files in `supabase/migrations/` (applied by Supabase CLI)
- **Indexes**: Both Drizzle schema indexes AND Supabase migration indexes
- **Connection pool**: max 60 connections, 20s idle timeout
- **RLS**: Row-Level Security policies enforce team isolation at the DB level

### 7.4 Keeping Schemas in Sync

| Source | Applies to | Indexes from |
|--------|-----------|-------------|
| Drizzle schema (`packages/core/src/db/schema.ts`) | PGlite local mode | Inline index definitions |
| Drizzle migrations (`drizzle/*.sql`) | Existing PGlite data dirs | Migration SQL |
| Supabase migrations (`supabase/migrations/*.sql`) | Production PostgreSQL | Migration SQL |

**Rule**: Every schema change must update both the Drizzle schema AND create a Supabase migration. The `tests/schema-drift.test.ts` and `tests/index-drift.test.ts` verify parity.

---

## 8. Data Flow by User Action

### 8.1 "Create a Project"

```
REST: POST /api/data/projects { name, description }
  → INSERT INTO projects
  → Response: { id, name, ... }
  → project-store.addProject()
```

### 8.2 "Generate Plan with AI"

```
REST: POST /api/generate/plan { projectId, visionDoc, prompt }
  → Backend starts Claude Agent SDK session
  → SSE: streams text, tool_use, plan_result events via global SSE bus
  → StreamingEventLog: persists each event
  → Frontend: useStreamEvents(sessionId) → plan generation UI
  → On plan_result: PUT /api/data/plan/:projectId (bulk upsert)
  → plan-store.setNodes(), plan-store.setEdges()
```

### 8.3 "Run a Task"

```
REST: POST /api/dispatch/execute { nodeId, projectId }
  → DispatchEngine assembles context
  → WebSocket: relay sends to machine
  → Machine: agent-runner executes
  → WebSocket: machine streams results back
  → Backend: persists to streaming_events + emits SSE via global bus
  → Frontend: useStreamEvents(executionId) → realtime-store taskStreams
  → On result: PATCH /api/data/plan/nodes/:id { status, executionOutput }
```

### 8.4 "Refresh Page During Execution"

```
Page unloads → SSE connection closes
Page reloads → DataLoader fetches all stores via REST
  → useStreamEvents(streamId) hydrates from streaming_events on mount
  → GET /api/events/catch-up → streaming_events table
  → hydrateStreamingEvents() → realtime-store taskStreams
  → UI shows complete execution history
  → If still running: live events continue via global SSE bus
```

---

## 9. Key Files Reference

| Component | File | Description |
|-----------|------|-------------|
| Frontend data client | `src/lib/data-client.ts` | HTTP client for all REST calls |
| Unified stream hook | `src/hooks/use-stream-events.ts` | Unified SSE streaming hook for chat and execution |
| Stream status | `src/lib/stream-status.ts` | Stream lifecycle status tracking (deriveStreamStatus) |
| Stream watcher | `src/lib/stream-watcher.ts` | Stream health monitoring / watchdog |
| Activity feed hook | `src/hooks/use-activity-feed.ts` | Activity event grouping and rendering |
| Event hydrator | `src/lib/streaming-event-hydrator.ts` | Reconstructs execution state from DB events |
| Data routes | `server/routes/data.ts` | All CRUD endpoints |
| Event routes | `server/routes/events.ts` | SSE stream + catch-up endpoint |
| Dispatch routes | `server/routes/dispatch.ts` | Task dispatch + cancel |
| Streaming event log | `server/lib/streaming-event-log.ts` | Append-only event persistence |
| Relay server | `server/lib/relay-server.ts` | WebSocket relay to machines |
| Dispatch engine | `server/lib/dispatch/dispatch-engine.ts` | Task queue + machine selection |
| DB dual-driver | `packages/core/src/db/index.ts` | PGlite / postgres-js selection |
| DB schema | `packages/core/src/db/schema.ts` | All table + index definitions |
| Plan store | `src/stores/plan-store.ts` | Graph state management |
| Execution store | `src/stores/execution-store.ts` | Execution metadata storage |
| Realtime store | `src/stores/realtime-store.ts` | Global SSE bus, taskStreams, machine list |
