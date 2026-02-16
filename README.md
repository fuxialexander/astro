# Nexus

> A planning-first platform for builders and scientists — AI-assisted task decomposition, multi-environment execution, and real-time progress tracking.

Nexus sits above execution tools (coding agents, analysis tools) to help users decompose complex goals into dependency graphs, dispatch tasks across environments (local, HPC, cloud), and focus human attention on strategic decisions.

## 🚀 Multi-User Setup (New!)

Want to deploy Nexus for your team with proper authentication and user isolation?

**→ [Quick Start Guide (5 minutes)](QUICKSTART_MULTIUSER.md)**
**→ [Full Setup Guide with Supabase](SETUP_MULTI_USER.md)**

Features:
- ✅ Self-hosted Supabase (free, runs on your machine)
- ✅ WebAuthn passkey authentication (no passwords!)
- ✅ Complete user isolation (RLS policies)
- ✅ External access via Cloudflare Tunnel
- ✅ $0 cost for unlimited users

## Features

- **Smart Task Planning**: AI-powered task decomposition with dependency graphs
- **Multi-Environment Execution**: Dispatch tasks to local machines, HPC clusters (SLURM), or cloud instances
- **Real-time Monitoring**: Live task progress tracking via Server-Sent Events
- **Provider Abstraction**: Pluggable execution adapters (Claude Code, Codex, SLURM)
- **Device Authentication**: OAuth2 device code flow (RFC 8628) for secure machine registration
- **Visual Planning**: Interactive directed graph visualization with React Flow
- **Context-Aware Execution**: Automatic injection of project vision doc and dependency context per task

## Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React 19 + Vite 7)          │
│   Zustand stores ←→ IndexedDB (offline cache)   │
│   EventSource ← SSE ← Backend                   │
└────────────────────┬────────────────────────────┘
                     │ HTTP / SSE
┌────────────────────┴────────────────────────────┐
│           Backend (Hono + Node.js)               │
│   Drizzle ORM + SQLite (local persistence)       │
│   Claude Agent SDK (AI plan generation)          │
│   Dispatch Engine → Provider Adapters            │
│   WebSocket Relay (port 3002)                    │
└────────────────────┬────────────────────────────┘
                     │ WebSocket
              ┌──────┴──────┐
              │Agent Runners │
              │(user machines)│
              └─────────────┘
```

### Key Patterns

- **SSE Bridge**: Relay events → EventEmitter → SSE endpoint → EventSource → Zustand store
- **Dual Dispatch**: Local (direct provider SSE) vs relay (WebSocket → SSE bridge)
- **Provider Abstraction**: Pluggable adapters in `server/lib/providers/` (Claude Code, Codex, SLURM)
- **Context Assembly**: Vision doc + dependency outputs injected per task

## Prerequisites

- **Node.js** 25.6.0+ (managed via `.nvmrc` — use `nvm use`)
- **npm** 11.8.0+
- **Git**
- **Claude CLI** authenticated (`claude login` — the Claude Agent SDK reads credentials from `~/.claude/`)

Redis is **not required** for local development. It's only needed for horizontal scaling in production.

## Getting Started

### For End Users

**Important**: Nexus is currently a **single-user application** designed to run locally on your machine. There is no hosted service or multi-user support yet.

**Quick Start**:
1. Clone and install the repository (see Developer Setup below)
2. Run `npm run dev` to start the local server
3. Visit http://localhost:5173 in your browser
4. Complete the onboarding flow to create your first project

**Accessing from Remote Machines**:
If you want to dispatch tasks to remote machines (e.g., HPC clusters), you can expose your local server via a Cloudflare Tunnel:
1. Set `CLOUDFLARED_DOMAIN` in your `.env` file
2. Run `bash ./scripts/start-tunnel.sh` to expose your server
3. Run `bash ./scripts/agent-setup.sh` on remote machines to connect them

⚠️ **Multi-User Limitations**: The default setup uses a local SQLite database with no authentication. If you expose your local server via cloudflared, other users who access your domain will see all your data with no separation.

**For Multi-User Deployment**: Nexus includes a complete Supabase + authentication implementation with user isolation, passkey login, and Row Level Security. See [`setup_auth.md`](setup_auth.md) for instructions.

### For Developers

```bash
# Clone the repository
git clone git@github.com:fuxialexander/nexus.git
cd nexus

# install nodejs and npm if not already installed
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 25.6.0
nvm use 25.6.0
# Install dependencies
npm install

