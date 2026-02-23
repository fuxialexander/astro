# Package Architecture

## Overview

Astro is structured as a monorepo with a shared core library consumed by multiple frontends: CLI, web server, desktop app (Tauri), and MCP tool server. The guiding principle is that **orchestration logic is a library, not an HTTP server** — each deployment surface imports the same core and wraps it with its own I/O layer.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            @astro/core                                  │
│  Pure TypeScript library. No HTTP, no UI, no filesystem.                │
│  DB + Project + Plan + Dispatch + Skill Injection + Context Assembly    │
└──────┬──────────────────┬───────────────────┬──────────────────┬───────┘
       │                  │                   │                  │
  ┌────▼────┐     ┌──────▼──────┐    ┌───────▼───────┐  ┌──────▼──────┐
  │@astro/  │     │   server/   │    │   @astro/     │  │  MCP Tool   │
  │  cli    │     │  Hono API   │    │  agent-runner │  │  Server     │
  │         │     │  + Relay WS │    │               │  │             │
  └────┬────┘     └─────────────┘    └───────────────┘  └─────────────┘
       │
       │  Tauri bundles everything as a single binary
       │
  ┌────▼──────────────────────────────────────┐
  │  Tauri App (desktop)                      │
  │  Rust: window, tray, native fs, CLI detect│
  │  Sidecar: core + cli + agent-runner + Hono│
  └───────────────────────────────────────────┘
```

---

## Packages

### @astro/core

The shared library. Every other package imports this. Contains all business logic — no I/O boundaries (no HTTP, no filesystem, no UI).

```
packages/core/
├── db/
│   ├── schema.ts            # Drizzle ORM schema (all tables)
│   ├── migrate.ts           # Migration runner
│   ├── connection.ts        # PGlite / postgres-js factory
│   └── bootstrap-local.ts   # Local-mode team/user init
├── project-manager.ts       # Projects CRUD
├── plan-manager.ts          # Plan nodes/edges CRUD, AI plan generation
├── dispatch/
│   ├── dispatch-engine.ts   # Queue, dependency resolution, execution
│   ├── dispatch-queue.ts    # Priority queue management
│   ├── context-assembler.ts # Vision doc + dependency context injection
│   ├── result-router.ts     # Routes task results to correct status
│   └── branch-manager.ts    # Branch tracking and pruning
├── skill-manager.ts         # In-memory skill registry
├── skill-injector.ts        # Stateless: skills[] → XML prompt string
├── skill-parser.ts          # Stateless: SKILL.md content → OpenClawSkill
├── types.ts                 # Project, PlanNode, PlanEdge, OpenClawSkill, etc.
└── index.ts                 # Public API
```

| Property | Value |
|----------|-------|
| Language | TypeScript (strict) |
| Filesystem access | None |
| Network access | None (Claude API calls are in consumers, not core) |
| Database | PGlite (local) or postgres-js (server), via Drizzle ORM |
| State | In-process. Skill registry is in-memory; DB is injected at init. |

### @astro/cli

CLI frontend. Human-usable and agent-usable (JSON output mode). Also installable standalone via npm.

```
packages/cli/
├── commands/
│   ├── project.ts           # astro project create/list/show/delete
│   ├── plan.ts              # astro plan generate/view/edit/export
│   ├── task.ts              # astro task list/dispatch/cancel/status
│   ├── skill.ts             # astro skill list/scan/install/remove
│   ├── serve.ts             # astro serve (starts Hono + React for web UI)
│   └── connect.ts           # astro connect (starts agent-runner daemon)
├── output.ts                # Table/JSON/plain formatters
├── config.ts                # ~/.astro/config.json management
└── index.ts                 # Entry point (commander or yargs)
```

| Property | Value |
|----------|-------|
| Language | TypeScript |
| Imports | @astro/core (direct, in-process) |
| Filesystem access | Yes (Node.js `fs` — skill scan, git ops, config) |
| Network access | Claude API (plan generation), optional Relay (for `connect`) |
| Database | PGlite at `~/.astro/pglite/` |
| Distribution | `npm install -g @astro/cli` → `astro` binary |

```bash
# Human use
astro project create --name "my-project" --dir ./my-repo
astro plan generate --project-id abc123
astro task list --status planned
astro task dispatch node-xyz

