> **SUPERSEDED:** This document has been consolidated into [`ARCHITECTURE.md`](./ARCHITECTURE.md), which is now the single comprehensive architecture reference. This file is kept for historical context only.

# Server Architecture V2: Server-Centric Design

## Current Status (2026-02-22)

The PGlite unification refactor described in this document has been **fully implemented** through Phase 3:

- **Phases 1-2 (Unified Data Layer + Frontend Cleanup): COMPLETE.** PGlite is the local-mode database, Drizzle ORM provides a unified query layer, all IndexedDB usage has been removed, all frontend stores use `fetch('/api/...')` with `loading`/`error` state, `idb-keyval` has been uninstalled, and the `X-Team-Id` header enables team-scoped queries.
- **Phase 3 (Stateless Backend): COMPLETE.** All cross-request in-memory Maps moved to Postgres: `webauthn_challenges`, `device_codes`, `chat_sessions`, `dispatch_queue_entries`, `shared_bundles`. Redis pub/sub (`redis-pubsub.ts`) handles cross-instance relay routing (machine state sync, task dispatch/cancel forwarding). The backend can safely run 2+ instances with `REDIS_URL` configured.
- **Phase 4+ (Scaling): READY.** With `REDIS_URL` set, Fly.io autoscaling works. WebSocket connections are inherently per-machine; Redis handles routing dispatches to the correct instance.

See `docs/design/LOCAL_SERVER_REFACTOR.md` for the detailed implementation plan and `ARCHITECTURE.md` for the consolidated reference.

---

## Problem Statement (RESOLVED — Phases 1-2 complete)

The previous architecture was designed local-first: IndexedDB was the primary store, the server was an optional sync layer. This created fundamental problems for server mode:

1. **Two sources of truth** — IndexedDB and Supabase could diverge, with no clear winner
2. **Silent error masking** — API failures fell back to IndexedDB, hiding real problems from users
3. **In-memory backend state** — WebAuthn challenges, device codes, sessions stored in JavaScript `Map`s break with multiple backend instances *(Phase 3 — still pending)*
4. **Stale cache** — User on device B saw device A's old IndexedDB data mixed with fresh server data
5. **Unnecessary complexity** — 17 stores each implemented their own API-then-IndexedDB fallback pattern

These were not bugs to fix one by one. They were symptoms of a local-first architecture running in server mode.

> **Status (2026-02-21):** Problems 1, 2, 4, and 5 have been fully resolved. IndexedDB has been removed entirely. All frontend stores now use `fetch('/api/...')` exclusively, with `loading`/`error` state instead of silent fallbacks. Problem 3 (in-memory backend state) remains — this is Phase 3 work.

---

## Design Principles

### 1. The server is the single source of truth

Right now, if you ask "what projects does this user have?", there are two answers:
- Supabase says: `[Project A, Project B]`
- IndexedDB says: `[Project A]` (stale — Project B was created on another device)

Which is right? The code tries Supabase first, falls back to IndexedDB. So sometimes the user sees 1 project, sometimes 2, depending on whether the API call succeeded.

**Single source of truth means**: there is exactly one place that knows the answer. In server mode, that's Supabase. The frontend doesn't store its own copy. It asks the server, displays what it gets, period.

### 2. Failures are visible

Here's what `execution-store.ts` used to do (before the refactor):

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

The user had no idea the server call failed. They saw data that might be hours old. They might make decisions based on stale information.

**Visible failures means**: if the API is down, show a red banner or error state. A blank screen with "Failed to load, retry?" is honest. Showing yesterday's data without telling the user is a lie.

> **Resolved:** All stores now set `error` state on API failure instead of falling back to IndexedDB. The IndexedDB fallback pattern has been completely removed.

### 3. The backend is stateless *(Phase 3 — not yet implemented)*

**Stateless means: the backend keeps nothing in memory between requests.** After a request handler finishes, the backend forgets everything about it.

Here's what "stateful" looks like — what still exists in the current code (`auth.ts:51`):

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

**Stateless means**: any data that must survive between requests goes to the **database** (Postgres):

