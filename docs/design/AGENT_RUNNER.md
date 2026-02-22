# Astro Agent Runner — Design Document

## 1. Overview

### What It Is

The Agent Runner is the **worker** in the Astro system. It is the only component that actually talks to AI (Claude) and executes code changes on a machine. The Astro backend (the coordinator) sends it task instructions, and it does the actual work — writing code, running tests, creating pull requests — then reports back what it did.

It is a standalone Node.js process that connects to the Astro backend via WebSocket, receives task dispatches, runs them using AI providers (Claude SDK, Claude CLI, Codex), and streams results back.

### Why It Is Separate from the Backend

1. **Security: AI credentials never leave the machine.** The Agent Runner holds the Claude API key or OAuth token locally. Credentials are never uploaded to the Astro server.

2. **Flexibility: Tasks can run on different machines.** The runner can live on a laptop, an HPC cluster login node, or a cloud VM. Each machine runs its own Agent Runner instance, and the Astro backend coordinates them.

### Key Identifiers

- **Package**: `@astro/agent` (npm)
- **CLI binary**: `astro-agent`
- **Location**: `packages/agent-runner/`
- **Config directory**: `~/.config/astro-agent/` (platform-dependent, via `conf` package)
- **Data directory**: `~/.astro/`

---

## 2. End-to-End Architecture: The Complete Picture

