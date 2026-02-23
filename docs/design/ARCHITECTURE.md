# Astro — Architecture

> **Last updated:** 2026-02-22
> **Consolidates:** Previous `ARCHITECTURE.md` (operational) + `SERVER_ARCHITECTURE_V2.md` (strategic)
> **Status:** PGlite + team-scoped data refactor **complete**. IndexedDB fully removed. Phase 3 (stateless backend) **complete** — all persistent in-memory Maps moved to Postgres.

---

## 1. System Overview

Astro is a planning-first platform for software developers and researchers. It provides an AI-assisted planning layer that decomposes complex goals into executable tasks, manages dependencies across environments (local, remote, HPC, cloud), and orchestrates AI agents to execute those tasks.

### 1.1 The Four Components

Astro consists of four logical components. Depending on the operating mode, they may run on the same machine or be distributed across the internet.

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  USER-FACING (what the user interacts with)                            │
 │                                                                        │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │  FRONTEND — Browser (React SPA)                                  │  │
 │  │  Vite dev: localhost:5173 / Prod: Cloudflare Pages               │  │
 │  │                                                                  │  │
 │  │  • UI rendering (pages, graph, terminal, chat)                   │  │
 │  │  • Local state (27 Zustand stores)                               │  │
 │  │  • SSE event consumption (real-time updates)                     │  │
 │  │  • User inputs: create projects, execute tasks, chat, steer      │  │
 │  └──────────────────────┬────────────────────┬──────────────────────┘  │
 │                         │ HTTP/SSE            │ SSE (events/stream)    │
 │                         │ (REST + streaming)  │ (persistent)           │
 │                         ▼                     ▼                        │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │  BACKEND — Hono API Server                                       │  │
 │  │  Dev: localhost:3001 / Prod: Fly.io                              │  │
 │  │                                                                  │  │
 │  │  • HTTP API (20 route files, auth middleware)                     │  │
 │  │  • Data persistence (Postgres via Drizzle — PGlite local,        │  │
 │  │    postgres-js server)                                          │  │
 │  │  • SSE event broadcasting (events → browser)                     │  │
 │  │  • Dispatch coordination (queue, routing, context assembly)       │  │
 │  │  • Observability (Langfuse tracing, audit logs, usage metrics)    │  │
 │  │  • Compute backend detection (Docker, SSH, K8s, SLURM)           │  │
 │  └──────────────────────┬───────────────────────────────────────────┘  │
 │                         │ In-process function calls + EventEmitter     │
 │                         ▼                                              │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │  RELAY — WebSocket Hub                                           │  │
 │  │  Dev: localhost:3002 / Prod: same Fly.io VM                      │  │
 │  │                                                                  │  │
 │  │  • Machine registry (connected agent runners)                    │  │
 │  │  • Task routing (dispatch to best available machine)             │  │
 │  │  • Heartbeat monitoring (30s ping/pong)                          │  │
 │  │  • Authentication (JWT in server mode, open in local mode)       │  │
 │  │  • Redis pub/sub for horizontal scaling (optional)               │  │
 │  └──────────────────────┬───────────────────────────────────────────┘  │
 │                         │ WebSocket (ws:// local, wss:// server)       │
 │                         ▼                                              │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │  AGENT RUNNER — Execution Engine (separate process)              │  │
 │  │  Runs on user's machine(s), connects to relay                    │  │
 │  │                                                                  │  │
 │  │  • AI execution (Claude SDK, Claude CLI, Codex)                  │  │
 │  │  • Git worktree management (isolated branches per task)          │  │
 │  │  • Safety checks (git state, parallel execution)                 │  │
 │  │  • PR creation (push branch, gh pr create)                       │  │
 │  │  • Execution strategies (Direct, Docker, SLURM, K8s Exec)       │  │
 │  │  • MCP server for Claude Code integration                        │  │
 │  └──────────────────────────────────────────────────────────────────┘  │
 └─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Process Responsibilities

| Component | Responsibility | Does NOT do |
|-----------|---------------|-------------|
| **Frontend** (Browser) | UI rendering, local state (Zustand stores), SSE event consumption, user interactions | Call AI directly, persist to Postgres |
| **Backend** (Hono API Server) | HTTP API, auth, data persistence (Postgres), SSE event broadcasting, dispatch coordination, observability, compute backend detection | Execute AI tasks, call AI SDKs directly |
| **Relay** (WebSocket Hub) | Machine registry, task routing, heartbeat monitoring, JWT auth (server mode) | Store data, make AI calls, detect backends |
| **Agent Runner** (Execution Engine) | AI execution (Claude SDK/CLI/Codex), worktree management, safety checks, PR creation, execution strategies | Serve HTTP, persist application data, detect SSH backends |

### 1.3 Unified Execution Path

All AI execution flows through the Relay to Agent Runners. The Backend **never** calls AI directly — it builds prompts and dispatches them via the relay. There is no `if (useRelay) ... else ...` branching; every endpoint unconditionally uses relay dispatch.

This was achieved by the Execution Path Unification (see `EXECUTION_PATH_DUPLICATION.md` §9). The server's provider adapters, worktree manager, session manager, and local dispatch paths were deleted. `npm run dev` starts an agent runner subprocess alongside the server.

---

## 2. Design Principles

### 2.1 The server is the single source of truth

There is exactly one place that knows the answer to any data question. In server mode, that's Postgres. In local mode, that's PGlite (Postgres in WASM). The frontend doesn't store its own copy. It asks the server, displays what it gets, period.

**No IndexedDB.** IndexedDB has been fully removed. The `idb-keyval` dependency and `src/lib/db.ts` are deleted. All frontend stores use `fetch('/api/...')` exclusively.

### 2.2 Failures are visible

If the API is down, the UI shows a loading error state with `error: string | null` in every store. No silent fallbacks to stale cached data.

### 2.3 The backend is stateless (Phase 3 — DONE)

The backend keeps nothing persistent in memory between requests. All data that must survive between requests is stored in Postgres via 5 new tables added in Phase 3:

| Table | Replaces | Purpose |
|-------|----------|---------|
| `webauthn_challenges` | `challengeStore` Map in `auth.ts` | WebAuthn challenge storage with 5-min TTL |
| `device_codes` | `deviceCodeStore` + index Maps in `device-code-store.ts` | OAuth2 device authorization codes |
| `chat_sessions` | ~~`pool` Map in `chat-session-pool.ts`~~ | Chat SDK session metadata (table retained in schema; server-side pool deleted — agent runner manages sessions directly) |
| `shared_bundles` | `shareStore` Map in `share.ts` | Shared plan bundles |
| `dispatch_queue_entries` | `entries` + `nodeToEntry` + `activePerProject` Maps in `dispatch-queue.ts` | Task dispatch queue |

**What stays in memory (by design):** Runtime objects that cannot be serialized — `AbortController` instances (session-manager), WebSocket connections (machine-registry), SSE ring buffer (event-buffer). See `LOCAL_SERVER_REFACTOR.md` "Intentionally Hybrid Components" for details.

**Result:** Running 2+ Fly.io machines no longer causes auth failures or data loss. WebAuthn challenges on Machine A are visible to Machine B.

### 2.4 Postgres everywhere — same code, different connection string

Both local and server mode talk to the same backend API. The backend talks to Postgres. The only difference is **which Postgres**:

```
LOCAL MODE:
  Browser → localhost:3001 (Hono) → PGlite (Postgres compiled to WASM, in-process)

SERVER MODE:
  Browser → Fly.io (Hono) → Postgres (Supabase / Fly.io Postgres / AWS RDS)
```

The backend code is identical. Drizzle ORM queries work against any Postgres instance. The database driver is chosen by a connection string at startup:

```bash
# Local (PGlite — no DATABASE_URL needed, Postgres runs in-process via WASM)
# Data stored in ~/.astro/data/

# Supabase (beta)
DATABASE_URL=postgresql://postgres:password@db.abc.supabase.co:5432/postgres

# Fly.io managed Postgres
DATABASE_URL=postgresql://postgres:password@astro-db.internal:5432/astro

# AWS RDS (at scale)
DATABASE_URL=postgresql://admin:password@astro.abc.us-east-1.rds.amazonaws.com:5432/astro
```

**The migration from Supabase to any other Postgres provider is a config change, not a code change.**

### 2.5 Postgres for everything — no Redis (at current scale)

Postgres has built-in pub/sub (`LISTEN/NOTIFY`) and handles ephemeral state (challenges, rate limits) as regular tables with TTL. Only add Redis if Postgres `LISTEN/NOTIFY` becomes a throughput bottleneck (10K+ messages/second).

### 2.6 Team-scoped data

All data is scoped by **team**. Two account types:

- **Personal account** (launch) — each user gets an auto-created team with one member. Invisible to user.
- **Team account** (post-launch, paid) — multiple users share a team. Billing unit.

Under the hood, both are the same `teams` table. All top-level data (projects, initiatives, machines) has a `team_id` column. Child data (plan nodes, edges, executions) is scoped via its parent project's `team_id`. The same SQL runs in both modes.

**Local mode**: On first startup, one implicit team and one implicit user are auto-created:

```sql
INSERT INTO teams (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Local')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO user_profiles (id, name, email) VALUES ('00000000-0000-0000-0000-000000000000', 'Local User', 'local@astro')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO team_members (team_id, user_id, role) VALUES ('...0001', '...0000', 'owner')
  ON CONFLICT DO NOTHING;
```

The auth middleware sets `userId` and `teamId` to these fixed UUIDs. Every query uses `WHERE team_id = ?`.

**Server mode**: Auth middleware validates JWT, resolves `teamId` from `team_members` table.

**The query is always the same:**

```typescript
const rows = await db.select().from(projects).where(eq(projects.teamId, teamId))
```

**What gets `teamId` directly** (top-level entities): `projects`, `initiatives`, `registered_machines`
**What's scoped via project** (child entities): `plan_nodes`, `plan_edges`, `task_executions`, `sessions`, `activity_events`
**What's scoped by user** (personal entities): `user_profiles`, `display_settings`, `usage_metrics`

---

## 3. Two Operating Modes

### 3.1 Local Mode (Single User)

All four components run on the **same physical machine**.

```
USER'S MACHINE (all components co-located)
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌─────────────────────────────┐                                 │
│  │  [FRONTEND] Browser         │                                 │
│  │  localhost:5173              │                                 │
│  │  • No login required        │                                 │
│  └──────────┬─────────┬────────┘                                 │
│             │ HTTP    │ SSE                                       │
│             ▼         ▼                                           │
│  ┌──────────────────────────────┐                                │
│  │  [BACKEND] Hono API Server   │                                │
│  │  localhost:3001              │                                 │
│  │  • PGlite (Postgres in WASM, │                                │
│  │    data in ~/.astro/pglite/) │                                │
│  │  • No auth (single user)     │                                │
│  │  • Detects local backends:   │                                │
│  │    Docker, SSH*, K8s, SLURM  │                                │
│  └──────────┬───────────────────┘                                │
│             │ In-process calls                                    │
│             ▼                                                     │
│  ┌──────────────────────────────┐                                │
│  │  [RELAY] WebSocket Hub       │                                │
│  │  localhost:3002              │                                 │
│  │  • No TLS, no JWT            │                                │
│  └──────────┬───────────────────┘                                │
│             │ WebSocket (ws://localhost:3002)                      │
│             ▼                                                     │
│  ┌──────────────────────────────┐                                │
│  │  [AGENT RUNNER] astro-agent  │                                │
│  │  (separate process)          │                                │
│  │  • Holds Claude credentials  │                                │
│  │  • Executes AI tasks         │                                │
│  │  • Manages worktrees         │                                │
│  │  • Creates PRs               │                                │
│  └──────────────────────────────┘                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Properties:** No auth, PGlite database, ws:// relay, single agent runner. Start with `npm run dev` + `npx astro-agent start -f`.

### 3.2 Server Mode (Multi-User)

Frontend on CDN. Backend + Relay on cloud VM. Agent Runners on users' machines.

```
              USER'S BROWSER                    CLOUD (Fly.io VM)
          ┌──────────────────┐           ┌──────────────────────────┐
          │  [FRONTEND]      │   HTTPS   │  [BACKEND] Hono          │
          │  Browser         │ ────────→ │  port 3001               │
          │  (Cloudflare     │ ←──────── │  • Postgres (Supabase)   │
          │   Pages CDN)     │    SSE    │  • JWT auth (WebAuthn)   │
          │                  │           │  [RELAY] WebSocket Hub   │
          │  • WebAuthn login│           │  port 3002               │
          │                  │           │  • JWT-authenticated     │
          └──────────────────┘           │  • TLS (wss://)          │
                                         └────────┬─────────────────┘
                                                  │ WSS (internet)
                          ┌───────────────────────┼────────────────────────┐
                          ▼                       ▼                        ▼
               ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
               │ [AGENT RUNNER]     │  │ [AGENT RUNNER]     │  │ [AGENT RUNNER]     │
               │ User A's laptop   │  │ User A's HPC       │  │ User B's laptop   │
               │ • Claude SDK      │  │ • Claude SDK       │  │ • Claude CLI      │
               │ • Direct strategy │  │ • SLURM strategy   │  │ • Docker strategy │
               │ • JWT auth        │  │ • JWT auth         │  │ • JWT auth        │
               └────────────────────┘  └────────────────────┘  └────────────────────┘
```

**Properties:** WebAuthn/passkey auth, Supabase Postgres, wss:// relay with JWT, team-scoped data isolation, multiple agent runners per user, device code flow (RFC 8628) for machine registration.

### 3.3 Mode Detection

**Backend** (`server/lib/app-mode.ts`):
1. `USE_INDEXEDDB_ONLY=true` → Local mode (explicit override)
2. Supabase env vars absent → Local mode (auto-detect)
3. Otherwise → Server mode

**Frontend** (`src/lib/app-mode.ts`): Same logic via Vite's `import.meta.env`.

### 3.4 What Differs Between Modes

| Aspect | Local mode | Server mode |
|--------|-----------|-------------|
| Database | PGlite (in-process, `~/.astro/data/`) | Postgres (Supabase / Fly.io / AWS RDS) |
| Auth middleware | Fixed `userId` + `teamId` UUIDs | JWT validation → resolve from `team_members` |
| Teams | One implicit team (invisible to user) | Real teams — create, invite, manage, billing |
| Server-only routes | Not loaded | Auth, team management, device auth (dynamic import) |
| Relay transport | `ws://localhost:3002` | `wss://relay.example.com:3002` (JWT) |
| Frontend code | **100% identical** | **100% identical** |
| Backend route logic | **100% identical** | **100% identical** |

---

## 4. Data Architecture

### 4.1 Unified Architecture Diagram

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
   ┌──────────▼──────────┐  ┌──────────▼──────────┐
   │  PGlite (local)     │  │  Postgres (server)   │
   │  in-process WASM    │  │  Supabase / Fly.io   │
   │  ~/.astro/data/     │  │  Postgres / AWS RDS  │
   │  Zero install.      │  │  Connection string.  │
   └─────────────────────┘  └──────────────────────┘
```

### 4.2 Database Schema (28 tables)

See `DATA_MODEL.md` for the complete schema. Key tables:

**Core entities:** `projects`, `plan_nodes`, `plan_edges`, `task_executions`, `initiatives`
**Execution detail:** `tool_traces`, `file_changes`, `activity_events`, `execution_summaries`
**User/Team:** `user_profiles`, `teams`, `team_members`, `display_settings`, `usage_metrics`
**Auth (server only):** `passkey_credentials`, `connected_accounts`, `device_codes`
**Machine:** `registered_machines`
**Session:** `sessions`, `task_chat_sessions`

### 4.3 Frontend Stores — Zero Mode Awareness

All 27 Zustand stores follow the same pattern:

```typescript
export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const projects = await dataClient.listProjects()
      set({ projects, loaded: true, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load', loading: false })
    }
  },
  // No isServerMode(). No IndexedDB. No fallbacks.
}))
```

**DataLoader** (`src/app.tsx`): Loads all stores on app mount, shows "Loading..." until all are ready. After projects load, background-refreshes file trees for `@` autocomplete.

### 4.4 Ephemeral Data (Not in Database)

Some data is fetched on demand and cached in Zustand memory only — not persisted to PGlite/Postgres:

| Data | How Fetched | TTL | Purpose |
|------|-------------|-----|---------|
| **File trees** | `GET /api/repo/file-tree` (local) or `GET /api/fs/files` (remote) | 5 min staleness check | `@` path autocomplete in chat/task creation |
| **Skills** | `GET /api/skills` | Session lifetime | Skill list in settings, prompt injection |
| **Machine status** | Relay heartbeat events | 30s heartbeat | Environment page, dispatch routing |

These are auto-fetched in the background on page load via `useFileTreeRefresh` hook and the skill store's `load()` method. Lost on refresh, re-fetched automatically.

### 4.5 Data Storage Summary

| Data | Local Mode | Server Mode |
|------|-----------|-------------|
| All application data | PGlite (via Drizzle) | Postgres (via Drizzle) |
| File trees | Zustand memory (ephemeral) | Zustand memory (ephemeral) |
| Skills | Zustand memory (from API) | Zustand memory (from API) |
| Machine registry | In-memory + Postgres | In-memory + Postgres |
| Agent runner config | `~/.config/astro-agent/` | `~/.config/astro-agent/` |
| Git worktrees | `~/.astro/worktrees/` | `~/.astro/worktrees/` |

---

## 5. Task Execution Workflow

The core workflow is identical in both modes — only transport security and persistence differ.

### 5.1 Dispatch Phase

| Step | Component | Action |
|------|-----------|--------|
| 1 | **Frontend** | User clicks "Execute" on a plan node |
| 2 | **Frontend** | Validate: node exists, not running, dependencies met, working directory configured |
| 3 | **Frontend** | `POST /api/dispatch/task` with nodeId, projectId, visionDoc, dependencyOutputs, model, targetMachineId |
| 4 | **Backend** | Validate (Zod), assemble execution context (vision doc + dependencies + repo context + skills) |
| 5 | **Backend** | Select machine: `machineRegistry.findBestMachine()` or use `targetMachineId` |
| 6 | **Backend** | Build full execution prompt with decision-making instructions |
| 7 | **Backend** | Call `relayServer.dispatchTask(task)` |
| 8 | **Relay** | Send `task.dispatch` WebSocket message to selected Agent Runner |

### 5.2 Execution Phase

| Step | Component | Action |
|------|-----------|--------|
| 9 | **Agent Runner** | Safety check: git repo? Uncommitted changes? Parallel tasks? |
| 10 | **Agent Runner** | If RISKY: send `task.approval_request` → wait for user decision |
| 11 | **Agent Runner** | Create git worktree: `git worktree add -b astro/{taskId}` |
| 12 | **Agent Runner** | Create provider adapter (Claude SDK, Claude CLI, or Codex) |
| 13 | **Agent Runner** | Start AI session with CLAUDE.md loading (`settingSources: ['user', 'project', 'local']`) |

### 5.3 Streaming Phase (repeats per AI turn)

| Step | Component | Action |
|------|-----------|--------|
| 14 | **Agent Runner** | AI produces output → stream callbacks fire |
| 15 | **Agent Runner** | Send WebSocket: `task.text`, `task.tool_use`, `task.tool_result`, `task.file_change`, `task.progress` |
| 16 | **Relay** | Forward events to Backend via EventEmitter |
| 17 | **Backend** | Push through `AstroEventTransport` hooks (SSE, audit, observability, usage) |
| 18 | **Frontend** | Receive SSE, update `executionStore`: append text, add tool traces, file changes |

### 5.4 Completion Phase

| Step | Component | Action |
|------|-----------|--------|
| 19 | **Agent Runner** | AI session ends. If success: `pushAndCreatePR()` |
| 20 | **Agent Runner** | Cleanup worktree. Send `task.result` with status, output, PR info |
| 21 | **Backend** | Run hooks: observability (Langfuse), usage metrics, audit log |
| 22 | **Frontend** | Update plan node status. Persist execution. If batch: dispatch next wave |
| 23 | **Frontend** | Background-refresh file tree (files may have changed) |

---

## 6. Communication Protocols

### 6.1 Frontend ↔ Backend

**HTTP REST**: CRUD operations, configuration, triggering actions.

**SSE (Server-Sent Events)**: Two patterns:
1. **Action SSE**: POST to `/api/agent/generate-plan`, `/api/dispatch/task`, etc. returns an SSE stream for that operation.
2. **Event stream**: GET `/api/events/stream` — persistent SSE connection for real-time events (machine state, task progress, approvals).

### 6.2 Backend ↔ Relay

Same Node.js process (`server/index.ts`). Communicate via function calls (`relayServer.dispatchTask()`) and EventEmitter (`relayServer.on('task:result', ...)`).

### 6.3 Relay ↔ Agent Runner

**WebSocket** JSON messages with `type` field. See `RELAY.md` for full protocol.

**Relay → Agent Runner:** `task.dispatch`, `task.cancel`, `task.steer`, `task.approval_response`, `task.safety_decision`, `file_list.request`, `repo_setup.request`

**Agent Runner → Relay:** `task.result`, `task.stdout`, `task.text`, `task.session_init`, `task.tool_use`, `task.tool_result`, `task.file_change`, `task.progress`, `task.approval_request`, `task.steer_ack`, `heartbeat.pong`

---

## 7. Event System

```
Agent Runner (via Relay)
          │
          ▼
    Relay Server
          │
          ▼
    executionEventBus
          │
          ▼
    /api/events/stream (SSE)
          │
          ▼
    AstroEventTransport
      (7 hooks)
          │
    ┌──────┬──────┬──────┬──────┬──────┬──────┐
    ▼      ▼      ▼      ▼      ▼      ▼      ▼
  SSE   Audit  Usage    PR   Git-Pull Channel Observability
 Notif   Log  Metrics Create  Hook    Notif   (Langfuse)
