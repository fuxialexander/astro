# Local/Server Mode Refactoring Plan

This document is a step-by-step implementation guide for the architecture described in `SERVER_ARCHITECTURE_V2.md`. It is written so that an AI coding agent can read it and execute each phase independently.

## Goal

Eliminate all `isServerMode()` / `isLocalMode()` branching, all IndexedDB usage, and all Supabase HTTP API calls from the data layer. Replace with:

- **Backend**: Drizzle ORM queries that work against PGlite (local) or Postgres (server)
- **Frontend**: `fetch('/api/...')` calls only — no mode detection, no IndexedDB, no Supabase SDK for data

## Current State (what exists today)

### Frontend data flow (broken)

```
Store.load() →
  if isServerMode():
    try: dataClient.getX()  →  fetch('/api/data/x')  →  backend  →  Supabase HTTP API
    catch: fall through to IndexedDB
  loadState('astro-x')  →  idb-keyval  →  IndexedDB (runs in BOTH modes)
```

**14 stores** use this pattern: project, plan, initiative, execution, user-profile, display-settings, usage, task-chat, activity, session, settings, machines, slurm, agent.

### Backend data flow (mixed)

- `server/routes/data.ts` — Uses BOTH Supabase HTTP client AND Drizzle ORM (inconsistent)
- `server/routes/auth.ts` — Uses Supabase admin client + in-memory Map
- `server/lib/db/index.ts` — Drizzle ORM connected to Postgres via `postgres-js` driver
- `server/lib/db/schema.ts` — Full Drizzle schema (projects, planNodes, etc.)
- `server/lib/supabase.ts` — Supabase client factory (service role, anon, user clients)

### Files that use `isServerMode()` or `isLocalMode()`

**Frontend:**
- `src/stores/execution-store.ts` — server-priority loading with IndexedDB fallback
- `src/stores/machines-store.ts` — auth method differs per mode
- `src/stores/auth-store.ts` — local mode bypass
- `src/stores/api-keys-store.ts` — server-only
- `src/lib/data-client.ts` — throws in local mode to trigger IndexedDB fallback
- `src/lib/app-mode.ts` — mode detection

**Backend:**
- `server/routes/agent.ts` — relay dispatch in server mode, local execution otherwise
- `server/routes/dispatch.ts` — relay dispatch in server mode
- `server/routes/health.ts` — blocks /backends in server mode
- `server/routes/device-auth.ts` — mode check
- `server/routes/teams.ts` — blocks in local mode
- `server/lib/app-mode.ts` — mode detection

### IndexedDB keys used (all will be removed)

```
astro-projects, astro-plan-nodes, astro-plan-edges, astro-agent-sessions,
astro-user-profile, astro-display-settings, astro-usage-metrics,
astro-task-chats, astro:activities, astro-sessions, astro-active-sessions,
astro-settings, astro-machines, astro-slurm-clusters, astro-slurm-jobs,
astro-executions, astro-initiatives, astro:command-history, astro-browser-user-id
```

### In-memory Maps (all must move to Postgres)

| Variable | File | Purpose |
|----------|------|---------|
| `challengeStore` | `server/routes/auth.ts:51` | WebAuthn challenges (5min TTL) |
| `deviceCodeStore` | `server/lib/device-code-store.ts:20` | Device auth codes |
| `deviceCodeIndex` | `server/lib/device-code-store.ts` | Device code → user code index |
| `pool` | `server/lib/chat-session-pool.ts:24` | Chat SDK sessions (30min TTL) |
| `activeSessions` | `server/lib/session-manager.ts:26` | Active agent sessions + abort controllers |
| `entries` | `server/lib/dispatch/dispatch-queue.ts` | Task dispatch queue |
| `nodeToEntry` | `server/lib/dispatch/dispatch-queue.ts` | Node → queue entry mapping |
| `activePerProject` | `server/lib/dispatch/dispatch-queue.ts` | Active execution count per project |
| `activeExecutions` | `server/lib/dispatch/dispatch-engine.ts` | Running task executions |
| `machines` | `server/lib/machine-registry.ts` | Connected machines (WebSocket) |
| `sessionToMachine` | `server/lib/machine-registry.ts` | Session → machine mapping |
| `shareStore` | `server/routes/share.ts` | Shared plan bundles |
| `buffer` | `server/lib/event-buffer.ts` | SSE ring buffer for reconnection replay |

