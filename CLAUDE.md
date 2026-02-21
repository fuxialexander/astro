# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Astro** is a planning-first platform for builders (software developers) and scientists (researchers). It provides an AI-assisted planning layer that sits above execution tools (coding agents, analysis tools) to help users decompose complex goals, manage dependencies across environments, and focus human attention on strategic decisions.

The product vision is documented in `vision.md`. The UI design is in `UI.pen` (read via Pencil MCP tools only, not with `Read` or `Grep`).

**Documentation:** Complete documentation is in `docs/index.md` with sections for Backend, Frontend, Relay Server, and System Setup.

## Build & Quality

**After implementing any feature or code change, always run `npm run build` (or equivalent TypeScript compilation check) and fix ALL type errors before considering the task complete. Do not present work as done until it compiles cleanly.**

**After fixing lint errors or making code changes, run `npm run lint` and fix all issues before committing. Never commit code with known lint errors.**

## Build & Dev Commands

```bash
npm run dev              # Start frontend (Vite) + backend (Hono + relay) concurrently
npm run dev:frontend     # Vite dev server only (http://localhost:5173)
npm run dev:backend      # Hono API server (port 3001) + WebSocket relay (port 3002)
npm run dev:indexeddb    # IndexedDB-only mode (no Supabase, no auth)
npm run dev:supabase     # Supabase mode (setup + start)
npm run build            # TypeScript check + Vite production build
npm run lint             # ESLint
npm test                 # Vitest (29 test files, integration tests auto-skip without server/API key)
npm run deploy           # Build + deploy to Cloudflare Pages
```

### Database Modes

Astro supports two persistence modes:

**Local Mode** (default for local dev):
- IndexedDB is the primary data store
- No authentication required, no Docker, no Supabase
- Single-user only
- Perfect for rapid iteration
- Start with: `npm run dev:indexeddb` or `npm run dev` (if no Supabase env vars)
- Mode detection: `isLocalMode()` from `src/lib/app-mode.ts` (frontend) or `server/lib/app-mode.ts` (backend)

**Server Mode** (multi-user production):
- Supabase/Postgres is the single source of truth
- IndexedDB serves as a transparent cache for fast startup and offline resilience
- WebAuthn/passkey authentication
- Multi-user with data isolation via RLS
- Real-time collaboration
- Start with: `npm run dev:supabase` or `npm run dev` (if Supabase env vars set)
- Mode detection: `isServerMode()` from `src/lib/app-mode.ts` (frontend) or `server/lib/app-mode.ts` (backend)

**Mode Detection:**
1. If `USE_INDEXEDDB_ONLY=true` → Local mode (explicit override)
2. If Supabase env vars not set → Local mode (auto-detected)
3. If Supabase env vars set → Server mode

**Visual Indicator:** Sidebar shows "Local Mode" badge when in local mode.

### Local Development

Everything runs locally — no Fly.io, Redis, or external services needed for development:
- `npm run dev` starts the full stack: Vite (5173) + Hono API (3001) + WebSocket relay (3002)
- Vite proxies `/api` requests to `localhost:3001` automatically
- The relay server starts alongside Hono in `server/index.ts`
- Redis pub/sub is only needed for horizontal scaling (multiple relay instances); single-instance local dev works without it
- `RELAY_JWT_SECRET` is optional in dev mode

## Tech Stack

