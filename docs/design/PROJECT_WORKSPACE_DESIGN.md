# Project Workspace Design — Robust Parallel Execution

> **Status:** DESIGN — Proposed overhaul of project creation and workspace management.
> Addresses corner cases in directory sharing, non-GitHub users, reference repos, and parallel execution.

---

## 1. Problem Statement

The current project creation form collects:
- **Working directory** (optional local path)
- **Repository URL** (optional GitHub/Git link)
- **Resource paths** (optional data folders)

This works for the simple case (user has a GitHub repo, clones it, agents PR back). But several real-world scenarios break:

| # | Scenario | What Breaks |
|---|----------|-------------|
| 1 | User doesn't use GitHub (local-only git, or no git at all) | `gh pr create` fails; no delivery mechanism |
| 2 | Two projects share the same working directory | Without git: two agents edit the same files simultaneously. With git: worktrees work but task provenance is tangled |
| 3 | User's working dir is already a git repo, and they provide a *different* GitHub URL as reference | System clones the reference URL *over* the working dir, destroying the existing repo |
| 4 | User provides a GitLab/Bitbucket/self-hosted URL | `gh` CLI doesn't work; need provider-agnostic PR creation |
| 5 | User has a monorepo and creates projects for different subdirectories | Worktrees branch from the monorepo root; agents must know which subdirectory to work in |
| 6 | User provides a repo URL but no working directory | Where does the clone go? `~/.astro/repos/` pollutes home directory |

---

## 2. Root Cause: Conflated Concepts

The current data model treats "working directory" and "repository URL" as two flat, optional fields on a Project. In reality, there are **three distinct concepts** that need separate representation:

### 2.1 Source Repository

The primary codebase that agents modify. This is where worktrees branch from and where PRs/patches are delivered.

```
Properties:
  - localPath:    /home/user/my-project/         (absolute, on disk)
  - gitRoot:      /home/user/my-project/         (may differ from localPath in monorepos)
  - remoteUrl:    git@github.com:user/repo.git   (may be absent for local-only)
  - remoteType:   github | gitlab | bitbucket | self-hosted | none
  - baseBranch:   main                           (branch agents fork from)
  - isGit:        true/false
  - subdirectory: packages/api/                  (within monorepo, or empty)
```

### 2.2 Reference Material

Additional repos, documentation, or data that agents can **read** but should not **modify**. These are cloned/linked separately from the source repo.

```
Properties:
  - url:          git@github.com:other/reference.git
  - localPath:    /home/user/my-project/.astro-refs/reference/
  - purpose:      "API specification for the external service we integrate with"
  - readOnly:     true
```

### 2.3 Execution Workspace

The ephemeral directory where an agent actually runs. Created per-task from the source repo via worktree (or copy for non-git).

```
Properties:
  - worktreePath: /home/user/my-project/.astro-tasks/task-abc123/
  - branchName:   astro/task-abc123
  - sourceRef:    → points back to Source Repository
  - cleanup:      function to remove worktree after completion
```

---

## 3. The Six Scenarios — Correct Behavior

### Scenario A: Local git repo with remote (most common)

```
User input:
  workingDir: /home/user/my-project/     (git repo, remote: github.com:user/repo)
  repoUrl:    (empty)

Detection:
  isGit=true, hasRemote=true, remoteUrl=github.com:user/repo

Result:
  source.localPath     = /home/user/my-project/
  source.remoteUrl     = git@github.com:user/repo.git  (auto-detected)
  source.remoteType    = github
  deliveryMode         = pr
  references           = []

Execution:
  worktree at /home/user/my-project/.astro-tasks/{taskId}/
  agent works on branch astro/{taskId}
  on completion: git push + gh pr create
```

### Scenario B: Local git repo, no remote

```
User input:
  workingDir: /home/user/my-analysis/    (git repo, no remote)
  repoUrl:    (empty)

Detection:
  isGit=true, hasRemote=false

Result:
  source.localPath     = /home/user/my-analysis/
  source.remoteUrl     = (none)
  deliveryMode         = branch   ← agents leave work on local branches

Execution:
  worktree at /home/user/my-analysis/.astro-tasks/{taskId}/
  agent works on branch astro/{taskId}
  on completion: no push, no PR. Branch stays local.
  UI shows: "View branch" → user merges manually (git merge astro/{taskId})
```

