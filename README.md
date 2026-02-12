# Nexus

> A planning-first platform for builders and scientists — AI-assisted task decomposition, multi-environment execution, and real-time progress tracking.

Nexus sits above execution tools (coding agents, analysis tools) to help users decompose complex goals into dependency graphs, dispatch tasks across environments (local, HPC, cloud), and focus human attention on strategic decisions.

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
- **Anthropic API key** (for AI plan generation)

Redis is **not required** for local development. It's only needed for horizontal scaling in production.

## Getting Started

```bash
# Clone the repository
git clone git@github.com:fuxialexander/nexus.git
cd nexus

# Use correct Node.js version (if using nvm)
nvm use

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env and set your ANTHROPIC_API_KEY
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

### Verify Setup

```bash
npm run verify    # Check Node version, dependencies, port availability, config
```

### Environment Variables

The only required variable for local development is `ANTHROPIC_API_KEY`. See `.env.example` for the full list:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | **Yes** | Anthropic API key for AI features |
| `PORT` | No | Backend port (default: 3001) |
| `RELAY_PORT` | No | WebSocket relay port (default: 3002) |
| `REDIS_URL` | No | Redis URL for horizontal scaling (not needed locally) |
| `CLOUDFLARED_DOMAIN` | No | Domain for Cloudflare tunnel (remote agent connectivity) |

### Remote Agent Setup

To connect a remote machine (e.g. HPC cluster, cloud VM) to your local Nexus server:

**Prerequisites**: [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed on the server machine, a Cloudflare domain configured.

**1. Server — start the tunnel**

Set your domain in `.env`:
```
CLOUDFLARED_DOMAIN=yourdomain.com
```

Then start the tunnel (creates it on first run):
```bash
./scripts/start-tunnel.sh
```

This exposes `nexus-api.yourdomain.com` (port 3001) and `nexus-relay.yourdomain.com` (port 3002) via Cloudflare Tunnel.

**2. Remote machine — setup and start the agent**

On the remote machine, clone the repo and run:
```bash
git clone git@github.com:fuxialexander/nexus.git
cd nexus
./scripts/agent-setup.sh yourdomain.com
```

This builds the agent runner, runs the device auth flow (you approve in your browser), and starts the agent. The machine will appear in the Environments page.

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

## Building & Deployment

```bash
npm run build     # TypeScript check + Vite production build → dist/
npm run deploy    # Build + deploy to Cloudflare Pages
npm run lint      # ESLint
```

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
