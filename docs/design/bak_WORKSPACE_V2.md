# Workspace V2 — Claude Code-Aligned Execution Model

> **Status: PARTIALLY IMPLEMENTED** — ProjectSource types, directory detection, and delivery mode derivation exist. Full workspace model (`.astro/` agent dir, worktree strategies) not yet implemented.
>
> Supersedes: `PROJECT_WORKSPACE_DESIGN.md` (commit f5ace51) and `docs/relay/workspace-preparation.md`.

---

## 1. Motivation

The current workspace implementation (commit f5ace51) introduced structured `ProjectSource`, delivery modes, reference repos, and a unified creation form. It works, but it diverges from how Claude Code (the CLI and Desktop app) manages workspaces. Since Astro dispatches tasks *to* Claude Code (and similar agents), aligning the workspace model with Claude Code's own conventions eliminates impedance mismatch and reduces platform-side complexity.

### What Claude Code does

1. User provides a **working directory** (the project root).
2. If `.git/` exists, Claude Code recognizes the upstream remote and enables PR workflows.
3. Claude Code creates **`.claude/`** inside the project root — a single directory for all agent state.
4. Worktrees live at **`.claude/worktrees/<name>/`**, branching from the default remote branch.
5. `.claude/worktrees/` is gitignored. Other parts of `.claude/` (settings, agents, rules) are committed.
6. The worktree location and branch prefix are **configurable** in settings.
7. CLAUDE.md and `.claude/` configs from the project root are **respected inside worktrees**.
8. For non-git VCS, users provide `WorktreeCreate`/`WorktreeRemove` hooks.

