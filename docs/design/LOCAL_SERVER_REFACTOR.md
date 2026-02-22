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

### How local and server mode use the same code

Both modes use **Postgres** as the database. The difference is where Postgres runs:

```
┌─────────────────────────────────────────────────────────────────┐
│                     THE UNIFICATION                              │
│                                                                  │
│  LOCAL MODE                      SERVER MODE                     │
│  ──────────                      ───────────                     │
│  PGlite = Postgres compiled      Supabase = hosted Postgres      │
│  to WebAssembly. Runs inside     (or Fly.io Postgres, AWS RDS,   │
│  the Node.js process. No         or any Postgres provider).      │
│  network, no install, same       Connect via TCP.                │
│  SQL dialect.                                                    │
│                                                                  │
│  ┌──────────────────┐            ┌──────────────────┐           │
│  │  Hono backend    │            │  Hono backend    │           │
│  │                  │            │                  │           │
│  │  Drizzle ORM ────┤            │  Drizzle ORM ────┤           │
│  │  (generates SQL) │            │  (generates SQL) │           │
│  └────────┬─────────┘            └────────┬─────────┘           │
│           │                               │                      │
│    PGlite driver                   postgres-js driver            │
│    (in-process WASM)               (TCP connection)              │
│           │                               │                      │
│    ┌──────▼──────┐               ┌────────▼────────┐            │
│    │  PGlite     │               │  Supabase /     │            │
│    │  (Postgres  │               │  Fly.io / AWS   │            │
│    │   in WASM)  │               │  (real Postgres) │            │
│    │  ~/.astro/  │               │  via TCP         │            │
│    └─────────────┘               └─────────────────┘            │
│                                                                  │
│  SAME Drizzle schema. SAME SQL generated. SAME query results.   │
│  The only difference is the driver (how bytes reach Postgres).   │
└─────────────────────────────────────────────────────────────────┘
```

**Why this works**: PGlite is not a "Postgres-like" database. It IS Postgres — the actual C code compiled to WASM. JSONB, UUID, TIMESTAMPTZ, array columns, `ON CONFLICT`, `RETURNING` — all work identically. Drizzle ORM uses `drizzle-orm/pg-core` for the schema definition, and the same schema compiles against both the `drizzle-orm/pglite` driver and the `drizzle-orm/postgres-js` driver.

**The switch is one environment variable**:
- `DATABASE_URL` not set → PGlite (local, in-process, data in `~/.astro/data/`)
- `DATABASE_URL` set → connect to that Postgres instance (Supabase today, any provider tomorrow)

### Frontend data flow (unified)

```
Store.load() →
  fetch('/api/data/x') →
  if ok: set({ data, loading: false })
  if error: set({ error, loading: false })  →  UI shows error banner
```

No `isServerMode()`. No IndexedDB. No fallbacks. Same code in local and server. The frontend doesn't know or care which Postgres is behind the API.

### Backend data flow (unified)

```
Route handler →
  const teamId = c.get('teamId')   ← set by auth middleware (fixed UUID local, real UUID server)
  Drizzle ORM query with WHERE team_id = $teamId →
  PGlite driver (if no DATABASE_URL) OR postgres-js driver (if DATABASE_URL set)
  → Same SQL, same results
```

No Supabase HTTP API for data operations. Supabase SDK only for auth ceremonies (WebAuthn, magic links) in server mode.

### The `createDb()` factory — the only place modes diverge in the data layer

```typescript
// server/lib/db/index.ts — this is the ONLY file that knows about PGlite vs Postgres

import * as schema from './schema'   // same schema for both

export async function createDb() {
  if (process.env.DATABASE_URL) {
    // SERVER MODE: connect to external Postgres over TCP
    // Could be Supabase, Fly.io Postgres, AWS RDS — any Postgres provider
    const postgres = (await import('postgres')).default
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const client = postgres(process.env.DATABASE_URL)
    return drizzle(client, { schema })
  } else {
    // LOCAL MODE: start Postgres in-process via PGlite (WebAssembly)
    // No network, no install, data stored on local disk
    const { PGlite } = await import('@electric-sql/pglite')
    const { drizzle } = await import('drizzle-orm/pglite')
    const dataDir = process.env.ASTRO_DATA_DIR || `${process.env.HOME}/.astro/data`
    const client = new PGlite(dataDir)
    return drizzle({ client, schema })
  }
}
```

