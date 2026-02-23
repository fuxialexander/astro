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
│           └───────────────────┤  ALL → Relay dispatch                       │
│                               ▼                                             │
│  ┌────────────────────────────────────────────────────┐                    │
│  │ Relay Server (WS, port 3002) + Machine Registry    │                    │
│  └────────────────────────┬───────────────────────────┘                    │
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

### 2.2 Unified Dispatch Path

> **Note:** The system previously had two dispatch paths (local and relay). The local dispatch path was removed in the Execution Path Unification. See `EXECUTION_PATH_DUPLICATION.md` §9 for the full history.

All task dispatch now flows through a single path:

```
                    ┌──────────────────┐
                    │ POST /api/dispatch│
                    │    /task          │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  ALWAYS RELAY    │
                    │  DISPATCH        │
                    └────────┬─────────┘
                             │
               ┌─────────────▼──────────────┐
               │   Build prompt, find       │
               │   machine, dispatch via    │
               │   WebSocket relay          │
               └─────────────┬──────────────┘
                             │
               ┌─────────────▼──────────────┐
               │   AGENT RUNNER             │
               │   Resolve working dir,     │
               │   create worktree,         │
               │   run AI, create PR,       │
               │   stream results back      │
               └────────────────────────────┘
```

The server is a pure API + DB + relay hub. It **never** calls AI directly.

---

## 3. Complete User Workflows

### 3.1 Workflow A: Create Project from Existing Directory (V2)

> **V2 change:** Per WORKSPACE_V2, the creation form collects a description + directory path (no repo URL field). Users clone repos themselves before creating a project. See WORKSPACE_V2.md §4.

```
STEP  COMPONENT          ACTION                           WHERE CODE LIVES
────  ─────────          ──────                           ──────────────────
 1    Browser            User enters description and      —
                         directory path on project-new.tsx
                         (defaults to ~/.astro/projects/{id}/)

 2    Browser            Debounced detection probe:       —
                         GET /api/repo/detect?path=...
                         Returns: isGit, remoteUrl,
                         remoteType, baseBranch,
                         suggestedDeliveryMode, dirSizeMB

 3    Browser            POST /api/repo/setup with        —
                         { workingDirectory, projectId }
                         Server creates agent dir
                         ({workingDir}/.astro/),
                         writes config.json, updates
                         .gitignore, reads key files

 4    Browser            Receives { workingDirectory,     —
                         fileTree, keyFiles }
                         Stores project in Zustand

 5    Browser            User clicks "Create &            —
                         Generate Plan"

 6    Browser            POST /api/agent/generate-plan    —
                         with { description, visionDoc,
                         workingDirectory, fileTree,
                         keyFiles, projectId }

 7    Server             Runs Claude with plan schema     (via relay → agent runner)
                         to generate nodes + edges.
                         Streams SSE events back.

 8    Browser            Receives plan_result SSE event.  —
                         Stores nodes/edges in plan store.
                         Displays graph.
```

### 3.2 Workflow B: Create Project without Directory (Planner)

```
STEP  COMPONENT          ACTION                           WHERE CODE LIVES
────  ─────────          ──────                           ──────────────────
 1    Browser            User enters description, leaves  —
                         directory as default
                         (~/.astro/projects/{id}/)

 2    Browser            POST /api/repo/setup with        ~/.astro/projects/{id}/
                         { workingDirectory, projectId }  (created automatically)

 3    Server             Creates directory. No git.       —
                         Creates agent dir (.astro/).
                         Returns key files (empty).

 4    Browser            Stores project. User uses        —
                         Astro for planning only.

 5+   Same as Workflow A steps 5-8
```

### 3.3 Workflow C: Dispatch a Task for Execution

All tasks are dispatched via the relay to agent runners. There is no local dispatch path.