- **Frontend**: Vite 7 + React 19 + TypeScript (strict mode)
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite` plugin, NOT `@tailwindcss/postcss`)
- **Routing**: React Router v7 (`react-router` package, not `react-router-dom`)
- **State**: Zustand 5 stores + `idb-keyval` for IndexedDB persistence
- **Graph**: @xyflow/react for plan graph visualization
- **UI Components**: shadcn/ui pattern (manual Radix primitives, not CLI-installed)
- **Icons**: lucide-react
- **Command Palette**: cmdk
- **Backend**: Hono.js on Node.js (port 3001), proxied via Vite `/api` → localhost:3001
- **AI**: @anthropic-ai/claude-agent-sdk for plan generation + chat
- **Deployment**: Cloudflare Tunnel (dev) + Fly.io (backend, production) + Cloudflare Pages (frontend, production)
- **Landing Page**: Static HTML in `public/landing/` (served at `/landing/`)

## Architecture

### Path Alias
`@/` maps to `./src/` (configured in both `vite.config.ts` and `tsconfig.app.json`).

### Project Structure
```
public/
├── landing/
│   ├── index.html                # Landing page (astro-landing.html)
│   └── about.html                # "Why Astro?" page (astro-about.html)

src/
├── app.tsx                       # Root: BrowserRouter, DataLoader, routes
├── main.tsx                      # React DOM entry point
├── globals.css                   # Tailwind v4 theme, CSS variables, light/dark tokens
├── pages/
│   ├── dashboard.tsx             # Home: stats, pending decisions, active projects, system health, usage metrics
│   ├── projects.tsx              # Project list with table (grouped, sortable columns)
│   ├── project-new.tsx           # New project form + AI plan generation
│   ├── project-overview.tsx      # Project details: overview + updates tabs, vision doc dialog
│   ├── plan-view.tsx             # Plan graph canvas + node detail panel + chat (Graph/List/Timeline toggle)
│   ├── my-tasks.tsx              # Cross-project task list with filters, grouping, display settings
│   ├── task-detail.tsx           # Task-agent detail: output, tool traces, file changes, steer chat
│   ├── environments.tsx          # Machine/environment management, SLURM cluster display
│   ├── agents.tsx                # Agent management and monitoring
│   ├── initiatives.tsx           # Initiatives/projects grouping
│   ├── device-auth.tsx           # Device code OAuth2 authentication flow
│   ├── welcome.tsx               # Multi-step onboarding (user type, domains, repo)
│   ├── login.tsx                 # WebAuthn/passkey login (public route)
│   └── settings.tsx              # Backend connection, model selection
├── components/
│   ├── ui/                       # shadcn/ui Radix primitives (button, input, badge, card, dialog, sheet, etc.)
│   ├── layout/
│   │   ├── app-layout.tsx        # Sidebar + <Outlet /> wrapper
│   │   ├── sidebar.tsx           # Nav items (Dashboard, Projects, My Tasks, Environments), user profile
│   │   └── header.tsx            # Reusable page header
│   ├── task-creation-form.tsx    # Reusable task creation (inline/popover/dialog modes)
│   ├── display-popover.tsx       # Reusable display settings popover (groupBy, orderBy, properties)
│   ├── vision-doc-dialog.tsx     # Vision document editor dialog (per-project)
│   ├── plan-graph/
│   │   ├── plan-canvas.tsx       # React Flow wrapper (ReactFlowProvider, background, controls, graph popover creation)
│   │   ├── task-node.tsx         # Custom node component with status styling, live progress, hover '+' button
│   │   ├── plan-graph-tab.tsx    # Graph view tab with node editor
│   │   └── plan-timeline-tab.tsx # Gantt timeline view (tabbed)
│   ├── task-detail/
│   │   ├── task-output-view.tsx  # Terminal-style output viewer with search, copy, auto-scroll
│   │   ├── tool-trace-view.tsx   # Vertical timeline of tool calls with collapsible I/O
│   │   ├── file-changes-view.tsx # File change list with diff display
│   │   ├── steer-chat.tsx        # Agent steering chat (sends guidance to running agent)
│   │   ├── task-chat.tsx         # Task-level chat interface
│   │   └── session-activity-view.tsx # Session activity timeline view
│   ├── execution/
│   │   ├── execution-panel.tsx   # Task execution UI with play/cancel/output
│   │   └── provider-status.tsx   # Provider availability display
│   ├── slurm/
│   │   ├── cluster-status.tsx    # Cluster health/capacity display
│   │   └── job-list.tsx          # Active HPC jobs list
│   ├── environments/
│   │   └── add-environment-dialog.tsx # Dialog for adding local/HPC/cloud machines
│   ├── generation-toasts.tsx    # Toast notifications during AI plan generation
│   ├── agent/
│   │   └── chat-panel.tsx        # Sidebar chat for plan refinement
│   ├── activity-dialog.tsx       # Activity history dialog for projects
│   ├── approval-card.tsx         # Approval/decision UI component
│   ├── milestone-dialog.tsx      # Milestone creation/edit dialog
│   ├── theme-provider.tsx        # Light/dark/system theme context
│   └── command-palette.tsx       # Cmd+K palette (navigation + theme toggle + project search)
├── stores/
│   ├── activity-store.ts         # Activity tracking and history, IndexedDB persistence
│   ├── agent-store.ts            # AI generation state, SSE streaming, abort
│   ├── api-keys-store.ts         # Encrypted API keys for external services (Web Crypto API)
│   ├── auth-store.ts             # Supabase auth session, user state, WebAuthn/passkey
│   ├── connected-accounts-store.ts # Connected external accounts (Slack, Telegram, GitHub webhooks, Linear)
│   ├── display-settings-store.ts # Per-view display settings (groupBy, orderBy, properties), IndexedDB persistence
│   ├── execution-store.ts        # Task execution state, SSE stream processing, provider/machine management
│   ├── github-store.ts           # GitHub integration: connection, repositories, selections
│   ├── initiative-store.ts       # Initiatives/projects grouping, IndexedDB persistence
│   ├── keyboard-nav-store.ts     # Keyboard navigation state (focused item, navigable items)
│   ├── machines-store.ts         # Registered machines (fetch, revoke, rename)
│   ├── observation-store.ts      # Trace observation trees for execution debugging
│   ├── plan-store.ts             # Plan nodes/edges per project, bulk updates
│   ├── plugin-store.ts           # Plugin registry, manifests, contributions, IndexedDB persistence
│   ├── project-store.ts          # Projects CRUD, IndexedDB persistence, mock seed data
│   ├── realtime-store.ts         # Real-time events: machines, activity feed, task streams
│   ├── session-store.ts          # Unified session store: plan chat, task chat, steer messages, execution sessions
│   ├── settings-store.ts         # Model selection, backend health, IndexedDB persistence
│   ├── sidebar-store.ts          # Sidebar navigation items, visibility, ordering
│   ├── skill-store.ts            # OpenClaw skill registry, IndexedDB persistence
│   ├── slurm-store.ts            # HPC/Slurm cluster state (clusters, jobs, queue tracking)
│   ├── task-chat-store.ts        # Task-level chat history, IndexedDB persistence
│   ├── team-store.ts             # Teams CRUD, team members, IndexedDB persistence
│   ├── toast-store.ts            # Toast notification queue (info, success, warning, error)
│   ├── ui-store.ts               # Sidebar collapsed, command palette open
│   ├── usage-store.ts            # Session usage metrics (cost, tokens, task counts), IndexedDB persistence
│   └── user-profile-store.ts     # User identity and preferences (name, email, domains, API keys)
├── lib/
│   ├── db.ts                     # idb-keyval wrapper for IndexedDB
│   ├── api-client.ts             # HTTP + SSE client for /api/agent/* endpoints
│   ├── realtime-client.ts        # EventSource wrapper for /api/events/stream
│   ├── constants.ts              # Priority/estimate config, default labels
│   ├── graph-utils.ts            # Graph node position calculation for child placement
│   ├── timeline-utils.ts         # Gantt timeline calculations (topological sort, date assignment)
│   └── utils.ts                  # cn() = clsx + tailwind-merge
└── types/
    └── index.ts                  # Project, PlanNode, PlanEdge, TaskExecution, ProviderStatus, UserProfile, etc.