### Scenario C: Non-git directory (no repo URL)

```
User input:
  workingDir: /home/user/scripts/        (not a git repo)
  repoUrl:    (empty)

Detection:
  isGit=false, hasRemote=false

Prompt user:
  "This directory is not a git repository. Without git, agents work directly
   on your files with no branch isolation. We strongly recommend initializing
   git for safety."

   [Initialize Git]  [Continue Without Git (risky)]

IF user chooses "Initialize Git":
  git init, generate .gitignore, initial commit
  → now behaves like Scenario B (local git, no remote)

IF user chooses "Continue Without Git":
  source.localPath     = /home/user/scripts/
  source.isGit         = false
  deliveryMode         = direct   ← agents modify files in-place

  CONSTRAINT: only ONE active task at a time on this project
  (no parallel execution without git isolation)

Execution:
  NO worktree (can't create worktrees without git)
  agent works directly in /home/user/scripts/
  on completion: files are modified in-place, no undo
  UI shows: "Changes applied directly" with warning icon
```

### Scenario D: Remote repo URL + working directory

```
User input:
  workingDir: /home/user/work/
  repoUrl:    github.com/org/big-project

Detection on workingDir:
  exists=true, isGit=false (or isGit=true with DIFFERENT remote)

Resolution:
  IF workingDir is not git OR is empty dir:
    → clone repoUrl into workingDir/big-project/
    source.localPath   = /home/user/work/big-project/
    source.remoteUrl   = git@github.com:org/big-project.git
    deliveryMode       = pr

  IF workingDir IS git with DIFFERENT remote:
    → treat repoUrl as reference (see Scenario E)
    → DO NOT clone over existing repo
```

### Scenario E: Working dir is git repo + different repo URL as reference

```
User input:
  workingDir: /home/user/my-project/     (git, remote: github.com:user/my-project)
  repoUrl:    github.com/spec/api-spec   (DIFFERENT repo)

Detection:
  workingDir remote = github.com:user/my-project
  repoUrl           = github.com:spec/api-spec
  MISMATCH → repoUrl is a reference, not the source

Result:
  source.localPath     = /home/user/my-project/
  source.remoteUrl     = git@github.com:user/my-project.git  (from working dir)
  deliveryMode         = pr (to my-project, NOT to api-spec)

  references[0] = {
    url:       git@github.com:spec/api-spec.git
    localPath: /home/user/my-project/.astro-refs/api-spec/
    purpose:   "Reference repository"
  }

Execution:
  worktree branches from my-project (the source)
  api-spec is cloned into .astro-refs/ and injected as read-only context
  agent prompt includes: "Reference code at /home/user/my-project/.astro-refs/api-spec/"
```

### Scenario F: Repo URL only, no working directory

```
User input:
  workingDir: (empty)
  repoUrl:    github.com/org/repo

Resolution:
  Clone to user-chosen directory (form must collect this)
  OR default to ~/Projects/repo/

Result:
  source.localPath     = ~/Projects/repo/
  source.remoteUrl     = git@github.com:org/repo.git
  deliveryMode         = pr
```

---

## 4. Directory Conflict Detection

### 4.1 Same directory, multiple projects

When a user creates project B with the same working directory as existing project A:

```
QUERY: SELECT * FROM projects WHERE sourceDirectory = '/home/user/my-project/'

IF found AND existing project has isGit=true:
  → ALLOW with informational note:
    "This directory is also used by project '{A.name}'.
     Each task runs on its own git branch — no conflicts."

  NOTE: worktrees from both projects coexist in .astro-tasks/
  Each worktree has {taskId} which includes projectId for provenance.

IF found AND existing project has isGit=false:
  → BLOCK with error:
    "This directory is already used by project '{A.name}'.
     Without git, parallel work would cause file conflicts.
     Please use a different directory or initialize git."
```

### 4.2 Subdirectory of another project's git root

```
Project A: sourceDirectory = /home/user/monorepo/
Project B: sourceDirectory = /home/user/monorepo/packages/api/

Both share the same git root. This is fine:
  - Worktrees are created at the git root level
  - The subdirectory field preserves which package each project targets
  - Agent B works in {worktree}/packages/api/ (not the worktree root)
```

### 4.3 Non-overlapping directories

No conflict. Each project operates independently.

---

## 5. Delivery Modes