```

All events flow from agent runners through the relay to the `executionEventBus`, a Node.js `EventEmitter` singleton (survives tsx watch reloads via `globalThis`). There is no local provider path — all AI execution produces events via the relay.

**Streaming event types:** `init`, `session_init`, `text`, `tool_use`, `tool_result`, `structured_output`, `file_change`, `progress`, `result`, `error`, `aborted`, `heartbeat`, `done`

---

## 8. Supporting Features

### 8.1 Skills System

Skills are agent-level extensions that inject instructions into AI agent prompts during task execution. They follow the OpenClaw SKILL.md format.

**Discovery:** Server-side `SkillManager` scans `skills/` directory on startup, exposes via `GET /api/skills`.
**Frontend:** Settings page allows listing, enabling/disabling, API key configuration, and pasting SKILL.md content.
**Injection:** `ContextAssembler.buildExecutionPrompt()` calls `skillManager.getSkillPromptInjection()` → injects XML block into dispatch prompt.
**Storage:** Fetched from API on app load, cached in Zustand memory. Not persisted to database.

### 8.2 Plugin System

Plugins extend the frontend and backend with custom pages, sidebar items, commands, themes, and signal evaluators.

**Frontend:** `usePluginStore` manages plugin registry with manifests, contributions aggregation, lifecycle (register, activate, deactivate).
**Backend:** `server/lib/plugin-loader.ts` auto-discovers from `server/plugins/` directory.
**Built-in plugins:** GTD Workflow, Example Themes. Channel plugins: Slack, GitHub, Linear, Telegram.

### 8.3 File Tree Autocomplete

The `@` path completion feature in chat and task creation provides instant file path suggestions.

**Data flow:** `git ls-files` → API (`/api/repo/file-tree` or `/api/fs/files`) → Zustand memory → `FileCompletionTextarea` component.
**Auto-refresh:** `useFileTreeRefresh` hook checks staleness (5-min TTL) per project page. `refreshAllFileTrees()` runs in background after projects load in DataLoader.
**Fallback:** If no cached tree, `FileCompletionTextarea` falls back to debounced API call (150ms) on each keystroke after `@`.

### 8.4 Approval System

Dynamic tool-based approvals (`ask_user_question` MCP tool) + procedure-level approvals with SSE notifications.

**Agent-side:** Claude SDK adapter intercepts `AskUserQuestion` tool calls via the approval hook, forwards to relay as `task.approval_request`.
**Frontend-side:** Approval cards rendered in task detail view. User selects option → `POST /api/dispatch/steer` → relay → agent runner.

### 8.5 Observability

**Observation Collector** (`server/lib/observability/`): Tracks turns, tool calls, file changes, token usage per execution. Builds trace trees for the UI.
**Langfuse Export:** Optional Langfuse integration for LLM trace export.
**Usage Metrics:** Cost, tokens, model, turns accumulated per session in `usage-store`.

### 8.6 MCP Integration

**Agent Runner MCP Server:** 4 tools — `astro_attach`, `astro_detach`, `astro_status`, `astro_send`. Enables Claude Code CLI to interact with Astro tasks.
**Platform MCP Server:** 15 tools for plan management, project management, initiative management, data access, and user interaction. Injected into agent sessions during execution.

---

## 9. Compute Discovery & Multi-Machine Architecture

### 9.1 Two Detection Systems

| System | Location | Detects | Purpose | Can Execute? |
|--------|----------|---------|---------|-------------|
| Backend detection | `server/lib/local-backends.ts` | Docker, K8s, SLURM, SSH hosts | UI display in Environments page | No |
| Agent Runner strategies | `packages/agent-runner/src/execution/` | Direct, Docker, SLURM, K8s, SkyPilot | Task execution | Yes |

### 9.2 Execution Strategies

| Strategy | Sync/Async | Where Commands Run | Agent Runner Location |
|----------|-----------|-------------------|-----------------------|
| Direct | Sync | Same machine as agent runner | On the machine |
| Docker | Sync | Same machine, inside container | On the machine |
| SLURM | **Async** | HPC compute nodes (scheduler) | Login node only |
| K8s Exec | Sync | Existing Kubernetes pod | Machine with kubectl |
| SkyPilot | **Async** | Cloud VM (provisioned) | Machine with sky CLI (**experimental**) |

### 9.3 Where Agent Runners Are Installed

- **Laptop/workstation**: Directly on the machine.
- **HPC cluster**: On the **login node** (not compute nodes — SLURM manages those).
- **Kubernetes**: On user's machine with kubectl (not on pods).
- **Rented VMs** (Lambda Labs, Hyperbolic AI): On each VM via SSH. Uses Direct strategy.
- **Cloud instances** (EC2, GCE): On the instance if you have access. Future: native cloud strategies.

### 9.4 Multi-Machine Example

```
                              ┌─────────────────────────────────┐
                              │           ASTRO RELAY            │
                              │      (WebSocket hub, :3002)      │
                              │                                  │
                              │  Machine Registry:               │
                              │  • laptop (Direct, Docker, K8s)  │
                              │  • hpc-login (SLURM, Direct)     │
                              │  • gpu-vm-0 (Direct, Docker)     │
                              │  • gpu-vm-1..4 (Direct)          │
                              └──┬───┬───┬───┬───┬───┬───┬──────┘
                                 │   │   │   │   │   │   │
                                 ▼   ▼   ▼   ▼   ▼   ▼   ▼
                           [Each machine has its own agent runner]
