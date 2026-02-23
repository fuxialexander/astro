# Workspace V2 — Relay & Agent Runner Changes

> **Parent design:** [`docs/design/WORKSPACE_V2.md`](../design/WORKSPACE_V2.md)
> **Data model:** [`../backend/workspace-v2-data-model.md`](../backend/workspace-v2-data-model.md)

This document specifies relay protocol and agent runner changes.

---

## 1. Relay Protocol Changes (`server/types/relay.ts`)

### 1.1 `TaskDispatch` — add workspace fields

The relay is a pass-through. It forwards workspace fields from the platform to the agent runner without interpretation.

```typescript
export interface TaskDispatch {
  // ... all existing fields unchanged ...

  // UPDATED union
  deliveryMode?: 'pr' | 'push' | 'branch' | 'copy' | 'direct';

  // NEW — workspace context (passed through to agent runner)
  agentDir?: string;               // default '.astro'
  worktreeStrategy?: 'direct' | 'copy' | 'reference';
  referenceDir?: string;           // original dir when strategy=reference
  subdirectory?: string;           // monorepo CWD within worktree
}
```

### 1.2 No new message types

The workspace lifecycle (worktree creation, cleanup) is handled entirely by the agent runner. The relay doesn't need new message types — the existing `task.dispatch` → `task.result` flow is sufficient.

Workspace preparation happens **inside** the agent runner after it receives `task.dispatch`. The result (worktree path, branch name) flows back via `task.result`.

### 1.3 `TaskResult` — unchanged

Already contains `branchName`, `prUrl`, `prNumber`. For `copy` delivery mode, the diff summary goes in the existing `output` field. No new fields needed.

---

## 2. Relay Server Changes (`server/lib/relay-server.ts`)

### 2.1 Minimal changes

The relay server routes messages between platform and agent runners. It doesn't interpret workspace fields — it just passes them through.

**Only change:** When validating `task.dispatch` messages, accept the new `worktreeStrategy` and `agentDir` fields without rejecting them as unknown.

If the relay server does field validation/filtering on `TaskDispatch`, update the allow-list to include:
- `agentDir`
- `worktreeStrategy`
- `referenceDir`
- `subdirectory`

### 2.2 Machine registry — no changes

Machine registration (`MachineInfo`) doesn't need workspace capabilities. The platform knows the project's workspace strategy and sends the appropriate fields in `task.dispatch`. The agent runner handles execution.

---

## 3. Agent Runner Changes (`packages/agent-runner/`)

The agent runner is where workspace preparation actually happens. This is the most significant change.

### 3.1 Worktree path update

**Current:** `packages/agent-runner/src/lib/worktree.ts` creates worktrees at `.astro-tasks/{taskId}/`.

**Change:** Read `agentDir` from the dispatch and use `{agentDir}/worktrees/{taskId}/`.

```typescript
// BEFORE
const worktreePath = join(gitRoot, '.astro-tasks', taskId)

// AFTER
const agentDir = task.agentDir ?? '.astro'
const worktreePath = join(gitRoot, agentDir, 'worktrees', taskId)
const branchName = `${config.branchPrefix ?? 'astro/'}${taskId}`
```

### 3.2 Workspace preparation dispatcher

New function that routes to the correct workspace strategy based on the dispatch message:

```typescript
// packages/agent-runner/src/lib/workspace.ts (new file)

interface WorkspaceResult {
  workingDirectory: string     // where the agent should run
  cleanup?: () => Promise<void>  // called after task completes
}

async function prepareWorkspace(task: TaskDispatch): Promise<WorkspaceResult> {
  // Git repos always use git worktrees regardless of worktreeStrategy
  if (isGitRepo(task.workingDirectory)) {
    return prepareGitWorktree(task)
  }

  // Non-git: use the specified worktree strategy
  const strategy = task.worktreeStrategy ?? 'direct'
  switch (strategy) {
    case 'copy':
      return prepareCopyWorktree(task)
    case 'reference':
      return prepareReferenceWorktree(task)
    case 'direct':
    default:
      return { workingDirectory: task.workingDirectory! }
  }
}
```

### 3.3 Git worktree preparation

Existing logic, updated path:

```typescript
async function prepareGitWorktree(task: TaskDispatch): Promise<WorkspaceResult> {
  const gitRoot = await getGitRoot(task.workingDirectory!)
  const agentDir = task.agentDir ?? '.astro'
  const worktreePath = join(gitRoot, agentDir, 'worktrees', task.taskId)
  const branchName = `astro/${task.taskId}`

  await exec(`git worktree add "${worktreePath}" -b "${branchName}"`, { cwd: gitRoot })

  // For monorepo: set CWD to subdirectory within worktree
  const cwd = task.subdirectory
    ? join(worktreePath, task.subdirectory)
    : worktreePath

  return {
    workingDirectory: cwd,
    cleanup: async () => {
      await exec(`git worktree remove "${worktreePath}" --force`, { cwd: gitRoot })
      // Optionally delete branch: git branch -D branchName
    },
  }
}
```

### 3.4 Copy worktree preparation

New function for non-git projects with copy mode:

```typescript
async function prepareCopyWorktree(task: TaskDispatch): Promise<WorkspaceResult> {
  const sourceDir = task.workingDirectory!
  const agentDir = task.agentDir ?? '.astro'
  const worktreePath = join(sourceDir, agentDir, 'worktrees', task.taskId)

  // Build exclusion list from .gitignore if present
  const excludes = [agentDir]
  const gitignorePath = join(sourceDir, '.gitignore')
  if (await fileExists(gitignorePath)) {
    const patterns = parseGitignore(await readFile(gitignorePath, 'utf-8'))
    excludes.push(...patterns)
  }

  // Copy directory (respecting exclusions)
  await copyDirectory(sourceDir, worktreePath, { exclude: excludes })

  return {
    workingDirectory: worktreePath,
    cleanup: async () => {
      await rm(worktreePath, { recursive: true, force: true })
    },
  }
}
```

### 3.5 Reference worktree preparation

New function for large non-git directories:

```typescript
async function prepareReferenceWorktree(task: TaskDispatch): Promise<WorkspaceResult> {
  const agentDir = task.agentDir ?? '.astro'
  const referenceDir = task.referenceDir ?? task.workingDirectory!
  const worktreePath = join(referenceDir, agentDir, 'worktrees', task.taskId)

  // Create empty worktree directory
  await mkdir(worktreePath, { recursive: true })

  // File map is injected into the prompt by the backend context assembler,
  // not by the agent runner. The agent runner just creates the empty dir.

  return {
    workingDirectory: worktreePath,
    cleanup: async () => {
      await rm(worktreePath, { recursive: true, force: true })
    },
  }
}
```

### 3.6 Result delivery — update for `copy` mode

**Current:** `task-executor.ts` handles PR creation, branch push, etc.

**Add:** Handler for `copy` delivery mode that generates a diff between worktree and original:

```typescript
// In result handling after task completion:
if (task.deliveryMode === 'copy') {
  // Generate diff between worktree and original directory
  const diff = await generateDiff(task.workingDirectory!, worktreePath, {
    exclude: [task.agentDir ?? '.astro']
  })

  // Report diff as part of task result
  result.output = diff
  result.metadata = {
    ...result.metadata,
    worktreeStrategy: task.worktreeStrategy!,
    filesChanged: String(parseDiffFileList(diff).length),
  }
}
```

The platform presents this diff to the user for approval. Apply-back is a separate user action.

---

## 4. Config File Handling

### 4.1 Read config at workspace preparation

Before creating a worktree, check for `{workingDir}/{agentDir}/config.json` and read workspace settings:

```typescript
interface AstroConfig {
  baseBranch?: string
  branchPrefix?: string
  remoteType?: string
  deliveryMode?: string
  worktreeStrategy?: string
  worktreeLocation?: string | null
  referenceDir?: string | null
  referenceFileMap?: boolean         // inject file map into agent prompt for reference mode
}

function readAstroConfig(workingDir: string, agentDir: string): AstroConfig | null {
  const configPath = join(workingDir, agentDir, 'config.json')
  if (!existsSync(configPath)) return null
  return JSON.parse(readFileSync(configPath, 'utf-8'))
}
```

Config values are used as defaults when the dispatch message doesn't specify them. Dispatch message values take precedence.

---

## 5. Worktree Cleanup

### 5.1 On task success (PR merged or copy applied)

Remove the worktree directory:
```bash
# Git worktree
git worktree remove .astro/worktrees/{taskId} --force
git branch -d astro/{taskId}

# Copy/reference worktree
rm -rf .astro/worktrees/{taskId}/
```

### 5.2 On task failure

Keep the worktree for debugging. The user can manually clean up via a "Clean worktree" action in the UI.

### 5.3 On task cancel

Remove the worktree immediately (no useful work to preserve).

### 5.4 Stale worktree detection

The agent runner can list `.astro/worktrees/` and compare against known active executions. Stale worktrees (no matching active execution) can be flagged for cleanup. This is a future enhancement — not required for initial implementation.