```typescript
// Request 1 hits Machine A:
POST /register-options → INSERT INTO webauthn_challenges ('reg:alice', 'abc123')
//                        ↑ stored in Postgres, visible to ALL machines

// Request 2 hits Machine B:
POST /register-verify  → SELECT FROM webauthn_challenges WHERE key = 'reg:alice'
//                        ↑ finds it, because Postgres is shared
```

Now it doesn't matter which machine handles which request. They all read and write the same database.

**What CAN stay in memory**: things local to a single request (local variables, the HTTP request/response objects). Read-only caches are also fine — if the cache is wrong, the worst case is a miss and a database read.

**What CANNOT stay in memory**: anything that request B needs to read that request A wrote — challenges, sessions, device codes, dispatch queues, rate limit counters.

The one exception: **WebSocket connections** are inherently in-memory (the relay server holds live connections). For cross-instance routing, use Postgres `LISTEN/NOTIFY` (built into Postgres, no extra dependency). Only add Redis at extreme scale if Postgres pub/sub becomes a throughput bottleneck.

### 4. Postgres everywhere — same code, different connection string

Both local and server mode talk to the same backend API. The backend talks to Postgres. The only difference is **which Postgres**:

```
LOCAL MODE:
  Browser → localhost:3001 (Hono) → PGlite (Postgres compiled to WASM, in-process)

SERVER MODE:
  Browser → Fly.io (Hono) → Postgres (Supabase / Fly.io Postgres / AWS RDS)
```

**No IndexedDB anywhere.** This target has been achieved. There is no browser-side database and no cache layer. The browser is a thin client that renders what the API returns. The frontend code is identical in both modes — always calls `fetch('/api/...')`, never checks `isServerMode()`. The `idb-keyval` dependency and `src/lib/db.ts` have been deleted.

The backend code is also identical. Drizzle ORM queries work against any Postgres instance. The database driver is chosen by a connection string at startup:

```bash
# Local (PGlite — no DATABASE_URL needed, Postgres runs in-process via WASM)
# Data stored in ~/.astro/data/

# Supabase (beta)
DATABASE_URL=postgresql://postgres:password@db.abc.supabase.co:5432/postgres

# Fly.io managed Postgres (with VC funding)
DATABASE_URL=postgresql://postgres:password@astro-db.internal:5432/astro

# AWS RDS (at scale)
DATABASE_URL=postgresql://admin:password@astro.abc.us-east-1.rds.amazonaws.com:5432/astro
```

**The migration from Supabase to any other Postgres provider is a config change, not a code change.**

### 5. Postgres for everything — no Redis

Postgres has built-in pub/sub (`LISTEN/NOTIFY`) and handles ephemeral state (challenges, rate limits) as regular tables with TTL. No extra infrastructure needed:

```sql
-- Cross-instance relay routing (replaces Redis pub/sub)
NOTIFY relay_channel, '{"type":"task.dispatch","machineId":"abc",...}';
LISTEN relay_channel;

-- Ephemeral state (replaces in-memory Maps)
INSERT INTO webauthn_challenges (key, challenge, expires_at) VALUES (...);
DELETE FROM webauthn_challenges WHERE expires_at < now();  -- periodic cleanup
```

**The stack is: Fly.io + Postgres. Two things to manage.** Only add Redis if Postgres `LISTEN/NOTIFY` becomes a throughput bottleneck (10K+ messages/second), which is a far-future problem.

### 6. Team-scoped data — same query, different team ID

All data is scoped by **team**. There are two account types:

- **Personal account** (launch) — each user gets an auto-created team with one member. The team layer is invisible to the user.
- **Team account** (post-launch, paid) — multiple users with different emails share a team. The team is the billing unit.

Under the hood, both are the same `teams` table. A personal account IS a team with one member. All top-level data (projects, initiatives, machines) has a `team_id` column. Child data (plan nodes, edges, executions) is scoped via its parent project's `team_id`. The same SQL runs in both modes — only the `team_id` value differs.

**Local mode**: On first startup, the backend creates one implicit team and one implicit user:

```sql
-- Auto-created during local mode bootstrap
INSERT INTO teams (id, name) VALUES ('00000000-0000-0000-0000-000000000000', 'Local')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO user_profiles (id, name, email) VALUES ('00000000-0000-0000-0000-000000000001', 'Local User', 'local@astro')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO team_members (team_id, user_id, role) VALUES ('00000000-...0000', '00000000-...0001', 'owner')
  ON CONFLICT DO NOTHING;
```

