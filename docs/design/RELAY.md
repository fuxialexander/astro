# Astro Relay -- Design Document

## 1. What Is the Relay?

The Relay is a **message switchboard**. It sits between the Astro backend (the coordinator that decides what work needs to happen) and the Agent Runners (the workers that actually execute tasks on real machines). Its job is to route messages back and forth between them.

When the backend wants to dispatch a task -- say, "run these tests on the user's laptop" -- it hands the task to the Relay, which delivers it to the right Agent Runner. When that Agent Runner produces output (AI-generated text, tool calls, file changes), the Relay routes those results back to the backend, which forwards them to the user's browser.

Think of it like a **phone operator at a switchboard**: the backend says "connect me to User A's laptop" and the Relay knows which phone line (WebSocket connection) to use, routes the call, and keeps the line open so both sides can talk freely.

### Why Do We Need It?

Without the Relay, the backend would have to:

- Manage raw WebSocket connections to every agent runner directly
- Handle reconnection logic when networks drop or laptops go to sleep
- Track which machines are alive and which have gone silent
- Route messages to the correct machine among potentially many
- Deal with all the messy details of unreliable network connections

The Relay encapsulates all of this complexity behind a clean interface. It creates a clear separation of concerns: the backend talks to the Relay using simple function calls (fast, in-process, no network involved), and the Relay handles the unreliable network connections to remote machines. The backend never has to think about WebSockets, heartbeats, or reconnection -- it just says "send this task" and listens for results.

### How Messages Flow Through the Relay

```
┌──────────────────────────────────────────────────────────────────┐
│  RELAY MESSAGE ROUTING                                           │
│                                                                  │
│  INBOUND (Backend → Relay → Agent Runner)                       │
│                                                                  │
│  Backend calls relayServer.dispatchTask(task, machineId)         │
│       │                                                          │
│       ▼                                                          │
│  Machine Registry: look up machineId                             │
│       │                                                          │
│       ├── Found locally? → Send via WebSocket to that connection │
│       │                                                          │
│       └── Not local? → Publish to Redis pub/sub                  │
│                  │                                                │
│                  └── Other relay instance picks up                │
│                         │                                        │
│                         └── Sends via its WebSocket connection    │
│                                                                  │
│  OUTBOUND (Agent Runner → Relay → Backend)                      │
│                                                                  │
│  Agent Runner sends WebSocket message (e.g., task.result)        │
│       │                                                          │
│       ▼                                                          │
│  Relay Server receives, parses type field                        │
│       │                                                          │
│       ├── task.* events → Emit on EventEmitter                   │
│       │       │                                                  │
│       │       ├── executionEventBus (→ SSE → Browser)            │
│       │       └── AstroEventTransport (→ hooks)                  │
│       │                                                          │
│       ├── machine.register → Add to Machine Registry             │
│       │                                                          │
│       └── heartbeat.pong → Update lastHeartbeat timestamp        │
└──────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Size | Purpose |
|------|------|---------|
| `server/lib/relay-server.ts` | ~1800 lines | The Relay server itself -- handles WebSocket connections, message routing, heartbeats |
| `packages/agent-runner/src/lib/websocket-client.ts` | 855 lines | The client side -- how Agent Runners connect to and talk with the Relay |
| `server/types/relay.ts` | 671 lines | Type definitions for every message in the protocol |
| `server/lib/machine-registry.ts` | ~200 lines | The "phone book" of connected machines (see Section 4) |
| `server/routes/relay.ts` | ~400 lines | HTTP endpoints for querying relay status and dispatching tasks |

---

## 2. Architecture

The Relay operates differently depending on whether Astro is running in local development mode (everything on one machine) or server mode (backend in the cloud, Agent Runners on user machines across the internet).

### What Is a WebSocket?

Before diving into the architecture, it helps to understand **WebSockets**. A WebSocket is a persistent, two-way communication channel between two programs. Unlike regular HTTP -- where you send a request and wait for a response, then the connection closes -- a WebSocket stays open so either side can send a message at any time, without the other side asking first.

This is essential for Astro because Agent Runners produce a continuous stream of real-time updates: AI output appearing character by character, tool calls being made, files being changed. With HTTP, the browser would have to constantly ask "any updates yet?" (polling). With WebSockets, the Agent Runner just sends updates as they happen, and they appear in the browser instantly.

### 2.1 Local Mode

In local mode, everything runs on the same machine. The Relay still exists, but its job is much simpler -- it acts as a local bridge so the server code can use the same interface regardless of whether it is talking to a local or remote Agent Runner.

```
Hono API Server (3001)
      |
  function calls: relayServer.dispatchTask(), etc.
  EventEmitter: relayServer.on('task:result', ...)
      |