---

## Target State

### Frontend data flow (unified)

```
Store.load() →
  fetch('/api/data/x') →
  if ok: set({ data, loading: false })
  if error: set({ error, loading: false })  →  UI shows error banner
```

No `isServerMode()`. No IndexedDB. No fallbacks. Same code in local and server.

### Backend data flow (unified)

```
Route handler →
  Drizzle ORM query →
  PGlite (if no DATABASE_URL) OR Postgres (if DATABASE_URL set)
```

No Supabase HTTP API for data operations. Supabase SDK only for auth ceremonies (WebAuthn, magic links) in server mode.

---

## Phase 1: Unified Database Layer (Backend)

### Step 1.1: Add PGlite dependency

```bash
npm install @electric-sql/pglite
```

**Test**: `import { PGlite } from '@electric-sql/pglite'` compiles without error.

### Step 1.2: Modify `server/lib/db/index.ts` to support PGlite

**Current code** connects to Postgres via `postgres-js`:
```typescript
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
const client = postgres(process.env.DATABASE_URL || 'postgresql://...')
export const db = drizzle(client, { schema })
```

**New code** — choose driver based on `DATABASE_URL`:
```typescript
import * as schema from './schema'

export async function createDb() {
  if (process.env.DATABASE_URL) {
    // Server mode: external Postgres
    const postgres = (await import('postgres')).default
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const client = postgres(process.env.DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    })
    return drizzle(client, { schema })
  } else {
    // Local mode: PGlite in-process
    const { PGlite } = await import('@electric-sql/pglite')
    const { drizzle } = await import('drizzle-orm/pglite')
    const dataDir = process.env.ASTRO_DATA_DIR || `${process.env.HOME}/.astro/data`
    const client = new PGlite(dataDir)
    return drizzle({ client, schema })
  }
}

// Singleton — initialized once at server startup
let _db: Awaited<ReturnType<typeof createDb>>
export async function getDb() {
  if (!_db) _db = await createDb()
  return _db
}
```

**Why async**: PGlite initialization is async. The `getDb()` singleton pattern ensures it's created once.

**Files to update**: Every file that imports `db` from `../lib/db` needs to switch to `await getDb()` or the db must be initialized before routes are registered in `server/index.ts`.

**Simpler alternative**: Initialize `db` in `server/index.ts` before registering routes, then pass it via Hono context:

```typescript
// server/index.ts
const db = await createDb()
app.use('*', async (c, next) => {
  c.set('db', db)
  await next()
})
```

Routes access via `c.get('db')`. This avoids changing every import.

### Step 1.3: Run Drizzle migrations against PGlite on startup

```typescript
// server/lib/db/migrate.ts
import { migrate } from 'drizzle-orm/pglite/migrator'  // or postgres-js/migrator
import { getDb } from './index'

export async function runMigrations() {
  const db = await getDb()
  await migrate(db, { migrationsFolder: './drizzle' })
}
```

**Test**: Start the server with no `DATABASE_URL`. Verify PGlite creates `~/.astro/data/` and schema tables exist:
```typescript
// test: verify schema exists in PGlite
const db = await createDb()
const result = await db.select().from(projects)
expect(result).toEqual([])  // empty but no error = schema exists
```

### Step 1.4: Migrate `server/routes/data.ts` from Supabase SDK to Drizzle ORM

**Current**: `data.ts` uses `getServiceClient()` (Supabase HTTP API) for some operations and `db` (Drizzle) for others. This is inconsistent.

**Target**: All data operations use Drizzle ORM only.

For each endpoint in `data.ts`, replace Supabase calls:

```typescript
// BEFORE (Supabase HTTP API)
const supabase = getServiceClient()
const { data, error } = await supabase
  .from('projects')
  .select('*')
  .eq('owner_id', userId)

// AFTER (Drizzle ORM)
const db = c.get('db')
const data = await db.select().from(projects).where(eq(projects.ownerId, userId))
```