The auth middleware sets `userId` and `teamId` to these fixed UUIDs. Every query uses `WHERE team_id = ?` and gets the local team.

**Server mode**: The auth middleware validates the JWT, extracts the `userId`, then resolves their team(s) from the `team_members` table:

```sql
SELECT team_id FROM team_members WHERE user_id = $1
```

If a user belongs to one team (most cases), routes use `WHERE team_id = ?`. If a user belongs to multiple teams, the active team is set via a request header or session preference. Billing is per-team — the team is the subscription unit.

**The query is always the same:**

```typescript
// This query works in BOTH modes — same SQL, different team_id value
const rows = await db.select().from(projects).where(eq(projects.teamId, teamId))
```

Local mode: `teamId = '00000000-0000-0000-0000-000000000000'`
Server mode: `teamId = 'real-uuid-from-team-members'`

**What gets `teamId` directly** (top-level entities):
- `projects` — already has `team_id` column
- `initiatives` — needs `team_id` column added
- `registered_machines` — already has `team_id` column

**What's scoped via project** (child entities — no `team_id` column needed):
- `plan_nodes`, `plan_edges` — scoped via `project_id`
- `task_executions`, `tool_traces`, `file_changes` — scoped via `project_id`
- `sessions`, `task_chat_sessions` — scoped via `project_id`
- `activity_events` — scoped via `project_id`

**What's scoped by user** (personal entities):
- `user_profiles` — scoped by `id` (the user themselves)
- `display_settings`, `usage_metrics` — scoped by `user_id`
- `passkey_credentials`, `connected_accounts` — scoped by `user_id`

---

## Code Organization: Unified Architecture

### The key insight: no mode branching anywhere

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND                             │
│                                                          │
│  React Components → Zustand Stores → fetch('/api/...')   │
│                                                          │
│  No isServerMode(). No IndexedDB. No mode branching.     │
│  Always talks to the backend API. Identical in both modes.│
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP (same API)
┌──────────────────────────▼──────────────────────────────┐
│                      BACKEND (Hono)                      │
│                                                          │
│  Routes → Business logic → Drizzle ORM queries           │
│                                                          │
│  Same code in both modes. Drizzle abstracts the driver.  │
│  Mode only affects: auth middleware, server-only routes.  │
└──────────────────────────┬──────────────────────────────┘
                           │ Drizzle ORM
              ┌────────────┴────────────┐
              │                         │
   ┌──────────▼──────────┐  ┌──────────▼──────────┐
   │  PGlite (local)     │  │  Postgres (server)   │
   │  in-process WASM    │  │  Supabase / Fly.io   │
   │  ~/.astro/data/     │  │  Postgres / AWS RDS  │
   │  Zero install.      │  │  Connection string.  │
   └─────────────────────┘  └──────────────────────┘
```

### Frontend stores — zero mode awareness (IMPLEMENTED)

```typescript
// src/stores/project-store.ts — same code in local and server (this is the current implementation)

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/data/projects')
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`)
      set({ projects: await res.json(), loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load', loading: false })
    }
  },
  // No isServerMode(). No IndexedDB. No fallbacks.
}))
```

### Database initialization — PGlite or Postgres, chosen by env var (IMPLEMENTED)

```typescript
// server/lib/db/index.ts

import { drizzle } from 'drizzle-orm/pglite'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { PGlite } from '@electric-sql/pglite'
import * as schema from './schema'

export function createDb() {
  if (process.env.DATABASE_URL) {
    // Server mode: connect to external Postgres
    return drizzlePg(process.env.DATABASE_URL, { schema })
  } else {
    // Local mode: PGlite in-process (zero install, real Postgres)
    const dataDir = process.env.ASTRO_DATA_DIR || '~/.astro/data'
    const client = new PGlite(dataDir)
    return drizzle({ client, schema })
  }
}

export const db = createDb()
```

### Backend routes — same Drizzle queries for both modes (IMPLEMENTED)

