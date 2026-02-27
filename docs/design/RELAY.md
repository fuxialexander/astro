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
│       ├── session.* → MCP Bridge session management              │
│       │                                                          │
│       ├── slurm.* → HPC job status/output forwarding             │
│       │                                                          │
│       └── heartbeat.pong → Update lastHeartbeat timestamp        │
└──────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `server/lib/relay-server.ts` | The Relay server itself -- handles WebSocket connections, message routing, heartbeats, session attachment, file/repo operations |
| `packages/agent-runner/src/lib/websocket-client.ts` | The client side -- how Agent Runners connect to and talk with the Relay |
| `server/types/relay.ts` | Type definitions for every message in the protocol (~1060 lines) |
| `server/lib/machine-registry.ts` | The "phone book" of connected machines (see Section 4) |
| `server/routes/relay.ts` | HTTP endpoints for querying relay status, dispatching tasks, Slurm clusters, and session discovery |

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
  Disconnect grace periods
```

Notice the URL changed from `ws://` to `wss://`. The "s" stands for "secure" -- just like `https://` adds encryption to `http://`, `wss://` adds encryption to `ws://`. This is called **TLS** (Transport Layer Security), and it means all messages between the Relay and the Agent Runner are encrypted so nobody on the network can read or tamper with them.

In server mode, the Relay also handles:
- **JWT authentication** -- verifying that the Agent Runner is who it claims to be (see Section 10)
- **Heartbeat monitoring** -- checking that Agent Runners are still alive (see Section 3.6)
- **Reconnection handling** -- gracefully dealing with dropped connections via disconnect grace periods

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

The Relay supports **dual message formats**: a dot-notation format (e.g., `machine.register`) and an underscore format used by the `@astroanywhere/agent` package (e.g., `register`). Both are accepted and normalized internally.

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
    providers: ProviderInfo[],  // Which AI providers are available (Claude Code, Codex, etc.)
    resources: MachineResources, // Hardware specs: CPU cores, memory, GPU info
    load: MachineLoad,          // Current load: CPU%, memory%, active/queued tasks
    environmentType?: string,   // 'local' | 'remote' | 'hpc'
    executionStrategies?: ExecutionStrategyInfo[],  // How tasks can be run (direct, Docker, Slurm, k8s-exec)
    tags?: string[],            // Freeform tags (runner ID, version)
    metadata?: Record<string, string>,  // Key-value metadata (runnerId, version)
  },
}
```

**Provider info** includes HPC capability metadata when running on a cluster:

```typescript
interface ProviderInfo {
  type: ProviderType,           // 'claude-code' | 'claude-sdk' | 'codex' | 'aws' | 'gcp' | 'custom'
  version?: string,
  status: ProviderStatus,       // 'available' | 'busy' | 'unavailable' | 'error'
  maxConcurrentTasks: number,
  currentTasks: number,
  capabilities?: string[],      // ['streaming', 'tools', 'multi-turn']
  hpcCapability?: {             // Present on Slurm/HPC machines
    clusterName?: string,
    partitions: string[],
    defaultPartition?: string,
    accounts: string[],
  },
}
```

**Execution strategy info** describes how the machine can run tasks:

```typescript
interface ExecutionStrategyInfo {
  id: string,                   // 'direct' | 'docker' | 'slurm' | 'k8s-exec'
  name: string,                 // Human-readable name
  available: boolean,           // Whether this strategy is currently usable
  version?: string,             // Strategy/tool version
  metadata?: Record<string, unknown>,
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
  // ── Core identification ──
  taskId: string,               // Unique execution ID
  projectId: string,            // Which project this task belongs to
  nodeId: string,               // Which plan node this task corresponds to
  shortNodeId?: string,         // First 6 hex chars of nodeId UUID (for branch names, PR titles)
  shortProjectId?: string,      // First 6 hex chars of projectId UUID (for PR titles)
  title: string,                // Human-readable task title
  description: string,          // Detailed task description

  // ── Prompt & conversation ──
  prompt?: string,              // Pre-built prompt (bypasses auto-construction from title/description)
  systemPrompt?: string,        // System-level instruction for the AI session
  messages?: ConversationMessage[], // Multi-turn conversation history (user/assistant turns)
  model?: string,               // Explicit model selection (e.g., 'claude-sonnet-4-20250514')

  // ── Task type & behavior ──
  type?: TaskDispatchType,      // 'execution' | 'plan' | 'chat' | 'summarize' (default: 'execution')
  maxTurns?: number,            // Maximum AI conversation turns
  outputFormat?: {              // Expected structured output
    type: 'json_schema',
    schema: Record<string, unknown>,
  },
  skipSafetyCheck?: boolean,    // Skip workspace safety check (for text-only tasks)
  images?: ImageAttachment[],   // Base64-encoded images for multimodal prompts