server/
├── index.ts                      # Hono server setup, CORS, port 3001 + relay init
├── routes/
│   ├── health.ts                 # GET /api/health (Claude SDK auth check)
│   ├── agent.ts                  # POST /api/agent/generate-plan, /chat, /abort (SSE streaming)
│   ├── dispatch.ts               # POST /api/dispatch/task, /cancel, /steer, /prune (task execution)
│   ├── events.ts                 # GET /api/events/stream (SSE bridge: relay → browser)
│   ├── relay.ts                  # GET/POST /api/relay/* (machine registry, task dispatch)
│   └── device-auth.ts            # Device authorization flow (RFC 8628): authorize, token, register, refresh, revoke
├── lib/
│   ├── session-manager.ts        # In-memory AbortController map for agent sessions
│   ├── prompt-templates.ts       # System prompts + JSON schema for plan generation
│   ├── relay-server.ts           # WebSocket relay server for agent runner communication
│   ├── machine-registry.ts       # Live machine registry with connection tracking
│   ├── event-buffer.ts           # Ring buffer for SSE reconnection replay (Last-Event-ID)
│   ├── stdout-throttle.ts        # Batches stdout chunks per task (100ms flush)
│   ├── redis-pubsub.ts           # Redis pub/sub for horizontal scaling
│   ├── device-code-store.ts      # Device code state management
│   ├── token-manager.ts          # JWT token lifecycle (create, verify, refresh, revoke)
│   ├── registered-machines-store.ts # Machine registration persistence
│   ├── events/
│   │   └── astro-event-transport.ts # Singleton event transport (SSE, audit log, usage metrics hooks)
│   ├── providers/                # Pluggable agent provider system
│   │   ├── types.ts              # AgentProvider, TaskDispatch, TaskResult, StreamEvent interfaces
│   │   ├── registry.ts           # Provider registry management
│   │   ├── context.ts            # Context assembly for providers
│   │   └── adapters/             # Provider implementations
│   │       ├── claude-code.ts    # Claude Code provider adapter
│   │       ├── codex.ts          # Codex provider adapter
│   │       └── anthropic-direct.ts # Anthropic direct API provider adapter
│   ├── dispatch/                 # Task dispatch engine
│   │   ├── dispatch-engine.ts    # Core dispatch execution logic
│   │   ├── dispatch-queue.ts     # Task queue management
│   │   ├── branch-manager.ts     # Branch tracking/pruning
│   │   ├── context-assembler.ts  # Assembles execution context (vision doc + dependencies)
│   │   └── result-router.ts      # Routes task results to storage
│   ├── slurm/                    # HPC cluster support
│   │   ├── types.ts              # SLURM job/partition types
│   │   ├── job-manager.ts        # Submit/cancel/monitor jobs
│   │   ├── script-generator.ts   # Generates SBATCH scripts
│   │   └── parser.ts             # Parses SLURM output
│   └── mcp/                      # MCP server integration
│       └── astro-tools-server.ts # Custom MCP server (ask_user_question tool)
└── types/
    └── relay.ts                  # WebSocket protocol types for relay communication

