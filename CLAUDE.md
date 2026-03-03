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
- Mode detection: `isLocalMode()` from `src/lib/app-mode.ts`, `server/lib/app-mode.ts`, or `packages/core/src/app-mode.ts`

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

**Data Layer:** All modes use the same Drizzle ORM schema. The source of truth is `packages/core/src/db/schema.ts`; `server/lib/db/` files are re-export shims that forward to `packages/core/src/db/` for backward compatibility. Frontend stores use `dataClient` (`src/lib/data-client.ts`) which calls `/api/data/*` endpoints — no direct PGlite access from the frontend.

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
- **Database**: PGlite (local mode) or postgres-js (server mode) via Drizzle ORM (source of truth: `packages/core/src/db/`; `server/lib/db/` re-exports for backward compat)
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

### Re-export Shim Pattern
Shared logic (DB schema, dispatch, types, utilities) has been extracted to `packages/core/`. The `server/lib/db/` files are thin re-export shims that forward to `packages/core/src/db/` for backward compatibility. When adding new DB tables or modifying the schema, edit `packages/core/src/db/schema.ts` (the source of truth) and ensure the re-export in `server/lib/db/schema.ts` includes any new exports.

### Project Structure (top-level)
```
src/           # Frontend: pages/, components/, stores/, hooks/, lib/, types/
server/        # Backend: routes/, lib/ (db/, dispatch/, events/, observability/), middleware/
packages/
├── core/      # @astro/core — shared DB schema, types, dispatch logic
├── cli/       # @astroanywhere/cli — CLI + TUI
└── agent-runner/  # Git submodule → github.com/fuxialexander/astro-agent
docs/          # Architecture documentation (see docs/index.md)
public/landing/  # Static landing page HTML
```

Use `Glob` and `Read` to explore the full directory tree as needed.

### Data Flow
1. Stores load from backend on mount via `DataLoader` component (`dataClient.load()` → `GET /api/data/*`). Teams load first (sets X-Team-Id header), then all other stores.
2. Project creation → navigates to plan view → triggers AI generation via SSE
3. Backend streams Claude Agent SDK output as Server-Sent Events; events persisted to `streaming_events` table via `StreamingEventLog`
4. Plan nodes/edges stored in Zustand → rendered in React Flow graph
5. AI generates `startDate`/`endDate` for each plan node; timeline uses topological sort fallback for legacy data
6. All state persisted via `dataClient` → `POST /api/data/*` → Drizzle ORM (PGlite local / Postgres server)
7. On page refresh: `useRestoredExecution` hydrates activity from `streaming_events` table → same UI as live streaming

### Provider & Dispatch System
- **Provider adapters** live in `packages/agent-runner/src/providers/` (base adapter, SLURM adapter)
- **Dispatch engine** (`server/lib/dispatch/`) routes tasks through a queue → machine selection → execution → result routing
- **Dispatch logic shared** via `packages/core/src/dispatch/` (types, context assembly, result routing, branch management, payload construction)
- **Context assembler** injects vision doc + dependency context into each task
- **Streaming events (execution)**: `init`, `session_init`, `text`, `tool_use`, `tool_result`, `file_change`, `progress`, `result`, `error`, `aborted`, `heartbeat`, `done`
- **Streaming events (chat)**: `text`, `tool_use`, `tool_result`, `session_init`, `plan_result`, `done`, `error`, `aborted`, `heartbeat`
- **Streaming event persistence**: All events persisted to `streaming_events` table (append-only, seq-based). On page refresh, `useRestoredExecution` hydrates from DB via `streaming-event-hydrator.ts`. Catch-up on SSE reconnect via `fetchStreamingEventsCatchUp()`.
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
- **Streaming Event Persistence**: All SSE events persisted to `streaming_events` table (append-only, seq-indexed). Enables page-refresh recovery via hydration (`streaming-event-hydrator.ts`) and SSE reconnect catch-up (`fetchStreamingEventsCatchUp`). Three-layer architecture: live SSE → `streaming_events` DB → observation fallback.
- **Activity Blocks**: Centralized activity rendering system (`activity-blocks.tsx`). `TaskActivityEvent` union type covers text, tool_use, tool_result, file_change, steer, error, chat_user, chat_assistant, approval_request, approval_response, mutation. `groupActivityEvents()` groups into `DisplayBlock[]` for UI.
- **Activity Feed**: Real-time activity tracking system, captures all project/task events
- **Approval System**: Dynamic tool-based approvals (`ask_user_question`) + procedure-level approvals with SSE notifications
- **Realtime Sync**: Multi-device collaboration via Supabase Realtime with optimistic updates and conflict resolution
- **MCP Integration**: Custom MCP server (`server/lib/mcp/astro-tools-server.ts`) provides `ask_user_question` tool for dynamic agent approvals. See `docs/mcp/tools-reference.md` for all 15 MCP tools.
- **Workspace Model**: Claude Code-aligned workspace with `.astro/` agent directory, git worktrees for isolation, configurable delivery modes (`pr`/`push`/`branch`/`copy`/`direct`). See `docs/design/WORKSPACE_V2.md`
- **Teams**: Multi-user team support with invitations, role-based access control, and shared projects

## Target Users

1. **Builders** — Software engineers using AI coding agents, need product-level planning above code-level context
2. **Scientists** — Researchers managing branching analyses across computing environments (laptop, HPC, cloud)

## Code Patterns

