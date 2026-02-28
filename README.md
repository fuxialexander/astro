# Astro

> A planning-first platform for builders and scientists — AI-assisted task decomposition, multi-environment execution, and real-time progress tracking.

Astro sits above execution tools (coding agents, analysis tools) to help users decompose complex goals into dependency graphs, dispatch tasks across environments (local, HPC, cloud), and focus human attention on strategic decisions.

## Architecture

Astro has four components. The server never calls AI directly — all AI work flows through the relay to agent runners.

```
                     BROWSER                          SERVER (Hono + Relay)
              ┌────────────────────┐          ┌──────────────────────────────┐
              │                    │          │                              │
              │  React 19 SPA      │  HTTP/   │  Hono API Server (:3001)    │
              │  Zustand stores    │  SSE     │  ┌────────────────────────┐ │
              │  React Flow graph  │ ◄──────► │  │ /api/agent/*           │ │
              │                    │          │  │ /api/dispatch/*        │ │
              │  No AI. No DB.     │          │  │ /api/data/*            │ │
              │  Pure UI.          │          │  │ /api/events/stream     │ │
              │                    │          │  └─────────┬──────────────┘ │
              └────────────────────┘          │            │                │
                                              │  ┌─────────▼──────────────┐ │
                                              │  │ Relay (WS Hub, :3002)  │ │
                                              │  │ Machine Registry       │ │
                                              │  └─────────┬──────────────┘ │
                                              │            │                │
                                              │  Postgres (PGlite local,   │
                                              │   Supabase/RDS server)     │
                                              └────────────┼────────────────┘
                                                           │ WebSocket
                                    ┌──────────────────────┼──────────────────────┐
                                    │                      │                      │
                             ┌──────▼──────┐        ┌──────▼──────┐        ┌──────▼──────┐
                             │ Agent Runner│        │ Agent Runner│        │ Agent Runner│
                             │ (laptop)    │        │ (HPC login) │        │ (cloud VM)  │
                             │             │        │             │        │             │
                             │ Claude SDK  │        │ Claude SDK  │        │ Claude CLI  │
                             │ Git worktree│        │ SLURM       │        │ Docker      │
                             │ PR creation │        │ strategy    │        │ strategy    │
                             └─────────────┘        └─────────────┘        └─────────────┘
```

### What Each Component Does

| Component | Saves | Computes | Does NOT do |
|-----------|-------|----------|-------------|
| **Frontend** (Browser) | Nothing (pure UI) | Renders pages, graphs, chat panels | Call AI, persist data |
| **Backend** (Hono API) | All data (Postgres via Drizzle ORM) | Prompt assembly, dispatch coordination, context injection, SSE broadcasting | Call AI directly |
| **Relay** (WebSocket Hub) | Nothing (in-memory registry) | Task routing, machine selection, heartbeat monitoring | Store data, call AI |
| **Agent Runner** (Worker) | Execution artifacts (worktrees, PRs) | AI execution, git worktrees, safety checks, PR creation | Serve HTTP, store app data |

### Data Flow: Task Execution

```
User clicks "Run"
       │
       ▼
Frontend: POST /api/dispatch/task
       │
       ▼
Backend: Validate → Assemble context (vision doc + deps) → Build prompt
       │
       ▼
Relay: Find best machine → Send task via WebSocket
       │
       ▼
Agent Runner: Safety check → Create worktree → Run AI → Stream results back
       │
       ▼
Relay → Backend: Convert WS events to SSE → Push to browser
       │
       ▼
Agent Runner: Auto-commit → Push branch → Create PR → Cleanup worktree
```

### Data Flow: Plan Generation

```
User creates project with description
       │
       ▼
Frontend: POST /api/agent/generate-plan
       │
       ▼
Backend: Build system prompt (with plan JSON schema) → Dispatch via relay
       │
       ▼
Agent Runner: Run Claude with structured output → Stream plan JSON back
       │
       ▼
Backend: Parse plan JSON → SSE stream to browser
       │
       ▼
Frontend: Render dependency graph in React Flow
```

## Features

### AI-Powered Planning
Decompose complex goals into structured dependency graphs with AI assistance. Astro analyzes your project description and automatically generates a plan with explicit task dependencies, enabling strategic oversight and parallel execution.

### Multi-Environment Execution
Run tasks across local, HPC (SLURM), cloud, and containerized environments. The dispatch system automatically selects the optimal environment based on task requirements and machine availability.