```typescript
// server/routes/data.ts — identical code for local and server

import { db } from '../lib/db'
import { projects } from '../lib/db/schema'

app.get('/api/data/projects', async (c) => {
  const teamId = c.get('teamId')  // fixed UUID in local mode, real UUID in server mode
  const rows = await db.select().from(projects).where(eq(projects.teamId, teamId))
  return c.json(rows)
})
```

Same Drizzle query. PGlite and Postgres both speak the same SQL — because PGlite IS Postgres compiled to WASM. JSONB, TIMESTAMPTZ, UUID — all work. The `teamId` is set by the auth middleware: a fixed well-known UUID in local mode, or the user's active team UUID in server mode.

### What differs between local and server mode

| Aspect | Local mode | Server mode |
|--------|-----------|-------------|
| Database | PGlite (in-process, `~/.astro/data/`) | Postgres (Supabase / Fly.io / AWS RDS) |
| Install | `npm install` (PGlite bundled, 3MB) | Connection string in env var |
| Auth middleware | Sets `userId` + `teamId` to fixed local UUIDs | Validates JWT, resolves `userId` → `teamId` from `team_members` |
| Data scoping | `WHERE team_id = 'local-team-uuid'` | `WHERE team_id = 'real-team-uuid'` |
| Teams | One implicit team (auto-created, invisible to user) | Real teams — create, invite, manage, billing unit |
| Server-only routes | Not loaded (auth, team-management, device-auth) | Loaded via dynamic import |
| Realtime updates | Not needed (single user) | Postgres LISTEN/NOTIFY → SSE |
| Frontend code | **100% identical** | **100% identical** |
| Backend route logic | **100% identical** | **100% identical** |
| Relay | `ws://localhost:3002` | `wss://relay.example.com:3002` |
| Data export | JSON export from API | JSON export from API (same endpoint) |

### What's shared (everything except ~5 files)

| Code | Shared | Notes |
|------|--------|-------|
| Frontend (`src/`) | 100% | No mode branching at all |
| Backend routes (`server/routes/data.ts`, `agent.ts`, etc.) | 100% | Same Drizzle queries, scoped by `teamId` |
| Drizzle schema (`server/lib/db/schema.ts`) | 100% | One schema, one migration set. Teams table shared. |
| Team scoping logic | 100% | `WHERE team_id = ?` in all data queries — same code |
| Server-only routes (`auth.ts`, `team-management.ts`, `device-auth.ts`) | Server only | Team CRUD, invites, billing. Dynamically imported. |
| Auth middleware | Differs | Local: fixed UUIDs. Server: JWT → resolve `teamId` from `team_members` |
| `server/index.ts` startup | Differs slightly | Server loads extra routes. Local bootstraps implicit team. |

---

## User Journey

### Local mode (open source user)

```bash
# User downloads and starts Astro — no Docker, no external database
npm install
npm start
# → PGlite starts (Postgres in WASM, inside the Node.js process)
# → Hono backend starts on port 3001
# → Frontend served on localhost:5173
# → Implicit team + user auto-created on first run
```

The user opens `http://localhost:5173`. No login — single user with an auto-created personal team. The frontend calls the same API endpoints as server mode. The backend runs the same Drizzle queries against PGlite (which is real Postgres compiled to WASM). Data lives in `~/.astro/data/`, persists across restarts.

### Server mode (hosted website)

```
Browser ──GET──→ Cloudflare CDN (static JS/CSS/HTML)
  │
  │  React app boots, checks for JWT in localStorage
  │  No JWT → redirect to /login
  │  Valid JWT → proceed to dashboard
  │
  │  GET /api/data/projects
  │  Authorization: Bearer {jwt}
  │ ─────────────────────────────────→ Backend (any Fly.io machine)
  │                                      │
  │                                      │  Drizzle: SELECT * FROM projects
  │                                      │  WHERE owner_id = {user}
  │                                      │ ────────────────────→ Postgres
  │                                      │
  │  { projects: [...] }                 │
  │ ←────────────────────────────────────│
  │
  │  [Zustand: set({ projects })]
  │  [React renders]
```

**No IndexedDB.** IndexedDB has been fully removed from the frontend. If the API call fails, the user sees a loading error, not stale cached data. Challenges, sessions, and device codes are still in-memory Maps (Phase 3 will move these to Postgres tables so any backend machine can handle any request).