packages/
└── agent-runner/                 # Compiled agent runner distribution

cli/
└── astro-agent/                  # CLI tools for agent runner

docs/
└── ...                           # Architecture documentation
```

### Routes
| Path | Page | Status |
|------|------|--------|
| `/` | Dashboard | Implemented (auto-redirects to /welcome if no projects; stats, pending decisions, active projects, system health, usage metrics) |
| `/projects` | Projects list | Implemented (list view only, board/filter stubs) |
| `/projects/new` | New Project | Implemented (simplified form: description + optional repo + environment) |
| `/project/:id` | Project Overview | Implemented (overview + updates tabs, vision doc dialog) |
| `/project/:id/plan` | Plan View | Implemented (graph + list + timeline toggle, detail panel + chat, task creation across all views) |
| `/project/:id/task/:nodeId` | Task Detail | Implemented (output, tools, files, steer chat, session activity) |
| `/tasks` | My Tasks | Implemented (cross-project task list with filters, grouping, display settings) |
| `/environments` | Environments | Implemented (machine registration, SLURM clusters, device code flow) |
| `/agents` | Agents | Implemented (agent listing and monitoring) |
| `/initiatives` | Initiatives | Implemented (initiatives/projects grouping) |
| `/settings` | Settings | Implemented (health check + model selection) |
| `/device` | Device Auth | Implemented (standalone OAuth2 device code flow) |
| `/welcome` | Welcome | Implemented (simplified 2-option onboarding: empty project or repo-based project) |
| `/login` | Login | Implemented (WebAuthn/passkey authentication) |
| `/landing/` | Landing Page | Implemented (static HTML, public marketing page) |
| `/landing/about` | Why Astro? | Implemented (static HTML, philosophy/naming page) |
| `/issues` | Issues List | **Not implemented** (designed in UI.pen, no code) |
| `/issues/board` | Issues Board | **Not implemented** (designed in UI.pen, no code) |

### Data Flow
1. Stores load from IndexedDB on mount via `DataLoader` component
2. Project creation → navigates to plan view → triggers AI generation via SSE
3. Backend streams Claude Agent SDK output as Server-Sent Events
4. Plan nodes/edges stored in Zustand → rendered in React Flow graph
5. AI generates `startDate`/`endDate` for each plan node; timeline uses topological sort fallback for legacy data
6. All state persisted to IndexedDB on change

### Provider & Dispatch System
- **Provider adapters** (Claude Code, Codex, SLURM) implement a common `AgentProvider` interface
- **Dispatch engine** routes tasks through a queue → provider selection → execution → result routing
- **Context assembler** injects vision doc + dependency context into each task
- **Streaming events**: `init`, `session_init`, `text`, `tool_use`, `tool_result`, `structured_output`, `file_change`, `progress`, `result`, `error`, `aborted`, `heartbeat`, `done`
- **Usage metrics**: Execution results include `UsageMetrics` (cost, tokens, model, turns); accumulated in `usage-store` per session
- **Device auth flow**: OAuth2 Device Authorization Grant (RFC 8628) for machine registration

## Key Concepts

- **Plan graph**: Core data model is a directed graph (not a flat list) supporting linear pipelines and branching exploration trees with explicit dependencies
- **Tiered verification**: Auto-close for verifiable tasks (tests pass, build succeeds), human judgment for strategic/product decisions
- **Multi-environment dispatch**: Tasks run across local machines, HPC clusters (Slurm), and cloud (AWS/GCP)
- **Vision/context injection**: A persistent document describing product vision or research question is injected into every agent session, above codebase context
- **Branch pruning**: Killing a branch auto-cancels all downstream tasks
- **Agent-agnostic execution**: Wraps existing agents (e.g., Claude Code), does not build custom agents
- **Data flywheel**: Planning traces (decomposition, overrides, pruning decisions, outcomes) improve future plans via context engineering, not model retraining
- **Activity Feed**: Real-time activity tracking system with IndexedDB persistence, captures all project/task events
- **Approval System**: Dynamic tool-based approvals (`ask_user_question`) + procedure-level approvals with SSE notifications
- **Realtime Sync**: Multi-device collaboration via Supabase Realtime with optimistic updates and conflict resolution
- **MCP Integration**: Custom MCP server (`astro-tools-server.ts`) provides `ask_user_question` tool for dynamic agent approvals

## Target Users

1. **Builders** — Software engineers using AI coding agents, need product-level planning above code-level context
2. **Scientists** — Researchers managing branching analyses across computing environments (laptop, HPC, cloud)

## Code Patterns

- Use `cn()` from `@/lib/utils` for Tailwind class merging
- Follow existing shadcn/ui component patterns in `src/components/ui/`
- Zustand stores: use `(s) => s.field` selectors, persist via `idb-keyval`
- React Flow: define node data type as `type TaskNodeData = Node<{ ... }>`, use `NodeProps<TaskNodeData>`, cast `nodeTypes` to `any`; wrap in `ReactFlowProvider` when using `useReactFlow()` hooks
- Task creation: use `TaskCreationForm` component with `mode="inline"|"popover"|"dialog"`; creates nodes via `usePlanStore.addNode()` + `addEdge()`
- SSE streaming: use `readSSE()` from `api-client.ts` for server-sent events
- Status types: `planned | dispatched | in_progress | auto_verified | awaiting_approval | awaiting_judgment | completed | pruned`
- PlanNode dates: optional `startDate`/`endDate` as ISO `YYYY-MM-DD` strings; AI generates them, timeline assigns defaults via topological sort for legacy nodes
- PlanNode execution fields: `executionId`, `executionOutput`, `executionError`, `executionStartedAt`, `executionCompletedAt`
- PlanNode list fields: `dueDate` (ISO YYYY-MM-DD), `estimate` (XS/S/M/L/XL), `milestoneId`
- Display settings: `DisplayPopover` component with `DisplayPopoverConfig` for per-view groupBy/orderBy/properties
- Usage tracking: `useUsageStore` accumulates session metrics (cost, tokens, task counts) from execution results
- Types include: `TaskExecution`, `ProviderStatus`, `Priority`, `Label`, `UserProfile`, `DomainExpertise`, `UsageMetrics`

## Database

**When implementing database-backed features, always include the Supabase schema migration as part of the initial implementation. Do not wait for the user to ask about database schema changes.**

## Debugging

**When debugging issues, investigate the root cause before attempting fixes. Check if setup scripts, cached tokens, or stale state could be the source. Do not iterate through surface-level fixes.**

## UI/Design

**When matching a design reference, ask clarifying questions about visual style (glassmorphism, flat, material weight) BEFORE implementing. Start with a small component to validate the approach.**

## Error Handling

**Never silently fall back to a degraded mode. If an operation is expected to succeed (e.g., worktree creation, auth, external service call), fail fast with a descriptive error rather than swallowing the exception and continuing in a broken state. Errors must be surfaced to the user (via SSE, API response, or UI) — a `console.warn` alone is not sufficient. When cleanup of prior state is needed before an operation (e.g., stale worktrees, temp files), implement a fallback cleanup path (e.g., force-remove + prune) rather than wrapping the whole block in `catch {}`. Prefer throwing descriptive errors over returning `null` from functions that the caller expects to succeed.**

## Planning

**When referencing existing codebases or config paths for integration plans, verify the actual paths and file structure by reading the filesystem first. Do not assume paths like ~/.cyrus/ — check what actually exists.**

## Relay Server

The relay server is a WebSocket hub that brokers communication between the platform and agent runners on user machines.

### Architecture
- **WebSocket Server** (port 3002): Accepts connections from agent runners
- **Machine Registry**: Tracks connected machines, their capabilities, and load
- **Redis Pub/Sub** (optional): Enables horizontal scaling across multiple relay instances

### Key Files
- `server/lib/relay-server.ts` — WebSocket server, message routing, heartbeat
- `server/lib/machine-registry.ts` — In-memory registry of connected machines
- `server/lib/redis-pubsub.ts` — Cross-instance communication via Redis
- `server/routes/relay.ts` — HTTP API for machine/task management
- `server/types/relay.ts` — Protocol types and message definitions

### Environment Variables
- `RELAY_PORT` — WebSocket server port (default: 3002)
- `REDIS_URL` — Redis connection URL for horizontal scaling across multiple relay instances (not needed for local dev)
- `RELAY_JWT_SECRET` — JWT secret for machine authentication (not needed for local dev)

### HTTP API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/relay/health` | Health check |
| GET | `/api/relay/status` | Detailed relay status |
| GET | `/api/relay/machines` | List connected machines |
| GET | `/api/relay/machines/:id` | Get specific machine |
| POST | `/api/relay/dispatch` | Dispatch task to agent runner |
| POST | `/api/relay/cancel` | Cancel running task |
| GET | `/api/relay/best-machine` | Find optimal machine for task |

