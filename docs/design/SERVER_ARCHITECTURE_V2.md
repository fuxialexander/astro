# Server Architecture V2: Server-Centric Design

## Problem Statement

The current architecture was designed local-first: IndexedDB is the primary store, the server is an optional sync layer. This creates fundamental problems for server mode:

1. **Two sources of truth** — IndexedDB and Supabase can diverge, with no clear winner
2. **Silent error masking** — API failures fall back to IndexedDB, hiding real problems from users
3. **In-memory backend state** — WebAuthn challenges, device codes, sessions stored in JavaScript `Map`s break with multiple backend instances
4. **Stale cache** — User on device B sees device A's old IndexedDB data mixed with fresh server data
5. **Unnecessary complexity** — 17 stores each implement their own API-then-IndexedDB fallback pattern

These are not bugs to fix one by one. They are symptoms of a local-first architecture running in server mode.

---

## Design Principles

### 1. The server is the single source of truth

Right now, if you ask "what projects does this user have?", there are two answers:
- Supabase says: `[Project A, Project B]`
- IndexedDB says: `[Project A]` (stale — Project B was created on another device)

Which is right? The code tries Supabase first, falls back to IndexedDB. So sometimes the user sees 1 project, sometimes 2, depending on whether the API call succeeded.

**Single source of truth means**: there is exactly one place that knows the answer. In server mode, that's Supabase. The frontend doesn't store its own copy. It asks the server, displays what it gets, period.

### 2. Failures are visible

Here's what `execution-store.ts` does today (line 966-976):

```typescript
try {
  const data = await dataClient.getExecutions()  // ask server
  set({ executions: data })
} catch (err) {
  console.warn('Failed to load from Supabase, falling back to IndexedDB:', err)
  // ↑ user never sees this warning. it's only in the console.
}
// silently loads old IndexedDB data instead
```

The user has no idea the server call failed. They see data that might be hours old. They might make decisions based on stale information.

**Visible failures means**: if the API is down, show a red banner or error state. A blank screen with "Failed to load, retry?" is honest. Showing yesterday's data without telling the user is a lie.

### 3. The backend is stateless

**Stateless means: the backend keeps nothing in memory between requests.** After a request handler finishes, the backend forgets everything about it.

Here's what "stateful" looks like — our current code (`auth.ts:51`):

```typescript
// Machine A's memory
const challengeStore = new Map()

// Request 1 hits Machine A:
POST /register-options → challengeStore.set("reg:alice@email.com", "abc123")

// Request 2 hits Machine B:
POST /register-verify  → challengeStore.get("reg:alice@email.com") → undefined
//                                                                    ↑ FAILS
```

Machine B has its own empty `Map`. The two machines don't share memory. The backend is like two waiters who each keep notes in their own pocket — if waiter A takes your order but waiter B brings your food, waiter B doesn't know what you ordered.

**Stateless means**: any data that must survive between requests goes to the **database** (Supabase) or a **shared store** (Redis):

```typescript
// Request 1 hits Machine A:
POST /register-options → INSERT INTO webauthn_challenges ('reg:alice', 'abc123')
//                        ↑ stored in Supabase, visible to ALL machines

// Request 2 hits Machine B:
POST /register-verify  → SELECT FROM webauthn_challenges WHERE key = 'reg:alice'
//                        ↑ finds it, because Supabase is shared
```

Now it doesn't matter which machine handles which request. They all read and write the same database.

**What CAN stay in memory**: things local to a single request (local variables, the HTTP request/response objects). Read-only caches are also fine — if the cache is wrong, the worst case is a miss and a database read.

**What CANNOT stay in memory**: anything that request B needs to read that request A wrote — challenges, sessions, device codes, dispatch queues, rate limit counters.

The one exception: **WebSocket connections** are inherently in-memory (the relay server holds live connections). This is solved with Redis pub/sub for cross-instance routing, already designed in `server/lib/redis-pubsub.ts`.

### 4. Offline means offline

Compare two approaches when the user's internet drops:

**Current (local-first)**: The app keeps working. User creates a project, edits a plan. Everything goes to IndexedDB. When internet returns... what happens? Do we sync? What if another user edited the same plan? Merge conflict? Last-write-wins? This is the hard problem that Google Docs and Figma spend entire engineering teams on.

**Server-centric**: The app shows "You're offline. Reconnecting..." Nothing works until the connection is back. When it reconnects, you get fresh server state. No sync conflicts, no merge logic, no stale data.

For Astro — where users manage AI task execution across machines — being offline doesn't make sense anyway. You can't dispatch tasks, stream execution output, or collaborate without a server. Pretending to work offline adds complexity for a scenario that provides no real value.

### 5. Local mode is a separate code path

Right now, every store has interleaved branching:

```typescript
load: async () => {
  if (isServerMode()) {
    try { /* API call */ } catch { /* fall back to IndexedDB anyway */ }
  }
  // IndexedDB load runs in BOTH modes
}
```

Both modes share the same code, and the IndexedDB fallback code runs in server mode. Every bug in the IndexedDB path affects server mode users.

**Separate code path means**: the two modes don't share persistence logic. They share the Zustand state shape (types, selectors, actions that don't involve persistence), but load/save is cleanly separated. See the "Code Organization" section below.

---

## Code Organization: The Data Adapter Pattern

Both modes share the same UI components, the same Zustand store shapes, and the same TypeScript types. What differs is **where data comes from and goes to**. We separate this with a `DataAdapter` interface.

### Architecture

```
                          ┌─────────────────────┐
                          │   React Components   │
                          │   (shared, one copy)  │
                          └──────────┬──────────┘
                                     │ reads/writes
                          ┌──────────▼──────────┐
                          │    Zustand Stores    │
                          │   (shared, one copy)  │
                          │   state + actions     │
                          └──────────┬──────────┘
                                     │ calls adapter
                          ┌──────────▼──────────┐
                          │    DataAdapter       │
                          │    (interface)        │
                          └────┬────────────┬────┘
                               │            │
                    ┌──────────▼──┐   ┌─────▼───────────┐
                    │ ServerAdapter│   │  LocalAdapter    │
                    │ (API calls)  │   │  (IndexedDB)     │
                    │              │   │                   │
                    │ fetch()      │   │ idb-keyval        │
                    │   → Backend  │   │   → browser DB    │
                    │     → Supa   │   │                   │
                    └──────────────┘   └───────────────────┘
```

### The DataAdapter interface

```typescript
// src/lib/data-adapter.ts

export interface DataAdapter {
  // Projects
  getProjects(): Promise<Project[]>
  createProject(project: Partial<Project>): Promise<Project>
  updateProject(id: string, patch: Partial<Project>): Promise<Project>
  deleteProject(id: string): Promise<void>

  // Plan nodes & edges
  getPlanNodes(projectId: string): Promise<PlanNode[]>
  getPlanEdges(projectId: string): Promise<PlanEdge[]>
  savePlanNode(node: PlanNode): Promise<PlanNode>
  savePlanEdge(edge: PlanEdge): Promise<PlanEdge>
  deletePlanNode(id: string): Promise<void>
  deletePlanEdge(id: string): Promise<void>

  // Executions
  getExecutions(): Promise<Record<string, TaskExecution>>
  saveExecution(exec: TaskExecution): Promise<void>

  // Settings, profile, usage, etc.
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  getProfile(): Promise<UserProfile>
  updateProfile(patch: Partial<UserProfile>): Promise<UserProfile>
  // ... other methods
}
```

### ServerAdapter — calls the backend API

```typescript
// src/lib/adapters/server-adapter.ts

export class ServerDataAdapter implements DataAdapter {
  async getProjects(): Promise<Project[]> {
    const res = await fetch(apiUrl('/api/data/projects'), {
      headers: await authHeaders(),
    })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    return res.json()
  }

  async createProject(project: Partial<Project>): Promise<Project> {
    const res = await fetch(apiUrl('/api/data/projects'), {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(project),
    })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    return res.json()
  }

  // ... all other methods call the backend API
}
```

### LocalAdapter — reads/writes IndexedDB