### Data export

Users can export their data as JSON for LLM analysis or backup:

```
Browser → GET /api/data/export → Backend → Postgres → JSON download
```

This covers plan graphs, execution traces, tool call logs — structured data useful for observability and LLM context.

---

## Backend State Migration *(Phase 3 — not yet implemented)*

### Current: in-memory Maps (still in place, broken with multiple machines)

| State | File | Problem |
|-------|------|---------|
| WebAuthn challenges | `auth.ts:51` | Request A stores on machine 1, request B looks up on machine 2 → not found |
| Device codes | `device-code-store.ts:20` | Same cross-machine problem |
| Active sessions | `session-manager.ts:26` | Cancel/abort hits wrong machine |
| Chat session pool | `chat-session-pool.ts:24` | Chat context lost across machines |
| Rate limits | `device-auth.ts:81` | Per-machine, not global |
| Dispatch queue | `dispatch-queue.ts` | Tasks dispatched twice or lost |
| Machine registry | `machine-registry.ts` | Machines visible on one machine only |

### Target: Postgres-backed (stateless)

| State | Target location | TTL | Notes |
|-------|----------------|-----|-------|
| WebAuthn challenges | `webauthn_challenges` table | 5 min | Key + challenge + expires_at. DELETE after use. |
| Device codes | `device_codes` table | 15 min | Already partially in DB. Complete the migration. |
| Active sessions | `cancelled` flag in executions table | Session duration | Backend checks flag instead of in-memory AbortController. |
| Chat session pool | `sessions` table | None | Already exists. Load on demand instead of pooling in memory. |
| Rate limits | Postgres counter table | Sliding window | `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1` |
| Dispatch queue | `dispatch_queue` table | Until processed | `SELECT ... FOR UPDATE SKIP LOCKED` for distributed processing. |
| Machine registry | Already in `registered_machines` | Heartbeat | DB is authoritative. In-memory is a read cache refreshed on heartbeat. |
| Relay pub/sub | Postgres `LISTEN/NOTIFY` | N/A | Built-in, no extra infrastructure. Replaces Redis pub/sub. |

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

**Backend code (Drizzle ORM):**

```typescript
// Replace: const challengeStore = new Map()

import { db } from '../lib/db'
import { webauthnChallenges } from '../lib/db/schema'

async function storeChallenge(key: string, challenge: string) {
  await db.insert(webauthnChallenges)
    .values({ key, challenge, expiresAt: new Date(Date.now() + 5 * 60_000) })
    .onConflictDoUpdate({ target: webauthnChallenges.key, set: { challenge, expiresAt: new Date(Date.now() + 5 * 60_000) } })
}

async function getChallenge(key: string): Promise<string | null> {
  const [row] = await db.delete(webauthnChallenges)  // one-time use: delete and return
    .where(and(
      eq(webauthnChallenges.key, key),
      gt(webauthnChallenges.expiresAt, new Date()),
    ))
    .returning({ challenge: webauthnChallenges.challenge })
  return row?.challenge ?? null
}
```

Same code runs against Docker Postgres (local) or Supabase Postgres (server). No Supabase SDK dependency in the query layer.

---

## Open Source vs Private: Code Separation

### The two editions

| | Open Source (local mode) | Private (server mode) |
|---|---|---|
| **Users** | Single developer on their own machine | Multi-user teams via hosted website |
| **Auth** | None (single user, implicit team) | WebAuthn passkeys, OAuth (future) |
| **Data** | PGlite (in-process Postgres, `~/.astro/data/`) | Postgres (Supabase / Fly.io / AWS RDS) |
| **Teams** | One implicit team (auto-created, invisible) | Real teams: create, invite members, manage roles. Billing unit. |
| **Data scoping** | `WHERE team_id = 'local-uuid'` (same SQL) | `WHERE team_id = 'real-uuid'` (same SQL) |
| **Install** | `npm install && npm start` (zero external deps) | We host it on Fly.io |
| **AI execution** | Agent runner on localhost → relay on localhost | Agent runner on user's machine → relay on Fly.io |
| **Multi-device** | No | Yes (Postgres LISTEN/NOTIFY) |
| **Code** | Public GitHub repo | Same repo, server-only routes excluded from release |