**Sources:**
- [Claude Code Desktop — Work in parallel with sessions](https://code.claude.com/docs/en/desktop#work-in-parallel-with-sessions)
- [Claude Code Common Workflows — Git worktrees](https://code.claude.com/docs/en/common-workflows#run-parallel-claude-code-sessions-with-git-worktrees)

### Where the current implementation diverges

| Aspect | Current (f5ace51) | Claude Code |
|--------|-------------------|-------------|
| Worktree location | `.astro-tasks/{taskId}/` | `.claude/worktrees/{name}/` |
| Reference repos | `.astro-refs/{name}/` (eager clone) | None — agent clones if needed |
| Agent config dir | None | `.claude/` |
| Config in project | None | `.claude/settings.json`, `.claude/agents/`, etc. |
| Git URL validation | GitHub-only | Any git URL |
| Non-git handling | Raw in-place, serial only | Agent dir still created |
| Form complexity | 859 lines, many upfront options | Directory input, auto-detect everything |

---

## 2. Design Principles

1. **The user provides a working directory. That's it.** Everything else is auto-detected or configured later. Both a software engineer with a GitHub monorepo and a scientist with a data folder should have the same entry point.

2. **One agent directory, configurable name.** Default: `.astro`. Configurable per-project to `.claude`, `.agent`, `.codex`, or any name. All agent state (worktrees, config, ephemeral data) lives under this single directory.

3. **Respect Claude Code conventions.** Worktrees at `{agentDir}/worktrees/`, branch prefix configurable, CLAUDE.md inherited. If the agent dir is `.claude`, the layout is byte-for-byte compatible with Claude Code Desktop.

4. **Drop reference repos from the platform.** Agents are better positioned to decide if/when/how to clone external code. The user describes what they need in the project description or task description. The agent acts on it.

5. **Non-invasive defaults.** Git projects use worktree isolation by default (this is how git works). Non-git projects default to **direct in-place** — the agent works in the user's directory with no copy overhead. Users who want isolation can opt in to copy-to-worktree. We don't impose workflow on users.

---

## 3. Agent Directory Layout

```
/home/user/my-project/                  # user's working directory
├── .astro/                              # agent dir (configurable name)
│   ├── config.json                      # project workspace config
│   ├── worktrees/                       # execution worktrees (gitignored)
│   │   ├── task-abc123/                 # git worktree or directory copy
│   │   └── task-def456/
│   └── cache/                           # ephemeral caches (gitignored)
├── CLAUDE.md                            # agent instructions (user-managed)
├── src/
└── package.json
```

### 3.1 `config.json`

Persists workspace settings that the platform needs across sessions. Minimal schema:

```jsonc
{
  // Auto-detected, user can override
  "baseBranch": "main",
  "branchPrefix": "astro/",

  // Derived from remote detection
  "remoteType": "github",       // github | gitlab | bitbucket | generic | none
  "deliveryMode": "pr",         // pr | push | branch | copy

  // Optional overrides
  "worktreeLocation": null      // null = default ({agentDir}/worktrees/)
}
```

This file is committed by default (not gitignored). Users who want to keep it personal can add it to `.gitignore` themselves. The platform reads it at dispatch time and writes it during project setup.

### 3.2 Gitignore entries

When the agent dir is created inside a git repo, add to `.gitignore`:

```gitignore
.astro/worktrees/
.astro/cache/
```

For non-git directories, no gitignore needed (no git to ignore from).

### 3.3 `.claude/` compatibility

If the user sets the agent dir to `.claude`:

- `.claude/worktrees/` — used by both Astro and Claude Code Desktop (same convention)
- `.claude/settings.json`, `.claude/agents/`, `.claude/rules/` — Claude Code's own configs, untouched by Astro
- `.claude/config.json` — Astro-specific, coexists without conflict
- CLAUDE.md at project root — respected by both

This means a user can use Claude Code Desktop for interactive work and Astro for planned task dispatch on the same project, sharing the same worktree directory.

---

## 4. Project Creation Flow

### 4.1 User input

The creation form collects exactly two things:

```
┌────────────────────────────────────────────────────┐
│  What are you working on?                           │
│  ┌────────────────────────────────────────────────┐ │
│  │ Build a REST API for the inventory service     │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  Project directory                                  │
│  ┌────────────────────────────────────────────────┐ │
│  │ ~/.astro/projects/a1b2c3d4/              [📁]  │ │
│  └────────────────────────────────────────────────┘ │
│  ℹ️  Default location. Change to use an existing    │
│     directory.                                      │
│                                                     │
│              [Create & Generate Plan]  [Create]     │
└────────────────────────────────────────────────────┘
```

**That's the entire form.** No repo URL field. No reference repos field. No environment selector upfront. Everything else is auto-detected or configurable after creation in project settings.

The directory field **defaults to `~/.astro/projects/{id}/`** and is shown explicitly so the user can see and change it. If they paste an existing directory path, detection kicks in automatically.

### 4.2 Detection (existing `/api/repo/detect` — simplified)

As the user types a directory path, the existing debounced detection probe runs:

```
GET /api/repo/detect?path=/home/user/my-project
```

Returns:
```json
{
  "exists": true,
  "isGit": true,
  "remoteUrl": "git@github.com:user/repo.git",
  "remoteType": "github",
  "baseBranch": "main",
  "suggestedDeliveryMode": "pr",
  "dirSizeMB": null
}
```

For non-git directories, the response also includes `dirSizeMB` (used for copy-to-worktree size warnings):

```json
{
  "exists": true,
  "isGit": false,
  "remoteType": "none",
  "suggestedDeliveryMode": "direct",
  "dirSizeMB": 120
}
```

Inline feedback shown below the input:

| Detection | Feedback |
|-----------|----------|
| Git + GitHub/GitLab remote | "Git repo · github.com:user/repo · PRs enabled" |
| Git + generic remote | "Git repo · remote detected · branch push mode" |
| Git + no remote | "Local git repo · changes saved as branches" |
| Exists, not git, < 1 GB | "No git · agent works directly in this folder · ☐ Copy files before each task · [Init Git]" |
| Exists, not git, >= 1 GB | "No git · agent works directly in this folder · ☐ Copy files (⚠ {X} GB) · ☐ Use as reference · [Init Git]" |
| Doesn't exist | "Directory will be created · ☐ Initialize git · ☐ Copy files before each task" |
| Default (~/.astro/projects/) | "Default location · ☐ Initialize git · ☐ Copy files before each task" |

When the user clicks **[Use as reference]** for large directories, the original directory becomes read-only context. An empty worktree is created for each task, and the agent receives a file map of the original directory in its prompt. See §5.3b.

### 4.3 Setup (server-side)

`POST /api/repo/setup` does:

1. **Resolve directory** — create if needed, or validate existing.
2. **Create agent dir** — `{workingDir}/{agentDirName}/` with `config.json`.
3. **Update .gitignore** — add `{agentDirName}/worktrees/` and `{agentDirName}/cache/` (git repos only).
4. **Read key files** — CLAUDE.md, README.md, package.json (for plan generation context).
5. **Return** — working directory, detection results, key files.

No cloning. No reference repos. No git init unless user explicitly opts in (checkbox or [Init Git] button).

### 4.4 What about repo URL input?

Removed from the creation form. If a user wants to work on a remote repo they haven't cloned yet, they clone it first (like they would with Claude Code: `git clone ... && cd repo && claude`).

---

## 5. Execution Model

### 5.1 Execution isolation model

| Project type | Default | Worktree creation | Parallel safe? |
|-------------|---------|-------------------|---------------|
| Git repo | **Worktree ON** | `git worktree add {agentDir}/worktrees/{taskId} -b {prefix}{taskId}` | Yes |
| Non-git (default) | **Direct in-place** | None — agent works in original directory | **No** (serial only) |
| Non-git, copy opt-in | User checks box | `cp -r {workingDir} {agentDir}/worktrees/{taskId}/` (respects `.gitignore`) | Yes |
| Non-git, reference opt-in | User checks box | Empty `{agentDir}/worktrees/{taskId}/` + file map injected | Yes |

Key principle: **Git projects get worktree isolation by default because that's how git works.** Non-git projects default to direct in-place because we don't impose workflow on users. Users who want isolation opt in explicitly.

### 5.2 Git projects (worktree isolation)

```
Dispatch task "Add user auth" on project /home/user/my-project/

1. Create worktree:
   git worktree add .astro/worktrees/task-{nodeId} -b astro/task-{nodeId}

2. Agent runs in:
   /home/user/my-project/.astro/worktrees/task-{nodeId}/

3. Agent inherits from project root:
   - CLAUDE.md (agent instructions)
   - .claude/ configs (if agent dir is .claude)

4. On completion, delivery based on mode:
   - pr:     push branch + create PR (gh/glab/API)
   - push:   push branch (user creates PR manually)
   - branch: commit locally (user merges manually)

5. Cleanup:
   - Success + PR merged → remove worktree
   - Success + PR open → keep worktree
   - Failure → keep worktree for debugging
```

### 5.3 Non-git projects

Non-git directories default to **direct in-place** — the agent works in the user's directory with no overhead. Users can opt in to isolation via checkboxes:

| Strategy | Default? | How it works | When to use |
|----------|----------|-------------|-------------|
| **Direct (in-place)** | **Yes** | Agent works in original directory | Default, zero overhead |
| **Copy to worktree** | No (opt-in) | `cp -r` into `{agentDir}/worktrees/{taskId}/` | User wants isolation or parallel tasks |
| **Reference folder** | No (opt-in) | Empty worktree + file map injected | Large dirs where copy is impractical |

The detection feedback shows unchecked options:

```
/home/user/scripts/  (200 MB, no git)
☐ Copy files before each task (enables parallel tasks, uses disk space)
  [Init Git] for branch isolation
```

For large directories, a reference option also appears:

```
/home/user/big-data/  (15 GB, no git)
☐ Copy files before each task (⚠ 15 GB per task)
☐ Use as reference folder (agent reads files, writes to clean workspace)
  [Init Git] for branch isolation
```

The choice is recorded in `config.json` as `worktreeStrategy`:

```jsonc
{
  "deliveryMode": "direct",       // default for non-git; "copy" if user checks copy box
  "worktreeStrategy": "direct",   // "direct" | "copy" | "reference"
  "referenceDir": null             // set to original dir path when strategy=reference
}
```

#### 5.3a Direct in-place (default)

```
Dispatch task "Run analysis" on project /home/user/scripts/

1. Agent works directly in /home/user/scripts/

2. Serial constraint enforced:
   - Only ONE active task at a time (no isolation = no parallel safety)
   - Second dispatch returns 409

3. On completion:
   - Files modified in-place, no undo
```

This is the default — zero overhead, no ceremony. The agent works where the user's files are.

#### 5.3b Copy-to-worktree (opt-in via checkbox)

```
Dispatch task "Fix preprocessing script" on project /home/user/scripts/ (200 MB)

1. Determine exclusions:
   - If .gitignore exists in project dir → use it as copy exclusion list
   - Otherwise → copy everything (skip individual files > configured size limit)

2. Create worktree (copy):
   cp -r /home/user/scripts/ .astro/worktrees/task-{nodeId}/
   (excluding .astro/ itself + .gitignore patterns)

3. Agent runs in:
   /home/user/scripts/.astro/worktrees/task-{nodeId}/

4. On completion (delivery mode = "copy"):
   - Generate diff between worktree and original directory
   - Present diff to user for review
   - User approves → apply changes back to original directory

5. Cleanup:
   - After changes applied (or rejected) → remove worktree copy
   - Failure → keep worktree for inspection
```

#### 5.3c Reference folder + empty worktree (large directories)

```
Dispatch task "Analyze RNA-seq data" on project /home/user/big-data/ (15 GB)

1. Create empty worktree:
   mkdir -p .astro/worktrees/task-{nodeId}/

2. Generate file map of the original directory:
   - List all files with paths and sizes
   - Classify: code files (< 1 MB) vs. data files (>= 1 MB)

3. Inject into agent prompt:
   ## Reference Directory

   Your project directory at /home/user/big-data/ is available as a
   READ-ONLY reference. Do not modify files there directly.

   File map:
     data/patients.csv          (800 MB)  — data file
     data/controls.csv          (600 MB)  — data file
     data/metadata.json         (12 KB)   — data file
     scripts/preprocess.py      (2 KB)    — code file
     scripts/analyze.R          (4 KB)    — code file
     models/trained_model.pkl   (1.2 GB)  — data file
     results/                   (empty)

   Use absolute paths to READ files from the reference directory.
   Write all new or modified files in your working directory.

4. Agent runs in:
   /home/user/big-data/.astro/worktrees/task-{nodeId}/   (starts empty)

5. Agent reads from /home/user/big-data/scripts/preprocess.py (absolute path)
   Agent writes modified version to ./scripts/preprocess.py (in worktree)
   Agent writes new files to ./results/output.csv (in worktree)

6. On completion (delivery mode = "copy"):
   - Show user what files were created/modified in the worktree
   - User approves → files copied back to original directory
   - New files added, modified files overwrite originals

7. Cleanup:
   - Remove worktree after apply
```

This is the natural workflow for scientists with large data directories: the data stays in place, the agent reads it via absolute paths, and only new/modified code files are written to the worktree. The file map gives the agent enough context to navigate the directory without needing a full copy.

The `referenceDir` field in `config.json` records this choice:

```jsonc
{
  "deliveryMode": "copy",
  "referenceDir": "/home/user/big-data/",  // set when user chose "reference folder"
  "referenceFileMap": true                   // inject file map into agent prompt
}
```

### 5.4 Monorepo support

When the user's project directory is a subdirectory of a git root:

```
Project directory: /home/user/monorepo/packages/api/
Git root:          /home/user/monorepo/

1. Worktree is created at the git root level:
   git worktree add /home/user/monorepo/.astro/worktrees/task-{nodeId}

2. Agent is told to work in the subdirectory:
   Agent prompt: "Your working directory is packages/api/ within the worktree."
   CWD set to: /home/user/monorepo/.astro/worktrees/task-{nodeId}/packages/api/

3. Agent dir lives at the project directory (not git root):
   /home/user/monorepo/packages/api/.astro/config.json
   (subdirectory: "packages/api/" recorded here)

4. Worktrees still live at the git root:
   /home/user/monorepo/.astro/worktrees/
   (because git worktrees must branch from the root)
```

### 5.5 Delivery modes

| Source State | Delivery Mode | How worktree is created | How results are delivered |
|-------------|---------------|------------------------|--------------------------|
| Git + GitHub/GitLab/Bitbucket | `pr` | `git worktree add` | Push branch + create PR/MR |
| Git + generic remote | `push` | `git worktree add` | Push branch (user creates PR) |
| Git + no remote | `branch` | `git worktree add` | Local branch (user merges) |
| Non-git, copy enabled | `copy` | `cp -r` (excluding agent dir) | Diff review + apply back |
| Non-git, reference mode | `copy` | `mkdir` (empty worktree) | Show new/modified files + apply back |
| Non-git, direct (no copy) | `direct` | None (agent works in-place) | Files modified directly, no undo |

Note: `direct` is retained (not removed as originally planned) for users who explicitly opt out of copy isolation. It is only available when the user unchecks the copy checkbox for non-git directories. Serial execution is enforced in this mode.

---

## 6. Scenario Matrix

Every combination of directory state and user action:

| # | Directory state | What happens | Worktree method | Delivery mode |
|---|----------------|--------------|-----------------|---------------|
| A | Git + remote (GitHub/GitLab/etc.) | Use as-is, worktree isolation default ON | `git worktree add` | `pr` |
| B | Git + no remote | Use as-is, worktree isolation default ON | `git worktree add` | `branch` |
| C | Exists, not git, user clicks [Init Git] | `git init` + smart `.gitignore` + initial commit → becomes scenario B | `git worktree add` | `branch` |
| D | Exists, not git, defaults (no checkboxes) | Agent works directly in directory (serial only) | None | `direct` |
| E | Exists, not git, user checks "Copy" | Copy directory into worktree (respects `.gitignore` for exclusions) | `cp -r` | `copy` |
| F | Exists, not git, >= 1 GB, user checks "Reference" | Empty worktree + file map injected | `mkdir` (empty) | `copy` |
| G | Doesn't exist (no git opt-in) | Create empty directory, direct mode | None | `direct` |
| H | Doesn't exist + user checks "Init git" | Create directory + `git init` + `.gitignore` + initial commit | `git worktree add` | `branch` |
| I | Empty (no directory given, no git opt-in) | Default to `~/.astro/projects/{id}/`, create empty dir | None | `direct` |
| J | Empty + user checks "Init git" | Default to `~/.astro/projects/{id}/`, create + git init | `git worktree add` | `branch` |
| K | Monorepo subdirectory (git) | Detect git root. Worktree at root, agent CWD at subdirectory | `git worktree add` | Depends on remote |

### Directory conflict: same directory, multiple projects

| Conflict type | Behavior |
|--------------|----------|
| Two git projects share same directory | **Allowed.** Worktrees provide isolation. Info note: "Also used by project X." |
| Two non-git projects (copy mode) share same directory | **Allowed.** Copy-to-worktree provides isolation. |
| Two non-git projects (direct mode) share same directory | **Allowed but risky.** Serial constraint per-project, but two projects could run tasks concurrently on the same files. Info note: "⚠ Also used by project X — direct mode, concurrent edits possible." |
| Git project + non-git project on same dir | Cannot happen — directory is either git or not. |

---

## 7. What Gets Removed

### 7.1 Reference repos (entire feature)

**Remove:**
- `referenceUrls` field from project creation form
- `cloneReferenceUrls()` from `repo-setup.ts`
- `.astro-refs/` directory convention and gitignore handling
- `ProjectReference` type from `types/index.ts`
- `references` field from `Project`, dispatch schema, relay types
- Reference injection in `dispatch.ts` agent prompt
- Reference URL UI in `project-new.tsx`

**Rationale:** Agents can clone repos themselves when mentioned in task/project descriptions. This is more flexible (agent decides when, what depth, sparse checkout, freshness) and requires zero platform infrastructure.

### 7.2 GitHub-only URL validation

**Remove:**
- `validateGitUrl()` in `git-url-utils.ts` (GitHub-only regex)

**Replace with:**
- Generic git URL validation that accepts SSH (`git@host:path`), HTTPS (`https://host/path`), and `ssh://` formats for any host.

### 7.3 Scattered dot-directories

**Remove:**
- `.astro-tasks/` hardcoded path in worktree creation
- `.astro-refs/` hardcoded path in repo setup

**Replace with:**
- `{agentDir}/worktrees/` (configurable)

### 7.4 Serial execution constraint (partially removed)

**Remove:**
- `serialOnly` field from config
- Blanket serial constraint on all non-git projects

**Keep:**
- Serial enforcement **only** for `direct` delivery mode (user unchecked copy → no isolation → no parallel safety)

**Rationale:** Copy-to-worktree and reference mode make parallel execution safe. Only direct in-place mode still needs serial enforcement.

### 7.5 `direct` delivery mode (retained)

**Keep** `direct` delivery mode in types and dispatch logic for when users explicitly opt out of copy isolation (unchecked checkbox). Serial execution is enforced in this mode.

**Note:** `direct` was originally planned for removal (replaced by `copy`), but user feedback determined that copy/backup should be opt-in, not mandatory. Users who trust the agent or want zero overhead can uncheck the copy checkbox.

---

## 8. What Gets Simplified

### 8.1 `ProjectSource` type

```typescript
// Before (v1)
interface ProjectSource {
  type: 'local-git' | 'cloned-git' | 'local-dir'
  localPath: string
  gitRoot?: string
  subdirectory?: string
  remoteUrl?: string
  remoteType: RemoteType
  baseBranch: string
  isGit: boolean
}

// After (v2)
interface ProjectSource {
  localPath: string          // absolute path on disk
  isGit: boolean
  remoteUrl?: string         // auto-detected from git remote
  remoteType: RemoteType     // auto-detected from URL
  baseBranch: string         // auto-detected, default 'main'
  subdirectory?: string      // monorepo support (path relative to git root)
}
```

Drop `type` — `isGit` covers the only distinction that matters.
Drop `gitRoot` — derivable at runtime via `git rev-parse --show-toplevel`.

### 8.2 `DeliveryMode` type

```typescript
// Before (v1)
type DeliveryMode = 'pr' | 'push' | 'branch' | 'direct'

// After (v2)
type DeliveryMode = 'pr' | 'push' | 'branch' | 'copy' | 'direct'
```

`copy` is added for non-git projects with copy-to-worktree or reference mode. `direct` is retained for non-git projects where the user opts out of copy isolation (serial execution enforced).

### 8.3 `Project` type

```typescript
interface Project {
  // ... existing fields ...

  // Workspace (v2)
  source?: ProjectSource           // auto-detected at creation
  deliveryMode?: DeliveryMode      // derived from source
  agentDir?: string                // default '.astro', configurable

  worktreeStrategy?: 'copy' | 'reference' | 'direct'  // non-git only

  // Removed
  // references?: ProjectReference[]  — dropped
  // repository?: string             — use source.remoteUrl
  // workingDirectory?: string       — use source.localPath
  // sourceDirectory?: string        — use source.localPath
}
```

### 8.4 Project creation form

From 859 lines to ~200 lines. Two inputs (description + directory with default), inline detection feedback, two buttons.

Advanced settings (environment, machine, agent dir name) move to a project settings page accessible after creation.

---

## 9. What Gets Added

### 9.1 Agent directory creation

New function in `repo-setup.ts`:

```typescript
function ensureAgentDir(
  workingDir: string,
  agentDirName: string = '.astro'
): string {
  const agentDir = join(workingDir, agentDirName)
  mkdirSync(agentDir, { recursive: true })

  // Write initial config
  const configPath = join(agentDir, 'config.json')
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify({
      baseBranch: 'main',
      branchPrefix: 'astro/',
    }, null, 2))
  }

  // Update .gitignore (git repos only)
  if (isGitRepo(workingDir)) {
    addToGitignore(workingDir, `${agentDirName}/worktrees/`)
    addToGitignore(workingDir, `${agentDirName}/cache/`)
  }

  return agentDir
}
```

### 9.2 Copy-to-worktree for non-git projects

New function in agent-runner:

```typescript
async function createCopyWorktree(
  sourceDir: string,
  agentDir: string,
  taskId: string
): Promise<{ workingDirectory: string; cleanup: () => Promise<void> }> {
  const worktreePath = join(sourceDir, agentDir, 'worktrees', taskId)

  // Build exclusion list:
  // 1. Always exclude the agent dir itself
  // 2. If .gitignore exists, parse it and use as exclusion patterns
  // 3. Skip individual files larger than a configured threshold
  const exclude = [agentDir]
  const gitignorePath = join(sourceDir, '.gitignore')
  if (existsSync(gitignorePath)) {
    const patterns = parseGitignore(readFileSync(gitignorePath, 'utf-8'))
    exclude.push(...patterns)
  }

  // Copy (respecting exclusion list)
  await copyDirectory(sourceDir, worktreePath, { exclude })

  return {
    workingDirectory: worktreePath,
    cleanup: async () => {
      await rm(worktreePath, { recursive: true, force: true })
    },
  }
}
```

### 9.3 Diff-and-apply for copy delivery

After task completion with `copy` delivery mode:

```typescript
async function applyCopyResults(
  originalDir: string,
  worktreeDir: string,
  agentDir: string
): Promise<{ diff: string; filesChanged: string[] }> {
  // Generate unified diff between original and worktree
  // (excluding agent dir from comparison)
  const diff = await generateDiff(originalDir, worktreeDir, { exclude: [agentDir] })
  const filesChanged = parseDiffFileList(diff)

  return { diff, filesChanged }
}

// Apply approved changes back to original directory
async function applyChangesBack(
  originalDir: string,
  worktreeDir: string,
  agentDir: string
): Promise<void> {
  // Sync changed files from worktree back to original
  await syncFiles(worktreeDir, originalDir, { exclude: [agentDir] })
}
```

### 9.4 Generic git URL validation

Replace GitHub-only `validateGitUrl()`:

```typescript
function validateGitUrl(url: string): GitUrlValidation {
  const trimmed = url.trim()

  // SSH: git@host:path or ssh://user@host/path
  if (/^git@[^:]+:.+/.test(trimmed) || /^ssh:\/\/.+/.test(trimmed)) {
    return { isValid: true, url: trimmed }
  }

  // HTTPS: https://host/path
  if (/^https?:\/\/.+\/.+/.test(trimmed)) {
    return { isValid: true, url: trimmed }
  }

  return { isValid: false, error: 'Expected git URL (SSH or HTTPS)' }
}
```

### 9.5 Worktree path update in agent-runner

Update `createWorktree()` in `packages/agent-runner/src/lib/worktree.ts`:

```typescript
// Before
const worktreePath = join(gitRoot, '.astro-tasks', taskId)

// After
const agentDir = task.agentDir ?? '.astro'
const worktreePath = join(gitRoot, agentDir, 'worktrees', taskId)
```

### 9.6 Directory size in detection endpoint

Extend `/api/repo/detect` response for non-git directories:

```typescript
// In repo.ts detect handler, after isGit=false case:
if (!isGit) {
  const sizeMB = getDirectorySizeMB(dirPath)
  return c.json({
    exists: true,
    isGit: false,
    remoteType: 'none',
    suggestedDeliveryMode: 'direct',
    dirSizeMB: sizeMB,
  })
}
```

---

## 10. Coder vs. Non-Coder Workflows

### Software engineer (coder)

```
1. Has a GitHub repo cloned locally
2. Creates project: types description, pastes /home/user/my-project/
3. Detection: "Git repo · github.com:user/repo · PRs enabled"
4. Clicks [Create & Generate Plan]
5. AI generates plan → tasks dispatched → git worktrees created → PRs opened
6. Reviews PRs in GitHub, merges
```

### Scientist (non-coder)

```
1. Has a folder of scripts and data
2. Creates project: types "Analyze patient cohort RNA-seq data", pastes directory
3. Detection: "No git · agent works directly in this folder · ☐ Copy · [Init Git]"
4. Proceeds with defaults (direct mode) — OR opts in to copy/git
5. Clicks [Create & Generate Plan]
6. AI generates analysis plan → tasks run directly in the folder (serial)
   OR if copy was checked → tasks run on copies (parallel possible)
7. If they mentioned "use the pipeline at github.com/lab/rnaseq-pipeline"
   in the description, the agent clones it during execution
```

### Planner (no code, coordination only)

```
1. Wants to plan a multi-team initiative without a codebase
2. Creates project: types description, leaves directory as default
3. Default: ~/.astro/projects/{id}/ created (plain directory, no git)
4. Uses Astro for planning, task decomposition, dependency management
5. Tasks are descriptions/specs only, not executed
```

All three paths go through the same form. The difference is entirely in what's auto-detected.

---

## 11. Migration

**Starting from scratch.** No migration from v1 (`PROJECT_WORKSPACE_DESIGN.md`). The v1 implementation (commit f5ace51) is being replaced, not evolved. Old `.astro-tasks/` and `.astro-refs/` directories are irrelevant — they can be deleted manually by users if they exist.

Legacy `Project` fields (`workingDirectory`, `sourceDirectory`, `repository`) remain readable for backward compatibility but are not written by new code. New code reads `project.source?.localPath` and `project.source?.remoteUrl`.

---

## 12. Implementation Plan

### Phase 1: Simplify types + drop references

- Remove `ProjectReference`, `references` from types
- Remove `referenceUrls` from dispatch schema and relay types
- Remove reference cloning from `repo-setup.ts`
- Remove reference injection from `dispatch.ts`
- Simplify `ProjectSource` type (drop `type`, `gitRoot`)
- Replace `direct` with `copy` in `DeliveryMode`

### Phase 2: Agent directory

- Add `ensureAgentDir()` to `repo-setup.ts`
- Add `agentDir` field to `Project` type (default `.astro`)
- Update `setupProjectRepo()` to create agent dir
- Update `.gitignore` handling

### Phase 3: Worktree path migration

- Update `createWorktree()` in agent-runner to use `{agentDir}/worktrees/`
- Update `branchPrefix` from config.json
- Keep `.astro-tasks/` cleanup for existing worktrees

### Phase 4: Copy-to-worktree for non-git

- Implement `createCopyWorktree()` in agent-runner
- Add directory size check to `/api/repo/detect`
- Implement diff-and-apply flow for `copy` delivery mode
- Implement reference folder mode (empty worktree + file map injection)
- Narrow serial constraint to `direct` mode only (copy/reference modes are parallel-safe)

### Phase 5: Fix URL validation

- Replace GitHub-only `validateGitUrl()` with generic git URL validation
- Keep `detectRemoteType()` unchanged (already supports all forges)

### Phase 6: Simplify creation form

- Strip `project-new.tsx` to description + directory (with default) + detection feedback
- Remove repo URL input, reference URLs, upfront environment selector
- Default directory shown as `~/.astro/projects/{id}/`
- Move advanced settings to project settings page
- Add "Clone a repository" progressive disclosure

### Phase 7: Config persistence

- Write/read `{agentDir}/config.json` during setup and dispatch
- Allow user to override `deliveryMode`, `branchPrefix` in project settings

### Phase 8: Monorepo support

- Detect git root vs. project directory mismatch
- Record `subdirectory` in `ProjectSource`
- Create worktrees at git root, set agent CWD to subdirectory
- Inject subdirectory hint into agent prompt

---

## 13. Testing Checklist

**Git projects:**
- [ ] Local git dir + GitHub remote → worktree in `.astro/worktrees/`, PR creation
- [ ] Local git dir + GitLab remote → MR creation or push fallback
- [ ] Local git dir + generic remote → branch pushed, no PR
- [ ] Local git dir + no remote → branch-only delivery, no push
- [ ] Monorepo subdirectory → worktree at git root, CWD at subdirectory

**Non-git projects (default = direct):**
- [ ] Non-git dir, defaults (no checkboxes) → direct in-place, serial enforced
- [ ] Non-git dir, direct mode, second dispatch → returns 409 (serial constraint)
- [ ] Non-git dir, copy checked → copy-to-worktree, diff-and-apply
- [ ] Non-git dir, copy checked, has `.gitignore` → copy excludes gitignored patterns
- [ ] Non-git dir, copy checked, no `.gitignore` → copies everything (skips oversized files)
- [ ] Non-git dir + click [Init Git] → becomes git project, worktree mode
- [ ] Parallel tasks on non-git project (copy mode) → parallel copies work

**Non-git projects (large, >= 1 GB):**
- [ ] Large dir + user picks "Copy anyway" → full copy with warning
- [ ] Large dir + user picks "Use as reference" → empty worktree, file map in prompt
- [ ] Large dir + user picks [Init Git] → git init with smart gitignore, becomes git project
- [ ] Reference mode: agent reads files via absolute paths from original dir
- [ ] Reference mode: agent writes new files to worktree
- [ ] Reference mode: apply-back copies worktree files to original dir

**Project creation:**
- [ ] No directory → default `~/.astro/projects/{id}/` shown and created
- [ ] Two projects sharing same git directory → both work (worktree isolation)
- [ ] Two projects sharing same non-git directory → both work (copy isolation)

**Agent directory:**
- [ ] `.astro/worktrees/` and `.astro/cache/` are gitignored
- [ ] CLAUDE.md from project root is accessible in worktree
- [ ] `config.json` is written at setup and read at dispatch
- [ ] Agent dir name configurable (set to `.claude`, verify Claude Code compatibility)

**Conflict handling:**
- [ ] Two non-git direct-mode projects on same dir → warning shown in UI

---

## 14. Decisions Made

| # | Question | Decision |
|---|----------|----------|
| 1 | Default agent dir name | `.astro` (avoids mixing with user's Claude Code `.claude/` dir) |
| 2 | Directory conflicts (same dir, 2 projects) | Allow for both git and non-git (worktree/copy isolation makes it safe) |
| 3 | Monorepo support | Worktree at git root + subdirectory hint in agent prompt |
| 4 | Non-git safety model | Copy-to-worktree (original files never touched during execution) |
| 5 | Non-git large directories (>= 1 GB) | User chooses: copy anyway, use as reference folder, or init git |
| 6 | No directory given | Default to `~/.astro/projects/{id}/`, shown explicitly in UI |
| 7 | Reference repos feature | Dropped — agent clones what it needs from task description |
| 8 | Git subdirectory detection | User handles it — point at the right directory |
| 9 | Serial execution constraint | Narrowed to `direct` mode only — copy/reference modes are parallel-safe |
| 10 | `direct` delivery mode | Retained as opt-out from copy isolation (user unchecks checkbox, serial enforced) |
| 11 | Non-git default behavior | Direct in-place (no copy, no worktree). Worktree isolation is opt-in. Non-invasive. |
| 12 | `config.json` commit policy | Committed by default (not gitignored). User adds to `.gitignore` themselves if wanted. |
| 13 | Copy-to-worktree exclusion list | Use project's `.gitignore` if present. Otherwise copy everything (skip oversized files). |
| 14 | `.astro-tasks/` migration | No migration — starting from scratch. Old directories are irrelevant. |
| 15 | Auto-apply for copy mode | No auto-apply. Always require user review. (Unless delivered as an artifact — future consideration.) |
| 16 | Clone helper in creation form | No. User clones repos themselves before creating a project. |
| 17 | Git init on new directories | No auto-init. User opts in via checkbox or [Init Git]. New dirs start as plain directories (direct mode). |

## 15. Open Questions

None. All questions resolved — see §14 Decisions Made.
