# Local Mode / Server Mode — Detailed Change Log

This document explains every change made in the `refactor/local-server-mode` branch, the reasoning behind each one, and how the pieces connect. This branch is based on `origin/main` (commit `3c3bab2`) and incorporates improvements from PR #80.

---

## The Problem We Are Solving

Astro has two ways to persist data:

1. **IndexedDB** — a browser-local database. Data lives inside the user's browser. If they clear browser data, everything is gone. No login, no server, no network needed.
2. **Supabase** — a hosted Postgres database with authentication and row-level security. Data lives on a server. Multiple users, multiple devices, survives browser clears.

**IndexedDB is always used in both modes.** In local mode it's the primary store. In server mode it's a transparent cache for fast startup and offline resilience. The mode only determines whether there's also a server behind it.

Most stores in the codebase already follow a correct pattern (we'll call it the "standard pattern" below). But we found **4 specific gaps** where the code did not follow this pattern. These gaps mean that in server mode, certain data was silently being stored only in the browser, creating an illusion of persistence that would break as soon as the user cleared their browser or opened a different device.

---

## The Standard Pattern (Reference)

Before explaining our changes, here is the **standard pattern** that most stores already follow. The `project-store.ts` is a clean example:

```typescript
// project-store.ts — the correct pattern

load: async () => {
  try {
    // Step 1: Try the API (goes through Hono server → Postgres)
    const projects = await dataClient.listProjects()
    set({ projects, loaded: true })
    // Step 2: Cache to IndexedDB for offline/fast startup
    saveState("astro-projects", projects)
  } catch {
    // Step 3: API failed → fall back to IndexedDB cache
    const saved = await loadState<Project[]>("astro-projects")
    if (saved) {
      set({ projects: saved, loaded: true })
    } else {
      set({ projects: [], loaded: true })
    }
  }
},

addProject: (project) => {
  // Step 1: Update Zustand (instant UI update)
  set({ projects: [...get().projects, project] })
  // Step 2: Write to IndexedDB (cache)
  saveState("astro-projects", next)
  // Step 3: Fire-and-forget write to server
  dataClient.createProject(project).catch(() => {})
},
```

**Why this pattern works for both modes:**
- **Local mode**: `dataClient.listProjects()` throws immediately (because `data-client.ts` line 22 checks `isLocalMode()` and throws). The `catch` block runs, and IndexedDB becomes the primary store. The fire-and-forget `dataClient.createProject()` also silently fails. No harm done — IndexedDB is the only store.
- **Server mode**: The API call succeeds, Postgres is the source of truth, and IndexedDB is just a fast cache. If Postgres is temporarily unreachable, the catch block loads stale data from IndexedDB until the server comes back.

The data-client's early throw is the key mechanism:

```typescript
// data-client.ts, line 22
if (isLocalMode()) {
  throw new Error("Local mode — no API")
}
```

This means stores don't need `if (isServerMode())` checks everywhere. They just try the API; it fails fast in local mode.

---

## Change 1: Mode Abstraction — The Rename (Phase 0)

### What changed

Created two new files:
- `src/lib/app-mode.ts` (frontend) — wraps `shouldUseSupabase()` from `supabase-client.ts`
- `server/lib/app-mode.ts` (backend) — wraps `isIndexedDBMode()` from `environment.ts`

Each exports:
```typescript
export function isLocalMode(): boolean   // was: !shouldUseSupabase()
export function isServerMode(): boolean  // was: shouldUseSupabase()
export function getAppMode(): 'local' | 'server'
```

The server module imports from `environment.ts` (not `supabase.ts`) to avoid pulling in the Supabase client dependency just for a boolean check.

Then replaced every occurrence of `shouldUseSupabase()` across ~30 files with the new names.

### Why this rename matters

**The old name described an implementation detail.** `shouldUseSupabase()` says "should we talk to the Supabase client library?" That's a low-level concern. It also misleadingly suggests the decision is about *which database library to use*, when actually the decision is about the entire application architecture — authentication, API routing, data flow, realtime sync.

**The new names describe intent.** `isServerMode()` says "are we running as a server-backed multi-user app?" `isLocalMode()` says "are we running as a browser-only single-user app?" These are the actual questions being asked at every call site.

**Concrete example of the confusion the old name caused:** The sidebar store had code like:
```typescript
if (supabase && shouldUseSupabase()) {
  const { data: { user } } = await supabase.auth.getUser()
  // ...call Supabase directly...
}
```

A developer reading this thinks "ok, we're checking if we should use the Supabase client." That's technically true, but it hides the real question: "are we in server mode?" The developer then naturally writes more direct Supabase calls, perpetuating the wrong pattern (bypassing the API layer). With `isServerMode()`, the intent is clear — and it becomes obvious that the code should be using `dataClient` instead.

### What did NOT change

The underlying detection logic stayed exactly the same. `shouldUseSupabase()` still exists in `supabase-client.ts`. The new functions just wrap it. No runtime behavior changed. This is purely a naming/readability improvement.

### Files touched (~30 total)

- ~18 frontend files: replaced `import { shouldUseSupabase }` with `import { isLocalMode }` or `import { isServerMode }` from `@/lib/app-mode`
- ~6 server files: same pattern with `'../lib/supabase.js'` → `'../lib/app-mode.js'`
- The sidebar badge text changed from `"IndexedDB Mode (Local Only)"` to `"Local Mode"`

---

## Change 2: Activity Store — Add Server Persistence (Phase 1)

### The gap

`activity-store.ts` was the only store that used `idb-keyval` directly (the raw IndexedDB library) with no API fallback at all. In server mode, activities (like "task created", "project updated", "plan refined") were stored only in the browser. Clearing browser data or switching devices lost all activity history.

### What we added

**Database layer** — a new Postgres table with proper foreign keys:
```sql
CREATE TABLE IF NOT EXISTS activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  node_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Key design decisions:
- `project_id` is `UUID` with a foreign key to `projects(id)` with cascade delete — when a project is deleted, its activities are automatically cleaned up.
- `IF NOT EXISTS` guard makes the migration idempotent (safe to run twice).
- Composite indexes on `(project_id, created_at DESC)` and `(user_id, created_at DESC)` for fast lookups.
- RLS policies ensure users can only see/create/delete their own activities.

**API endpoints** — in `server/routes/data.ts`:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/activities?projectId=X&limit=N` | List activities with optional project filter and limit |
| `POST` | `/activities` | Create activity event, returns inserted row |
| `DELETE` | `/activities/:projectId` | Clear all activities for a project |

The single GET endpoint uses query parameters instead of separate routes — cleaner API design that matches how the data-client calls it.

**Data client methods** — in `src/lib/data-client.ts`:
- `listActivities(projectId?, limit?)` — builds query string, fetches from API, maps snake_case to camelCase
- `createActivity(activity)` — takes explicit fields (id, projectId, type, title, description?, nodeId?, metadata?)
- `clearProjectActivities(projectId)` — calls `DELETE /activities/:projectId`

**Store refactor** — `activity-store.ts` rewritten to the standard pattern:
- **Load**: try `dataClient.listActivities()` → cache to IndexedDB → fall back to IndexedDB
- **Write**: Zustand update → IndexedDB → fire-and-forget API with explicit field mapping (avoids sending `timestamp`, `userId` etc. to the server which generates its own)

---

## Change 3: Sidebar Store — Route Through the API Layer (Phase 2)

### The gap

The sidebar store imported the Supabase client directly and queried Postgres from the browser, bypassing the Hono API layer entirely. It also maintained its own dedicated realtime subscription channel.

### What we changed

**Store rewrite** — `sidebar-store.ts`:
- Removed imports of `getSupabase` and `idb-keyval`
- Now uses `dataClient.getProfile()` / `dataClient.updateProfile()` + `loadState` / `saveState`
- Follows the standard pattern (API-first, IndexedDB fallback)
- `subscribeToChanges()` returns a no-op — realtime sync is centralized in `realtime-sync.ts`

**`mergeWithDefaults()` helper** — extracted and exported from `sidebar-store.ts`:
```typescript
export function mergeWithDefaults(stored: SidebarItem[]): SidebarItem[]
```
Used by both the store's `load()` and `realtime-sync.ts`. Ensures new default sidebar items are picked up even if the user has a stored config, and that protected items (like Tasks) stay visible.

**Realtime sync** — `realtime-sync.ts` imports `mergeWithDefaults` from the sidebar store and uses it to propagate `sidebar_config` changes from the `user_profiles` realtime subscription:
```typescript
const sidebarConfig = payload.new.sidebar_config as SidebarItem[] | null
if (sidebarConfig) {
  useSidebarStore.setState({ items: mergeWithDefaults(sidebarConfig) })
}
```

**Schema + routes** — `sidebarConfig` added to Drizzle `userProfiles` schema and to `PUT /profile` handler (conditional inclusion to avoid nulling it out). `sidebarConfig` added to `mapProfile()` in `data-client.ts` and to `UserProfile` type.

---

## Change 4: Settings Store — Make Server Endpoints Real (Phase 3)

### The gap

1. `GET /settings` returned hardcoded values, ignoring what the user saved
2. `PATCH /settings` acknowledged requests but discarded the data
3. `setDefaultProvider()` wrote to IndexedDB but forgot to call the API
4. `load()` only extracted `model`, ignoring `defaultProvider`

### What we changed

**Database** — new `settings JSONB` column on `user_profiles` (migration + Drizzle schema).

**Server routes** — `GET /settings` reads from `user_profiles.settings`, merges with defaults. `PATCH /settings` reads existing, merges incoming changes, writes back. Handles the case where the user profile doesn't exist yet (creates one).

**Store fixes** — `load()` extracts both `model` and `defaultProvider`. `setDefaultProvider()` now includes `dataClient.updateSettings({ defaultProvider }).catch(() => {})`.

---

## Change 5: Documentation (Phase 4)

- `CLAUDE.md` "Database Modes" section updated: "IndexedDB Mode" → "Local Mode", "Supabase Mode" → "Server Mode"
- Sidebar badge text: "IndexedDB Mode (Local Only)" → "Local Mode"

---

## How These Changes Interact

```
Frontend Store (Zustand)

  load() --> try dataClient.get*()  --> success: use it + cache to IndexedDB
             |
             '--> catch: loadState() --> use IndexedDB

  write() --> set(state)             --> instant UI update
              saveState()            --> IndexedDB cache
              dataClient.create*()   --> fire-and-forget to API

                        |
                 fetch("/api/data/...")
                        |
                        v

Hono API Server (server/routes/data.ts)

  requireAuth middleware --> Drizzle ORM --> Postgres

  In local mode: dataClient throws before fetch even happens.
  IndexedDB is the only store. No API calls occur.
```

Every store now follows this same flow. Before our changes, activity-store skipped the API entirely, sidebar-store bypassed the API layer, and settings-store had stub endpoints.

---

## Improvements Adopted from PR #80

This branch incorporates the following improvements from PR #80 (closed without merge):

| Improvement | What changed |
|-------------|-------------|
| UUID foreign key on `activity_events.project_id` | `TEXT` → `UUID REFERENCES projects(id) ON DELETE CASCADE` |
| Idempotent migration | `CREATE TABLE` → `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` |
| Better indexes | Composite indexes: `(project_id, created_at DESC)`, `(user_id, created_at DESC)` |
| Single GET endpoint with query params | Replaced two separate `GET /activities` and `GET /activities/:projectId` with one `GET /activities?projectId=X&limit=N` |
| POST returns inserted row | `return c.json({ ok: true }, 201)` → `return c.json(inserted)` |
| `listActivities(projectId?, limit?)` | Added optional parameters with `URLSearchParams` building |
| Explicit `createActivity` type | Takes `{ id, projectId, type, title, description?, nodeId?, metadata? }` instead of full `Activity` |
| Exported `mergeWithDefaults` | Sidebar store exports the function; realtime-sync imports it instead of inlining |
| Server app-mode uses `environment.ts` | `import { isIndexedDBMode } from './environment.js'` instead of `shouldUseSupabase` from `supabase.js` |
| JSDoc comments | Added documentation to `app-mode.ts` functions |

---

## Files Created

| File | Purpose |
|------|---------|
| `src/lib/app-mode.ts` | Frontend mode detection: `isLocalMode()`, `isServerMode()`, `getAppMode()` |
| `server/lib/app-mode.ts` | Server mode detection: same API, uses `environment.ts` |
| `supabase/migrations/20260219000001_add_activity_events.sql` | `activity_events` table with UUID FK, RLS, indexes |
| `supabase/migrations/20260219000002_add_user_settings.sql` | `settings` JSONB column on `user_profiles` |

## Files Modified

| File | What changed |
|------|--------------|
| `src/stores/activity-store.ts` | Full rewrite: `idb-keyval` → standard pattern with `dataClient` + `loadState`/`saveState` |
| `src/stores/sidebar-store.ts` | Full rewrite: removed direct Supabase client, uses `dataClient`, exports `mergeWithDefaults` |
| `src/stores/settings-store.ts` | Fixed `load()` to extract `defaultProvider`, added API call to `setDefaultProvider()` |
| `src/lib/data-client.ts` | Added `listActivities(projectId?, limit?)`, `createActivity()`, `clearProjectActivities()`, `sidebarConfig` in `mapProfile()` |
| `server/routes/data.ts` | Added activity endpoints (GET/POST/DELETE), made `GET/PATCH /settings` functional, `sidebarConfig` in `PUT /profile` |
| `server/lib/db/schema.ts` | Added `activityEvents` table (UUID FK), `sidebarConfig` + `settings` columns on `userProfiles` |
| `src/lib/realtime-sync.ts` | Imports `mergeWithDefaults`, propagates sidebar config in `subscribeToUserProfiles` |
| `src/types/index.ts` | Added `sidebarConfig` to `UserProfile` interface |
| `src/components/layout/sidebar.tsx` | Badge text → "Local Mode" |
| `CLAUDE.md` | Updated terminology |
| ~24 other files | Mechanical: `shouldUseSupabase()` → `isLocalMode()`/`isServerMode()` |

## What These Changes Do NOT Touch

- **Authentication flow** — unchanged
- **Realtime sync for other tables** — unchanged (projects, plan nodes, etc. already worked)
- **Execution system** — unchanged
- **Agent/provider system** — unchanged
- **The detection logic itself** — `shouldUseSupabase()` and `isIndexedDBMode()` still exist as the underlying implementations