### What gets released (open source)

```
src/                              # Frontend (ALL of it — identical code)
├── components/                   # UI components
├── pages/                        # All pages (no mode branching)
├── stores/                       # Zustand stores (fetch from /api/*, no IndexedDB)
├── lib/                          # Utilities (no app-mode checks)
├── types/                        # All TypeScript types
server/
├── index.ts                      # Hono server setup
├── routes/
│   ├── health.ts                 # Health check
│   ├── data.ts                   # CRUD API (same Drizzle queries, works with PGlite)
│   ├── agent.ts                  # Plan generation, chat (relay to agent runner)
│   ├── dispatch.ts               # Task dispatch (relay to agent runner)
│   ├── events.ts                 # SSE bridge
│   ├── relay.ts                  # Machine management
│   ├── observations.ts           # Trace/observability data
│   └── fs.ts, repo.ts            # Filesystem access
├── lib/
│   ├── db/
│   │   ├── index.ts              # createDb() — PGlite if no DATABASE_URL, Postgres if set
│   │   └── schema.ts             # Drizzle schema (shared, one copy)
│   ├── relay-server.ts           # WebSocket relay
│   ├── machine-registry.ts       # Connected machines
│   ├── dispatch/                 # Dispatch engine
│   ├── events/                   # Event transport
│   └── prompt-templates.ts       # System prompts
packages/
└── agent-runner/                 # Agent runner (full package)
```

### What stays private (server mode only)

```
server/
├── routes/
│   ├── auth.ts                   # WebAuthn registration/login
│   ├── device-auth.ts            # Device code OAuth flow
│   ├── team-management.ts        # Team CRUD, invites, member management, billing
│   ├── notifications.ts          # Push notifications
│   ├── github.ts                 # GitHub OAuth integration
│   └── connected-accounts.ts     # Slack/Linear/Telegram
├── middleware/
│   └── auth.ts                   # JWT validation + team resolution (server: real auth; local: fixed UUIDs)
├── lib/
│   ├── supabase.ts               # Supabase client (only for auth ceremonies)
│   ├── ensure-user-profile.ts    # Auth desync self-heal
│   ├── token-manager.ts          # JWT lifecycle
│   └── email-service.ts          # Transactional email
supabase/
└── migrations/                   # Supabase-specific migrations (local uses drizzle-kit push)
```

**Note on teams**: The `teams` and `team_members` Drizzle schema tables are **shared** (they exist in local mode too — with one auto-created team). What's private is the team **management** UI and API: creating teams, inviting members, assigning roles, billing. In local mode, teams are invisible to the user.

### Build-time separation (IMPLEMENTED)

`server/index.ts` conditionally imports server-only routes:

```typescript
// server/index.ts — always loaded
app.route('/api', healthRoute)
app.route('/api/data', dataRoute)     // same Drizzle queries, works with PGlite or Postgres
app.route('/api/agent', agentRoute)
app.route('/api/relay', relayRoute)
app.route('/api/dispatch', dispatchRoute)
app.route('/api/events', eventsRoute)

if (isServerMode()) {
  // Server-only routes — these files don't exist in open-source release
  const { authRoute } = await import('./routes/auth.js')
  const { teamsRoute } = await import('./routes/teams.js')
  app.route('/api/auth', authRoute)
  app.route('/api/teams', teamsRoute)
  // ... device-auth, notifications, github, etc.
}
```

The key difference from before: `data.ts` is now shared (same Drizzle queries work against PGlite and Postgres). Only auth and multi-user features stay private.

---

## Scaling the Server Mode

### The stack: Fly.io + Postgres. Two things.

1. **Compute (Fly.io)** — Hono backend + relay. Scales horizontally (more machines). Autoscales.
2. **Database (Postgres)** — All persistent state. Scales vertically (bigger instance). Does not autoscale.

The database is the ceiling. Compute is easy to add. Database upgrades require planning.

### Supabase pricing path

| Supabase Plan | CPU | RAM | Connections | Price | When |
|---------------|-----|-----|-------------|-------|------|
| Pro | 2-core | 8GB | 60 + pooler (~200) | $25/mo | **Beta launch** |
| Team | 4-core | 16GB | 120 + pooler (~400) | $599/mo | Growth |
| Enterprise | Custom | Custom | Custom | Custom | **Production launch** |