```
STEP  COMPONENT          ACTION
────  ─────────          ──────
 1    Browser            User clicks "Run" on a plan node.
                         execution-store calls POST /api/dispatch/task with:
                         { nodeId, projectId, title, description, workingDirectory,
                           environment, targetMachineId?, preferredProvider?,
                           visionDoc?, dependencyOutputs[] }

 2    Server             Validates input (Zod). Checks dependencies are met.
      dispatch.ts        Assembles execution context (vision doc + deps).
                         Dispatches via relay — always.

 3    Server             Find target machine in registry.
      dispatch.ts        Build prompt. Send task_dispatch via WebSocket relay.
                         workingDirectory passed as-is (git URL or local path).

 4    Agent Runner       Receive task_dispatch message.
      task-executor      Run safety checks on directory.

 5    Agent Runner       Resolve workingDirectory:
      task-executor      - If git URL → REJECT (repo setup must resolve first)
                         - If empty → process.cwd()
                         - If local path → use as-is

 6    Agent Runner       Determine workspace strategy (per WORKSPACE_V2):
      task-executor      - Git repo → worktree isolation (default)
                           Create worktree at {agentDir}/worktrees/{taskId}/
                           Branch: {branchPrefix}{taskId} (default: astro/)
                         - Non-git, direct mode → work in-place (serial only)
                         - Non-git, copy mode → cp -r to {agentDir}/worktrees/{taskId}/
                         - Non-git, reference mode → empty worktree + file map
                         Reads config from {workingDir}/{agentDir}/config.json
                         - Parses porcelain output for lingering worktrees
                         - Deletes remote branch if exists (prevents non-fast-forward)
                         - Fetches latest from origin

 7    Agent Runner       Run adapter.execute(task, stream, signal) with
      providers/         workingDirectory = worktree path.

 8    Agent Runner       Stream events back via WebSocket:
      websocket-         task_text, task_tool_use, task_tool_result,
      client.ts          task_file_change, task_result

 9    Server             Relay receives WS events, converts to internal
      relay-server       format, emits to event bus.

10    Server             dispatch.ts listeners forward relay events as
      dispatch.ts        SSE to browser.

11    Agent Runner       On success:
      task-executor      - Auto-commit if agent didn't commit
                         - Check branch has commits ahead of base
                         - Push branch, create PR via pushAndCreatePR()
                         - Clean up worktree (keep branch if PR created)
                         - Send task_result with prUrl, branchName
```

### 3.4 Where Code Actually Lives During Execution

This is the critical piece that the previous doc did not make explicit.

**For git projects, the AI agent works in a worktree** — an isolated copy on a separate branch. For non-git projects, the isolation strategy depends on the workspace configuration (see WORKSPACE_V2.md for full design).

```
User's original repo:
  /Users/me/my-project/                  ← on branch "main"
  ├── .git/
  └── .astro/                            ← agent dir (configurable name)
      ├── config.json                    ← workspace settings
      └── worktrees/                     ← execution worktrees (gitignored)

Worktree created for task execution:
  /Users/me/my-project/.astro/worktrees/task-abc123/   ← on branch "astro/task-abc123"
  └── (full copy of repo files, isolated branch)

After task completes:
  The worktree branch is pushed → PR created (delivery mode dependent)
  Worktree directory is cleaned up (deleted)
  Branch is kept if PR exists, deleted otherwise
```

**Directory resolution chain:**