### WebSocket Protocol
Messages use JSON with a `type` field. Key message types:
- `machine.register` / `machine.register.ack` — Machine registration
- `machine.status` / `provider.status` — Status updates
- `task.dispatch` / `task.cancel` — Task management
- `task.result` / `task.stdout` / `task.progress` — Task output
- `heartbeat.ping` / `heartbeat.pong` — Connection health (30s interval)

### Device Authentication API
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/device/authorize` | Request device code |
| POST | `/api/device/token` | Poll/exchange for tokens |
| POST | `/api/device/register` | Register authenticated machine |
| POST | `/api/device/refresh` | Refresh tokens |
| POST | `/api/device/revoke` | Revoke tokens |
| GET | `/api/device/machines` | List registered machines |
| DELETE | `/api/device/machines/:id` | Revoke machine |

### Testing
```bash
# Relay integration tests are in tests/relay-server-integration.test.ts (vitest, auto-skips without running server)
npm test

# For manual relay testing, start server first
npm run dev:backend
```

## Deployment & Infrastructure

### Domains
| Service | URL | Target |
|---------|-----|--------|
| Frontend | `https://astro.fuxialexander.work` | Vite dev (tunnel) or Cloudflare Pages (prod) |
| Backend API | `https://astro-api.fuxialexander.work` | Hono server (port 3001) |
| WebSocket Relay | `https://astro-relay.fuxialexander.work` | Relay server (port 3002) |
| Supabase | `https://astro-supabase.fuxialexander.work` | Local Supabase (port 54321) |
| Landing Page | `https://astro.fuxialexander.work/landing/` | Static HTML in `public/landing/` |