This section provides the full bird's-eye view of how a user's action (creating a project, dispatching a task) flows through the entire system.

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (Frontend)                             │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Welcome Page  │  │ Plan View    │  │ Task Detail  │  │ Environments  │  │
│  │ (create proj) │  │ (dispatch)   │  │ (monitor)    │  │ (machines)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └───────────────┘  │
│         │                 │                  │                              │
│         ▼                 ▼                  ▼                              │
│  ┌──────────────────────────────────────────────────────┐                  │
│  │  Zustand Stores (project, plan, execution, agent)    │                  │
│  │  + api-client.ts (HTTP + SSE)                        │                  │
│  └──────────────────────┬───────────────────────────────┘                  │
└─────────────────────────┼───────────────────────────────────────────────────┘
                          │ HTTP / SSE
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         HONO SERVER (Backend, port 3001)                     │
│                                                                             │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐                  │
│  │ /api/agent/*   │  │ /api/dispatch/*│  │ /api/relay/* │                  │
│  │ (plan gen)     │  │ (task exec)    │  │ (machine mgmt│                  │
│  └────────┬───────┘  └────────┬───────┘  └──────────────┘                  │
│           │                   │                                             │
│           │   ┌───────────────┤                                             │
│           │   │ LOCAL?        │ RELAY?                                      │
│           ▼   ▼               ▼                                             │
│  ┌────────────────┐  ┌────────────────────────────────┐                    │
│  │ Provider        │  │ Relay Server (WS, port 3002)   │                    │
│  │ (claude-code)   │  │ + Machine Registry              │                    │
│  │ runs locally    │  │                                │                    │
│  └────────────────┘  └────────────┬───────────────────┘                    │
└──────────────────────────────────┼──────────────────────────────────────────┘
                                   │ WebSocket
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      AGENT RUNNER (on user's machine)                        │
│                                                                             │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐              │
│  │ WebSocket      │  │ Task Executor  │  │ Provider Adapter │              │
│  │ Client         │──│ (queue, safety │──│ (Claude SDK/CLI) │              │
│  │                │  │  worktree)     │  │                  │              │
│  └────────────────┘  └────────────────┘  └──────────┬───────┘              │
│                                                      │                      │
│                                          ┌───────────▼──────────┐          │
│                                          │ Execution Strategy   │          │
│                                          │ (direct/docker/slurm)│          │
│                                          └──────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 The Two Dispatch Paths

The system has **two fundamentally different execution paths**:

**Path A: Local Dispatch** — Server has a provider (Claude SDK/Code) available locally. The server itself runs the AI and manages the worktree. No agent runner involved.

**Path B: Relay Dispatch** — Server sends the task over WebSocket to a remote agent runner. The agent runner manages the worktree, runs the AI, and streams results back through the relay.

```
                    ┌──────────────────┐
                    │ POST /api/dispatch│
                    │    /task          │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  isServerMode()  │
                    │  OR remote env   │
                    │  OR targetMachine│
                    └────────┬─────────┘
                      yes ┌──┴──┐ no
                          │     │
               ┌──────────▼┐   ┌▼──────────────┐
               │   RELAY    │   │    LOCAL       │
               │  DISPATCH  │   │   DISPATCH     │
               │            │   │                │
               │ Pass raw   │   │ Server clones  │
               │ workingDir │   │ repo if git URL│
               │ to agent   │   │ Creates worktree│
               │ runner via │   │ Runs provider  │
               │ WebSocket  │   │ Streams SSE    │
               └────────────┘   └────────────────┘
```

**This split is the source of most redundancy** (see Section 15 for critique).

---

## 3. Complete User Workflows

### 3.1 Workflow A: Create Project from GitHub Repo

```
STEP  COMPONENT          ACTION                           WHERE CODE LIVES
────  ─────────          ──────                           ──────────────────
 1    Browser            User enters repo URL on          —
                         welcome.tsx or project-new.tsx

 2    Browser            Calls POST /api/repo/setup       —
                         with { repository, projectId,
                         targetMachineId? }

 3a   Server (local)     If no targetMachine:             ~/.astro/repos/{projectId}/
                         server/routes/repo.ts clones     (server's filesystem)
                         repo, reads file tree, extracts
                         CLAUDE.md, README, package.json

 3b   Relay→Agent Runner If targetMachine specified:      ~/.astro/repos/{projectId}/
                         sends repo_setup_request via     (agent runner's filesystem)
                         WebSocket; agent runner clones
                         repo via localRepoSetup()

 4    Browser            Receives { workingDirectory,     —
                         fileTree, keyFiles }
                         Stores project in Zustand +
                         IndexedDB

 5    Browser            User clicks "Use AI to           —
                         Generate Plan"

 6    Browser            POST /api/agent/generate-plan    —
                         with { description, visionDoc,
                         workingDirectory, fileTree,
                         keyFiles, projectId }

 7    Server             Runs Claude with plan schema     (provider runs on server
                         to generate nodes + edges.       or agent runner depending
                         Streams SSE events back.         on mode)

 8    Browser            Receives plan_result SSE event.  —
                         Stores nodes/edges in plan store.
                         Displays graph.
```

### 3.2 Workflow B: Create Project from Local Directory

```
STEP  COMPONENT          ACTION                           WHERE CODE LIVES
────  ─────────          ──────                           ──────────────────
 1    Browser            User enters local path           —
                         (e.g., /Users/me/my-project)

 2    Browser            POST /api/repo/setup with        —
                         { workingDirectory: "/path",
                         projectId }

 3    Server/Runner      Validates directory exists.      /Users/me/my-project
                         Checks if git repo.              (user's existing dir)
                         Reads file tree.
                         If not git: returns
                         needsGitInit=true

 4    Browser            Stores resolved workingDirectory —
                         in project. (workingDirectory
                         stays as the local path)

 5+   Same as Workflow A steps 5-8
```

### 3.3 Workflow C: Dispatch a Task for Execution

This is the most complex flow. Here is the full step-by-step:

```
STEP  COMPONENT          ACTION
────  ─────────          ──────
 1    Browser            User clicks "Run" on a plan node.
                         execution-store calls POST /api/dispatch/task with:
                         { nodeId, projectId, title, description, workingDirectory,
                           environment, targetMachineId?, preferredProvider?,
                           visionDoc?, dependencyOutputs[] }

 2    Server             Validates input. Checks dependencies are met.
      dispatch.ts        Decides: local or relay dispatch?
                         (see decision logic in 2.2)

     ╔══════════════════════════════════════════════════════════════╗
     ║  PATH A: LOCAL DISPATCH (server runs the AI)                ║
     ╠══════════════════════════════════════════════════════════════╣
     ║                                                              ║
     ║  3a  Server           Resolve workingDirectory:              ║
     ║      dispatch.ts      - If git URL → clone to               ║
     ║                         ~/.astro/repos/{projectId}/          ║
     ║                       - If local path → use as-is            ║
     ║                                                              ║
     ║  4a  Server           Create git worktree:                   ║
     ║      worktree-        ~/.astro/worktrees/{repo}/{taskId}/   ║
     ║      manager.ts       Branch: astro/{nodeId}                ║
     ║                                                              ║
     ║  5a  Server           Build execution prompt:                ║
     ║      dispatch.ts      [vision doc] + [dependency outputs]    ║
     ║                       + [task description] + [instructions]  ║
     ║                                                              ║
     ║  6a  Server           Run provider.stream(task) with         ║
     ║      providers/       workingDirectory = worktree path       ║
     ║      claude-code.ts   (NOT the original repo dir)           ║
     ║                                                              ║
     ║  7a  Server           Forward StreamEvents as SSE:           ║
     ║                       text, tool_use, tool_result,           ║
     ║                       file_change, progress, result, done    ║
     ║                                                              ║
     ║  8a  Server           On success:                            ║
     ║      dispatch.ts      - Auto-commit changes                  ║
     ║                       - Push branch, create PR               ║
     ║                       - Clean up worktree (keep branch       ║
     ║                         if PR created)                       ║
     ╚══════════════════════════════════════════════════════════════╝

     ╔══════════════════════════════════════════════════════════════╗
     ║  PATH B: RELAY DISPATCH (agent runner runs the AI)          ║
     ╠══════════════════════════════════════════════════════════════╣
     ║                                                              ║
     ║  3b  Server           Find target machine in registry.       ║
     ║      dispatch.ts      Build prompt. Send task_dispatch       ║
     ║                       via WebSocket relay.                   ║
     ║                       workingDirectory passed as-is          ║
     ║                       (git URL or local path).               ║
     ║                                                              ║
     ║  4b  Agent Runner     Receive task_dispatch message.         ║
     ║      task-executor    Run safety checks on directory.        ║
     ║                                                              ║
     ║  5b  Agent Runner     Resolve workingDirectory:              ║
     ║      task-executor    - If git URL → clone to                ║
     ║                         ~/.astro/repos/{projectId}/          ║
     ║                       - If empty → process.cwd()             ║
     ║                       - If local path → use as-is            ║
     ║                                                              ║
     ║  6b  Agent Runner     Create git worktree:                   ║
     ║      worktree.ts      ~/.astro/worktrees/{repo}/{taskId}/   ║
     ║                       Branch: astro/{taskId}                ║
     ║                                                              ║
     ║  7b  Agent Runner     Run adapter.execute(task, stream,      ║
     ║      providers/       signal) with workingDirectory =       ║
     ║                       worktree path.                         ║
     ║                                                              ║
     ║  8b  Agent Runner     Stream events back via WebSocket:      ║
     ║      websocket-       task_text, task_tool_use,              ║
     ║      client.ts        task_tool_result, task_file_change,    ║
     ║                       task_result                            ║
     ║                                                              ║
     ║  9b  Server           Relay receives WS events, converts     ║
     ║      relay-server     to internal format, emits to event     ║
     ║                       bus.                                   ║
     ║                                                              ║
     ║ 10b  Server           dispatch.ts listeners forward relay    ║
     ║      dispatch.ts      events as SSE to browser.              ║
     ║                                                              ║
     ║ 11b  Agent Runner     On success:                            ║
     ║      task-executor    - Auto-create PR via pushAndCreatePR() ║
     ║                       - Clean up worktree (keep if PR)       ║
     ║                       - Send task_result with prUrl,         ║
     ║                         branchName                           ║
     ╚══════════════════════════════════════════════════════════════╝
```

### 3.4 Where Code Actually Lives During Execution

This is the critical piece that the previous doc did not make explicit.

**The AI agent NEVER works directly in the user's repository.** It always works in a **worktree** — an isolated copy on a separate branch.

```
User's original repo (or clone):
  /Users/me/my-project/                  ← on branch "main"
  └── .git/

Worktree created for task execution:
  ~/.astro/worktrees/my-project/exec-node1-1234/   ← on branch "astro/node1"
  └── (full copy of repo files, isolated branch)

After task completes:
  The worktree branch "astro/node1" is pushed → PR created
  Worktree directory is cleaned up (deleted)
  Branch is kept if PR exists, deleted otherwise
```

**Directory resolution chain:**

```
workingDirectory (from frontend)
  │
  │  Could be: "/Users/me/my-project"  (local path)
  │            "git@github.com:user/repo.git"  (git URL)
  │            "https://github.com/user/repo.git"  (git URL)
  │
  ▼
resolveWorkingDirectory()
  │
  │  Git URL → clone to ~/.astro/repos/{projectId}/
  │  Local path → use as-is
  │
  ▼
Resolved repo path (e.g. /Users/me/my-project)
  │
  ▼
createWorktree()
  │
  │  Creates ~/.astro/worktrees/{repoName}/{taskId}/
  │  On branch: astro/{nodeId} (server) or astro/{taskId} (runner)
  │
  ▼
Worktree path ← THIS is what the AI actually uses as cwd
```

---

## 4. Agent Runner Internals

### 4.1 CLI Commands

Entry point: `src/cli.ts`, built with `commander`.

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

### 4.2 Startup Flow

`src/commands/start.ts`:

```
astro-agent start [-f]
       │
       ▼
┌──────────────────┐
│ Check setup done │
└────────┬─────────┘
         │
    ┌────▼────┐
    │ -f flag?│
    └────┬────┘
   no ┌──┴──┐ yes
      │     │
      ▼     ▼
┌──────────┐ ┌──────────────────────────────────────────┐
│ Spawn    │ │ FOREGROUND INITIALIZATION                 │
│ detached │ │                                          │
│ child    │ │  1. Detect resources (CPU, mem, GPU)     │
│ process, │ │  2. Detect providers (Claude Code/SDK)   │
│ report   │ │  3. Detect execution strategies           │
│ PID,     │ │  4. Create WebSocket client               │
│ exit     │ │  5. Create task executor                  │
└──────────┘ │  6. Wire message handlers:                │
             │     task_dispatch → submitTask()          │
             │     task_cancel   → cancelTask()          │
             │     task_steer    → injectMessage()       │
             │     task_safety_decision → route           │
             │     file_list_request → git ls-files       │
             │     repo_setup_request → localRepoSetup() │
             │  7. Connect to relay server               │
             │  8. Register signal handlers              │
             │  9. Enter event loop                      │
             └──────────────────────────────────────────┘
```

### 4.3 WebSocket Client

`src/lib/websocket-client.ts`

The WebSocket client is the agent runner's lifeline to the server.

```
┌──────────────────┐         ┌──────────────────┐
│  AGENT RUNNER    │   ws:// │  RELAY SERVER    │
│                  │◄───────►│  (port 3002)     │
│  websocket-      │         │                  │
│  client.ts       │         │  relay-server.ts │
└──────────────────┘         └──────────────────┘

Connection:
  - Auth: Bearer <token> + X-Runner-Id + X-Machine-Id headers
  - Auto-reconnect: exponential backoff 1s→60s, infinite retries
  - Token auto-refresh before expiry

Heartbeat (every 30s):
  Runner → Server:  { resources, activeTasks }
  Server → Runner:  heartbeat_ack
```

**Messages sent by agent runner (→ server):**

| Type | When | Payload |
|------|------|---------|
| `register` | On connect | capabilities, providers, resources |
| `heartbeat` | Every 30s | resources, active tasks |
| `task_status` | State change | taskId, status |
| `task_output` | During execution | taskId, stream, data, sequence |
| `task_text` | During execution | taskId, text (bypasses throttle) |
| `task_tool_use` | AI calls tool | taskId, toolName, input |
| `task_tool_result` | Tool returns | taskId, toolName, result, success |
| `task_file_change` | File modified | taskId, path, action, diff |
| `task_session_init` | Session starts | taskId, sessionId, model |
| `task_result` | Task done | taskId, status, output, prUrl, branchName |
| `task_approval_request` | Needs decision | taskId, question, options (60s timeout) |
| `task_safety_prompt` | Unsafe dir | taskId, tier, options |

**Messages received by agent runner (← server):**

| Type | When | Payload |
|------|------|---------|
| `registered` | After register | server config |
| `task_dispatch` | New work | full Task object |
| `task_cancel` | Stop work | taskId |
| `task_steer` | Mid-execution | taskId, message, interrupt? |
| `task_approval_response` | User decided | taskId, answer |
| `task_safety_decision` | User decided | taskId, action |
| `config_update` | Settings changed | new config values |
| `file_list_request` | Server needs files | path |
| `repo_setup_request` | Setup repo | repository, workingDirectory, projectId |

---

## 5. Task Executor

`src/lib/task-executor.ts`

The task executor is the core engine that manages the full lifecycle of tasks.

### 5.1 Architecture

```
┌─────────────────────────────────────────────────────┐
│                  TASK EXECUTOR                        │
│                                                      │
│  ┌─────────────┐     ┌────────────────────────────┐ │
│  │ Task Queue   │────►│ Running Tasks               │ │
│  │ (waiting)    │     │ Map<taskId, AbortController>│ │
│  │              │     │ max concurrent: 4           │ │
│  └─────────────┘     └────────────┬───────────────┘ │
│                                    │                  │
│         ┌──────────────────────────┤                  │
│         │                          │                  │
│  ┌──────▼──────┐   ┌──────────────▼──────────────┐  │
│  │ Safety      │   │ Workspace Preparation        │  │
│  │ Check       │   │                              │  │
│  │ (workdir-   │   │ resolveWorkingDirectory()    │  │
│  │  safety.ts) │   │ → createWorktree()           │  │
│  └─────────────┘   │ → Provider Adapter execute() │  │
│                     │ → PR creation                │  │
│                     │ → Cleanup                    │  │
│                     └────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 5.2 Task Lifecycle (Detailed)

```
submitTask(task)
       │
       ▼
┌──────────────────┐
│ 1. SAFETY CHECK  │
│                  │
│ checkWorkdirSafety(dir)
│   ├─ SAFE     → proceed
│   ├─ GUARDED  → warn, proceed
│   ├─ RISKY    → ask user (WS)
│   └─ UNSAFE   → block
└────────┬─────────┘
         │
    ┌────▼─────┐
    │ 2. QUEUE │
    │          │
    │ slots    │
    │ available│
    │ ?        │
    └────┬─────┘
   no ┌──┴──┐ yes
      │     │
      ▼     ▼
 ┌────────┐ ┌────────────────────────────────────────┐
 │ Queue  │ │ 3. EXECUTE                              │
 │ (wait) │ │                                         │
 └────────┘ │ a. resolveWorkingDirectory()            │
            │    git URL → clone to ~/.astro/repos/   │
            │    local path → use as-is               │
            │    empty → process.cwd()                │
            │                                         │
            │ b. createWorktree()                     │
            │    → ~/.astro/worktrees/{repo}/{taskId} │
            │    → branch: astro/{taskId}             │
            │    → run .astro/.setup if exists         │
            │                                         │
            │ c. Create provider adapter               │
            │    → claude-sdk / claude-code / codex    │
            │                                         │
            │ d. adapter.execute(task, stream, signal) │
            │    workingDir = WORKTREE PATH            │
            │    timeout = 1 hour                      │
            │                                         │
            │ e. Stream results via WebSocket          │
            │    stdout, tool traces, file changes     │
            │                                         │
            │ f. On success: pushAndCreatePR()         │
            │                                         │
            │ g. Cleanup worktree                      │
            │    (keep branch if PR created)           │
            └─────────────────────────────────────────┘
```

### 5.3 Stream Object

The stream object bridges the task executor to the WebSocket client. Each callback is wired to a WebSocket send method.

```typescript
{
  stdout(data)              // Raw terminal output
  stderr(data)              // Error output
  status(status, progress?, message?)  // State update
  text(data)                // Structured text (bypasses stdout throttle)
  toolUse(toolName, input)  // AI invokes tool
  toolResult(toolName, result, success)  // Tool returns
  fileChange(path, action, linesAdded?, linesRemoved?, diff?)
  sessionInit(sessionId, model?)
  approvalRequest(question, options)  // Ask user for decision
}
```

---

## 6. Provider Adapters

Provider adapters are drivers for different AI tools. They all implement the same interface so the executor doesn't care which AI is doing the work.

```typescript
interface ProviderAdapter {
  readonly type: string;            // 'claude-code', 'claude-sdk', 'codex'
  readonly name: string;
  isAvailable(): Promise<boolean>;
  execute(task, stream, signal): Promise<TaskResult>;
  getStatus(): Promise<ProviderStatus>;
}
```

### 6.1 Claude SDK Adapter

`src/providers/claude-sdk-adapter.ts`

```
┌──────────────────────────────────────────────────────┐
│              CLAUDE SDK ADAPTER                        │
│                                                       │
│  ┌─────────────────┐     ┌────────────────────────┐  │
│  │ Task + Prompt    │────►│ @anthropic-ai/          │  │
│  │                  │     │ claude-agent-sdk         │  │
│  │ workingDir =     │     │                          │  │
│  │ WORKTREE PATH    │     │ query({                  │  │
│  └─────────────────┘     │   prompt,                │  │
│                           │   maxTurns: 10-100,     │  │
│  ┌─────────────────┐     │   model: claude-opus-4,  │  │
│  │ process.chdir()  │     │   tools: [MCP tools],   │  │
│  │ to worktree dir  │     │ })                      │  │
│  │ (restored after) │     └──────────┬─────────────┘  │
│  └─────────────────┘                 │                 │
│                                       ▼                 │
│                           ┌────────────────────────┐  │
│                           │ for await (msg of query)│  │
│                           │   msg.type:             │  │
│                           │   system → sessionInit  │  │
│                           │   text → stream.text()  │  │
│                           │   tool_use → stream     │  │
│                           │   tool_result → stream  │  │
│                           │   result → TaskResult   │  │
│                           └────────────────────────┘  │
│                                                       │
│  SPECIAL FEATURES:                                    │
│  • HPC context injection (detects SLURM → adds       │
│    cluster info to prompt)                            │
│  • Approval interception (AskUserQuestion tool →      │
│    routes to user via WebSocket, waits for answer)    │
│  • Mid-execution steering via Query.interrupt()       │
│    + Query.streamInput()                              │
│  • MCP server loading (ASTRO_EXECUTION_ID injected)   │
│  • Max concurrent: 4                                  │
└──────────────────────────────────────────────────────┘
```

**Critical detail: `process.chdir()`** — The SDK adapter temporarily changes the Node.js process's working directory to the worktree path before calling `query()`. This is because the Claude Agent SDK's built-in tools (file read, file write, bash) operate relative to `process.cwd()`. The original cwd is restored in a `finally` block.

### 6.2 Claude Code Adapter

`src/providers/claude-code-adapter.ts`

Spawns the `claude` CLI as a subprocess.

```
┌──────────────────────────────────────┐
│  CLAUDE CODE ADAPTER                  │
│                                       │
│  spawn('claude', [                    │
│    '--print',                         │
│    '--output-format', 'stream-json',  │
│    '--verbose',                       │
│    prompt                             │
│  ], {                                 │
│    cwd: WORKTREE_PATH  ← key!        │
│  })                                   │
│                                       │
│  Parse JSON lines from stdout:        │
│    system → sessionInit               │
│    assistant → text + tool_use        │
│    user → tool_result                 │
│    result → TaskResult + cost         │
│                                       │
│  Max concurrent: 1                    │
│  Signal: SIGTERM → 5s → SIGKILL      │
│  Steering: write to stdin (limited)   │
└──────────────────────────────────────┘
```

### 6.3 Codex Adapter

`src/providers/codex-adapter.ts`

Spawns `codex exec` as a subprocess. Similar pattern to Claude Code adapter.

- Max concurrent: 1
- Sandbox modes: `danger-full-access` (containerized) or `workspace-write`
- JSONL output parsing

---

## 7. Safety System

`src/lib/workdir-safety.ts`

### 7.1 Safety Tiers

| Tier | Condition | Action |
|------|-----------|--------|
| **SAFE** | Git repo, clean state | Proceed |
| **GUARDED** | Git repo, uncommitted changes | Warn, proceed |
| **RISKY** | Non-git directory | Ask user via WebSocket |
| **UNSAFE** | Non-git + parallel execution | Block |

### 7.2 Safety Check Flow

```
checkWorkdirSafety(dir)
       │
       ▼
  ┌─────────────┐    no    ┌──────────────────────┐
  │ Is git repo?├──────────►│ Other tasks in dir?  │
  └──────┬──────┘           └──────────┬───────────┘
         │ yes                   yes ┌─┴──┐ no
         ▼                          │    │
  ┌──────────────┐           ┌──────▼┐  ┌▼──────┐
  │ Uncommitted  │           │UNSAFE │  │ RISKY │
  │ changes?     │           │ Block │  │ Ask   │
  └──────┬───────┘           └───────┘  └───────┘
    yes ┌┴──┐ no
        │   │
  ┌─────▼┐ ┌▼──────┐
  │GUARD.│ │ SAFE  │
  │ Warn │ │ Go    │
  └──────┘ └───────┘
```

### 7.3 Sandbox Mode

For extra safety, tasks can run in a temporary copy of the working directory:
- Copy working dir to temp location (max 100MB)
- Execute in isolation
- `copyBack()` applies changes to original only when approved

---

## 8. Execution Strategies

Execution strategies answer **"WHERE does a command run?"** They are orthogonal to provider adapters (which answer "WHAT AI reasons about the task?").

```
                 │  Direct  │  Docker  │  SLURM  │  K8s Exec │
─────────────────┼──────────┼──────────┼─────────┼───────────┤
Claude SDK       │    ✓     │    ✓     │    ✓    │     ✓     │
Claude Code CLI  │    ✓     │    ✓     │    ✓    │     ✓     │
Codex            │    ✓     │    ✓     │    —    │     —     │
```

### 8.1 Strategy Interface

```typescript
interface ExecutionStrategy {
  readonly id: 'direct' | 'slurm' | 'docker' | 'k8s-exec' | 'skypilot';
  readonly isAsync: boolean;  // true = submit-and-poll
  detect(): Promise<ExecutionStrategyDetection>;
  buildContext?(): Promise<string>;  // Inject environment info into AI prompt
  execute(spec, callbacks, signal): Promise<ExecutionResult>;
  cancel(jobId): Promise<void>;
  getStatus(jobId): Promise<ExecutionJobStatus | null>;
}
```

### 8.2 Direct Strategy

The default. Runs commands on the agent runner's machine via `child_process.spawn()`.

```
Agent Runner → spawn('sh', '-c', command) → stdout/stderr → stream back
```

### 8.3 Docker Strategy

Runs commands inside a Docker container. Working directory mounted as volume.

```
Agent Runner → docker run --rm -v $PWD:/work node:22-slim <command>
```

### 8.4 SLURM Strategy

For HPC clusters. Agent runner must be on the login node. Async: submits job, polls for completion.

```
Login Node (Agent Runner)
  │ sbatch job.sh
  ▼
SLURM Scheduler → Compute Nodes
  │
  polling: squeue -j <id> / sacct -j <id>
  │
  ▼ job complete → read output files
```

### 8.5 Kubernetes Exec Strategy

Executes commands inside an existing K8s pod via `kubectl exec`. Agent runner stays outside the cluster.

### 8.6 Strategy Comparison

| Aspect | Direct | Docker | SLURM | K8s Exec |
|--------|--------|--------|-------|----------|
| Sync/Async | Sync | Sync | Async | Sync |
| Isolation | None | Container | Job | Pod |
| GPU | Native | nvidia-docker | `--gres` | Pod limits |
| Agent location | On machine | On machine | Login node | Any w/ kubectl |

---

## 9. Git Worktree Management

### Why Worktrees

Each task gets its own worktree (branch + working copy) so:
- Multiple tasks can run in parallel on the same repo
- Each task's changes are isolated on its own branch
- No merge conflicts during concurrent execution
- Each branch becomes a PR
- Cleanup removes the worktree when done

### Worktree Lifecycle

`src/lib/worktree.ts` (agent runner) and `server/lib/worktree-manager.ts` (server)

```
createWorktree(taskId, workingDirectory)
       │
       ├── Validate taskId format (alphanumeric + hyphens/underscores/dots)
       ├── Resolve git root: git rev-parse --show-toplevel
       ├── Verify commits exist: git rev-parse --verify HEAD
       │
       ├── Base dir: ~/.astro/worktrees/{repoName}/
       ├── Branch: astro/{sanitized-taskId}  (or astro/{nodeId} on server)
       ├── Path: ~/.astro/worktrees/{repoName}/{sanitized-taskId}/
       │
       ├── Clean up stale: rm + git worktree prune
       ├── Delete old branch: git branch -D {branchName}
       ├── Create: git worktree add -b {branch} {path}
       │
       ├── (agent-runner only) Apply .astro/include/ files
       ├── (agent-runner only) Run .astro/.setup script
       │
       └── Return { worktreePath, branchName, cleanup() }

On cleanup:
       ├── git worktree remove --force {path}
       ├── git worktree prune
       ├── rm -rf {path}
       └── (unless keepBranch) git branch -D {branchName}
```

**Subdirectory preservation**: If the task's working directory is a subdirectory of the repo (e.g., `repo/packages/web/`), the worktree preserves this: the returned working directory becomes `worktree-path/packages/web/`.

---

## 10. PR Creation

`src/lib/git-pr.ts`

After a task completes with code changes:

```
pushAndCreatePR(branchName, title, body, worktreePath)
       │
       ├── Get git root
       ├── Check remote origin exists
       ├── Detect default branch (origin/HEAD → origin/main → origin/master)
       ├── Count commits: git rev-list --count origin/{base}..HEAD
       │
       ├── Push: git push -u origin {branchName}
       │
       └── If `gh` CLI available:
           gh pr create --base {base} --head {branch} --title --body
           Return { url, prNumber }
```

---

## 11. MCP Integration

`src/mcp/`

MCP (Model Context Protocol) lets Claude Code sessions interact with the Astro platform.

```
┌─────────────┐     stdio      ┌────────────────┐     ws://     ┌──────────┐
│ Claude Code  │◄──────────────►│ MCP Server     │◄─────────────►│  Relay   │
│ (subprocess) │                │ astro-agent mcp │               │  Server  │
└─────────────┘                └────────────────┘               └──────────┘
```

**Tools provided:**

| Tool | Purpose |
|------|---------|
| `astro_attach` | Link Claude Code session to an Astro task |
| `astro_detach` | Unlink session |
| `astro_status` | Check which task this session is attached to |
| `astro_send` | Send events (progress, file_change, error) to Astro |

---

## 12. Configuration

`src/lib/config.ts` — uses `conf` package for cross-platform config storage.

```typescript
interface ConfigSchema {
  runnerId: string;              // UUID, generated at setup
  machineId: string;             // Hardware-based (MAC/UUID) or random
  machineName?: string;          // Friendly name (e.g., "my-laptop")
  environmentType: string;       // 'local' | 'remote' | 'hpc' | 'cloud'
  apiUrl: string;                // Default: http://localhost:3001
  relayUrl: string;              // Default: ws://localhost:3002
  accessToken?: string;          // JWT from device auth
  refreshToken?: string;         // For token refresh
  wsToken?: string;              // WebSocket auth
  claudeOauthToken?: string;     // From `claude setup-token`
  providers: ProviderType[];     // Detected providers
  autoStart: boolean;            // Start on login
  logLevel: string;              // debug/info/warn/error
  setupCompleted: boolean;
  mcpServers?: Record<string, { command, args, env }>;
}
```

**Hardware ID** (`src/lib/hardware-id.ts`): Stable machine identifier. Priority: hardware UUID → MAC address → random UUID. Prefixed: `mac-`, `rand-`, or bare UUID.

---

## 13. Key Types

`src/types.ts`

### Task (incoming from server)

```typescript
interface Task {
  id: string;
  projectId: string;
  planNodeId: string;
  provider: ProviderType;           // Which AI to use
  prompt: string;                   // Instructions for the AI
  workingDirectory: string;         // Where to work (path or git URL)
  environment?: Record<string, string>;
  timeout?: number;                 // ms, default 1 hour
  maxTurns?: number;
  outputFormat?: { type: 'json_schema'; schema: Record };
  executionStrategy?: ExecutionStrategyType;
  createdAt: string;
}
```

### TaskResult (outgoing to server)

```typescript
interface TaskResult {
  taskId: string;
  status: 'pending'|'queued'|'running'|'completed'|'failed'|'cancelled'|'timeout';
  exitCode?: number;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  artifacts?: TaskArtifact[];
  branchName?: string;              // e.g., 'astro/fix-login-bug'
  prUrl?: string;                   // e.g., 'https://github.com/org/repo/pull/42'
  prNumber?: number;
}
```

---

## 14. Data Directory Layout

```
~/.astro/                          # Working data
├── worktrees/                     # Git worktrees per repo
│   └── {repoName}/               # One worktree per task
│       └── {taskId}/
├── repos/                         # Cloned repositories (cached)
│   └── {projectId}/
├── projects/                      # Fresh project directories
│   └── {projectId}/
├── logs/                          # SDK debug logs
├── hpc/
│   └── config.json               # HPC overrides
└── astro.db                       # Agent runner's SQLite database

~/.config/astro-agent/             # Configuration
└── config.json                    # See section 12
```

---

## 15. Architectural Critique and Known Redundancies

This section documents the actual problems with the current architecture. These are not theoretical — they cause real confusion and maintenance burden.

### 15.1 Duplicated Working Directory Resolution

**The same logic exists in three places:**

| Location | Function | Triggered by |
|----------|----------|-------------|
| `server/routes/dispatch.ts:283` | `resolveWorkingDirectory()` | Local dispatch |
| `packages/agent-runner/src/lib/task-executor.ts:682` | `resolveWorkingDirectory()` | Relay dispatch (task executor) |
| `packages/agent-runner/src/lib/repo-utils.ts:114` | `cloneRepository()` | Repo setup request |

All three do the same thing: if the input is a git URL, clone to `~/.astro/repos/{projectId}/`. If it's a local path, use as-is.

**Problem**: These have slightly different implementations. The server version uses `execFileSync` with hooks disabled (`-c core.hooksPath=/dev/null`); the agent runner version does not. The server version validates projectId format; the agent runner version does not. They use different timeouts (30s vs 120s). This divergence will grow over time.

**Recommendation**: Extract a shared `resolveWorkingDirectory()` function into a common package, or clearly document that the server and agent runner versions are intentionally different (and why).

### 15.2 Duplicated Worktree Management

**Two separate implementations:**

| Location | Function | Triggered by |
|----------|----------|-------------|
| `server/lib/worktree-manager.ts` | `createServerWorktree()` | Local dispatch |
| `packages/agent-runner/src/lib/worktree.ts` | `createWorktree()` | Relay dispatch |

Both create worktrees at `~/.astro/worktrees/{repoName}/`, both prune stale worktrees, both clean up afterward.

**Differences that cause bugs:**
- Server uses `astro/{nodeId}` as branch name. Agent runner uses `astro/{taskId}`. These are different values — nodeId is the plan graph node ID, taskId is the execution ID. This means the same plan node dispatched twice will have different branches on the server vs agent runner.
- Server requires remote origin (throws if missing). Agent runner does not.
- Agent runner runs `.astro/.setup` and `.astro/include/` after worktree creation. Server does not.

**Recommendation**: Either unify into a single worktree manager (used by both server and agent runner), or formalize the differences as intentional and document them.

### 15.3 The "Who Manages the Workspace" Problem

The fundamental architectural question: **should the server or the agent runner be responsible for workspace preparation?**

Currently, the answer is "both, depending on the dispatch path":

```
LOCAL DISPATCH:    Server clones repo → Server creates worktree → Server runs AI
RELAY DISPATCH:    Server passes raw path → Agent runner clones → Agent runner creates worktree → Agent runner runs AI
```

This means:
1. When running locally, the server must have git installed and understand worktree management.
2. When running via relay, the agent runner must have the same capabilities.
3. Both must handle PR creation.
4. The `workingDirectory` field means different things: for local dispatch it's already resolved; for relay dispatch it might be a git URL that still needs resolution.

**This is the core design tension.** The system tries to support both "server does everything" and "agent runner does everything" without a clean abstraction layer.

### 15.4 Missing Working Directory Specification in Task Schema

The `Task` interface has a `workingDirectory: string` field but:
- It does not specify whether this is the **original repo path** or the **worktree path**.
- For local dispatch, the task's `workingDirectory` is set to the worktree path by the server before calling the provider.
- For relay dispatch, the task's `workingDirectory` is the raw value from the frontend (could be a git URL), and the agent runner resolves it before creating a worktree.

**The same field has different semantics depending on the dispatch path.** This is confusing and error-prone.

**Recommendation**: Split into explicit fields:
```typescript
interface Task {
  repository?: string;       // Git URL (if any)
  sourceDirectory?: string;  // Original local path
  // workingDirectory is set internally to worktree path before execution
}
```

### 15.5 Repo Setup vs Task Dispatch Overlap

When a project is created, `/api/repo/setup` clones the repo and builds the file tree. Then when a task is dispatched, `resolveWorkingDirectory()` may clone the same repo again (or fetch it). This is redundant — the repo was already set up.

The repo setup step is necessary for plan generation (to read CLAUDE.md, README, etc.), but task dispatch should be able to use the already-cloned directory.

**Currently**: The server stores the resolved `workingDirectory` (a local path) in the project record. When dispatching, it passes this path. If it's still a git URL (which it shouldn't be after setup), it re-clones. This works but is fragile — the "already resolved" invariant is not enforced.

### 15.6 `process.chdir()` in SDK Adapter

The Claude SDK adapter changes the Node.js process's working directory:

```typescript
const originalDir = process.cwd();
process.chdir(worktreePath);
try {
  // ... run Claude SDK query
} finally {
  process.chdir(originalDir);
}
```

`process.chdir()` is a process-global operation. If multiple tasks run concurrently (max concurrent = 4), they could race on `process.cwd()`. This is a latent bug if the SDK adapter ever supports true concurrent execution. Currently, the adapter serializes executions, but this is not enforced by the type system.

### 15.7 Summary of Recommendations

| Issue | Severity | Recommendation |
|-------|----------|----------------|
| Duplicated `resolveWorkingDirectory()` | Medium | Extract to shared utility or eliminate one path |
| Duplicated worktree management | Medium | Unify or formalize the differences |
| Branch naming inconsistency (nodeId vs taskId) | High | Standardize on one naming scheme |
| `workingDirectory` field semantics | High | Split into `repository` + `sourceDirectory` |
| `process.chdir()` race condition | Low (latent) | Pass cwd to SDK query instead of global chdir |
| Repo setup / dispatch overlap | Low | Enforce "workingDirectory is always a local path after setup" |

---

## Appendix A: File Inventory

### Agent Runner (`packages/agent-runner/src/`)

| File | Lines | Purpose |
|------|-------|---------|
| `cli.ts` | ~340 | CLI entry point (commander) |
| `index.ts` | — | Public API exports |
| `types.ts` | ~620 | All type definitions |
| **Commands** (`commands/`) | | |
| `setup.ts` | ~260 | First-time setup + device auth |
| `start.ts` | ~340 | Main runner loop |
| `status.ts` | — | Health check |
| `stop.ts` | — | Graceful shutdown |
| `mcp.ts` | — | MCP server start |
| **Libraries** (`lib/`) | | |
| `websocket-client.ts` | ~855 | WebSocket + auto-reconnect |
| `task-executor.ts` | ~700 | Task queue + lifecycle |
| `worktree.ts` | ~226 | Git worktree management |
| `workdir-safety.ts` | ~300 | Safety tier system |
| `repo-utils.ts` | ~220 | Repo clone + file tree |
| `git-pr.ts` | ~237 | Push branch + create PR |
| `config.ts` | ~420 | Configuration management |
| `providers.ts` | ~300 | Provider detection |
| `resources.ts` | ~150 | CPU/memory/GPU detection |
| `hardware-id.ts` | — | Machine identification |
| `api-client.ts` | — | HTTP client for device auth |
| `hpc-context.ts` | — | HPC context for AI prompts |
| `slurm-detect.ts` | — | SLURM cluster detection |
| `slurm-executor.ts` | ~250 | SLURM job submit + monitor |
| `slurm-job-monitor.ts` | — | SLURM job tracking |
| `streaming-prompt.ts` | — | Prompt assembly |
| `ssh-discovery.ts` | — | SSH host discovery |
| `ssh-installer.ts` | — | Remote agent installation |
| **Providers** (`providers/`) | | |
| `base-adapter.ts` | ~60 | ProviderAdapter interface |
| `claude-sdk-adapter.ts` | ~500 | Claude SDK integration |
| `claude-code-adapter.ts` | ~315 | Claude CLI subprocess |
| `codex-adapter.ts` | ~230 | Codex CLI subprocess |
| `slurm-adapter.ts` | ~80 | SLURM adapter (deprecated) |
| **Execution** (`execution/`) | | |
| `types.ts` | ~115 | ExecutionStrategy interface |
| `registry.ts` | ~104 | Strategy detection + registry |
| `direct-strategy.ts` | ~187 | Local process execution |
| `docker-strategy.ts` | ~266 | Docker container execution |
| `slurm-strategy.ts` | ~245 | SLURM job submission |
| `kubernetes-exec-strategy.ts` | ~285 | K8s pod execution |
| `skypilot-strategy.ts` | ~388 | Cloud VM (experimental) |
| **MCP** (`mcp/`) | | |
| `server.ts` | ~200 | MCP server setup |
| `session-bridge.ts` | — | Session attachment |
| `tools.ts` | ~200 | Tool definitions |
| `types.ts` | — | MCP types |

### Server-side counterparts

| Server File | Agent Runner Equivalent | Notes |
|-------------|------------------------|-------|
| `server/lib/worktree-manager.ts` | `src/lib/worktree.ts` | **Duplicated** |
| `server/routes/dispatch.ts` `resolveWorkingDirectory()` | `src/lib/task-executor.ts` `resolveWorkingDirectory()` | **Duplicated** |
| `server/lib/providers/adapters/claude-code.ts` | `src/providers/claude-sdk-adapter.ts` | Different interfaces, same SDK |
