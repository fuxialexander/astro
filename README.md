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
Decompose complex goals into structured dependency graphs with AI assistance. Astro analyzes your project description and automatically generates a plan with explicit task dependencies, enabling strategic oversight and parallel execution planning.

### Multi-Environment Execution
Run tasks across diverse compute environments without rewriting workflows:
- **Local**: Execute on your machine (laptop, workstation)
- **Docker**: Containerized execution for reproducible environments
- **HPC (SLURM)**: Submit jobs to high-performance computing clusters
- **Kubernetes**: Orchestrated container workloads
- **Cloud**: AWS, GCP, or other cloud platforms

The dispatch system automatically selects the optimal environment based on task requirements and machine availability.

### Real-time Streaming
Monitor task execution in real-time with live SSE (Server-Sent Events) streaming:
- **Task Output**: Live stdout/stderr with syntax highlighting and search
- **Tool Traces**: Detailed timeline of tool calls (searches, API calls, file ops) with input/output inspection
- **File Changes**: Track modified files and view inline diffs as the agent works
- **Progress Updates**: Real-time progress indicators and status changes

### Git Worktree Isolation
Each task executes in its own isolated git worktree on a unique branch. This prevents concurrent tasks from interfering with each other and allows safe parallel execution. Branches are automatically cleaned up after task completion.

### Automatic PR Creation
Completed tasks automatically push their branches and create pull requests, streamlining code review workflows. The system respects your delivery mode preferences (PR, direct push, branch-only, etc.) and includes execution summaries in PR descriptions.

### Safety System
Built-in guardrails prevent unsafe concurrent execution:
- **Git State Checks**: Verify clean working trees before task dispatch
- **Conflict Prevention**: Prevent concurrent writes to the same files
- **Graceful Cancellation**: Cancel downstream tasks when dependencies fail
- **Rollback Capability**: Revert changes if verification fails

### Device Authentication
Secure machine registration using OAuth2 device code flow (RFC 8628):
- **No Credential Passing**: Devices authenticate without exposing secrets
- **User Verification**: Browser-based verification during registration
- **Token Management**: Automatic token lifecycle management (refresh, revoke)
- **Multi-Device Support**: Register multiple machines to the same team account

### Visual Planning
Interactive directed graph visualization of your plan:
- **React Flow Canvas**: Pan, zoom, and explore the dependency graph
- **Node Details**: Click nodes to view/edit task properties, estimates, and status
- **Dynamic Layout**: Automatic graph layout with explicit dependency visualization
- **Real-time Updates**: Watch nodes update as tasks execute

### Context Injection
Persistent context automatically injected into every AI session:
- **Vision Document**: Project-level context describing product goals or research questions
- **Dependency Outputs**: Results from upstream tasks feed into downstream task contexts
- **Codebase Context**: Relevant code files and repository metadata automatically included
- **Smart Filtering**: Only relevant context is included to stay within token budgets

## Celltype/CLI Integration: Biomedical Research Toolkit

Astro integrates with **celltype/cli**, an autonomous drug discovery and biomedical research platform with 190+ computational biology tools. This enables researchers to leverage advanced analysis capabilities directly within Astro tasks.

### Available Research Tools

**Target Discovery & Validation**
- Score degradation targets from proteomics data
- Predict degron motifs for protein degradation
- Find co-essential and synthetic lethal partners (DepMap CRISPR)
- Assess druggability via UniProt domains and structural coverage
- Query tissue expression across GTEx and Human Protein Atlas
- Retrieve disease associations from Open Targets

**Structure & Molecular Design**
- Fetch AlphaFold predicted structures
- Generate 3D molecular conformers
- Molecular docking and binding site detection
- Ternary complex prediction (E3-compound-target)
- Batch virtual screening for compound compatibility
- Molecular dynamics and free energy perturbation calculations

**Chemistry & SAR Analysis**
- Compute molecular descriptors (MW, LogP, TPSA, Lipinski)
- Similarity searching and scaffold hopping
- Matched molecular pair analysis
- Structure-activity relationship (SAR) analysis
- Retrosynthesis planning
- Pharmacophore modeling and synthetic accessibility scoring

**Genomics & Variants**
- GWAS catalog queries and eQTL lookup (GTEx)
- Variant annotation via Ensembl VEP
- Mendelian randomization evidence
- GWAS-eQTL colocalization analysis

**Transcriptomics & Expression**
- Pathway enrichment from L1000 signatures
- Differential expression analysis (DESeq2)
- Immune cell scoring and deconvolution
- Transcription factor activity inference
- Connectivity map queries for compound signatures