**Endpoints to convert** (all in `server/routes/data.ts`):
- GET /projects → `db.select().from(projects).where(...)`
- POST /projects → `db.insert(projects).values(...).returning()`
- GET /projects/:id → `db.select().from(projects).where(eq(projects.id, id))`
- PUT /projects/:id → `db.update(projects).set(...).where(...).returning()`
- DELETE /projects/:id → `db.delete(projects).where(...)`
- GET /plan-nodes?projectId → `db.select().from(planNodes).where(...)`
- POST /plan-nodes → `db.insert(planNodes).values(...).returning()`
- PUT /plan-nodes/:id → `db.update(planNodes).set(...).where(...).returning()`
- DELETE /plan-nodes/:id → `db.delete(planNodes).where(...)`
- (same pattern for edges, profile, settings, executions, activities, sessions, initiatives, usage, display-settings, chat)

**Test for each endpoint**: Call the endpoint, verify the response matches the expected shape. Use both PGlite (no DATABASE_URL) and Postgres (with DATABASE_URL) to ensure both drivers produce the same results.

```typescript
describe('GET /api/data/projects', () => {
  it('returns empty array when no projects exist', async () => {
    const res = await app.request('/api/data/projects')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns projects for the authenticated user', async () => {
    // Insert test data via Drizzle
    await db.insert(projects).values({ id: 'p1', name: 'Test', ownerId: 'user1', ... })
    const res = await app.request('/api/data/projects', {
      headers: { 'x-user-id': 'user1' }  // or mock auth
    })
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('Test')
  })

  it('does not return other users projects', async () => {
    await db.insert(projects).values({ id: 'p2', name: 'Other', ownerId: 'user2', ... })
    const res = await app.request('/api/data/projects', {
      headers: { 'x-user-id': 'user1' }
    })
    const body = await res.json()
    expect(body).toHaveLength(0)  // user1 can't see user2's project
  })
})
```

### Step 1.5: Verify schema compatibility

Run the **existing** Drizzle schema (`server/lib/db/schema.ts`) against PGlite:

```typescript
describe('Schema compatibility', () => {
  it('creates all tables in PGlite without error', async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const pg = new PGlite()  // in-memory
    const db = drizzle({ client: pg, schema })
    await migrate(db, { migrationsFolder: './drizzle' })

    // Verify each table exists and accepts inserts
    await db.insert(projects).values({
      id: 'test', name: 'Test', ownerId: 'local',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    const rows = await db.select().from(projects)
    expect(rows).toHaveLength(1)
  })

  it('supports JSONB columns in PGlite', async () => {
    // Test that JSONB insert/query works
    // PGlite is real Postgres, so this should work
  })

  it('supports TIMESTAMPTZ columns in PGlite', async () => {
    // Test that timestamp with timezone works
  })
})
```

---

## Phase 2: Frontend Cleanup (Remove IndexedDB)

### Step 2.1: Remove `isLocalMode()` throw from `data-client.ts`

**Current** (`src/lib/data-client.ts`):
```typescript
if (isLocalMode()) throw new Error('Local mode: skipping API call')
```

This makes every store catch the error and fall back to IndexedDB.

**Change**: Remove this throw. In local mode, the API call goes to `localhost:3001`, which talks to PGlite. The data-client should always make the API call.

**Test**: In local mode (no Supabase env vars), `dataClient.listProjects()` returns `[]` (empty from PGlite), not an error.

### Step 2.2: Refactor stores one by one

For each store, apply this transformation:

**BEFORE** (example: `project-store.ts`):
```typescript
load: async () => {
  try {
    const projects = await dataClient.listProjects()
    set({ projects, loaded: true })
    saveState('astro-projects', projects)  // write to IndexedDB
  } catch {
    const cached = await loadState('astro-projects')  // read from IndexedDB
    if (cached) set({ projects: cached, loaded: true })
  }
}
```

**AFTER**:
```typescript
load: async () => {
  set({ loading: true, error: null })
  try {
    const projects = await dataClient.listProjects()
    set({ projects, loading: false })
  } catch (err) {
    set({ error: err instanceof Error ? err.message : 'Failed to load projects', loading: false })
  }
}
```

**Changes per store**:
1. Remove `import { loadState, saveState } from '@/lib/db'`
2. Remove all `saveState(...)` calls
3. Remove all `loadState(...)` calls and their fallback logic
4. Remove all `isServerMode()` / `isLocalMode()` checks
5. Add `loading: boolean` and `error: string | null` to state if not present
6. Set `loading: true` before API call, `loading: false` after (success or error)
7. On error: set `error` message, do NOT fall back to IndexedDB