# Copy environment template (optional — no API keys needed)
cp env.example .env
```

The SQLite database is created automatically on first server start (stored as `.nexus/nexus.db`).

### Running the Dev Server

```bash
# Start frontend (port 5173) + backend (port 3001) + relay (port 3002)
npm run dev
```

Or run them separately:

```bash
npm run dev:frontend   # Vite dev server (port 5173)
npm run dev:backend    # Hono API (port 3001) + WebSocket relay (port 3002)
```

Open http://localhost:5173 — Vite proxies `/api` requests to the backend automatically.

### Verify Setup For Local Development

```bash
npm run verify    # Check Node version, dependencies, port availability, config
```

### Environment Variables

No environment variables are required for local development. The Claude Agent SDK authenticates via `~/.claude/` credentials (from `claude login`). See `.env.example` for optional variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Backend port (default: 3001) |
| `RELAY_PORT` | No | WebSocket relay port (default: 3002) |
| `REDIS_URL` | No | Redis URL for horizontal scaling (not needed locally) |
| `CLOUDFLARED_DOMAIN` | No | Domain for Cloudflare tunnel (remote agent connectivity) |

### Agent Setup

Local agent should directly work if you have already set up `claude` or `codex` locally. For `claude`, authenticate via `claude login` (credentials are stored in `~/.claude/` and picked up automatically by the SDK). For `codex`, it reads credentials from its own environment variables (`OPENAI_API_KEY`).

To connect to a remote machine (e.g. HPC cluster, SSH server) to your local Nexus server:

**Prerequisites**: [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed on the server machine, a Cloudflare domain configured. Then in your local machine run `cloudflared tunnel login` to login to your Cloudflare account. And set your domain in `.env` as `CLOUDFLARED_DOMAIN=yourdomain.com`.

**1. Local Server — start the tunnel**

Set your domain in `.env`:
```
CLOUDFLARED_DOMAIN=yourdomain.com
```

Then start the tunnel (creates it on first run):
```bash
bash ./scripts/start-tunnel.sh
```

This exposes `nexus.yourdomain.com` (frontend + backend) and `nexus-relay.yourdomain.com` (WebSocket relay) via Cloudflare Tunnel.

**2. Setup and start the agent**

```bash
bash ./scripts/agent-setup.sh 
```

This builds the agent runner, runs the device auth flow (you approve in your browser), and starts the agent locally. The machine will appear in the Environments page. The setup will also detect remote machines in your ssh config and prompt you to install the agent on them. Note that you need to ssh into the remote machine and run the following command to start the agent:

```bash
# you can also add `~/.local/bin` to your PATH for easy access
~/.local/bin/nexus-agent start --foreground # add --foreground to run in foreground for easy interruption
```

After that you approve the machine in the browser, you will be directed to the welcome page, where you can create a project on local or remote machine (if you have already started the agent on the remote machine).


## Database Modes

Nexus supports two database modes:

### 1. IndexedDB Mode (Local, Offline-first)

**Default mode for local development** — No authentication required, all data stored client-side.

**Setup:**
```bash
# Option A: Auto-detected (no Supabase env vars set)
npm run dev

# Option B: Explicit override (even if Supabase is configured)
npm run dev:indexeddb

# Or manually:
USE_INDEXEDDB_ONLY=true VITE_USE_INDEXEDDB_ONLY=true npm run dev
```

**Features:**
- ✅ No authentication required
- ✅ All data stored in browser IndexedDB
- ✅ Works completely offline
- ✅ Faster iteration (no network latency)
- ✅ Single-user only
- ✅ Perfect for rapid prototyping

**Use Cases:**
- Local development without Supabase setup
- Testing and comparison between modes
- Offline-first scenarios
- Avoiding WebAuthn/Touch ID constraints on localhost

**Environment Variables:**
```bash
# Backend
USE_INDEXEDDB_ONLY=true

# Frontend
VITE_USE_INDEXEDDB_ONLY=true
```

### 2. Supabase Mode (Multi-user, Server-backed)

**Production mode** — Multi-user with authentication, PostgreSQL database, real-time collaboration.

**Setup:**
```bash
# Local Supabase (Docker)
bash ./scripts/setup-supabase-local.sh
npm run dev