Relay WebSocket Server (3002)    <-- ws://localhost:3002 --    Agent Runner
      |                                                         (same machine)
  No TLS, no JWT auth
```

The Relay runs on `ws://localhost:3002`. Since everything is on the same machine, there is no need for encryption (TLS) or authentication (JWT) -- it is effectively a local bridge using the WebSocket protocol. The important thing is that it provides a **uniform dispatch interface**, meaning the server code does not need separate code paths for "local execution" vs. "remote execution." It always talks to the Relay the same way.

### 2.2 Server Mode

In server mode, the backend runs in the cloud (on Fly.io), and Agent Runners are on users' machines -- potentially laptops on home Wi-Fi, workstations at an office, or HPC clusters in a data center. Now the Relay has real work to do: managing connections over the open internet.

```
Hono API Server (Fly.io)
      |
  function calls
      |
Relay WebSocket Server (3002)    <-- wss://astro-relay.domain --    Agent Runner
      |                                                              (user's machine)
  TLS, JWT authentication
  Heartbeat monitoring
  Reconnection handling
```

Notice the URL changed from `ws://` to `wss://`. The "s" stands for "secure" -- just like `https://` adds encryption to `http://`, `wss://` adds encryption to `ws://`. This is called **TLS** (Transport Layer Security), and it means all messages between the Relay and the Agent Runner are encrypted so nobody on the network can read or tamper with them.

In server mode, the Relay also handles:
- **JWT authentication** -- verifying that the Agent Runner is who it claims to be (see Section 9)
- **Heartbeat monitoring** -- checking that Agent Runners are still alive (see Section 3.6)
- **Reconnection handling** -- gracefully dealing with dropped connections

This is the real networking problem the Relay solves.

### 2.3 Horizontal Scaling (Optional)

For high-availability deployments, you can run multiple Relay instances behind a load balancer. But this creates a coordination problem: Machine X might be connected to Relay 2, but the task dispatch request arrived at Relay 1. How does Relay 1 know where Machine X is?

The answer is **Redis pub/sub**. Redis is a fast in-memory database, and "pub/sub" (publish/subscribe) is a feature that lets programs broadcast messages to each other. Think of it as a **shared bulletin board**: when Relay 2 registers Machine X, it posts a note on the bulletin board. When Relay 1 needs to send a task to Machine X, it checks the bulletin board, sees that Machine X is on Relay 2, and publishes the task there. Relay 2 picks it up and delivers it.

```
        Load Balancer
       /      |       \
  Relay 1  Relay 2  Relay 3     <-- each handles a subset of machines
       \      |       /
        Redis Pub/Sub           <-- cross-instance task routing
```

When `REDIS_URL` is configured, Redis pub/sub enables:
- **Task dispatch across instances**: A task arriving at Relay 1 can be delivered to a machine connected to Relay 3
- **Machine state synchronization**: All instances know about all connected machines, not just their own
- **Task mapping**: Tracking which taskId maps to which machineId, so results can be routed back correctly

This is entirely optional. Single-instance deployments (including all local development) work without Redis.

---

## 3. WebSocket Protocol

All messages between the Relay and Agent Runners are JSON objects with a `type` field that identifies what kind of message it is. The full protocol is defined in `server/types/relay.ts`.

