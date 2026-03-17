# State Management

Zustand stores and API persistence.

## Store Overview

All stores live in `src/stores/` and use Zustand 5. Stores persist via `dataClient` which calls `/api/data/*` endpoints backed by Drizzle ORM (PGlite in local mode, Postgres in server mode).

### Core Data

- `project-store.ts` - Projects CRUD, API persistence
- `plan-store.ts` - Plan nodes/edges per project, bulk updates, graph layout
- `initiative-store.ts` - Initiatives/projects grouping
- `session-store.ts` - Unified session data: project chat, task chat, steer messages, execution sessions
- `task-chat-store.ts` - Task-level chat history (per-node conversations)
- `activity-store.ts` - Activity tracking and history (task/project/milestone events)

### Execution & Agents

- `execution-store.ts` - Task execution state, SSE stream processing, provider/machine management
- `agent-store.ts` - AI generation state, SSE streaming, abort, multi-session generation tracking
- `realtime-store.ts` - Real-time events from SSE bridge: machines, activity feed, task streams
- `machines-store.ts` - Registered machines (fetch, revoke, rename, provider configs)
- `slurm-store.ts` - HPC/Slurm cluster state (clusters, jobs, queue tracking)
- `observation-store.ts` - Trace observation data (generations, tool calls, spans) for execution inspection

### User & Auth

- `auth-store.ts` - Supabase session/user state, WebAuthn initialization, sign-out
- `user-profile-store.ts` - User identity and preferences (name, email, domains, API keys)
- `team-store.ts` - Teams CRUD, team members, role checks
- `api-keys-store.ts` - Encrypted API keys for external services (client-side encryption via Web Crypto)
- `connected-accounts-store.ts` - Connected external accounts (Slack, Telegram, GitHub webhook, Linear)

### UI & Navigation

- `ui-store.ts` - Sidebar collapsed, command palette open, command history/breadcrumbs
- `sidebar-store.ts` - Sidebar item configuration, visibility, ordering, external items
- `display-settings-store.ts` - Per-view display settings (groupBy, orderBy, properties, column/zoom)
- `keyboard-nav-store.ts` - Keyboard navigation state (focused item, navigable items, arrow-key movement)
- `toast-store.ts` - Toast notification queue (info, success, warning, error)

### Settings & Configuration

- `settings-store.ts` - Model selection, default provider, backend connection health
- `usage-store.ts` - Session usage metrics (cost, tokens, task counts)

### Integrations & Plugins

- `github-store.ts` - GitHub connection, repositories, and sync state
- `plugin-store.ts` - Plugin registry, lifecycle (register, enable, disable), contributions
- `skill-store.ts` - OpenClaw skill registry and prompt injection

---

## Data Loading Architecture

Stores are loaded in **three phases** to minimize initial page load time. Only lightweight global data loads on page mount; heavy per-project data loads on demand.

### Store Classification

Stores fall into three categories based on how and when they load:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  LIGHTWEIGHT GLOBALS (Phase 2 — always loaded on page mount)        │
│  ┌──────────┬────────────┬──────────┬──────────┬──────────────┐    │
│  │ projects │ settings   │ profile  │ usage    │ initiatives  │    │
│  │ ~50 KB   │ ~500 B     │ ~1 KB    │ ~200 B   │ ~10 KB       │    │
│  ├──────────┼────────────┼──────────┼──────────┼──────────────┤    │
│  │ sidebar  │ display    │ plugins  │ skills   │ examples     │    │
│  │ ~1 KB    │ ~2 KB      │ TBD      │ ~100 KB  │ ~200 KB      │    │
│  └──────────┴────────────┴──────────┴──────────┴──────────────┘    │
│                                                                     │
│  HEAVY PER-PROJECT (Phase 3 — loaded per-project on navigation)     │
│  ┌──────────┬────────────┬──────────┬──────────┬──────────────┐    │
│  │ plan     │ executions │ sessions │ chat     │ activities   │    │
│  │ ~50 KB/  │ ~20 KB/    │ ~50 KB/  │ ~10 KB/  │ ~10 KB/      │    │
│  │ project  │ project    │ project  │ project  │ project      │    │
│  └──────────┴────────────┴──────────┴──────────┴──────────────┘    │
│                                                                     │
│  UI-ONLY (never loaded from server)                                 │
│  ┌──────────┬────────────┬──────────┬──────────┬──────────────┐    │
│  │ ui       │ keyboard   │ toast    │ agent    │ observation  │    │
│  │          │ -nav       │          │ (local)  │              │    │
│  └──────────┴────────────┴──────────┴──────────┴──────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Three Loading Phases