# Agent use (JSON output for piping)
astro plan generate --project-id abc123 --json
astro task list --status planned --json | jq '.[]'
```

### server/ (Hono API + Relay)

Thin HTTP and WebSocket layer. Wraps @astro/core with HTTP routes, SSE streaming, auth middleware, and the WebSocket relay. Does NOT own business logic — delegates to core.

```
server/
├── index.ts                 # Hono app setup, route mounting, server start
├── routes/
│   ├── data.ts              # GET/POST /api/data/* → core CRUD
│   ├── agent.ts             # POST /api/agent/* → core + Claude API (SSE)
│   ├── dispatch.ts          # POST /api/dispatch/* → core dispatch engine
│   ├── skills.ts            # GET/POST /api/skills/* → core skill registry
│   ├── events.ts            # GET /api/events/stream → SSE bridge
│   ├── relay.ts             # GET/POST /api/relay/* → relay HTTP API
│   ├── repo.ts              # GET/POST /api/repo/* → git operations
│   ├── auth.ts              # WebAuthn/passkey endpoints
│   └── ...                  # Other routes (github, teams, etc.)
├── middleware/
│   ├── auth.ts              # Authentication middleware
│   └── audit.ts             # Audit logging
├── lib/
│   ├── relay-server.ts      # WebSocket relay hub
│   ├── machine-registry.ts  # Connected machine tracking
│   ├── event-buffer.ts      # SSE reconnection replay
│   ├── redis-pubsub.ts      # Horizontal scaling
│   └── events/              # Event transport + hooks (SSE, audit, usage)
└── types/
    └── relay.ts             # WebSocket protocol types
```

| Property | Value |
|----------|-------|
| Language | TypeScript |
| Imports | @astro/core |
| Filesystem access | None (post-refactor) |
| Network access | Inbound (serves HTTP API + WebSocket relay) |
| Deployment | Fly.io (production), localhost via `astro serve`, Tauri sidecar |

### @astro/agent-runner

Runs on user machines. Receives task dispatches, spawns agent processes (Claude Code, Codex), streams output, collects results. Can run standalone or embedded in Tauri.

```
packages/agent-runner/
├── src/
│   ├── index.ts             # Entry point, CLI arg parsing
│   ├── lib/
│   │   ├── task-executor.ts # Spawn agent, pipe stdout, collect result
│   │   ├── worktree.ts      # Git worktree creation/cleanup
│   │   ├── config.ts        # ~/.astro/ config management
│   │   └── relay-client.ts  # WebSocket connection to relay
│   ├── providers/
│   │   ├── claude-code.ts   # Claude Code adapter
│   │   ├── codex.ts         # Codex adapter
│   │   └── types.ts         # AgentProvider interface
│   └── mcp/
│       └── astro-tools-server.ts  # 15 MCP tools for agent self-direction
└── package.json             # @astro/agent, bin: astro-agent
```

| Property | Value |
|----------|-------|
| Language | TypeScript |
| Imports | @astro/core (for MCP tools) |
| Filesystem access | Yes (worktrees, agent execution, file changes) |
| Network access | Relay WS (receives dispatches), Claude API (via agent) |
| Runs as | Standalone daemon, embedded in Tauri sidecar, on HPC/cloud/CI |

### MCP Tool Server

Runs INSIDE agent execution sessions. Gives agents the ability to query and modify the plan graph, projects, and initiatives. Not a separate package — it's part of @astro/agent-runner but imports @astro/core.

| Property | Value |
|----------|-------|
| 15 tools | query_plan, create_task, update_task, delete_task, create_dependency, query_projects, get_project, create_project, update_project, query_initiatives, create_initiative, update_initiative, get_user_profile, query_executions, ask_user_question |
| Imports | @astro/core (direct, or via ASTRO_SERVER_URL HTTP) |
| Filesystem | None (pure data operations) |

### Tauri App (desktop)

Single binary that provides GUI + CLI. Rust handles native concerns; a Node.js sidecar runs the TypeScript stack.

```
packages/desktop/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs          # Entry: CLI args? → sidecar CLI : open window
│   │   ├── lib.rs
│   │   └── commands/
│   │       ├── mod.rs
│   │       ├── skills.rs    # scan_skills → native fs scan
│   │       ├── plugins.rs   # scan_plugins → native fs scan
│   │       ├── files.rs     # list_files → git ls-files
│   │       └── watcher.rs   # file watchers for live reload
│   └── icons/
├── sidecar/                  # Bundled Node.js process
│   └── (built from @astro/core + @astro/cli + agent-runner + Hono)
└── package.json
```

Rust only does 4 things:

| Rust responsibility | Why not TypeScript |
|--------------------|--------------------|
| Window management | Native webview API |
| System tray | OS-specific API |
| Native filesystem (plugin/skill scan) | <1ms reads, file watchers |
| CLI arg detection | Decides window vs CLI before Node starts |

Everything else runs in the Node.js sidecar.

---

## Deployment Scenarios

### 1. Web Mode (current production)

```
Browser ──HTTPS──▶ Hono (Fly.io) ──WS──▶ Relay ──WS──▶ Agent Runner
  │                    │                                   │
  │                    ├──▶ Claude API                     ├──▶ Filesystem
  │                    ├──▶ Supabase                       └──▶ Claude Code
  │                    └──▶ PGlite/Postgres
  │
  └──SSE──◀ Hono ◀──events──◀ Relay ◀──stdout──◀ Agent Runner