This section walks through every message flow in the system. Each subsection describes a different kind of interaction, with sequence diagrams showing who sends what to whom.

### 3.1 Connection and Registration

When an Agent Runner first starts up and connects to the Relay, it needs to introduce itself -- "Hi, I'm User A's laptop, I have Claude Code installed, 16 GB of RAM, and an NVIDIA GPU." This is the registration handshake.

```
Agent Runner                      Relay Server
     |                                 |
     |-- WebSocket connect ----------> |  (with Authorization header)
     |                                 |
     |-- machine.register ---------->  |  (capabilities, resources, providers)
     |                                 |
     |<-- machine.register.ack ------  |  (serverId, config)
     |                                 |
     |-- heartbeat <-> heartbeat ----  |  (every 30s)
```

1. The Agent Runner opens a WebSocket connection (with an Authorization header in server mode).
2. It sends a `machine.register` message describing itself.
3. The Relay responds with a `machine.register.ack` confirming the registration.
4. From then on, they exchange heartbeat messages to stay in sync (see Section 3.6).

**Registration payload** (`MachineRegisterMessage`) -- this is everything the Agent Runner tells the Relay about itself:

```typescript
{
  type: 'machine.register',
  machineId: string,            // A hardware-based ID that uniquely identifies this machine
  machineInfo: {
    name: string,               // Human-readable display name (e.g., "Zhuoran's MacBook Pro")
    hostname: string,           // The machine's network hostname
    platform: string,           // Operating system (e.g., "darwin", "linux", "win32")
    arch: string,               // CPU architecture (e.g., "x64", "arm64")
    providers: ProviderInfo[],  // Which AI providers are available (Claude Code, Codex, etc.)
    resources: MachineResources, // Hardware specs: CPU cores, memory, GPU info
    environmentType: 'local' | 'remote' | 'hpc',
    executionStrategies?: ExecutionStrategyInfo[],  // How tasks can be run (direct, Docker, etc.)
  },
  runnerId?: string,            // Optional unique ID for this runner instance
  userId?: string,              // Which user owns this machine (set in server mode)
}
```

### 3.2 Task Dispatch

This is the core flow -- the whole reason the Relay exists. The backend wants work done, so it dispatches a task through the Relay to an Agent Runner, then streams back the results as they happen.

```
Hono Server                     Relay Server                    Agent Runner
     |                               |                               |
     |-- relayServer.dispatchTask()->|                               |
     |                               |-- task.dispatch -----------> |
     |                               |                               |
     |                               |<-- task.session_init ------- |
     |                               |<-- task.text --------------- |
     |                               |<-- task.tool_use -----------  |
     |                               |<-- task.tool_result --------  |
     |                               |<-- task.file_change --------  |
     |                               |<-- task.stdout -------------  |
     |                               |<-- task.progress -----------  |
     |                               |                               |
     |                               |<-- task.result -------------  |
     |<-- event emission ------------|                               |
```

Notice how the Hono server calls `relayServer.dispatchTask()` as a simple function call (no network involved -- the Relay runs in the same process). The Relay then sends a `task.dispatch` message over the WebSocket to the Agent Runner. As the Agent Runner works, it streams back a series of messages: initialization info, text output, tool calls, file changes, progress updates, and finally the completed result. The Relay forwards all of these back to the Hono server as events.

**Task dispatch payload** (`TaskDispatch`) -- everything the Agent Runner needs to know to execute the task:

```typescript
{
  taskId: string,               // Unique ID for this execution
  projectId: string,            // Which project this task belongs to
  nodeId: string,               // Which plan node this task corresponds to
  title: string,                // Human-readable task title
  description: string,          // Detailed task description
  prompt: string,               // The actual prompt to send to the AI agent
  visionDoc?: string,           // The project's vision document (injected as context)
  environment?: string,         // Where to run: 'local' | 'remote' | 'hpc' | 'cloud'
  preferredProvider?: string,   // Which AI provider to use: 'claude-code' | 'claude-sdk' | 'codex'
  executionStrategy?: string,   // How to run: 'direct' | 'docker' | 'slurm' | 'k8s-exec'
  priority?: string,            // Task priority level
  timeout?: number,             // Maximum execution time in milliseconds
  workingDirectory?: string,    // Directory to run the task in
  dependencies?: DependencyContext[],  // Context from tasks this one depends on
  maxTurns?: number,            // Maximum number of AI conversation turns
  outputFormat?: { type: string, schema: Record },  // Expected output structure
}
```

**Task result payload** (`TaskResult` within `TaskResultMessage`) -- what comes back when the task finishes:

```typescript
{
  taskId: string,
  status: 'completed' | 'failed' | 'cancelled' | 'timeout',
  output?: string,              // The final output text
  error?: string,               // Error message if failed
  exitCode?: number,            // Process exit code (0 = success)
  startedAt?: string,           // When execution began (ISO timestamp)
  completedAt?: string,         // When execution ended (ISO timestamp)
  artifacts?: TaskArtifact[],   // Any files or outputs produced
  branchName?: string,          // Git branch the work was done on
  prUrl?: string,               // Pull request URL if one was created
  prNumber?: number,            // Pull request number
  metrics?: {
    durationMs?: number,        // How long it took
    inputTokens?: number,       // AI tokens consumed (input)
    outputTokens?: number,      // AI tokens consumed (output)
    estimatedCostUsd?: number,  // Estimated cost in USD
    model?: string,             // Which AI model was used
    turnsUsed?: number,         // How many AI conversation turns
  },
}
```

### 3.3 Steering

Sometimes a user wants to give guidance to an Agent Runner while a task is already running. For example: "Focus on the database layer first" or "Skip the tests for now." This is called **steering** -- nudging the agent in a new direction mid-execution.

The message flows from the user's browser, through the backend, through the Relay, and down to the Agent Runner. The Agent Runner acknowledges receipt, and that acknowledgment flows back to the browser.

```
Browser -> POST /api/dispatch/steer -> relayServer.steerTask()
                                           |
                                     task.steer -> Agent Runner
                                           |
                                     task.steer_ack <- Agent Runner
                                           |
                                     SSE event -> Browser
```

**Steer payload**:

```typescript
{
  type: 'task.steer',
  taskId: string,
  message: string,      // The user's guidance text (e.g., "Focus on error handling first")
  action?: string,      // Optional action: 'interrupt' | 'approve' | 'reject'
}
```

The optional `action` field allows for more than just text guidance. `'interrupt'` tells the agent to stop what it is doing and listen. `'approve'` and `'reject'` are responses to questions the agent may have asked (see Sections 3.4 and 3.5).

### 3.4 Approval Flow

Sometimes an AI agent needs to ask the user a question before proceeding. For example: "I found two approaches to fix this bug. Approach A is simpler but slower. Approach B is more complex but faster. Which should I use?" This is the **approval flow** -- the agent pauses, asks the user, waits for an answer, then continues.

The message travels a long path: from the Agent Runner, through the Relay, through the backend's SSE stream, to the user's browser. The user makes a decision, and the response travels back down the same path.

```
Agent Runner -> task.approval_request -> Relay -> SSE event -> Browser
                                                                    |
                                                               User decides
                                                                    |
Browser -> POST /api/dispatch/approve -> Relay -> task.approval_response -> Agent Runner
```

**Approval request**:

```typescript
{
  type: 'task.approval_request',
  taskId: string,
  requestId: string,      // Unique ID for this specific question (so the response can be matched)
  question: string,       // The question to show the user
  options: string[],      // The available choices (e.g., ["Approach A", "Approach B", "Cancel"])
  timeout?: number,       // How long to wait for an answer (default: 60 seconds)
}
```

### 3.5 Safety Decision Flow

