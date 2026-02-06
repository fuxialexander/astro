# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Nexus** is a planning-first platform for builders (software developers) and scientists (researchers). It provides an AI-assisted planning layer that sits above execution tools (coding agents, analysis tools) to help users decompose complex goals, manage dependencies across environments, and focus human attention on strategic decisions.

The product vision is documented in `vision.md`. The UI design is in `UI.pen` (read via Pencil MCP tools only, not with `Read` or `Grep`).

## Build & Dev Commands

```bash
npm run dev              # Start frontend (Vite) + backend (Hono + relay) concurrently
npm run dev:frontend     # Vite dev server only (http://localhost:5173)
npm run dev:backend      # Hono API server (port 3001) + WebSocket relay (port 3002)
npm run build            # TypeScript check + Vite production build
npm run lint             # ESLint
npm run deploy           # Build + deploy to Cloudflare Pages
```

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
- **Deployment**: Cloudflare Pages (frontend) + Fly.io (backend + relay, production only)

## Architecture

### Path Alias
`@/` maps to `./src/` (configured in both `vite.config.ts` and `tsconfig.app.json`).

### Project Structure
```
src/
├── app.tsx                       # Root: BrowserRouter, DataLoader, routes
├── main.tsx                      # React DOM entry point
├── globals.css                   # Tailwind v4 theme, CSS variables, light/dark tokens
├── pages/
│   ├── dashboard.tsx             # Home: live stats, pending decisions, active projects, agent activity feed
│   ├── projects.tsx              # Project list with table (grouped, sortable columns)
│   ├── project-new.tsx           # New project form + AI plan generation
│   ├── plan-view.tsx             # Plan graph canvas + node detail panel + chat
│   ├── plan-timeline.tsx         # Gantt chart: date-based bars, click-to-edit dialog
│   ├── task-detail.tsx           # Task-agent detail: output, tool traces, file changes, steer chat
│   ├── judgment-queue.tsx        # Queue of tasks awaiting human judgment
│   └── settings.tsx              # Backend connection, model selection
├── components/
│   ├── ui/                       # shadcn/ui Radix primitives (button, input, badge, card, dialog, etc.)
│   ├── layout/
│   │   ├── app-layout.tsx        # Sidebar + <Outlet /> wrapper
│   │   ├── sidebar.tsx           # Nav items, project list, user profile
│   │   └── header.tsx            # Reusable page header
│   ├── plan-graph/
│   │   ├── plan-canvas.tsx       # React Flow wrapper (background, controls, fitView)
│   │   └── task-node.tsx         # Custom node component with status styling + live progress
│   ├── task-detail/
│   │   ├── task-output-view.tsx  # Terminal-style output viewer with search, copy, auto-scroll
│   │   ├── tool-trace-view.tsx   # Vertical timeline of tool calls with collapsible I/O
│   │   ├── file-changes-view.tsx # File change list with diff display
│   │   └── steer-chat.tsx        # Agent steering chat (sends guidance to running agent)
│   ├── agent/
│   │   ├── generation-overlay.tsx # Modal overlay during AI plan generation
│   │   └── chat-panel.tsx        # Sidebar chat for plan refinement
│   ├── theme-provider.tsx        # Light/dark/system theme context
│   └── command-palette.tsx       # Cmd+K palette (navigation + theme toggle)
├── stores/
│   ├── project-store.ts          # Projects CRUD, IndexedDB persistence, mock seed data
│   ├── plan-store.ts             # Plan nodes/edges per project, bulk updates
│   ├── agent-store.ts            # AI generation state, SSE streaming, abort
│   ├── execution-store.ts        # Task execution state, SSE stream processing
│   ├── realtime-store.ts         # Real-time events: machines, activity feed, task streams
│   ├── ui-store.ts               # Sidebar collapsed, command palette open
│   └── settings-store.ts         # Model selection, backend health, IndexedDB persistence
├── lib/
│   ├── db.ts                     # idb-keyval wrapper for IndexedDB
│   ├── api-client.ts             # HTTP + SSE client for /api/agent/* endpoints
│   ├── realtime-client.ts        # EventSource wrapper for /api/events/stream
│   └── utils.ts                  # cn() = clsx + tailwind-merge
└── types/
    └── index.ts                  # Project, PlanNode (with startDate/endDate), PlanEdge

server/
├── index.ts                      # Hono server setup, CORS, port 3001 + relay init
├── routes/
│   ├── health.ts                 # GET /api/health (Claude SDK auth check)
│   ├── agent.ts                  # POST /api/agent/generate-plan, /chat, /abort (SSE streaming)
│   ├── dispatch.ts               # POST /api/dispatch/task, /cancel, /steer, /prune (task execution)
│   ├── events.ts                 # GET /api/events/stream (SSE bridge: relay → browser)
│   └── relay.ts                  # GET/POST /api/relay/* (machine registry, task dispatch)
├── lib/
│   ├── session-manager.ts        # In-memory AbortController map for agent sessions
│   ├── prompt-templates.ts       # System prompts + JSON schema for plan generation
│   ├── relay-server.ts           # WebSocket relay server for agent runner communication
│   ├── machine-registry.ts       # Live machine registry with connection tracking
│   ├── event-buffer.ts           # Ring buffer for SSE reconnection replay (Last-Event-ID)
│   ├── stdout-throttle.ts        # Batches stdout chunks per task (100ms flush)
│   └── redis-pubsub.ts           # Redis pub/sub for horizontal scaling
├── types/
│   └── relay.ts                  # WebSocket protocol types for relay communication
└── test/
    └── relay-server.test.ts      # Integration tests for relay server
```

