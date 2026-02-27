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
npm run dev:local        # Local mode: PGlite, no auth (switches env + starts)
npm run dev:dev          # Dev mode: Supabase + tunnel + everything (switches env + starts)
npm run dev              # Start with current env (no switch)
npm run dev:frontend     # Vite dev server only (http://localhost:5173)
npm run dev:backend      # Hono API server (port 3001) + WebSocket relay (port 3002)
npm run build            # TypeScript check + Vite production build
npm run lint             # ESLint
npm test                 # Vitest (29 test files, integration tests auto-skip without server/API key)
npm run deploy           # Build + deploy to Fly.io + Cloudflare Pages
```

### Operating Modes

Astro has three operating modes:

**Local** — PGlite, no auth, all localhost:
- PGlite (Postgres-in-WASM) runs in the backend process, no Docker or external DB
- No authentication, single-user, perfect for rapid iteration
- Start with: `npm run dev:local`
- Mode detection: `isLocalMode()` from `src/lib/app-mode.ts` or `server/lib/app-mode.ts`

**Dev** — Local Supabase + Cloudflare tunnel:
- Local Supabase (Docker) as the data store
- WebAuthn/passkey auth works via Cloudflare tunnel (HTTPS required for TouchID)
- Multi-user with RLS, real-time collaboration
- Start with: `npm run dev:dev`
- Requires `CLOUDFLARED_DOMAIN` in `.env` and Docker running

**Prod** — Remote Supabase + Fly.io + Cloudflare Pages:
- Remote Supabase/Postgres as the data store
- Fly.io backend, Cloudflare Pages frontend
- Start with: `npm run env:prod && npm run deploy`

**Switching modes (if you prefer manual control):**
```bash
npm run env:init         # One-time: generate .env.local.dev and .env.prod
npm run env:local        # Switch to local (removes .env.local, auto-detects PGlite)
npm run env:dev          # Switch to dev (symlink .env.local → .env.local.dev)
npm run env:prod         # Switch to prod (symlink .env.local → .env.prod)
npm run env:switch       # Show current mode
```

The `dev:local` and `dev:dev` commands switch env automatically before starting. Each mode switch also kills stale processes on ports 5173/3001/3002.

**Data Layer:** All modes use the same Drizzle ORM schema (`server/lib/db/schema.ts`). Frontend stores use `dataClient` (`src/lib/data-client.ts`) which calls `/api/data/*` endpoints — no direct PGlite access from the frontend.

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
- **State**: Zustand 5 stores, persisted via `dataClient` → `/api/data/*` → Drizzle ORM
- **Database**: PGlite (local mode) or postgres-js (server mode) via Drizzle ORM (`server/lib/db/`)
- **Graph**: @xyflow/react for plan graph visualization
- **UI Components**: shadcn/ui pattern (manual Radix primitives, not CLI-installed)
- **Icons**: lucide-react
- **Command Palette**: cmdk
- **Backend**: Hono.js on Node.js (port 3001), proxied via Vite `/api` → localhost:3001
- **AI**: @anthropic-ai/claude-agent-sdk for plan generation + chat
- **MCP**: @modelcontextprotocol/sdk for MCP server integration with 15 self-directed agent tools
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
│   ├── project-new.tsx           # New project form (unified: description + directory detection)
│   ├── project-overview.tsx      # Project details: overview + updates tabs, vision doc dialog
│   ├── plan-view.tsx             # Plan graph canvas + node detail panel + chat (Graph/List/Timeline toggle, mobile-friendly header, decluttered canvas)
│   ├── my-tasks.tsx              # Cross-project task list with filters, grouping, display settings
│   ├── task-detail.tsx           # Task-agent detail: output, tool traces, file changes, steer chat
│   ├── environments.tsx          # Machine/environment management, SLURM cluster display
│   ├── agents.tsx                # Agent management and monitoring
│   ├── initiatives.tsx           # Initiatives/projects grouping
│   ├── workflows.tsx             # Workflow management
│   ├── device-auth.tsx           # Device code OAuth2 authentication flow
│   ├── welcome.tsx               # Multi-step onboarding (user type, domains, repo)
│   ├── login.tsx                 # WebAuthn/passkey login (public route)
│   ├── team-invite.tsx           # Team invitation flow
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
├── stores/                          # All stores persist via dataClient → /api/data/* → Drizzle
│   ├── activity-store.ts         # Activity tracking and history
│   ├── agent-store.ts            # AI generation state, SSE streaming, abort, model size selector
│   ├── api-keys-store.ts         # Encrypted API keys for external services (Web Crypto API)
│   ├── auth-store.ts             # Supabase auth session, user state, WebAuthn/passkey
│   ├── connected-accounts-store.ts # Connected external accounts (Slack, Telegram, GitHub webhooks, Linear)
│   ├── display-settings-store.ts # Per-view display settings (groupBy, orderBy, properties)
│   ├── execution-store.ts        # Task execution state, SSE stream processing, provider/machine management
│   ├── github-store.ts           # GitHub integration: connection, repositories, selections
│   ├── initiative-store.ts       # Initiatives/projects grouping
│   ├── keyboard-nav-store.ts     # Keyboard navigation state (focused item, navigable items)
│   ├── machines-store.ts         # Registered machines (fetch, revoke, rename)
│   ├── observation-store.ts      # Trace observation trees for execution debugging
│   ├── plan-store.ts             # Plan nodes/edges per project, bulk updates
│   ├── plugin-store.ts           # Plugin registry, manifests, contributions
│   ├── project-store.ts          # Projects CRUD
│   ├── realtime-store.ts         # Real-time events: machines, activity feed, task streams
│   ├── session-store.ts          # Unified session store: plan chat, task chat, steer messages, execution sessions
│   ├── settings-store.ts         # Model selection, backend health
│   ├── sidebar-store.ts          # Sidebar navigation items, visibility, ordering
│   ├── skill-store.ts            # OpenClaw skill registry
│   ├── slurm-store.ts            # HPC/Slurm cluster state (clusters, jobs, queue tracking)
│   ├── task-chat-store.ts        # Task-level chat history
│   ├── team-store.ts             # Teams CRUD, team members
│   ├── toast-store.ts            # Toast notification queue (info, success, warning, error)
│   ├── ui-store.ts               # Sidebar collapsed, command palette open
│   ├── usage-store.ts            # Session usage metrics (cost, tokens, task counts)
│   └── user-profile-store.ts     # User identity and preferences (name, email, domains, API keys)
├── lib/
│   ├── api-client.ts             # HTTP + SSE client for /api/agent/* endpoints
│   ├── api-url.ts                # API URL resolution
│   ├── data-client.ts            # Data CRUD client (calls /api/data/* endpoints)
│   ├── realtime-client.ts        # EventSource wrapper for /api/events/stream
│   ├── realtime-sync.ts          # Supabase Realtime sync
│   ├── supabase-client.ts        # Supabase browser client
│   ├── app-mode.ts               # Local vs server mode detection
│   ├── project-source.ts         # ProjectSource resolution, delivery mode derivation
│   ├── dispatch-signing.ts       # Browser-side ECDSA P-256 signing for secure task dispatch
│   ├── constants.ts              # Priority/estimate config, default labels
│   ├── graph-utils.ts            # Graph node position calculation for child placement
│   ├── graph-sort-utils.ts       # Topological sort + dependency graph utilities
│   ├── timeline-utils.ts         # Gantt timeline calculations (topological sort, date assignment)
│   ├── path-utils.ts             # Path manipulation utilities
│   ├── git-url-utils.ts          # Git URL parsing
│   ├── sse-parser.ts             # SSE stream parser
│   ├── sharing/                  # Export/import shared bundles
│   └── utils.ts                  # cn() = clsx + tailwind-merge
└── types/
    └── index.ts                  # Project, PlanNode, PlanEdge, TaskExecution, ProviderStatus, UserProfile, etc.

server/
├── index.ts                      # Hono server setup, CORS, port 3001 + relay init
├── middleware/
│   ├── auth.ts                   # Authentication middleware
│   └── audit.ts                  # Audit logging middleware
├── routes/
│   ├── health.ts                 # GET /api/health (Claude SDK auth check)
│   ├── agent.ts                  # POST /api/agent/generate-plan, /chat, /abort (SSE streaming)
│   ├── auth.ts                   # Authentication endpoints (WebAuthn/passkey)
│   ├── data.ts                   # GET/POST /api/data/* (generic CRUD for all entities)
│   ├── dispatch.ts               # POST /api/dispatch/task, /cancel, /steer, /prune (task execution)
│   ├── events.ts                 # GET /api/events/stream (SSE bridge: relay → browser)
│   ├── relay.ts                  # GET/POST /api/relay/* (machine registry, task dispatch)
│   ├── repo.ts                   # GET/POST /api/repo/* (detect, setup, directory operations)
│   ├── fs.ts                     # File system operations
│   ├── github.ts                 # GitHub integration endpoints
│   ├── teams.ts                  # Team management endpoints
│   ├── notifications.ts          # Notification management
│   ├── connected-accounts.ts     # External account integrations
│   ├── observations.ts           # Trace observation endpoints
│   ├── share.ts                  # Share/export bundles
│   ├── skills.ts                 # Skill registry
│   ├── system.ts                 # System information
│   ├── transcribe.ts             # Audio transcription
│   ├── device-auth.ts            # Device authorization flow (RFC 8628)
│   └── well-known.ts             # OpenID/WebAuthn discovery
├── lib/
│   ├── db/                       # Database abstraction layer
│   │   ├── index.ts              # DB factory (PGlite local / postgres-js server)
│   │   ├── schema.ts             # Drizzle ORM schema (all tables)
│   │   ├── migrate.ts            # Drizzle migration runner
│   │   └── bootstrap-local.ts    # Local mode team/user initialization
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
│   ├── ensure-user-profile.ts    # Self-heal auth.users ↔ user_profiles desync
│   ├── github-client.ts          # GitHub API wrapper
│   ├── email-service.ts          # Email notifications
│   ├── push-notifications.ts     # Push notification service
│   ├── cleanup-scheduler.ts      # Automated cleanup tasks
│   ├── repo-setup.ts             # Repository initialization
│   ├── repo-context.ts           # Repository context assembly
│   ├── git-url-utils.ts          # Git URL parsing
│   ├── events/                   # Distributed event transport
│   │   ├── astro-event-transport.ts # Singleton event bus (SSE, audit, usage hooks)
│   │   ├── types.ts              # Event type definitions
│   │   └── hooks/                # Pluggable event hooks
│   │       ├── audit-log-hook.ts
│   │       ├── sse-notification-hook.ts
│   │       ├── usage-metrics-hook.ts
│   │       ├── channel-notification-hook.ts
│   │       ├── pr-creation-hook.ts
│   │       ├── merge-queue-hook.ts
│   │       └── git-pull-hook.ts
│   ├── channel/                  # Multi-channel notification system
│   │   ├── channel-types.ts
│   │   ├── channel-config-manager.ts
│   │   ├── channel-formatter.ts
│   │   ├── channel-router.ts
│   │   └── webhook-verifier.ts
│   ├── access/                   # Role-based access control
│   │   └── user-access-control.ts
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
│   │   ├── machine-selector.ts   # Select optimal machine for task
│   │   ├── context-assembler.ts  # Assembles execution context (vision doc + dependencies)
│   │   └── result-router.ts      # Routes task results to storage
│   ├── observability/            # Tracing and safety
│   │   ├── observation-collector.ts
│   │   ├── langfuse-exporter.ts  # Export traces to Langfuse
│   │   └── safety-rails.ts       # Safety guardrails
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
└── agent-runner/                 # Git submodule → github.com/fuxialexander/astro-agent

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
| `/projects/new` | New Project | Implemented (unified form: description + directory with inline detection) |
| `/project/:id` | Project Overview | Implemented (overview + updates tabs, vision doc dialog) |
| `/project/:id/plan` | Plan View | Implemented (graph + list + timeline toggle, detail panel + chat, task creation across all views) |
| `/project/:id/task/:nodeId` | Task Detail | Implemented (output, tools, files, steer chat, session activity) |
| `/tasks` | My Tasks | Implemented (cross-project task list with filters, grouping, display settings) |
| `/environments` | Environments | Implemented (machine registration, SLURM clusters, device code flow) |
| `/agents` | Agents | Implemented (agent listing and monitoring) |
| `/initiatives` | Initiatives | Implemented (initiatives/projects grouping) |
| `/workflows` | Workflows | Implemented (workflow management) |
| `/settings` | Settings | Implemented (health check + model selection) |
| `/device` | Device Auth | Implemented (standalone OAuth2 device code flow) |
| `/welcome` | Welcome | Implemented (simplified 2-option onboarding: empty project or repo-based project) |
| `/login` | Login | Implemented (WebAuthn/passkey authentication) |
| `/team/invite/:token` | Team Invite | Implemented (team invitation flow) |
| `/landing/` | Landing Page | Implemented (static HTML, public marketing page) |
| `/landing/about` | Why Astro? | Implemented (static HTML, philosophy/naming page) |
| `/issues` | Issues List | **Not implemented** (designed in UI.pen, no code) |
| `/issues/board` | Issues Board | **Not implemented** (designed in UI.pen, no code) |

### Data Flow
1. Stores load from backend on mount via `DataLoader` component (`dataClient.load()` → `GET /api/data/*`)
2. Project creation → navigates to plan view → triggers AI generation via SSE
3. Backend streams Claude Agent SDK output as Server-Sent Events
4. Plan nodes/edges stored in Zustand → rendered in React Flow graph
5. AI generates `startDate`/`endDate` for each plan node; timeline uses topological sort fallback for legacy data
6. All state persisted via `dataClient` → `POST /api/data/*` → Drizzle ORM (PGlite local / Postgres server)

### Provider & Dispatch System
- **Provider adapters** (Claude Code, Codex, SLURM) implement a common `AgentProvider` interface
- **Dispatch engine** routes tasks through a queue → provider selection → execution → result routing
- **Context assembler** injects vision doc + dependency context into each task
- **Streaming events**: `init`, `session_init`, `text`, `tool_use`, `tool_result`, `structured_output`, `file_change`, `progress`, `result`, `error`, `aborted`, `heartbeat`, `done`
- **Usage metrics**: Execution results include `UsageMetrics` (cost, tokens, model, turns); accumulated in `usage-store` per session
- **Device auth flow**: OAuth2 Device Authorization Grant (RFC 8628) for machine registration

## Key Concepts

- **Plan graph**: Core data model is a directed graph (not a flat list) supporting linear pipelines and branching exploration trees with explicit dependencies. Node dependencies are synced from edge graph on load to ensure consistency across page refreshes.
- **Tiered verification**: Auto-close for verifiable tasks (tests pass, build succeeds), human judgment for strategic/product decisions
- **Multi-environment dispatch**: Tasks run across local machines, HPC clusters (Slurm), and cloud (AWS/GCP)
- **Dispatch signing**: Browser-side ECDSA P-256 signatures (`src/lib/dispatch-signing.ts`) prove dispatch authenticity to agent runners, preventing server compromise attacks. Signatures stored in IndexedDB, verified with timestamp + nonce + machine ID.
- **Vision/context injection**: A persistent document describing product vision or research question is injected into every agent session, above codebase context
- **Branch pruning**: Killing a branch auto-cancels all downstream tasks
- **Agent-agnostic execution**: Wraps existing agents (e.g., Claude Code), does not build custom agents
- **Data flywheel**: Planning traces (decomposition, overrides, pruning decisions, outcomes) improve future plans via context engineering, not model retraining
- **Activity Feed**: Real-time activity tracking system, captures all project/task events
- **Approval System**: Dynamic tool-based approvals (`ask_user_question`) + procedure-level approvals with SSE notifications
- **Realtime Sync**: Multi-device collaboration via Supabase Realtime with optimistic updates and conflict resolution
- **MCP Integration**: Custom MCP server (`astro-tools-server.ts`) provides `ask_user_question` tool for dynamic agent approvals
- **Workspace Model**: Claude Code-aligned workspace with `.astro/` agent directory, git worktrees for isolation, configurable delivery modes (`pr`/`push`/`branch`/`copy`/`direct`). See `docs/design/WORKSPACE_V2.md`
- **Teams**: Multi-user team support with invitations, role-based access control, and shared projects
- **Mobile-first UI**: Plan view header and graph canvas optimized for mobile and touch devices (iPad compatibility with hover-only UI toggles)

## Target Users

1. **Builders** — Software engineers using AI coding agents, need product-level planning above code-level context
2. **Scientists** — Researchers managing branching analyses across computing environments (laptop, HPC, cloud)

## Code Patterns

- Use `cn()` from `@/lib/utils` for Tailwind class merging
- Follow existing shadcn/ui component patterns in `src/components/ui/`
- Zustand stores: use `(s) => s.field` selectors, persist via `dataClient` → `/api/data/*`
- React Flow: define node data type as `type TaskNodeData = Node<{ ... }>`, use `NodeProps<TaskNodeData>`, cast `nodeTypes` to `any`; wrap in `ReactFlowProvider` when using `useReactFlow()` hooks
- Task creation: use `TaskCreationForm` component with `mode="inline"|"popover"|"dialog"`; creates nodes via `usePlanStore.addNode()` + `addEdge()`
- SSE streaming: use `readSSE()` from `api-client.ts` for server-sent events
- Status types: `planned | dispatched | in_progress | auto_verified | awaiting_approval | awaiting_judgment | completed | pruned`
- PlanNode dates: optional `startDate`/`endDate` as ISO `YYYY-MM-DD` strings; AI generates them, timeline assigns defaults via topological sort for legacy nodes
- PlanNode execution fields: `executionId`, `executionOutput`, `executionError`, `executionStartedAt`, `executionCompletedAt`
- PlanNode list fields: `dueDate` (ISO YYYY-MM-DD), `estimate` (XS/S/M/L/XL), `milestoneId`
- **PlanNode dependencies**: Always derive from `planEdges` during store load via `graph-sort-utils.ts` to keep `node.dependencies` in sync after page refresh (server doesn't persist this field)
- Display settings: `DisplayPopover` component with `DisplayPopoverConfig` for per-view groupBy/orderBy/properties
- Usage tracking: `useUsageStore` accumulates session metrics (cost, tokens, task counts) from execution results
- Dispatch signing: Use `dispatch-signing.ts` utilities for browser-side ECDSA signing; signatures prevent replay attacks via timestamp + nonce + machine ID validation
- Model selection: `agent-store.ts` supports model size selector for plan generation (passed to Claude Agent SDK); allows user choice of model capability trade-offs
- Types include: `TaskExecution`, `ProviderStatus`, `Priority`, `Label`, `UserProfile`, `DomainExpertise`, `UsageMetrics`

## Database

**When implementing database-backed features, always include the Supabase schema migration as part of the initial implementation. Do not wait for the user to ask about database schema changes.**

## Debugging

**When debugging issues, investigate the root cause before attempting fixes. Check if setup scripts, cached tokens, or stale state could be the source. Do not iterate through surface-level fixes.**

## UI/Design

**When matching a design reference, ask clarifying questions about visual style (glassmorphism, flat, material weight) BEFORE implementing. Start with a small component to validate the approach.**

**Mobile & Touch Considerations:**
- Plan view optimized for mobile with responsive header (not just desktop)
- Touch devices (iPad, mobile) treat hover-only elements as toggles via `@supports (hover: none)` media query. Use explicit tap targets instead of hover-dependent UI.
- Graph canvas has decluttered mobile-friendly controls that auto-hide unnecessary elements on small screens

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
| Frontend | `https://astro.your-domain.com` | Vite dev (tunnel) or Cloudflare Pages (prod) |
| Backend API | `https://astro-api.your-domain.com` | Hono server (port 3001) |
| WebSocket Relay | `https://astro-relay.your-domain.com` | Relay server (port 3002) |
| Supabase | `https://astro-supabase.your-domain.com` | Local Supabase (port 54321) |
| Landing Page | `https://astro.your-domain.com/landing/` | Static HTML in `public/landing/` |

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
- `~/.astro/pglite/` — PGlite database (Drizzle ORM)
- `~/.astro/logs/` — Audit logs (JSONL)
- `~/.astro/config.json` — Agent runner config

### Package Names
- Root: `astro` (package.json)
- Agent runner: `@astroanywhere/agent` (packages/agent-runner, git submodule)
- CLI binary: `astro-agent`

### Git Submodules
`packages/agent-runner` is a git submodule pointing to `github.com/fuxialexander/astro-agent` (private).

```bash
# Clone with submodules
git clone --recurse-submodules <repo-url>

# Or initialize after clone
git submodule update --init --recursive

# Update submodule to latest
cd packages/agent-runner && git pull origin main && cd ../..
git add packages/agent-runner && git commit -m "chore: update agent-runner submodule"
```

`npm install` at the root automatically runs `npm install` inside the submodule via the `postinstall` script.

## Documentation

**When adding or updating documentation, follow these principles:**
- **Centralize in `docs/`** — All documentation lives under `docs/` in topic subdirectories (backend/, frontend/, relay/, setup/, features/, mcp/, integrations/, testing/). Never place docs at the repo root.
- **Lowercase kebab-case filenames** — Use `kebab-case.md` for all doc files (e.g., `api-reference.md`, `state-management.md`). Exception: `docs/design/` uses UPPER_CASE.md as canonical design references.
- **Cross-check with design docs** — Before adding new technical docs, check `docs/design/` for existing coverage and `docs/design/CURRENT_CONFLICT_VIEW.md` for known discrepancies. New docs should not contradict design docs; if reality differs, update the conflict view.

**Main Index:** `docs/index.md` — Complete documentation index

### Design Documents (Canonical Reference)
- `docs/design/` — Authoritative design documents (ARCHITECTURE, BACKEND, FRONTEND, RELAY, AGENT_RUNNER, DATA_MODEL, USER_WORKFLOWS, WORKSPACE_V2, IMPLEMENTATION_PIPELINE)
- `docs/design/CURRENT_CONFLICT_VIEW.md` — Known conflicts between design docs and code
- `docs/design/AGENT_PERFORMANCE.md` — Agent performance optimization
- `docs/design/ATTENTION_TRIAGE.md` — Attention triage system
- `docs/design/COST_TRACKING.md` — Cost tracking and budgets
- `docs/design/CROSS_PROJECT_REFERENCES.md` — Cross-project reference system
- `docs/design/WORKSPACE_V2.md` — Workspace model (directory detection, worktrees, delivery modes)

### Quick Links

**Backend:**
- `docs/backend/database-schema.md` — Database schema reference
- `docs/backend/api-reference.md` — API endpoints
- `docs/backend/rls-policies.md` — Row-level security policies
- `docs/backend/data-flows.md` — Data flows
- `docs/backend/authentication.md` — WebAuthn/passkey implementation
- `docs/backend/device-authorization.md` — OAuth2 device code flow
- `docs/backend/observability-and-safety.md` — Logging, metrics, safety
- `docs/backend/workspace-v2-data-model.md` — Workspace V2 types, schema, and storage
- `docs/backend/workspace-v2-backend.md` — Workspace V2 API, dispatch, and context assembly

**Frontend:**
- `docs/frontend/page-structure.md` — Pages and routes
- `docs/frontend/component-architecture.md` — UI component organization
- `docs/frontend/state-management.md` — Zustand stores
- `docs/frontend/plan-graph.md` — React Flow graph visualization
- `docs/frontend/workspace-v2-frontend.md` — Workspace V2 store, component, and page changes

**Relay Server:**
- `docs/relay/overview.md` — WebSocket hub architecture
- `docs/relay/protocol.md` — Message protocol specification
- `docs/relay/workspace-v2-relay.md` — Workspace V2 relay and agent runner changes

**Setup & Deployment:**
- `docs/setup/developer-setup.md` — Getting started guide
- `docs/setup/local-mode.md` — PGlite local-only mode
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