```typescript
// src/lib/adapters/local-adapter.ts

export class LocalDataAdapter implements DataAdapter {
  async getProjects(): Promise<Project[]> {
    return (await idbGet('astro-projects')) ?? []
  }

  async createProject(project: Partial<Project>): Promise<Project> {
    const full = { ...project, id: crypto.randomUUID(), createdAt: new Date() } as Project
    const projects = await this.getProjects()
    await idbSet('astro-projects', [...projects, full])
    return full
  }

  // ... all other methods use idb-keyval
}
```

### Adapter is chosen once at startup

```typescript
// src/lib/data-adapter.ts

import { isServerMode } from './app-mode'
import { ServerDataAdapter } from './adapters/server-adapter'
import { LocalDataAdapter } from './adapters/local-adapter'

export const dataAdapter: DataAdapter = isServerMode()
  ? new ServerDataAdapter()
  : new LocalDataAdapter()
```

### Stores use the adapter — no branching

```typescript
// src/stores/project-store.ts

import { dataAdapter } from '@/lib/data-adapter'

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  loading: false,
  error: null,
  loaded: false,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const projects = await dataAdapter.getProjects()
      set({ projects, loaded: true, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load', loading: false })
    }
  },

  createProject: async (input) => {
    try {
      const project = await dataAdapter.createProject(input)
      set((s) => ({ projects: [...s.projects, project] }))
      return project
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to create' })
      throw err
    }
  },

  // ... no isServerMode() checks, no IndexedDB imports, no fallbacks
}))
```

### What's shared vs separate

| Layer | Shared? | Notes |
|-------|---------|-------|
| TypeScript types (`src/types/`) | Shared | Same data shapes in both modes |
| React components (`src/components/`) | Shared | Renders whatever Zustand provides |
| React pages (`src/pages/`) | Shared | Same routes, same layout |
| Zustand store logic (`src/stores/`) | Shared | Actions, selectors, computed state — all shared |
| DataAdapter interface | Shared | The contract both adapters implement |
| `ServerDataAdapter` | Server only | API calls with auth headers |
| `LocalDataAdapter` | Local only | IndexedDB via idb-keyval |
| Supabase Realtime subscriptions | Server only | Multi-device sync |
| Error boundaries / offline banner | Server only | Not needed in local mode |

**Roughly 90% of the code is shared.** The only divergence is the ~200-300 lines in each adapter and the mode-specific UI (offline banner, loading states).

---

## User Journey: Registration Through First Task

### 1. User visits the site

```
Browser ──GET──→ Cloudflare CDN (static JS/CSS/HTML)
```

No backend contact yet. The React app boots, checks for an existing Supabase session (JWT in `localStorage`, managed by `@supabase/supabase-js`).

- If no session → redirect to `/login`
- If valid session → proceed to dashboard

### 2. Registration

```
Browser                          Backend (any machine)              Supabase
  │                                   │                               │
  │  POST /auth/register-options      │                               │
  │  { email, name }                  │                               │
  │ ─────────────────────────────────→│                               │
  │                                   │  INSERT INTO webauthn_challenges
  │                                   │  (key, challenge, expires_at) │
  │                                   │ ─────────────────────────────→│
  │                                   │                               │
  │  { options }                      │                               │
  │ ←─────────────────────────────────│                               │
  │                                   │                               │
  │  [Browser creates passkey]        │                               │
  │                                   │                               │
  │  POST /auth/register-verify       │                               │
  │  { email, credential }            │  (can hit ANY machine)        │
  │ ─────────────────────────────────→│                               │
  │                                   │  SELECT FROM webauthn_challenges
  │                                   │  WHERE key = 'reg:{email}'    │
  │                                   │ ─────────────────────────────→│
  │                                   │  DELETE (one-time use)        │
  │                                   │                               │
  │                                   │  auth.admin.createUser()      │
  │                                   │ ─────────────────────────────→│
  │                                   │  (trigger creates user_profiles row)
  │                                   │                               │
  │                                   │  INSERT passkey_credentials   │
  │                                   │ ─────────────────────────────→│
  │                                   │                               │
  │                                   │  admin.generateLink(magiclink)│
  │                                   │ ─────────────────────────────→│
  │                                   │                               │
  │  { verified, session }            │                               │
  │ ←─────────────────────────────────│                               │
  │                                   │                               │
  │  supabase.auth.verifyOtp()        │                               │
  │ ──────────────────────────────────────────────────────────────────→│
  │  (JWT stored in localStorage by Supabase SDK)                     │
```

