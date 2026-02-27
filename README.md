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
- **Teams & Collaboration**: Multi-user team support with invitations and role-based access control
- **Activity Feed**: Real-time tracking of all project and task events
- **Approval System**: Dynamic tool-based approvals for strategic decisions
- **Realtime Sync**: Multi-device collaboration via Supabase Realtime
- **MCP Tools**: 15 built-in tools for agents to self-direct work (plan management, project CRUD, data access)

## Teams & Collaboration

Astro supports multi-user teams with shared projects and real-time collaboration:

- **Team Management**: Create teams, invite members, and manage access via the web UI
- **Shared Projects**: Team members can collaborate on the same project simultaneously
- **Role-Based Access**: Control who can view, edit, or run tasks in shared projects
- **Realtime Sync**: Changes across devices sync instantly via Supabase Realtime
- **Activity Feed**: See all team activity — task execution, plan changes, approvals — in chronological order

For multi-user deployments, use **Server Mode** (Workflow B) with a remote Supabase database.

## Workspace Model (Workspace V2)

Each task runs in an isolated workspace for safety and reproducibility:

- **Git Worktrees**: Each task creates a git worktree, keeping work isolated from the main branch
- **Delivery Modes**: Choose how task results are delivered: PR (pull request), push (direct commit), branch (stash on branch), copy (copy files only), or direct (in-place edits)
- **Directory Detection**: Automatically detect the target directory when creating projects
- **Safety Checks**: Verify git state before execution to prevent unsafe concurrent operations
- **Agent Runner Integration**: Seamless integration with local and remote agent runners

See [docs/design/WORKSPACE_V2.md](docs/design/WORKSPACE_V2.md) for detailed workspace design.

## MCP Tools for Agents

Agents running inside Astro tasks have access to **15 MCP (Model Context Protocol) tools** for autonomous work:

### Plan Management (5 tools)
- `query_plan` — Get the full plan graph (nodes + edges)
- `create_task` — Create new tasks in the plan
- `update_task` — Update task properties (description, estimate, status)
- `create_dependency` — Create dependency edges between tasks
- `delete_task` — Remove tasks from the plan

### Project Management (4 tools)
- `query_projects` — List all projects
- `get_project` — Get project details and metadata
- `create_project` — Create new projects programmatically
- `update_project` — Update project properties

### Initiative Management (3 tools)
- `query_initiatives` — List initiatives/project groupings
- `create_initiative` — Create new initiatives
- `update_initiative` — Update initiative properties

### Data Access (2 tools)
- `get_user_profile` — Get user context and preferences
- `query_executions` — Query execution history and results

### User Interaction (1 tool)
- `ask_user_question` — Ask the user for decisions during task execution

Agents can use these tools to self-direct their work, create new tasks based on findings, and ask for human guidance when needed.

## Activity Feed & Approval System

Astro tracks all activity and provides flexible approval mechanisms:

### Activity Feed
- **Real-Time Events**: See task execution, plan changes, file modifications, and team activity instantly
- **Chronological View**: Browse project history with detailed event logs
- **Cross-Project Tracking**: View activity across all projects in one feed

### Approval System
- **Dynamic Approvals**: Use `ask_user_question` tool to ask users for decisions during task execution
- **Tiered Verification**: Auto-close verifiable tasks (tests pass, builds succeed); require human judgment for strategic decisions
- **SSE Notifications**: Receive approval requests via Server-Sent Events in real-time
- **Procedure-Level Approvals**: Configure approval workflows for specific task types

## Prerequisites

- **Node.js** 25.6.0+ (managed via `.nvmrc` — use `nvm use`)
- **npm** 11.8.0+
- **Git**
- **Claude CLI** authenticated (`claude login` — credentials in `~/.claude/`)

Redis is **not required** for local development.

## Quick Start: Two Workflows

Astro runs in two modes. Pick the one that fits your needs.

### Workflow A: Local Mode (single user, no auth)

Everything runs on your machine. PGlite (Postgres-in-WASM) runs in-process — no Docker, no Supabase, no external services.

**Step 1.** Clone and install:
```bash
git clone --recurse-submodules git@github.com:fuxialexander/astro.git
cd astro
nvm use         # Uses Node.js version from .nvmrc
npm install
```

**Step 2.** Initialize environment (one-time):
```bash
cp .env.example .env     # Create shared env file (defaults work for local)
npm run env:init         # Generate env profiles (.env.local.dev, .env.prod)
```

**Step 3.** Start everything (frontend + backend + relay + agent runner):
```bash
npm run dev:local
```

**Step 4.** Open http://localhost:5173. You're done.

The agent runner starts automatically as a subprocess — it connects to the local relay on `ws://localhost:3002` and executes AI tasks using your local Claude CLI credentials (`claude login`).

### Workflow B: Server Mode (multi-user, deployed)

Backend runs on Fly.io, frontend on Cloudflare Pages, data in remote Supabase. Agent runners connect from user machines via WebSocket.

> **Org deployment:** If multiple team members need to deploy independently from their own machines, see [docs/setup/org-deployment.md](docs/setup/org-deployment.md).

**Step 1.** Clone and install (same as above):
```bash
git clone --recurse-submodules git@github.com:fuxialexander/astro.git
cd astro
nvm use
npm install
```