**Stores to refactor** (in order of complexity, simplest first):

| # | Store | IndexedDB keys | Mode checks | Complexity |
|---|-------|---------------|-------------|------------|
| 1 | settings-store | `astro-settings` | No | Simple |
| 2 | user-profile-store | `astro-user-profile` | No | Simple |
| 3 | display-settings-store | `astro-display-settings` | No | Simple |
| 4 | usage-store | `astro-usage-metrics` | No | Simple |
| 5 | initiative-store | `astro-initiatives` | No | Simple |
| 6 | activity-store | `astro:activities` | No | Simple |
| 7 | project-store | `astro-projects` | No | Simple |
| 8 | plan-store | `astro-plan-nodes`, `astro-plan-edges` | No | Medium (two keys) |
| 9 | slurm-store | `astro-slurm-clusters`, `astro-slurm-jobs` | No | Medium (two keys) |
| 10 | machines-store | `astro-machines` | Yes (`isServerMode()`) | Medium |
| 11 | task-chat-store | `astro-task-chats` | No | Medium (serialization) |
| 12 | session-store | `astro-sessions`, `astro-active-sessions` | No | Complex (migration logic) |
| 13 | agent-store | `astro-agent-sessions` | No | Complex (serialization, debounced save) |
| 14 | execution-store | `astro-executions` | Yes (`isServerMode()`) | Complex (serialization, mode branching) |

**Test for each store**: After refactoring, the store should:
```typescript
describe('project-store', () => {
  it('sets loading=true before API call', () => { ... })
  it('sets projects and loading=false on success', () => { ... })
  it('sets error and loading=false on API failure', () => { ... })
  it('does not import idb-keyval or @/lib/db', () => {
    // Static analysis: grep for 'idb-keyval' or 'loadState' in the file
    const content = readFileSync('src/stores/project-store.ts', 'utf-8')
    expect(content).not.toContain('idb-keyval')
    expect(content).not.toContain('loadState')
    expect(content).not.toContain('saveState')
    expect(content).not.toContain('isServerMode')
    expect(content).not.toContain('isLocalMode')
  })
})
```

### Step 2.3: Remove `src/lib/db.ts`

After all stores are refactored, this file (the idb-keyval wrapper) should have zero imports. Delete it.

**Test**: `npm run build` succeeds with no references to `@/lib/db`.

### Step 2.4: Remove `idb-keyval` dependency

```bash
npm uninstall idb-keyval
```

**Test**: `npm run build` succeeds. No `idb-keyval` in `package.json`.

### Step 2.5: Remove frontend `isServerMode()` / `isLocalMode()`

After stores no longer branch on mode, check if `src/lib/app-mode.ts` is still imported anywhere in the frontend.

**Search**: `grep -r "isServerMode\|isLocalMode\|app-mode" src/`