```
workingDirectory (from frontend)
  │
  │  Must be a local path: "/Users/me/my-project"
  │  (git URLs rejected — repo setup resolves them first)
  │
  ▼
resolveWorkingDirectory()
  │
  │  Git URL → ERROR (repo setup must resolve first)
  │  Local path → use as-is
  │  Empty → process.cwd()
  │
  ▼
Resolved path (e.g. /Users/me/my-project)
  │
  ▼
Determine workspace strategy (from task.deliveryMode + agentDir config)
  │
  ├─ Git repo → createWorktree()
  │  Creates {workingDir}/{agentDir}/worktrees/{taskId}/
  │  On branch: {branchPrefix}{taskId} (default: astro/{taskId})
  │
  ├─ Non-git, direct → work in-place (serial enforced)
  │
  ├─ Non-git, copy → createCopyWorktree()
  │  Copies directory to {agentDir}/worktrees/{taskId}/
  │
  └─ Non-git, reference → empty worktree + file map injection
  │
  ▼
Working directory ← THIS is what the AI actually uses as cwd
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
            │    git URL → REJECT (setup first)       │
            │    local path → use as-is               │
            │    empty → process.cwd()                │
            │                                         │
            │ b. Workspace strategy (per V2):         │
            │    Git → {agentDir}/worktrees/{taskId}  │
            │    Non-git direct → work in-place       │
            │    Non-git copy → cp -r to worktree     │
            │    Non-git ref → empty + file map       │
            │    branch: {branchPrefix}{taskId}       │
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
│                           │   model: claude-opus-4,  │  │
│                           │   tools: [MCP tools],   │  │
│  ┌─────────────────┐     │   options: { cwd }      │  │
│  │ options.cwd =    │     │ })                      │  │
│  │ worktree path    │     └──────────┬─────────────┘  │
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

**Critical detail: `options.cwd`** — The SDK adapter passes the worktree path via `options.cwd` to the Claude Agent SDK's `query()`. It does NOT use `process.chdir()` (see §15.6). Claude Code and Codex adapters pass `cwd` to `spawn()` similarly.

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
  readonly id: 'direct' | 'slurm' | 'docker' | 'k8s-exec';
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

`packages/agent-runner/src/lib/worktree.ts` — the **only** worktree implementation (server-side `worktree-manager.ts` was deleted).

> **V2 migration note:** The current code creates worktrees at `{gitRoot}/.astro-tasks/{taskId}/` with a fallback to `~/.astro/worktrees/{repoName}/`. Per WORKSPACE_V2, the target location is `{workingDir}/{agentDir}/worktrees/{taskId}/` (default: `.astro/worktrees/{taskId}/`), with branch prefix configurable in `{agentDir}/config.json`. See WORKSPACE_V2.md §5.2 and §9.5.

```
createWorktree(taskId, workingDirectory, agentDir?)
       │
       ├── Validate taskId format (alphanumeric + hyphens/underscores/dots)
       ├── Resolve git root: git rev-parse --show-toplevel
       ├── Verify commits exist: git rev-parse --verify HEAD
       │
       ├── V2 target paths:
       │   Base dir: {gitRoot}/{agentDir}/worktrees/  (default: .astro/worktrees/)
       │   Branch: {branchPrefix}{sanitized-taskId}   (default prefix: astro/)
       │   Path: {gitRoot}/{agentDir}/worktrees/{sanitized-taskId}/
       │   Config: read branchPrefix from {gitRoot}/{agentDir}/config.json
       │
       ├── Current paths (pre-V2):
       │   Base dir: {gitRoot}/.astro-tasks/  (fallback: ~/.astro/worktrees/{repoName}/)
       │   Branch: astro/{sanitized-taskId}   (hardcoded prefix)
       │
       ├── Remove lingering worktrees (porcelain parsing)
       │   └── git worktree list --porcelain → find matching branch → force-remove
       ├── Delete remote branch if exists: git push origin --delete {branch}
       ├── Delete old local branch: git branch -D {branchName}
       ├── Fetch latest: git fetch origin (with hook disabling)
       ├── Detect default branch: origin/HEAD → origin/main → origin/master
       ├── Create: git worktree add -b {branch} {path} {defaultBranch}
       │
       ├── Apply .astro/include/ files (copy into worktree)
       ├── Run .astro/.setup script (if exists)
       │
       └── Return { worktreePath, branchName, cleanup() }

On cleanup:
       ├── git worktree remove --force {path}
       ├── git worktree prune
       ├── rm -rf {path}
       └── (unless keepBranch) git branch -D {branchName}
```

**Features backported from server:**
- Porcelain parsing to find and remove lingering worktrees by branch name (prevents "branch already checked out" errors on re-execution)
- Remote branch pre-deletion before worktree creation (prevents non-fast-forward errors)
- Fetch before worktree creation (ensures latest code)
- Default branch detection (checkout from correct base)

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
  deviceToken?: string;          // Device auth token
  apiUrl: string;                // Default: http://localhost:3001
  relayUrl: string;              // Default: ws://localhost:3002
  accessToken?: string;          // JWT from device auth
  refreshToken?: string;         // For token refresh
  wsToken?: string;              // WebSocket auth
  claudeOauthToken?: string;     // From `claude setup-token`
  providers: ProviderType[];     // Detected providers
  autoStart: boolean;            // Start on login
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  lastConnected?: string;        // ISO timestamp of last successful connection
  setupCompleted: boolean;
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
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
  workingDirectory: string;         // Where to work (local path only; git URLs rejected)
  environment?: Record<string, string>;
  timeout?: number;                 // ms, default 1 hour
  maxTurns?: number;
  outputFormat?: { type: 'json_schema'; schema: Record };
  executionStrategy?: ExecutionStrategyType;
  createdAt: string;

  type?: TaskDispatchType;
  systemPrompt?: string;
  messages?: ConversationMessage[];
  model?: string;

  /** How results should be delivered (V2 adds 'copy' for non-git projects) */
  deliveryMode?: 'pr' | 'push' | 'branch' | 'copy' | 'direct';

  /** Remote type of the source repository */
  remoteType?: 'github' | 'gitlab' | 'bitbucket' | 'generic' | 'none';
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

### Per-project agent directory (V2 — see WORKSPACE_V2.md §3)

```
/home/user/my-project/              # user's working directory
├── .astro/                         # agent dir (name configurable: .astro, .claude, etc.)
│   ├── config.json                 # workspace config (baseBranch, branchPrefix, deliveryMode)
│   ├── worktrees/                  # execution worktrees (gitignored)
│   │   ├── task-abc123/            # git worktree or directory copy
│   │   └── task-def456/
│   └── cache/                      # ephemeral caches (gitignored)
├── CLAUDE.md                       # agent instructions (user-managed)
└── src/
```

### Global data directory

```
~/.astro/                           # Metadata only (no worktrees — those live in project dirs)
├── projects/                       # Default project directories (when user provides no path)
│   └── {projectId}/
├── logs/                           # SDK debug logs
├── hpc/
│   └── config.json                 # HPC overrides
└── astro.db                        # Agent runner's SQLite database