# Or use convenience script:
npm run dev:supabase
```

**Features:**
- ✅ Multi-user with WebAuthn/passkey authentication
- ✅ Server-side PostgreSQL database with RLS
- ✅ Real-time collaboration
- ✅ Data synced across devices
- ✅ User isolation and access control
- ✅ Push notifications (iOS app)

**Environment Variables:**
- `SUPABASE_URL` — Supabase API endpoint
- `SUPABASE_SERVICE_ROLE_KEY` — Admin key (backend only)
- `SUPABASE_ANON_KEY` — Public key (backend)
- `VITE_SUPABASE_URL` — Frontend Supabase URL
- `VITE_SUPABASE_ANON_KEY` — Frontend anon key

**WebAuthn/Touch ID Requirements:**
- ⚠️ Touch ID/Face ID only works with HTTPS or registered localhost
- For external access: Use `bash ./scripts/start-tunnel-with-supabase.sh`
- This sets `WEBAUTHN_RP_ID` to your tunnel domain (e.g., `abc123.ngrok.io`)

**Deployment Guides:**
- [Quick Start (5 minutes)](QUICKSTART_MULTIUSER.md)
- [Full Setup Guide](SETUP_MULTI_USER.md)

### Mode Switching

The system automatically detects which mode to use:

1. **Auto-detection**: If Supabase env vars are not set → IndexedDB mode
2. **Explicit override**: If `USE_INDEXEDDB_ONLY=true` → IndexedDB mode (even if Supabase is configured)
3. **Supabase mode**: If Supabase env vars are set and no override → Supabase mode

**Visual Indicator**: The sidebar shows "IndexedDB Mode (Local Only)" badge when running in IndexedDB mode.

### Trade-offs

| Feature | IndexedDB Mode | Supabase Mode |
|---------|---------------|---------------|
| Authentication | None | WebAuthn/Passkeys |
| Users | Single-user | Multi-user |
| Data Storage | Browser only | PostgreSQL + IndexedDB cache |
| Offline Support | Full | Partial (with cache) |
| Collaboration | None | Real-time |
| Deployment | Static site | Requires backend + DB |
| Dev Speed | Fast | Slower (network latency) |
| Production Ready | No | Yes |

### Database Reset & Cleanup

Need to start with a clean database? See **[DATABASE_RESET.md](DATABASE_RESET.md)** for comprehensive reset instructions.

**Quick Commands:**

```bash
# Reset everything (Supabase + IndexedDB instructions)
npm run db:reset

# Reset Supabase database only
npm run db:reset:supabase

# Show IndexedDB reset instructions
npm run db:reset:indexeddb
```

**Browser-based reset (IndexedDB only):**
1. Visit http://localhost:5173/reset-indexeddb.html
2. Click "Reset Everything"
3. Done!

For detailed instructions, troubleshooting, and recovery options, see [DATABASE_RESET.md](DATABASE_RESET.md).


## Project Structure

```
nexus/
├── src/                          # Frontend React application
│   ├── pages/                    # Route pages (dashboard, projects, plan-view, etc.)
│   ├── components/               # React components
│   │   ├── ui/                   # shadcn/ui primitives (Radix-based)
│   │   ├── layout/               # App shell, sidebar, header
│   │   ├── plan-graph/           # React Flow graph components
│   │   ├── task-detail/          # Task output, tool traces, file changes
│   │   └── execution/            # Execution panel, provider status
│   ├── stores/                   # Zustand state stores (IndexedDB-backed)
│   ├── lib/                      # Client utilities (API client, SSE, graph utils)
│   └── types/                    # TypeScript type definitions
├── server/                       # Backend Hono application
│   ├── routes/                   # API routes (agent, dispatch, events, data, device-auth)
│   └── lib/
│       ├── db/                   # Drizzle ORM + SQLite schema and connection
│       ├── providers/            # Execution provider adapters (Claude Code, Codex, SLURM)
│       ├── dispatch/             # Task dispatch engine, queue, context assembler
│       └── slurm/                # HPC job management, SBATCH generation
├── packages/
│   └── agent-runner/             # Agent runner for remote machines
├── scripts/                      # Setup and tunnel scripts
├── docs/                         # Architecture and protocol documentation
└── drizzle/                      # Database migration files
```

## API Endpoints

### Device Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/device/authorize` | Request device code |
| POST | `/api/device/token` | Poll/exchange for tokens |
| POST | `/api/device/register` | Register authenticated machine |
| POST | `/api/device/refresh` | Refresh access token |
| POST | `/api/device/revoke` | Revoke token |

### AI Agent
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/agent/generate-plan` | Generate plan via AI (SSE stream) |
| POST | `/api/agent/chat` | Chat for plan refinement (SSE stream) |
| POST | `/api/agent/abort` | Abort running AI session |

### Task Dispatch
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/dispatch/task` | Dispatch task to agent runner |
| POST | `/api/dispatch/cancel` | Cancel running task |
| POST | `/api/dispatch/steer` | Send guidance to running agent |

### Real-time Events
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events/stream` | SSE stream for real-time updates |

### Data (CRUD)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/data/projects` | List/create projects |
| GET/PATCH/DELETE | `/api/data/projects/:id` | Get/update/delete project |
| GET/PUT | `/api/data/projects/:id/plan` | Get/set plan nodes + edges |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Backend health check |