**Single-Cell & Spatial Analysis**
- Leiden/Louvain clustering and trajectory inference
- Cell type annotation via marker panels
- Spatial transcriptomics clustering
- Multi-omics integration (MOFA+)
- CELLxGENE dataset search and analysis

**Safety & ADMET**
- Anti-target screening for off-target degradation
- Multi-modal safety classification
- ADMET property prediction
- Drug-drug interaction prediction
- FDA adverse event signal scanning (FAERS)

**Clinical Development**
- Indication mapping and population sizing (SEER)
- Clinical trial search and benchmarking
- Competitive landscape analysis
- Trial design and protocol generation

**Literature & Data Access**
- PubMed and ChEMBL bioactivity queries
- Patent and preprint searching
- Academic publication discovery (OpenAlex)
- Comprehensive protein and variant databases

### Using Celltype Tools in Astro

Create plan nodes that leverage these tools for structured biomedical research:

1. **Target Discovery Task**: Query disease associations → validate with expression data → assess druggability
2. **Molecular Design Task**: Predict structures → dock compounds → optimize via FEP
3. **Clinical Development Task**: Indication mapping → population sizing → trial search → competitive analysis
4. **Genomics Task**: GWAS associations → eQTL colocalization → variant annotation → causal prioritization

Each task can specify which tool category it uses, and results from upstream analyses automatically feed downstream task contexts. This enables complex multi-step research workflows with full dependency tracking.

For complete tool documentation, see the [celltype/cli documentation](https://github.com/celltype-ai/celltype) or the individual skill references below the Features section.

## Prerequisites

- **Node.js** 25.6.0+ (managed via `.nvmrc` — use `nvm use`)
- **npm** 11.8.0+
- **Git**
- **Claude CLI** authenticated (`claude login` — credentials in `~/.claude/`)

Redis is **not required** for local development.

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
claude login    # Saves credentials to ~/.claude/
```

The agent runner automatically connects to the local relay and uses your Claude CLI credentials for AI execution. You'll see it appear in the **Environments** section of the UI once it connects.

### Workflow B: Server Mode (multi-user, deployed)

For teams and production deployments. Backend runs on Fly.io, frontend on Cloudflare Pages, data in remote Supabase. Agent runners on user machines connect via WebSocket.

> **Org deployment:** If multiple team members need to deploy independently from their own machines, see [docs/setup/org-deployment.md](docs/setup/org-deployment.md).

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

**When to use this:**
- Debugging a specific component without restarting everything
- Working on UI without touching the backend
- Testing backend changes without rebuilding the frontend
- Profiling or adding logging to specific processes

**Note:** In local mode, `npm run dev:local` starts all three automatically in one process. Separating them is useful for more granular development.

### Verify Setup

```bash
npm run verify    # Check Node version, deps, ports, config
```

### Troubleshooting Common Setup Issues

**Issue: Port already in use (5173, 3001, 3002)**
```bash
# Kill processes on those ports (macOS/Linux)
lsof -ti:5173 | xargs kill -9
lsof -ti:3001 | xargs kill -9
lsof -ti:3002 | xargs kill -9

# Then restart with npm run dev:local
```

**Issue: Node version mismatch**
- Ensure you've run `nvm use` to load the version from `.nvmrc`
- Run `node --version` to verify (should be 25.6.0 or higher)
- If `nvm` is not installed, see [nvm documentation](https://github.com/nvm-sh/nvm)

**Issue: Claude CLI not authenticated**
- Agent runner needs Claude credentials to execute tasks
- Run `claude login` to authenticate (credentials saved to `~/.claude/`)
- For server mode: set `ANTHROPIC_API_KEY` in `.env.prod`

**Issue: Agent runner fails to start**
- Check that ports 3002 (relay) and 3001 (API) are available
- Verify Claude CLI is installed: `which claude`
- Check logs: `npm run dev:local` shows stderr from subprocesses
- Try running the agent manually: `npm run dev:agent`

**Issue: Supabase not starting in dev mode**
- Dev mode requires Docker running
- If you see "connection refused", start Docker and retry: `npm run dev:dev`
- For local-only development, use `npm run dev:local` (no Docker needed)

**Issue: Environment file errors**
- Ensure `.env` exists: `cp .env.example .env`
- Verify `.env.local` is a symlink (not a copy) after mode switch
- Check that mode-specific files exist: `ls -la .env.local*`

**Still stuck?** See the full setup guides:
- Local mode: [docs/setup/local-mode.md](docs/setup/local-mode.md)
- Server mode: [docs/setup/server-mode.md](docs/setup/server-mode.md)
- Environment variables: [docs/setup/environment-variables.md](docs/setup/environment-variables.md)

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