Key change: **challenges stored in Supabase table, not in-memory.** Any backend machine can verify any challenge.

### 3. Dashboard load (authenticated)

```
Browser                          Backend                 Supabase
  │                                   │                      │
  │  [Supabase SDK has JWT]           │                      │
  │                                   │                      │
  │  GET /api/data/projects           │                      │
  │  Authorization: Bearer {jwt}      │                      │
  │ ─────────────────────────────────→│                      │
  │                                   │  SELECT * FROM projects
  │                                   │  WHERE owner_id = {user}
  │                                   │ ────────────────────→│
  │                                   │                      │
  │  { projects: [...] }              │                      │
  │ ←─────────────────────────────────│                      │
  │                                   │                      │
  │  [Zustand: set({ projects })]     │                      │
  │  [React renders]                  │                      │
```

Key change: **No IndexedDB read or write.** Data comes from server. If the API call fails, the user sees a loading error, not stale cached data.

### 4. Creating a project

```
Browser                          Backend                 Supabase        Other devices
  │                                   │                      │                │
  │  POST /api/data/projects          │                      │                │
  │  { name, description, repo }      │                      │                │
  │ ─────────────────────────────────→│                      │                │
  │                                   │  INSERT INTO projects │                │
  │                                   │ ────────────────────→│                │
  │                                   │                      │  CDC event     │
  │  { project }                      │                      │───────────────→│
  │ ←─────────────────────────────────│                      │                │
  │                                   │                      │  [Realtime:    │
  │  [Zustand: addProject(project)]   │                      │   addProject]  │
  │  [React renders immediately]      │                      │                │
```

Optimistic updates are still fine — Zustand updates immediately on API success. No IndexedDB write. Other devices get the update via Supabase Realtime.

### 5. Plan generation via relay

```
Browser                    Backend              Relay            Agent Runner
  │                            │                  │                    │
  │  POST /agent/generate-plan │                  │                    │
  │  { projectId, description }│                  │                    │
  │ ──────────────────────────→│                  │                    │
  │                            │  dispatch(task)  │                    │
  │                            │ ────────────────→│  WS: task.dispatch │
  │                            │                  │ ──────────────────→│
  │                            │                  │                    │
  │  SSE: text event           │  EventEmitter    │  WS: task.text     │
  │ ←──────────────────────────│ ←────────────────│ ←──────────────────│
  │                            │                  │                    │
  │  SSE: plan_result          │                  │  WS: task.result   │
  │ ←──────────────────────────│ ←────────────────│ ←──────────────────│
  │                            │                  │                    │
  │  [Zustand: setPlan()]      │  Store result    │                    │
  │  [React Flow renders]     │  in Supabase     │                    │
  │                            │ ────────────────────→ Supabase        │
```

SSE streaming is already stateless (the stream IS the state). The plan result is stored server-side. No change needed here.

---

## Backend State Migration

### Current: in-memory Maps (broken with multiple machines)

| State | File | Problem |
|-------|------|---------|
| WebAuthn challenges | `auth.ts:51` | Request A stores on machine 1, request B looks up on machine 2 → not found |
| Device codes | `device-code-store.ts:20` | Same cross-machine problem |
| Active sessions | `session-manager.ts:26` | Cancel/abort hits wrong machine |
| Chat session pool | `chat-session-pool.ts:24` | Chat context lost across machines |
| Rate limits | `device-auth.ts:81` | Per-machine, not global |
| Dispatch queue | `dispatch-queue.ts` | Tasks dispatched twice or lost |
| Machine registry | `machine-registry.ts` | Machines visible on one machine only |

### Target: database-backed (stateless)