The delivery mode is **derived** from the source configuration, not user-chosen:

| Source State | Delivery Mode | How Results Are Delivered | UI Label |
|-------------|---------------|--------------------------|----------|
| Git + GitHub remote | `pr` | Push branch, `gh pr create` | "View Pull Request" |
| Git + GitLab remote | `pr` | Push branch, GitLab API or `glab mr create` | "View Merge Request" |
| Git + Bitbucket remote | `pr` | Push branch, Bitbucket API | "View Pull Request" |
| Git + self-hosted/unknown remote | `push` | Push branch, user creates PR manually | "View Branch (pushed)" |
| Git + no remote | `branch` | Branch stays local, user merges | "View Branch (local)" |
| No git | `direct` | Files modified in-place | "Changes Applied" |

### 5.1 Remote Type Detection

```typescript
function detectRemoteType(remoteUrl: string): RemoteType {
  if (!remoteUrl) return 'none'

  const url = remoteUrl.toLowerCase()
  if (url.includes('github.com'))    return 'github'
  if (url.includes('gitlab.com'))    return 'gitlab'
  if (url.includes('gitlab.'))       return 'gitlab'   // self-hosted GitLab
  if (url.includes('bitbucket.org')) return 'bitbucket'

  // Self-hosted: has a remote but we don't know the forge
  return 'generic'
}
```

### 5.2 PR Creation by Provider

```typescript
async function createPR(worktreePath: string, opts: PROptions): Promise<PRResult | null> {
  const remoteType = detectRemoteType(opts.remoteUrl)

  switch (remoteType) {
    case 'github':
      return createGitHubPR(worktreePath, opts)    // gh pr create
    case 'gitlab':
      return createGitLabMR(worktreePath, opts)    // glab mr create OR API
    case 'bitbucket':
      return createBitbucketPR(worktreePath, opts) // API call
    case 'generic':
      // Push branch, return branch URL, user creates PR manually
      await pushBranch(worktreePath, opts.branchName)
      return { branchName: opts.branchName, pushed: true }
    case 'none':
      // Local only — nothing to push
      return { branchName: opts.branchName }
  }
}
```

---

## 6. Non-Git Safety: Copy-on-Write Mode

For users who refuse to initialize git (Scenario C), agents work directly on files. This is dangerous for parallel execution. Two safety mechanisms:

### 6.1 Serial Execution Constraint

```typescript
// In dispatch-queue.ts
function canDispatchTask(project: Project, activeTaskCount: number): boolean {
  if (!project.source.isGit && activeTaskCount > 0) {
    return false  // Only one task at a time for non-git projects
  }
  return true
}
```

### 6.2 Pre-Execution Snapshot (optional, future)

For non-git directories, create a timestamped copy before execution:

```
/home/user/scripts/                  ← original (agent works here)
/home/user/scripts/.astro-snapshots/
  2026-02-22T21:00:00/               ← copy before task A
  2026-02-22T21:30:00/               ← copy before task B
```

This gives undo capability without git. Low priority — most users should just use git.

---

## 7. Reference Repository Management

### 7.1 Storage Location

Reference repos are cloned into `.astro-refs/` inside the project directory:

```
/home/user/my-project/
  .astro-refs/
    api-spec/           ← cloned from github.com:spec/api-spec
    design-system/      ← cloned from github.com:org/design-system
  .astro-tasks/
    task-abc123/        ← worktree for active task
  .gitignore            ← includes .astro-refs/ and .astro-tasks/
  src/
  package.json
```

### 7.2 Context Injection

References are injected into the agent prompt as read-only context:

```
## Reference Repositories

The following repositories are available for reference. They are READ-ONLY —
do not modify files in these directories.

- /home/user/my-project/.astro-refs/api-spec/
  Purpose: "API specification for the external service"

- /home/user/my-project/.astro-refs/design-system/
  Purpose: "Shared component library"
```

### 7.3 Worktree Inclusion