If we outgrow Supabase or want more control, switch `DATABASE_URL` to Fly.io managed Postgres or AWS RDS. Zero code changes.

### Fly.io autoscaling

```toml
# fly.toml
[http_service]
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1
```

**Prerequisite**: backend must be stateless (Phase 3). Otherwise new machines start with empty in-memory Maps.

### Scaling tiers

#### Tier 1: Alpha (10-50 users) — current

```
Fly.io: 1 machine, performance-cpu-1x, 2GB RAM
Postgres: Supabase Pro ($25/mo)
Cost: ~$55/month
```

One machine. No autoscaling needed. Single machine avoids the in-memory state problem.

#### Tier 2: Beta (100-500 users)

**Prerequisite: Phase 3 (stateless backend) complete.**

```
Fly.io: 2-3 machines, performance-cpu-2x, 4GB each, autoscaling
Postgres: Supabase Pro ($25/mo), pgbouncer (~200 conns)
Cross-instance relay: Postgres LISTEN/NOTIFY
Cost: ~$85-145/month
```

No Redis. Postgres `LISTEN/NOTIFY` handles relay cross-instance routing at this scale (thousands of messages/second is fine).

#### Tier 3: Production (1K-10K users)

```
Fly.io: 3-10 machines, performance-cpu-4x, 8GB each, multi-region
Postgres: Supabase Enterprise (custom sizing, read replicas)
Cost: ~$200-500/month + Supabase Enterprise
```

Enterprise gives us: read replicas, higher connection limits, dedicated support.

#### Tier 4: Scale (10K-100K+ users)

Consider at this point:
- **Redis** for relay pub/sub if Postgres LISTEN/NOTIFY becomes a throughput bottleneck
- **Separate relay** into its own Fly.io app (different scaling profile)
- **Database partitioning** by date/tenant for large tables
- **CDN caching** for read-heavy API responses
- **Queue service** (SQS) for dispatch queue

### ~~What blocks horizontal scaling today~~ RESOLVED (2026-02-22)

| Blocker | Resolution |
|---------|------------|
| `challengeStore` in-memory Map | ✅ `webauthn_challenges` Postgres table (`challenge-store.ts`) |
| `deviceCodeStore` in-memory Map | ✅ `device_codes` Postgres table (`device-code-store.ts`) |
| `activeSessions` in-memory Map | ✅ `chat_sessions` Postgres table; session manager deleted |
| `dispatchQueue` in-memory Map | ✅ `dispatch_queue_entries` Postgres table with priority ordering |
| `machineRegistry` in-memory only | ✅ In-memory per-instance + Redis pub/sub for cross-instance sync |
| No cross-instance relay routing | ✅ Redis pub/sub (`redis-pubsub.ts`) for dispatch/cancel forwarding |

**Horizontal scaling is now supported.** Set `REDIS_URL` to enable cross-instance relay routing. Without Redis, single-instance deployment still works (the default for local dev).

---

## Action Items

See `docs/design/LOCAL_SERVER_REFACTOR.md` for the detailed step-by-step refactoring plan with file-level changes and unit test strategy.

### Phase summary

| Phase | Goal | Key deliverable | Status |
|-------|------|-----------------|--------|
| 1. Stabilize alpha | Make current deployment reliable on 1 machine | Move in-memory challenges/device codes to Postgres | **DONE** (merged into Phase 4) |
| 2. Unified data layer | Drizzle ORM + PGlite for local, Postgres for server | `server/lib/db/` with shared schema, `createDb()` | **DONE** |
| 3. Frontend cleanup | Remove all IndexedDB and mode branching from frontend | Stores call `fetch('/api/...')` only, loading skeletons | **DONE** |
| 4. Stateless backend | Move all in-memory Maps to Postgres tables | `webauthn_challenges`, `device_codes`, `chat_sessions`, `dispatch_queue_entries` tables | **DONE** |
| 5. Cross-instance relay | Redis pub/sub for relay routing | `redis-pubsub.ts`: machine state sync, dispatch/cancel forwarding | **DONE** (Redis, not Postgres LISTEN/NOTIFY) |
| 6. Beta launch | 2+ machines, autoscaling, monitoring | Set `REDIS_URL`, deploy 2 Fly.io machines | **READY** |
| 7. Production launch | Supabase Enterprise, multi-region | 1K+ users | Pending |