### Cloudflare Tunnel (Development)
- Tunnel name: `astro`
- Script: `scripts/start-tunnel.sh` — creates tunnel, DNS routes, writes `~/.cloudflared/config.yml`, updates `.env.local`
- Routes all `astro.*` subdomains to local ports
- Run `npm run dev` first, then `bash scripts/start-tunnel.sh` in another terminal

### Production Deployment
- **Frontend**: `npm run deploy:frontend` → Cloudflare Pages project `astro-app`
- **Backend**: `npm run deploy:backend` → Fly.io app `astro-backend`
- SSE connections bypass Cloudflare (direct Fly.io) to avoid timeout issues

### Environment Variables (ASTRO_* prefix)
Agent-runner and MCP tools use `ASTRO_*` prefixed env vars:
- `ASTRO_SERVER_URL`, `ASTRO_AUTH_TOKEN`, `ASTRO_EXECUTION_ID`
- `ASTRO_PROJECT_ID`, `ASTRO_BASE_URL`, `ASTRO_RELAY_URL`
- `ASTRO_MACHINE_NAME`, `ASTRO_LOG_LEVEL`, `ASTRO_TASK_ID`, `ASTRO_NODE_ID`

### Data Directory
Agent runners store data in `~/.astro/`:
- `~/.astro/astro.db` — SQLite database (drizzle)
- `~/.astro/logs/` — Audit logs (JSONL)
- `~/.astro/config.json` — Agent runner config