```

- Server: Fly.io (Hono + Relay)
- Frontend: Cloudflare Pages (React)
- Agent runner: User machine, HPC, cloud
- DB: PGlite (local mode) or Supabase Postgres (server mode)

### 2. CLI Only (developer laptop, CI, AI agent via shell)

```
Terminal
  │
  ▼
@astro/cli ──▶ @astro/core ──▶ PGlite (~/.astro/)
  │                │
  │                └──▶ Claude API (plan generation)
  │
  └──▶ @astro/agent-runner ──▶ Claude Code ──▶ Filesystem
         (optional, for `astro task dispatch`)
```

- No server, no relay, no browser
- Just a Node.js process with local PGlite
- `astro plan generate` calls Claude API directly
- `astro task dispatch` optionally spawns agent-runner in-process

### 3. Tauri Standalone (desktop, offline, single user)

```
┌──────────────────────────────────────────────────────┐
│ Tauri binary                                          │
│                                                       │
│  Webview (React) ◀══IPC══▶ Rust (fs, tray)           │
│                              │                        │
│                     Node.js sidecar                   │
│                      ├─ @astro/core → PGlite          │
│                      ├─ Hono (localhost)               │──▶ Claude API
│                      └─ agent-runner                   │
│                           └─▶ Filesystem              │
└──────────────────────────────────────────────────────┘
```

- 1 binary, 0 network hops for local operations
- Only outbound connection: Claude API
- Full offline capability (except plan generation)

### 4. Tauri + Remote Machines (desktop + HPC/cloud dispatch)

```
┌──────────────────────────────────┐
│ Tauri binary                      │       Relay          Remote Machine
│                                   │        Server         (HPC/Cloud)
│ Webview ◀══IPC══▶ Rust           │  WS   ┌───────┐  WS ┌────────────┐
│                     │             │──────▶│       │────▶│ Agent      │
│              Node.js sidecar      │◀══════│       │◀════│ Runner     │
│               ├─ core → PGlite   │       └───────┘     └────────────┘
│               ├─ Hono            │──▶ Claude API
│               ├─ agent-runner    │──▶ Supabase (sync)
│               │   (local tasks)  │
│               └─ relay client    │──▶ Relay (remote tasks only)
└──────────────────────────────────┘
```

- Local tasks: 0 network hops (embedded agent-runner)
- Remote tasks: Tauri → Relay → Remote Agent Runner
- Hono backend on Fly.io is bypassed — Rust connects to Relay directly

### 5. Tauri CLI Mode (same binary, no window)

```
Terminal
  │
  ▼
Tauri binary (Rust detects CLI args)
  │
  └──▶ Node.js sidecar
         ├─ @astro/cli (handles command)
         └─ @astro/core → PGlite