After this function runs, every route handler gets `db` and uses it the same way. No route ever checks which driver is behind `db`. The abstraction is watertight.

---

## Team-Based Data Scoping

### Design principle

All data is scoped by **team**. The team is the organizational boundary — in local mode it's an invisible singleton, in server mode it's a real entity that users create, invite members to, and pay for.

**Every data query uses `team_id`.** This is the single most important rule. Not `owner_id`, not `user_id` — `team_id`. A team owns projects, not a user. A user is a member of a team and can access the team's projects based on their role.

### Schema changes needed

**Tables that already have `team_id`:**
- `projects` — `team_id uuid` (currently optional, must become **required**)
- `registered_machines` — `team_id uuid` (currently optional, must become **required**)

**Tables that need `team_id` added:**
- `initiatives` — add `team_id uuid NOT NULL` (currently scoped by `owner_id` only)

**Tables that DON'T need `team_id`** (scoped via parent):
- `plan_nodes`, `plan_edges` — scoped via `project_id` → `projects.team_id`
- `task_executions`, `tool_traces`, `file_changes` — scoped via `project_id`
- `sessions`, `task_chat_sessions`, `task_chat_messages` — scoped via `project_id`
- `activity_events`, `machine_usage_logs` — scoped via `project_id`
- `observation_events` — scoped via `project_id`

**Tables scoped by user (personal, not team-scoped):**
- `user_profiles` — personal identity
- `display_settings` — personal UI preferences
- `usage_metrics` — personal usage tracking
- `passkey_credentials` — personal auth
- `connected_accounts` — personal integrations
- `audit_logs` — personal audit trail
- `push_tokens` — personal notifications

**Tables that are team infrastructure:**
- `teams` — the teams themselves
- `team_members` — user-to-team mapping with roles
- `invite_tokens` — team invitation tokens

### Migration SQL

```sql
-- Make projects.team_id required (currently optional)
-- First, backfill any NULL team_ids
UPDATE projects SET team_id = owner_id WHERE team_id IS NULL;
-- For local mode, this will be the local team UUID after bootstrap

ALTER TABLE projects ALTER COLUMN team_id SET NOT NULL;

-- Add team_id to initiatives
ALTER TABLE initiatives ADD COLUMN team_id uuid;
UPDATE initiatives SET team_id = owner_id WHERE team_id IS NULL;
ALTER TABLE initiatives ALTER COLUMN team_id SET NOT NULL;

-- Make registered_machines.team_id required
UPDATE registered_machines SET team_id = user_id WHERE team_id IS NULL;
ALTER TABLE registered_machines ALTER COLUMN team_id SET NOT NULL;

-- Add indexes for team-scoped queries
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects (team_id);
CREATE INDEX IF NOT EXISTS idx_initiatives_team ON initiatives (team_id);
CREATE INDEX IF NOT EXISTS idx_registered_machines_team ON registered_machines (team_id);
```

### Local mode bootstrap

On first startup (when PGlite database is empty), create the implicit team:

```typescript
// server/lib/db/bootstrap.ts
const LOCAL_TEAM_ID = '00000000-0000-0000-0000-000000000000'
const LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001'

export async function bootstrapLocalMode(db: DrizzleDb) {
  // Idempotent — safe to call every startup
  await db.insert(teams).values({
    id: LOCAL_TEAM_ID,
    name: 'Local',
    description: 'Auto-created local team',
  }).onConflictDoNothing()

  await db.insert(userProfiles).values({
    id: LOCAL_USER_ID,
    name: 'Local User',
    email: 'local@astro.local',
  }).onConflictDoNothing()

  await db.insert(teamMembers).values({
    teamId: LOCAL_TEAM_ID,
    userId: LOCAL_USER_ID,
    role: 'owner',
  }).onConflictDoNothing()
}
```

Called in `server/index.ts` after `createDb()` when `DATABASE_URL` is not set.

### Auth middleware — team resolution

