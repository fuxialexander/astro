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

- **AI-Powered Planning**: Decompose goals into dependency graphs with AI
- **Multi-Environment Execution**: Local, Docker, HPC (SLURM), Kubernetes, cloud
- **Real-time Streaming**: Live task output, tool traces, file changes via SSE
- **Git Worktree Isolation**: Each task runs on its own branch in an isolated worktree
- **Automatic PR Creation**: Completed tasks push branches and create pull requests
- **Safety System**: Git state checks prevent unsafe concurrent execution
- **Device Authentication**: OAuth2 device code flow (RFC 8628) for secure machine registration
- **Visual Planning**: Interactive directed graph with React Flow
- **Context Injection**: Vision doc + dependency outputs injected into every AI session

## Prerequisites

- **Node.js** 25.6.0+ (managed via `.nvmrc` — use `nvm use`)
- **npm** 11.8.0+
- **Git**
- **Claude CLI** authenticated (`claude login` — credentials in `~/.claude/`)

Redis is **not required** for local development.

## Getting Started

```bash
# Clone and install
git clone git@github.com:fuxialexander/astro.git
cd astro

# Install Node.js if needed
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 25.6.0
nvm use 25.6.0

# Install dependencies
npm install

# Copy environment template (optional)
cp env.example .env
```

### Running Locally

```bash
# Start everything: frontend + backend + relay + agent runner
npm run dev
```

This starts:
- **Vite dev server** on port 5173 (frontend)
- **Hono API server** on port 3001 (backend)
- **WebSocket relay** on port 3002
- **Agent runner** subprocess (connects to relay after 2s delay)

Open http://localhost:5173 — Vite proxies `/api` to the backend.

Or run components separately:

```bash
npm run dev:frontend   # Vite only (port 5173)
npm run dev:backend    # Hono + relay only (ports 3001, 3002)
npm run dev:agent      # Agent runner only (connects to ws://localhost:3002)
```

### Verify Setup

```bash
npm run verify    # Check Node version, deps, ports, config
```

### Environment Variables

No environment variables are required for local development.

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Backend port (default: 3001) |
| `RELAY_PORT` | No | Relay port (default: 3002) |
| `REDIS_URL` | No | Redis for horizontal scaling (not needed locally) |
| `CLOUDFLARED_DOMAIN` | No | Domain for Cloudflare tunnel |

## Operating Modes

Astro has three operating modes. Each has a one-command start:

| Mode | Database | Auth | Network | Command |
|------|----------|------|---------|---------|
| **local** | PGlite (in-process) | None (single user) | All localhost | `npm run dev:local` |
| **dev** | Local Supabase | WebAuthn/passkeys via tunnel | Cloudflare tunnel → localhost | `npm run dev:dev` |
| **prod** | Remote Supabase | WebAuthn/passkeys | Fly.io + Cloudflare Pages | `npm run env:prod && npm run deploy` |

### Local Mode

PGlite (Postgres compiled to WASM) runs in-process. No Docker, no Supabase, no auth. Data stored in `~/.astro/data/`. Best for quick iteration.

```bash
npm run dev:local        # Switches env + starts (PGlite, no auth)
```

### Dev Mode

Local Supabase (via Docker) with a Cloudflare tunnel for HTTPS — required for WebAuthn/TouchID to work. Multi-user auth, real-time sync, everything in one terminal.

```bash
npm run env:init         # One-time: generate .env.local.dev and .env.prod
npm run dev:dev          # Switches env + starts Supabase + frontend + backend + agent + tunnel
```

Requires `CLOUDFLARED_DOMAIN` in `.env` and Docker running.

### Prod Mode

Remote Supabase, Fly.io backend, Cloudflare Pages frontend. For deployment and testing against production infrastructure.

```bash
npm run env:prod         # Switch to prod profile
npm run deploy           # Deploy backend (Fly.io) + frontend (Cloudflare Pages)
```

Requires remote Supabase credentials in `.env.prod`.

### Switching Modes Manually

The `dev:local` and `dev:dev` commands switch env automatically. For manual control:

```bash
npm run env:init         # One-time: generate both profiles from .env
npm run env:local        # Switch to local (removes .env.local)
npm run env:dev          # Symlink .env.local → .env.local.dev
npm run env:prod         # Symlink .env.local → .env.prod
npm run env:switch       # Show current mode
```

The env system layers two files: `.env` (shared secrets, never touched) and `.env.local` (mode-specific overrides, managed by `switch-env.sh` as a symlink).

### Env File Layout

```
.env                  ← Shared secrets (JWT keys, CLOUDFLARED_DOMAIN) — git-ignored
.env.local            ← Symlink → active profile — git-ignored
.env.local.dev        ← Dev: tunnel domain, local Supabase, HMR over WSS
.env.prod       ← Prod: Pages domain, Fly.io backend, remote Supabase
.env.example          ← Template with documentation — committed
```

## Agent Runner Setup

The local agent runner starts automatically with `npm run dev`. For remote machines:

**1. Start tunnel** (if connecting remote machines):
```bash
npm run tunnel
```

**2. Setup and start agent on remote machine**:
```bash
bash scripts/agent-setup.sh
```

The agent-setup script reads `ASTRO_BASE_URL`, `FRONTEND_URL`, and `FLY_APP` from `.env` / `.env.local` — no manual URL arguments needed. It runs device auth and starts the agent. See [packages/agent-runner/](packages/agent-runner/) for details.

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
│       ├── prompt-templates.ts   # System prompts for AI tasks
│       └── repo-context.ts       # Repository context reading
│
├── packages/
│   └── agent-runner/             # Agent Runner (npm: @astro/agent, CLI: astro-agent)
│       └── src/
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
| POST | `/api/agent/generate-plan` | Generate plan via AI (SSE stream) |
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
npm run build:all          # Build everything including agent runner
npm run deploy             # Deploy backend (Fly.io) + frontend (Cloudflare Pages)
```

## Documentation

Complete documentation is in `docs/`:
- [Architecture](docs/design/ARCHITECTURE.md) — System design, data flow, scaling
- [Agent Runner](docs/design/AGENT_RUNNER.md) — CLI, providers, safety, worktrees
- [Relay Protocol](docs/design/RELAY.md) — WebSocket message types
- [Data Model](docs/design/DATA_MODEL.md) — Database schema (28 tables)
- [Full Index](docs/index.md) — All documentation

## Acknowledgments

Built with [React](https://react.dev/), [Vite](https://vite.dev/), [Hono](https://hono.dev/), [Tailwind CSS](https://tailwindcss.com/), [React Flow](https://reactflow.dev/), [Zustand](https://zustand-demo.pmnd.rs/), [Drizzle ORM](https://orm.drizzle.team/), and [Anthropic Claude](https://www.anthropic.com/).