- Use `cn()` from `@/lib/utils` for Tailwind class merging
- Follow existing shadcn/ui component patterns in `src/components/ui/`
- Zustand stores: use `(s) => s.field` selectors, persist via `dataClient` → `/api/data/*`
- React Flow: define node data type as `type TaskNodeData = Node<{ ... }>`, use `NodeProps<TaskNodeData>`, cast `nodeTypes` to `any`; wrap in `ReactFlowProvider` when using `useReactFlow()` hooks
- Task creation: use `TaskCreationForm` component with `mode="inline"|"popover"|"dialog"`; creates nodes via `usePlanStore.addNode()` + `addEdge()`
- SSE streaming: use `parseChatSSE()` or `parseExecutionSSE()` from `sse-parser.ts` (type-safe wrappers around `parseSSEStream`)
- Activity rendering: use `groupActivityEvents()` from `activity-blocks.tsx` to group `TaskActivityEvent[]` into `DisplayBlock[]`, then render with `TextBlock`, `ToolBlock`, `ToolGroupBlock`, `FileChangeBlock`, etc.
- Execution restoration: use `useRestoredExecution()` hook — merges live SSE data with hydrated `streaming_events` for seamless page-refresh recovery
- Status types: `planned | dispatched | in_progress | auto_verified | awaiting_approval | awaiting_judgment | completed | pruned`
- PlanNode dates: optional `startDate`/`endDate` as ISO `YYYY-MM-DD` strings; AI generates them, timeline assigns defaults via topological sort for legacy nodes
- PlanNode execution fields: `executionId`, `executionOutput`, `executionError`, `executionStartedAt`, `executionCompletedAt`
- PlanNode list fields: `dueDate` (ISO YYYY-MM-DD), `estimate` (XS/S/M/L/XL), `milestoneId`
- Display settings: `DisplayPopover` component with `DisplayPopoverConfig` for per-view groupBy/orderBy/properties
- Usage tracking: `useUsageStore` accumulates session metrics (cost, tokens, task counts) from execution results
- Types include: `TaskExecution`, `ProviderStatus`, `Priority`, `Label`, `UserProfile`, `DomainExpertise`, `UsageMetrics`

## Package Names
- Root: `astro` (package.json)
- Core: `@astro/core` (packages/core) — shared DB schema, types, dispatch logic, prompt templates
- CLI: `@astroanywhere/cli` (packages/cli) — CLI + TUI for managing projects/plans/tasks (binary: `astro-cli`)
- Agent runner: `@astroanywhere/agent` (packages/agent-runner, git submodule, binary: `astro-agent`)

## Agent Runner Submodule Workflow

`packages/agent-runner/` is a **git submodule** pointing to `github.com/astro-anywhere/astro-agent`. It has its own repository, branches, and PRs. When making changes to agent-runner code:

1. **Work in the standalone repo** — The local clone is at `/Users/zhuoran_cisco/Documents/agent_tools/astro-agent`. Do NOT edit files in `packages/agent-runner/` directly (they'll be overwritten on submodule update).

2. **Branch from `dev`** — The development branch is `dev`, not `main`. Create a feature branch from it:
   ```bash
   cd /Users/zhuoran_cisco/Documents/agent_tools/astro-agent
   git checkout dev
   git checkout -b fix/my-feature
   ```

3. **Build and test** — Run `npm run build` in the agent-runner repo to verify TypeScript compilation.

4. **PR to `dev`** — Push the branch and create a PR targeting the `dev` branch:
   ```bash
   git push origin fix/my-feature
   gh pr create --base dev --title "fix: description"
   ```

5. **Sync dev → main** — When ready to release, create a separate PR from `dev` → `main` in the agent-runner repo. This is needed so the astro repo's submodule pointer (which tracks `main`) picks up the changes.

6. **Update submodule pointer** — After merging to `main` in the agent-runner repo, update the submodule pointer in the astro repo:
   ```bash
   cd /Users/zhuoran_cisco/Documents/agent_tools/astro
   cd packages/agent-runner && git checkout main && git pull && cd ../..
   git add packages/agent-runner
   git commit -m "chore: update agent-runner submodule to latest main"
   ```

**Important:** The astro repo's CI reviews both repos. Agent-runner PRs trigger AI code review via `.github/workflows/ai-review.yml` in the agent-runner repo. Address review comments before merging.

## Guidelines

### Database
**When implementing database-backed features, always include the Supabase schema migration as part of the initial implementation. Do not wait for the user to ask about database schema changes.**

### Debugging
**When debugging issues, investigate the root cause before attempting fixes. Check if setup scripts, cached tokens, or stale state could be the source. Do not iterate through surface-level fixes.**

### UI/Design
**When matching a design reference, ask clarifying questions about visual style (glassmorphism, flat, material weight) BEFORE implementing. Start with a small component to validate the approach.**

### Error Handling
**Never silently fall back to a degraded mode. If an operation is expected to succeed (e.g., worktree creation, auth, external service call), fail fast with a descriptive error rather than swallowing the exception and continuing in a broken state. Errors must be surfaced to the user (via SSE, API response, or UI) — a `console.warn` alone is not sufficient. When cleanup of prior state is needed before an operation (e.g., stale worktrees, temp files), implement a fallback cleanup path (e.g., force-remove + prune) rather than wrapping the whole block in `catch {}`. Prefer throwing descriptive errors over returning `null` from functions that the caller expects to succeed.**

### Planning
**When referencing existing codebases or config paths for integration plans, verify the actual paths and file structure by reading the filesystem first. Do not assume paths like ~/.cyrus/ — check what actually exists.**

### Documentation
**When adding or updating documentation, follow these principles:**
- **Centralize in `docs/`** — All documentation lives under `docs/` in topic subdirectories. Never place docs at the repo root.
- **Lowercase kebab-case filenames** — Exception: `docs/design/` uses UPPER_CASE.md as canonical design references.
- **Cross-check with design docs** — Before adding new technical docs, check `docs/design/` for existing coverage and `docs/design/CURRENT_CONFLICT_VIEW.md` for known discrepancies.