```typescript
// server/middleware/auth.ts
export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const db = c.get('db')

    if (!process.env.DATABASE_URL) {
      // Local mode: fixed user and team
      c.set('userId', LOCAL_USER_ID)
      c.set('teamId', LOCAL_TEAM_ID)
      c.set('teamIds', [LOCAL_TEAM_ID])
      return next()
    }

    // Server mode: validate JWT, resolve teams
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) return c.json({ error: 'Unauthorized' }, 401)

    const user = await verifyJwt(token)
    c.set('userId', user.id)

    // Resolve user's teams
    const memberships = await db.select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, user.id))
    const teamIds = memberships.map(m => m.teamId)

    if (teamIds.length === 0) {
      return c.json({ error: 'No team membership' }, 403)
    }

    // Active team: from header, or default to first team
    const requestedTeam = c.req.header('X-Team-Id')
    const activeTeam = requestedTeam && teamIds.includes(requestedTeam)
      ? requestedTeam
      : teamIds[0]

    c.set('teamId', activeTeam)
    c.set('teamIds', teamIds)
    return next()
  }
}
```

### Data route pattern — team-scoped queries

Every data endpoint uses `teamId` from context:

```typescript
// GET /api/data/projects — list projects for the active team
app.get('/projects', async (c) => {
  const db = c.get('db')
  const teamId = c.get('teamId')
  const rows = await db.select().from(projects).where(eq(projects.teamId, teamId))
  return c.json(rows)
})

// POST /api/data/projects — create project under the active team
app.post('/projects', async (c) => {
  const db = c.get('db')
  const teamId = c.get('teamId')
  const userId = c.get('userId')
  const body = await c.req.json()
  const [row] = await db.insert(projects).values({
    ...body,
    teamId,
    ownerId: userId,  // track who created it, but team owns it
  }).returning()
  return c.json(row)
})

// GET /api/data/plan-nodes?projectId=... — child entities verified via project's team
app.get('/plan-nodes', async (c) => {
  const db = c.get('db')
  const teamId = c.get('teamId')
  const projectId = c.req.query('projectId')!

  // Verify the project belongs to this team (prevents cross-team access)
  const [project] = await db.select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)))
  if (!project) return c.json({ error: 'Not found' }, 404)

  const rows = await db.select().from(planNodes).where(eq(planNodes.projectId, projectId))
  return c.json(rows)
})
```

### What queries change

| Current query | New query |
|---------------|-----------|
| `WHERE owner_id = $userId` | `WHERE team_id = $teamId` |
| `VALUES (..., owner_id: userId)` | `VALUES (..., team_id: teamId, owner_id: userId)` |
| Child entity: no team check | Child entity: verify parent project's `team_id` matches |

The `owner_id` column is kept as a "created by" audit field, but it's no longer the primary access control filter. `team_id` is.

### Frontend — team context

The frontend sends the active team ID via the `X-Team-Id` header (or relies on the backend default):

```typescript
// src/lib/api-client.ts
function getHeaders(): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  const token = localStorage.getItem('auth-token')
  if (token) headers['Authorization'] = `Bearer ${token}`
  const teamId = localStorage.getItem('active-team-id')
  if (teamId) headers['X-Team-Id'] = teamId
  return headers
}
```

In local mode, no `Authorization` or `X-Team-Id` headers are sent — the backend defaults to the local team.

In server mode, the team switcher (sidebar dropdown) sets `active-team-id` in localStorage.

### Account types and team model

There are two account types:

1. **Personal account** (single user) — the default. Every user gets one on registration. This is what we ship at launch.
2. **Team account** (multi-user) — a paid upgrade. Multiple users (with different emails) can be added to a team. The team is the billing unit. This ships later.

Under the hood, both account types use the same `teams` table. A personal account IS a team — a team with exactly one member. This keeps the SQL identical: all queries use `WHERE team_id = ?` regardless of whether the team has 1 member or 20.

```
PERSONAL ACCOUNT (launch):
  User registers → auto-create team "{Name}'s workspace" → user is sole owner
  All data scoped to that team_id
  No invite/member management UI shown

TEAM ACCOUNT (future):
  User upgrades or creates a new team → invites other users by email
  Multiple users share the same team_id → see each other's projects
  Team management UI, billing per team
```

