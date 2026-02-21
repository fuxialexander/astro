# Astro Agent Runner — Design Document

## 1. Overview: What Is the Agent Runner and Why Does It Exist?

### What It Is

The Agent Runner is the **worker** in the Astro system. It is the only component that actually talks to AI (Claude) and executes code changes on your machine. Think of it like a contractor you hire: the Astro backend (the project manager) sends it task instructions, and it does the actual work — writing code, running tests, creating pull requests — then reports back what it did.

Technically, it is a standalone Node.js process (a program written in JavaScript that runs outside the browser). It connects to the Astro backend via WebSocket, receives task dispatches, runs them using AI providers (Claude SDK, Claude CLI, Codex), and streams results back.

### Why It Is Separate from the Backend

You might wonder: why not just have the backend talk to Claude directly? There are two important reasons:

1. **Security: Your AI credentials never leave your machine.** The Agent Runner holds your Claude API key or OAuth token locally. These credentials are never uploaded to the Astro server. This means even if the server were compromised, your AI credentials would be safe.

2. **Flexibility: You can run tasks on different machines.** You might want to run AI tasks on your laptop for quick things, on an HPC cluster (a shared supercomputer) for heavy computation, or on a cloud VM for long-running jobs. Each machine runs its own Agent Runner instance, and the Astro backend coordinates them all.

### Key Identifiers

- **Package**: `@astro/agent` (npm)
- **CLI binary**: `astro-agent`
- **Location**: `packages/agent-runner/`
- **Config directory**: `~/.config/astro-agent/` (platform-dependent, via `conf` package)
- **Data directory**: `~/.astro/`

---

## 2. CLI Commands

The Agent Runner is a **CLI** (Command Line Interface) — a program you run from the terminal/command line, like `git` or `npm`. You interact with it by typing commands rather than clicking buttons in a graphical interface.

Entry point: `src/cli.ts` (339 lines), built with `commander` (a popular library for building CLI tools in Node.js).

| Command | Purpose | Key Options |
|---------|---------|-------------|
| `setup` | First-time configuration: detect providers, authenticate via device code flow | `--api`, `--relay`, `--type`, `--skip-auth`, `--install-mcp` |
| `start` / `connect` | Start the agent runner (foreground or background) | `-f/--foreground`, `--relay`, `--max-tasks`, `--log-level`, `--sandbox` |
| `stop` | Stop running agent | |
| `status` | Show configuration, resources, providers, connection status | |
| `auth` | Set Claude OAuth token from `claude setup-token` output | |
| `config` | Show/modify configuration | `--show`, `--reset`, `--set key=value` |
| `providers` | List detected agent providers | |
| `resources` | Show CPU, memory, GPU information | |
| `hosts` | Discover remote hosts from SSH config | |
| `mcp` | Start MCP server for Claude Code integration (stdio mode) | |

**Example usage:**

```bash
# First time: set up the agent runner
astro-agent setup

# Start it in the background (default)
astro-agent start

# Or run it in the foreground so you can see logs
astro-agent start -f

# Check what's happening
astro-agent status

# Stop it
astro-agent stop
```

---

## 3. Startup Flow

When you start the Agent Runner, it goes through a carefully ordered sequence to get everything ready. This section describes what happens behind the scenes.

`src/commands/start.ts` (394 lines):

1. **Check setup completed** — Ensures you've run `astro-agent setup` first.
2. **Initialize machine ID** — Generates a unique identifier for this computer based on its hardware (so the server can tell your machines apart).
3. **Background mode** (default): Spawn detached child process, report PID. This means the runner starts in the background and you get your terminal back. The "PID" is the process ID number, which you can use to find or stop it later.
4. **Foreground mode** (with `-f` flag):
   - Detect resources (CPU, memory, GPU via `nvidia-smi`)
   - Detect providers (Claude Code CLI, Claude SDK, Codex) — which AI tools are installed on this machine
   - Detect execution strategies (Direct, Docker, SLURM, K8s, SkyPilot) — which ways of running commands are available
   - Create WebSocket client with auto-reconnection (see section 4 for what WebSocket means)
   - Create task executor with safety checks
   - Wire up message handlers — these connect incoming messages to the right functions:
     - `onTaskDispatch` -> `submitTask()` — "here's a new task to do"
     - `onTaskCancel` -> `cancelTask()` — "stop that task"
     - `onTaskSteer` -> inject steering message into adapter — "change direction mid-task"
     - `onTaskSafetyDecision` -> route decision — "user says it's okay to proceed"
     - `onFileList` -> respond with `git ls-files` — "what files are in this repo?"
     - `onRepoSetup` -> initialize repository — "clone this repo and get ready"
   - Connect to relay (the communication hub on the server)
   - Install signal handlers (SIGINT, SIGTERM) — so pressing Ctrl+C shuts down gracefully

**Graceful shutdown**: When you press Ctrl+C (or the system sends a stop signal), the runner does not just die. First signal: cancel all running tasks, disconnect from the server, exit cleanly. Second signal (if you press Ctrl+C again impatiently): force exit immediately. Timeout: if shutdown takes more than 3 seconds, force exit.

---

## 4. WebSocket Client

### What Is a WebSocket?

A **WebSocket** is a persistent two-way communication channel between two programs. Unlike HTTP, where you send a request and wait for a response (like sending a letter and waiting for a reply), a WebSocket stays open so both sides can send messages at any time. Think of it like a phone call versus sending letters — once the connection is open, either side can talk whenever they want.

The Agent Runner uses a WebSocket to stay connected to the Astro backend. This lets the server instantly send new tasks, and the runner can instantly stream back results as work progresses.

`src/lib/websocket-client.ts` (855 lines)

### 4.1 Connection

- Library: `ws` package
- Default relay URL: `ws://localhost:3002` (local development) or `wss://relay.astro.dev` (remote/production)
- Authentication: `Authorization: Bearer <token>` header + `X-Runner-Id` + `X-Machine-Id` headers — these prove to the server that this runner is authorized and identify which machine it is
- Token refresh via `/api/device/refresh` endpoint before connection if expired — tokens expire for security, so the runner automatically gets a new one before reconnecting

### 4.2 Auto-Reconnection

Networks are unreliable. Your WiFi might drop, the server might restart. The runner handles this automatically:

- **Exponential backoff with jitter**: If the connection drops, it waits before retrying. Each retry waits longer (1s, 2s, 4s, 8s...) up to a maximum, with a small random variation ("jitter") to prevent all runners from reconnecting at the exact same instant.
- Base delay: 1 second, max delay: 60 seconds
- Retries: infinite by default (`reconnectMaxRetries: -1`) — it will keep trying forever until it reconnects
- Token expiration check before each connection attempt