## Tech Stack

- **Frontend**: React 19, Vite 7, TypeScript (strict), Tailwind CSS v4, React Router v7, Zustand 5, @xyflow/react
- **UI**: shadcn/ui pattern (Radix primitives), lucide-react icons, cmdk command palette
- **Backend**: Hono.js, Drizzle ORM + SQLite, @anthropic-ai/claude-agent-sdk
- **Relay**: WebSocket server for agent runner communication
- **Deployment**: Cloudflare Pages (frontend) + Fly.io (backend, production)

## Testing

Nexus includes comprehensive CLI-testable workflows for automated testing:

```bash
# Run all tests
./scripts/test-runner.sh

# Run unit tests only (fast, parallel)
./scripts/test-runner.sh --unit

# Run integration tests
./scripts/test-runner.sh --integration

# Run end-to-end workflow test
./scripts/test-runner.sh --e2e
```

**Test Coverage:**
- ✅ User authentication (WebAuthn + IndexedDB modes)
- ✅ Device authorization flow (OAuth2 RFC 8628)
- ✅ Project/task CRUD operations
- ✅ Machine registration and management
- ✅ Task dispatch and execution
- ✅ Real-time events (SSE)
- ✅ Database mode detection

See [TESTING.md](TESTING.md) for complete testing guide.

## Building & Deployment

```bash
npm run build     # TypeScript check + Vite production build → dist/
npm run deploy    # Build + deploy to Cloudflare Pages
npm run lint      # ESLint
```

### Deployment Considerations

**Default Mode**: Nexus runs as a **single-user application** with local SQLite storage. This is perfect for personal use and development.

**Multi-User Mode**: Nexus includes a complete **Supabase + authentication implementation** for multi-tenant deployment:

✅ **Already Implemented**:
1. **PostgreSQL Schema** (`supabase/migrations/20260209000000_initial_schema.sql`)
   - Full migration from SQLite to PostgreSQL
   - Row Level Security (RLS) policies for user isolation
   - WebAuthn passkey authentication (passwordless)
   - Project access control (owner/editor/viewer roles)
   - Realtime subscriptions for live updates

2. **Authentication System**
   - Passkey-based sign-up/sign-in (WebAuthn)
   - Session management via Supabase Auth
   - Protected API routes with user context
   - Auth guard for frontend routes

3. **Multi-Tenancy**
   - All data scoped by `user_id = auth.uid()`
   - Projects, machines, tasks properly isolated
   - Shared project access via member roles

**To Enable Multi-User Mode**:

See [`setup_auth.md`](setup_auth.md) for complete setup instructions. Quick summary:

```bash
# Option 1: Supabase Cloud (recommended)
# 1. Create project at supabase.com
# 2. Run migration in SQL editor
# 3. Set environment variables:
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...  # backend only

# Option 2: Local Supabase (Docker)
npx supabase init
npx supabase start  # Local at http://127.0.0.1:54321
```

**Production Stack**:
- **Frontend**: Cloudflare Pages
- **Backend**: Fly.io (Hono + WebSocket relay)
- **Database**: Supabase PostgreSQL (cloud or self-hosted)
- **Auth**: Supabase Auth (WebAuthn passkeys)
- **Redis**: Upstash Redis (optional, for horizontal scaling)

**Cost Estimate** (using Supabase cloud):
| Service | Tier | Monthly |
|---------|------|---------|
| Cloudflare Pages | Free | $0 |
| Fly.io Backend | 1x shared-cpu, 256MB | ~$5 |
| Supabase | Free tier | $0 (up to 500MB DB) |
| Upstash Redis (optional) | Pay-per-request | ~$1-5 |
| **Total** | | **~$5-10** |

## Known Issues

- Pre-existing lint errors in `packages/agent-runner` — do not attempt to fix
- `@radix-ui/react-tabs` must be installed separately (not included by default)
- Tailwind v4 uses `@tailwindcss/vite` plugin, NOT `@tailwindcss/postcss`
- React Router v7 uses `react-router` package, not `react-router-dom`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, coding standards, and pull request guidelines.

## Support

For questions or issues, please open an issue on [GitHub](https://github.com/fuxialexander/nexus/issues).

## Acknowledgments

Built with [React](https://react.dev/), [Vite](https://vite.dev/), [Hono](https://hono.dev/), [Tailwind CSS](https://tailwindcss.com/), [React Flow](https://reactflow.dev/), [Zustand](https://zustand-demo.pmnd.rs/), [Drizzle ORM](https://orm.drizzle.team/), and [Anthropic Claude](https://www.anthropic.com/).