### Package Names
- Root: `astro` (package.json)
- Agent runner: `@astro/agent` (packages/agent-runner)
- CLI binary: `astro-agent`

## Documentation

**When adding or updating documentation, follow these principles:**
- **Centralize in `docs/`** — All documentation lives under `docs/` in topic subdirectories (backend/, frontend/, relay/, setup/, features/, mcp/, integrations/, testing/). Never place docs at the repo root.
- **Lowercase kebab-case filenames** — Use `kebab-case.md` for all doc files (e.g., `api-reference.md`, `state-management.md`). Exception: `docs/design/` uses UPPER_CASE.md as canonical design references.
- **Cross-check with design docs** — Before adding new technical docs, check `docs/design/` for existing coverage and `docs/design/CURRENT_CONFLICT_VIEW.md` for known discrepancies. New docs should not contradict design docs; if reality differs, update the conflict view.

**Main Index:** `docs/index.md` — Complete documentation index

### Design Documents (Canonical Reference)
- `docs/design/` — Authoritative design documents (ARCHITECTURE, BACKEND, FRONTEND, RELAY, AGENT_RUNNER, DATA_MODEL, USER_WORKFLOWS)
- `docs/design/CURRENT_CONFLICT_VIEW.md` — Known conflicts between design docs and code

### Quick Links