### 4.3 Heartbeat

Like a pulse check at the doctor's office, the runner periodically tells the server "I'm still alive and here's how I'm doing":

- Interval: 30 seconds
- Sends: machine resources (CPU, memory usage) + active task list
- Application-level heartbeat + WebSocket-level ping (two layers of health checking)

### 4.4 Messages Sent (Agent Runner -> Server)

These are all the types of messages the runner can send to the server. Each message has a `type` field that tells the server what kind of message it is.

| Type | Purpose |
|------|---------|
| `register` | Machine registration with capabilities (providers, resources) — "Hi, I'm machine X and I can do Y" |
| `heartbeat` | Periodic health check with resource update — "Still alive, here's my CPU/memory" |
| `task_status` | Task state change — "Task ABC moved from running to completed" |
| `task_output` | Stdout/stderr chunk (sequence-numbered) — raw text output as the AI works, numbered so the server can reassemble them in order |
| `task_result` | Final task result (status, output, PR info) — "Task done, here's the summary and PR link" |
| `task_text` | Structured text output (bypasses stdout throttle) — important text that should arrive immediately |
| `task_tool_use` | Tool invocation metadata — "The AI is calling tool X with these inputs" |
| `task_tool_result` | Tool completion metadata — "Tool X returned this result" |
| `task_tool_trace` | Legacy tool trace format (older format, kept for compatibility) |
| `task_file_change` | File modification (path, action, diff) — "File X was edited, here's what changed" |
| `task_session_init` | Session initialized (sessionId, model) — "AI session started, using Claude Sonnet" |
| `task_steer_ack` | Steering message acknowledged — "Got your mid-task instruction" |
| `task_approval_request` | Request user decision (with 60s timeout) — "The AI needs you to decide something" |
| `resource_update` | Machine resource update — "My CPU usage changed" |
| `file_list_response` | Response to file listing request — "Here are all the files in the repo" |
| `repo_setup_response` | Repository setup result — "Repo cloned and ready" |

### 4.5 Messages Received (Server -> Agent Runner)

These are all the types of messages the server can send to the runner.

| Type | Purpose |
|------|---------|
| `registered` | Registration acknowledgment with server config — "Welcome, here's your config" |
| `task_dispatch` | Task assignment — "Here's a new task for you to execute" |
| `task_cancel` | Cancel running task — "Stop working on task X" |
| `task_steer` | Mid-execution steering message — "Tell the AI to change approach" |
| `task_approval_response` | User's answer to approval request — "The user said yes/no to your question" |
| `task_safety_decision` | User's safety check decision (proceed/init-git/sandbox/cancel) — "The user decided how to handle the risky situation" |
| `config_update` | Runtime configuration changes — "Update your settings" |
| `file_list_request` | Request for git file listing — "Tell me what files are in the repo" |
| `repo_setup_request` | Clone/init repository — "Set up this repository" |

---

## 5. Task Executor

The Task Executor is the core engine that manages the lifecycle of tasks — from receiving them, to running them safely, to reporting results. Think of it as the foreman on a construction site: it decides when to start work, manages multiple jobs in parallel, and ensures everything is done safely.

`src/lib/task-executor.ts` (697 lines)

### 5.1 Architecture

- **Task queue with configurable max concurrent tasks** (default: 4) — the runner can work on up to 4 tasks simultaneously
- `taskQueue` stores pending tasks that are waiting for a slot to open up
- `runningTasks` Map tracks executing tasks with AbortController (a mechanism to cancel a task mid-execution)
- `processQueue()` promotes queued tasks when slots become available — like a waiting room where the next person is called when someone leaves

### 5.2 Task Lifecycle

Every task goes through these stages:

**1. Submit** (`submitTask()`, lines 98-142):
   - **Safety check** on working directory (see section 7 for full details)
   - **UNSAFE tier** -> block immediately (refuse to run)
   - **RISKY tier** -> request user decision via safety prompt (ask first)
   - **GUARDED tier** -> warn but continue (proceed with caution)
   - Track task by directory for parallel execution safety (prevent two tasks from stomping on each other's files)
   - Queue or execute based on available slots

**2. Workspace Preparation** (`prepareTaskWorkspace()`, lines 594-625):
   - Create git worktree if enabled (default: true) — see section 9 for what worktrees are and why we use them
   - Fall back to direct execution if worktree creation fails
   - Non-fatal failures (don't abort task) — if worktree setup fails, the task still runs, just without isolation

**3. Execution** (`executeTask()`, lines 399-592):
   - Optional sandbox mode (copy working directory to temp location for safe experimentation)
   - Create provider adapter for task's specified provider (e.g., Claude Code, Claude SDK, or Codex)
   - Build stream object with callbacks (see section 5.3)
   - Execute with timeout (default: 1 hour) — if the AI takes too long, the task is cancelled
   - Attempt PR creation on success (automatically create a pull request with the changes)
   - Handle Slurm job monitoring (defer completion if jobs pending) — for HPC tasks, the task isn't "done" until the cluster job finishes
   - Cleanup worktree and sandbox

**4. Cancellation** (`cancelTask()`, lines 164-185):
   - If running: abort via AbortController (sends a signal to stop the AI mid-work)
   - If queued: remove from queue (hasn't started yet, just take it out)
   - Cleanup resources

### 5.3 Stream Object

The stream object is the communication bridge between the task executor and provider adapters. As the AI works, it generates various outputs (text, tool calls, file changes). All of these flow through the stream object's callbacks, which forward them to the server via WebSocket.

Think of it as a set of labeled pipes: stdout goes through one pipe, tool calls through another, file changes through a third. Each pipe leads back to the server so the user can watch everything in real time.

```typescript
{
  stdout(data)              // Raw stdout text (what the AI prints to the console)
  stderr(data)              // Raw stderr text (error output)
  status(status, progress?, message?)  // Task state update ("50% done", "compiling...")
  toolTrace(toolName, input?, result?, success?)  // Tool call (legacy format)
  text(data)                // Structured text output (formatted, not raw)
  toolUse(toolName, input)  // Tool invocation — "AI is using tool X"
  toolResult(toolName, result, success)  // Tool completion — "tool X returned Y"
  fileChange(path, action, linesAdded?, linesRemoved?, diff?)  // File modification
  sessionInit(sessionId, model?)  // Session started with AI model
  approvalRequest(question, options)  // Ask user for decision before proceeding
}
```

Each callback is wired to the WebSocket client's send methods, so output streams directly to the server in real time.

### 5.4 Working Directory Resolution

When a task arrives, the runner needs to figure out WHERE on disk to work. This function resolves that:

`resolveWorkingDirectory()` (lines 674-696):
- **Git URL** -> clone to `~/.astro/repos/{projectId}/` (cached, periodic fetch) — if the task references a GitHub repo, clone it locally
- **Empty/undefined** -> `process.cwd()` — if no directory specified, use wherever the runner is running
- **Absolute path** -> use as-is — if a full path is given (like `/home/user/myproject`), use that directly

---

## 6. Provider Adapters

### What Are Provider Adapters?

Provider adapters are different **"drivers"** for different AI tools. Just like your computer needs different drivers for different printers (HP, Canon, Epson), the Agent Runner needs different adapters for different AI tools:

- The **Claude SDK adapter** talks to Claude's API directly in code (like calling a function).
- The **Claude Code adapter** runs the Claude CLI as a subprocess (like running a separate program).
- The **Codex adapter** runs OpenAI's Codex CLI.

They all produce the same output format, so the rest of the system doesn't care which AI is doing the work. This makes it easy to add new AI providers in the future.

All adapters implement the `ProviderAdapter` interface from `src/providers/base-adapter.ts`:

```typescript
interface ProviderAdapter {
  readonly type: string;            // e.g., 'claude-code', 'claude-sdk', 'codex'
  readonly name: string;            // Human-readable name
  isAvailable(): Promise<boolean>;  // Can this provider be used right now?
  execute(task, stream, signal): Promise<TaskResult>;  // Do the work
  getStatus(): Promise<ProviderStatus>;  // How's the provider doing?
}
```

### 6.1 Claude Code Adapter (`src/providers/claude-code-adapter.ts`, 315 lines)

This adapter runs the Claude Code CLI as a separate process (a "subprocess"). It's like launching a program from within another program and reading what it prints out.

- **Type**: `claude-code`
- **Max concurrent**: 1 (only one Claude Code session at a time, because the CLI manages its own state)
- **Execution**: Spawns `claude --print --output-format stream-json <prompt>` as subprocess
- **Arguments**: `--print` (autonomous mode, no interactive prompts), `--verbose`, `--output-format stream-json` (outputs structured JSON instead of plain text)
- **Stream parsing**: JSON lines. Each line is a JSON object with a type:
  - `system` -> session init (model info)
  - `assistant` -> text blocks + tool uses (what the AI says and does)
  - `user` -> tool results (what happened when a tool ran)
  - `result` -> final result with cost info (done! here's what it cost)
- **Signal handling**: SIGTERM then SIGKILL after 5s — asks the process nicely to stop, then forces it if it doesn't respond within 5 seconds
- **Steering**: `injectMessage()` writes to process stdin (if supported) — you can send new instructions to the AI mid-execution by writing to its input stream

### 6.2 Claude SDK Adapter (`src/providers/claude-sdk-adapter.ts`, 502 lines)

This adapter talks to Claude directly through the SDK (Software Development Kit) — a code library that communicates with Claude's API. Instead of spawning a separate program, it makes API calls within the same process. This gives more control and allows more concurrent tasks.

- **Type**: `claude-sdk`
- **Max concurrent**: 4 (more than Claude Code because it's in-process and lighter weight)
- **Execution**: In-process via `@anthropic-ai/claude-agent-sdk` `query()` API
- **Authentication**: `CLAUDE_CODE_OAUTH_TOKEN` env var or config
- **Key features**:
  - **HPC context injection** (lines 319-335): When running on a supercomputer cluster, the adapter automatically prepends HPC-specific context to the prompt so the AI understands the computing environment
  - **Approval interception** (lines 254-316): If the AI calls a tool named `AskUserQuestion`, the adapter intercepts it and routes the question to the user via the WebSocket, waits for their answer, then feeds it back to the AI
  - **Sbatch job tracking** (lines 438-449): When the AI submits a SLURM job (a task on a supercomputer), the adapter detects the "Submitted batch job NN" message and starts monitoring that job
  - **MCP server loading** (lines 342-369): Loads configured MCP servers and injects the `ASTRO_EXECUTION_ID` so tools know which task they're part of (see section 11 for what MCP is)
  - **Structured output** (lines 338-340, 457-470): Can request the AI to respond in a specific JSON format (defined by a schema)
  - **Mid-execution steering** (`injectMessage()`, lines 148-189): Uses `Query.streamInput()` + `Query.interrupt()` to send new instructions to the AI while it's working — like tapping someone on the shoulder and saying "actually, try this instead"
- **Working directory**: Explicitly `process.chdir()` to task directory (restored in finally block) — temporarily changes the working directory so the AI's file operations happen in the right place

### 6.3 Codex Adapter (`src/providers/codex-adapter.ts`, 230 lines)

This adapter runs OpenAI's Codex CLI as a subprocess, similar to how the Claude Code adapter works but for a different AI tool.

- **Type**: `codex`
- **Max concurrent**: 1
- **Execution**: Spawns `codex exec -a never --sandbox <mode> --json <prompt>`
- **Sandbox modes**: `danger-full-access` (if already containerized, so sandbox is redundant), `workspace-write` (otherwise — restricts what the AI can modify)
- **Output**: JSONL parsing for structured events (each line is a JSON object)

### 6.4 SLURM Adapter (`src/providers/slurm-adapter.ts`, ~80 lines)

- **Status**: Deprecated (use `SlurmStrategy` execution strategy instead — see section 8.3)
- **Purpose**: Was a bridge between tasks and SLURM job submission. Now replaced by the more flexible execution strategy system.

---

## 7. Safety System

### Why We Need Safety Guardrails

When an AI agent writes and executes code on your machine, things can go wrong. It might overwrite important files, delete something you need, or make changes you can't easily undo. The safety system is a set of guardrails to prevent the AI from accidentally damaging your files.

The key insight: **if you're working in a git repo, the system knows it can undo changes** (because git tracks everything). **If you're NOT in a git repo, it warns you because changes might be irreversible** — there's no safety net.

`src/lib/workdir-safety.ts` (~160 lines)

### 7.1 Safety Tiers

The system classifies every working directory into one of four tiers, from safest to most dangerous:

| Tier | Condition | Action | Why |
|------|-----------|--------|-----|
| **SAFE** | Git repo, clean state (no uncommitted changes) | Proceed | Everything is tracked by git; any changes can be reverted |
| **GUARDED** | Git repo, uncommitted changes | Warn but proceed | Git can still help, but you have unsaved work that could be affected |
| **RISKY** | Non-git directory | Require user confirmation | No version control = no easy undo. User must explicitly accept the risk |
| **UNSAFE** | Non-git + parallel execution in same directory | Block with error | Two tasks modifying the same untracked files simultaneously is a recipe for data loss |

### 7.2 Safety Check Flow

`checkWorkdirSafety()` runs automatically before every task:
1. **Detect git repo**: `git rev-parse --show-toplevel` — asks git "is this a repository?"
2. **Check uncommitted changes**: `git status --porcelain` — asks git "are there any unsaved modifications?"
3. **Check parallel task count** in directory — are other tasks already working here?
4. **Return tier + reason** — the tier determines what happens next (proceed, warn, ask, or block)

### 7.3 Sandbox Mode

For extra caution, tasks can run in a "sandbox" — a temporary copy of your project:

`createSandbox()`:
- Copy working directory to temp location (max 100MB default, configurable via `--max-sandbox-size`) — makes a clone of your files in a temporary folder
- Execute in isolation — the AI works on the copy, not your real files
- Review before applying changes — you can inspect what the AI did before it touches your actual project
- `copyBack()` applies sandbox changes to original — only when you approve, the changes are copied back

---

## 8. Execution Strategies — Where and How Commands Run

### Why Execution Strategies Exist

When the AI generates a command (like "run this Python script" or "submit this SLURM job"), something needs to actually execute that command. But WHERE that command runs depends on the environment:

- On your laptop? → Direct strategy (just run it)
- Inside a Docker container? → Docker strategy (isolate it)
- On an HPC login node? → SLURM strategy (queue jobs to compute nodes)
- Have kubectl access? → K8s Exec strategy (execute commands in pods from outside)
- On a rented cloud VM (Lambda Labs, etc.)? → Direct strategy (it's just a Linux machine)
- Want to provision cloud VMs on-demand? → SkyPilot strategy (experimental, not currently supported)

Execution strategies answer "WHERE and HOW does a command run?" They are **orthogonal** (independent) to provider adapters, which answer "WHAT AI reasons about the task?" You can combine any provider with any strategy:

```
             │  Direct   │  Docker   │  SLURM    │ K8s Exec  │ SkyPilot* │
─────────────┼───────────┼───────────┼───────────┼───────────┼───────────┤
Claude SDK   │ SDK +     │ SDK +     │ SDK +     │ SDK +     │ SDK +     │
             │ local     │ container │ HPC job   │ kubectl   │ cloud VM  │
─────────────┼───────────┼───────────┼───────────┼───────────┼───────────┤
Claude CLI   │ CLI +     │ CLI +     │ CLI +     │ CLI +     │ CLI +     │
             │ local     │ container │ HPC job   │ kubectl   │ cloud VM  │
─────────────┼───────────┼───────────┼───────────┼───────────┼───────────┤
Codex        │ Codex +   │ Codex +   │    —      │    —      │    —      │
             │ local     │ container │           │           │           │

* SkyPilot is experimental and not currently supported.
```

**Note on rented cloud VMs**: A rented VM (Lambda Labs, Hyperbolic AI, etc.) with an agent runner installed uses the Direct strategy. The AI runs on that VM and executes commands locally. It appears in the "Direct" column.

**Important**: The AI (provider) always runs on the agent runner's machine. The execution strategy determines where the AI's **tool calls** (running commands, reading files) happen.

### Sync vs Async

**Synchronous strategies**: Run a command and wait. Output streams back in real time. The agent runner's process is occupied until the command finishes.

**Asynchronous strategies**: Submit a job to a resource manager and poll for completion. There may be a queue, or resources may need provisioning. The agent runner submits and then periodically checks status.

### Core Interface

**File**: `src/execution/types.ts` (115 lines)

```typescript
interface ExecutionStrategy {
  readonly id: ExecutionStrategyType;   // 'direct' | 'slurm' | 'docker' | 'k8s-exec' | 'skypilot'
  readonly name: string;
  readonly isAsync: boolean;            // true = submit-and-monitor

  detect(): Promise<ExecutionStrategyDetection>;     // Probe environment
  buildContext?(): Promise<string>;                   // AI-aware prompt prefix
  execute(spec, callbacks, signal): Promise<ExecutionResult>;  // Run command
  cancel(jobId): Promise<void>;                      // Stop job
  getStatus(jobId): Promise<ExecutionJobStatus | null>;  // Poll status
}
```

**Registry**: `src/execution/registry.ts` (104 lines) — manages all strategies. `detectAll()` probes all 5 in parallel on startup, stores results. `get(id)` retrieves by ID. `getDefault()` returns Direct strategy as fallback.

---

### 8.1 Direct Strategy (`src/execution/direct-strategy.ts`, 187 lines)

The simplest strategy: run a command on the same machine where the agent runner is installed.

```
┌─────────────────────────────────────┐
│  AGENT RUNNER'S MACHINE             │
│                                     │
│  Agent Runner                       │
│  ┌─────────────┐                    │
│  │ AI (Claude) │                    │
│  │ "run tests" │                    │
│  └──────┬──────┘                    │
│         │ spawn('sh', '-c', cmd)    │
│         ▼                           │
│  ┌─────────────┐                    │
│  │ Child       │ ← stdout/stderr    │
│  │ Process     │   streams back     │
│  └─────────────┘                    │
└─────────────────────────────────────┘
```

| Property | Value |
|----------|-------|
| **ID** | `direct` |
| **Async** | No — waits for process to finish |
| **Detection** | Always available (every machine can run processes) |
| **When to use** | Default for any task running on the agent runner's own machine |
| **Limitation** | No isolation between tasks. Everything runs with agent runner's permissions. |

**Execution**: Uses `child_process.spawn()`. String commands wrapped in `sh -c`. Array commands exec'd directly. Handles timeout and AbortSignal. SIGTERM → 5s grace → SIGKILL.

**Context injection** (`buildContext()`): Adds Python virtual environment safety guidelines — "NEVER run pip install globally, ALWAYS use venv/conda/uv."

---

### 8.2 Docker Strategy (`src/execution/docker-strategy.ts`, 266 lines)

Runs commands inside a Docker container. Each task gets its own isolated filesystem and environment. The working directory is mounted as a volume.

```
┌─────────────────────────────────────────────────┐
│  AGENT RUNNER'S MACHINE                         │
│                                                 │
│  Agent Runner                                   │
│  ┌─────────────┐                                │
│  │ AI (Claude) │                                │
│  │ "run tests" │                                │
│  └──────┬──────┘                                │
│         │ docker run --rm -v $PWD:/work ...     │
│         ▼                                       │
│  ┌─────────────────────────────────────┐       │
│  │ Docker Container (astro-{jobId})    │       │
│  │ Image: node:22-slim                 │       │
│  │ /work ← mounted from host cwd      │       │
│  │ env vars passed through             │       │
│  │                                     │       │
│  │  ┌─────────────┐                    │       │
│  │  │ Command     │ ← stdout/stderr    │       │
│  │  │ runs here   │   streams back     │       │
│  │  └─────────────┘                    │       │
│  └─────────────────────────────────────┘       │
└─────────────────────────────────────────────────┘
```

| Property | Value |
|----------|-------|
| **ID** | `docker` |
| **Async** | No — waits for container to finish |
| **Detection** | `docker info --format '{{.ServerVersion}}'` |
| **Default image** | `node:22-slim` (configurable) |
| **When to use** | When tasks need isolation, or a specific environment (Python version, system libraries) |
| **Limitation** | Docker must be running. Container startup adds latency. GPU requires nvidia-docker. |

**Options**: `image`, `volumes` (additional mounts), `network`, `user`.

**Cleanup**: On abort/timeout: `docker stop` → `docker rm -f`. Container named `astro-{jobId}` for tracking.

---

### 8.3 SLURM Strategy (`src/execution/slurm-strategy.ts`, 245 lines)

SLURM (Simple Linux Utility for Resource Management) is software used on supercomputers and HPC clusters. When you submit a SLURM job, it goes into a queue and runs when resources (CPUs, GPUs, memory) become available on compute nodes. This is how researchers run large computations on shared clusters.

**Critical architecture requirement**: The agent runner MUST be installed on the HPC **login node** — the gateway machine where users submit jobs. Compute nodes do NOT have agent runners.

```
┌──────────────────────────────────────────────────────┐
│  HPC CLUSTER                                         │
│                                                      │
│  ┌───────────────────────────┐                       │
│  │  LOGIN NODE               │                       │
│  │                           │                       │
│  │  Agent Runner ◄── ws:// ── Relay                  │
│  │  ┌──────────────────────┐ │                       │
│  │  │ AI (Claude)          │ │                       │
│  │  │ Writes SLURM scripts │ │                       │
│  │  │ Reads HPC data       │ │                       │
│  │  │ Inspects job output  │ │                       │
│  │  └──────────┬───────────┘ │                       │
│  │             │             │                       │
│  │  ┌──────────▼───────────┐ │                       │
│  │  │ SLURM Strategy       │ │                       │
│  │  │ sbatch → submit job  │ │                       │
│  │  │ squeue → check queue │ │                       │
│  │  │ sacct  → job history │ │                       │
│  │  │ scancel → cancel job │ │                       │
│  │  └──────────┬───────────┘ │                       │
│  └─────────────┼─────────────┘                       │
│                │ sbatch                               │
│                ▼                                      │
│  ┌────────────────────────────────────────┐          │
│  │  COMPUTE NODES (managed by scheduler)  │          │
│  │                                        │          │
│  │  ┌──────────┐  ┌──────────┐  ┌──────┐ │          │
│  │  │ Node 1   │  │ Node 2   │  │ ...  │ │          │
│  │  │ 8 GPUs   │  │ 8 GPUs   │  │      │ │          │
│  │  │ No agent │  │ No agent │  │      │ │          │
│  │  └──────────┘  └──────────┘  └──────┘ │          │
│  └────────────────────────────────────────┘          │
│                                                      │
│  ┌────────────────────────────────────────┐          │
│  │  SHARED STORAGE (NFS/Lustre/GPFS)     │          │
│  │  /home, /scratch, /data               │          │
│  │  Accessible from login + compute      │          │
│  └────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────┘
```

**Why not SSH from laptop to run sbatch?** The AI needs:
- **Direct filesystem access** — to read datasets, write scripts, inspect outputs on the shared storage
- **HPC environment knowledge** — which modules exist (`module avail`), which partitions, what quotas
- **Low-latency tool calls** — every file read/write over SSH adds latency per AI turn
- **Native sbatch/sinfo/squeue access** — without wrapping in SSH commands

| Property | Value |
|----------|-------|
| **ID** | `slurm` |
| **Async** | Yes — submit job, poll for completion |
| **Detection** | `detectSlurm()` checks for `sinfo`, `sbatch`. Returns cluster name, partitions, accounts, QoS. |
| **Context** | `buildHpcContext()` — tells AI about cluster environment so it generates proper SLURM scripts |
| **Config options** | `partition`, `nodes`, `ntasks`, `cpusPerTask`, `mem`, `time`, `qos`, `account`, `modules`, `gpu` |
| **Job tracking** | Maps internal jobId → SLURM job ID. Cancel via `scancel`. |

**Status polling**: First tries `squeue -j <id>` (for running/pending jobs), falls back to `sacct -j <id>` (for completed jobs). Returns state and exit code.

---

### 8.4 Kubernetes Exec Strategy (`src/execution/kubernetes-exec-strategy.ts`, 285 lines)

Runs commands inside an existing Kubernetes pod via `kubectl exec`. The agent runner stays **outside** the cluster — on the user's laptop or any machine with kubectl configured. No agent runner installation is needed on the K8s cluster or in any pod.

```
┌──────────────────────┐           ┌───────────────────────────┐
│  USER'S MACHINE      │           │  KUBERNETES CLUSTER       │
│                      │           │                           │
│  Agent Runner        │           │  ┌───────────────────┐    │
│  ┌────────────────┐  │  kubectl  │  │  Pod A (your app) │    │
│  │ AI (Claude)    │  │  exec     │  │  ┌─────────────┐  │    │
│  │ "run tests"   │──┼──────────►│  │  │ Command     │  │    │
│  └────────────────┘  │           │  │  │ runs here   │  │    │
│  ┌────────────────┐  │           │  │  └─────────────┘  │    │
│  │ K8s Exec      │  │           │  └───────────────────┘    │
│  │ Strategy      │  │           │  ┌───────────────────┐    │
│  └────────────────┘  │           │  │  Pod B (database) │    │
│                      │           │  └───────────────────┘    │
└──────────────────────┘           └───────────────────────────┘
```

| Property | Value |
|----------|-------|
| **ID** | `k8s-exec` |
| **Async** | No — waits for command to finish in pod |
| **Detection** | Checks `which kubectl`, then `kubectl cluster-info`. Returns cluster URL, version, namespaces, context. |
| **Required option** | `pod` — must specify which pod to exec into |
| **Optional** | `namespace`, `container` |

**Current limitation**: Only supports `kubectl exec` (sync, existing pods). Does NOT support creating Kubernetes Jobs (batch workloads with autoscaler). A future K8sJobStrategy would use `kubectl apply -f job.yaml`, be async, and support K8s autoscaler.

---

### 8.5 Rented Cloud VMs (Lambda Labs, Hyperbolic AI, etc.)

Rented cloud VMs are a distinct category from SkyPilot-managed VMs. These are bare metal or Linux machines you rent on-demand from providers like Lambda Labs, Hyperbolic AI, or similar GPU/CPU rental services. You get SSH access to them, and they are just regular Linux machines.

**Key insight**: If you are ON a rented cloud VM, it is just the Direct strategy. There is nothing special about it from the agent runner's perspective — it's a Linux machine with GPUs, Docker, etc. The agent runner detects what's available and uses it.

```
┌─────────────────────────────────────────────────────────────────┐
│  USER'S LAPTOP                                                  │
│  Agent Runner (primary)                                         │
│                                                                  │
│  SSH connections to rented VMs:                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ ssh lambda-vm-1  │  │ ssh lambda-vm-2  │  │ ssh hyper-1  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘  │
│           │                     │                     │          │
└───────────┼─────────────────────┼─────────────────────┼──────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Lambda Labs VM 1 │  │ Lambda Labs VM 2 │  │ Hyperbolic VM 1  │
│ 8×A100 GPUs      │  │ 4×H100 GPUs      │  │ 8×A6000 GPUs     │
│                  │  │                  │  │                  │
│ Agent Runner ◄───┼──┼── ws:// ─── Relay│  │ Agent Runner ◄───┤
│ (Direct strat.)  │  │ Agent Runner     │  │ (Direct strat.)  │
│                  │  │ (Direct strat.)  │  │                  │
│ Claude Code ✓    │  │ Claude Code ✓    │  │ Claude Code ✓    │
│ Docker ✓         │  │ Docker ✓         │  │ Docker ✓         │
│ Python/Conda ✓   │  │ Python/Conda ✓   │  │ Python/Conda ✓   │
└──────────────────┘  └──────────────────┘  └──────────────────┘
        │ ssh                    │ ssh
        ▼                        ▼
   (may connect to            (may connect to
    each other or              other VMs in the
    other VMs)                 same cluster)
```

**How to use rented VMs with Astro:**

| Step | What Happens |
|------|-------------|
| 1 | Rent a VM from Lambda Labs, Hyperbolic AI, etc. You get an SSH address. |
| 2 | SSH in and install the agent runner: `npx astro-agent setup` |
| 3 | Start the agent runner: `astro-agent start -f` |
| 4 | The agent runner connects to the relay (on your backend or cloud). |
| 5 | It detects: Direct strategy, GPUs, Docker, Python envs, etc. |
| 6 | The relay now shows it as a registered machine. |
| 7 | Dispatch tasks to it from the UI like any other machine. |

**Interconnected VMs**: Rented VMs from the same provider may be interconnected (same network, SSH between each other). Each VM has its own agent runner. The relay sees them as independent machines. Multi-machine workflows (e.g., distributed training) are coordinated at the plan level — one task per VM, with dependencies in the plan graph.

**This is different from SkyPilot**: SkyPilot is a tool that *provisions* cloud VMs on your behalf using `sky launch`. Rented VMs are machines *you already have access to* — they exist, you SSH in, you work. No provisioning tool needed.

---

### 8.6 SkyPilot Strategy (`src/execution/skypilot-strategy.ts`, 388 lines) — EXPERIMENTAL

> **Status: Experimental / Not currently supported.** SkyPilot integration exists in code but is not a priority for the current release. The rented cloud VM approach (section 8.5) covers most use cases.

SkyPilot is a tool that abstracts cloud VM provisioning across AWS, GCP, Azure, and other providers. It sits on a machine that has cloud credentials and uses `sky launch` to create VMs, run jobs, and tear them down. It handles cost optimization (spot instances, region selection).

**Important clarification**: SkyPilot is NOT a way to connect to existing VMs. It is a tool that provisions NEW VMs in the cloud. You need:
1. A machine with SkyPilot installed and cloud credentials configured
2. The `sky` CLI available
3. Cloud account(s) (AWS, GCP, Azure)

```
┌──────────────────────┐           ┌───────────────────────────┐
│  MACHINE WITH        │           │  CLOUD (AWS/GCP/Azure)    │
│  SKYPILOT + CREDS    │           │                           │
│                      │           │  ┌───────────────────┐    │
│  Agent Runner        │           │  │  Cloud VM          │    │
│  ┌────────────────┐  │ sky launch│  │  (provisioned)     │    │
│  │ AI (Claude)    │  │  ───────► │  │  4×V100 GPUs       │    │
│  │ "train model"  │  │           │  │  ┌─────────────┐   │    │
│  └────────────────┘  │ sky queue │  │  │ Job runs    │   │    │
│  ┌────────────────┐  │  ◄─────── │  │  │ here        │   │    │
│  │ SkyPilot      │  │           │  │  └─────────────┘   │    │
│  │ Strategy      │  │           │  └───────────────────┘    │
│  └────────────────┘  │           │                           │
└──────────────────────┘           └───────────────────────────┘
```

| Property | Value |
|----------|-------|
| **ID** | `skypilot` |
| **Async** | Yes — provisions VM, runs job, polls for completion |
| **Detection** | Checks for `sky` CLI (including conda envs). `sky check` detects enabled clouds. |
| **Options** | `cluster`, `cloud`, `instanceType`, `gpus`, `numNodes`, `reuseCluster` |
| **Status** | **Experimental — not currently supported** |

**Detection detail**: Also scans conda environments (`~/miniconda3`, `~/anaconda3`, `~/mambaforge`) if `sky` not on PATH.

---

### 8.7 Strategy Comparison

| Aspect | Direct | Docker | SLURM | K8s Exec | Rented VM | SkyPilot |
|--------|--------|--------|-------|----------|-----------|----------|
| **Sync/Async** | Sync | Sync | Async | Sync | Sync (Direct) | Async |
| **Agent runner location** | On the machine | On the machine | HPC login node | Any machine with kubectl | On the rented VM | Any machine with sky CLI |
| **Execution target** | Same machine | Local container | HPC compute nodes | Existing K8s pod | Same machine (it IS the VM) | Provisioned cloud VM |
| **Isolation** | None | Container | Job-level | Pod-level | VM-level (whole machine) | VM-level |
| **GPU support** | Native | nvidia-docker | SLURM `--gres` | Pod resource limits | Native (whatever the VM has) | `--gpus` flag |
| **Cost** | Free | Free | Free (shared) | K8s cluster cost | Rental cost (on-demand) | Cloud pay-per-use |
| **Status** | Stable | Stable | Stable | Stable | Stable | **Experimental** |

**Note on rented VMs**: They use the Direct strategy once the agent runner is installed. They appear in this table as a separate column because the *setup process* is distinct (rent → SSH → install agent runner → connect to relay), but the execution strategy is the same as "Direct."

### 8.8 How the AI Uses Execution Strategies

The flow when a task executes:

| Step | What Happens |
|------|-------------|
| 1 | Task arrives with optional `executionStrategy` field |
| 2 | If specified, use that strategy. Otherwise, use Direct (default). |
| 3 | AI (Claude) runs on the agent runner's machine as a process |
| 4 | AI generates tool calls: "run command X", "read file Y", "write file Z" |
| 5 | Tool implementations use the execution strategy for command execution |
| 6 | Strategy's `buildContext()` injects environment info into AI prompt |
| 7 | For async strategies: AI submits job, strategy polls until complete |

**Example with SLURM**: The AI on the login node generates an sbatch script. When it calls a "run command" tool with `sbatch job.sh`, the command runs directly on the login node (where sbatch lives). SLURM then schedules the job on compute nodes. The strategy polls with squeue until the job completes, then the AI can inspect the output files.

### 8.9 Known Gaps and Future Strategies

| Gap | Current State | Impact | Path Forward |
|-----|--------------|--------|-------------|
| **No K8s Job Strategy** | Only `kubectl exec` (sync, existing pods) | Can't submit K8s batch Jobs with autoscaler support | Add `K8sJobStrategy`: `kubectl apply -f`, async, poll `kubectl get jobs` |
| **No SSH execution** | By design — install agent runners remotely instead | Users must manually install agent runners on each remote machine | Automate via UI "Install Agent Runner" button |
| **No native cloud strategies** | SkyPilot (experimental, not supported) + manual VM setup | Limited integration with cloud-native services (SageMaker, Vertex AI, Azure ML) | Add native strategies per cloud provider |
| **Rented VM setup friction** | Must SSH in and install agent runner manually | Users renting Lambda Labs / Hyperbolic AI VMs need multiple manual steps | Automate via UI + one-click remote install using `ssh-installer.ts` |
| **Manual strategy selection** | User/task config must specify strategy | No auto-routing based on task requirements ("needs GPU" → SLURM machine) | Add capability-based routing in dispatch |
| **No multi-strategy composition** | One strategy per task | Can't say "SSH to remote, then Docker there" | Solution: install agent runner on remote (which can use Docker locally) |
| **Async UX gap** | `isAsync` flag exists but UI doesn't surface it | Users expect immediate output from SLURM/SkyPilot | Show "queued, waiting for resources" state |

---

## 9. Git Worktree Management

### What Are Worktrees?

A **worktree** is git's ability to have multiple copies of a repository checked out at the same time, each on a different branch. Normally, a git repository has one working copy of your files. With worktrees, you can have several, each showing a different branch's version of the code.

Think of it like having **multiple desks, each with their own copy of the paperwork**. You can work on different things at each desk without papers getting mixed up. When you're done at one desk, you can merge that work back into the main pile.

### Why We Use Worktrees

Each task gets its own worktree (branch + working directory copy), so:
- **Multiple tasks can run in parallel on the same repo** — task A and task B can both modify files without interfering with each other
- **Each task's changes are isolated to its own branch** — clean separation
- **No merge conflicts during concurrent execution** — each task sees its own version of the files
- **Easy PR creation per task** — each branch becomes a pull request
- **Cleanup removes the worktree when done** — no leftover mess

`src/lib/worktree.ts` (~100 lines)

### 9.1 Worktree Creation

`createWorktree(taskId, workingDirectory, options)`:

1. Validate taskId format
2. Resolve to absolute path, find git root
3. Check for commits (`git rev-list HEAD`) — ensure the repo has at least one commit
4. Base directory: `~/.astro/worktrees/{repoName}` (or override)
5. Branch name: `astro/{sanitized-taskId}` — e.g., `astro/fix-login-bug`
6. Remove stale worktree if exists, prune dangling worktrees (clean up leftover worktrees from crashed tasks)
7. Delete existing branch with same name (fresh start)
8. `git worktree add -b <branch> <path>` — the actual git command that creates the worktree
9. Apply worktree include files (non-fatal) — optional additional setup
10. Run setup script (non-fatal) — optional project-specific initialization
11. Return `{ path, branch, cleanup() }` — the path to work in, the branch name, and a function to clean up when done

---

## 10. PR Creation

After a task completes successfully and has made code changes, the runner can automatically create a **pull request** (PR) — a proposal to merge the task's changes into the main codebase. This is how changes get reviewed and integrated.

`src/lib/git-pr.ts` (237 lines)

`pushAndCreatePR(branchName, title, body, worktreePath)`:

1. Get git root from worktree
2. Check remote origin exists — verify the repo is connected to a remote (e.g., GitHub)
3. Detect default branch: `refs/remotes/origin/HEAD` -> `origin/main` -> `origin/master` -> `main` — figure out which branch to merge into
4. Check if branch has commits: `git rev-list --count origin/{base}..HEAD` — make sure there are actually changes to propose
5. Push: `git push -u origin {branchName}` — upload the branch to GitHub
6. Create PR (if `gh` CLI available): `gh pr create --base {base} --head {branch} --title {title} --body {body}` — `gh` is GitHub's official CLI tool
7. Return `{ url, prNumber }` or graceful fallback (branch pushed, no PR if `gh` unavailable) — if the GitHub CLI isn't installed, the branch is still pushed; you just need to create the PR manually

---

## 11. MCP Integration

### What Is MCP?

**MCP** stands for **Model Context Protocol**. It's a standard way for AI tools to share capabilities with each other, like how USB lets different devices plug into the same port. Without MCP, every AI tool would need custom integration code for every other tool. With MCP, tools expose a standard set of "here's what I can do" and other tools can use those capabilities.

In Astro's case, MCP lets Claude Code sessions (the AI) interact with the Astro platform — for example, to check what task it's working on, or to send progress updates.

`src/mcp/server.ts` (~80 lines)

The MCP server provides Claude Code sessions with these tools:

| Tool | Purpose |
|------|---------|
| `astro_attach` | Attach Claude Code session to an Astro task — "I'm now working on task X" |
| `astro_detach` | Detach from current task — "I'm done with task X" |
| `astro_status` | Check attachment status — "Which task am I attached to?" |
| `astro_send` | Send message/event to Astro (tool_call, tool_result, file_change, message, error) — "Here's what I just did" |

**Transport**: Stdio (Claude Code subprocess). This means the MCP server communicates through standard input/output — the same way command-line programs have always communicated. Started via `astro-agent mcp` command.

**Session Bridge**: Maintains WebSocket connection to relay, tracks active sessions, routes events between Claude Code and Astro platform. This bridge allows a Claude Code session running on your machine to send real-time updates back to the Astro UI.

---

## 12. Configuration

The runner stores its configuration in a cross-platform config file managed by the `conf` package (which knows where to put config files on macOS, Linux, and Windows).

`src/lib/config.ts` (~100 lines)

```typescript
interface ConfigSchema {
  runnerId: string;              // UUID, generated at first setup — unique ID for this runner instance
  machineId: string;             // Hardware-based (MAC, UUID) or random — unique ID for this physical machine
  machineName?: string;          // SSH alias — a friendly name like "my-laptop"
  environmentType: string;       // 'local', 'remote', 'hpc' — what kind of machine is this?
  deviceToken?: string;          // Device auth code — used during initial authentication
  apiUrl: string;                // Default: http://localhost:3001 — where the Astro backend API lives
  accessToken?: string;          // JWT from device auth — proves this runner is authorized
  refreshToken?: string;         // For token refresh — used to get a new access token when the current one expires
  wsToken?: string;              // WebSocket auth token — authenticates the WebSocket connection
  claudeOauthToken?: string;     // From `claude setup-token` — the OAuth token for talking to Claude's API
  relayUrl: string;              // Default: ws://localhost:3002 — where the relay WebSocket server lives
  providers: ProviderType[];     // Detected providers — e.g., ['claude-code', 'claude-sdk']
  autoStart: boolean;            // Auto-start on login — should the runner start when you log into your computer?
  logLevel: string;              // debug/info/warn/error — how much detail to log
  lastConnected?: string;        // ISO timestamp — when the runner last connected to the server
  setupCompleted: boolean;       // Setup flag — has `astro-agent setup` been run?
  mcpServers?: Record<string, { command, args, env }>;  // Additional MCP servers to load
}
```

**Hardware ID** (`src/lib/hardware-id.ts`): Network-agnostic machine identification. This generates a stable identifier for your physical machine, so the server can recognize it even if your IP address changes. Priority: hardware UUID (best, always stable) -> MAC address (good, but can change with network adapters) -> random UUID (fallback). Prefixed: `mac-`, `rand-`, or bare UUID.

---

## 13. Key Types

These are the core data structures used throughout the Agent Runner. They define the "shape" of the data that flows through the system.

`src/types.ts` (619 lines)

### Task

A task is a unit of work sent from the server to the runner. It contains everything the runner needs to execute the work.

```typescript
interface Task {
  id: string;                       // Unique task identifier
  projectId: string;                // Which project this task belongs to
  planNodeId: string;               // Which node in the project plan this task corresponds to
  provider: ProviderType;           // 'claude-code' | 'claude-sdk' | 'codex' | 'slurm' — which AI to use
  prompt: string;                   // The instructions for the AI (what to do)
  workingDirectory: string;         // Where on disk to work (a file path or git URL)
  environment?: Record<string, string>;  // Environment variables to set (e.g., API keys)
  timeout?: number;                 // ms (default: 1 hour) — max time before the task is cancelled
  maxTurns?: number;                // Override default SDK turns — how many back-and-forth exchanges the AI can have
  outputFormat?: { type: 'json_schema'; schema: Record };  // Request structured JSON output
  executionStrategy?: ExecutionStrategyType;  // 'direct' | 'docker' | 'slurm' | etc. — how to run commands
  createdAt: string;                // ISO timestamp — when the task was created
}
```

### TaskResult

The outcome of a completed (or failed/cancelled) task. This is what gets sent back to the server when work is done.

```typescript
interface TaskResult {
  taskId: string;                   // Which task this result belongs to
  status: 'pending'|'queued'|'running'|'completed'|'failed'|'cancelled'|'timeout';
  exitCode?: number;                // Process exit code (0 = success, anything else = failure)
  output?: string;                  // The AI's final output text
  error?: string;                   // Error message if something went wrong
  startedAt?: string;               // When execution began
  completedAt?: string;             // When execution ended
  artifacts?: TaskArtifact[];       // Files or other outputs produced
  branchName?: string;              // Git branch that was created (e.g., 'astro/fix-login-bug')
  prUrl?: string;                   // URL of the pull request (e.g., 'https://github.com/org/repo/pull/42')
  prNumber?: number;                // Pull request number (e.g., 42)
}
```

### MachineResources

Information about the physical machine the runner is running on. This helps the server decide which machine is best suited for a given task (e.g., GPU-heavy tasks should go to machines with GPUs).

```typescript
interface MachineResources {
  hostname: string;                 // Machine's network name
  platform: NodeJS.Platform;        // 'darwin' (macOS), 'linux', 'win32', etc.
  arch: string;                     // CPU architecture: 'x64', 'arm64', etc.
  cpu: { model, cores, speed, loadAvg };  // CPU details and current load
  memory: { total, free, used, usedPercent };  // RAM usage
  gpu: Array<{ model, memoryTotal, memoryUsed, utilization }>;  // GPU details (if any)
}
```

---

## 14. Data Directory

The Agent Runner stores its working data in two locations on your file system:

```
~/.astro/                      # Working data directory (in your home folder)
├── worktrees/                 # Git worktrees per repo (see section 9)
│   └── {repoName}/           # One worktree per task branch
├── repos/                     # Cloned repositories (cached so they don't need to be re-downloaded)
│   └── {projectId}/          # One clone per project
├── logs/                      # SDK debug logs (for troubleshooting)
├── hpc/
│   └── config.json           # User HPC overrides (custom supercomputer settings)
└── astro.db                   # SQLite database (Drizzle ORM) — local task history and metadata

~/.config/astro-agent/         # Configuration (platform-dependent location)
└── config.json               # Agent runner config (see section 12 for all fields)
```

The `~` symbol means your home directory — e.g., `/Users/yourname` on macOS or `/home/yourname` on Linux. So `~/.astro/` would be `/Users/yourname/.astro/` on a Mac. The dot prefix (`.astro`) makes it a hidden folder, keeping it out of the way of your normal files.