```

Every machine with an agent runner connects independently to the relay. The relay doesn't know about SSH topology between machines. Kubernetes pods and HPC compute nodes do NOT have agent runners — they are managed by orchestrators (kubectl, SLURM).

### 9.5 Complex Workflow Example

```
Task A: "Build frontend"       → laptop      (Direct strategy)
    │
    ├── Task B: "Train model"  → hpc-login   (SLURM → GPU compute nodes)
    │       └── Task D: "Evaluate" → gpu-vm-0 (Direct, 8 GPUs)
    │
    └── Task C: "Deploy API"   → laptop      (K8s Exec → K8s cluster)
            └── Task E: "Test" → gpu-vm-1    (Direct)
```

The backend coordinates through the relay. It doesn't know about SSH tunnels, SLURM commands, or kubectl — it dispatches tasks to registered machines and agent runners handle the rest.

---

## 10. Package Structure

```
astro/
├── src/                           # [FRONTEND] React SPA (Vite)
│   ├── app.tsx                    # Root: BrowserRouter, DataLoader, routes
│   ├── pages/                     # 16 route pages
│   ├── components/                # UI components (shadcn/ui pattern)
│   ├── stores/                    # 27 Zustand stores
│   ├── hooks/                     # Reusable hooks (useFileTreeRefresh, useRepoSetup)
│   ├── lib/                       # Utilities (API client, SSE parser)
│   └── types/                     # TypeScript interfaces
│
├── server/                        # [BACKEND] Hono API Server + [RELAY]
│   ├── index.ts                   # Server entry: middleware, routes, startup, relay init
│   ├── routes/                    # 20 route files
│   ├── middleware/                # Auth middleware (WebAuthn + local mode)
│   ├── lib/
│   │   ├── relay-server.ts        # [RELAY] WebSocket relay server
│   │   ├── machine-registry.ts    # [RELAY] Connected machine tracking
│   │   ├── local-backends.ts      # Compute backend detection
│   │   ├── dispatch/              # Dispatch engine, queue, context, routing
│   │   ├── events/                # Event transport + hooks
│   │   ├── observability/         # Langfuse tracing, observation collector
│   │   ├── db/                    # Drizzle ORM + Postgres schema (28 tables)
│   │   ├── skill-manager.ts       # Skill discovery + prompt injection
│   │   ├── slurm/                 # HPC cluster support
│   │   └── mcp/                   # MCP server (astro-tools-server.ts)
│   └── types/                     # Relay protocol types
│
├── packages/
│   └── agent-runner/              # [AGENT RUNNER] (npm: @astro/agent, binary: astro-agent)
│       ├── src/
│       │   ├── cli.ts             # CLI entry point (10 commands)
│       │   ├── commands/          # start, setup, status, auth, config, providers, resources, hosts, mcp
│       │   ├── lib/               # Task executor, WebSocket client, safety, worktree, git-pr
│       │   ├── providers/         # Claude SDK, Claude Code, Codex adapters
│       │   ├── execution/         # Direct, Docker, SLURM, K8s, SkyPilot strategies
│       │   └── mcp/               # MCP server for Claude Code integration
│       └── package.json
│
├── skills/                        # Skill definitions (SKILL.md files)
├── docs/design/                   # Design documentation
└── tests/                         # Vitest test suite (35 files, 661+ tests)
```

---

## 11. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19 + Vite 7 | SPA with fast HMR |
| Styling | Tailwind CSS v4 | Utility-first CSS |
| Routing | React Router v7 | Client-side routing |
| State | Zustand 5 | Lightweight stores |
| Local DB | PGlite (Postgres in WASM) | Local mode persistence |
| Graph | @xyflow/react | Plan DAG rendering |
| UI | shadcn/ui (Radix primitives) | Accessible components |
| Backend | Hono.js | HTTP framework |
| ORM | Drizzle ORM | Type-safe Postgres queries |
| Real-time | Server-Sent Events | Server → browser streaming |
| WebSocket | ws library | Relay ↔ agent runner |
| Database | PostgreSQL | Server mode persistence |
| Auth | WebAuthn/passkeys + Supabase Auth | Passwordless authentication |
| AI SDK | @anthropic-ai/claude-agent-sdk | Plan generation, chat, execution |
| AI CLI | Claude Code CLI (`claude`) | Agent execution via subprocess |
| Observability | Langfuse | LLM trace export |
| Frontend deploy | Cloudflare Pages | Static site hosting |
| Backend deploy | Fly.io | Container hosting |

---

## 12. Open Source vs Private

### 12.1 What Gets Released (Open Source)

All frontend code, all shared backend routes (data, agent, dispatch, events, relay, fs, repo), Drizzle schema, agent runner package, skills.

### 12.2 What Stays Private (Server Mode Only)

Server-only routes: `auth.ts`, `device-auth.ts`, `team-management.ts`, `notifications.ts`, `github.ts`, `connected-accounts.ts`. Auth middleware (JWT validation). Supabase client. Token manager. Email service.

**Note:** The `teams` and `team_members` schema tables are **shared** (local mode uses them too). What's private is the team **management** UI and API.

### 12.3 Build-Time Separation

`server/index.ts` conditionally imports server-only routes:

```typescript
app.route('/api', healthRoute)
app.route('/api/data', dataRoute)     // same Drizzle queries
app.route('/api/agent', agentRoute)
// ... shared routes

