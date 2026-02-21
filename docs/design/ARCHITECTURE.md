# Astro — Global Architecture

## 1. System Overview

Astro is a planning-first platform for software developers and researchers. It provides an AI-assisted planning layer that decomposes complex goals into executable tasks, manages dependencies across environments (local, remote, HPC, cloud), and orchestrates AI agents to execute those tasks.

### 1.1 The Four Components

Astro consists of four logical components. Depending on the operating mode, they may run on the same machine or be distributed across the internet.

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  USER-FACING (what the user interacts with)                            │
 │                                                                        │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │  FRONTEND — Browser (React SPA)                                  │  │
 │  │  Vite dev: localhost:5173 / Prod: Cloudflare Pages               │  │
 │  │                                                                  │  │
 │  │  • UI rendering (pages, graph, terminal, chat)                   │  │
 │  │  • Local state (18 Zustand stores + IndexedDB)                   │  │
 │  │  • SSE event consumption (real-time updates)                     │  │
 │  │  • User inputs: create projects, execute tasks, chat, steer      │  │
 │  └──────────────────────┬────────────────────┬──────────────────────┘  │
 │                         │ HTTP/SSE            │ SSE (events/stream)    │
 │                         │ (REST + streaming)  │ (persistent)           │
 │                         ▼                     ▼                        │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │  BACKEND — Hono API Server                                       │  │
 │  │  Dev: localhost:3001 / Prod: Fly.io                              │  │
 │  │                                                                  │  │
 │  │  • HTTP API (22 route files, auth middleware)                     │  │
 │  │  • Data persistence (Postgres via Drizzle, or IndexedDB proxy)   │  │
 │  │  • SSE event broadcasting (events → browser)                     │  │
 │  │  • Dispatch coordination (queue, routing, context assembly)       │  │
 │  │  • Observability (Langfuse tracing, audit logs, usage metrics)    │  │
 │  │  • Compute backend detection (Docker, SSH, K8s, SLURM)           │  │
 │  │  • Provider detection (AI providers available on server)          │  │
 │  └──────────────────────┬───────────────────────────────────────────┘  │
 │                         │ In-process function calls + EventEmitter     │
 │                         ▼                                              │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │  RELAY — WebSocket Hub                                           │  │
 │  │  Dev: localhost:3002 / Prod: same Fly.io VM                      │  │
 │  │                                                                  │  │
 │  │  • Machine registry (connected agent runners)                    │  │
 │  │  • Task routing (dispatch to best available machine)             │  │
 │  │  • Heartbeat monitoring (30s ping/pong)                          │  │
 │  │  • Authentication (JWT in server mode, open in local mode)       │  │
 │  │  • Redis pub/sub for horizontal scaling (optional)               │  │
 │  └──────────────────────┬───────────────────────────────────────────┘  │
 │                         │ WebSocket (ws:// local, wss:// server)       │
 │                         ▼                                              │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │  AGENT RUNNER — Execution Engine (separate process)              │  │
 │  │  Runs on user's machine(s), connects to relay                    │  │
 │  │                                                                  │  │
 │  │  • AI execution (Claude SDK, Claude CLI, Codex)                  │  │
 │  │  • Git worktree management (isolated branches per task)          │  │
 │  │  • Safety checks (git state, parallel execution)                 │  │
 │  │  • PR creation (push branch, gh pr create)                       │  │
 │  │  • Execution strategies (Direct, Docker, SLURM, K8s Exec)       │  │
 │  │  • MCP server for Claude Code integration                        │  │
 │  └──────────────────────────────────────────────────────────────────┘  │
 └─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Process Responsibilities

| Component | Responsibility | Does NOT do |
|-----------|---------------|-------------|
| **Frontend** (Browser) | UI rendering, local state (Zustand + IndexedDB), SSE event consumption, user interactions | Call AI directly, persist to Postgres |
| **Backend** (Hono API Server) | HTTP API, auth, data persistence (Postgres), SSE event broadcasting, dispatch coordination, observability, compute backend detection | Execute AI tasks (target architecture) |
| **Relay** (WebSocket Hub) | Machine registry, task routing, heartbeat monitoring, JWT auth (server mode) | Store data, make AI calls, detect backends |
| **Agent Runner** (Execution Engine) | AI execution (Claude SDK/CLI/Codex), worktree management, safety checks, PR creation, execution strategies | Serve HTTP, persist application data, detect SSH backends |

### 1.3 Note on Current vs Target State

Currently, the Backend **does** call AI directly for several endpoints (`/chat`, `/task-chat`, `/dispatch` local path, `/summarize`, `/generate-plan` local path). The target architecture moves all AI calls to the Agent Runner, routing through the Relay. See `docs/SERVER_LOCAL_MODE_SEPARATION.md` for the migration plan.

---

## 2. Two Operating Modes

### 2.1 Local Mode (Single User)

All four components run on the **same physical machine**. Even though they share a machine, they are separate processes with distinct roles.

```
USER'S MACHINE (all components co-located)
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌─────────────────────────────┐                                 │
│  │  [FRONTEND] Browser         │                                 │
│  │  localhost:5173              │                                 │
│  │  • IndexedDB = primary store│                                 │
│  │  • No login required        │                                 │
│  └──────────┬─────────┬────────┘                                 │
│             │ HTTP    │ SSE                                       │
│             │ REST    │ events/stream                             │
│             ▼         ▼                                           │
│  ┌──────────────────────────────┐                                │
│  │  [BACKEND] Hono API Server   │                                │
│  │  localhost:3001              │                                 │
│  │  • No Postgres (IndexedDB    │                                │
│  │    mode, data in browser)    │                                │
│  │  • No auth (single user)     │                                │
│  │  • Detects local backends:   │                                │
│  │    Docker, SSH*, K8s, SLURM  │                                │
│  └──────────┬───────────────────┘                                │
│             │ In-process calls                                    │
│             ▼                                                     │
│  ┌──────────────────────────────┐                                │
│  │  [RELAY] WebSocket Hub       │                                │
│  │  localhost:3002              │                                 │
│  │  • No TLS, no JWT            │                                │
│  │  • ws:// connections         │                                │
│  └──────────┬───────────────────┘                                │
│             │ WebSocket (ws://localhost:3002)                      │
│             ▼                                                     │
│  ┌──────────────────────────────┐                                │
│  │  [AGENT RUNNER] astro-agent  │                                │
│  │  (separate process)          │                                │
│  │  • Holds Claude credentials  │                                │
│  │  • Executes AI tasks         │                                │
│  │  • Manages worktrees         │                                │
│  │  • Creates PRs               │                                │
│  │  • Execution strategies:     │                                │
│  │    Direct, Docker, SLURM,    │                                │
│  │    K8s Exec                  │                                │
│  └──────────────────────────────┘                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

* SSH hosts detected by Backend for display but NOT executable (see Section 9)
```

**Key properties:**
- **Auth**: None. Single user, no login required.
- **Database**: IndexedDB in the browser is the primary store. No Postgres needed.
- **Relay**: Runs on localhost. No TLS, no JWT. Acts as a uniform dispatch interface.
- **Agent Runner**: Runs on the same machine. Holds the user's Claude credentials (OAuth token or API key).
- **Detection**: `USE_INDEXEDDB_ONLY=true` env var, or auto-detected when Supabase env vars are absent.
- **Start**: `npm run dev` (backend+relay) then `npx astro-agent start -f` (agent runner).

### 2.2 Server Mode (Multi-User)

Frontend is served from a CDN. Backend + Relay run on a cloud VM. Agent Runners run on users' own machines and connect over the internet.

```
              USER'S BROWSER                    CLOUD (Fly.io VM)
          ┌──────────────────┐           ┌──────────────────────────┐
          │  [FRONTEND]      │   HTTPS   │  [BACKEND] Hono          │
          │  Browser         │ ────────→ │  port 3001               │
          │  (Cloudflare     │ ←──────── │  • Postgres (Supabase)   │
          │   Pages CDN)     │    SSE    │  • JWT auth (WebAuthn)   │
          │                  │           │  • Observability          │
          │  • IndexedDB =   │           │                          │
          │    offline cache │           │  [RELAY] WebSocket Hub   │
          │  • WebAuthn login│           │  port 3002               │
          └──────────────────┘           │  • JWT-authenticated     │
                                         │  • TLS (wss://)          │
                                         │  • Redis pub/sub         │
                                         │    (optional, scaling)   │
                                         └────────┬─────────────────┘
                                                  │ WSS (internet)
                                                  │
                          ┌───────────────────────┼────────────────────────┐
                          │                       │                        │
                          ▼                       ▼                        ▼
               ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
               │ [AGENT RUNNER]     │  │ [AGENT RUNNER]     │  │ [AGENT RUNNER]     │
               │ User A's laptop   │  │ User A's HPC       │  │ User B's laptop   │
               │ • Claude SDK      │  │ • Claude SDK       │  │ • Claude CLI      │
               │ • Direct strategy │  │ • SLURM strategy   │  │ • Docker strategy │
               │ • JWT auth        │  │ • JWT auth         │  │ • JWT auth        │
               └────────────────────┘  └────────────────────┘  └────────────────────┘
```

**Key properties:**
- **Auth**: WebAuthn/passkey via Supabase Auth. JWT tokens for API and WebSocket access.
- **Database**: Supabase/Postgres is the source of truth. IndexedDB serves as browser-side cache for fast startup and offline resilience.
- **Relay**: Handles TLS (wss://), JWT authentication, heartbeat, auto-reconnection.
- **Agent Runner**: Runs on the user's own machine(s), connects to server relay over the internet. Device code flow (RFC 8628) for initial authentication.
- **Multi-user**: Data isolated by Postgres RLS. Each user sees only their projects and machines.
- **Detection**: Supabase env vars present and `USE_INDEXEDDB_ONLY` not set.

### 2.3 Mode Detection

**Backend** (`server/lib/app-mode.ts` and `server/lib/environment.ts`):
```
isIndexedDBMode():
  1. USE_INDEXEDDB_ONLY=true  → true (explicit override)
  2. Supabase env vars absent → true (auto-detect)
  3. Otherwise               → false

isLocalMode()  = isIndexedDBMode()
isServerMode() = !isIndexedDBMode()
```

**Frontend** (`src/lib/app-mode.ts`):
```
isLocalMode():
  Uses shouldUseSupabase() from supabase-client.ts
  Checks same env vars via Vite's import.meta.env
```

---

## 3. Task Execution Workflow

The core workflow is the same in both modes — only the transport security and persistence differ. Each step is labeled with the component that performs it.

### 3.1 Dispatch Phase

| Step | Component | Action | Sends to |
|------|-----------|--------|----------|
| 1 | **Frontend** | User clicks "Execute" on a plan node | — |
| 2 | **Frontend** | Validate: node exists, not already running, dependencies met, working directory configured | — |
| 3 | **Frontend** | Build dependency outputs from completed upstream tasks | — |
| 4 | **Frontend** | `POST /api/dispatch/task` with `{ nodeId, projectId, environment, visionDoc, dependencyOutputs, preferredProvider, targetMachineId, model }` | Backend |
| 5 | **Backend** | Validate input (Zod schema) | — |
| 6 | **Backend** | Assemble execution context: inject vision doc + dependency outputs + repo context | — |
| 7 | **Backend** | Select machine: `machineRegistry.findBestMachine()` or use `targetMachineId` | — |
| 8 | **Backend** | Call `relayServer.dispatchTask(task)` (in-process function call) | Relay |
| 9 | **Relay** | Send `task.dispatch` WebSocket message to selected Agent Runner | Agent Runner |

### 3.2 Execution Phase

| Step | Component | Action | Sends to |
|------|-----------|--------|----------|
| 10 | **Agent Runner** | Safety check: is working directory a git repo? Uncommitted changes? Parallel tasks? | — |
| 11 | **Agent Runner** | If safety tier is RISKY: send `task.approval_request` → wait for user decision via Relay → Frontend → Relay → Agent Runner | Relay (round-trip) |
| 12 | **Agent Runner** | Create git worktree: `git worktree add -b astro/{taskId}` in `~/.astro/worktrees/` | — |
| 13 | **Agent Runner** | Create provider adapter (Claude SDK, Claude CLI, or Codex) based on task config | — |
| 14 | **Agent Runner** | Start AI session: `adapter.execute(task, stream, signal)` | — |

### 3.3 Streaming Phase (repeats for each AI turn)

| Step | Component | Action | Sends to |
|------|-----------|--------|----------|
| 15 | **Agent Runner** | AI produces output → stream callbacks fire | Relay |
| 16 | **Agent Runner** | Send WebSocket messages: `task.text`, `task.tool_use`, `task.tool_result`, `task.file_change`, `task.progress` | Relay |
| 17 | **Relay** | Forward events to Backend via EventEmitter | Backend |
| 18 | **Backend** | Push events through `AstroEventTransport` hooks (SSE, audit, observability, usage) | Frontend |
| 19 | **Frontend** | Receive SSE events, update `executionStore`: append text, add tool traces, add file changes | — |
| 20 | **Frontend** | UI updates live: terminal output, tool trace timeline, file changes list, progress bar | — |

### 3.4 Completion Phase

| Step | Component | Action | Sends to |
|------|-----------|--------|----------|
| 21 | **Agent Runner** | AI session ends. If success: `pushAndCreatePR()` (push branch, `gh pr create`) | — |
| 22 | **Agent Runner** | Cleanup worktree (unless `--preserve-worktrees`) | — |
| 23 | **Agent Runner** | Send `task.result` with `{ status, output, branchName, prUrl, prNumber }` | Relay |
| 24 | **Relay** | Forward result event to Backend | Backend |
| 25 | **Backend** | Run hooks: observability (Langfuse trace), usage metrics, audit log | — |
| 26 | **Backend** | Push `result` SSE event to Frontend | Frontend |
| 27 | **Frontend** | Update plan node status: `auto_verified` (if success + auto verification) or `awaiting_judgment` | — |
| 28 | **Frontend** | Accumulate usage metrics in `usageStore` | — |
| 29 | **Frontend** | Persist execution to IndexedDB (and Supabase API in server mode) | — |
| 30 | **Frontend** | If batch mode: check for newly-unblocked tasks, auto-dispatch next wave | — |

### 3.5 Local vs Server Mode Differences

The workflow above is identical in both modes. The differences are in transport and persistence:

| Aspect | Local Mode | Server Mode |
|--------|-----------|-------------|
| Frontend → Backend transport | `http://localhost:3001` | `https://astro-api.domain` (HTTPS) |
| Auth on HTTP requests | None (or `X-User-Id` header) | `Authorization: Bearer <JWT>` |
| Relay → Agent Runner transport | `ws://localhost:3002` | `wss://astro-relay.domain` (TLS) |
| Auth on WebSocket | None | JWT in `Authorization` header |
| Backend persistence (step 25) | No database write (IndexedDB mode) | Write to Postgres via Drizzle |
| Frontend persistence (step 29) | IndexedDB = primary store | IndexedDB = cache, Supabase = primary |
| Machine selection (step 7) | Usually one local machine | May route to multiple remote machines |
| SSE events transport | `/api/events/stream` on localhost | `/api/events/stream` over HTTPS |

**Important**: Even in local mode, the Backend does NOT call AI directly in the target architecture. It always routes through the Relay to the Agent Runner. The Relay happens to be on localhost, but the protocol is identical to server mode.

---

## 5. Package Structure

```
astro/
├── src/                           # [FRONTEND] React SPA (Vite)
│   ├── app.tsx                    # Root: BrowserRouter, DataLoader, routes
│   ├── pages/                     # Route pages (dashboard, projects, plan-view, etc.)
│   ├── components/                # UI components (shadcn/ui pattern)
│   ├── stores/                    # Zustand state management (18 stores)
│   ├── lib/                       # Utilities (API client, SSE parser, DB wrapper)
│   └── types/                     # TypeScript interfaces
│
├── server/                        # [BACKEND] Hono API Server + [RELAY]
│   ├── index.ts                   # Server entry: middleware, routes, startup, relay init
│   ├── routes/                    # 22 route files (agent, dispatch, events, relay, etc.)
│   ├── middleware/                # Auth middleware (WebAuthn + local mode)
│   ├── lib/                       # Core libraries
│   │   ├── relay-server.ts        # [RELAY] WebSocket relay server
│   │   ├── machine-registry.ts    # [RELAY] Connected machine tracking
│   │   ├── local-backends.ts      # [BACKEND] Compute backend detection (Docker, SSH, K8s, SLURM)
│   │   ├── dispatch/              # Dispatch engine, queue, context, routing
│   │   ├── providers/             # AI provider adapters (current state, target: remove)
│   │   ├── events/                # Event transport + hooks
│   │   ├── observability/         # Langfuse tracing, observation collector
│   │   ├── db/                    # Drizzle ORM + Postgres schema (24 tables)
│   │   └── slurm/                 # HPC cluster support
│   ├── types/                     # Relay protocol types
│   └── test/                      # Integration tests
│
├── packages/
│   └── agent-runner/              # [AGENT RUNNER] (npm: @astro/agent, binary: astro-agent)
│       ├── src/
│       │   ├── cli.ts             # CLI entry point (10 commands)
│       │   ├── commands/          # CLI commands (start, setup, status, etc.)
│       │   ├── lib/               # Core: task executor, WebSocket client, safety, worktree, git-pr
│       │   ├── providers/         # AI provider adapters (claude-code, claude-sdk, codex)
│       │   ├── execution/         # Execution strategies (direct, docker, slurm, k8s, skypilot)
│       │   ├── mcp/               # MCP server for Claude Code integration
│       │   └── types.ts           # Agent runner types
│       └── package.json
│
├── cli/
│   └── astro-agent/               # CLI wrapper/distribution
│
└── docs/                          # Documentation
    └── design/                    # Design documentation (this folder)
```

---

## 6. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend framework | React 19 + Vite 7 | SPA with fast HMR |
| Styling | Tailwind CSS v4 | Utility-first CSS |
| Routing | React Router v7 | Client-side routing |
| State management | Zustand 5 | Lightweight stores with selectors |
| Local persistence | idb-keyval (IndexedDB) | Browser-side key-value store |
| Graph visualization | @xyflow/react (React Flow) | Plan DAG rendering |
| UI components | shadcn/ui pattern (Radix primitives) | Accessible, composable UI |
| Backend framework | Hono.js | Lightweight HTTP framework |
| Real-time | Server-Sent Events (SSE) | Server → browser streaming |
| WebSocket | ws library | Relay ↔ agent runner communication |
| Database | Drizzle ORM + PostgreSQL | Multi-user persistence (server mode) |
| Auth | WebAuthn/passkeys + Supabase Auth | Passwordless authentication |
| AI SDK | @anthropic-ai/claude-agent-sdk | Plan generation, chat, task execution |
| AI CLI | Claude Code CLI (`claude`) | Agent execution via subprocess |
| Observability | Langfuse | LLM trace export |
| Deployment (frontend) | Cloudflare Pages | Static site hosting |
| Deployment (backend) | Fly.io | Container hosting |
| Horizontal scaling | Redis pub/sub | Multi-instance relay coordination |

---

## 7. Communication Protocols

### 7.1 Frontend ↔ Backend

**HTTP REST**: Standard request/response for CRUD operations, configuration, and triggering actions.

**SSE (Server-Sent Events)**: Two patterns:
1. **Action SSE**: POST to `/api/agent/generate-plan`, `/api/dispatch/task`, etc. returns an SSE stream for that specific operation. Browser reads via `EventSource`-like parsing of `fetch()` response body.
2. **Event stream**: GET `/api/events/stream` is a persistent SSE connection for real-time events (machine state, task progress, approvals). Browser connects on startup via `EventSource`.

### 7.2 Backend ↔ Relay

The Backend and Relay run in the same Node.js process (`server/index.ts`). They communicate via:
- **Function calls**: `relayServer.dispatchTask()`, `relayServer.cancelTask()`, etc.
- **EventEmitter**: `relayServer.on('task:result', ...)`, `relayServer.on('machine:connected', ...)`

### 7.3 Relay ↔ Agent Runner

**WebSocket**: JSON messages with a `type` field. See `RELAY.md` for the full protocol.

**Direction: Relay → Agent Runner**:
- `task.dispatch` — Execute a task
- `task.cancel` — Cancel a running task
- `task.steer` — Inject guidance into a running session
- `task.approval_response` — User's answer to an approval request
- `task.safety_decision` — User's decision on a safety prompt
- `file_list.request` — Request git file listing
- `repo_setup.request` — Clone/init repository

**Direction: Agent Runner → Relay**:
- `task.result` — Task completed (status, output, PR info)
- `task.stdout` — Stdout chunk (sequence-numbered)
- `task.text` — Structured text output
- `task.session_init` — Session initialized (sessionId, model)
- `task.tool_use` — Tool invocation
- `task.tool_result` — Tool completion
- `task.file_change` — File modified/created/deleted
- `task.progress` — Progress percentage
- `task.approval_request` — Agent needs user decision
- `task.steer_ack` — Steering message received
- `heartbeat.pong` — Response to heartbeat ping

---

## 8. Event System

Events flow from execution sources (agent runners via relay, or local providers) through the backend to the browser:

```
Agent Runner (via Relay)          Local Provider (via executionEventBus)
          │                                     │
          ▼                                     ▼
    Relay Server                        executionEventBus
          │                                     │
          └──────── both feed into ────────┬────┘
                                           │
                                           ▼
                                  /api/events/stream (SSE)
                                           │
                                           ▼
                                  AstroEventTransport
                                    (7 hooks)
                                           │
          ┌──────┬──────┬──────┬───────────┼──────┬──────┐
          ▼      ▼      ▼      ▼           ▼      ▼      ▼
        SSE   Audit  Usage    PR       Git-Pull Channel Observability
       Notif   Log  Metrics Creation    Hook    Notif   (Langfuse)
```

The `executionEventBus` is a Node.js `EventEmitter` singleton (survives tsx watch reloads via `globalThis`). Both the local execution path and the relay path emit events to it, so the SSE bridge and observability system have a single event source.

---

## 9. Compute Discovery, Execution Strategies, and Multi-Machine Architecture

This section explains how Astro discovers available computing resources, how it executes tasks across different environments, and how multiple machines work together. This is one of the most architecturally complex parts of the system — getting it right is critical for supporting researchers and developers who work across laptops, HPC clusters, cloud VMs, and Kubernetes.

### 9.1 Two Detection Systems (Current State)

There are two separate detection systems that discover compute resources. They serve different purposes:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ BACKEND DETECTION (server-side)              PURPOSE: UI DISPLAY ONLY   │
│ File: server/lib/local-backends.ts                                      │
│                                                                          │
│ Detects: Docker, Kubernetes, SLURM, SSH hosts                           │
│ Exposed via: GET /api/health/backends                                    │
│ Result: Shows in Environments page so user can see what's available      │
│ Can execute tasks? NO — visualization only                               │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│ AGENT RUNNER DETECTION (on user's machine)   PURPOSE: TASK EXECUTION    │
│ Location: packages/agent-runner/src/execution/                           │
│                                                                          │
│ Detects: Direct, Docker, SLURM, K8s Exec, SkyPilot                     │
│ Reported to: Relay during machine registration                           │
│ Result: Agent runner knows how to execute tasks using these strategies   │
│ Can execute tasks? YES — this is where tasks actually run               │
└──────────────────────────────────────────────────────────────────────────┘
```

| System | Location | What It Detects | Purpose | Can Execute? |
|--------|----------|-----------------|---------|-------------|
| Backend detection | `server/lib/local-backends.ts` | Docker, K8s, SLURM, SSH hosts | UI display in Environments page | No — visualization only |
| Agent Runner strategies | `packages/agent-runner/src/execution/` | Direct, Docker, SLURM, K8s, SkyPilot | Task execution | Yes — tasks run here |

### 9.2 Execution Strategies — Sync vs Async

Execution strategies fall into two categories based on how they interact with the underlying compute:

**Synchronous strategies**: The agent runner runs a command and waits for it to finish. Output streams back in real time. The agent runner's process is "blocked" until the command completes.

**Asynchronous strategies**: The agent runner submits a job to a **resource manager** (SLURM scheduler, cloud orchestrator) and then polls for completion. The resource manager decides when and where to run the job — there may be a queue, or resources may need to be provisioned.

| Strategy | Sync/Async | Where Commands Run | Agent Runner Needed There? | Why |
|----------|-----------|-------------------|--------------------------|-----|
| Direct | Sync | Same machine as agent runner | Yes (it IS the agent runner's machine) | Local process execution |
| Docker | Sync | Same machine, inside container | No (Docker daemon manages containers) | Containers run locally |
| SLURM | **Async** | HPC compute nodes (allocated by scheduler) | Agent runner on **login node** only | AI needs HPC filesystem + sbatch commands |
| K8s Exec | Sync | Existing Kubernetes pod | No (kubectl connects remotely) | kubectl manages the connection |
| SkyPilot | **Async** | Cloud VM (provisioned on-demand) | No (sky CLI manages VMs remotely) | **Experimental — not currently supported** |

### 9.3 Where Agent Runners Need to Be Installed

This is the key architectural question: which machines need their own agent runner?

**Local laptop/workstation**: Agent runner installed directly. The base case. AI has full filesystem access, can run commands, create git worktrees, etc.

**SLURM HPC cluster**: Agent runner installed on the **login node** (the gateway machine with sbatch, sinfo, squeue). Compute nodes do NOT have agent runners — they are managed by the SLURM scheduler. The AI writes SLURM scripts, submits with sbatch, monitors with squeue/sacct.

**Kubernetes cluster**: Agent runner does NOT need to be on the cluster. kubectl is configured on the user's machine and connects remotely. The agent runner on the laptop uses kubectl to exec into pods.

**Rented cloud VMs (Lambda Labs, Hyperbolic AI, etc.)**: These are bare metal or Linux machines you rent on-demand and SSH into. Install an agent runner on each one. From the agent runner's perspective, it is just a regular machine — it uses the **Direct strategy**. The VM connects back to the relay independently. These VMs may also be interconnected via SSH.

**Remote VM (via SSH)**: Same as above — agent runner SHOULD be installed on the VM. The VM connects back to the relay as a separate machine with its own capabilities (GPUs, Docker, etc.).

**Cloud VMs via SkyPilot (experimental)**: SkyPilot is a tool that *provisions* cloud VMs using `sky launch`. It sits on a machine with cloud credentials. The agent runner does NOT need to be on the provisioned VM — SkyPilot manages it remotely. **Not currently supported.**

### 9.4 SSH Connection Types

SSH connections are not all the same. They connect to fundamentally different types of targets, each requiring different handling:

```
SSH from user's laptop connects to:

┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  1. HPC LOGIN NODE (gateway to cluster)                                │
│     ┌──────────┐     sbatch      ┌──────────────────┐                  │
│     │ Login    │ ──────────────→ │ Compute Nodes    │                  │
│     │ Node     │     squeue      │ (GPUs, CPUs)     │                  │
│     │          │ ←───────────── │ Managed by SLURM │                  │
│     └──────────┘                 └──────────────────┘                  │
│     Install agent runner here.                                         │
│     AI submits jobs via sbatch.                                        │
│     Compute nodes are NOT directly accessible.                         │
│                                                                         │
│  2. COMPUTE VM (has CPU/GPU, runs tasks directly)                      │
│     ┌──────────┐                                                       │
│     │ VM       │  Has GPUs, Docker, local packages                     │
│     │ 8×A100   │  Install agent runner here.                           │
│     │          │  AI executes tasks directly on this machine.          │
│     └──────────┘                                                       │
│                                                                         │
│  3. STORAGE SERVER (NFS/PVC mount, data only)                          │
│     ┌──────────┐                                                       │
│     │ NFS      │  No computation.                                      │
│     │ Server   │  Mounted as shared filesystem.                        │
│     │          │  No agent runner needed.                               │
│     └──────────┘  Data accessed by other machines that mount it.       │
│                                                                         │
│  4. RENTED CLOUD VM (Lambda Labs, Hyperbolic AI, etc.)                 │
│     ┌──────────┐                                                       │
│     │ Lambda   │  Bare metal or Linux machines rented on-demand.       │
│     │ Labs VM  │  SSH in, install agent runner.                        │
│     │ 8×A100   │  Uses Direct strategy (it's just a Linux machine).   │
│     └──────────┘  May be interconnected with other rented VMs.        │
│     Install agent runner. This is NOT SkyPilot — no provisioning      │
│     tool needed. You already have access.                              │
│                                                                         │
│  5. CLOUD INSTANCE (AWS EC2, GCP VM, Azure VM)                         │
│     ┌──────────┐                                                       │
│     │ EC2      │  If you're ON the VM → Direct strategy (same as      │
│     │ Instance │  any Linux machine with agent runner installed).      │
│     │ p3.8xl   │  If provisioning VMs → SkyPilot (experimental).      │
│     └──────────┘  Future: native AWS/GCP/Azure strategies.            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Current state**: The backend detects all SSH hosts from `~/.ssh/config` and shows them in the UI, but does not distinguish between these types. A storage server appears the same as a GPU VM.

**Intended state**: The Environments page should classify SSH hosts by type and offer appropriate actions:
- HPC login node → "Install Agent Runner (SLURM detected)"
- Compute VM → "Install Agent Runner"
- Rented cloud VM (Lambda Labs, Hyperbolic AI, etc.) → "Install Agent Runner"
- Storage server → "Mount as shared filesystem" (no agent runner)
- Cloud instance (AWS/GCP/Azure) → "Install Agent Runner" (if you have access) or future SkyPilot provisioning

### 9.5 The Complete Multi-Machine Architecture

Here is a realistic scenario showing how all the pieces fit together. A researcher has:
- A laptop (CPU only, macOS)
- Access to an HPC cluster via SSH (SLURM, GPU compute nodes)
- Access to a Kubernetes cluster (for microservices)
- Access to a GPU VM (via SSH, 8 GPUs)
- That GPU VM has SSH access to 4 more VMs, all with Claude Code

```
                              ┌─────────────────────────────────┐
                              │           ASTRO RELAY            │
                              │      (WebSocket hub, :3002)      │
                              │                                  │
                              │  Machine Registry:               │
                              │  • laptop (Direct, Docker, K8s)  │
                              │  • hpc-login (SLURM, Direct)     │
                              │  • gpu-vm-0 (Direct, Docker)     │
                              │  • gpu-vm-1 (Direct)             │
                              │  • gpu-vm-2 (Direct)             │
                              │  • gpu-vm-3 (Direct)             │
                              │  • gpu-vm-4 (Direct)             │
                              └──┬───┬───┬───┬───┬───┬───┬──────┘
                                 │   │   │   │   │   │   │
         ws:// ┌─────────────────┘   │   │   │   │   │   └─────────────┐
               │       ws:// ┌───────┘   │   │   │   └───────┐ ws://  │
               │             │     ws://─┘   └─ws://         │        │
               ▼             ▼          ▼         ▼          ▼        ▼
      ┌──────────────┐ ┌──────────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐
      │   LAPTOP     │ │ HPC      │ │GPU    │ │GPU    │ │GPU    │ │GPU    │
      │              │ │ LOGIN    │ │VM-0   │ │VM-1   │ │VM-2   │ │VM-3   │
      │ Agent Runner │ │ NODE     │ │       │ │       │ │       │ │       │
      │ ┌──────────┐ │ │ Agent    │ │Agent  │ │Agent  │ │Agent  │ │Agent  │
      │ │Claude SDK│ │ │ Runner   │ │Runner │ │Runner │ │Runner │ │Runner │
      │ └──────────┘ │ │          │ │       │ │       │ │       │ │       │
      │ Strategies:  │ │Claude SDK│ │Claude │ │Claude │ │Claude │ │Claude │
      │ • Direct     │ │          │ │Code   │ │Code   │ │Code   │ │Code   │
      │ • Docker     │ │Strategies│ │       │ │       │ │       │ │       │
      │ • K8s Exec   │ │• SLURM   │ │Direct │ │Direct │ │Direct │ │Direct │
      │              │ │• Direct  │ │Docker │ │       │ │       │ │       │
      │   kubectl ───┼─┤          │ │8 GPUs │ │4 GPUs │ │4 GPUs │ │4 GPUs │
      └──────────────┘ └────┬─────┘ └───────┘ └───────┘ └───────┘ └───────┘
               │             │
               │             │ sbatch
               ▼             ▼
      ┌──────────────┐ ┌──────────────────┐    ┌──────────────────┐
      │  KUBERNETES  │ │  HPC COMPUTE     │    │  NFS STORAGE     │
      │  CLUSTER     │ │  NODES           │    │  SERVER          │
      │              │ │                  │    │                  │
      │  Pods (no    │ │  Jobs (no agent  │    │  No agent runner │
      │  agent       │ │  runner — SLURM  │    │  Mounted by HPC  │
      │  runner)     │ │  scheduler       │    │  and VMs as      │
      │              │ │  manages them)   │    │  shared storage  │
      └──────────────┘ └──────────────────┘    └──────────────────┘
```

**Key observations:**

1. **Every machine with an agent runner connects independently to the relay.** The relay doesn't know or care about the SSH topology between machines. It sees 7 registered machines with different capabilities.

2. **Kubernetes and HPC compute nodes do NOT have agent runners.** They are managed by orchestrators (kubectl, SLURM) running on machines that DO have agent runners.

3. **The laptop uses kubectl for Kubernetes.** The K8s cluster can be anywhere — kubectl handles the connection.

4. **The HPC login node has the agent runner, not the compute nodes.** The AI submits SLURM jobs that run on compute nodes.

5. **Each GPU VM has its own agent runner.** This gives the AI full context about that VM's environment.

6. **The NFS storage server has no agent runner.** It provides shared storage that other machines mount. It is not a compute target.

7. **SSH is not an execution strategy — it is how you install agent runners** (via `ssh-installer.ts`) and how users initially access remote machines.

### 9.5.1 Rented Cloud VMs — A Common Scenario

A very common scenario for researchers and developers: renting on-demand GPU/CPU machines from providers like Lambda Labs, Hyperbolic AI, or similar services. These are not SkyPilot-managed — they are regular Linux machines you SSH into.

```
                              ┌─────────────────────────────────┐
                              │           ASTRO RELAY            │
                              │      (WebSocket hub, :3002)      │
                              │                                  │
                              │  Machine Registry:               │
                              │  • laptop (Direct, Docker)       │
                              │  • lambda-1 (Direct, Docker)     │
                              │  • lambda-2 (Direct, Docker)     │
                              │  • hyper-1 (Direct, Docker)      │
                              │  • cpu-pod-1 (Direct)            │
                              └──┬────┬────┬────┬────┬──────────┘
                                 │    │    │    │    │
            ┌────────────────────┘    │    │    │    └─────────────┐
            │         ┌───────────────┘    │    └──────────┐      │
            ▼         ▼                    ▼               ▼      ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────┐ ┌──────┐
   │  LAPTOP      │ │  LAMBDA VM 1 │ │  LAMBDA VM 2 │ │HYPER │ │CPU   │
   │  (macOS)     │ │  8×A100 GPUs │ │  4×H100 GPUs │ │VM 1  │ │POD 1 │
   │              │ │              │ │              │ │8×A6K │ │      │
   │  Agent       │ │  Agent       │ │  Agent       │ │Agent │ │Agent │
   │  Runner      │ │  Runner      │ │  Runner      │ │Runnr │ │Runnr │
   │  Claude SDK  │ │  Claude Code │ │  Claude Code │ │Code  │ │Code  │
   │              │ │              │ │              │ │      │ │      │
   │  Direct      │ │  Direct      │ │  Direct      │ │Dirct │ │Dirct │
   │  Docker      │ │  Docker      │ │  Docker      │ │Dockr │ │      │
   └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──┬───┘ └──────┘
          │ ssh             │ ssh            │ ssh         │
          ▼                 ▼                ▼             │
   (initial setup    (may SSH to      (may SSH to         │
    only — then       Lambda VM 2,     Hyper VM 1,        │
    agent runners     CPU Pod 1)       Lambda VM 1)       │
    communicate                                           │
    via relay)              ◄─── SSH interconnections ───►│
```

**Key points about rented VMs:**

1. **Each VM is independent from the relay's perspective.** Even if Lambda VM 1 and Lambda VM 2 can SSH to each other, they each connect to the relay independently.

2. **On the VM, it's just Direct strategy.** The agent runner detects what's available locally (GPUs, Docker, Python) and uses it directly. There's nothing "cloud" about the execution strategy.

3. **SSH is only for initial setup.** You SSH in once to install the agent runner. After that, the agent runner maintains its own WebSocket connection to the relay.

4. **Interconnected VMs enable distributed workflows.** If Lambda VM 1 needs to coordinate with Lambda VM 2, the plan graph handles this — Task A runs on VM 1, Task B (depending on A) runs on VM 2.

5. **CPU pods count too.** Not every rented machine has GPUs. CPU-only pods are useful for data preprocessing, web scraping, building, etc.

6. **This is the simplest cloud integration.** No cloud APIs, no provisioning tools, no SkyPilot. Rent a machine → SSH in → install agent runner → done.

### 9.6 How a Complex Workflow Executes

A plan graph with tasks targeting different machines:

```
Task A: "Build frontend"       → laptop      (Direct strategy)
    │
    ├── Task B: "Train model"  → hpc-login   (SLURM strategy → GPU compute nodes)
    │       │
    │       └── Task D: "Evaluate" → gpu-vm-0 (Direct strategy, 8 GPUs)
    │
    └── Task C: "Deploy API"   → laptop      (K8s Exec strategy → K8s cluster)
            │
            └── Task E: "Test" → gpu-vm-1    (Direct strategy)
```

| Step | What Happens |
|------|-------------|
| 1 | Frontend dispatches Task A to laptop's agent runner (Direct strategy) |
| 2 | Task A completes → Tasks B and C become unblocked |
| 3 | Backend dispatches Task B to hpc-login, Task C to laptop |
| 4 | On HPC login node: AI writes SLURM script, runs `sbatch`, monitors with `squeue` (async — waits for compute nodes) |
| 5 | On laptop: AI runs `kubectl exec` to deploy to K8s (sync) |
| 6 | Task B completes (SLURM job finishes) → Task D dispatched to gpu-vm-0 |
| 7 | Task C completes → Task E dispatched to gpu-vm-1 |
| 8 | Tasks D and E run in parallel on their respective VMs |
| 9 | All tasks complete → project done |

The backend coordinates all of this through the relay. It doesn't know about SSH tunnels, SLURM commands, or kubectl — it dispatches tasks to registered machines and the agent runners handle the rest.

### 9.7 Future: Cloud Provider Strategies

Currently, the primary approach for cloud VMs is to **rent machines and install agent runners on them** (Lambda Labs, Hyperbolic AI, etc. — see Section 9.4). SkyPilot exists in the codebase as an experimental abstraction over AWS/GCP/Azure provisioning but is **not currently supported**. Future native cloud strategies could provide deeper integration:

| Cloud Provider | Potential Strategies | What They Would Do |
|---------------|---------------------|-------------------|
| **AWS** | EC2 Strategy, ECS Strategy, SageMaker Strategy, AWS Batch Strategy | Launch EC2 instances, run ECS tasks, submit SageMaker training jobs, submit Batch jobs |
| **GCP** | Compute Engine Strategy, GKE Strategy, Vertex AI Strategy | Launch GCE VMs, run GKE workloads, submit Vertex training jobs |
| **Azure** | VM Strategy, AKS Strategy, Azure ML Strategy | Launch Azure VMs, run AKS workloads, submit Azure ML experiments |

These would follow the same pattern as SkyPilot: async strategies that provision resources, submit work, and poll for completion. The agent runner would stay on the user's machine and use cloud CLIs/SDKs to manage remote resources.

### 9.8 Known Gaps

| Gap | Current State | Impact | Path Forward |
|-----|--------------|--------|-------------|
| No K8s Job strategy | Only `kubectl exec` (sync, existing pods) | Can't submit K8s batch Jobs with autoscaler | Add `K8sJobStrategy` using `kubectl apply` |
| SSH host classification | All SSH hosts shown identically | Storage servers appear same as GPU VMs | Classify SSH targets by type (HPC, compute, storage) |
| No "Install Agent Runner" UI | Only CLI: `astro-agent setup --remote` | Users see SSH hosts but can't act on them | Add UI flow using existing `ssh-installer.ts` |
| Backend detection redundancy | Server detects local backends AND agent runners report strategies | Two overlapping sources of truth | Backend should show agent runner capabilities, not local detection |
| Async strategy UX | `isAsync` flag exists but UI doesn't surface it | Users expect immediate output from SLURM/SkyPilot | Show "queued, waiting for resources" state |
| No native cloud strategies | SkyPilot (experimental) or manual VM setup | Limited integration with AWS/GCP/Azure native services | Add native strategies for major cloud providers |
| Rented VM setup UX | Must SSH in and install agent runner manually | Friction for users renting Lambda Labs, Hyperbolic AI VMs | Add one-click "Install Agent Runner" from Environments page |
| Storage mount support | No concept of storage-only resources | Can't specify shared data paths across machines | Add storage resource type alongside compute resources |

---

## 10. Data Storage Summary

| Data | Local Mode | Server Mode |
|------|-----------|-------------|
| Projects | IndexedDB (primary) | Postgres (primary), IndexedDB (cache) |
| Plan nodes/edges | IndexedDB (primary) | Postgres (primary), IndexedDB (cache) |
| Executions | IndexedDB (max 100) | Postgres |
| Chat history | IndexedDB | Postgres |
| User profile | IndexedDB | Postgres |
| Settings | IndexedDB | Postgres |
| Usage metrics | IndexedDB | Postgres |
| Machine registry | In-memory only | Postgres + in-memory |
| Sessions | In-memory (ephemeral) | In-memory (ephemeral) |
| Agent runner config | `~/.config/astro-agent/` | `~/.config/astro-agent/` |
| Git worktrees | `~/.astro/worktrees/` | `~/.astro/worktrees/` |
| Cloned repos | `~/.astro/repos/` | `~/.astro/repos/` |

---

## 11. Key Concepts

- **Plan graph**: A directed acyclic graph (DAG) of tasks, milestones, branches, and decisions. Core data model. Not a flat list.
- **Vision doc**: A persistent document per project describing product vision or research question. Injected into every AI session as context.
- **Tiered verification**: Tasks with `verification: 'auto'` auto-complete if tests pass. Tasks with `verification: 'human'` require manual judgment.
- **Multi-environment dispatch**: Tasks target local, remote, HPC, or cloud environments. The dispatch system resolves which machine runs the task.
- **Branch pruning**: Cancelling a task also cancels all downstream dependents in the graph.
- **Procedure pipeline**: Multi-step execution workflows (implement → verify → commit → PR → summarize). Currently server-side, targeted for agent runner.
- **Task classification**: AI-based categorization of tasks into procedure types (full-development, bug-fix, research). Currently a direct Anthropic API call on the server.
