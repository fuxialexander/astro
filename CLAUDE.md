# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Astro** is a planning-first platform for builders (software developers) and scientists (researchers). It provides an AI-assisted planning layer that sits above execution tools (coding agents, analysis tools) to help users decompose complex goals, manage dependencies across environments, and focus human attention on strategic decisions.

The product vision is documented in `vision.md`. The UI design is in `UI.pen` (read via Pencil MCP tools only, not with `Read` or `Grep`).

**Documentation:** `docs/design/` holds the canonical design docs (ARCHITECTURE, FRONTEND, BACKEND, DATA_MODEL, etc.). `docs/index.md` indexes all docs. `docs/design/CURRENT_CONFLICT_VIEW.md` tracks known gaps between design and code.

## Build & Quality

**After implementing any feature or code change, always run `npm run build` (or equivalent TypeScript compilation check) and fix ALL type errors before considering the task complete. Do not present work as done until it compiles cleanly.**

**After fixing lint errors or making code changes, run `npm run lint` and fix all issues before committing. Never commit code with known lint errors.**

**Workspace packages (`@astro/core`, `@astroanywhere/cli`) are linked via pnpm workspaces. If the backend throws `ERR_MODULE_NOT_FOUND: Cannot find package '@astro/core'` (or similar), run `pnpm install` to re-link the workspace symlinks. This is the fix every time — do not look elsewhere.**

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
npm run db:push          # Push pending Supabase migrations to production
npm run db:push:dry-run  # Preview pending migrations (safe, read-only)
npm run db:status        # Show local vs remote migration history
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

### Architecture Principles

**Server must remain stateless.** Never store per-request or per-session state on the server. All state lives in the database (Drizzle ORM / Postgres or PGlite) or Redis (for multi-instance coordination). Fly.io runs 2 backend instances with round-robin HTTP — state on Instance A is invisible to Instance B.

| Anti-pattern | Problem | Correct Alternative |
|-------------|---------|-------------------|
| `const userSessions = new Map()` | Lost on restart, invisible to other instance | Store in DB or Redis |
| `let currentTask = ...` at module scope | Shared across all requests on one instance | Read from DB per-request |
| In-memory cache without TTL or Redis | Grows unbounded, stale across instances | Use Redis with TTL, or DB query |
| Global variable tracking "who is logged in" | Meaningless with round-robin | Auth token in request header |

**Exception:** `machineRegistry` stores live WebSocket handles — these are inherently per-process. The authoritative machine data lives in Redis (`relay:machines` hash) and the database (`registered_machines` table).

**Frontend derives UI state from the DB as single source of truth.** Do not use in-memory React state to encode information that already exists in the store/DB (e.g., "did we just start this?"). Instead, derive decisions from observable store fields (execution status, plan nodes, etc.) that are backed by the database. Transient UI-only state (modal open/close, input text) is fine, but anything that affects routing or data decisions must be derived from store state, not from which button was clicked.

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
2. Project creation via dashboard inbox → navigates to project plan view → triggers AI generation via SSE
3. Backend streams Claude Agent SDK output as Server-Sent Events; events persisted to `streaming_events` table via `StreamingEventLog`
4. Plan nodes/edges stored in Zustand → rendered in React Flow graph
5. AI generates `startDate`/`endDate` for each plan node; timeline uses topological sort fallback for legacy data
6. All state persisted via `dataClient` → `POST /api/data/*` → Drizzle ORM (PGlite local / Postgres server)
7. On page refresh: `useStreamEvents` hydrates activity from `streaming_events` table via `streaming-event-hydrator.ts` → same UI as live streaming

### Lazy Loading Discipline

Only load the data that the current view needs. Large fields are deferred until the user navigates to a specific project.

| Phase | When | What loads | What is excluded |
|-------|------|-----------|-----------------|
| **Slim global** | App startup | All projects, plan nodes (metadata), executions (metadata) | `content`, `executionOutput`, `streamText` |
| **Full per-project** | User opens a project | Full plan nodes + full executions for that project | Nothing |