**Backend:**
- `docs/backend/database-schema.md` — Database schema reference
- `docs/backend/api-reference.md` — API endpoints
- `docs/backend/rls-policies.md` — Row-level security policies
- `docs/backend/data-flows.md` — Data flows
- `docs/backend/authentication.md` — WebAuthn/passkey implementation
- `docs/backend/device-authorization.md` — OAuth2 device code flow
- `docs/backend/observability-and-safety.md` — Logging, metrics, safety

**Frontend:**
- `docs/frontend/page-structure.md` — Pages and routes
- `docs/frontend/component-architecture.md` — UI component organization
- `docs/frontend/state-management.md` — Zustand stores
- `docs/frontend/plan-graph.md` — React Flow graph visualization

**Relay Server:**
- `docs/relay/overview.md` — WebSocket hub architecture
- `docs/relay/protocol.md` — Message protocol specification
- `docs/relay/workspace-preparation.md` — Git worktree management

**Setup & Deployment:**
- `docs/setup/developer-setup.md` — Getting started guide
- `docs/setup/local-mode.md` — IndexedDB-only mode
- `docs/setup/server-mode.md` — Supabase multi-user mode
- `docs/setup/environment-variables.md` — Env var reference
- `docs/setup/fly-deployment.md` — Fly.io deployment

**Features:**
- `docs/features/approval-system.md` — Approval system architecture
- `docs/features/activity-feed.md` — Activity tracking
- `docs/features/realtime-sync.md` — Supabase Realtime sync
- `docs/features/plugin-system.md` — Plugin architecture

**MCP & Integrations:**
- `docs/mcp/tools-reference.md` — MCP tools reference (15 tools)
- `docs/mcp/installation.md` — MCP installation
- `docs/integrations/github.md` — GitHub OAuth and API

**Testing:**
- `docs/testing/testing.md` — Testing strategy
- `docs/testing/approval-testing.md` — Approval system tests
- `docs/testing/approval-testing-guide.md` — Approval testing scripts

## MCP Tools for Agents

Agents running inside Astro tasks have access to **15 MCP tools** for self-directed work:

### Plan Management (5 tools)
- `query_plan` - Get plan graph (nodes + edges)
- `create_task` - Create new task
- `update_task` - Update task properties
- `create_dependency` - Create dependency edges
- `delete_task` - Delete task

### Project Management (4 tools)
- `query_projects` - List projects
- `get_project` - Get project details
- `create_project` - Create new project
- `update_project` - Update project

### Initiative Management (3 tools)
- `query_initiatives` - List initiatives
- `create_initiative` - Create new initiative
- `update_initiative` - Update initiative

### Data Access (2 tools)
- `get_user_profile` - Get user context
- `query_executions` - Query execution history

### User Interaction (1 tool)
- `ask_user_question` - Ask user for decisions

See `docs/mcp/tools-reference.md` for complete documentation with examples.
