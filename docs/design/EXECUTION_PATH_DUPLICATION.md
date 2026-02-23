# The Execution Path Duplication Problem

> **Status: RESOLVED** (2026-02-22)
>
> This document described a critical architectural problem that has been **fully resolved** by the Execution Path Unification work on branch `zhuoran/execution-unification`. See [Section 9: Resolution](#9-resolution) for details.

## 1. Problem Statement

Astro ~~has~~ **had** **two parallel, independently-maintained code paths** for executing AI work. Every AI endpoint in the server contained an `if (useRelay) ... else ...` branch that split into:

- **Path A (Local Dispatch)**: The server itself ran the AI provider, managed git worktrees, created PRs, and streamed results directly to the browser.
- **Path B (Relay Dispatch)**: The server forwarded the task over WebSocket to an agent runner, which did all of the same work.

Both paths duplicated the same core operations — working directory resolution, worktree creation, PR creation, provider invocation — with subtle divergences that caused bugs, feature gaps, and maintenance burden.

This document presents the evidence, analyzes why it happened, proposes three solutions, and documents the chosen resolution.

---

## 2. The Two Parallel Execution Trees

### 2.1 High-Level View

```
                      User clicks "Run" on a plan node
                                    │
                                    ▼
                      POST /api/dispatch/task
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  isServerMode()               │
                    │  || environment !== 'local'    │
                    │  || targetMachineId            │
                    └───────────────┬───────────────┘
                              yes ┌─┴─┐ no
                                  │   │
          ┌───────────────────────▼┐ ┌▼───────────────────────────┐
          │                        │ │                             │
          │    PATH B: RELAY       │ │    PATH A: LOCAL            │
          │                        │ │                             │
          │ ┌────────────────────┐ │ │ ┌────────────────────────┐ │
          │ │ Build prompt       │ │ │ │ resolveWorkingDirectory │ │
          │ │ (dispatch.ts:888)  │ │ │ │ (dispatch.ts:283)       │ │
          │ └────────┬───────────┘ │ │ └────────────┬───────────┘ │
          │          │             │ │              │              │
          │ ┌────────▼───────────┐ │ │ ┌────────────▼───────────┐ │
          │ │ Find machine       │ │ │ │ createServerWorktree    │ │
          │ │ Send via WebSocket │ │ │ │ (worktree-manager.ts:37)│ │
          │ └────────┬───────────┘ │ │ └────────────┬───────────┘ │
          │          │             │ │              │              │
          │          ▼             │ │ ┌────────────▼───────────┐ │
          │  ┌─ AGENT RUNNER ──┐  │ │ │ Build prompt            │ │
          │  │                 │  │ │ │ (dispatch.ts:434)        │ │
          │  │ resolveWorkDir  │  │ │ └────────────┬───────────┘ │
          │  │ (task-exec:682) │  │ │              │              │
          │  │       │         │  │ │ ┌────────────▼───────────┐ │
          │  │ createWorktree  │  │ │ │ provider.stream(task)   │ │
          │  │ (worktree.ts:27)│  │ │ │ (claude-code.ts)        │ │
          │  │       │         │  │ │ └────────────┬───────────┘ │
          │  │ adapter.execute │  │ │              │              │
          │  │ (claude-sdk.ts) │  │ │ ┌────────────▼───────────┐ │
          │  │       │         │  │ │ │ autoCommitChanges       │ │
          │  │ pushAndCreatePR │  │ │ │ pushAndCreatePR         │ │
          │  │ (git-pr.ts:242) │  │ │ │ (worktree-manager:342)  │ │
          │  │       │         │  │ │ └────────────┬───────────┘ │
          │  │ task_result msg │  │ │              │              │
          │  └───────┤─────────┘  │ │ ┌────────────▼───────────┐ │
          │          │             │ │ │ Stream SSE to browser   │ │
          │ ┌────────▼───────────┐ │ │ └────────────────────────┘ │
          │ │ Relay → SSE bridge │ │ │                             │
          │ │ (dispatch.ts:984)  │ │ │                             │
          │ └────────────────────┘ │ │                             │
          └────────────────────────┘ └─────────────────────────────┘
```

### 2.2 The Split Appears in Every AI Endpoint

The `useRelay` branch is not just in task dispatch. It appears in **all three** AI endpoints:

```
server/routes/dispatch.ts:201    POST /api/dispatch/task
  const useRelay = isServerMode() || environment !== 'local' || targetMachineId

server/routes/agent.ts:340       POST /api/agent/generate-plan
  const useRelay = isServerMode() || (!!targetMachineId && !isLocalDir)

server/routes/agent.ts (chat)    POST /api/agent/chat
  const useRelay = isServerMode() || ...
```

Each endpoint has a full local-execution implementation AND a full relay-dispatch implementation. The server maintains six execution paths (3 endpoints x 2 paths) instead of three.

---

## 3. Evidence: Code-Level Duplication

### 3.1 resolveWorkingDirectory() — Three Implementations

The same "if git URL, clone to ~/.astro/repos/" logic exists in three places with different security and timeout characteristics.

**Implementation 1: Server** (`server/routes/dispatch.ts:283-313`)
```typescript
function resolveWorkingDirectory(value: string, projectId: string): string {
  const isGitUrl = value.startsWith('http://') || value.startsWith('https://') || value.startsWith('git@')
  if (!isGitUrl) return value

  if (!/^[a-zA-Z0-9-_]+$/.test(projectId)) {           // ← validates projectId
    throw new Error('Invalid projectId format')
  }

  const repoDir = join(homedir(), '.astro', 'repos', projectId)
  if (existsSync(join(repoDir, '.git'))) {
    try {
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null',  // ← disables hooks
        'fetch', '--all'], {
        cwd: repoDir, stdio: 'ignore',
        timeout: 30_000,                                       // ← 30s fetch
      })
    } catch { /* non-fatal */ }
  } else {
    execFileSync('git', ['clone', value, repoDir], {
      stdio: 'ignore', timeout: 120_000,                      // ← 120s clone
    })
  }
  return repoDir
}
```

**Implementation 2: Agent Runner Task Executor** (`packages/agent-runner/src/lib/task-executor.ts:682-704`)
```typescript
function resolveWorkingDirectory(value: string | undefined, projectId: string): string {
  if (!value) return process.cwd();                            // ← fallback to cwd

  const isGitUrl = value.startsWith('http://') || value.startsWith('https://') || value.startsWith('git@');
  if (!isGitUrl) return value;

  const repoDir = join(homedir(), '.astro', 'repos', projectId);
  const execOpts: ExecFileSyncOptions = { stdio: 'ignore', timeout: 120_000 };

  if (existsSync(join(repoDir, '.git'))) {
    try {
      execFileSync('git', ['fetch', '--all'],                  // ← NO hook disabling
        { ...execOpts, cwd: repoDir });                        // ← 120s fetch (not 30s)
    } catch { /* non-fatal */ }
  } else {
    execFileSync('git', ['clone', value, repoDir], execOpts);  // ← no projectId validation
  }
  return repoDir;
}
```

**Implementation 3: Agent Runner Repo Utils** (`packages/agent-runner/src/lib/repo-utils.ts:114-138`)
```typescript
function cloneRepository(repoUrl: string, projectId: string): string {
  const repoDir = join(homedir(), '.astro', 'repos', projectId);

  if (existsSync(join(repoDir, '.git'))) {
    try {
      execFileSync('git', ['fetch', '--all'], {
        cwd: repoDir, stdio: 'ignore',
        timeout: 30_000,                                       // ← 30s fetch (differs from #2!)
      });
    } catch { /* non-fatal */ }
  } else {
    mkdirSync(join(homedir(), '.astro', 'repos'), { recursive: true }); // ← ensures parent
    execFileSync('git', ['clone', repoUrl, repoDir], {
      stdio: 'ignore', timeout: 120_000,
    });
  }
  return repoDir;
}
```

**Divergences:**

| Aspect | Server (dispatch.ts) | Agent Runner (task-executor.ts) | Agent Runner (repo-utils.ts) |
|--------|---------------------|-------------------------------|------------------------------|
| projectId validation | Yes (`/^[a-zA-Z0-9-_]+$/`) | No | No |
| Git hook disabling | Yes (`core.hooksPath=/dev/null`) | No | No |
| Fetch timeout | 30s | 120s | 30s |
| Clone timeout | 120s | 120s | 120s |
| Ensures parent dir | No | No | Yes (`mkdirSync`) |
| Empty value handling | Error (required param) | Returns `process.cwd()` | N/A (called from wrapper) |

The server's security hardening (projectId validation, hook disabling) does not exist in the agent runner. The agent runner's `process.cwd()` fallback does not exist on the server. The fetch timeouts are inconsistent even within the agent runner itself (120s in task-executor vs 30s in repo-utils).

### 3.2 Worktree Creation — Different Branch Naming

**Server** (`server/lib/worktree-manager.ts:74-75`):
```typescript
const branchName = `astro/${sanitize(nodeId)}`     // ← uses nodeId
const worktreePath = join(baseRoot, sanitize(taskId))
```

**Agent Runner** (`packages/agent-runner/src/lib/worktree.ts:61-62`):
```typescript
const branchName = `astro/${sanitize(taskId)}`     // ← uses taskId (DIFFERENT!)
const worktreePath = join(baseRoot, sanitize(taskId))
```

This means the same plan node dispatched through different paths produces **different branch names**:
- Local dispatch: `astro/implement-auth` (from nodeId)
- Relay dispatch: `astro/exec-implement-auth-1708617600000` (from taskId/executionId)

The server version is more stable (same node always gets the same branch name). The agent runner version includes a timestamp, making branches unique per execution but harder to track.

**Additional divergences in worktree creation:**

| Step | Server | Agent Runner |
|------|--------|-------------|
| Remote branch deletion | Yes (lines 146-156) | No |
| Lingering worktree scan | Yes (parse porcelain, lines 90-134) | No (just prune) |
| Fetch before worktree | Yes (line 158-166) | No |
| Checkout default branch | Yes (lines 173-181) | No |
| Run .astro/.setup script | No | Yes (lines 82-95) |
| Apply .astro/include files | No | Yes (lines 75-80) |
| Subdirectory preservation | No | Yes (lines 97-102) |

### 3.3 PR Creation — Different Flows

**Server** (`server/lib/worktree-manager.ts:342-398`):
```
push branch → check gh auth → create PR → return
```

**Agent Runner** (`packages/agent-runner/src/lib/git-pr.ts:242-307`):
```
get git root → check remote origin → get default branch → auto-commit → check commits exist → push branch → check gh → create PR → return
```

The agent runner performs five extra validation steps before pushing. The server assumes these were already checked during worktree creation. If any assumption breaks (e.g., remote deleted between worktree creation and PR time), the server's PR creation fails with an unclear error, while the agent runner fails gracefully with a logged reason.

### 3.4 Features That Exist in Only One Path

This is the most damaging consequence of duplication. Features built in one path are simply missing from the other:

```
                PATH A (Server Local)         PATH B (Agent Runner)
                ─────────────────────         ─────────────────────
Procedure       ✅ classifyTask() +           ❌ Not implemented
Pipeline           subroutine execution          Tasks run as single
                   (dispatch.ts:240-257,         prompt regardless
                    619-706)                     of complexity

Safety          ❌ Not implemented             ✅ SAFE/GUARDED/RISKY/
Checks             Server trusts itself;          UNSAFE tier system
                   no user prompt before          (workdir-safety.ts)
                   writing to disk                Blocks parallel non-
                                                  git execution

Sandbox         ❌ Not implemented             ✅ Copy working dir
Mode               No isolation option            to temp; review
                                                  before applying
                                                  (workdir-safety.ts)

Execution       ❌ Direct only                 ✅ Direct, Docker,
Strategies         No container or                SLURM, K8s, SkyPilot
                   HPC support                    (execution/ directory)

HPC Context     ❌ Not implemented             ✅ Detects SLURM,
Injection          Server doesn't know            prepends cluster info
                   about HPC env                  to prompt
                                                  (claude-sdk-adapter:356)

Worktree        ❌ Not implemented             ✅ Runs .astro/.setup,
Setup Scripts      Server creates bare            applies .astro/include
                   worktree only                  (worktree.ts:73-95)

Remote Branch   ✅ Deletes remote branch       ❌ Only deletes local
Cleanup            on worktree cleanup            branch; remote lingers
                   (worktree-manager:146)

Lingering       ✅ Parses porcelain output,    ❌ Just runs
Worktree Scan      finds and removes stale        `git worktree prune`
                   worktrees by branch name
                   (worktree-manager:90-134)

Session         ✅ steerLocalTask() and        ✅ injectMessage() via
Steering           resumeLocalTask() with         Query.streamInput()
                   full session recovery           (claude-sdk-adapter:148)
                   (dispatch.ts:1136-1347)
```

---

## 4. How This Happened

The duplication was not a design decision. It emerged from three pressures:

**Pressure 1: Dev experience.** The server's local dispatch was added so `npm run dev` works without a separate agent runner process. This was the right call for developer velocity — but the "temporary" local execution path accumulated features (procedure pipelines, session steering) until it became a parallel production system.

**Pressure 2: Different contexts.** The agent runner legitimately needs capabilities the server doesn't (safety checks, HPC, execution strategies). Rather than flowing these through the relay protocol, they were built directly into the agent runner. Meanwhile, features like procedure pipelines were built on the server because they were easier to implement close to the database and API layer.

**Pressure 3: Incremental growth.** Each endpoint (plan-gen, chat, dispatch) independently added its `useRelay` branch. No single refactoring moment was large enough to justify unification.

The result is two execution engines that look identical from 10,000 feet but diverge in dozens of details at ground level. Every new feature must be built twice, and features built in one path are invisible to the other.

---

## 5. Three Possible Solutions

### 5.1 Solution A: Shared Library (Extract Common Code)

Extract duplicated logic into a shared `@astro/execution-core` package used by both server and agent runner.

```
packages/
  execution-core/            ← NEW shared package
    src/
      resolve-working-dir.ts   ← one implementation
      worktree.ts              ← one implementation (configurable branch naming)
      git-pr.ts                ← one implementation
      prompt-builder.ts        ← one implementation
      safety.ts                ← one implementation (usable by both)

  agent-runner/
    src/lib/
      task-executor.ts         ← imports from @astro/execution-core

server/
  lib/
    worktree-manager.ts        ← DELETED, imports from @astro/execution-core
  routes/
    dispatch.ts                ← imports from @astro/execution-core
```

**What gets unified:**
- `resolveWorkingDirectory()` — one function, configurable security level
- `createWorktree()` — one function, configurable branch naming (nodeId vs taskId passed by caller)
- `pushAndCreatePR()` — one function
- Safety checks — available to server too (not just agent runner)

**What stays separate:**
- Provider adapters (server uses server-side SDK wrapper; agent runner uses its own)
- The `if (useRelay)` branch still exists in every endpoint
- Two different streaming transports (SSE vs WebSocket) remain

**Diagram:**

```
             server/routes/dispatch.ts
                      │
         ┌────────────┤
         │ useRelay?   │
    ┌────▼─────┐  ┌───▼────────────┐
    │ Relay    │  │ Local dispatch  │
    │ dispatch │  │                 │
    └──────────┘  │ uses:           │
                  │ @astro/exec-core│ ← shared
                  └────────────────┘

             agent-runner/task-executor.ts
                      │
                      │ uses:
                      │ @astro/exec-core  ← same shared
                      ▼
                 execute task
```

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Low risk — no architectural change | Two paths still exist; features must still be built for both |
| Eliminates code duplication for git operations | Does not eliminate the `if/else` branch in every endpoint |
| Can be done incrementally | Server still needs provider SDK, git, filesystem access |
| Fixes timeout/security inconsistencies immediately | Feature asymmetry (procedure pipeline vs safety checks) remains |
| Easy to review and merge | Shared package adds dependency management overhead |

**Effort:** Medium. Extract functions, add package, update imports, write tests.

**Permanence:** Partial. Stops the divergence from getting worse but doesn't address the root cause (two execution paths).

---

### 5.2 Solution B: Embedded Agent Runner (Unify to One Path)

Eliminate local dispatch from the server entirely. Instead, the server auto-starts an in-process agent runner for local mode. ALL AI execution always goes through agent runners.

```
npm run dev
  │
  ├── Vite dev server (5173)
  │
  ├── Hono API server (3001)
  │     │
  │     ├── /api/dispatch/task  ─── ALWAYS ──→ relay dispatch
  │     ├── /api/agent/chat     ─── ALWAYS ──→ relay dispatch
  │     └── /api/agent/gen-plan ─── ALWAYS ──→ relay dispatch
  │
  ├── Relay server (3002)
  │     │
  │     └── Machine registry
  │           │
  │           ├── "local-embedded" ← auto-registered
  │           └── "user-laptop"    ← manual registration
  │
  └── Embedded Agent Runner (in-process)
        │
        ├── Registered with relay as "local-embedded"
        ├── Uses direct function calls (no WebSocket overhead)
        ├── Has provider adapters (Claude SDK, Code, Codex)
        ├── Has worktree management
        ├── Has safety checks
        ├── Has execution strategies
        └── Has procedure pipeline (moved from server)
```

**What changes:**
1. Server's `dispatchLocal()` — DELETED (~500 lines)
2. Server's `server/lib/worktree-manager.ts` — DELETED
3. Server's `server/lib/providers/` — DELETED (server no longer runs AI)
4. Server's `resolveWorkingDirectory()` — DELETED
5. All three `if (useRelay) ... else ...` branches — replaced with unconditional relay dispatch
6. Procedure pipeline — moved to agent runner
7. Agent runner gets an "embedded mode" that registers with relay via direct EventEmitter (no WebSocket)

**Before and After:**

```
BEFORE (current):
                                          Server Process
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │  dispatch.ts                                                 │
   │  ┌──────────────────────────────────────────────────┐       │
   │  │  if (useRelay) {                                  │       │
   │  │    // 200 lines: find machine, build prompt,      │       │
   │  │    // dispatch via WS, bridge relay→SSE           │       │
   │  │  } else {                                         │       │
   │  │    // 500 lines: resolve dir, create worktree,    │       │
   │  │    // get provider, stream execution, create PR,  │       │
   │  │    // handle procedures, cleanup                  │       │
   │  │  }                                                │       │
   │  └──────────────────────────────────────────────────┘       │
   │                                                              │
   │  + worktree-manager.ts (243 lines)                          │
   │  + providers/adapters/claude-code.ts (1135 lines)           │
   │  + providers/adapters/anthropic-direct.ts                    │
   │  + providers/registry.ts                                     │
   │  + providers/types.ts                                        │
   └──────────────────────────────────────────────────────────────┘

AFTER (proposed):
                                          Server Process
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │  dispatch.ts                                                 │
   │  ┌──────────────────────────────────────────────────┐       │
   │  │  // ALWAYS relay dispatch (~100 lines):           │       │
   │  │  // find machine, build prompt,                   │       │
   │  │  // dispatch via relay, bridge events→SSE         │       │
   │  └──────────────────────────────────────────────────┘       │
   │                                                              │
   │  Relay Server                                                │
   │  ┌──────────────┐     ┌──────────────────────────┐          │
   │  │ Machine      │     │ Embedded Agent Runner    │          │
   │  │ Registry     │◄───►│ (in-process, no WS)     │          │
   │  │              │     │                           │          │
   │  │ "local"  ────┤     │ task-executor.ts          │          │
   │  │ "remote" ────┤     │ worktree.ts               │          │
   │  └──────────────┘     │ claude-sdk-adapter.ts     │          │
   │                       │ safety checks             │          │
   │                       │ execution strategies      │          │
   │                       │ procedure pipeline        │          │
   │                       └──────────────────────────┘          │
   └──────────────────────────────────────────────────────────────┘
```

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Eliminates ALL duplication — one worktree, one resolver, one PR creator | Larger refactoring effort |
| Every feature works in both local and remote modes automatically | Relay protocol must be extended (chat, plan-gen, model selection) |
| Server becomes simpler (~1500 lines deleted) | Debugging adds indirection (server→relay→runner even locally) |
| Safety checks protect local dispatch too | "Embedded agent runner" is a new concept to implement and test |
| Procedure pipeline works for remote tasks | npm run dev startup is slightly more complex (relay must be ready) |
| Forces relay protocol completeness | Migration period where both paths coexist |
| Agent runner gets all investment, not split across two codebases | |

**Effort:** Large. Requires relay protocol changes, embedded runner implementation, migration of procedure pipeline, thorough testing of the unified path.

**Permanence:** Complete. The architectural root cause is resolved. All future features are built once.

---

### 5.3 Solution C: Server Becomes Thin Relay Client (Decouple Completely)

Take Solution B further: the server doesn't even embed an agent runner. For local dev, the user must start an agent runner separately (or `npm run dev` starts one as a subprocess, not in-process).

```
npm run dev
  │
  ├── Vite dev server (5173)
  ├── Hono API server (3001)     ← pure API + DB + relay, no AI
  ├── Relay server (3002)        ← message broker only
  └── Agent runner subprocess    ← started by npm script
        └── connects to ws://localhost:3002
```

**Diagram:**

```
   Server Process                          Agent Runner Process
   ┌──────────────────────┐               ┌──────────────────────┐
   │                      │               │                      │
   │  Hono API            │    ws://      │  WebSocket Client    │
   │  ┌────────────────┐  │   ┌──────┐   │  ┌────────────────┐  │
   │  │ dispatch.ts    │──┼──►│Relay │◄──┼──│ task-executor   │  │
   │  │ (relay only)   │  │   │Server│   │  │ worktree.ts     │  │
   │  └────────────────┘  │   └──────┘   │  │ providers/      │  │
   │                      │              │  │ safety/          │  │
   │  NO providers/       │              │  │ git-pr.ts        │  │
   │  NO worktree-mgr     │              │  └────────────────┘  │
   │  NO git operations   │              │                      │
   └──────────────────────┘              └──────────────────────┘

   Server has: DB, auth, API, relay
   Server does NOT have: Claude SDK, git worktrees, file system ops
```

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Cleanest architecture — pure separation of concerns | `npm run dev` no longer "just works" — needs agent runner |
| Server is truly stateless and horizontally scalable | WebSocket overhead even for localhost (negligible but real) |
| Identical code path for local and production | Two processes to manage during development |
| Agent runner is the single source of truth for execution | Chat latency increases (WS round-trip for every message) |
| Server deployment (Fly.io) needs zero AI dependencies | Harder to debug (issues span two processes) |
| | npm scripts must orchestrate two processes |

**Effort:** Large, similar to Solution B plus subprocess management.

**Permanence:** Complete, with stronger architectural guarantees than B.

---

## 6. Comparison Matrix

```
                    ┌──────────────────┬──────────────────┬──────────────────┐
                    │ A: Shared Library│ B: Embedded      │ C: Separate      │
                    │                  │    Runner         │    Process        │
────────────────────┼──────────────────┼──────────────────┼──────────────────┤
Code duplication    │ Reduced          │ Eliminated       │ Eliminated       │
                    │ (shared funcs)   │ (one path)       │ (one path)       │
────────────────────┼──────────────────┼──────────────────┼──────────────────┤
Feature asymmetry   │ Remains          │ Fixed            │ Fixed            │
                    │ (2 paths exist)  │ (1 path)         │ (1 path)         │
────────────────────┼──────────────────┼──────────────────┼──────────────────┤
if/else branches    │ Still in every   │ Removed          │ Removed          │
                    │ endpoint         │                  │                  │
────────────────────┼──────────────────┼──────────────────┼──────────────────┤
npm run dev UX      │ Unchanged        │ Unchanged        │ Degraded         │
                    │ (no migration)   │ (transparent)    │ (2 processes)    │
────────────────────┼──────────────────┼──────────────────┼──────────────────┤
Effort              │ Medium           │ Large            │ Large            │
                    │ (weeks)          │ (weeks-months)   │ (weeks-months)   │
────────────────────┼──────────────────┼──────────────────┼──────────────────┤
Risk                │ Low              │ Medium           │ Medium-High      │
                    │ (no arch change) │ (new component)  │ (UX regression)  │
────────────────────┼──────────────────┼──────────────────┼──────────────────┤
Relay protocol      │ No changes       │ Must extend      │ Must extend      │
changes needed      │ needed           │ (chat, plan-gen) │ (chat, plan-gen) │
────────────────────┼──────────────────┼──────────────────┼──────────────────┤
Server complexity   │ Same             │ Reduced (~1500   │ Greatly reduced  │
                    │                  │  lines deleted)  │                  │
────────────────────┼──────────────────┼──────────────────┼──────────────────┤
Permanence          │ Partial          │ Complete         │ Complete         │
                    │ (stops bleeding, │ (root cause      │ (strongest       │
                    │  not root cause) │  resolved)       │  guarantees)     │
────────────────────┼──────────────────┼──────────────────┼──────────────────┤
Can be done         │ Yes              │ Yes              │ No (requires     │
incrementally       │                  │                  │  big-bang switch) │
────────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

---

## 7. Recommendation: Solution B (Embedded Agent Runner)

### Why Not A

Solution A (shared library) is tempting because it's low-risk and incremental. But it doesn't solve the problem — it treats the symptom (duplicated code) while preserving the disease (two execution paths). After extracting shared functions, every new feature still requires the developer to ask: "Does this work in local dispatch? Does this work in relay dispatch? Do I need to update both?" The feature asymmetry table in Section 3.4 will continue to grow.

Shared libraries also create a coordination problem: the shared package must satisfy both the server's constraints (runs on Fly.io, no GPU) and the agent runner's constraints (runs on user's machine, has SLURM). The result is either a leaky abstraction or a lowest-common-denominator interface.

### Why Not C

Solution C (separate process) is the cleanest from a purist perspective, but it trades maintainability for developer experience. The `npm run dev` → everything works guarantee is one of Astro's best qualities. Requiring two processes, even if orchestrated by npm scripts, adds friction to every developer's daily workflow. It also makes chat feel slower — every keystroke goes through WebSocket round-trips instead of an in-process function call.

The architectural purity of C doesn't justify the UX cost. If the embedded runner (B) achieves the same code unification without the UX regression, C offers no practical advantage.

### Why B

Solution B eliminates duplication, fixes feature asymmetry, and preserves the single-process `npm run dev` experience. The key insight is:

**The server in local mode already IS an agent runner.** Solution B just makes this explicit. Instead of the server reimplementing agent-runner logic inline in `dispatch.ts`, it instantiates an actual agent runner and delegates to it through the relay's EventEmitter interface.

The embedded runner doesn't use WebSocket — it registers directly with the relay's in-memory machine registry. From the relay's perspective, it's just another machine. From the server's perspective, it's a local function call. From the user's perspective, nothing changed.

**Concrete benefits:**

1. Procedure pipeline works for remote tasks (not just local).
2. Safety checks protect local dispatch (not just remote).
3. Execution strategies (Docker, SLURM) are available locally.
4. Worktree setup scripts run on both paths.
5. Branch naming is consistent everywhere.
6. One PR creation flow. One working directory resolver. One worktree manager.
7. ~1500 lines deleted from server (`worktree-manager.ts`, `providers/`, local dispatch code).

### Implementation Sketch

**Phase 1: Relay protocol extension** (prerequisite)

Add missing fields to the relay task dispatch protocol:
```typescript
interface RelayTaskDispatch {
  // Existing fields...
  taskId: string;
  prompt: string;
  workingDirectory?: string;

  // New fields needed for chat/plan-gen:
  type: 'execution' | 'chat' | 'plan' | 'summarize';
  systemPrompt?: string;
  messages?: Array<{ role: string; content: string }>;
  model?: string;
  outputFormat?: { type: string; schema: Record<string, unknown> };
}
```

These fields already partially exist (added in recent relay protocol updates). Completing them is a small, well-scoped change.

**Phase 2: Embedded agent runner**

Create `server/lib/embedded-runner.ts`:
```typescript
import { TaskExecutor } from '@astroanywhere/agent-runner';
import { machineRegistry } from './machine-registry.js';

export function startEmbeddedRunner() {
  const executor = new TaskExecutor({ maxConcurrentTasks: 4 });
  const providers = detectProviders();

  // Register with relay as a local machine (no WebSocket)
  machineRegistry.registerLocal({
    machineId: 'local-embedded',
    providers,
    resources: detectResources(),
    dispatch: (task) => executor.submitTask(task),
    cancel: (taskId) => executor.cancelTask(taskId),
    steer: (taskId, msg) => executor.steerTask(taskId, msg),
  });
}
```

**Phase 3: Delete server-side execution**

Remove:
- `server/lib/worktree-manager.ts`
- `server/lib/providers/` (entire directory)
- `dispatchLocal()` from `dispatch.ts`
- Local execution paths from `agent.ts`
- `resolveWorkingDirectory()` from `dispatch.ts`

Replace with unconditional relay dispatch in all endpoints.

**Phase 4: Move procedure pipeline to agent runner**

The task classifier and subroutine executor move from `server/lib/dispatch/` to `packages/agent-runner/src/lib/`. The server sends task metadata (title, description); the agent runner decides whether to apply a procedure.

---

## 8. Migration Path

Solution B can be implemented incrementally alongside the existing system:

```
Week 1-2:  Extend relay protocol (type, systemPrompt, messages, model)
           ← both paths still work, no breakage

Week 3-4:  Build embedded runner, register with relay
           ← both paths work; embedded runner tested in parallel

Week 5-6:  Switch /api/agent/chat to relay-only
           ← simplest endpoint, low risk

Week 7-8:  Switch /api/agent/generate-plan to relay-only
           ← medium complexity

Week 9-10: Switch /api/dispatch/task to relay-only
           ← most complex, needs procedure pipeline migration

Week 11:   Delete server-side execution code
           ← cleanup

Week 12:   Comprehensive testing, edge case fixes
```

Each phase is independently deployable and reversible. The `useRelay` flag provides a natural feature gate during migration.

---

## 9. Resolution: Execution Path Unification (2026-02-22)

### 9.1 Chosen Approach

We implemented a **variant of Solution C** (Server Becomes Thin Relay Client) with subprocess management to preserve the `npm run dev` experience. The key difference from the original Solution C proposal: `npm run dev` starts the agent runner as a subprocess via `concurrently`, so the developer experience is unchanged — one command starts everything.

```
npm run dev
  │
  ├── Vite dev server (5173)
  ├── Hono API server (3001)     ← pure API + DB + relay, no AI execution
  ├── Relay server (3002)        ← message broker only
  └── Agent runner subprocess    ← started by concurrently with sleep 2
        └── connects to ws://localhost:3002
```

The `npm run dev` script became:
```
concurrently -n fe,be,agent "vite" "tsx watch ... server/index.ts" "sleep 2 && npm run dev:agent"
```

The `sleep 2` ensures the relay is ready before the agent runner connects.

### 9.2 What Was Deleted from Server

| File/Directory | Lines | What it did |
|----------------|-------|-------------|
| `server/lib/providers/` (entire directory) | ~2000+ | AI provider adapters (Claude Code, Codex, Anthropic Direct), registry, types |
| `server/lib/worktree-manager.ts` | ~400 | Server-side worktree creation, cleanup, PR creation |
| `server/lib/worktree-registry.ts` | ~100 | In-memory worktree tracking |
| `server/lib/session-manager.ts` | ~80 | AbortController map for agent sessions |
| `server/lib/chat-session-pool.ts` | ~150 | SDK session resume pool |
| `server/lib/dispatch/procedure-classifier.ts` | ~200 | Task classification into procedures |
| `server/lib/dispatch/procedure-executor.ts` | ~300 | Multi-step procedure execution |
| `server/lib/dispatch/procedure-types.ts` | ~100 | Procedure type definitions |
| Local execution paths in `agent.ts` | ~1300 | `if (useRelay) ... else ...` branches in all 6 endpoints |
| Local execution paths in `dispatch.ts` | ~1100 | `dispatchLocal()`, `steerLocalTask()`, `resumeLocalTask()`, worktree management |

**Estimated net deletion:** ~3500+ lines of server code.

### 9.3 What Was Added to Agent Runner

| Feature | File | Backported from |
|---------|------|----------------|
| Worktree porcelain parsing + lingering detection | `worktree.ts` | `worktree-manager.ts:94–134` |
| Remote branch pre-deletion | `worktree.ts` | `worktree-manager.ts:146–156` |
| Auto-commit fallback | `task-executor.ts` | `worktree-manager.ts:300–337` |
| Branch commit detection before PR | `git-pr.ts` | `worktree-manager.ts:280–294` |
| Prompt templates (plan, chat, task-chat, execution, summary) | `prompt-templates.ts` (new) | `server/lib/prompt-templates.ts` |
| Repo context reading (CLAUDE.md, README, file tree) | `repo-context.ts` (new) | `server/lib/repo-context.ts` |
| projectId validation | `task-executor.ts` | `dispatch.ts:283–313` |
| Git hook disabling on fetch | `task-executor.ts` | `dispatch.ts:283–313` |
| `resumeTask()` for post-completion steering | `claude-sdk-adapter.ts` | `claude-code.ts:929–1117` |

### 9.4 Issue Resolution Matrix

Every issue identified in Section 3 has been resolved:

| Issue (§3) | Status | Resolution |
|------------|--------|------------|
| **3.1** `resolveWorkingDirectory()` — three implementations | **RESOLVED** | Server implementation deleted. Agent runner's `task-executor.ts` version now has projectId validation AND git hook disabling (backported from server). Two implementations remain in agent runner (`task-executor.ts` and `repo-utils.ts`) for different contexts (task execution vs repo setup). |
| **3.2** Worktree creation — different branch naming | **RESOLVED** | Server `worktree-manager.ts` deleted entirely. Only agent runner's `worktree.ts` remains. Branch naming now consistently uses `astro/{taskId}`. Backported features: porcelain parsing, remote branch deletion, fetch before worktree, default branch detection. |
| **3.3** PR creation — different flows | **RESOLVED** | Server PR creation deleted. Only agent runner's `git-pr.ts` remains, with added branch commit detection. |
| **3.4** Features that exist in only one path | **RESOLVED** | There is now only ONE execution path (relay → agent runner). Server-only features (procedure pipeline) were deleted but preserved in git history. All agent runner features (safety checks, sandbox mode, execution strategies, worktree setup scripts) are now the canonical implementations for all dispatch modes. |

The `if (useRelay)` branch **no longer exists** in any endpoint. All AI endpoints unconditionally dispatch through the relay:

```typescript
// BEFORE (agent.ts, dispatch.ts — every endpoint):
const useRelay = isServerMode() || environment !== 'local' || targetMachineId
if (useRelay) {
  // 200 lines: relay dispatch
} else {
  // 500 lines: local execution
}

// AFTER (all endpoints):
// Always relay dispatch — no branching
return streamChatViaRelay(c, { taskId, projectId, ... })
```

### 9.5 Section 15 (AGENT_RUNNER.md) Critique Resolution

| Critique | Status | Notes |
|----------|--------|-------|
| 15.1 Duplicated `resolveWorkingDirectory()` | **RESOLVED** | Server version deleted |
| 15.2 Duplicated worktree management | **RESOLVED** | Server version deleted |
| 15.3 "Who manages the workspace" problem | **RESOLVED** | Always the agent runner |
| 15.4 Missing `workingDirectory` specification | **RESOLVED** | Added `sourceDirectory` field to Project and TaskDispatch types. `workingDirectory` deprecated. |
| 15.5 Repo setup vs task dispatch overlap | **RESOLVED** | `resolveWorkingDirectory()` no longer clones. Throws if git URL reaches dispatch. Clones go to user-specified dir. |
| 15.6 `process.chdir()` in SDK adapter | **RESOLVED** | Code uses `options.cwd`, never `process.chdir()`. Documented in `claude-sdk-adapter.ts`. |

### 9.6 Verification

- `npm run build` — zero type errors
- `npm run lint` — zero new lint errors
- `npm test` — 553 tests pass, 0 failures
- `npm run dev` starts server + agent runner, agent connects to relay
- No server code imports from `@anthropic-ai/claude-agent-sdk`
- No server code imports from `server/lib/providers/`
- No `if (useRelay)` branches remain in AI endpoints
- Server retains `prompt-templates.ts` and `repo-context.ts` (still needed to pre-build prompts before sending to relay)
