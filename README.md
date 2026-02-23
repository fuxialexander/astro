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

## Database Modes

### Local Mode (default)

PGlite (Postgres compiled to WASM) runs in-process. No Docker, no external DB. Data stored in `~/.astro/data/`.

```bash
npm run dev              # Auto-detected if no Supabase env vars
npm run dev:indexeddb    # Explicit local mode
```

### Server Mode (multi-user)

External Postgres (Supabase, Fly.io Postgres, AWS RDS). WebAuthn/passkey authentication.

```bash
npm run dev:supabase     # Local Supabase via Docker
```

Requires: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

### Mode Detection

1. `USE_INDEXEDDB_ONLY=true` → Local mode
2. No Supabase env vars → Local mode
3. Supabase env vars set → Server mode

The backend code is identical in both modes — Drizzle ORM queries work against any Postgres.

| Aspect | Local Mode | Server Mode |
|--------|-----------|-------------|
| Database | PGlite (in-process) | External Postgres |
| Auth | None (single user) | WebAuthn/passkeys |
| Relay | ws://localhost:3002 | wss:// with JWT |
| Agent runners | Local subprocess | Any machine via internet |

## Agent Runner Setup

The local agent runner starts automatically with `npm run dev`. For remote machines:

**1. Start tunnel** (if connecting remote machines):
```bash
bash ./scripts/start-tunnel.sh
```

**2. Setup and start agent on remote machine**:
```bash
bash ./scripts/agent-setup.sh
```

This builds the agent runner, runs device auth, and starts the agent. See [packages/agent-runner/](packages/agent-runner/) for details.

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

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for detailed guidelines on how to get started.

### Quick Start for Contributors

1. **Fork** the repository
2. **Clone** your fork and install dependencies:
   ```bash
   git clone git@github.com:YOUR_USERNAME/astro.git
   cd astro && npm install
   ```
3. **Create a branch** for your changes: `git checkout -b feature/your-feature-name`
4. **Make your changes** and ensure tests pass: `npm test && npm run lint`
5. **Submit a pull request** with a clear description

### Good First Issues

New to the project? Look for issues labeled [`good first issue`](https://github.com/fuxialexander/astro/labels/good%20first%20issue) — these are beginner-friendly tasks that help you get familiar with the codebase.

### Reporting Issues

- **Bug Reports**: Use the [Bug Report template](https://github.com/fuxialexander/astro/issues/new?template=bug_report.yml) to report bugs
- **Feature Requests**: Use the [Feature Request template](https://github.com/fuxialexander/astro/issues/new?template=feature_request.yml) to suggest new features

### Community

- **[GitHub Discussions](https://github.com/fuxialexander/astro/discussions)** — Ask questions, share ideas, and connect with other users
- **[Issue Tracker](https://github.com/fuxialexander/astro/issues)** — Browse and contribute to open issues

## Acknowledgments

Built with [React](https://react.dev/), [Vite](https://vite.dev/), [Hono](https://hono.dev/), [Tailwind CSS](https://tailwindcss.com/), [React Flow](https://reactflow.dev/), [Zustand](https://zustand-demo.pmnd.rs/), [Drizzle ORM](https://orm.drizzle.team/), and [Anthropic Claude](https://www.anthropic.com/).