### Real-time Streaming
Monitor task execution with live SSE streaming: stdout/stderr output, tool traces with input/output inspection, file diffs, and progress updates.

### Git Worktree Isolation
Each task executes in an isolated git worktree on a unique branch, preventing concurrent task interference and enabling safe parallel execution. Branches auto-cleanup after completion.

### Automatic PR Creation
Completed tasks automatically create pull requests with execution summaries, respecting delivery mode preferences (PR, direct push, branch-only, etc.).

### Safety System
Built-in guardrails: git state checks, conflict prevention, graceful cancellation of downstream tasks on failure, and rollback capability.

### Device Authentication
Secure machine registration via OAuth2 device code flow (RFC 8628): no credential passing, browser-based verification, automatic token lifecycle management, and multi-device support.

### Visual Planning
Interactive directed graph visualization with React Flow: pan/zoom the dependency graph, edit task properties and estimates, and watch nodes update in real-time.

### Context Injection
Persistent context injected into every AI session: vision documents, dependency outputs, codebase metadata, with smart filtering to stay within token budgets.

## Biomedical Research Integration

Astro integrates with **celltype/cli**, an autonomous drug discovery and research platform with 190+ computational biology tools. Researchers can leverage these tools directly within Astro tasks for target discovery, molecular design, genomics analysis, safety assessment, and clinical development. See the [celltype/cli documentation](https://github.com/celltype-ai/celltype) for complete tool details.

## Prerequisites

- **Node.js** 25.6.0+ (use `nvm use`)
- **npm** 11.8.0+
- **Git**
- **Claude CLI** authenticated (`claude login`)

Redis is not required for local development.

## Quick Start: Two Workflows

Astro runs in two modes. Pick the one that fits your needs.

### Workflow A: Local Mode (single user, no auth)

Everything runs on your machine with zero external dependencies. PGlite (Postgres-in-WASM) runs in-process — no Docker, no Supabase, no external services needed.

**What you'll get:**
- Full Astro UI at `http://localhost:5173`
- AI-powered planning and task execution
- All data stored locally (no external DB)
- Perfect for rapid prototyping and testing

**Step 1.** Clone and install:
```bash
git clone --recurse-submodules git@github.com:fuxialexander/astro.git
cd astro
nvm use         # Uses Node.js version from .nvmrc
npm install
```

**Step 2.** Initialize environment (one-time):
```bash
cp .env.example .env     # Create shared env file
npm run env:init         # Generate env profiles (.env.local.dev, .env.prod)
```

**Step 3.** Start everything:
```bash
npm run dev:local
```

This single command:
- Switches to local mode (enables PGlite)
- Starts the Vite dev server (frontend, port 5173)
- Starts the Hono API server (backend, port 3001)
- Starts the WebSocket relay (port 3002)
- Automatically starts an agent runner subprocess

**Step 4.** Open `http://localhost:5173` and you're ready to go.

**Before you start:** Ensure Claude CLI is authenticated locally:
```bash
claude login    # Credentials saved to ~/.claude/
```

The agent runner automatically connects to the local relay using your Claude CLI credentials. It appears in the **Environments** section once connected.

### Workflow B: Server Mode (multi-user, deployed)

For teams and production. Backend runs on Fly.io, frontend on Cloudflare Pages, data in remote Supabase, with agent runners connecting via WebSocket. See [docs/setup/org-deployment.md](docs/setup/org-deployment.md) for multi-user deployments.

**Step 1.** Clone and install:
```bash
git clone --recurse-submodules git@github.com:fuxialexander/astro.git
cd astro
nvm use
npm install
```

**Step 2.** Create and fill environment files:
```bash
cp .env.example .env
# Edit .env with:
#   - JWT secrets: openssl rand -hex 32
#   - FLY_APP: your desired Fly.io app name (must be globally unique)
#   - CLOUDFLARED_DOMAIN: your deployment domain
npm run env:init       # Generates .env.local.dev and .env.prod
```

**Step 3.** Fill in production credentials:
```bash
# Edit .env.prod and add:
#   - Supabase URL, anon key, and service role key
#   - Frontend domain (Cloudflare Pages URL)
```

**Step 4.** Deploy:
```bash
npm run env:prod      # Symlink .env.local → .env.prod (activates prod mode)
npm run deploy        # Deploys backend to Fly.io + frontend to Cloudflare Pages
```

**Step 5.** Verify the deployment:
```bash
curl -s https://<your-fly-app>.fly.dev/api/health | python3 -m json.tool
```

**Step 6.** Connect agent runners from user machines:
```bash
npx tsx packages/agent-runner/src/cli.ts launch --force-setup \
  --api https://<your-fly-app>.fly.dev \
  --relay wss://<your-fly-app>.fly.dev:3002
```

This starts device authentication (opens a browser for secure verification) and launches the agent. Once connected, the agent appears in the **Environments** section of the web UI.

### Running Components Separately

You can start each component individually for debugging or selective development.

```bash
# Terminal 1: Start the frontend dev server
npm run dev:frontend   # Vite dev server only (http://localhost:5173)

# Terminal 2: Start the backend (API + relay)
npm run dev:backend    # Hono API server + WebSocket relay (ports 3001, 3002)

# Terminal 3: Start the agent runner separately
npm run dev:agent      # Agent subprocess (auto-connects to ws://localhost:3002)
```

Use this for granular development: debugging specific components, testing backend changes without rebuilding frontend, or profiling.

### Verify Setup

```bash
npm run verify    # Check Node version, deps, ports, config
```

### Troubleshooting

**Port in use?** Kill processes: `lsof -ti:5173 | xargs kill -9` (and repeat for 3001, 3002)

**Node version mismatch?** Run `nvm use` to load `.nvmrc`

**Claude CLI not authenticated?** Run `claude login`

**Supabase failing?** Ensure Docker is running, or use local mode

For detailed troubleshooting, see [docs/setup/local-mode.md](docs/setup/local-mode.md), [docs/setup/server-mode.md](docs/setup/server-mode.md), and [docs/setup/environment-variables.md](docs/setup/environment-variables.md).

## Agent Runner

The agent runner executes AI tasks. It lives in `packages/agent-runner/` (a git submodule) and will be published as `@astroanywhere/agent`.

```bash
# Initialize the submodule (if you didn't clone with --recurse-submodules)
git submodule update --init --recursive
```

### Running the Agent Runner

From the repo root, use `npx tsx` to run the CLI directly from source:

```bash
# One-step: setup + start (recommended for first run)
npx tsx packages/agent-runner/src/cli.ts launch --force-setup

# Or separate steps:
npx tsx packages/agent-runner/src/cli.ts setup      # Interactive setup (detect providers, device auth)
npx tsx packages/agent-runner/src/cli.ts start -f    # Start in foreground
```

For local development, the agent runner starts automatically with `npm run dev:local`. For manual control: `npm run dev:agent`.

### CLI Commands

| Command | Description |
|---------|-------------|
| `launch` | Setup (if needed) + start in foreground. Use `--force-setup` to re-run setup. |
| `setup` | Interactive setup: detect providers, configure relay URL, device auth |
| `start` | Start the agent. Runs in background by default; use `-f` / `--foreground` for foreground |
| `stop` | Stop background agent (finds process via `pgrep`, sends SIGTERM) |
| `status` | Show agent status (running/stopped, config, connection) |
| `connect` | Alias for `start --foreground` |
| `config` | View or modify config. `--show` to display, `--set key=value` to change, `--reset` to clear |
| `auth` | Set Claude OAuth token (`--token <token>` or interactive) |
| `providers` | List detected AI providers (Claude Code, Codex, etc.) |
| `resources` | Show machine resources (CPU, memory, GPU) |
| `hosts` | Discover remote hosts from SSH config |
| `mcp` | Start MCP server for Claude Code integration (stdio mode) |

### Connecting to Different Backends

Three ways to specify the backend connection (highest priority first):

**1. CLI flags** (one-time override):
```bash
npx tsx packages/agent-runner/src/cli.ts launch --force-setup \
  --api https://<your-fly-app>.fly.dev \
  --relay wss://<your-fly-app>.fly.dev:3002
```

**2. Environment variables** (session-level):
```bash
export ASTRO_SERVER_URL=https://<your-fly-app>.fly.dev
export ASTRO_RELAY_URL=wss://<your-fly-app>.fly.dev:3002
npx tsx packages/agent-runner/src/cli.ts launch --force-setup
```

Or if `.env.local` is symlinked (e.g., via `npm run env:prod`), the runner reads `VITE_API_BASE_URL` and derives the relay URL automatically.

**3. Saved config** (persistent):
```bash
npx tsx packages/agent-runner/src/cli.ts config --set api=https://<your-fly-app>.fly.dev
npx tsx packages/agent-runner/src/cli.ts config --set relay=wss://<your-fly-app>.fly.dev:3002
```

Config is stored in `~/.config/astro-agent/config.json` (managed by the `conf` library).

**Defaults** (if nothing is set): `https://api.astroanywhere.com` and `wss://relay.astroanywhere.com:3002`.

#### Examples: Connecting to Different Deployments

```bash
# Local development (default when running `npm run dev:local`)
npx tsx packages/agent-runner/src/cli.ts launch --force-setup \
  --api http://localhost:3001 \
  --relay ws://localhost:3002

# Your Fly.io deployment
npx tsx packages/agent-runner/src/cli.ts launch --force-setup \
  --api https://<your-fly-app>.fly.dev \
  --relay wss://<your-fly-app>.fly.dev:3002

# Production (astroanywhere.com) — uses defaults, no flags needed
npx tsx packages/agent-runner/src/cli.ts launch --force-setup
```

### Start / Stop Lifecycle

```bash
npx tsx packages/agent-runner/src/cli.ts start              # Background mode
npx tsx packages/agent-runner/src/cli.ts start --foreground # Foreground mode (Ctrl+C to stop)
npx tsx packages/agent-runner/src/cli.ts stop               # Graceful shutdown
npx tsx packages/agent-runner/src/cli.ts status             # Check status
```

### Future: Standalone Package

When published to npm as `@astroanywhere/agent`, the commands simplify to:
```bash
npx @astroanywhere/agent launch --force-setup
npx @astroanywhere/agent stop
npx @astroanywhere/agent status
npx @astroanywhere/agent config
```

## Operating Modes

| Mode | Database | Auth | Network | Command |
|------|----------|------|---------|---------|
| **local** | PGlite (in-process) | None (single user) | All localhost | `npm run dev:local` |
| **dev** | Local Supabase | WebAuthn/passkeys via tunnel | Cloudflare tunnel → localhost | `npm run dev:dev` |
| **prod** | Remote Supabase | WebAuthn/passkeys | Fly.io + Cloudflare Pages | `npm run env:prod && npm run deploy` |

### Switching Modes

```bash
npm run env:local        # Switch to local (removes .env.local → PGlite auto-detected)
npm run env:dev          # Symlink .env.local → .env.local.dev
npm run env:prod         # Symlink .env.local → .env.prod
npm run env:switch       # Show current mode
```

Vite and tsx both auto-load `.env.local`. The npm scripts just control which file `.env.local` points to — same build commands, different environment variables.

### Env File Layout

Run `npm run env:init` after creating `.env` to generate dev and prod profiles.

```
.env              ← Shared secrets (JWT keys, deploy targets)
.env.local        ← Symlink to active profile (dev or prod)
.env.local.dev    ← Dev profile (generated)
.env.prod         ← Prod profile (generated, add Supabase creds)
.env.example*     ← Reference templates
```

## Project Structure

```
astro/
├── src/                    # Frontend (React 19 + Vite 7)
│   ├── pages/, components/, stores/, lib/, types/
│
├── server/                 # Backend (Hono API + Relay)
│   ├── routes/, middleware/, lib/
│   │   ├── db/            # Drizzle ORM (28 tables)
│   │   ├── relay-server.ts, machine-registry.ts
│   │   └── dispatch/      # Execution engine
│
├── packages/
│   ├── core/              # Shared DB schema, types, templates
│   └── agent-runner/      # Git submodule (CLI, providers, execution)
│
├── tests/, docs/design/, skills/, drizzle/
```

## API Endpoints

See [docs/backend/api-reference.md](docs/backend/api-reference.md) for full endpoint documentation.

**Key routes:**
- `/api/agent/*` — Plan generation and chat (SSE)
- `/api/dispatch/*` — Task execution and control
- `/api/data/*` — Project/plan CRUD
- `/api/events/stream` — Real-time SSE updates
- `/api/device/*` — Machine authentication (RFC 8628)

## Tech Stack

- **Frontend**: React 19, Vite 7, TypeScript, Tailwind CSS v4, Zustand 5, @xyflow/react, shadcn/ui
- **Backend**: Hono.js, Drizzle ORM, PGlite / Postgres
- **Relay**: WebSocket (ws library), Redis pub/sub (optional)
- **Agent Runner**: @anthropic-ai/claude-agent-sdk, Claude CLI, Codex
- **Deployment**: Cloudflare Pages (frontend) + Fly.io (backend)

## Testing

```bash
npm test              # Run all tests (vitest)
npm run test:watch    # Watch mode
npm run build         # TypeScript check + Vite build
npm run lint          # ESLint
```

## Building & Deployment

```bash
npm run build              # TypeScript check + Vite production build
npm run build:frontend     # Same as build (explicit name)
npm run build:server       # TypeScript check only (server runs via tsx, no compile needed)
npm run build:all          # Build everything including agent runner
npm run deploy             # Deploy backend (Fly.io) + frontend (Cloudflare Pages)
npm run deploy:backend     # Deploy backend only
npm run deploy:frontend    # Deploy frontend only
```

For multi-user org deployments (multiple people deploying to the same infrastructure), see [docs/setup/org-deployment.md](docs/setup/org-deployment.md).

### Fly.io Backend Deployment

Backend deploys as a Docker container (Hono API port 3001 + WebSocket relay port 3002). Configuration in `fly.toml`.

#### First-time setup

**Step 1.** Install and authenticate the Fly CLI:
```bash
brew install flyctl        # macOS
fly auth login
```

**Step 2.** Create the Fly.io app (once):
```bash
fly apps create <your-app-name> --org personal
```

**Step 3.** Update `fly.toml` to match your app name:
```toml
app = "<your-app-name>"
```

Also update `FLY_APP` in your `.env.prod` to match:
```
FLY_APP=<your-app-name>
```

> **Important:** The `app` field in `fly.toml` and `FLY_APP` in `.env.prod` must match. Fly.io app names are globally unique — if a name is taken by another user, you'll need to choose a different one. The deploy script reads `FLY_APP` from `.env.prod` to push secrets and run health checks.

**Step 4.** Generate env profiles and fill in prod values:
```bash
npm run env:init       # Generates .env.prod (if not already present)
# Edit .env.prod: Supabase creds, frontend domain, etc.
```

**Step 5.** Switch to prod mode and deploy:
```bash
npm run env:prod           # Symlinks .env.local → .env.prod
npm run deploy:backend     # Pushes secrets to Fly.io + deploys Docker image
```

**Step 6.** Verify:
```bash
curl -s https://<your-app-name>.fly.dev/api/health | python3 -m json.tool
```

#### Subsequent deploys

```bash
npm run env:prod           # Ensure prod mode is active
npm run deploy:backend     # Rebuilds Docker image + deploys
```

Or deploy everything (backend + frontend) at once:
```bash
npm run deploy
```

#### Debugging

```bash
fly logs --app <your-app-name> --no-tail    # Recent logs
fly status --app <your-app-name>            # App status
fly ssh console --app <your-app-name>       # SSH into the VM
```

See [docs/setup/fly-deployment.md](docs/setup/fly-deployment.md) for the full deployment guide (custom domains, scaling, cost, troubleshooting).

### Cloudflare Pages Frontend Deployment

The frontend builds as a static SPA and deploys to Cloudflare Pages. The `VITE_*` env vars are baked into the JS bundle at build time.

```bash
npm run env:prod            # Ensure .env.local has VITE_API_BASE_URL, VITE_SUPABASE_URL, etc.
npm run deploy:frontend     # Builds + deploys to Cloudflare Pages
```

To use a custom domain (e.g., `astroanywhere.com`), add it in the Cloudflare Pages dashboard: Workers & Pages → your project → Custom domains.

## Documentation

Complete documentation is in `docs/`:
- [Architecture](docs/design/ARCHITECTURE.md) — System design, data flow, scaling
- [Agent Runner](docs/design/AGENT_RUNNER.md) — CLI, providers, safety, worktrees
- [Relay Protocol](docs/design/RELAY.md) — WebSocket message types
- [Data Model](docs/design/DATA_MODEL.md) — Database schema (28 tables)
- [Full Index](docs/index.md) — All documentation

## Acknowledgments

Built with [React](https://react.dev/), [Vite](https://vite.dev/), [Hono](https://hono.dev/), [Tailwind CSS](https://tailwindcss.com/), [React Flow](https://reactflow.dev/), [Zustand](https://zustand-demo.pmnd.rs/), [Drizzle ORM](https://orm.drizzle.team/), and [Anthropic Claude](https://www.anthropic.com/).