**For launch: single-user accounts only.** The team infrastructure exists in the DB and queries, but the multi-user team management UI and invite flow are not exposed. Every user has exactly one auto-created team. The UX is indistinguishable from "no teams" — the team layer is invisible.

### Teams backend — what needs to be built

The teams schema exists (`teams`, `team_members`, `invite_tokens` tables) but the backend routes and frontend UI are incomplete.

#### Implementation priority

```
Phase A (required for launch — personal accounts with implicit teams):
  1. Auth middleware resolves teamId ← this refactor phase
  2. All data queries use teamId ← this refactor phase
  3. Local bootstrap creates implicit team ← this refactor phase
  4. Server mode: auto-create personal team on user registration ← auth.ts change
  NO team management UI. NO invite flow. Every user = one team = one member.

Phase B (post-launch — team accounts as paid upgrade):
  5. Team CRUD endpoints (create, update, delete)
  6. Member management (add, remove, change role)
  7. Invite flow (create token by email, accept invite)
  8. Team switcher UI (sidebar dropdown)
  9. Team settings page
  10. Billing integration (Stripe per-team subscription)
```

Phase A makes the codebase team-aware with zero UX change. Phase B adds the paid multi-user team features.

#### Backend: `server/routes/team-management.ts` (Phase B, server-only)

| Method | Endpoint | Description | Phase |
|--------|----------|-------------|-------|
| GET | `/api/teams` | List user's teams | B |
| POST | `/api/teams` | Create a team | B |
| GET | `/api/teams/:id` | Get team details | B |
| PUT | `/api/teams/:id` | Update team name/description | B |
| DELETE | `/api/teams/:id` | Delete team (owner only) | B |
| GET | `/api/teams/:id/members` | List team members | B |
| POST | `/api/teams/:id/members` | Add member (via invite) | B |
| PUT | `/api/teams/:id/members/:userId` | Change member role | B |
| DELETE | `/api/teams/:id/members/:userId` | Remove member | B |
| POST | `/api/teams/:id/invites` | Create invite token | B |
| GET | `/api/teams/:id/invites` | List pending invites | B |
| DELETE | `/api/teams/:id/invites/:tokenId` | Revoke invite | B |
| POST | `/api/invites/accept` | Accept invite (join team) | B |

All endpoints require auth. Team mutation endpoints require `owner` or `admin` role in `team_members`.

#### Frontend: team management pages (Phase B, server-only)

| Page/Component | Route | Description | Phase |
|----------------|-------|-------------|-------|
| Team settings | `/settings/team` | Team name, description, danger zone (delete) | B |
| Team members | `/settings/team/members` | Member list, role badges, remove button | B |
| Invite members | `/settings/team/invite` | Email invite form, pending invites list | B |
| Team switcher | sidebar component | Dropdown to switch active team | B |
| Accept invite | `/invite/:token` | Landing page for invite links | B |
| Billing | `/settings/billing` | Stripe checkout, plan selection, invoices | B |

#### Auto-create personal team on registration (Phase A)

When a new user registers (server mode), automatically create their personal team:

```typescript
// In auth.ts, after successful registration
async function onUserRegistered(userId: string, userName: string) {
  const [team] = await db.insert(teams).values({
    name: `${userName}'s workspace`,
    description: 'Personal workspace',
  }).returning()

  await db.insert(teamMembers).values({
    teamId: team.id,
    userId,
    role: 'owner',
  })
}
```

This means every user always has at least one team, and `teamIds.length === 0` should never happen in practice (the auth middleware check is a safety net).

---

## Phase 1: Unified Database Layer (Backend)

### Step 1.1: Add PGlite dependency

```bash
npm install @electric-sql/pglite
```

**Test**: `import { PGlite } from '@electric-sql/pglite'` compiles without error.

### Step 1.2: Modify `server/lib/db/index.ts` to support PGlite

Replace the current hardcoded Postgres connection with the `createDb()` factory described in the Target State above.

**Current code** connects to Postgres via `postgres-js` only:
```typescript
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
const client = postgres(process.env.DATABASE_URL || 'postgresql://...')
export const db = drizzle(client, { schema })
```

**New code** — the `createDb()` factory from the Target State section. Key points:
- `DATABASE_URL` set → `postgres-js` driver → TCP connection to external Postgres (Supabase, Fly.io, AWS RDS, etc.)
- `DATABASE_URL` not set → `PGlite` driver → Postgres runs in-process via WASM, data in `~/.astro/data/`
- Both drivers work with the same `drizzle-orm/pg-core` schema — same SQL, same types, same results
- The factory is `async` because PGlite initialization is async

**How routes access `db`**: Initialize in `server/index.ts` before registering routes, pass via Hono context:

```typescript
// server/index.ts
const db = await createDb()