  // ── Environment & execution ──
  environment?: string,         // 'local' | 'remote' | 'hpc' | 'cloud'
  preferredProvider?: ProviderType, // 'claude-code' | 'claude-sdk' | 'codex' | 'aws' | 'gcp' | 'custom'
  executionStrategy?: string,   // 'direct' | 'slurm' | 'docker' | 'k8s-exec'
  priority?: number,            // Task priority level
  timeout?: number,             // Maximum execution time in milliseconds
  workingDirectory?: string,    // Directory to run the task in
  sourceDirectory?: string,     // Original project directory (for data access from worktrees)
  dependencies?: string[],      // Other task IDs that must complete first
  visionDoc?: string,           // Project vision context (injected above codebase context)

  // ── Workspace & delivery ──
  deliveryMode?: 'pr' | 'push' | 'branch' | 'copy' | 'direct',  // How results are delivered
  remoteType?: 'github' | 'gitlab' | 'bitbucket' | 'generic' | 'none',
  agentDir?: string,            // Agent directory name (default: '.astro')
  baseBranch?: string,          // Target branch for worktree/PR base (e.g., 'main')
  worktreeStrategy?: 'copy' | 'reference' | 'direct',  // Strategy for non-git projects
  useWorktree?: boolean,        // Explicit opt-out of worktree creation (default: true)

  // ── Session resume ──
  resumeSessionId?: string,     // Resume an existing Claude Code session by ID
  forkSession?: boolean,        // Fork instead of continuing the resumed session

  // ── PR enrichment ──
  astroBaseUrl?: string,        // Base URL for linking back to tasks in PR bodies
  githubIssueUrl?: string,      // GitHub issue URL to reference in PR body
  githubIssueNumber?: number,   // GitHub issue number (e.g., 42 -> "Closes #42")

  // ── Dispatch signing ──
  dispatchSignature?: string,   // ECDSA P-256 signature (base64url) for authenticity
  dispatchSigningPayload?: DispatchSigningPayload, // Signed payload for verification