**Step 2.** Initialize environment (one-time):
```bash
cp .env.example .env   # Create shared env file
# Edit .env: set JWT secrets (openssl rand -hex 32), FLY_APP, CLOUDFLARED_DOMAIN
npm run env:init       # Generates .env.local.dev and .env.prod from .env
```

**Step 3.** Fill in prod credentials:
```bash
# Edit .env.prod: add your remote Supabase credentials (URL, anon key, service role key)
```

**Step 4.** Switch to prod mode and deploy:
```bash
npm run env:prod      # Symlinks .env.local → .env.prod
npm run deploy        # Deploys backend (Fly.io) + frontend (Cloudflare Pages)
```

**Step 4.** Connect an agent runner from any machine:
```bash
npx tsx packages/agent-runner/src/cli.ts launch --force-setup \
  --api https://<your-fly-app>.fly.dev \
  --relay wss://<your-fly-app>.fly.dev:3002
```
This runs device auth (opens a browser for verification) and starts the agent in foreground mode. The agent connects to the relay and appears in the web UI under Environments.

### Running Components Separately

```bash
npm run dev:frontend   # Vite only (port 5173)
npm run dev:backend    # Hono + relay only (ports 3001, 3002)
npm run dev:agent      # Agent runner only (connects to ws://localhost:3002)
```

### Verify Setup

```bash
npm run verify    # Check Node version, deps, ports, config
```

## Agent Runner

The agent runner is the worker process that executes AI tasks. It lives in `packages/agent-runner/`, which is a **git submodule** pointing to [github.com/fuxialexander/astro-agent](https://github.com/fuxialexander/astro-agent) (private). It will later be published as a standalone package (`@astroanywhere/agent`).

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

Run `npm run env:init` after creating `.env` to generate the dev and prod profiles. The init script reads shared values from `.env` (JWT secrets, `CLOUDFLARED_DOMAIN`, `FLY_APP`) and generates the mode-specific files.

```
.env                  ← Shared secrets (JWT keys, deploy targets) — create from .env.example
.env.local            ← Symlink → active profile (managed by npm run env:*)
.env.local.dev        ← Dev profile (generated by env:init from CLOUDFLARED_DOMAIN)
.env.prod             ← Prod profile (generated by env:init, you fill in Supabase creds)
.env.example          ← Reference template — committed to git
.env.example.dev      ← Dev mode template (reference only)
.env.example.prod     ← Prod mode template (reference only)
```

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

## Common Workflows

Here are typical ways to use Astro:

### Workflow 1: AI-Assisted Code Review & Refactoring
1. Create a project pointing to a code repository
2. Describe the refactoring goal (e.g., "extract common utilities from these 3 modules")
3. Astro generates a decomposed plan with specific tasks
4. Click "Run" on a task → AI reviews code, creates a PR with changes
5. Review the PR, merge when ready
6. Next task runs automatically with the updated context

### Workflow 2: Multi-Step Analysis Pipeline
1. Create a research project with an analysis goal
2. AI decomposes into: data fetch → preprocessing → analysis → visualization
3. Dispatch each task to different machines (laptop for fetch, GPU cluster for analysis, laptop for viz)
4. Live output streaming shows progress; auto-verify when results pass checks
5. Explore branches: "what if we used a different normalization method?"

### Workflow 3: Team Code Review & Approval
1. Team creates a shared project for a feature
2. Manager reviews the AI-generated plan, approves key decisions
3. Tasks run in parallel across team member machines
4. Each task is auto-verified or requires approval via `ask_user_question`
5. Activity feed shows all progress; realtime sync keeps team aligned

## Configuration & Environment Variables

### Essential Environment Variables

Create `.env` from `.env.example` and set these values:

**Local Mode:**
```bash
# Local mode defaults work out-of-the-box with PGlite
cp .env.example .env
npm run env:init
npm run dev:local
```

**Server Mode:**
```bash
# Set these in .env before running npm run env:init
CLAUDE_API_KEY=<your-api-key>          # Claude API key (for plan generation)
SUPABASE_URL=<your-url>                # Supabase project URL
SUPABASE_ANON_KEY=<your-key>           # Supabase anonymous key
SUPABASE_SERVICE_ROLE_KEY=<your-key>   # Supabase service role key
FLY_APP=<your-app-name>                # Fly.io app name
CLOUDFLARED_DOMAIN=<your-domain>       # Cloudflare tunnel domain
JWT_SECRET=<generate-with-openssl>     # Generate: openssl rand -hex 32
RELAY_JWT_SECRET=<generate>            # Generate: openssl rand -hex 32
```

**Agent Runner Variables:**
Agent runners (local and remote) look for these `ASTRO_*` prefixed variables:
- `ASTRO_SERVER_URL` — Astro backend API URL
- `ASTRO_RELAY_URL` — WebSocket relay URL
- `ASTRO_AUTH_TOKEN` — JWT token for authentication
- `ASTRO_MACHINE_NAME` — Name of this machine
- `ASTRO_PROJECT_ID` — Current project ID
- `ASTRO_EXECUTION_ID` — Current task execution ID

See [docs/setup/environment-variables.md](docs/setup/environment-variables.md) for the complete reference.

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

The backend deploys as a single Docker container running both the Hono API server (port 3001) and the WebSocket relay (port 3002). Configuration is in `fly.toml` at the repo root.

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