| State | Target location | TTL | Notes |
|-------|----------------|-----|-------|
| WebAuthn challenges | `webauthn_challenges` table | 5 min | Key + challenge + expires_at. DELETE after use. |
| Device codes | `device_codes` table | 15 min | Already partially in DB. Complete the migration. |
| Active sessions | `cancelled` flag in executions table | Session duration | Backend checks flag instead of in-memory AbortController. |
| Chat session pool | Supabase `sessions` table | None | Already exists. Load on demand instead of pooling in memory. |
| Rate limits | Supabase counter table or Redis | Sliding window | `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1` |
| Dispatch queue | Supabase `dispatch_queue` table | Until processed | `SELECT ... FOR UPDATE SKIP LOCKED` for distributed processing. |
| Machine registry | Already in `registered_machines` | Heartbeat | DB is authoritative. In-memory is a read cache refreshed on heartbeat. |

### Example: Challenge Store Migration

**Migration SQL:**

```sql
CREATE TABLE webauthn_challenges (
  key TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes')
);
CREATE INDEX idx_challenges_expires ON webauthn_challenges (expires_at);
```

**Backend code:**

```typescript
// Replace: const challengeStore = new Map()

async function storeChallenge(supabase: SupabaseClient, key: string, challenge: string) {
  await supabase.from('webauthn_challenges')
    .upsert({ key, challenge, expires_at: new Date(Date.now() + 5 * 60_000).toISOString() })
}

async function getChallenge(supabase: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await supabase
    .from('webauthn_challenges')
    .delete()                    // one-time use: delete and return
    .eq('key', key)
    .gt('expires_at', new Date().toISOString())
    .select('challenge')
    .single()
  return data?.challenge ?? null
}
```

---

## Relay Scaling

The relay server (WebSocket hub) is the one component with legitimate in-memory state: live WebSocket connections. You can't store a WebSocket connection in a database.

For horizontal relay scaling:

```
Agent Runner A ──WSS──→ Relay Instance 1 ◄──Redis pub/sub──► Relay Instance 2 ←──WSS── Agent Runner B
                              │                                     │
                              └───────── Shared Postgres ───────────┘
                                   (registered_machines table)
```

- Each relay instance holds its own WebSocket connections
- Dispatch to a machine on another instance → publish to Redis → that instance forwards it
- Already designed in `server/lib/redis-pubsub.ts`, not yet tested at scale

---

## Scaling Considerations

### From 1 to millions of users

| Layer | Current | At scale |
|-------|---------|----------|
| CDN (frontend) | Cloudflare Pages | Same. CDN scales infinitely. |
| Backend | 1-2 Fly.io machines | N stateless machines behind load balancer. |
| Database | Single Supabase instance | Supabase Pro with read replicas, connection pooling. |
| Relay | Single WebSocket server | Multiple relay instances + Redis pub/sub. |
| Caching | None | Redis for ephemeral state (challenges, rate limits). |
| Agent Runners | User machines | Same — outbound connections to relay. Scale is per-user. |

### Database indexes for common queries

```sql
CREATE INDEX idx_projects_owner ON projects (owner_id);
CREATE INDEX idx_plan_nodes_project ON plan_nodes (project_id);
CREATE INDEX idx_executions_project ON task_executions (project_id);
CREATE INDEX idx_activity_project_time ON activity_events (project_id, created_at DESC);
```

### Table partitioning for large tables

```sql
-- task_executions: partition by created_at (time-series)
-- activity_events: partition by created_at
-- audit_logs: partition by created_at
```

---

## Action Items

### Phase 1: Stabilize current deployment (immediate)

These are quick fixes to make the alpha usable while we build the proper architecture.

| # | Task | Why | Files |
|---|------|-----|-------|
| 1.1 | Scale Fly.io to 1 machine | Eliminates cross-machine state bug immediately | `fly machines destroy <id>` |
| 1.2 | Set Cloudflare Pages production branch to `main` | Fixes stale JS bundle on production URL | Cloudflare dashboard |
| 1.3 | Move `challengeStore` to Supabase table | Fixes WebAuthn registration/login failures | `server/routes/auth.ts`, new migration |
| 1.4 | Move `deviceCodeStore` to Supabase table | Fixes agent runner device auth flow | `server/lib/device-code-store.ts`, new migration |