  // ── Metadata ──
  metadata?: Record<string, string>,
}
```

**Task result payload** (`TaskResult` within `TaskResultMessage`) -- what comes back when the task finishes:

```typescript
{
  taskId: string,
  status: 'queued' | 'dispatched' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'timeout',
  output?: string,              // The final output text
  error?: string,               // Error message if failed
  exitCode?: number,            // Process exit code (0 = success)
  duration?: number,            // Execution time in milliseconds
  artifacts?: TaskArtifact[],   // Any files or outputs produced
  branchName?: string,          // Git branch the work was done on
  prUrl?: string,               // Pull request URL if one was created
  prNumber?: number,            // Pull request number
  deliveryStatus?: 'success' | 'failed' | 'skipped',  // Delivery outcome (separate from execution)
  deliveryError?: string,       // Error message when delivery failed
  summary?: ExecutionSummaryResult, // Structured execution summary
  metrics?: {
    durationMs?: number,        // How long it took
    inputTokens?: number,       // AI tokens consumed (input)
    outputTokens?: number,      // AI tokens consumed (output)
    totalCost?: number,         // Estimated cost in USD
    model?: string,             // Which AI model was used
    numTurns?: number,          // How many AI conversation turns
  },
}
```

**Execution summary** (`ExecutionSummaryResult`) -- a structured summary produced by the agent after task completion:

```typescript
{
  status: 'success' | 'partial' | 'failure',
  workCompleted: string,
  executiveSummary?: string,    // 1-2 paragraph executive summary
  keyFindings: string[],
  filesChanged: string[],
  followUps: string[],
  prUrl?: string | null,
  prNumber?: number | null,
  branchName?: string | null,
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
                                     task.steer.ack <- Agent Runner
                                           |
                                     SSE event -> Browser
```

**Steer payload**:

```typescript
{
  type: 'task.steer',
  taskId: string,
  message: string,      // The user's guidance text (e.g., "Focus on error handling first")
  action?: 'guidance' | 'redirect' | 'pause' | 'resume',  // Steering action type
  interrupt?: boolean,  // Whether to interrupt the agent's current work
}
```

The `action` field controls the nature of the steering:
- **`guidance`** (default) -- Provide additional context without interrupting
- **`redirect`** -- Change the agent's current focus
- **`pause`** / **`resume`** -- Pause or resume agent execution

The `interrupt` flag tells the agent to stop what it is doing immediately and process the steering message.

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
}
```

**Approval response**:

```typescript
{
  type: 'task.approval_response',
  taskId: string,
  requestId: string,      // Matches the request
  answered: boolean,      // Whether the user answered (false = timeout)
  answer?: string,        // The user's selected option
  message?: string,       // Additional context from the user
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

The safety prompt includes a `safetyTier` field indicating the risk level, and an `options` array with available choices (each with `id`, `label`, and optional `description`).

### 3.6 Heartbeat

A heartbeat is an **"are you still there?" check**. Every 30 seconds, the Relay sends a `ping` to each connected Agent Runner, and the Agent Runner responds with a `pong`. This serves two purposes:

1. **Liveness detection**: If 6 consecutive pings go unanswered (180 seconds of silence, configured via `heartbeatTimeoutMs`), the Relay assumes the Agent Runner has disconnected -- maybe the laptop went to sleep, the network dropped, or the process crashed. The Relay then marks that machine as disconnected and stops trying to send it tasks.

2. **Resource updates**: The `pong` response includes the Agent Runner's current resource usage and active task count, so the Relay always has an up-to-date picture of each machine's availability.

```
Relay Server                    Agent Runner
     |                               |
     |-- heartbeat.ping -----------> |  (every 30s)
     |                               |
     |<-- heartbeat.pong ----------  |  (with resources, active tasks)
```

**Disconnect grace period**: When a WebSocket connection drops, the Relay does not immediately fail active tasks. Instead, it enters a **grace period** (default: 180 seconds) during which the machine's registry entry is kept alive with a `reconnecting` status. If the Agent Runner reconnects within this window, the session resumes seamlessly. If the grace period expires, the machine is fully disconnected and active tasks are failed.

### 3.7 Provider Status

Agent Runners can report individual provider status changes independently of the full heartbeat cycle. This allows the Relay to react quickly when a provider becomes available or goes offline.

```
Agent Runner -> provider.status -> Relay
```

**Provider status payload**:

```typescript
{
  type: 'provider.status',
  machineId: string,
  provider: ProviderInfo,      // Updated provider info (type, status, current tasks, etc.)
}
```

The Relay updates the machine's provider list in the registry. If a provider transitions from `unavailable` to `available`, the machine becomes eligible for new task dispatch.

### 3.8 Machine Status

Similar to provider status, but covers the machine's overall load and optionally all providers at once.

```
Agent Runner -> machine.status -> Relay
```

**Machine status payload**:

```typescript
{
  type: 'machine.status',
  machineId: string,
  load: MachineLoad,           // CPU%, memory%, GPU%, active/queued tasks
  providers?: ProviderInfo[],  // Optionally update all provider statuses
}
```

---

## 4. File & Repository Operations

The Relay brokers file-related operations between the browser and agent runners. When the browser needs to interact with the user's filesystem -- listing files, browsing directories, detecting repositories, initializing git -- it goes through the Relay. All of these use a request/response pattern with `correlationId` for matching.

### 4.1 File List

```
Browser -> POST /api/repo/files -> Relay -> file_list.request -> Agent Runner
                                                                    |
                                                              git ls-files
                                                                    |
                                  Relay <- file_list.response <- Agent Runner
                                    |
                              HTTP response -> Browser
```

**Request**: `file_list.request` with `path` and `correlationId`
**Response**: `file_list.response` with `correlationId` and `files: string[]`

### 4.2 Directory List

Used for remote path browsing (e.g., selecting a project directory on a connected machine).

**Request**: `directory_list.request` with `path` and `correlationId`
**Response**: `directory_list.response` with `correlationId`, `path`, `entries: DirectoryEntry[]`, optional `homeDirectory`, and optional `error`

Each `DirectoryEntry` contains:
```typescript
{
  name: string,
  path: string,
  isDirectory: boolean,
  isSymlink?: boolean,
}
```

### 4.3 Create Directory

**Request**: `create_directory.request` with `parentPath`, `name`, and `correlationId`
**Response**: `create_directory.response` with `correlationId`, `success`, optional `path`, and optional `error`

### 4.4 Repo Detect

Inspects a directory to determine its git status, remote configuration, and suggested delivery mode.

**Request**: `repo_detect.request` with `path` and `correlationId`
**Response**: `repo_detect.response` with:

```typescript
{
  correlationId: string,
  exists: boolean,
  isGit: boolean,
  remoteUrl?: string,
  remoteType: 'github' | 'gitlab' | 'bitbucket' | 'generic' | 'none',
  baseBranch?: string,
  currentBranch?: string,
  isDirty?: boolean,
  dirtyDetails?: { staged: number, unstaged: number, untracked: number },
  suggestedDeliveryMode: 'pr' | 'push' | 'branch' | 'direct',
  dirSizeMB?: number | null,
  error?: string,
}
```

### 4.5 Branch List

Lists branches in a repository on the remote machine.

**Request**: `branch_list.request` with `path` and `correlationId`
**Response**: `branch_list.response` with:

```typescript
{
  correlationId: string,
  branches: Array<{
    name: string,
    isRemote: boolean,
    isCurrent: boolean,
    isDefault: boolean,
  }>,
  defaultBranch?: string,
  error?: string,
}
```

### 4.6 Git Init

Initializes a git repository in a directory on the remote machine, with optional project metadata for the initial commit.

**Request**: `git_init.request` with `correlationId`, `workingDirectory`, `projectId`, `projectName`, and optional `projectDescription`
**Response**: `git_init.response` with:

```typescript
{
  correlationId: string,
  success: boolean,
  workingDirectory?: string,
  fileTree?: string[],
  source?: Record<string, unknown>,
  deliveryMode?: string,
  error?: string,
}
```

### 4.7 Repo Setup

Full repository setup (clone, configure, detect) on the remote machine.

**Request**: `repo_setup.request` with `correlationId`, `projectId`, `projectName`, optional `projectDescription`, optional `workingDirectory`, optional `repository`
**Response**: `repo_setup.response` with success status, working directory, file tree, key files (CLAUDE.md, README.md, package.json), source info, delivery mode, and agent directory path.

### 4.8 Slash Commands

Discovers available slash commands on the agent runner (for command palette integration).

**Request**: `slash_commands.request` with `correlationId` and optional `workingDirectory`
**Response**: `slash_commands.response` with `correlationId` and `commands: Array<{ name: string, description: string }>`

### 4.9 Sessions List

Discovers existing Claude Code sessions on the agent runner (for session resume/fork).

**Request**: `sessions_list.request` with `correlationId` and optional `maxAgeMs`
**Response**: `sessions_list.response` with `correlationId`, `sessions: ClaudeCodeSessionInfo[]`, and optional `error`

Each session includes:
```typescript
{
  sessionId: string,
  summary: string,
  lastModified: number,
  fileSize: number,
  customTitle?: string,
  firstPrompt?: string,
  gitBranch?: string,
  cwd?: string,
}
```

---

## 5. Session Attachment Protocol (MCP Bridge)

The Relay supports attaching external MCP bridge connections to active task sessions. This enables real-time observation of agent execution from external tools.

### 5.1 Session Attach

An MCP bridge connects to the Relay and requests to observe a specific session:

```
MCP Bridge -> session.attach -> Relay
                                  |
                            Validates session exists in DB
                                  |
                            session.attach.ack -> MCP Bridge
                                  |
                            (events start flowing)
                                  |
                            session.event -> MCP Bridge  (ongoing)
```

**Attach request**:

```typescript
{
  type: 'session.attach',
  taskId: string,
  sessionId: string,
  machineId: string,
}
```

**Attach acknowledgment**:

```typescript
{
  type: 'session.attach.ack',
  taskId: string,
  sessionId: string,
  success: boolean,
  error?: string,
}
```

### 5.2 Session Events

Once attached, the MCP bridge receives a stream of `session.event` messages for the observed session:

```typescript
{
  type: 'session.event',
  sessionId: string,
  taskId: string,
  event: {
    type: 'tool_call' | 'tool_result' | 'file_change' | 'message' | 'error',
    timestamp: Date,
    sessionId: string,
    taskId: string,
    // ... additional fields depending on event type
  },
}
```

### 5.3 Session Detach

When observation is no longer needed:

```typescript
{
  type: 'session.detach',
  sessionId: string,
  reason?: string,
}
```

The Relay emits `session:attached`, `session:event`, and `session:detached` events on its EventEmitter for internal consumption.

---

## 6. Slurm/HPC Extensions

The Relay protocol natively supports HPC/Slurm operations for running tasks on high-performance computing clusters. These extensions build on top of the standard task dispatch system.

### 6.1 Slurm Task Dispatch

Slurm tasks use the standard `TaskDispatch` interface extended with Slurm-specific configuration:

```typescript
interface SlurmTaskDispatch extends TaskDispatch {
  preferredProvider: 'claude-sdk',
  slurmConfig?: {
    partition?: string,         // Slurm partition (e.g., 'gpu', 'cpu')
    nodes?: number,             // Number of nodes
    ntasks?: number,            // Number of tasks
    cpusPerTask?: number,       // CPUs per task
    mem?: string,               // Memory (e.g., '32G')
    time?: string,              // Time limit (e.g., '4:00:00')
    gpu?: {
      type?: string,            // GPU type (e.g., 'A100')
      count: number,            // Number of GPUs
    },
    qos?: string,               // Quality of service
    account?: string,           // Slurm account
    modules?: string[],         // Environment modules to load
    workdir?: string,           // Working directory on the cluster
  },
}
```

### 6.2 Slurm Job Status

Agent runners on HPC machines report Slurm job status changes:

```typescript
{
  type: 'slurm.job.status',
  taskId: string,
  slurmJobId: string,
  jobInfo: SlurmJobInfo,        // Full job state including node count, CPU count, times, etc.
}
```

Slurm job states: `PENDING`, `RUNNING`, `SUSPENDED`, `COMPLETING`, `COMPLETED`, `FAILED`, `CANCELLED`, `TIMEOUT`, `PREEMPTED`, `NODE_FAIL`, `OUT_OF_MEMORY`, `UNKNOWN`.

### 6.3 Slurm Job Output

Streaming output from Slurm jobs:

```typescript
{
  type: 'slurm.job.output',
  taskId: string,
  slurmJobId: string,
  stream: 'stdout' | 'stderr',
  data: string,
}
```

### 6.4 Slurm Job Submitted

Confirmation that a Slurm job was successfully submitted:

```typescript
{
  type: 'slurm.job.submitted',
  taskId: string,
  slurmJobId: string,
  scriptPath: string,           // Path to the generated SBATCH script
  outputPath: string,           // Path for stdout capture
  errorPath: string,            // Path for stderr capture
}
```

### 6.5 Slurm Cluster Information

HPC machines report cluster metadata as part of their provider info during registration. This includes:

```typescript
interface SlurmClusterInfo {
  clusterName: string,
  slurmVersion: string,
  defaultPartition?: string,
  partitions: SlurmPartitionInfo[],  // Per-partition: nodes, GPUs, time limits, features
  qosLevels: string[],
  accounts: string[],
}
```

The Relay exposes dedicated HTTP endpoints for querying Slurm cluster information (see Section 7).

---

## 7. Machine Registry

**File**: `server/lib/machine-registry.ts`

The machine registry is the **phone book of currently-connected Agent Runners**. It is an in-memory data structure (meaning it lives in RAM and is fast to query, but is lost if the server restarts -- see Section 8 for the persistent counterpart).

For each connected machine, the registry knows:

```typescript
interface MachineRegistryEntry extends MachineInfo {
  connectionStatus: MachineConnectionStatus,  // 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
  connectedAt: Date,            // When this machine connected
  lastHeartbeat: Date,          // When we last heard from it
  sessionId: string,            // Unique session ID for this connection
  userId?: string,              // Which user owns this machine
}
```

### Key Methods

These are the operations the Relay performs on the registry:

- **`register(machineId, info, socket, userId)`** -- Add a machine to the phone book when it connects. If a machine with the same ID already exists, the old connection is closed with code `4001` (telling the old client not to reconnect) and replaced.
- **`disconnect(machineId, reason?)`** -- Remove a machine when it disconnects
- **`detachSocket(machineId)`** -- Null out the socket but keep the registry entry (used during disconnect grace periods -- status becomes `reconnecting`)
- **`get(machineId)`** -- Look up a specific machine's information
- **`isConnected(machineId)`** -- Check if a machine is currently connected
- **`findBestMachine(preferredProvider?, userId?)`** -- The smart part: select the optimal machine for a task (explained below)
- **`getByUser(userId)`** -- List all machines belonging to a specific user
- **`getByProvider(providerType)`** -- List machines that have a specific provider available
- **`updateLoad(machineId, load)`** -- Update a machine's load info (called when heartbeat data arrives)
- **`updateProvider(machineId, provider)`** -- Update or add a provider on a machine
- **`recordHeartbeat(machineId)`** -- Update the lastHeartbeat timestamp
- **`getSnapshot()`** -- Get a full registry snapshot with summary statistics (total machines, by-provider counts, total active tasks)

### Best Machine Selection

When the backend needs to dispatch a task and does not specify a particular machine, it calls `findBestMachine()`. The registry considers these factors (in order of priority):

1. **User ownership** -- The machine must belong to the user who requested the task (you cannot accidentally run a task on someone else's laptop). Machines with no `userId` or with the `LOCAL_USER_ID` are accessible to all users.
2. **Provider availability** -- The machine must have the requested AI provider installed, with status `available` and capacity for more tasks (`currentTasks < maxConcurrentTasks`).
3. **Connection status** -- Only machines with `connectionStatus === 'connected'` are considered.
4. **Current load** -- Machines are scored by `cpuPercent + (activeTasks * 10)`, with the lowest score (least loaded) selected first.

---

## 8. Persistent Machine Store

**File**: `server/lib/registered-machines-store.ts`

The in-memory registry (Section 7) is fast but volatile -- it is wiped whenever the server restarts. The **persistent machine store** is the durable counterpart. It uses Drizzle ORM queries against the unified database (PGlite in local mode, Postgres in server mode), so the system remembers which machines have been registered even after a server restart. The store works identically in both modes -- there is no degraded or missing functionality in local mode.

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

## 9. HTTP API

**File**: `server/routes/relay.ts`

In addition to the WebSocket protocol (which is for real-time communication with Agent Runners), the Relay exposes a set of HTTP endpoints. These are used by the Astro backend and frontend to query Relay status, list machines, dispatch tasks, manage Slurm clusters, and discover sessions.

### Core Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/relay/health` | Health check -- "is the Relay running?" (includes Redis connection status) |
| GET | `/api/relay/status` | Detailed status: machine count, config, Redis status |
| GET | `/api/relay/machines` | List connected machines (filtered by authenticated user, cross-referenced with DB for user-set names) |
| GET | `/api/relay/machines/:machineId` | Get detailed information about a specific machine (ownership verified) |
| GET | `/api/relay/machines/provider/:provider` | List machines by provider type |
| DELETE | `/api/relay/machines/:machineId` | Force disconnect a machine (ownership required) |
| POST | `/api/relay/dispatch` | Dispatch a task to a specific machine (ownership verified, supports Redis cross-instance routing) |
| POST | `/api/relay/cancel` | Cancel a running task (ownership verified, supports Redis cross-instance routing) |
| GET | `/api/relay/tasks/:taskId/machine` | Get the machine running a specific task (via Redis task mapping) |
| GET | `/api/relay/best-machine` | Find the optimal machine for a task |
| GET | `/api/relay/sessions` | List Claude Code sessions across connected machines (with caching, fan-out) |

### Slurm/HPC Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/relay/slurm/clusters` | List all HPC-capable machines (machines with `hpcCapability` metadata) |
| GET | `/api/relay/slurm/clusters/:machineId` | Get detailed Slurm cluster info for a specific machine |
| GET | `/api/relay/slurm/jobs` | List active Slurm jobs across all clusters |
| POST | `/api/relay/slurm/dispatch` | Dispatch a task specifically to a Slurm cluster (forces `claude-sdk` provider, validates HPC capability) |

All endpoints except `/health` require authentication (the caller must prove who they are).

**Machine name display**: When listing machines, the API prefers the user-set name from the database (e.g., "My Work Laptop") over the raw hostname (e.g., "zhuoran-mbp.local"). This makes the UI more readable.

**Sessions discovery**: The `/api/relay/sessions` endpoint supports per-machine queries (`?machineId=xxx`) or fan-out to all user-owned machines. Results are cached per-user for 60 seconds, and sessions older than 24 hours are excluded by default. The response includes `machineId` and `machineName` for each session.

---

## 10. Event Flow Integration

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
| `task.tool_use` / `task.tool_trace` | `task:tool_trace` | `task:tool_trace` |
| `task.tool_result` | `task:tool_trace` | `task:tool_trace` |
| `task.file_change` | `task:file_change` | `task:file_change` |
| `task.progress` | `task:progress` | `task:progress` |
| `task.session_init` | `task:session_init` | `task:session_init` |
| `task.approval_request` | `task:approval_request` | -- (not forwarded to bus) |
| `task.safety_prompt` | `task:safety_prompt` | -- (not forwarded to bus) |
| `task.steer.ack` | `task:steer_ack` | -- (not forwarded to bus) |
| `provider.status` | -- | -- (updates registry only) |
| `machine.status` | -- | -- (updates registry only) |
| `session.event` | `session:event` | -- (forwarded to attached MCP bridges) |

A few things to note:
- **`task.text` merges into `task:stdout`** on the bus side. The bus does not distinguish between raw terminal output and AI-generated text -- it is all "output" for logging purposes.
- **`task.tool_use` and `task.tool_result`** both become `task:tool_trace`. The bus groups them together because a tool call and its result are logically one unit.
- **Approval requests, safety prompts, and steer acknowledgments** go to the browser (so the UI can show them) but not to the execution event bus (they are interactive UI concerns, not execution data).
- **Provider and machine status updates** only update the registry; they are not forwarded as events.
- **Session events** are forwarded to attached MCP bridge clients, not to the general event bus.

---

## 11. Protocol Extensions

The relay protocol has been extended beyond its original task execution scope to support four additional capabilities in production. These are implemented as fields on the `TaskDispatch` interface in `server/types/relay.ts` and forwarded by `RelayServer.dispatchTask()` in `server/lib/relay-server.ts`.

### 11.1 Task Type Differentiation (`type` field)

The `type` field tells the agent runner what kind of work a dispatch represents. This enables the agent runner to optimize behavior per task type (e.g., enabling structured output for plan generation, adjusting system prompts for chat).

```typescript
type?: TaskDispatchType  // 'execution' | 'plan' | 'chat' | 'summarize'
```

- **`execution`** (default): Standard task execution -- code changes, tests, etc.
- **`plan`**: Plan generation -- produces structured JSON output (task graph).
- **`chat`**: Conversational exchange -- multi-turn chat about a plan or project.
- **`summarize`**: Single-turn summarization of task output.

Defaults to `'execution'` when omitted, maintaining backward compatibility with older agent runners.

### 11.2 System Prompt Injection (`systemPrompt` field)

The `systemPrompt` field provides a separate system-level instruction for the AI session, decoupled from the user prompt. This enables proper system prompt caching across turns and task-type-specific instructions.

```typescript
systemPrompt?: string
```

- For `plan` tasks: planning instructions + JSON schema constraints
- For `chat` tasks: conversational context instructions
- For `execution` tasks: usually omitted (agent runner uses defaults)
- For `summarize` tasks: summarization instructions

When provided, the agent runner passes this to the Claude SDK's `options.systemPrompt` parameter.

### 11.3 Conversation History (`messages` field)

The `messages` field carries structured multi-turn conversation history for chat tasks, preserving role structure (user/assistant turns).

```typescript
messages?: ConversationMessage[]  // Array of { role: 'user' | 'assistant', content: string }
```

When provided, the agent runner builds the prompt as an `AsyncIterable<SDKUserMessage>` instead of a flat string, preserving the multi-turn structure the Claude SDK expects. When omitted, `prompt` is used as a single-turn string.

### 11.4 Model Selection (`model` field)

The `model` field enables explicit model selection, passing the user's choice through the Relay to the agent runner.

```typescript
model?: string  // e.g., 'claude-sonnet-4-20250514', 'claude-opus-4-20250514'
```

When provided, the agent runner passes this to the SDK's `options.model` parameter. When omitted, the agent runner uses its configured default model.

### 11.5 Workspace & Delivery Fields

A set of fields control how the agent runner manages the workspace and delivers results:

| Field | Type | Purpose |
|-------|------|---------|
| `deliveryMode` | `'pr' \| 'push' \| 'branch' \| 'copy' \| 'direct'` | How results are delivered after task completion |
| `remoteType` | `'github' \| 'gitlab' \| 'bitbucket' \| 'generic' \| 'none'` | Remote type of the source repository |
| `agentDir` | `string` | Agent directory name (default: `.astro`) |
| `baseBranch` | `string` | Target branch for worktree creation and PR base |
| `worktreeStrategy` | `'copy' \| 'reference' \| 'direct'` | Worktree strategy for non-git projects |
| `useWorktree` | `boolean` | Explicit opt-out of worktree creation |
| `resumeSessionId` | `string` | Resume an existing Claude Code session by ID |
| `forkSession` | `boolean` | Fork the resumed session instead of continuing in-place |

### 11.6 Multimodal & PR Enrichment Fields

| Field | Type | Purpose |
|-------|------|---------|
| `images` | `ImageAttachment[]` | Base64-encoded images for multimodal prompts |
| `shortNodeId` | `string` | First 6 hex chars of nodeId UUID (for branch names) |
| `shortProjectId` | `string` | First 6 hex chars of projectId UUID (for PR titles) |
| `astroBaseUrl` | `string` | Base URL for linking back to tasks in PR bodies |
| `githubIssueUrl` | `string` | GitHub issue URL to reference in PR body |
| `githubIssueNumber` | `number` | GitHub issue number (e.g., 42 -> "Closes #42") |

### 11.7 Dispatch Signing

For production security, dispatches can be cryptographically signed:

```typescript
dispatchSignature?: string,           // ECDSA P-256 signature (base64url-encoded)
dispatchSigningPayload?: {
  v: 1,                               // Schema version
  nodeId: string,                     // Which task
  projectId: string,                  // Which project
  machineId: string,                  // Target machine (prevents redirection)
  timestamp: string,                  // ISO 8601 (prevents replay)
  nonce: string,                      // 32-byte hex (prevents replay)
}
```

The agent runner can verify the signature to confirm the dispatch came from a legitimate Astro server and was not tampered with or replayed.

### Backward Compatibility

All extension fields are optional. Agent runners that do not recognize them will ignore them. The `dispatchTask()` method in `server/lib/relay-server.ts` conditionally includes each field only when present, ensuring no unnecessary data is sent to older agent runners.

---

## 12. Complete Message Type Reference

This section provides a comprehensive reference of all message types in the protocol, organized by direction.

### Agent Runner -> Relay (Inbound)

| Message Type | Interface | Purpose |
|-------------|-----------|---------|
| `machine.register` | `MachineRegisterMessage` | Machine registration with capabilities |
| `machine.unregister` | `MachineUnregisterMessage` | Graceful machine disconnect |
| `machine.status` | `MachineStatusMessage` | Load and provider status update |
| `provider.status` | `ProviderStatusMessage` | Individual provider status change |
| `task.result` | `TaskResultMessage` | Task execution completed |
| `task.stdout` | `TaskStdoutMessage` | Terminal output streaming |
| `task.text` | `TaskTextMessage` | Structured text output (sequence-numbered) |
| `task.progress` | `TaskProgressMessage` | Progress update (0-100%) |
| `task.session_init` | `TaskSessionInitMessage` | AI session initialized (session ID, model) |
| `task.tool_trace` | `TaskToolTraceMessage` | Tool call with input/output |
| `task.file_change` | `TaskFileChangeMessage` | File created/modified/deleted with diff |
| `task.approval_request` | `TaskApprovalRequestMessage` | Agent asking user a question |
| `task.steer.ack` | `TaskSteerAckMessage` | Acknowledgment of steering message |
| `heartbeat.pong` | `HeartbeatPongMessage` | Heartbeat response |
| `file_list.response` | `FileListResponseMessage` | File listing result |
| `directory_list.response` | `DirectoryListResponseMessage` | Directory listing result |
| `create_directory.response` | `CreateDirectoryResponseMessage` | Directory creation result |
| `repo_detect.response` | `RepoDetectResponseMessage` | Repository detection result |
| `branch_list.response` | `BranchListResponseMessage` | Branch listing result |
| `git_init.response` | `GitInitResponseMessage` | Git init result |
| `slash_commands.response` | `SlashCommandsResponseMessage` | Slash commands listing |
| `sessions_list.response` | `SessionsListResponseMessage` | Claude Code sessions listing |
| `slurm.job.status` | `SlurmJobStatusMessage` | Slurm job state change |
| `slurm.job.output` | `SlurmJobOutputMessage` | Slurm job stdout/stderr |
| `slurm.job.submitted` | `SlurmJobSubmittedMessage` | Slurm job submission confirmation |

### Relay -> Agent Runner (Outbound)

| Message Type | Interface | Purpose |
|-------------|-----------|---------|
| `task.dispatch` | `TaskDispatchMessage` | Dispatch a task for execution |
| `task.cancel` | `TaskCancelMessage` | Cancel a running task |
| `task.steer` | `TaskSteerMessage` | Inject guidance into running agent |
| `task.approval_response` | `TaskApprovalResponseMessage` | User's answer to agent question |
| `heartbeat.ping` | `HeartbeatPingMessage` | Heartbeat check |
| `machine.register.ack` | `MachineRegisterAckMessage` | Registration confirmation |
| `file_list.request` | `FileListRequestMessage` | Request file listing |
| `directory_list.request` | `DirectoryListRequestMessage` | Request directory listing |
| `create_directory.request` | `CreateDirectoryRequestMessage` | Request directory creation |
| `repo_detect.request` | `RepoDetectRequestMessage` | Request repository detection |
| `branch_list.request` | `BranchListRequestMessage` | Request branch listing |
| `git_init.request` | `GitInitRequestMessage` | Request git initialization |
| `slash_commands.request` | `SlashCommandsRequestMessage` | Request slash commands |
| `sessions_list.request` | `SessionsListRequestMessage` | Request sessions listing |
| `error` | `ErrorMessage` | Error notification |

### MCP Bridge -> Relay (Session)

| Message Type | Interface | Purpose |
|-------------|-----------|---------|
| `session.attach` | `SessionAttachMessage` | Attach to observe a session |
| `session.detach` | `SessionDetachMessage` | Stop observing a session |
| `session.event` | `SessionEventMessage` | Session event from MCP bridge |

### Relay -> MCP Bridge (Session)

| Message Type | Interface | Purpose |
|-------------|-----------|---------|
| `session.attach.ack` | `SessionAttachAckMessage` | Attachment confirmation |
| `error` | `ErrorMessage` | Error notification |

### Platform Internal (Redis Pub/Sub)

| Event | Interface | Purpose |
|-------|-----------|---------|
| `machine.connected` / `machine.disconnected` / `machine.updated` | `MachineStateChangeEvent` | Machine registry state changes |
| `task.dispatched` / `task.started` / `task.completed` / `task.failed` / `task.cancelled` | `TaskStateChangeEvent` | Task lifecycle state changes |

---

## 13. Authentication

Authentication answers the question: "How does the Relay know it should trust this Agent Runner?" The answer depends on the mode.

### 13.1 Local Mode

No authentication. The Agent Runner connects with machine ID headers only (`x-runner-id`, `x-machine-id`). This is safe because in local mode, everything runs on the same machine -- there is no network boundary to protect. Requiring authentication here would just add friction to local development.

In development mode (non-production), the Relay logs a security warning when accepting unauthenticated connections. If JWT verification fails in dev mode, it falls back to accepting the connection with a dev identity.

### 13.2 Server Mode

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

JWT tokens in Astro contain:

```typescript
interface MachineJWTPayload {
  sub: string,         // Machine ID
  iat: number,         // Issued at (Unix timestamp)
  exp: number,         // Expires at (Unix timestamp)
  scopes: string[],    // Permissions (e.g., ['machine:connect', 'task:execute'])
  machineId: string,   // Which machine
  userId?: string,     // Which user owns the machine
  workspaceId?: string, // Which workspace (multi-tenant)
}
```

---

## 14. Configuration

The Relay server uses the following configuration, with sensible defaults:

```typescript
interface RelayServerConfig {
  port: number,                     // Default: 3002
  heartbeatIntervalMs: number,      // Default: 30000 (30 seconds)
  heartbeatTimeoutMs: number,       // Default: 180000 (6 missed heartbeats)
  disconnectGracePeriodMs: number,  // Default: 180000 (3 minutes)
  maxConnectionsPerMachine: number, // Default: 1
  rateLimit: {
    windowMs: number,               // Default: 60000 (1 minute)
    maxRequests: number,            // Default: 1000
    maxTasksPerMinute: number,      // Default: 100
    maxStdoutBytesPerSecond: number, // Default: 1MB/s
  },
  redisUrl?: string,                // Redis URL for horizontal scaling
  jwtSecret?: string,               // JWT secret for authentication
}
```

### Rate Limiting

Each connected machine is subject to rate limiting:
- **Request rate**: Maximum 1000 requests per minute per machine
- **Stdout bandwidth**: Maximum 1 MB/s per machine (messages exceeding this are dropped)
- **Task rate**: Maximum 100 task dispatches per minute

Rate limit state is per-machine and resets each minute.