Similar to the approval flow, but specifically for **workspace safety checks**. Before an Agent Runner starts working in a directory, it may need to confirm that it is safe to do so. For example: "This directory has no git repository. If I make changes, they cannot be easily undone. What would you like to do?"

```
Agent Runner -> task.safety_prompt -> Relay -> SSE event -> Browser
                                                             |
                                                        User decides
                                                             |
Browser -> Relay -> task.safety_decision -> Agent Runner
```

The user can choose from these decisions:
- **`proceed`** -- Go ahead and work in the directory as-is
- **`init-git`** -- Initialize a git repository first (so changes can be tracked and reverted)
- **`sandbox`** -- Run in an isolated sandbox environment instead
- **`cancel`** -- Do not proceed; cancel the task

### 3.6 Heartbeat

A heartbeat is an **"are you still there?" check**. Every 30 seconds, the Relay sends a `ping` to each connected Agent Runner, and the Agent Runner responds with a `pong`. This serves two purposes:

1. **Liveness detection**: If 3 consecutive pings go unanswered (meaning 90 seconds of silence), the Relay assumes the Agent Runner has disconnected -- maybe the laptop went to sleep, the network dropped, or the process crashed. The Relay then marks that machine as disconnected and stops trying to send it tasks.

2. **Resource updates**: The `pong` response includes the Agent Runner's current resource usage and active task count, so the Relay always has an up-to-date picture of each machine's availability.

```
Relay Server                    Agent Runner
     |                               |
     |-- heartbeat.ping -----------> |  (every 30s)
     |                               |
     |<-- heartbeat.pong ----------  |  (with resources, active tasks)
```

### 3.7 File Operations

The Relay also brokers file-related operations. When the browser needs to list files in a repository (for example, to show a file tree), it cannot access the user's machine directly -- it has to go through the Relay.

```
Browser -> POST /api/repo/files -> Relay -> file_list.request -> Agent Runner
                                                                    |
                                                              git ls-files
                                                                    |
                                  Relay <- file_list_response <- Agent Runner
                                    |
                              HTTP response -> Browser
```

The Agent Runner runs `git ls-files` (or equivalent) on its local filesystem, and sends the results back through the Relay to the browser.

A similar pattern exists for `repo_setup.request` / `repo_setup_response`, which handles cloning or initializing a repository on the Agent Runner's machine.

---

## 4. Machine Registry

**File**: `server/lib/machine-registry.ts` (~200 lines)

The machine registry is the **phone book of currently-connected Agent Runners**. It is an in-memory data structure (meaning it lives in RAM and is fast to query, but is lost if the server restarts -- see Section 5 for the persistent counterpart).

For each connected machine, the registry knows:

```typescript
interface MachineEntry {
  machineId: string;           // Unique machine identifier
  name: string;                // Human-readable name (e.g., "Zhuoran's MacBook Pro")
  hostname: string;            // Network hostname
  platform: string;            // OS (darwin, linux, win32)
  arch: string;                // CPU architecture (x64, arm64)
  environmentType: 'local' | 'remote' | 'hpc';  // What kind of environment
  providers: ProviderInfo[];   // Available AI providers (Claude Code, Codex, etc.)
  resources: MachineResources; // Hardware: CPU cores, memory, GPU
  executionStrategies?: ExecutionStrategyInfo[];  // How tasks can be run
  connectedAt: Date;           // When this machine connected
  lastHeartbeat: Date;         // When we last heard from it
  activeTasks: number;         // How many tasks are currently running on it
  userId?: string;             // Which user owns this machine
}
```

### Key Methods

These are the operations the Relay performs on the registry:

- **`register(machineId, info)`** -- Add a machine to the phone book when it connects
- **`unregister(machineId)`** -- Remove a machine when it disconnects
- **`get(machineId)`** -- Look up a specific machine's information
- **`isConnected(machineId)`** -- Check if a machine is currently connected
- **`findBestMachine(criteria?)`** -- The smart part: select the optimal machine for a task (explained below)
- **`getByUser(userId)`** -- List all machines belonging to a specific user
- **`updateResources(machineId, resources)`** -- Update a machine's resource info (called when heartbeat data arrives)
- **`updateActiveTasks(machineId, count)`** -- Update how many tasks a machine is running