### Phase 2: Data adapter pattern (frontend)

Restructure frontend persistence so stores never branch on mode.

| # | Task | Why | Files |
|---|------|-----|-------|
| 2.1 | Define `DataAdapter` interface | Single contract for all data access | New: `src/lib/data-adapter.ts` |
| 2.2 | Implement `ServerDataAdapter` | API calls with auth headers, proper error propagation | New: `src/lib/adapters/server-adapter.ts` |
| 2.3 | Implement `LocalDataAdapter` | IndexedDB via idb-keyval | New: `src/lib/adapters/local-adapter.ts` |
| 2.4 | Refactor existing `dataClient` into `ServerDataAdapter` | Most code already exists, just restructure | Modify: `src/lib/data-client.ts` |
| 2.5 | Migrate stores to use `dataAdapter` | Remove all `isServerMode()` branching and IndexedDB fallbacks from stores | All 17 stores with persistence |
| 2.6 | Add `loading` / `error` state to every store | Replace silent fallbacks with visible loading/error states | All stores |
| 2.7 | Add error boundary + offline banner components | Show "Failed to load" and "You're offline" to users | New UI components |
| 2.8 | Remove `loadState()`/`saveState()` calls from server-mode stores | Clean separation — IndexedDB code only in `LocalDataAdapter` | All stores |

### Phase 3: Stateless backend

Move all remaining in-memory state to database.

| # | Task | Why | Files |
|---|------|-----|-------|
| 3.1 | Move session manager to DB cancellation flags | Abort/cancel works across machines | `server/lib/session-manager.ts`, migration |
| 3.2 | Move dispatch queue to Supabase table | Tasks don't get lost or duplicated across machines | `server/lib/dispatch/dispatch-queue.ts`, migration |
| 3.3 | Move rate limits to Supabase table | Rate limits are global, not per-machine | `server/routes/device-auth.ts`, migration |
| 3.4 | Make machine registry DB-authoritative | In-memory becomes a read cache, refreshed on heartbeat | `server/lib/machine-registry.ts` |
| 3.5 | Move chat session pool to load-on-demand | No in-memory pooling; load from Supabase `sessions` table | `server/lib/chat-session-pool.ts` |
| 3.6 | Scale to 2+ machines and verify | Test all flows work with load balancer distributing requests | Manual testing |

### Phase 4: Scale infrastructure (when needed)

| # | Task | Why |
|---|------|-----|
| 4.1 | Add Redis for ephemeral state | Lower latency than Supabase for challenges, rate limits, pub/sub |
| 4.2 | Add Supabase read replicas | Distribute read load for dashboards with many users |
| 4.3 | Partition large tables | Prevent slow queries on task_executions, activity_events |
| 4.4 | Load test with simulated concurrent users | Find bottlenecks before they hit production |
| 4.5 | Add monitoring dashboards | Supabase metrics, Fly.io metrics, custom observability |

---

## Open Questions

1. **Should local mode exist in the open-source version?** If yes, the two-mode architecture (data adapter with two implementations) is permanent. If local mode is removed, the codebase simplifies significantly — but loses the single-user, no-server use case.

2. **React Query vs manual fetching?** The current manual `fetch()` + Zustand could be replaced with TanStack Query, which handles caching, retries, stale-while-revalidate, and deduplication out of the box. This would eliminate most of the store loading complexity. Significant refactor but high payoff.

3. **Supabase client-side vs backend API?** Currently the frontend calls our backend API (`/api/data/*`) which then calls Supabase. An alternative: use the Supabase client SDK directly from the frontend, with RLS policies for security. This eliminates the backend as middleman for CRUD operations, reducing latency and backend load. The backend would only handle business logic (dispatch, relay, auth ceremonies).

4. **WebSocket vs SSE for frontend updates?** Currently uses SSE (EventSource) for execution streaming and Supabase Realtime (WebSocket) for data sync. Could consolidate to one WebSocket connection for both, reducing connection overhead.