if (isServerMode()) {
  const { authRoute } = await import('./routes/auth.js')
  const { teamsRoute } = await import('./routes/teams.js')
  app.route('/api/auth', authRoute)
  app.route('/api/teams', teamsRoute)
}
```

---

## 13. Scaling Strategy

### 13.1 The Stack: Fly.io + Postgres

1. **Compute (Fly.io)** — Hono backend + relay. Scales horizontally.
2. **Database (Postgres)** — All persistent state. Scales vertically.

### 13.2 Scaling Tiers

| Tier | Users | Infra | Cost | Prerequisites |
|------|-------|-------|------|---------------|
| Alpha (current) | 10-50 | 1 Fly.io machine, Supabase Pro | ~$55/mo | None |
| Beta | 100-500 | 2-3 Fly.io machines, Postgres LISTEN/NOTIFY | ~$85-145/mo | Phase 3 (stateless backend) |
| Production | 1K-10K | 3-10 machines, Supabase Enterprise | ~$200-500/mo | Read replicas, multi-region |
| Scale | 10K+ | Add Redis for relay pub/sub, database partitioning | Custom | Separate relay app, CDN caching |

### 13.3 Horizontal Scaling (Phase 3 — DONE)

All blockers to horizontal scaling have been resolved. In-memory Maps that held persistent state have been moved to Postgres:

| Component | Before (in-memory) | After (Postgres) | Status |
|-----------|-------------------|------------------|--------|
| WebAuthn challenges | `Map` in `auth.ts` | `webauthn_challenges` table (5-min TTL) | DONE |
| Device codes | `Map` in `device-code-store.ts` | `device_codes` table | DONE |
| Chat sessions | `Map` in `chat-session-pool.ts` | `chat_sessions` table (30-min TTL) | DONE |
| Shared bundles | `Map` in `share.ts` | `shared_bundles` table | DONE |
| Dispatch queue | 3 `Map`s in `dispatch-queue.ts` | `dispatch_queue_entries` table | DONE |
| Machine registry | DB-authoritative | Already uses `registered_machines` table | N/A |
| Cross-instance relay | N/A | Postgres `LISTEN/NOTIFY` (future, not yet needed) | Deferred |

**Running 2+ Fly.io machines is now safe.** The production WebAuthn auth bug (challenge on Machine A invisible to Machine B) is fixed.

---

## 14. Implementation Status

| Phase | Goal | Status |
|-------|------|--------|
| 1. Unified data layer | PGlite + Drizzle ORM, dual-driver factory | **DONE** |
| 2. Frontend cleanup | Remove IndexedDB, stores use `fetch('/api/...')` only | **DONE** |
| 3. Team-scoped data | All queries filter by `teamId`, bootstrap local team | **DONE** |
| 4. Agent runner integration | settingSources, session preservation, relay prompt parity | **DONE** |
| 5. Stateless backend | Move in-memory Maps to Postgres tables | **DONE** |
| 6. Cross-instance relay | Postgres LISTEN/NOTIFY | Deferred (not needed at current scale) |
| 7. Beta launch | 2-3 machines, autoscaling, monitoring | Pending |

---

## 15. Key Concepts

- **Plan graph**: A directed acyclic graph (DAG) of tasks, milestones, branches, and decisions. Core data model.
- **Vision doc**: Persistent document per project injected into every AI session as context.
- **Tiered verification**: `auto` (tests pass → complete) or `human` (manual judgment required).
- **Multi-environment dispatch**: Tasks target local, remote, HPC, or cloud environments.
- **Branch pruning**: Cancelling a task cascades cancellation to all downstream dependents.
- **Procedure pipeline**: ~~Multi-step execution workflows (implement → verify → commit → PR → summarize)~~ — Removed in execution path unification. The server-side procedure system was deleted. Agent runners handle single-step execution with agent-driven commits. Multi-step workflows may be re-added as an agent runner feature in the future.
- **Context assembly**: Vision doc + dependency outputs + graph position + skills injected into every dispatch prompt.
- **Session preservation**: Completed agent sessions are preserved for 10 minutes to enable post-completion steering.

### 15.1 Workspace V2

The workspace model defines how Astro manages project directories, agent isolation, and code delivery. Key aspects:

- **`.astro/` agent directory**: Per-project directory storing agent configuration, worktree metadata, and execution context. Aligned with Claude Code's `.claude/` convention.
- **Git worktrees**: Each task execution runs in an isolated git worktree (`git worktree add -b astro/{taskId}`), preventing parallel tasks from interfering with each other or the user's working tree.
- **Delivery modes**: Configurable per-project strategy for how completed work is delivered: `pr` (pull request), `push` (direct push), `branch` (branch only), `copy` (copy files), `direct` (in-place edits).
- **Directory detection**: Automatic detection of project source type (local directory, git repo URL, GitHub repo) with validation and setup during project creation.

See `WORKSPACE_V2.md` for the complete design, including data model changes, API endpoints, relay protocol extensions, and frontend integration.

---

## 16. Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Local DB | PGlite (Postgres in WASM) | Zero install, same SQL dialect, Drizzle compatible |
| Server DB | Postgres (Supabase → Fly.io → AWS RDS) | Portable via connection string |
| IndexedDB | Removed entirely | Frontend is a thin client. Backend + Postgres only |
| Data scoping | Team-based (`WHERE team_id = ?`) | Same SQL in both modes. Teams are billing unit |
| Frontend mode branching | None | 100% identical code in both modes |
| Cross-instance pub/sub | Postgres LISTEN/NOTIFY (no Redis) | Built into Postgres, no extra infra |
| Cache layer | HTTP cache headers only | Browser-native caching |
| Ephemeral data (file trees, skills) | Zustand memory + background API fetch | Lightweight, no persistence needed |
| Open source distribution | npm package with PGlite bundled | `npm start` works out of the box |

## 17. Open Questions

1. **React Query vs manual fetching?** TanStack Query handles retries, deduplication, stale-while-revalidate. Would eliminate store boilerplate.
2. **Multi-team switching UX.** Team selector dropdown, subdomain routing, or session cookie? Deferred until team billing ships.
3. **Team-level vs user-level settings.** Which settings (default model, default machine) are per-team vs per-user?

---

## Related Design Documents

| Document | Topic |
|----------|-------|
| `DATA_MODEL.md` | Complete schema (28 tables), entity relationships, type definitions |
| `BACKEND.md` | Backend startup, 20 routes, middleware, event system, dispatch, observability |
| `FRONTEND.md` | 27 stores, 16 pages, user journeys, persistence patterns |
| `RELAY.md` | WebSocket protocol, machine registry, event flow, authentication |
| `AGENT_RUNNER.md` | CLI, providers, safety system, execution strategies, MCP, worktrees |
| `EXECUTION_STRATEGIES.md` | Strategy interface, Direct/Docker/SLURM/K8s/SkyPilot details |
| `USER_WORKFLOWS.md` | End-to-end workflow traces through all components |
| `SERVER_LOCAL_MODE_SEPARATION.md` | Migration plan: move AI calls from server to agent runner (**COMPLETE**) |
| `EXECUTION_PATH_DUPLICATION.md` | Analysis of dual execution paths and resolution (§9) |
| `LOCAL_SERVER_REFACTOR.md` | PGlite + Drizzle migration steps with code examples |
| `IMPLEMENTATION_PIPELINE.md` | Blocker identification, alpha/beta readiness criteria |
| `CURRENT_CONFLICT_VIEW.md` | Known discrepancies between design docs and code |
| `AGENT_PERFORMANCE.md` | Agent performance optimization (proposed) |
| `ATTENTION_TRIAGE.md` | Attention triage system (proposed) |
| `COST_TRACKING.md` | Cost tracking and budgets (proposed) |
| `CROSS_PROJECT_REFERENCES.md` | Cross-project reference system (proposed) |
| `WORKSPACE_V2.md` | Workspace model: `.astro/` agent dir, worktrees, delivery modes, directory detection |
