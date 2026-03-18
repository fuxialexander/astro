# Astro

> A planning-first platform for builders and scientists — AI-assisted task decomposition, multi-environment execution, and real-time progress tracking.

Astro sits above execution tools (coding agents, analysis tools) to help users decompose complex goals into dependency graphs, dispatch tasks across environments (local, HPC, cloud), and focus human attention on strategic decisions.

## Table of Contents

- [Quick Start](#quick-start--two-workflows)
- [Architecture](#architecture)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Operating Modes](#operating-modes)
- [Agent Runner](#agent-runner)
- [API Endpoints](#api-endpoints)
- [Tech Stack](#tech-stack)
- [Testing & Deployment](#building--deployment)
- [Documentation](#documentation)

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
Frontend: POST /api/dispatch/task (isInteractivePlan: true)
       │
       ▼
Backend: Build interactive plan prompt → Dispatch via relay
       │
       ▼
Agent Runner: Run Claude with structured output → Stream plan JSON back
       │
       ▼
Backend: Extract plan JSON → Emit plan_result SSE → SSE stream to browser
       │
       ▼
Frontend: Render dependency graph in React Flow
```

## Features

### AI-Powered Planning
Decompose complex goals into structured dependency graphs. Astro analyzes your project and generates plans with explicit task dependencies for strategic oversight and parallel execution.

### Multi-Environment Execution
Run tasks across diverse compute environments without rewriting workflows:
- **Local**: Execute on your machine
- **Docker**: Containerized execution
- **HPC (SLURM)**: High-performance computing clusters
- **Kubernetes**: Orchestrated workloads
- **Cloud**: AWS, GCP, and others

Dispatch automatically selects the optimal environment based on task requirements.

### Real-time Streaming
Monitor task execution with live SSE streaming:
- **Task Output**: Live stdout/stderr with syntax highlighting and search
- **Tool Traces**: Timeline of tool calls with input/output inspection
- **File Changes**: View modified files and inline diffs as the agent works
- **Progress Updates**: Real-time status indicators

### Git Worktree Isolation
Each task executes in its own isolated git worktree on a unique branch, preventing concurrent interference and enabling safe parallel execution. Branches are automatically cleaned up after completion.

### Automatic PR Creation
Completed tasks push their branches and create pull requests, streamlining code review. Respects delivery mode preferences and includes execution summaries.

### Safety System
Built-in guardrails prevent unsafe concurrent execution:
- **Git State Checks**: Verify clean working trees before dispatch
- **Conflict Prevention**: Prevent concurrent writes to the same files
- **Graceful Cancellation**: Cancel downstream tasks on dependency failure
- **Rollback Capability**: Revert changes if verification fails

### Device Authentication
Secure machine registration using OAuth2 device code flow (RFC 8628):
- **No Credential Passing**: Authenticate without exposing secrets
- **User Verification**: Browser-based registration verification
- **Token Management**: Automatic token lifecycle management
- **Multi-Device Support**: Register multiple machines to one account

### Visual Planning
Interactive directed graph visualization of your plan:
- **React Flow Canvas**: Pan, zoom, and explore the graph
- **Node Details**: View/edit task properties, estimates, and status
- **Dynamic Layout**: Automatic visualization with explicit dependencies
- **Real-time Updates**: Watch nodes update as tasks execute

### Context Injection
Persistent context automatically injected into every AI session:
- **Vision Document**: Project-level goals and research questions
- **Dependency Outputs**: Results from upstream tasks flow to downstream tasks
- **Codebase Context**: Relevant code and repository metadata
- **Smart Filtering**: Only relevant context stays within token budgets


## Prerequisites

- **Node.js** 25.6.0+ (managed via `.nvmrc` — use `nvm use`)
- **npm** 11.8.0+
- **Git**
- **Claude CLI** authenticated (`claude login` — credentials in `~/.claude/`)

Redis is **not required** for local development.

## Quick Start: Two Workflows

| Mode | Use Case | Database | Setup Time |
|------|----------|----------|------------|
| **Local** | Solo development | PGlite (in-process) | ~2 minutes |
| **Server** | Team deployment | Remote Supabase | ~15 minutes |

### Workflow A: Local Mode

Everything runs on your machine. PGlite (Postgres-in-WASM) runs in-process — no Docker needed.

**Prerequisites:**
```bash
# Ensure Claude CLI is authenticated
claude login    # Saves credentials to ~/.claude/
```

**Setup (one-time):**
```bash
git clone --recurse-submodules git@github.com:fuxialexander/astro.git
cd astro
nvm use && npm install
cp .env.example .env
npm run env:init
```

**Start:**
```bash
npm run dev:local
```

This command starts all components automatically:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`
- WebSocket relay: `http://localhost:3002`
- Agent runner (subprocess)

Open `http://localhost:5173` and begin planning.

### Workflow B: Server Mode

For teams and production. Backend on Fly.io, frontend on Cloudflare Pages, data in remote Supabase.

**Setup:**
```bash
git clone --recurse-submodules git@github.com:fuxialexander/astro.git
cd astro
nvm use && npm install
cp .env.example .env
```

**Configure production:**
```bash
# Edit .env with:
# - JWT secrets: openssl rand -hex 32
# - FLY_APP=<your-unique-app-name>
# - CLOUDFLARED_DOMAIN=<your-domain>
npm run env:init

# Edit .env.prod with Supabase credentials:
# - Supabase URL, anon key, service role key
# - Frontend domain (Cloudflare Pages)
```

**Deploy:**
```bash
npm run env:prod
npm run deploy
```

**Verify:**
```bash
curl https://<your-fly-app>.fly.dev/api/health | python3 -m json.tool
```

**Connect agent runners from user machines:**
```bash
npx tsx packages/agent-runner/src/cli.ts launch --force-setup \
  --api https://<your-fly-app>.fly.dev \
  --relay wss://<your-fly-app>.fly.dev:3002
```

**Multi-team deployment:** See [docs/setup/org-deployment.md](docs/setup/org-deployment.md) for deploying multiple independent instances.

### Running Components Separately

For granular development, start components in separate terminals:

```bash
# Terminal 1: Frontend (Vite dev server)
npm run dev:frontend   # Runs on http://localhost:5173

# Terminal 2: Backend (Hono API + Relay)
npm run dev:backend    # API on :3001, Relay on :3002

# Terminal 3: Agent Runner
npm run dev:agent      # Connects to ws://localhost:3002
```

**Use this for:**
- Debugging a specific component
- Developing UI without backend restarts
- Testing backend changes in isolation
- Profiling or adding logging

**Note:** `npm run dev:local` runs all three in one process — use separate terminals for selective development.

**Verify your setup:**
```bash
npm run verify    # Checks Node version, dependencies, ports, and configuration
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| **Port already in use** (5173, 3001, 3002) | `lsof -ti:PORT | xargs kill -9` for each port, then restart |
| **Node version mismatch** | Run `nvm use` to load `.nvmrc` version (25.6.0+) |
| **Claude CLI not authenticated** | `claude login` (local), or set `ANTHROPIC_API_KEY` in `.env.prod` (server) |
| **Agent runner fails to start** | Check ports are free, verify `which claude`, review logs from `npm run dev:local` |
| **Supabase connection refused** | Start Docker, then retry `npm run dev:dev` (not needed for local mode) |
| **Environment file errors** | Ensure `.env.local` is a symlink after mode switch: `ls -la .env.local*` |

**More help:**
- [docs/setup/local-mode.md](docs/setup/local-mode.md) — Local development details
- [docs/setup/server-mode.md](docs/setup/server-mode.md) — Server/team deployment
- [docs/setup/environment-variables.md](docs/setup/environment-variables.md) — Env variable reference
- [docs/setup/developer-setup.md](docs/setup/developer-setup.md) — Complete setup guide

## Agent Runner

The agent runner is the worker process that executes AI tasks. It lives in `packages/agent-runner/`, a **git submodule** pointing to [github.com/fuxialexander/astro-agent](https://github.com/fuxialexander/astro-agent) (private). It will be published as a standalone package (`@astroanywhere/agent`).

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
| `launch` | Setup (if needed) + start in foreground |
| `setup` | Interactive setup: detect providers, configure relay, auth |
| `start` / `stop` | Start/stop the agent background process |
| `status` | Show agent status and connection |
| `config` | View or modify config (`--show`, `--set key=value`, `--reset`) |
| `auth` | Set Claude OAuth token |
| `providers` | List detected AI providers |
| `resources` | Show machine CPU, memory, GPU |
| `mcp` | Start MCP server for Claude Code |

### Connecting to Different Backends

The agent runner needs to know which Astro backend to connect to. There are three ways to specify this (highest priority first):

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

**Starting** (background mode — default):
```bash
npx tsx packages/agent-runner/src/cli.ts start
# Spawns a detached child process, prints the PID, and exits
```

**Starting** (foreground mode — recommended for testing):
```bash
npx tsx packages/agent-runner/src/cli.ts start --foreground
# Runs in current terminal. Ctrl+C sends SIGTERM for graceful shutdown.
# The `launch` and `connect` commands always run in foreground.
```

**Stopping**:
```bash
npx tsx packages/agent-runner/src/cli.ts stop
# Finds running agent processes via `pgrep -f 'astro-agent.*start'` and sends SIGTERM.
# Graceful shutdown: cancels running tasks, disconnects WebSocket, then exits.
```

**Checking status**:
```bash
npx tsx packages/agent-runner/src/cli.ts status
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

Astro supports three modes:

| Mode | Database | Auth | Use Case |
|------|----------|------|----------|
| **local** | PGlite (in-process) | None | Solo development |
| **dev** | Local Supabase | WebAuthn/passkeys | Team testing |
| **prod** | Remote Supabase | WebAuthn/passkeys | Production |

**Switch modes:**
```bash
npm run env:local        # Local mode (no auth)
npm run env:dev          # Dev mode (local Supabase)
npm run env:prod         # Production mode
npm run env:switch       # Show current mode
```

Run `npm run env:init` once to generate dev and prod environment profiles.

## Project Structure

```
astro/
├── src/                          # Frontend (React 19 + Vite 7)
│   ├── pages/                    # Route pages (16 pages)
│   ├── components/               # UI components (shadcn/ui pattern)
│   ├── stores/                   # Zustand state stores (27 stores)
│   ├── lib/                      # API client, SSE parser, utilities
│   └── types/                    # TypeScript type definitions
│
├── server/                       # Backend (Hono API + Relay)
│   ├── routes/                   # API routes (agent, dispatch, events, data, relay)
│   ├── middleware/                # Auth middleware
│   └── lib/
│       ├── db/                   # Drizzle ORM schema (28 tables) + migrations
│       ├── relay-server.ts       # WebSocket relay server
│       ├── machine-registry.ts   # Connected machine tracking
│       ├── dispatch/             # Dispatch engine, queue, context assembler
│       ├── events/               # Event transport + hooks
│       └── prompt-templates.ts   # System prompts for AI tasks
│
├── packages/
│   ├── core/                     # Shared code (db, schema, dispatch types, prompt templates)
│   │   └── src/                  # Imported by both server/ and agent-runner
│   └── agent-runner/             # Git submodule → github.com/fuxialexander/astro-agent
│       └── src/                  # (private repo, ships as pre-built tarball)
│           ├── cli.ts            # CLI entry (10 commands)
│           ├── lib/              # Task executor, worktree, git-pr, safety
│           ├── providers/        # Claude SDK, Claude CLI, Codex adapters
│           ├── execution/        # Direct, Docker, SLURM, K8s strategies
│           └── mcp/              # MCP server for Claude Code integration
│
├── tests/                        # Vitest test suite (34+ files, 550+ tests)
├── docs/design/                  # Architecture documentation
├── skills/                       # Skill definitions (SKILL.md files)
└── drizzle/                      # Database migration files
```

## API Endpoints

### AI Agent (relay-only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/agent/chat` | Chat for plan refinement (SSE stream) |
| POST | `/api/agent/task-chat` | Task-level chat (SSE stream) |
| POST | `/api/agent/summarize` | Generate execution summary |

### Task Dispatch
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/dispatch/task` | Dispatch task to agent runner (SSE stream) |
| POST | `/api/dispatch/cancel` | Cancel running task |
| POST | `/api/dispatch/steer` | Send guidance to running agent |

### Data (CRUD)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/data/projects` | List/create projects |
| GET/PATCH/DELETE | `/api/data/projects/:id` | Get/update/delete project |
| GET/PUT | `/api/data/projects/:id/plan` | Get/set plan nodes + edges |

### Real-time
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events/stream` | SSE for real-time updates |
| GET | `/api/health` | Health check + relay status |

### Device Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/device/authorize` | Request device code |
| POST | `/api/device/token` | Poll/exchange for tokens |
| POST | `/api/device/register` | Register machine |

## Tech Stack

- **Frontend**: React 19, Vite 7, TypeScript, Tailwind CSS v4, Zustand 5, @xyflow/react, shadcn/ui
- **Backend**: Hono.js, Drizzle ORM, PGlite / Postgres
- **Relay**: WebSocket (ws library), Redis pub/sub (optional)
- **Agent Runner**: @anthropic-ai/claude-agent-sdk, Claude CLI, Codex
- **Deployment**: Cloudflare Pages (frontend) + Fly.io (backend)

## Testing & Quality

```bash
npm test              # Run all tests (Vitest)
npm run test:watch    # Watch mode
npm run build         # TypeScript check + Vite build
npm run lint          # ESLint
```

**Note:** Integration tests auto-skip without a running server or API key.

## Building & Deployment

**Build:**
```bash
npm run build              # TypeScript check + Vite production build
npm run build:frontend     # Frontend only
npm run build:server       # Backend only (TypeScript check)
npm run build:all          # Everything including agent-runner
```

**Deploy:**
```bash
npm run deploy             # Backend (Fly.io) + frontend (Cloudflare Pages)
npm run deploy:backend     # Backend only
npm run deploy:frontend    # Frontend only
```

**Multi-team deployment:** [docs/setup/org-deployment.md](docs/setup/org-deployment.md)

### Fly.io Backend Deployment

Deploys as a single Docker container running Hono API (port 3001) + WebSocket relay (port 3002).

**First-time setup:**
```bash
# 1. Install Fly CLI and authenticate
brew install flyctl && fly auth login

# 2. Create your Fly app (globally unique name)
fly apps create <your-app-name> --org personal

# 3. Update configuration files
# Edit fly.toml: set app = "<your-app-name>"
# Edit .env.prod: set FLY_APP=<your-app-name> + Supabase creds

# 4. Generate profiles and deploy
npm run env:init
npm run env:prod
npm run deploy:backend

# 5. Verify
curl https://<your-app-name>.fly.dev/api/health
```

**Subsequent deploys:**
```bash
npm run env:prod && npm run deploy:backend
# Or deploy everything: npm run deploy
```

**Debugging:**
```bash
fly logs --app <your-app-name> --no-tail
fly status --app <your-app-name>
```

> **Important:** `FLY_APP` in `.env.prod` and `app` in `fly.toml` must match. App names are globally unique.

See [docs/setup/fly-deployment.md](docs/setup/fly-deployment.md) for detailed guidance on custom domains, scaling, and troubleshooting.

### Cloudflare Pages Frontend Deployment

Builds as a static SPA with environment variables baked in at build time.

```bash
npm run env:prod            # Activate prod mode
npm run deploy:frontend     # Build + deploy to Cloudflare Pages
```

**Custom domain:**
Add in Cloudflare Pages dashboard: Workers & Pages → Your Project → Custom Domains

## Documentation

### Docs Site (Mintlify)

The full user-facing documentation lives in `docs-site/` and is built with [Mintlify](https://mintlify.com/). It covers getting started, tutorials, architecture, API reference, CLI & agent runner, and integrations.

**Run locally:**
```bash
npm run docs:dev    # Starts Mintlify dev server at http://localhost:3000
```

**Sections:**
- **Getting Started** — Quickstart, installation (3 modes), concepts, architecture overview
- **Use Cases** — Builders (software engineers) and Scientists (researchers)
- **Tutorials** — First project, connect a machine, dispatch tasks, CLI usage, team collaboration
- **Architecture** — Frontend, backend, agent runner, relay server, data model
- **Features** — Plan graph, approval system, activity feed, realtime sync, skills, MCP tools
- **API Reference** — Data API, Dispatch API, Events API
- **CLI & Agent** — CLI commands, agent runner, provider adapters
- **Integrations** — GitHub, HPC/Slurm

### Design Docs (Internal)

Detailed developer-facing design docs are in `docs/`:
- [Architecture](docs/design/ARCHITECTURE.md) — System design, data flow, scaling
- [Agent Runner](docs/design/AGENT_RUNNER.md) — CLI, providers, safety, worktrees
- [Relay Protocol](docs/design/RELAY.md) — WebSocket message types
- [Data Model](docs/design/DATA_MODEL.md) — Database schema (28 tables)
- [Full Index](docs/index.md) — All documentation

## Acknowledgments

Built with [React](https://react.dev/), [Vite](https://vite.dev/), [Hono](https://hono.dev/), [Tailwind CSS](https://tailwindcss.com/), [React Flow](https://reactflow.dev/), [Zustand](https://zustand-demo.pmnd.rs/), [Drizzle ORM](https://orm.drizzle.team/), and [Anthropic Claude](https://www.anthropic.com/).