When a worktree is created, `.astro-refs/` is **not** included (it's gitignored). Instead, the agent prompt provides absolute paths to the reference repos in the original project directory.

```
## Data Access

Your working directory is a git worktree (isolated branch).
The original project directory is: /home/user/my-project/

Reference repositories are at:
  /home/user/my-project/.astro-refs/api-spec/
  /home/user/my-project/.astro-refs/design-system/

Use absolute paths to access reference files.
```

---

## 8. Revised Data Model

### 8.1 Project Type

```typescript
interface Project {
  id: string
  name: string
  description: string
  visionDoc: string
  status: 'active' | 'archived'

  // ── Source configuration ──────────────────────────────────
  source: {
    type: 'local-git' | 'cloned-git' | 'local-dir'
    localPath: string              // Absolute path on disk
    gitRoot?: string               // Git root (may differ from localPath in monorepos)
    subdirectory?: string          // Relative path within git root (monorepo support)
    remoteUrl?: string             // Git remote URL (auto-detected or user-provided)
    remoteType: 'github' | 'gitlab' | 'bitbucket' | 'generic' | 'none'
    baseBranch: string             // Default branch (main/master/develop)
    isGit: boolean
  }

  // ── Delivery mode (derived from source) ───────────────────
  deliveryMode: 'pr' | 'push' | 'branch' | 'direct'

  // ── Reference repositories ────────────────────────────────
  references: Array<{
    id: string
    url: string                    // Git URL
    localPath: string              // Where cloned on disk
    purpose: string                // User description
  }>

  // ── Resource paths (data, configs, docs) ──────────────────
  resourcePaths: string[]

  // ── Cached file tree ──────────────────────────────────────
  fileTree?: string[]
  fileTreeUpdatedAt?: string
  fileTreeMachineId?: string

  // ── Execution defaults ────────────────────────────────────
  defaultEnvironment?: 'local' | 'remote' | 'hpc' | 'cloud'
  defaultMachineId?: string

  // ── Backward compatibility ────────────────────────────────
  /** @deprecated Use source.localPath */
  workingDirectory?: string
  /** @deprecated Use source.localPath */
  sourceDirectory?: string
  /** @deprecated Use source.remoteUrl */
  repository?: string
}
```

### 8.2 Backward Compatibility

All existing code that reads `project.sourceDirectory ?? project.workingDirectory` continues to work. New code reads `project.source.localPath`. Migration:

```typescript
function migrateProject(old: OldProject): Project {
  const localPath = old.sourceDirectory ?? old.workingDirectory ?? ''
  const isGit = localPath ? isGitRepo(localPath) : false
  const remoteUrl = old.repository ?? (isGit ? getGitRemoteUrl(localPath) : undefined)

  return {
    ...old,
    source: {
      type: old.repository ? 'cloned-git' : isGit ? 'local-git' : 'local-dir',
      localPath,
      remoteUrl,
      remoteType: detectRemoteType(remoteUrl ?? ''),
      baseBranch: 'main',
      isGit,
    },
    deliveryMode: deriveDeliveryMode(isGit, remoteUrl),
    references: [],
    resourcePaths: old.resourcePaths ?? [],
    // Keep old fields for backward compat
    workingDirectory: old.workingDirectory,
    sourceDirectory: old.sourceDirectory,
    repository: old.repository,
  }
}
```

---

## 9. Revised Project Creation Flow

### 9.1 Frontend Form (project-new.tsx)

**Step 1: Project basics**
```
┌─────────────────────────────────────────────────────┐
│  What are you building?                              │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Build a REST API for the inventory service      │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  Project directory                                   │
│  ┌─────────────────────────────────────────────────┐ │
│  │ /home/user/my-project                     [📁]  │ │
│  └─────────────────────────────────────────────────┘ │
│  ℹ️  Git repository detected. Remote: github.com:…  │
│                                                      │
│  Additional code for reference (optional)            │
│  ┌─────────────────────────────────────────────────┐ │
│  │ github.com/spec/openapi-spec              [+ ]  │ │
│  └─────────────────────────────────────────────────┘ │
│  ℹ️  Will be cloned as read-only reference           │
│                                                      │
│                               [Create Project →]     │
└─────────────────────────────────────────────────────┘
```

**Auto-detection feedback** (shown inline as user types the directory):

| Detection Result | Feedback Message |
|-----------------|------------------|
| Git + GitHub remote | "Git repository detected. PRs will go to github.com:user/repo." |
| Git + GitLab remote | "Git repository detected. Merge requests will go to gitlab.com:…" |
| Git + no remote | "Local git repository. Changes will be saved as branches." |
| Not git, dir exists | "This directory has no git history. [Initialize Git] recommended." |
| Dir doesn't exist | "Directory will be created with git initialized." |
| Dir is another project's source | "Also used by project 'X'. Each task runs on its own branch." |

### 9.2 Smart Resolution (server-side)

```typescript
async function resolveProjectSource(
  workingDir?: string,
  repoUrl?: string,
  existingProjects?: Project[]
): Promise<ResolvedSource> {

  // ── Phase 1: Detect what we have ──────────────────────

  const dirExists = workingDir ? existsSync(workingDir) : false
  const dirIsGit = dirExists ? isGitRepo(workingDir!) : false
  const dirRemote = dirIsGit ? getGitRemoteUrl(workingDir!) : undefined
  const dirGitRoot = dirIsGit ? getGitRoot(workingDir!) : undefined

  // ── Phase 2: Classify the repo URL ────────────────────

  let repoUrlRole: 'source' | 'reference' | 'redundant' | 'none' = 'none'

  if (repoUrl) {
    if (!dirIsGit) {
      repoUrlRole = 'source'        // No local git → clone the URL as source
    } else if (urlsMatchSameRepo(dirRemote, repoUrl)) {
      repoUrlRole = 'redundant'     // Same repo — ignore
    } else {
      repoUrlRole = 'reference'     // Different repo — treat as reference
    }
  }

  // ── Phase 3: Resolve source ───────────────────────────

  let source: ProjectSource
  let references: Reference[] = []

  if (dirIsGit) {
    // Working dir is already a git repo — use it as source
    const subdirectory = dirGitRoot !== workingDir
      ? relative(dirGitRoot!, workingDir!)
      : undefined

    source = {
      type: 'local-git',
      localPath: workingDir!,
      gitRoot: dirGitRoot,
      subdirectory,
      remoteUrl: dirRemote,
      remoteType: detectRemoteType(dirRemote ?? ''),
      baseBranch: await getDefaultBranch(dirGitRoot!),
      isGit: true,
    }
  } else if (repoUrlRole === 'source' && workingDir) {
    // Clone repo URL into working dir
    const repoName = extractRepoName(repoUrl!)
    const clonePath = join(workingDir, repoName)
    cloneRepo(repoUrl!, clonePath)

    source = {
      type: 'cloned-git',
      localPath: clonePath,
      gitRoot: clonePath,
      remoteUrl: repoUrl,
      remoteType: detectRemoteType(repoUrl!),
      baseBranch: await getDefaultBranch(clonePath),
      isGit: true,
    }
  } else if (workingDir && !dirExists) {
    // Create new directory with git
    mkdirSync(workingDir, { recursive: true })
    gitInit(workingDir)

    source = {
      type: 'local-git',
      localPath: workingDir,
      gitRoot: workingDir,
      remoteUrl: undefined,
      remoteType: 'none',
      baseBranch: 'main',
      isGit: true,
    }
  } else if (workingDir && dirExists && !dirIsGit) {
    // Existing non-git directory — return needsGitInit signal
    source = {
      type: 'local-dir',
      localPath: workingDir,
      remoteUrl: undefined,
      remoteType: 'none',
      baseBranch: 'main',
      isGit: false,
    }
  } else {
    throw new Error('Cannot resolve project source. Provide a directory or repository URL.')
  }

  // ── Phase 4: Handle reference repos ───────────────────

  if (repoUrlRole === 'reference') {
    const repoName = extractRepoName(repoUrl!)
    const refPath = join(source.localPath, '.astro-refs', repoName)
    cloneRepo(repoUrl!, refPath)

    references.push({
      id: `ref-${Date.now()}`,
      url: repoUrl!,
      localPath: refPath,
      purpose: 'Reference repository',
    })

    // Ensure .astro-refs/ is gitignored
    appendToGitignore(source.gitRoot ?? source.localPath, '.astro-refs/')
  }

  // ── Phase 5: Conflict check ───────────────────────────

  if (existingProjects) {
    const conflict = existingProjects.find(
      p => p.source?.localPath === source.localPath ||
           p.sourceDirectory === source.localPath ||
           p.workingDirectory === source.localPath
    )

    if (conflict && !source.isGit) {
      throw new Error(
        `Directory already used by project "${conflict.name}". ` +
        `Without git, parallel work causes file conflicts. ` +
        `Initialize git or use a different directory.`
      )
    }
    // If git: allow silently (worktrees provide isolation)
  }

  return { source, references, deliveryMode: deriveDeliveryMode(source) }
}
```

---

## 10. Execution Flow Changes

### 10.1 Worktree Creation (unchanged for git projects)

No changes needed. The current `createWorktree()` in `packages/agent-runner/src/lib/worktree.ts` already:
- Finds git root from the working directory
- Creates worktree at `{gitRoot}/.astro-tasks/{taskId}/`
- Preserves subdirectory offsets for monorepos
- Cleans up stale worktrees

### 10.2 Non-Git Execution (new path)

For `deliveryMode: 'direct'`, skip worktree creation entirely:

```typescript
// In task-executor.ts prepareTaskWorkspace()
if (!project.source.isGit) {
  // No worktree — work directly in source directory
  // Enforce serial execution (checked at dispatch time)
  return {
    workingDirectory: project.source.localPath,
    branchName: undefined,
    cleanup: async () => {},  // Nothing to clean up
  }
}
```

### 10.3 PR Creation (extended for non-GitHub)

```typescript
// In git-pr.ts
async function deliverResults(
  worktreePath: string,
  opts: DeliveryOptions
): Promise<DeliveryResult> {

  switch (opts.deliveryMode) {
    case 'pr':
      await autoCommitChanges(worktreePath, opts.taskTitle)
      await pushBranch(worktreePath, opts.branchName)
      return await createPRForProvider(worktreePath, opts)

    case 'push':
      await autoCommitChanges(worktreePath, opts.taskTitle)
      await pushBranch(worktreePath, opts.branchName)
      return { branchName: opts.branchName, pushed: true }

    case 'branch':
      await autoCommitChanges(worktreePath, opts.taskTitle)
      // Don't push — branch stays local
      return { branchName: opts.branchName, pushed: false }

    case 'direct':
      // Files already modified in-place. Nothing to deliver.
      return { direct: true }
  }
}

async function createPRForProvider(
  worktreePath: string,
  opts: DeliveryOptions
): Promise<DeliveryResult> {

  switch (opts.remoteType) {
    case 'github':
      if (await isCliAvailable('gh')) {
        return ghPrCreate(worktreePath, opts)
      }
      // Fallback: just push, user creates PR in browser
      return { branchName: opts.branchName, pushed: true }

    case 'gitlab':
      if (await isCliAvailable('glab')) {
        return glabMrCreate(worktreePath, opts)
      }
      // git push with -o merge_request.create (GitLab push option)
      return gitPushWithMROption(worktreePath, opts)

    case 'bitbucket':
      // Use Bitbucket REST API
      return bitbucketPrCreate(worktreePath, opts)

    case 'generic':
    default:
      // Unknown forge — just push
      return { branchName: opts.branchName, pushed: true }
  }
}
```

---

## 11. Implementation Plan

### Phase 1: Data Model (types + migration)

**Files:**
- `src/types/index.ts` — Add `ProjectSource`, `Reference`, `DeliveryMode` types. Add `source`, `references`, `deliveryMode` to `Project`.
- `server/lib/db/schema.ts` — Add `source` (jsonb), `references` (jsonb), `delivery_mode` (text) columns to `projects` table.
- `supabase/migrations/` — Add migration for new columns.
- `src/stores/project-store.ts` — Migration function for existing projects.

### Phase 2: Project Creation Form

**Files:**
- `src/pages/project-new.tsx` — Replace flat `workingDir` + `repoUrl` fields with the smart detection flow. Add inline detection feedback. Handle reference repo URL separately.
- `src/hooks/use-repo-setup.ts` — Call new `resolveProjectSource()` endpoint. Handle `references` in response.
- `server/lib/repo-setup.ts` — Rewrite `setupProjectRepo()` to use `resolveProjectSource()` logic. Add reference repo cloning. Add conflict detection.
- `server/lib/git-url-utils.ts` — Add `urlsMatchSameRepo()` and `detectRemoteType()`.

### Phase 3: Delivery Mode + PR Provider Abstraction

**Files:**
- `packages/agent-runner/src/lib/git-pr.ts` — Refactor `pushAndCreatePR()` into `deliverResults()` with delivery mode dispatch. Add GitLab and generic support.
- `packages/agent-runner/src/lib/task-executor.ts` — Pass `deliveryMode` and `remoteType` to `deliverResults()`. Handle `direct` mode (no worktree).
- `server/routes/dispatch.ts` — Include `deliveryMode` and `remoteType` in task dispatch payload.
- `server/types/relay.ts` — Add `deliveryMode` and `remoteType` to `TaskDispatch`.

### Phase 4: Non-Git Safety

**Files:**
- `server/lib/dispatch/dispatch-queue.ts` — Enforce serial execution for non-git projects.
- `src/pages/project-new.tsx` — Warning UI for non-git directories.
- `packages/agent-runner/src/lib/task-executor.ts` — Skip worktree for non-git, validate serial constraint.

### Phase 5: Reference Repos

**Files:**
- `server/lib/repo-setup.ts` — Clone reference repos into `.astro-refs/`.
- `server/lib/dispatch/context-assembler.ts` — Inject reference repo paths into agent prompt.
- `packages/agent-runner/src/lib/prompt-templates.ts` — Add reference repo context section.
- `src/pages/project-new.tsx` — "Add reference repo" UI (multi-input).

### Phase 6: Frontend Display

**Files:**
- `src/pages/task-detail.tsx` — Show delivery result based on mode ("View PR" / "View Branch" / "Changes Applied").
- `src/components/plan-graph/task-node.tsx` — Status badge varies by delivery mode.
- `src/pages/project-overview.tsx` — Show source config, detected remote type, delivery mode.

---

## 12. Corner Case Matrix

| Working Dir | Repo URL | Dir is Git? | Remote matches URL? | Action | Delivery |
|------------|----------|------------|---------------------|--------|----------|
| `/path/` | _(empty)_ | Yes, has remote | N/A | Use as-is | `pr` |
| `/path/` | _(empty)_ | Yes, no remote | N/A | Use as-is | `branch` |
| `/path/` | _(empty)_ | No | N/A | Prompt git init | `branch` or `direct` |
| `/path/` | `url` | Yes | Yes (same repo) | Ignore URL (redundant) | `pr` |
| `/path/` | `url` | Yes | No (different) | URL → reference | `pr` (to dir's remote) |
| `/path/` | `url` | No | N/A | Clone URL into dir | `pr` |
| _(empty)_ | `url` | N/A | N/A | Prompt for dir, clone | `pr` |
| _(empty)_ | _(empty)_ | N/A | N/A | Create in ~/.astro/projects/ | `branch` |
| `/mono/pkg/` | _(empty)_ | Yes (root=/mono/) | N/A | subdirectory=pkg/ | `pr` |

---

## 13. Open Questions

1. **Should we support adding a remote to a local-only git repo from the UI?** E.g., user starts local-only, then later wants to push to GitHub. This would change deliveryMode from `branch` to `pr`.

2. **Reference repo freshness.** Should reference repos auto-pull periodically? Or only on project creation? Stale references could cause agents to use outdated specs.

3. **Multiple source repos.** Some users may want agents to work across two repos simultaneously (e.g., frontend + backend). The current model assumes one source repo per project. Multi-repo orchestration is significantly harder (multiple worktrees, multiple PRs per task). Defer to v2?

4. **Large repo optimization.** For very large repos (Linux kernel, monorepos with 100K+ files), `git worktree add` is fast but `git ls-files` for the file tree cache can be slow. Consider shallow worktrees (`--depth 1`) or sparse checkout.

5. **Conflict resolution when branches diverge.** If task A and task B both branch from `main`, and task A merges first, task B's branch may have conflicts. Should the agent auto-rebase, or should the user handle this?

---

## 14. Testing Checklist

- [ ] Create project with local git dir + GitHub remote → verify PR creation
- [ ] Create project with local git dir + no remote → verify branch-only mode
- [ ] Create project with non-git dir → verify git init prompt, serial constraint
- [ ] Create project with repo URL + working dir → verify clone
- [ ] Create project where working dir and repo URL are different repos → verify reference handling
- [ ] Create two projects with same git dir → verify both work (worktree isolation)
- [ ] Create two projects with same non-git dir → verify second is blocked
- [ ] Create project with monorepo subdirectory → verify subdirectory preserved in worktree
- [ ] Create project with GitLab remote → verify MR creation (or push fallback)
- [ ] Dispatch task on non-git project with existing active task → verify serial constraint
- [ ] Verify `.astro-refs/` and `.astro-tasks/` are auto-gitignored