If you add a new column to `plan_nodes` or `task_executions` that could hold large text/JSON:
- Add it to the slim exclusion in `server/routes/data.ts` (`slim ? null : newField`)
- Ensure it's included in the per-project endpoint
- Handle `null` gracefully in the frontend (slim load returns null for excluded fields)
- Add it to `useProjectData()` merge logic if needed

### Provider & Dispatch System
- **Provider adapters** live in `packages/agent-runner/src/providers/` (base adapter, SLURM adapter)
- **Dispatch engine** (`server/lib/dispatch/`) routes tasks through a queue → machine selection → execution → result routing
- **Dispatch logic shared** via `packages/core/src/dispatch/` (types, context assembly, result routing, branch management, payload construction)
- **Context assembler** injects vision doc + dependency context into each task
- **Streaming events (execution)**: `init`, `session_init`, `text`, `tool_use`, `tool_result`, `file_change`, `progress`, `result`, `error`, `aborted`, `heartbeat`, `done`
- **Streaming events (chat)**: `text`, `tool_use`, `tool_result`, `session_init`, `plan_result`, `done`, `error`, `aborted`, `heartbeat`
- **Streaming event persistence**: All events persisted to `streaming_events` table (append-only, seq-based). On page refresh, `useStreamEvents` hydrates from DB via `streaming-event-hydrator.ts`. Catch-up on SSE reconnect via `fetchStreamingEventsCatchUp()`. Stream health monitored by `stream-watcher.ts`.
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
- **Unified Streaming Pipeline**: All SSE events flow through a single pipeline: global SSE bus → `realtime-store` taskStreams → `useStreamEvents` hook. Persisted to `streaming_events` table (append-only, seq-indexed). On page refresh, `streaming-event-hydrator.ts` hydrates from DB; `stream-status.ts` derives status; `stream-watcher.ts` monitors health. `useActivityFeed` merges execution + chat streams with deduplication.
- **Activity Blocks**: Centralized activity rendering system (`activity-blocks.tsx`). `TaskActivityEvent` union type covers text, tool_use, tool_result, file_change, steer, error, chat_user, chat_assistant, approval_request, approval_response, mutation. `groupActivityEvents()` groups into `DisplayBlock[]` for UI.
- **Activity Feed**: Real-time activity tracking system, captures all project/task events
- **Approval System**: Dynamic approvals via Claude SDK's built-in `AskUserQuestion` tool, intercepted by `canUseTool` in the agent-runner adapter, plus procedure-level approvals with SSE notifications
- **Realtime Sync**: Multi-device collaboration via Supabase Realtime with optimistic updates and conflict resolution
- **Agent surface**: Agents mutate Astro state via `astro-cli` (bundled in the workspace, authenticated via `ASTRO_AUTH_TOKEN`/`ASTRO_SERVER_URL`/`ASTRO_EXECUTION_ID` env vars). There is no server-side MCP tool server — commands live in `packages/cli/` (`project`, `plan`, `task`, `playground`, `trace`, `activity`, `search`).
- **Workspace Model**: Claude Code-aligned workspace with `.astro/` agent directory, git worktrees for isolation, configurable delivery modes (`pr`/`push`/`branch`/`copy`/`direct`). See `docs/design/WORKSPACE_V2.md`
- **Teams**: Multi-user team support with invitations, role-based access control, and shared projects
- **Observation/Trace System**: Agent execution visibility via `observation_events` table; `RawObservation`, `TraceTree` types in `src/types/observations.ts`; routes at `/api/observations`
- **Connected Accounts**: Slack, Telegram, GitHub Webhooks, Linear integrations with encrypted credentials; `connected-accounts-store.ts`, routes at `/api/connected-accounts`
- **Machine Instructions**: Team-scoped markdown documents injected into execution context; `machine-instruction-store.ts`, `/api/machine-instructions`
- **Skills System**: OpenClaw skill definitions and collections; `skill-store.ts`, `/api/skills`
- **Community Marketplace**: Shared plans with fork/star/trending; `community-store.ts`, `/api/community`
- **Plugin System**: Browser plugin architecture with sidebar, command, route, and theme contributions; `src/types/plugin.ts`, `plugin-store.ts`
- **GitHub Sync**: Bidirectional issue/PR sync; `GitHubSyncSettings`, `GitHubSyncDirection` in types; `/api/github-sync`, `/api/github-comments`
- **Notifications**: Persistent dismissible notifications (separate from toasts); `notification-store.ts`, `/api/notifications`

