# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Nexus** is a planning-first platform for builders (software developers) and scientists (researchers). It provides an AI-assisted planning layer that sits above execution tools (coding agents, analysis tools) to help users decompose complex goals, manage dependencies across environments, and focus human attention on strategic decisions.

The product vision is documented in `vision.md`. The UI design is in `UI.pen` (read via Pencil MCP tools only, not with `Read` or `Grep`).

## Build & Dev Commands

```bash
npm run dev              # Start frontend (Vite) + backend (Hono) concurrently
npm run dev:frontend     # Vite dev server only (http://localhost:5173)
npm run dev:backend      # Hono API server only (http://localhost:3001)
npm run build            # TypeScript check + Vite production build
npm run lint             # ESLint
npm run deploy           # Build + deploy to Cloudflare Pages
```

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
- **Deployment**: Cloudflare Pages (wrangler)

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
│   ├── dashboard.tsx             # Home: stats, pending decisions, active projects, agent activity
│   ├── projects.tsx              # Project list with table (grouped, sortable columns)
│   ├── project-new.tsx           # New project form + AI plan generation
│   ├── plan-view.tsx             # Plan graph canvas + node detail panel + chat
│   ├── plan-timeline.tsx         # Gantt chart: date-based bars, click-to-edit dialog
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
│   │   └── task-node.tsx         # Custom node component with status styling
│   ├── agent/
│   │   ├── generation-overlay.tsx # Modal overlay during AI plan generation
│   │   └── chat-panel.tsx        # Sidebar chat for plan refinement
│   ├── theme-provider.tsx        # Light/dark/system theme context
│   └── command-palette.tsx       # Cmd+K palette (navigation + theme toggle)
├── stores/
│   ├── project-store.ts          # Projects CRUD, IndexedDB persistence, mock seed data
│   ├── plan-store.ts             # Plan nodes/edges per project, bulk updates
│   ├── agent-store.ts            # AI generation state, SSE streaming, abort
│   ├── ui-store.ts               # Sidebar collapsed, command palette open
│   └── settings-store.ts         # Model selection, backend health, IndexedDB persistence
├── lib/
│   ├── db.ts                     # idb-keyval wrapper for IndexedDB
│   ├── api-client.ts             # HTTP + SSE client for /api/agent/* endpoints
│   └── utils.ts                  # cn() = clsx + tailwind-merge
└── types/
    └── index.ts                  # Project, PlanNode (with startDate/endDate), PlanEdge

server/
├── index.ts                      # Hono server setup, CORS, port 3001
├── routes/
│   ├── health.ts                 # GET /api/health (Claude SDK auth check)
│   └── agent.ts                  # POST /api/agent/generate-plan, /chat, /abort (SSE streaming)
└── lib/
    ├── session-manager.ts        # In-memory AbortController map for agent sessions
    └── prompt-templates.ts       # System prompts + JSON schema for plan generation (includes date scheduling)
```

### Routes
| Path | Page | Status |
|------|------|--------|
| `/` | Dashboard | Implemented (hardcoded agent activity) |
| `/projects` | Projects list | Implemented (list view only, board/filter stubs) |
| `/projects/new` | New Project | Implemented (AI plan generation works) |
| `/project/:id` | Plan View | Implemented (graph + detail panel + chat) |
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

### Design Tokens
- **Primary**: `#FF8400` (orange)
- **Fonts**: JetBrains Mono (primary/mono), Geist (secondary/sans)
- **Status colors**: Green (success), Blue (info), Amber (warning), Red (destructive)
- **CSS variables**: Defined in `globals.css` with `:root` (light) and `.dark` overrides

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

## File Reference

- `vision.md` — Full product vision document (confidential, Feb 2026 draft)
- `UI.pen` — UI/UX designs (access via Pencil MCP tools). Key frames: Dashboard (`Wmtsn`), Plan View (`CwRu4`), Projects (`l7PjP`), Projects Board (`5kGZp`), Projects List (`ZOHAE`), Projects Timeline (`WhG7c`), Issues List (`YORRp`), Issues Board (`bvmJz`), Judgment Queue (`slkwB`), Settings (`OrOgy`)