```

- Same binary as GUI — `astro` opens window, `astro plan list` runs CLI
- Tauri v2 `plugin-cli` handles arg detection before window creation
- CLI commands execute in the sidecar and exit

---

## Communication Protocols

### Web Mode

| From | To | Protocol | Latency | Used for |
|------|----|----------|---------|----------|
| Browser | Hono | HTTPS | 50-200ms | All API calls |
| Browser | Hono | SSE | streaming | Task output, events |
| Hono | Relay | In-process | ~0ms | Co-located in same server |
| Relay | Agent Runner | WebSocket | 50-200ms | Task dispatch, stdout |
| Hono | Claude API | HTTPS + SSE | 100-500ms | Plan generation, chat |
| Hono | Supabase | TCP/SSL | 10-50ms | Data persistence |
| Browser | Supabase | WebSocket | 50-200ms | Realtime sync |

### Tauri Mode

| From | To | Protocol | Latency | Used for |
|------|----|----------|---------|----------|
| Webview | Rust | Tauri IPC (OS pipes) | ~0.1ms | All frontend-backend calls |
| Rust | Filesystem | Direct syscalls | <1ms | Skills, plugins, file trees |
| Rust | Node sidecar | stdin/stdout | ~1ms | Business logic delegation |
| Sidecar | PGlite | In-process FFI | <1ms | Data persistence |
| Sidecar | Claude API | HTTPS + SSE | 100-500ms | Plan generation, chat |
| Sidecar | Agent Runner | Process spawn + pipes | ~50ms startup | Local task execution |
| Sidecar | Relay | WebSocket | 50-200ms | Remote task dispatch only |
| Sidecar | Supabase | HTTPS + WebSocket | 50-200ms | Sync (connected/team only) |

### CLI Mode

| From | To | Protocol | Latency | Used for |
|------|----|----------|---------|----------|
| CLI | @astro/core | In-process | ~0ms | All operations |
| CLI | PGlite | In-process FFI | <1ms | Data persistence |
| CLI | Claude API | HTTPS + SSE | 100-500ms | Plan generation |
| CLI | Filesystem | Node.js fs | <1ms | Skill scan, git ops |

---

## What Each Mode Needs from the Network

| Mode | Outbound connections | Can work offline? |
|------|---------------------|-------------------|
| CLI (local) | Claude API only | Yes (except plan generation) |
| Tauri standalone | Claude API only | Yes (except plan generation) |
| Tauri connected | Claude API + Supabase | Partial (queues syncs) |
| Tauri team | Claude API + Supabase + Relay | Partial (queues syncs, no remote dispatch) |
| Web local dev | Claude API | Yes (except plan generation) |
| Web production | Claude API + Supabase | No (server must be reachable) |

---

## Migration from Current Structure

### What moves into @astro/core

These currently live in `server/lib/` but have no HTTP or filesystem dependencies:

| Current location | New location | Notes |
|------------------|-------------|-------|
| `server/lib/db/schema.ts` | `packages/core/db/schema.ts` | Drizzle schema |
| `server/lib/db/migrate.ts` | `packages/core/db/migrate.ts` | Migrations |
| `server/lib/db/index.ts` | `packages/core/db/connection.ts` | PGlite/postgres factory |
| `server/lib/dispatch/dispatch-engine.ts` | `packages/core/dispatch/dispatch-engine.ts` | Core orchestration |
| `server/lib/dispatch/dispatch-queue.ts` | `packages/core/dispatch/dispatch-queue.ts` | Queue |
| `server/lib/dispatch/context-assembler.ts` | `packages/core/dispatch/context-assembler.ts` | Context building |
| `server/lib/dispatch/result-router.ts` | `packages/core/dispatch/result-router.ts` | Result routing |
| `server/lib/dispatch/branch-manager.ts` | `packages/core/dispatch/branch-manager.ts` | Branch ops |
| `server/lib/skill-manager.ts` | `packages/core/skill-manager.ts` | Already refactored |
| `server/lib/skill-injector.ts` | `packages/core/skill-injector.ts` | Already created |
| `src/lib/skill-parser.ts` | `packages/core/skill-parser.ts` | Already created |
| `src/types/index.ts` | `packages/core/types.ts` | Shared types |
| `src/types/skill.ts` | `packages/core/types/skill.ts` | Skill types |

### What stays in server/

These are HTTP/WebSocket-specific and remain in `server/`:

| File | Why it stays |
|------|-------------|
| `server/routes/*` | HTTP route handlers (Hono-specific) |
| `server/middleware/*` | Auth, audit (HTTP-specific) |
| `server/lib/relay-server.ts` | WebSocket server (transport-specific) |
| `server/lib/machine-registry.ts` | Connected machine tracking (relay-specific) |
| `server/lib/event-buffer.ts` | SSE reconnection replay (SSE-specific) |
| `server/lib/redis-pubsub.ts` | Horizontal scaling (deployment-specific) |
| `server/lib/events/*` | SSE notification hooks (transport-specific) |

### What stays in src/

The React frontend stays as-is. It calls HTTP API in web mode and Tauri IPC in desktop mode, selected by the `SkillProvider` pattern (already implemented).

### New packages to create

| Package | Priority | Description |
|---------|----------|-------------|
| `packages/core` | P0 — prerequisite for everything | Extract from server/ and src/ |
| `packages/cli` | P1 — immediately useful | CLI frontend for planning |
| `packages/desktop` | P2 — after core + cli work | Tauri wrapper |

---

## Distribution

```bash
# 1. CLI only (npm, lightest)
npm install -g @astro/cli
astro project create --name "my-project" --dir ./my-repo
astro plan generate --project-id abc123

# 2. Desktop app (Tauri binary, includes CLI)
# macOS
brew install astro
# Linux
curl -fsSL https://astro.fuxialexander.work/install.sh | sh
# Windows
winget install astro

# Both modes from one binary:
astro                        # → opens GUI window
astro plan generate --id x   # → runs CLI command, no window

# 3. Web mode (self-hosted, Docker or npm)
npm run dev                  # Local development
docker compose up            # Production deployment

# 4. Agent runner (on remote machines)
npm install -g @astro/agent
astro-agent connect --server wss://astro-relay.example.com
```