If no frontend imports remain, the file can either be deleted or kept for the backend only (it's also used by `server/lib/app-mode.ts`).

### Step 2.6: Add loading skeleton components

Create shimmer/skeleton components for:
- Project list
- Plan graph area
- Task detail panel
- Dashboard stats

These display while `loading === true` in each store.

```tsx
// src/components/ui/skeleton.tsx
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-muted rounded', className)} />
}

// Usage in a page:
function ProjectsPage() {
  const { projects, loading, error } = useProjectStore()

  if (loading) return <ProjectListSkeleton />
  if (error) return <ErrorBanner message={error} onRetry={() => useProjectStore.getState().load()} />
  return <ProjectList projects={projects} />
}
```

### Step 2.7: Add error boundary component

```tsx
// src/components/ui/error-banner.tsx
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-destructive/10 border border-destructive/20 rounded p-4">
      <p className="text-destructive text-sm">{message}</p>
      {onRetry && <button onClick={onRetry} className="text-sm underline mt-2">Retry</button>}
    </div>
  )
}
```

---

## Phase 3: Stateless Backend (Move In-Memory Maps to Postgres)

### Step 3.1: Move `challengeStore` to Postgres

**File**: `server/routes/auth.ts`

**New migration** (add to `server/lib/db/schema.ts`):
```typescript
export const webauthnChallenges = pgTable('webauthn_challenges', {
  key: text('key').primaryKey(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})
```

**Replace in auth.ts**:
```typescript
// BEFORE
const challengeStore = new Map<string, { challenge: string; expiresAt: number }>()

// AFTER
import { db } from '../lib/db'
import { webauthnChallenges } from '../lib/db/schema'

async function storeChallenge(key: string, challenge: string) {
  await db.insert(webauthnChallenges)
    .values({ key, challenge, expiresAt: new Date(Date.now() + 5 * 60_000) })
    .onConflictDoUpdate({ target: webauthnChallenges.key, set: { challenge } })
}

async function getAndDeleteChallenge(key: string): Promise<string | null> {
  const [row] = await db.delete(webauthnChallenges)
    .where(and(
      eq(webauthnChallenges.key, key),
      gt(webauthnChallenges.expiresAt, new Date()),
    ))
    .returning({ challenge: webauthnChallenges.challenge })
  return row?.challenge ?? null
}
```

Also add periodic cleanup (in `server/index.ts` startup):
```typescript
setInterval(async () => {
  await db.delete(webauthnChallenges)
    .where(lt(webauthnChallenges.expiresAt, new Date()))
}, 60_000)  // clean up expired challenges every minute
```

**Test**:
```typescript
describe('challengeStore (Postgres)', () => {
  it('stores and retrieves a challenge', async () => {
    await storeChallenge('reg:alice@test.com', 'challenge123')
    const result = await getAndDeleteChallenge('reg:alice@test.com')
    expect(result).toBe('challenge123')
  })

  it('returns null for expired challenge', async () => {
    await db.insert(webauthnChallenges).values({
      key: 'reg:expired@test.com',
      challenge: 'old',
      expiresAt: new Date(Date.now() - 1000),  // already expired
    })
    const result = await getAndDeleteChallenge('reg:expired@test.com')
    expect(result).toBeNull()
  })

  it('deletes challenge after retrieval (one-time use)', async () => {
    await storeChallenge('reg:bob@test.com', 'challenge456')
    await getAndDeleteChallenge('reg:bob@test.com')
    const second = await getAndDeleteChallenge('reg:bob@test.com')
    expect(second).toBeNull()  // already consumed
  })
})
```

### Step 3.2: Move `deviceCodeStore` to Postgres

Same pattern as challenge store. Add `device_codes` and `device_code_index` tables to schema.

### Step 3.3: Move `activeSessions` to DB cancellation flag

**Current**: `session-manager.ts` stores `AbortController` in a Map. Calling `abortSession()` triggers the controller.

**New approach**: Add `cancelled_at` column to the `task_executions` table. The execution loop checks this flag periodically:

```typescript
// In the execution loop (agent runner side or dispatch engine)
async function checkCancelled(executionId: string): Promise<boolean> {
  const [row] = await db.select({ cancelledAt: taskExecutions.cancelledAt })
    .from(taskExecutions)
    .where(eq(taskExecutions.id, executionId))
  return row?.cancelledAt !== null
}
```

The cancel endpoint writes to DB:
```typescript
app.post('/api/dispatch/cancel', async (c) => {
  const { executionId } = await c.req.json()
  await db.update(taskExecutions)
    .set({ cancelledAt: new Date() })
    .where(eq(taskExecutions.id, executionId))
  return c.json({ cancelled: true })
})
```

**Test**:
```typescript
describe('session cancellation (DB)', () => {
  it('marks execution as cancelled', async () => {
    await db.insert(taskExecutions).values({ id: 'exec1', ... })
    const res = await app.request('/api/dispatch/cancel', {
      method: 'POST',
      body: JSON.stringify({ executionId: 'exec1' }),
    })
    expect(res.status).toBe(200)

    const cancelled = await checkCancelled('exec1')
    expect(cancelled).toBe(true)
  })
})
```

### Step 3.4: Move `dispatchQueue` to Postgres

Add `dispatch_queue` table. Use `SELECT ... FOR UPDATE SKIP LOCKED` for distributed processing:

```typescript
export const dispatchQueue = pgTable('dispatch_queue', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  nodeId: text('node_id').notNull(),
  status: text('status').notNull().default('pending'),  // pending, processing, done
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),  // machine ID that locked it
})
```

**Test**:
```typescript
describe('dispatch queue (DB)', () => {
  it('enqueues and dequeues tasks', async () => {
    await enqueueTask({ id: 't1', projectId: 'p1', nodeId: 'n1', payload: { ... } })
    const task = await dequeueNextTask('machine-1')
    expect(task.id).toBe('t1')
    expect(task.lockedBy).toBe('machine-1')
  })

  it('does not return tasks locked by another machine', async () => {
    await enqueueTask({ id: 't2', ... })
    await dequeueNextTask('machine-1')  // locks t2
    const task = await dequeueNextTask('machine-2')
    expect(task).toBeNull()  // no unlocked tasks
  })
})
```

### Step 3.5: Move machine registry to DB-authoritative

`machineRegistry` in-memory Map stays for WebSocket connections (inherently in-memory), but the authoritative list of "which machines exist and their status" comes from the `registered_machines` Postgres table. The in-memory Map is a read cache refreshed on heartbeat.

### Step 3.6: Replace Redis pub/sub with Postgres LISTEN/NOTIFY

**File**: `server/lib/relay-server.ts` and `server/lib/redis-pubsub.ts`

Replace Redis subscribe/publish with Postgres:

```typescript
// server/lib/pg-pubsub.ts
import postgres from 'postgres'

export function createPgPubSub(connectionString: string) {
  const sql = postgres(connectionString)  // dedicated connection for LISTEN

  return {
    async subscribe(channel: string, handler: (payload: string) => void) {
      await sql.listen(channel, handler)
    },
    async publish(channel: string, payload: string) {
      await sql.notify(channel, payload)
    },
    async close() {
      await sql.end()
    },
  }
}
```

**Note**: PGlite in local mode is single-connection, so LISTEN/NOTIFY may not work. Local mode doesn't need cross-instance routing (single process), so this is only enabled when `DATABASE_URL` is set.

**Test**:
```typescript
describe('Postgres LISTEN/NOTIFY', () => {
  it('receives published messages', async () => {
    const pubsub = createPgPubSub(process.env.DATABASE_URL!)
    const received: string[] = []
    await pubsub.subscribe('test_channel', (msg) => received.push(msg))
    await pubsub.publish('test_channel', JSON.stringify({ type: 'test' }))
    await new Promise(r => setTimeout(r, 100))  // wait for delivery
    expect(received).toHaveLength(1)
    expect(JSON.parse(received[0]).type).toBe('test')
  })
})
```

---

## Phase 4: Backend Mode Simplification

### Step 4.1: Simplify `server/index.ts`

The server startup currently initializes providers, Supabase, Redis, etc. Simplify:

```typescript
// server/index.ts (simplified)
const db = await createDb()

// Core routes (always loaded, work with PGlite or Postgres)
app.route('/api/health', healthRoute)
app.route('/api/data', dataRoute)
app.route('/api/agent', agentRoute)
app.route('/api/relay', relayRoute)
app.route('/api/dispatch', dispatchRoute)
app.route('/api/events', eventsRoute)

// Server-only routes (loaded only when DATABASE_URL is set)
if (process.env.DATABASE_URL) {
  const { authRoute } = await import('./routes/auth.js')
  const { teamsRoute } = await import('./routes/teams.js')
  const { deviceAuthRoute } = await import('./routes/device-auth.js')
  app.route('/api/auth', authRoute)
  app.route('/api/teams', teamsRoute)
  app.route('/api/device', deviceAuthRoute)
}
```

### Step 4.2: Simplify auth middleware

```typescript
// server/middleware/auth.ts
export function authMiddleware() {
  return async (c, next) => {
    if (!process.env.DATABASE_URL) {
      // Local mode: no auth, single user
      c.set('userId', 'local')
      return next()
    }
    // Server mode: validate JWT
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) return c.json({ error: 'Unauthorized' }, 401)
    const user = await verifyJwt(token)
    c.set('userId', user.id)
    return next()
  }
}
```

---

## Phase 5: Verification

### Build verification

```bash
npm run build   # TypeScript compilation, zero errors
npm run lint    # ESLint, zero errors
npm test        # All tests pass
```

### Manual testing checklist

**Local mode** (no DATABASE_URL):
- [ ] `npm run dev` starts without error
- [ ] PGlite creates `~/.astro/data/` directory
- [ ] Create a project → appears in project list
- [ ] Generate a plan → nodes appear in graph
- [ ] Dispatch a task → execution streams output
- [ ] Refresh page → data persists (PGlite on disk)
- [ ] No `idb-keyval` or `IndexedDB` in browser DevTools → Application tab

**Server mode** (DATABASE_URL set to Supabase):
- [ ] `npm run dev` connects to Postgres
- [ ] Register with WebAuthn → challenge stored in Postgres table (not in-memory)
- [ ] Login → JWT issued, stored in localStorage
- [ ] Create a project → saved in Postgres
- [ ] Refresh page → data loads from Postgres
- [ ] Open in incognito → no stale data (no IndexedDB)
- [ ] Stop backend → frontend shows error banner (not stale data)

### Static analysis verification

```bash
# No IndexedDB references in frontend stores
grep -r "idb-keyval\|loadState\|saveState\|indexedDB\|IndexedDB" src/stores/
# Expected: zero results

# No mode branching in frontend (except app-mode.ts itself)
grep -r "isServerMode\|isLocalMode" src/ --include="*.ts" --include="*.tsx" | grep -v app-mode.ts
# Expected: zero results (or only in components that genuinely differ, like login page)

# No Supabase SDK in data routes
grep -r "getServiceClient\|supabase\.from" server/routes/data.ts
# Expected: zero results

# No in-memory Maps for persistent state
grep -r "new Map()" server/lib/ server/routes/ | grep -v "// read cache" | grep -v test
# Expected: only Maps explicitly marked as read caches or WebSocket connection tracking
```

### Unit test count targets

| Area | Current tests | After refactor |
|------|--------------|----------------|
| `server/routes/data.ts` | 0 | ~20 (CRUD for each entity) |
| `server/lib/db/` | 0 | ~10 (schema compatibility, PGlite vs Postgres) |
| `server/routes/auth.ts` challenge store | 0 | ~5 (store, retrieve, expire, one-time-use) |
| `server/lib/dispatch/dispatch-queue.ts` | existing | ~5 additional (DB-backed queue) |
| `src/stores/*` (static analysis) | 0 | ~14 (one per store, verifying no IndexedDB imports) |
| Frontend loading/error states | 0 | ~10 (loading skeleton renders, error banner renders) |

---

## File Change Summary

### New files
- `server/lib/pg-pubsub.ts` — Postgres LISTEN/NOTIFY wrapper
- `src/components/ui/skeleton.tsx` — Loading skeleton component
- `src/components/ui/error-banner.tsx` — Error display component
- New Drizzle migration for: `webauthn_challenges`, `device_codes`, `dispatch_queue` tables

### Modified files (major changes)
- `server/lib/db/index.ts` — Add PGlite driver, `createDb()` factory
- `server/routes/data.ts` — Replace Supabase SDK with Drizzle ORM
- `server/routes/auth.ts` — Replace in-memory `challengeStore` with Postgres table
- `server/lib/device-code-store.ts` — Replace in-memory Map with Postgres table
- `server/lib/session-manager.ts` — Replace in-memory Map with DB cancellation flag
- `server/lib/dispatch/dispatch-queue.ts` — Replace in-memory Map with Postgres table
- `server/lib/machine-registry.ts` — Make DB-authoritative, in-memory as read cache
- `server/lib/relay-server.ts` — Use Postgres LISTEN/NOTIFY instead of Redis
- `server/index.ts` — Simplify startup, conditional route loading
- `server/middleware/auth.ts` — Simplified: local mode returns 'local', server validates JWT
- `src/lib/data-client.ts` — Remove `isLocalMode()` throw
- All 14 stores — Remove IndexedDB, add loading/error states

### Deleted files
- `src/lib/db.ts` — idb-keyval wrapper (no longer needed)
- `server/lib/redis-pubsub.ts` — Replaced by Postgres LISTEN/NOTIFY

### Removed dependencies
- `idb-keyval` — No longer used
- `ioredis` or `redis` — If present, no longer needed for early tiers

### Added dependencies
- `@electric-sql/pglite` — In-process Postgres for local mode