```
Phase 1: Auth & Teams                  Phase 2: Lightweight Globals
────────────────────────               ────────────────────────────
                                       Triggered: after Phase 1 completes
  App mount                            Blocking (page waits):
  │                                      projects, profile, sidebar
  ├→ Initialize auth                   Non-blocking (background):
  │                                      settings, display, usage,
  ├→ Load teams                          initiatives, plugins, skills,
  │  GET /api/teams                      examples, agent (localStorage)
  │
  └→ Set X-Team-Id header
     (used by all Phase 2+ calls)


Phase 3: Per-Project Data              On-Demand Global Load
─────────────────────────              ────────────────────────────
Triggered: navigate to /project/:id    Triggered: navigate to Dashboard,
                                       My Tasks, Active Tasks, Initiatives,
  ProjectLayout mounts                 Projects, Agents, New Plan
  │
  ├→ ProjectDataLoader runs              useGlobalProjectData() hook
  │                                      │
  ├→ plan.loadForProject(id)             ├→ plan.load()        ─┐
  ├→ executions.loadForProject(id)       ├→ executions.load()   │ Only if
  ├→ sessions.loadForProject(id)         ├→ sessions.load()     │ globallyLoaded
  ├→ chat.loadForProject(id)             ├→ chat.load()         │ is false
  ├→ activities.loadForProject(id)       ├→ activities.load()  ─┘
  │                                      │
  └→ reconcileRunningTasks()             └→ reconcileRunningTasks()
```

### Page → Loading Mechanism Map

| Page | Route | What Loads | How |
|------|-------|-----------|-----|
| **Plan View** (all tabs) | `/project/:id/*` | Plan + exec + sessions + chat + activities **for this project** | `ProjectLayout` → `ProjectDataLoader` |
| **Task Detail** | `/project/:id/task/:nodeId` | Same as Plan View (shared layout) | `ProjectLayout` → `ProjectDataLoader` |
| **Dashboard** | `/dashboard` | All 5 heavy stores **globally** | `useGlobalProjectData()` hook |
| **My Tasks** | `/tasks` | All 5 heavy stores **globally** | `useGlobalProjectData()` hook |
| **Active Tasks** | `/active` | All 5 heavy stores **globally** | `useGlobalProjectData()` hook |
| **Projects** | `/projects` | All 5 heavy stores **globally** | `useGlobalProjectData()` hook |
| **Initiatives** | `/initiatives` | All 5 heavy stores **globally** | `useGlobalProjectData()` hook |
| **New Plan** | `/plan`, `/welcome` | All 5 heavy stores **globally** | `useGlobalProjectData()` hook |
| **Playground** | `/playground` | Phase 2 globals only | DataLoader (no additional) |
| **Settings** | `/settings` | Phase 2 globals only | DataLoader (no additional) |
| **Environments** | `/environments` | Phase 2 globals only | DataLoader (no additional) |
| **Examples** | `/examples` | Phase 2 globals only | DataLoader (no additional) |

### The `globallyLoaded` Flag

The five heavy stores each have two load-state flags:

| Flag | Set by | Purpose |
|------|--------|---------|
| `loaded` | `load()` or `loadForProject()` | "Some data is present — safe to render without spinner" |
| `globallyLoaded` | `load()` only | "All projects' data has been fetched" |

This two-flag system prevents a subtle bug:

```
Without globallyLoaded:
  1. User visits /project/A → loadForProject("A") → loaded = true
  2. User visits /dashboard → sees loaded = true → skips global load
  3. Dashboard only shows project A's data ← BUG

With globallyLoaded:
  1. User visits /project/A → loadForProject("A") → loaded = true, globallyLoaded = false
  2. User visits /dashboard → sees globallyLoaded = false → triggers load()
  3. Dashboard shows all projects' data ← CORRECT
```

### ProjectLayout Route Pattern

All `/project/:id/*` routes share a single layout that persists `ProjectDataLoader`:

```tsx
// app.tsx
<Route path="project/:id" element={<ProjectLayout />}>
  <Route index element={<PlanView />} />
  <Route path="graph" element={<PlanView />} />
  <Route path="list" element={<PlanView />} />
  <Route path="timeline" element={<PlanView />} />
  <Route path="board" element={<PlanView />} />
  <Route path="overview" element={<PlanView />} />
  <Route path="knowledge" element={<PlanView />} />
  <Route path="repo" element={<PlanView />} />
  <Route path="task/:nodeId" element={<TaskDetail />} />
</Route>
```

`ProjectLayout` renders `<ProjectDataLoader /> + <Outlet />`. Since React Router preserves layout routes across child navigation, switching from graph → list → timeline does **not** remount the data loader or re-fetch data.

### Store Merge Behavior

`loadForProject()` merges data into the store — it does not clear data from other projects:

```typescript
// plan-store: replace this project's nodes, keep others
const otherNodes = existingNodes.filter(n => n.projectId !== projectId)
set({ nodes: [...otherNodes, ...newNodes] })

// execution-store: merge by nodeId key
const merged = new Map(existing)
for (const [id, exec] of newExecs) merged.set(id, exec)
set({ executions: merged })
```

This means visiting `/project/A` then `/project/B` accumulates data for both. The store grows incrementally as the user navigates.

---

## Persistence

- `dataClient` calls `/api/data/*` endpoints (Drizzle ORM → PGlite or Postgres)
- Phase 1/2 stores load from backend on mount via `DataLoader` component
- Phase 3 stores load per-project via `ProjectDataLoader` component
- State changes persisted via `dataClient` → `POST /api/data/*`
- On sign-out, `resetAllStores()` clears all stores including `globallyLoaded` and `loadedProjectIds`

## Related Documentation
- [Real-time Sync](./realtime-sync.md)
- [Database Schema](../backend/database-schema.md)
- [Project-Scoped Loading Design](../design/PROJECT_SCOPED_LOADING.md)