### Best Machine Selection

When the backend needs to dispatch a task and does not specify a particular machine, it calls `findBestMachine()`. The registry considers these factors (in order of priority):

1. **User ownership** -- The machine must belong to the user who requested the task (you cannot accidentally run a task on someone else's laptop)
2. **Provider availability** -- The machine must have the requested AI provider installed (e.g., if the task needs Claude Code, skip machines that only have Codex)
3. **Current load** -- Machines with fewer active tasks are preferred (spread work evenly)
4. **Environment type match** -- If the task specifies `hpc`, only consider HPC machines; if `local`, prefer local machines

---

## 5. Persistent Machine Store

**File**: `server/lib/registered-machines-store.ts` (~300 lines)

The in-memory registry (Section 4) is fast but volatile -- it is wiped whenever the server restarts. The **persistent machine store** is the durable counterpart. It uses Drizzle ORM queries against the unified database (PGlite in local mode, Postgres in server mode), so the system remembers which machines have been registered even after a server restart. The store works identically in both modes -- there is no degraded or missing functionality in local mode.

Think of the relationship this way: the in-memory registry is "who is online right now" (like seeing green dots on a chat app), while the persistent store is "who has an account" (the full member list, including people who are offline).

```typescript
interface RegisteredMachine {
  id: string;                    // Machine ID
  userId: string;                // Owning user
  name: string;                  // Display name
  hostname: string;              // Network hostname
  platform: string;              // OS
  environmentType: string;       // local/remote/hpc
  providers: string[];           // Available AI providers
  isConnected: boolean;          // Currently online?
  isRevoked: boolean;            // Has access been revoked?
  metadata?: Record<string, unknown>;  // Additional data
  registeredAt: Date;            // When first registered
  lastSeenAt: Date;              // When last connected
}
```

### Functions

- **`registerMachine(params)`** -- Add or update a machine record. Uses "upsert" logic: if a machine with the same client ID (or same hostname + platform + user combination) already exists, it updates that record instead of creating a duplicate.
- **`ensureMachineRegistered(machineId, info)`** -- Make sure a database entry exists for this machine (creates one if it does not)
- **`getMachine(machineId)`** -- Fetch a machine's record by ID
- **`getUserMachines(userId)`** -- List all machines belonging to a user
- **`updateMachineName(machineId, name)`** -- Let a user rename their machine
- **`revokeMachine(machineId)`** -- Mark a machine as revoked (`isRevoked = true`). A revoked machine is blocked from reconnecting -- this is how a user can de-authorize a machine they no longer trust or use.
- **`updateMachineConnectionStatus(machineId, isConnected)`** -- Update the online/offline flag
- **`resetAllConnectionStatuses()`** -- Set all machines to "disconnected." This is called on server startup, because if the server just restarted, no machines are actually connected yet -- any previous "connected" flags are stale.

---

## 6. HTTP API

**File**: `server/routes/relay.ts`

In addition to the WebSocket protocol (which is for real-time communication with Agent Runners), the Relay exposes a set of HTTP endpoints. These are used by the Astro backend and frontend to query Relay status, list machines, and dispatch tasks.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/relay/health` | Health check -- "is the Relay running?" |
| GET | `/api/relay/status` | Detailed status: how many machines are connected, how many tasks are active |
| GET | `/api/relay/machines` | List connected machines (filtered to only show machines owned by the authenticated user) |
| GET | `/api/relay/machines/:machineId` | Get detailed information about a specific machine |
| POST | `/api/relay/dispatch` | Dispatch a task to a specific machine |
| POST | `/api/relay/cancel` | Cancel a running task on a machine |
| GET | `/api/relay/best-machine` | Find the optimal machine for a task (uses the best-machine selection logic from Section 4) |

All endpoints except `/health` require authentication (the caller must prove who they are).

**Machine name display**: When listing machines, the API prefers the user-set name from the database (e.g., "My Work Laptop") over the raw hostname (e.g., "zhuoran-mbp.local"). This makes the UI more readable.

---

## 7. Event Flow Integration

The Relay does not just pass messages between the backend and Agent Runners -- it also feeds into Astro's broader event system. This is how real-time updates reach the user's browser and how observability/audit systems record what happened.

Here is the full picture of how a message from an Agent Runner reaches the browser and other systems:

```
Agent Runner -> relay WebSocket -> RelayServer EventEmitter
                                       |
                  +--------------------+--------------------+
                  |                                         |
           /api/events/stream (SSE)              executionEventBus
                  |                                         |
           Browser (EventSource)               AstroEventTransport hooks
                                               (observability, audit, etc.)
```

When a message arrives from an Agent Runner over the WebSocket, the Relay:
1. Emits it on the `RelayServer` EventEmitter (an in-process event system)
2. The SSE (Server-Sent Events) endpoint picks it up and pushes it to the browser, where it appears as live updates in the UI
3. The `executionEventBus` picks it up and routes it to various hooks: observability tracing, audit logging, usage metrics, etc.

### Event Mapping

Not every Relay message type maps one-to-one to an SSE event or bus event. Here is the complete mapping:

| Relay message (from Agent Runner) | SSE event (to browser) | executionEventBus event (to internal systems) |
|-----------------------------------|------------------------|-----------------------------------------------|
| `task.stdout` | `task:stdout` | `task:stdout` |
| `task.text` | `task:text` | `task:stdout` (merged into stdout stream) |
| `task.result` | `task:result` | `task:result` |
| `task.tool_use` | `task:tool_trace` | `task:tool_trace` |
| `task.tool_result` | `task:tool_trace` | `task:tool_trace` |
| `task.file_change` | `task:file_change` | `task:file_change` |
| `task.progress` | `task:progress` | `task:progress` |
| `task.session_init` | `task:session_init` | `task:session_init` |
| `task.approval_request` | `task:approval_request` | -- (not forwarded to bus) |
| `task.steer_ack` | `task:steer_ack` | -- (not forwarded to bus) |

A few things to note:
- **`task.text` merges into `task:stdout`** on the bus side. The bus does not distinguish between raw terminal output and AI-generated text -- it is all "output" for logging purposes.
- **`task.tool_use` and `task.tool_result`** both become `task:tool_trace`. The bus groups them together because a tool call and its result are logically one unit.
- **Approval requests and steer acknowledgments** go to the browser (so the UI can show them) but not to the execution event bus (they are interactive UI concerns, not execution data).

---

## 8. Protocol Gaps (Known)

The Relay protocol was designed primarily for task execution -- sending a prompt to an Agent Runner and streaming back results. However, as Astro has grown, we have discovered several **gaps in the protocol** that need to be addressed. These gaps matter because they block the ability to remove the server's local execution paths (where the server runs AI directly instead of going through the Relay).

Here are the four known gaps, what each one means in practice, and why it matters:

### Gap 1: No `messages` field

**The problem**: The `TaskDispatch` payload only has a single `prompt` string field for the AI input. But for chat-style interactions, the backend needs to send a structured conversation history -- an array of messages like `[{role: "user", content: "..."}, {role: "assistant", content: "..."}, {role: "user", content: "..."}]`.

**The workaround**: Currently, the entire conversation history has to be flattened (serialized) into the single `prompt` string, which is messy and loses the message structure.

**Why it matters**: Chat endpoints need this to work properly through the Relay. Without it, the server has to handle chat requests locally instead of dispatching them to Agent Runners.

**Reference**: See `docs/SERVER_LOCAL_MODE_SEPARATION.md` section 6.1.

### Gap 2: No `systemPrompt` field

**The problem**: Different types of tasks need different system prompts. A chat task uses `buildChatSystemPrompt()`, a planning task uses a planning-specific prompt, etc. But `TaskDispatch` has no way to specify a system prompt separately from the user prompt.

**The workaround**: The system prompt gets concatenated into the `prompt` field, which means the Agent Runner cannot distinguish between the system-level instructions and the user's actual request.

**Why it matters**: System prompts control the AI's behavior and persona. Mixing them into the user prompt can degrade output quality and prevents the Agent Runner from handling them correctly (e.g., caching system prompts across turns).

### Gap 3: No task `type` field

**The problem**: The Relay does not distinguish between different kinds of tasks: plan generation, chat, task execution, and summarization. They all look like "here is a prompt, run it."

**The workaround**: The Agent Runner treats everything the same way, which means it cannot optimize its behavior for different task types (e.g., using a cheaper model for summarization, or applying different safety checks for code execution).

**Why it matters**: Different task types have fundamentally different requirements. Without a `type` field, the Agent Runner has to guess what kind of work it is being asked to do.

### Gap 4: No `model` field

**The problem**: The model selection is currently implicit via the `preferredProvider` field (e.g., "use Claude Code"). But there is no way to specify which exact model to use within a provider (e.g., "use Claude Opus 4 via Claude Code").

**The workaround**: The Agent Runner uses whatever default model its provider is configured with.

**Why it matters**: Adding an explicit `model` field would let the server hint at model choice, enabling cost optimization (use a cheaper model for simple tasks) and quality tuning (use the best model for critical tasks).

### Path Forward

These four gaps need to be addressed before the server's local execution paths can be fully removed. Once the protocol supports messages, system prompts, task types, and model selection, all AI execution can go through the Relay uniformly.

---

## 9. Authentication

Authentication answers the question: "How does the Relay know it should trust this Agent Runner?" The answer depends on the mode.

### 9.1 Local Mode

No authentication. The Agent Runner connects with machine ID headers only. This is safe because in local mode, everything runs on the same machine -- there is no network boundary to protect. Requiring authentication here would just add friction to local development.

### 9.2 Server Mode

In server mode, Agent Runners connect over the internet, so we need real authentication. Astro uses the **Device Authorization Grant** flow (defined in RFC 8628), which is the same pattern used by smart TVs and CLI tools that do not have a web browser.

Here is why this flow exists: the Agent Runner is a command-line program running on the user's machine. It does not have a browser or a login page. So how does the user prove their identity? The answer is a two-device flow:

1. **User runs `astro-agent setup`** on their machine. The Agent Runner contacts the server and receives a short device code (e.g., `ABCD-1234`).

2. **User visits `https://astro.domain/device`** in their browser (on any device -- could be their phone). They enter the device code and authenticate via WebAuthn (passkey/biometric).

3. **Agent Runner polls `/api/device/token`** -- it keeps asking "has the user approved me yet?" Once the user completes step 2, the server responds with a **JWT access token** and a **refresh token**.

4. **Agent Runner connects to the Relay** with the JWT in the `Authorization: Bearer <access_token>` header. The Relay verifies the JWT to confirm the Agent Runner is legitimate.

5. **Token refresh**: JWTs expire after a set time (for security -- if a token is stolen, it will not work forever). When the token nears expiration, the Agent Runner calls `/api/device/refresh` with its refresh token to get a new access token.

### What Is a JWT?

A **JWT** (JSON Web Token) is a signed token -- think of it as a **tamper-proof ID badge**. It contains information like "this is User A's laptop, with permission to execute tasks, and this badge expires at midnight." The badge is cryptographically signed by the server, which means:

- Anyone can read it (it is not encrypted, just encoded)
- But nobody can forge or modify it without the server's secret key
- The Relay can verify it is legitimate just by checking the signature -- it does not need to call the database

JWT tokens in Astro contain: `userId` (who owns the machine), `machineId` (which machine), `scopes` (what it is allowed to do), and `exp` (when it expires).