### Routes
| Path | Page | Status |
|------|------|--------|
| `/` | Dashboard | Implemented (hardcoded agent activity) |
| `/projects` | Projects list | Implemented (list view only, board/filter stubs) |
| `/projects/new` | New Project | Implemented (AI plan generation works) |
| `/project/:id` | Plan View | Implemented (graph + detail panel + chat) |
| `/project/:id/task/:nodeId` | Task Detail | Implemented (output, tools, files, steer chat) |
| `/project/:id/timeline` | Timeline | Implemented (date-based Gantt, click-to-edit dialog) |
| `/judgment` | Judgment Queue | Implemented (UI only, actions not wired) |
| `/settings` | Settings | Implemented (health check + model selection) |
| `/environments` | Environments | **Not implemented** (sidebar link exists, no route) |
| `/issues` | Issues List | **Not implemented** (designed in UI.pen, no code) |
| `/issues/board` | Issues Board | **Not implemented** (designed in UI.pen, no code) |

### Data Flow
1. Stores load from IndexedDB on mount via `DataLoader` component
2. Project creation → navigates to plan view → triggers AI generation via SSE
3. Backend streams Claude Agent SDK output as Server-Sent Events
4. Plan nodes/edges stored in Zustand → rendered in React Flow graph
5. AI generates `startDate`/`endDate` for each plan node; timeline uses topological sort fallback for legacy data
6. All state persisted to IndexedDB on change

## Key Concepts

- **Plan graph**: Core data model is a directed graph (not a flat list) supporting linear pipelines and branching exploration trees with explicit dependencies
- **Tiered verification**: Auto-close for verifiable tasks (tests pass, build succeeds), human judgment for strategic/product decisions
- **Multi-environment dispatch**: Tasks run across local machines, HPC clusters (Slurm), and cloud (AWS/GCP)
- **Vision/context injection**: A persistent document describing product vision or research question is injected into every agent session, above codebase context
- **Branch pruning**: Killing a branch auto-cancels all downstream tasks
- **Agent-agnostic execution**: Wraps existing agents (e.g., Claude Code), does not build custom agents
- **Data flywheel**: Planning traces (decomposition, overrides, pruning decisions, outcomes) improve future plans via context engineering, not model retraining

## Target Users

1. **Builders** — Software engineers using AI coding agents, need product-level planning above code-level context
2. **Scientists** — Researchers managing branching analyses across computing environments (laptop, HPC, cloud)

## Code Patterns

- Use `cn()` from `@/lib/utils` for Tailwind class merging
- Follow existing shadcn/ui component patterns in `src/components/ui/`
- Zustand stores: use `(s) => s.field` selectors, persist via `idb-keyval`
- React Flow: define node data type as `type TaskNodeData = Node<{ ... }>`, use `NodeProps<TaskNodeData>`, cast `nodeTypes` to `any`
- SSE streaming: use `readSSE()` from `api-client.ts` for server-sent events
- Status types: `planned | dispatched | in_progress | auto_verified | awaiting_judgment | completed | pruned`
- PlanNode dates: optional `startDate`/`endDate` as ISO `YYYY-MM-DD` strings; AI generates them, timeline assigns defaults via topological sort for legacy nodes

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

### Testing
```bash
# Start server
npm run dev:backend

# Run integration tests
npx tsx server/test/relay-server.test.ts
```

## File Reference

- `vision.md` — Full product vision document (confidential, Feb 2026 draft)
- `server/types/relay.ts` — Relay server protocol documentation (see type definitions)