// In local mode, bootstrap the implicit team and user
if (!process.env.DATABASE_URL) {
  await bootstrapLocalMode(db)
}

app.use('*', async (c, next) => {
  c.set('db', db)
  await next()
})
```

Routes access via `c.get('db')`. This avoids changing every import and ensures `db` is initialized once.

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

For each endpoint in `data.ts`, replace Supabase calls with team-scoped Drizzle queries:

```typescript
// BEFORE (Supabase HTTP API, scoped by owner)
const supabase = getServiceClient()
const { data, error } = await supabase
  .from('projects')
  .select('*')
  .eq('owner_id', userId)

// AFTER (Drizzle ORM, scoped by team)
const db = c.get('db')
const teamId = c.get('teamId')
const data = await db.select().from(projects).where(eq(projects.teamId, teamId))
```

**Endpoints to convert** (all in `server/routes/data.ts`):
- GET /projects → `db.select().from(projects).where(eq(projects.teamId, teamId))`
- POST /projects → `db.insert(projects).values({ ...body, teamId, ownerId: userId }).returning()`
- GET /projects/:id → `db.select().from(projects).where(and(eq(projects.id, id), eq(projects.teamId, teamId)))`
- PUT /projects/:id → `db.update(projects).set(...).where(and(eq(projects.id, id), eq(projects.teamId, teamId))).returning()`
- DELETE /projects/:id → `db.delete(projects).where(and(eq(projects.id, id), eq(projects.teamId, teamId)))`
- GET /plan-nodes?projectId → verify project belongs to team first, then `db.select().from(planNodes).where(eq(planNodes.projectId, projectId))`
- POST /plan-nodes → verify project belongs to team, then insert
- PUT /plan-nodes/:id → verify via project, then update
- DELETE /plan-nodes/:id → verify via project, then delete
- GET /initiatives → `db.select().from(initiatives).where(eq(initiatives.teamId, teamId))`
- (same team-scoped pattern for machines)
- (user-scoped entities — profile, display-settings, usage — use `userId` not `teamId`)

**Test for each endpoint**: Call the endpoint, verify the response matches the expected shape. Use both PGlite (no DATABASE_URL) and Postgres (with DATABASE_URL) to ensure both drivers produce the same results.

```typescript
describe('GET /api/data/projects', () => {
  const TEAM_A = 'aaaaaaaa-0000-0000-0000-000000000000'
  const TEAM_B = 'bbbbbbbb-0000-0000-0000-000000000000'

  it('returns empty array when no projects exist', async () => {
    const res = await app.request('/api/data/projects')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns projects for the active team', async () => {
    await db.insert(projects).values({ id: 'p1', name: 'Test', teamId: TEAM_A, ownerId: 'user1' })
    const res = await app.request('/api/data/projects', {
      headers: { 'X-Team-Id': TEAM_A }  // or mock auth that sets teamId
    })
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('Test')
  })

  it('does not return other team projects', async () => {
    await db.insert(projects).values({ id: 'p2', name: 'Other Team', teamId: TEAM_B, ownerId: 'user2' })
    const res = await app.request('/api/data/projects', {
      headers: { 'X-Team-Id': TEAM_A }
    })
    const body = await res.json()
    // Only sees TEAM_A projects, not TEAM_B
    expect(body.every((p: any) => p.teamId === TEAM_A)).toBe(true)
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

### Step 4.2: Simplify auth middleware (with team resolution)

```typescript
// server/middleware/auth.ts
import { LOCAL_TEAM_ID, LOCAL_USER_ID } from '../lib/db/bootstrap'

export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const db = c.get('db')

    if (!process.env.DATABASE_URL) {
      // Local mode: fixed user and team (created by bootstrap)
      c.set('userId', LOCAL_USER_ID)
      c.set('teamId', LOCAL_TEAM_ID)
      c.set('teamIds', [LOCAL_TEAM_ID])
      return next()
    }

    // Server mode: validate JWT, resolve teams
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) return c.json({ error: 'Unauthorized' }, 401)

    const user = await verifyJwt(token)
    c.set('userId', user.id)

    // Resolve user's teams from team_members table
    const memberships = await db.select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, user.id))
    const teamIds = memberships.map(m => m.teamId)

    if (teamIds.length === 0) {
      return c.json({ error: 'No team membership' }, 403)
    }

    // Active team: from X-Team-Id header, or default to first
    const requestedTeam = c.req.header('X-Team-Id')
    const activeTeam = requestedTeam && teamIds.includes(requestedTeam)
      ? requestedTeam
      : teamIds[0]

    c.set('teamId', activeTeam)
    c.set('teamIds', teamIds)
    return next()
  }
}
```

**Key**: Every route handler accesses `c.get('teamId')` for data scoping. Same code in local and server mode — only the teamId value differs.

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

# All top-level entity queries use teamId (not ownerId for access control)
grep -r "ownerId.*userId\|owner_id.*user_id" server/routes/data.ts
# Expected: only in INSERT (ownerId as audit field), not in SELECT/WHERE for access control

# Team-scoped queries present
grep -r "teamId\|team_id" server/routes/data.ts
# Expected: every GET/PUT/DELETE endpoint references teamId
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
- `server/lib/db/bootstrap.ts` — Local mode bootstrap (create implicit team + user)
- `server/lib/pg-pubsub.ts` — Postgres LISTEN/NOTIFY wrapper
- `server/routes/team-management.ts` — Team CRUD, invites, member management (server-only, Phase B)
- `src/components/ui/skeleton.tsx` — Loading skeleton component
- `src/components/ui/error-banner.tsx` — Error display component
- New Drizzle migration for: `webauthn_challenges`, `device_codes`, `dispatch_queue` tables
- New Drizzle migration for: `initiatives.team_id`, `projects.team_id NOT NULL`, `registered_machines.team_id NOT NULL`

### Modified files (major changes)
- `server/lib/db/index.ts` — Add PGlite driver, `createDb()` factory
- `server/lib/db/schema.ts` — Add `teamId` to `initiatives`, make `teamId` required on `projects` and `registeredMachines`
- `server/routes/data.ts` — Replace Supabase SDK with Drizzle ORM, all queries scoped by `teamId`
- `server/routes/auth.ts` — Replace in-memory `challengeStore` with Postgres table; auto-create team on registration
- `server/lib/device-code-store.ts` — Replace in-memory Map with Postgres table
- `server/lib/session-manager.ts` — Replace in-memory Map with DB cancellation flag
- `server/lib/dispatch/dispatch-queue.ts` — Replace in-memory Map with Postgres table
- `server/lib/machine-registry.ts` — Make DB-authoritative, in-memory as read cache
- `server/lib/relay-server.ts` — Use Postgres LISTEN/NOTIFY instead of Redis
- `server/index.ts` — Simplify startup, conditional route loading, call `bootstrapLocalMode()` when no DATABASE_URL
- `server/middleware/auth.ts` — Local: fixed UUIDs. Server: JWT validation + team resolution from `team_members`
- `src/lib/data-client.ts` — Remove `isLocalMode()` throw; add `X-Team-Id` header
- `src/lib/api-client.ts` — Add `X-Team-Id` header from localStorage
- All 14 stores — Remove IndexedDB, add loading/error states

### Deleted files
- `src/lib/db.ts` — idb-keyval wrapper (no longer needed)
- `server/lib/redis-pubsub.ts` — Replaced by Postgres LISTEN/NOTIFY

### Removed dependencies
- `idb-keyval` — No longer used
- `ioredis` or `redis` — If present, no longer needed for early tiers

### Added dependencies
- `@electric-sql/pglite` — In-process Postgres for local mode