## Target Users

1. **Builders** — Software engineers using AI coding agents, need product-level planning above code-level context
2. **Scientists** — Researchers managing branching analyses across computing environments (laptop, HPC, cloud)

## Code Patterns

- Use `cn()` from `@/lib/utils` for Tailwind class merging
- Follow existing shadcn/ui component patterns in `src/components/ui/`
- Zustand stores: use `(s) => s.field` selectors, persist via `dataClient` → `/api/data/*`
- React Flow: define node data type as `type TaskNodeData = Node<{ ... }>`, use `NodeProps<TaskNodeData>`, cast `nodeTypes` to `any`; wrap in `ReactFlowProvider` when using `useReactFlow()` hooks
- Task creation: use `TaskCreationForm` component with `mode="inline"|"popover"|"dialog"`; creates nodes via `usePlanStore.addNode()` + `addEdge()`
- SSE streaming: use `useStreamEvents()` from `use-stream-events.ts` — unified hook for both chat and execution streaming. For merged execution + chat feeds, use `useActivityFeed()`. Chat session management via `useChatSession()`. Auto-scroll via `useAutoScroll()`.
- Activity rendering: use `groupActivityEvents()` from `activity-blocks.tsx` to group `TaskActivityEvent[]` into `DisplayBlock[]`, then render with `activity-block-renderer.tsx` (`TextBlock`, `ToolBlock`, `ToolGroupBlock`, `FileChangeBlock`, etc.)
- Status types: `planned | dispatched | in_progress | auto_verified | awaiting_approval | awaiting_judgment | completed | pruned`
- PlanNode dates: optional `startDate`/`endDate` as ISO `YYYY-MM-DD` strings; AI generates them, timeline assigns defaults via topological sort for legacy nodes
- PlanNode execution fields: `executionId`, `executionOutput`, `executionError`, `executionStartedAt`, `executionCompletedAt`
- PlanNode list fields: `dueDate` (ISO YYYY-MM-DD), `estimate` (XS/S/M/L/XL), `milestoneId`
- Display settings: `DisplayPopover` component with `DisplayPopoverConfig` for per-view groupBy/orderBy/properties
- Usage tracking: `useUsageStore` accumulates session metrics (cost, tokens, task counts) from execution results
- Types include: `TaskExecution` (fields: `status`, `userId`, `deliveryStatus`, `deliveryError`, `computeBackend`, `summary`, `subroutineProgress`, `planTodos`, `planQuestions`), `ProviderStatus`, `Priority`, `Label`, `UserProfile`, `DomainExpertise`, `UsageMetrics`, `DeliveryMode` (`pr|push|branch|copy|direct`), `WorktreeStrategy` (`copy|reference|direct`), `SessionStatus`, `ConnectedAccount`, `ChannelType`
- There are ~29 Zustand stores; see `docs/frontend/state-management.md` for the full list and patterns

## Package Names
- Root: `astro` (package.json)
- Core: `@astro/core` (packages/core) — shared DB schema, types, dispatch logic, prompt templates
- CLI: `@astroanywhere/cli` (packages/cli) — CLI + TUI for managing projects/plans/tasks (binary: `astro-cli`)
- Agent runner: `@astroanywhere/agent` (packages/agent-runner, git submodule, binary: `astro-agent`)

## Agent Runner Submodule Workflow

`packages/agent-runner/` is a **git submodule** pointing to `github.com/astro-anywhere/astro-agent`. It has its own repository, branches, and PRs. When making changes to agent-runner code:

1. **Work in the standalone repo** — Use your local clone of `github.com/astro-anywhere/astro-agent`. Do NOT edit files in `packages/agent-runner/` directly (they'll be overwritten on submodule update).

2. **Branch from `dev`** — The development branch is `dev`, not `main`. Create a feature branch from it:
   ```bash
   cd /path/to/astro-agent
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
   cd /path/to/astro
   cd packages/agent-runner && git checkout main && git pull && cd ../..
   git add packages/agent-runner
   git commit -m "chore: update agent-runner submodule to latest main"
   ```

**Important:** The astro repo's CI reviews both repos. Agent-runner PRs trigger AI code review via `.github/workflows/ai-review.yml` in the agent-runner repo. Address review comments before merging.

## Feature Flags: Internal Before External

New features must be hidden behind feature flags. Internal teams test first; external users see nothing until the feature is released (GA).

### Three Files to Keep in Sync

| File | Role | Key Export |
|------|------|-----------|
| `server/lib/feature-flags.ts` | Backend check | `hasFeature(teamFlags, flag)` |
| `src/hooks/use-feature-flag.ts` | Frontend hook | `useFeatureFlag(flag)` |
| `scripts/sync-feature-flags.ts` | DB sync script | `INTERNAL_TEAMS`, `INTERNAL_FLAGS` |

Both `feature-flags.ts` and `use-feature-flag.ts` contain a `GLOBAL_DEFAULTS` object. **These must have identical keys and values.**

### Feature Lifecycle

**Adding a new feature:**
- Pick a kebab-case flag name (e.g., `my-feature`)
- Add `'my-feature': false` to `GLOBAL_DEFAULTS` in **both** files
- Add `'my-feature': true` to `INTERNAL_FLAGS` in `scripts/sync-feature-flags.ts`
- Gate frontend: `useFeatureFlag('my-feature')` hook, `<FeatureFlagRoute>` wrapper, or `featureFlag` on sidebar items
- Gate backend: `hasFeature(team?.featureFlags, 'my-feature')` in route handlers
- Deploy, then run `npm run env:prod && npm run flags` to enable for internal teams

**Releasing to everyone (GA):**
- Change `GLOBAL_DEFAULTS` to `true` in **both** files
- Remove from `INTERNAL_FLAGS`
- Run `npm run flags` to clean up, then deploy

**Emergency kill switch:**
- Set `GLOBAL_DEFAULTS` to `false` in **both** files
- Deploy — feature hidden instantly, no DB changes needed

**Commands:**
```bash
npm run flags           # Sync flags to internal teams (writes to DB)
npm run flags:status    # Show all teams and their current flags (read-only)
npm run flags:dry-run   # Preview changes without writing to DB
```

## Guidelines

### Database

**Production Supabase is the source of truth.** The remote Supabase database is the authoritative production schema. Drizzle schema and Supabase migrations must always be kept in sync. When adding or modifying a table, always include the Supabase migration as part of the same commit. Never leave one without the other.

**Four-step schema checklist (all in the same commit):**
1. Edit `packages/core/src/db/schema.ts` — the Drizzle ORM source of truth
2. Export from `server/lib/db/schema.ts` — the re-export shim (50+ files import from here)
3. Run `npx drizzle-kit generate` — generates PGlite migration in `drizzle/` folder
4. Write Supabase migration in `supabase/migrations/YYYYMMDDHHMMSS_description.sql`

**Fifth step — push to production:** After merging to main, push migrations to Supabase:
```bash
npm run db:push            # Push pending migrations to production
npm run db:push:dry-run    # Preview what would be pushed (safe, read-only)
npm run db:status          # Show local vs remote migration history
```

The `db:push` script reads `DATABASE_URL` from `.env.prod`, auto-converts to a direct connection (not the pooler), and runs `supabase db push`. Credentials live in `.env.prod` — never write them to docs, wiki, or commit them to git.

| Common Mistake | What breaks |
|---------------|------------|
| Forgot Supabase migration | Local mode works, production crashes at startup |
| Forgot `db:push` after merge | Code deployed but DB schema is stale — queries fail |
| Forgot re-export shim | `import { myTable } from '../db/schema.js'` returns `undefined` |
| Forgot `drizzle-kit generate` | PGlite (local mode) missing the new table |
| Forgot `IF NOT EXISTS` in migration | Migration fails if run twice (e.g., after rollback + redeploy) |
| Duplicate migration timestamps | `supabase db push` gets confused — use unique YYYYMMDDHHMMSS |
| Applied SQL via Supabase dashboard | Creates orphan migration history — use `npm run db:status` to detect |

**Supabase migration template:**
```sql
CREATE TABLE IF NOT EXISTS my_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'my_table_select') THEN
    CREATE POLICY my_table_select ON my_table
      FOR SELECT USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'my_table_write') THEN
    CREATE POLICY my_table_write ON my_table
      FOR ALL USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
  END IF;
END $$;
```

See [[Database Schema]] wiki page for the full Supabase protocol and troubleshooting guide.

### Debugging
**When debugging issues, investigate the root cause before attempting fixes. Check if setup scripts, cached tokens, or stale state could be the source. Do not iterate through surface-level fixes.**

### UI/Design
**When matching a design reference, ask clarifying questions about visual style (glassmorphism, flat, material weight) BEFORE implementing. Start with a small component to validate the approach.**

### Error Handling
**Never silently fall back to a degraded mode. If an operation is expected to succeed (e.g., worktree creation, auth, external service call), fail fast with a descriptive error rather than swallowing the exception and continuing in a broken state. Errors must be surfaced to the user (via SSE, API response, or UI) — a `console.warn` alone is not sufficient. When cleanup of prior state is needed before an operation (e.g., stale worktrees, temp files), implement a fallback cleanup path (e.g., force-remove + prune) rather than wrapping the whole block in `catch {}`. Prefer throwing descriptive errors over returning `null` from functions that the caller expects to succeed.**

### Backend Non-Negotiable Rules

| Rule | Why |
|------|-----|
| Server never touches filesystem directly | All FS goes through relay to agent runners; no filesystem on Fly.io |
| All routes use `requireAuth` middleware | Prevents unauthorized data access |
| Never silently swallow errors | Users need to know what went wrong |
| CORS allows only `https://astroanywhere.com` | Security boundary |

**Redis and Multi-Instance Awareness:**
- `REDIS_URL` is required in production (cross-instance features break without it)
- `MACHINE_INSTANCE` TTL = 5 minutes, refreshed every 30s by heartbeat
- `relay:machines` hash has no TTL — ghost entries persist until startup cleanup
- `_fromProxy` flag on responses prevents infinite Redis echo loops — never remove this check
- If you add new streaming event types, add them to the persistence pipeline too

### Deploy Protocol

```bash
# Pre-deploy (all must pass)
npm run lint && npm run build && npm test

# Deploy
npm run deploy           # Both backend + frontend
npm run deploy:backend   # Fly.io only
npm run deploy:frontend  # Cloudflare Pages only

# Post-deploy verification
curl -s https://api.astroanywhere.com/api/health | jq .
fly status --app astro-backend-deploy
fly logs --app astro-backend-deploy | head -50
```

| Common Deploy Issue | Fix |
|-------------------|-----|
| `--frozen-lockfile` fails | Run `pnpm install` and commit the lockfile |
| Docker build fails | Run `npm run build` locally first |
| Health check fails after deploy | Check `fly logs` for the error |
| Frontend shows old code | Wait 1-2 min or purge Cloudflare cache |

### Planning
**When referencing existing codebases or config paths for integration plans, verify the actual paths and file structure by reading the filesystem first. Do not assume paths like ~/.cyrus/ — check what actually exists.**

### Documentation
**When adding or updating documentation, follow these principles:**
- **Centralize in `docs/`** — All documentation lives under `docs/` in topic subdirectories. Never place docs at the repo root.
- **Lowercase kebab-case filenames** — Exception: `docs/design/` uses UPPER_CASE.md as canonical design references.
- **Cross-check with design docs** — Before adding new technical docs, check `docs/design/` for existing coverage and `docs/design/CURRENT_CONFLICT_VIEW.md` for known discrepancies.

### Pull Requests
**NEVER push directly to `main`. Always create a feature branch and open a PR. This applies to ALL changes, including bug fixes.**

**Before creating a PR, always run all CI checks locally (lint, build, tests) and fix any failures. This means running `npm run lint`, `npm run build`, and `npm test` — all must pass. The only CI job that cannot be run locally is the AI code review agent; everything else must be green before opening a PR.**

**Before creating a PR, always run a round of code review using a subagent. Fix any issues and build errors before submitting the PR.**

**After creating a PR, run `/pr-shepherd <PR number>` to review and validate it.** This skill acts as a local GitHub Action — it runs code review (security, data integrity, Astro-specific principles), build, lint, and tests, then auto-fixes Critical and Important issues and pushes until CI passes.

**Branch naming:**

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/short-description` | `feat/loop-nodes` |
| Bug fix | `fix/short-description` | `fix/ghost-machine-timeout` |
| Docs | `docs/short-description` | `docs/multi-instance-relay` |
| Chore | `chore/short-description` | `chore/update-dependencies` |

**Lockfile rule:** When changing dependencies in `package.json`, always run `pnpm install` and commit the updated `pnpm-lock.yaml`. The Fly.io deploy uses `--frozen-lockfile` and will fail if specifiers are out of sync.

**Submodule rules for `packages/agent-runner`:**
- If there are no explicit changes to agent-runner, never include it in your PR. Unstage it (`git restore --staged packages/agent-runner`) to avoid submodule pointer issues.
- If all changes are exclusively in agent-runner, do not PR to this main repo. Instead, create the PR in the agent-runner repo (`github.com/astro-anywhere/astro-agent`).

## Quick Reference: Warning Signs

| Symptom | Likely Cause | First Check |
|---------|-------------|-------------|
| Directory browser shows spinner | Ghost machines in Redis | `curl api/health` — are machines connected? |
| Page takes 10+ seconds to load | Large field loaded globally (not slim) | Network tab: check `/api/data/plan?slim=1` size |
| Feature visible to external users | Flag default set to `true` prematurely | Check `GLOBAL_DEFAULTS` in both feature-flags files |
| New table missing in production | Forgot Supabase migration | Check `supabase/migrations/` for the table |
| Import returns `undefined` for a table | Forgot re-export in `server/lib/db/schema.ts` | Add the export to the shim file |
| 401 errors on new API route | Missing `requireAuth` middleware | Add `route.use('/*', requireAuth)` |
| CORS error in browser | Wrong origin or missing CORS config | Check `CORS_ORIGIN` in Fly.io secrets |
| Deploy fails with lockfile error | `pnpm-lock.yaml` not committed | Run `pnpm install`, commit lockfile |
| Machines disconnect after 5 minutes | `MACHINE_INSTANCE` TTL not refreshing | Check `fly logs` for heartbeat errors |
| Infinite log spam with same correlationId | Missing `_fromProxy` guard | Check `server/index.ts` proxy response handler |
| SSE events lost on page refresh | Streaming events not persisted to DB | Check `streaming-event-log.ts` flush logic |
| Data from wrong user appears | Missing team/user filter in DB query | Check query has `WHERE team_id = ...` |

## Key Files

| File | Role |
|------|------|
| `packages/core/src/db/schema.ts` | Database schema source of truth (Drizzle ORM) |
| `server/lib/db/schema.ts` | Re-export shim for backward compatibility |
| `server/lib/feature-flags.ts` | Backend feature flag check (`hasFeature()`) |
| `src/hooks/use-feature-flag.ts` | Frontend feature flag hook (`useFeatureFlag()`) |
| `scripts/sync-feature-flags.ts` | Sync flags to internal teams (`npm run flags`) |
| `server/lib/relay-server.ts` | WebSocket relay, heartbeat, `isMachineReachable()` |
| `server/lib/redis-pubsub.ts` | Redis adapter for cross-instance coordination |
| `server/lib/machine-registry.ts` | In-memory machine registry (WebSocket handles) |
| `server/routes/data.ts` | Data API with slim mode (`?slim=1`) |
| `src/hooks/use-project-data.ts` | Per-project full data loading hook |
| `fly.toml` | Fly.io deployment config (2 instances, ports) |
| `supabase/migrations/` | Production database migrations |
| `drizzle/` | PGlite (local mode) auto-generated migrations |