~/.config/astro-agent/              # Configuration
└── config.json                     # Runner-level config (see section 12)
```

> **Migration note:** Pre-V2 code creates worktrees at `{gitRoot}/.astro-tasks/{taskId}/` with a fallback to `~/.astro/worktrees/{repoName}/`. V2 moves all worktrees into the per-project agent directory. Old `.astro-tasks/` directories can be deleted manually.

---

## 15. Architectural Critique and Known Redundancies

> **Update (2026-02-22):** Issues 15.1–15.3 have been **fully resolved** by the Execution Path Unification. The server no longer has a local dispatch path. See `EXECUTION_PATH_DUPLICATION.md` §9.

### 15.1 ~~Duplicated Working Directory Resolution~~ ✅ RESOLVED

~~The same logic existed in three places.~~

**Resolution:** The server's `resolveWorkingDirectory()` in `dispatch.ts` was deleted. The agent runner's version in `task-executor.ts` now includes the security hardening (projectId validation, git hook disabling) that was previously server-only. Two implementations remain in the agent runner for different contexts:
- `task-executor.ts:resolveWorkingDirectory()` — used during task dispatch
- `repo-utils.ts:cloneRepository()` — used during repo setup requests

### 15.2 ~~Duplicated Worktree Management~~ ✅ RESOLVED

~~Two separate implementations existed.~~

**Resolution:** `server/lib/worktree-manager.ts` was deleted. The agent runner's `worktree.ts` is now the only implementation. Server-specific features (porcelain parsing, remote branch deletion, fetch before worktree, default branch detection) were backported to the agent runner before deletion.

### 15.3 ~~The "Who Manages the Workspace" Problem~~ ✅ RESOLVED

~~The answer was "both, depending on the dispatch path."~~

**Resolution:** The answer is now unambiguously **the agent runner**. The server passes the raw `workingDirectory` value via relay, and the agent runner handles everything: cloning, worktree creation, AI execution, PR creation, and cleanup.

### 15.4 ~~Missing Working Directory Specification in Task Schema~~ ✅ RESOLVED

~~The `Task` interface had a `workingDirectory: string` field with ambiguous semantics depending on dispatch path.~~

**Resolution:** Added `sourceDirectory` field to `Project` type (`src/types/index.ts`) and `TaskDispatch` (`server/types/relay.ts`). `sourceDirectory` always means "the resolved local path where the project repo lives." All consumers use `project.sourceDirectory ?? project.workingDirectory` for backward compatibility. New projects set `sourceDirectory` on creation. `workingDirectory` is deprecated but kept for old projects.

### 15.5 ~~Repo Setup vs Task Dispatch Overlap~~ ✅ RESOLVED

~~When a project is created, `/api/repo/setup` cloned the repo and built the file tree. Then `resolveWorkingDirectory()` in `task-executor.ts` could clone the same repo again.~~

**Resolution:** `resolveWorkingDirectory()` in `task-executor.ts` no longer handles git URLs. If a git URL reaches dispatch time, it throws an error — repo setup must have resolved it to a local path first. Per WORKSPACE_V2, worktrees move from `{gitRoot}/.astro-tasks/{taskId}/` (current) to `{workingDir}/{agentDir}/worktrees/{taskId}/` (V2 target, default agent dir: `.astro`). `~/.astro/` is metadata-only (DB, logs, config).

### 15.6 ~~`process.chdir()` in SDK Adapter~~ ✅ RESOLVED

~~The Claude SDK adapter changed the Node.js process's working directory with `process.chdir()`.~~

**Resolution:** The code intentionally does NOT use `process.chdir()`. The Claude SDK adapter passes `cwd` via `options.cwd` (see `claude-sdk-adapter.ts`). Claude Code and Codex adapters pass `cwd` to `spawn()`. An explicit comment in `claude-sdk-adapter.ts` documents the design decision.

### 15.7 Summary

| Issue | Status | Notes |
|-------|--------|-------|
| Duplicated `resolveWorkingDirectory()` | ✅ RESOLVED | Server version deleted |
| Duplicated worktree management | ✅ RESOLVED | Server version deleted, features backported to agent runner |
| Branch naming inconsistency (nodeId vs taskId) | ✅ RESOLVED | Always `{branchPrefix}{taskId}` (only agent runner path remains) |
| "Who manages the workspace" | ✅ RESOLVED | Always the agent runner |
| `workingDirectory` field semantics | ✅ RESOLVED | Added `sourceDirectory` field, `workingDirectory` deprecated |
| `process.chdir()` race condition | ✅ RESOLVED | Code uses `options.cwd`, never `process.chdir()` |
| Repo setup / dispatch overlap | ✅ RESOLVED | Dispatch throws on git URLs; repo setup always resolves to local path first |
| Worktree path migration | 🔄 IN PROGRESS | Current: `.astro-tasks/`; V2 target: `{agentDir}/worktrees/` (see WORKSPACE_V2.md) |
| Per-project workspace config | 🔄 PLANNED | V2: `{agentDir}/config.json` with baseBranch, branchPrefix, deliveryMode |
| Non-git workspace strategies | 🔄 PLANNED | V2: direct (in-place), copy-to-worktree, reference folder |
| Configurable agent dir name | 🔄 PLANNED | V2: default `.astro`, configurable to `.claude` etc. |

---

## Appendix A: File Inventory

### Agent Runner (`packages/agent-runner/src/`)

| File | Lines | Purpose |
|------|-------|---------|
| `cli.ts` | ~340 | CLI entry point (commander) |
| `index.ts` | — | Public API exports |
| `types.ts` | ~620 | All type definitions |
| **Commands** (`commands/`) | | |
| `index.ts` | ~9 | Command exports |
| `setup.ts` | ~260 | First-time setup + device auth |
| `start.ts` | ~340 | Main runner loop |
| `status.ts` | — | Health check |
| `stop.ts` | — | Graceful shutdown |
| `mcp.ts` | — | MCP server start |
| **Libraries** (`lib/`) | | |
| `websocket-client.ts` | ~855 | WebSocket + auto-reconnect |
| `task-executor.ts` | ~823 | Task queue + lifecycle |
| `worktree.ts` | ~406 | Git worktree management |
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
| `prompt-templates.ts` | ~450 | Plan/chat/execution/summary prompt builders (from server) |
| `repo-context.ts` | ~74 | Reads CLAUDE.md, README, package files, file tree (from server) |
| `ssh-discovery.ts` | — | SSH host discovery |
| `ssh-installer.ts` | — | Remote agent installation |
| **Providers** (`providers/`) | | |
| `base-adapter.ts` | ~60 | ProviderAdapter interface |
| `claude-sdk-adapter.ts` | ~683 | Claude SDK integration |
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
| `index.ts` | ~30 | Strategy exports |
| **MCP** (`mcp/`) | | |
| `server.ts` | ~200 | MCP server setup |
| `session-bridge.ts` | ~410 | Session attachment |
| `tools.ts` | ~278 | Tool definitions |
| `types.ts` | — | MCP types |

### Server-side counterparts (historical)

> **Note:** As of the Execution Path Unification, the server no longer has provider adapters, worktree management, or local dispatch. These files were deleted.

| Former Server File | Agent Runner Equivalent | Status |
|-------------|------------------------|-------|
| ~~`server/lib/worktree-manager.ts`~~ | `src/lib/worktree.ts` | Server version **deleted** — features backported to agent runner |
| ~~`server/routes/dispatch.ts` `resolveWorkingDirectory()`~~ | `src/lib/task-executor.ts` `resolveWorkingDirectory()` | Server version **deleted** — security hardening backported |
| ~~`server/lib/providers/adapters/claude-code.ts`~~ | `src/providers/claude-sdk-adapter.ts` | Server version **deleted** |
| ~~`server/lib/providers/` (entire directory)~~ | `src/providers/` | Server version **deleted** |
| ~~`server/lib/session-manager.ts`~~ | N/A | **Deleted** — agent runner manages sessions inline |
| ~~`server/lib/chat-session-pool.ts`~~ | N/A | **Deleted** — agent runner manages sessions inline |
| `server/lib/prompt-templates.ts` | `src/lib/prompt-templates.ts` | Both exist — server pre-builds prompts for relay, agent runner has copies as fallback |
| `server/lib/repo-context.ts` | `src/lib/repo-context.ts` | Both exist — server reads context for prompt building, agent runner has copies for standalone use |