> **Note:** Cross-instance relay routing uses Redis pub/sub (not Postgres LISTEN/NOTIFY as originally planned). Redis is a better fit for high-throughput real-time message routing. Postgres LISTEN/NOTIFY remains an option for low-traffic deployments that want to avoid the Redis dependency.

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Local mode database | **PGlite** (Postgres in WASM, in-process) | Zero install (`npm install`), same SQL dialect as server, Drizzle ORM compatible. Data in `~/.astro/data/`. |
| Server mode database | **Postgres** (Supabase → Fly.io Postgres → AWS RDS) | Portable via connection string. Pro for beta, Enterprise for launch. |
| IndexedDB | **Removed entirely (DONE).** Not used in any mode. `src/lib/db.ts` deleted, `idb-keyval` uninstalled. | Frontend is a thin client. Backend + Postgres is the only data layer. |
| Data scoping | **Team-based.** All top-level queries use `WHERE team_id = ?`. | Same SQL in local (implicit team) and server (real team). Teams are the billing unit. |
| Local mode teams | **One implicit team**, auto-created at first startup. Invisible to user. | Keeps the single-user experience clean while using the same queries as server mode. |
| Server mode teams | **Real teams** with members, roles, invites. Billing unit for subscriptions. | Multi-user orgs charge per-team. Users can belong to multiple teams. |
| Frontend mode branching | **None.** Frontend always calls `fetch('/api/...')`. | 100% identical frontend code in local and server mode. |
| Backend mode branching | **Minimal.** Only in `server/index.ts` (which routes to load) and auth middleware. | Data routes use Drizzle ORM against PGlite or Postgres — same code, same team-scoped queries. |
| Cross-instance pub/sub | **Postgres LISTEN/NOTIFY.** No Redis. | Built into Postgres, no extra infrastructure. Add Redis only at Tier 4 if throughput is a bottleneck. |
| Cache layer | **HTTP cache headers only.** No app-level cache. | Browser-native caching via `Cache-Control`/`ETag`. Loading skeletons for first paint. |
| Open source distribution | **npm package with PGlite bundled** (`npm start` works out of the box) | No Docker, no external Postgres. Single command to run. |
| Data export | **JSON export endpoint** for observability/LLM data | Users can download execution traces, plans, tool calls. |

## Open Questions

1. **React Query vs manual fetching?** TanStack Query handles retries, deduplication, stale-while-revalidate at the HTTP level. Would eliminate store loading boilerplate. Significant refactor but high payoff. *(Still open — not yet adopted.)*

2. **PGlite LISTEN/NOTIFY support?** ~~PGlite supports core Postgres SQL, but LISTEN/NOTIFY may not work in single-connection WASM mode.~~ **RESOLVED:** Local mode does not need cross-instance routing (single process, single user). LISTEN/NOTIFY is only relevant for server mode with multiple backend instances — and in that case, real Postgres is used via `DATABASE_URL`. No polling fallback needed for local.

3. **Drizzle schema compatibility.** ~~Verify that all column types we use (JSONB, TIMESTAMPTZ, UUID, ARRAY) work in PGlite.~~ **RESOLVED: YES.** The full Drizzle schema (`drizzle-orm/pg-core`) works against PGlite. JSONB, TIMESTAMPTZ, UUID, array columns, `ON CONFLICT`, `RETURNING` — all verified. Unit tests (`db-pglite.test.ts`) confirm schema migration and CRUD operations work identically on PGlite and Postgres.

4. **Multi-team switching UX.** When a user belongs to multiple teams, how do they switch? Options: (a) team selector dropdown in sidebar, (b) subdomain-based routing (`team-name.astro.app`), (c) query param or session cookie. Decision deferred until team billing is implemented. *(Still open — Phase B feature.)*

5. **Team-level vs user-level settings.** Some settings (display preferences, API keys) are clearly per-user. Others (default machine, default model) could be per-team. Need to decide the scoping for each setting type when teams ship. *(Still open — Phase B feature.)*
