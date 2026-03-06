# Git Worktree — Isolation Logic and Corner Cases

> **Status: IMPLEMENTED** — Core worktree isolation in `packages/agent-runner/src/lib/worktree.ts` and workspace preparation in `packages/agent-runner/src/lib/task-executor.ts`. This document is the canonical reference for how the agent runner decides whether and how to create git worktrees for task execution.
>
> Related: `WORKSPACE_V2.md` (high-level workspace model), `AGENT_RUNNER.md` (adapter architecture).

**Last updated:** 2026-03-06

---

## 1. Why Worktrees?

When Astro dispatches a task to an agent (Claude Code, Codex, OpenClaw, OpenCode), the agent reads and writes files in a working directory. Without isolation:

- **Parallel tasks corrupt each other** — two agents editing the same file simultaneously
- **No clean diff** — can't tell what a specific task changed vs. pre-existing state
- **No PR creation** — need a branch with only this task's changes
- **User's files at risk** — agent errors can damage the user's working copy

Git worktrees solve all four: each task gets its own branch checked out in a separate directory. The original working directory is untouched.

---

## 2. Architecture

### Where worktrees live

```
{git-root}/
├── .git/
├── .astro/                        ← agent directory (configurable name)
│   └── worktrees/                 ← all worktrees for this repo
│       ├── {projectId}-{nodeId}/  ← one worktree per task
│       └── {projectId}-{nodeId2}/
├── src/                           ← user's tracked files
└── package.json
```

**Rule:** `worktree root = {git root}/{agentDir}/worktrees/`

The agent directory name defaults to `.astro` but is configurable per-project (can be `.claude`, `.codex`, etc.). The directory is automatically added to `.gitignore`.

If the git root is read-only, falls back to `~/.astro/worktrees/{repoName}/`.

### How the cwd is computed

When the working directory is a **subdirectory** of the git root (e.g., monorepo: `/repo/packages/my-app`), the worktree is still created at the repo root level (git worktrees are always full-repo checkouts). The agent's cwd is computed by appending the relative path:

```
git root:  /repo
workdir:   /repo/packages/my-app
relative:  packages/my-app

worktree:  /repo/.astro/worktrees/abc123/
agent cwd: /repo/.astro/worktrees/abc123/packages/my-app
```

### Branch naming

- **Project branch:** `astro/{shortProjectId}` — accumulates all task work via auto-merged PRs
- **Task branch:** `astro/{shortProjectId}-{shortNodeId}` — per-task worktree, branched from the project branch

Both prefixes are configurable via `.astro/config.json`.

---

## 3. Decision Tree

`prepareTaskWorkspace()` in `task-executor.ts` runs this sequence:

```
prepareTaskWorkspace(task)
│
│  ── Early exits (no git involved) ──
├─ task.useWorktree === false?         → DIRECT execution (user opted out)
├─ executor.useWorktree === false?     → DIRECT execution (executor disabled)
├─ task.deliveryMode === 'direct'?     → DIRECT execution (in-place)
├─ task.deliveryMode === 'copy'?       → COPY worktree (non-git isolation)
│
│  ── Git detection ──
├─ NOT inside any git repo?            → DIRECT execution
│   isGitRepo(): git rev-parse
│   --show-toplevel fails
│
├─ Untracked subdir of parent repo?    → BOOTSTRAP local git, then WORKTREE
│   isUntrackedInParentRepo():
│   git root ≠ workdir AND
│   git ls-files returns nothing
│
├─ Git repo with zero commits?         → BOOTSTRAP initial commit, then WORKTREE
│   repoHasCommits():
│   git rev-list --count HEAD == 0
│
└─ Normal git repo with commits        → WORKTREE (standard path)
    createWorktree()
```

### What each action means

| Action | What happens | Isolation? | PR possible? |
|--------|-------------|:----------:|:------------:|
| **DIRECT** | Agent works in the user's actual directory | No | No |
| **COPY** | Directory copied to `.astro/worktrees/`, no git | Yes | No |
| **BOOTSTRAP** | `git init` + `git add .` + `git commit` in workdir, then worktree | Yes | Local only |
| **WORKTREE** | `git worktree add -b <branch> <path> <start-point>` | Yes | Yes (if remote) |

---

## 4. Corner Cases

### Complete reference table

| # | Scenario | Example | `isGitRepo` | `isUntracked InParentRepo` | `hasCommits` | Action | Notes |
|---|----------|---------|:-----------:|:--------------------------:|:------------:|--------|-------|
| 1 | No git anywhere | `~/data/experiment/` with no `.git` in any ancestor | false | — | — | Direct | No isolation. Single-task safe. |
| 2 | Normal repo with remote | `~/projects/my-app/` with GitHub origin | true | false | true | Worktree | Happy path. PRs work. |
| 3 | Local-only repo (no remote) | `~/projects/local-app/` with `.git` but no origin | true | false | true | Worktree | Isolation works. Push/PR fails gracefully (non-fatal). |
| 4 | Fresh `git init`, no commits | `~/new-project/` after `git init` | true | false | false | Bootstrap → Worktree | Adds `.gitignore` + `CLAUDE.md` + initial commit. |
| 5 | `git init` + remote, no commits | `~/new-project/` after `git init && git remote add` | true | false | false | Bootstrap → Worktree | Same as #4, remote available for push after. |
| 6 | Tracked subdirectory (monorepo) | `/repo/packages/my-app/` where `packages/` is tracked | true | false | true | Worktree | cwd = worktree + relative path. All tracked files present. |
| 7 | **Untracked subdir of parent repo** | `/tmp/examples/physics/` where `/tmp/.git` exists but `examples/` is `??` | true | **true** | true | **Bootstrap local git** → Worktree | Creates `.git` inside `physics/`. Closest `.git` wins on subsequent calls. |
| 8 | Gitignored subdir of parent repo | `/repo/data/experiment/` where `data/` is in `.gitignore` | true | **true** | true | **Bootstrap local git** → Worktree | Same as #7 — `git ls-files` returns nothing for gitignored content. |
| 9 | Nested git repos | `/parent-repo/child-repo/` where both have `.git` | true | false | true | Worktree | Inner `.git` takes precedence. Worktree from child repo. |
| 10 | Git submodule | `/repo/packages/agent-runner/` as submodule | true | false | true | Worktree | Submodule has its own `.git` ref. Worktree from submodule root. |
| 11 | HOME (~) has stray `.git` | `~/projects/foo/` where `~/.git` exists accidentally | true | **true** | true | **Bootstrap local git** → Worktree | Prevents latching onto HOME's repo. |
| 12 | Mixed tracked + untracked subdir | `/repo/src/` has tracked `.ts` files + untracked `data/` | true | false | true | Worktree | Tracked files present in worktree. Untracked files missing. Agent sees partial content. |
| 13 | Read-only filesystem | `/mnt/readonly/project/` | varies | — | — | `initializeGit` or `git worktree add` fails → task error | Cannot create isolation on read-only FS. |
| 14 | User chose `deliveryMode: 'direct'` | Any directory | — | — | — | Direct | Explicit opt-out. No git checks performed. |
| 15 | User chose `deliveryMode: 'copy'` | Any directory | — | — | — | Copy worktree | Non-git isolation. Files copied to `.astro/worktrees/`. |

### Case 7 deep dive — the "stray parent .git" problem

This is the most subtle case. It happens when a user places their project folder inside a directory that **happens** to have a `.git` — often without knowing it.

**Before the fix:**
```
/tmp/                              ← git root (.git exists here)
├── .git/
├── .astro/worktrees/
│   └── abc123/                    ← worktree of /tmp repo
│       └── (no examples/ — untracked!)  ← ENOENT
└── examples/                      ← untracked (??)
    └── physics-of-llm/            ← user's project workdir
```

The worktree was created from the parent repo at `/tmp`, but the project directory `examples/` is untracked in that repo. The worktree doesn't contain it → agent spawn fails with ENOENT.

**After the fix:**
```
/tmp/                              ← parent git (ignored after detection)
├── .git/
└── examples/
    └── physics-of-llm/            ← git root (local .git bootstrapped)
        ├── .git/                  ← NEW — created by bootstrap
        ├── .astro/worktrees/
        │   └── abc123/            ← worktree of LOCAL repo
        │       ├── paper.pdf      ← all files present ✓
        │       └── ...
        ├── paper.pdf
        └── ...
```

Detection: `isUntrackedInParentRepo()` checks three conditions:
1. `git rev-parse --show-toplevel` finds a git root (parent repo exists)
2. The git root is a **different** directory than the workdir
3. `git ls-files <relative-path>` returns **nothing** (zero tracked files)

If all three are true, the workdir is treated as "not meaningfully part of that repo" and gets its own local git.

### Case 12 — mixed tracked/untracked

This case is NOT covered by the parent repo detection (because `git ls-files` returns the tracked files → `isUntrackedInParentRepo` returns false). The worktree contains the tracked files but not the untracked ones.

A safety net in `createWorktree()` (`worktree.ts`) handles the extreme case where the entire subdirectory doesn't exist in the worktree: it copies the source content via `fs.cp()`. However, this only triggers when the directory is completely absent — not when it exists with partial content.

**Accepted behavior:** Untracked files in a tracked subdirectory are not available in the worktree. This is standard git worktree behavior. Users who need all files should either track them or use `deliveryMode: 'copy'`.

---

## 5. Implementation Files

| File | Role |
|------|------|
| `packages/agent-runner/src/lib/task-executor.ts` | `prepareTaskWorkspace()` — decision tree, bootstrap logic |
| `packages/agent-runner/src/lib/worktree.ts` | `createWorktree()` — git worktree add, branch management, safety net copy |
| `packages/agent-runner/src/lib/workdir-safety.ts` | `isGitRepo()`, `isUntrackedInParentRepo()` — detection helpers |
| `packages/agent-runner/src/lib/copy-worktree.ts` | `createCopyWorktree()` — non-git directory copy isolation |
| `packages/agent-runner/src/lib/git-pr.ts` | `pushAndCreatePR()` — post-execution branch push and PR creation |
| `packages/agent-runner/src/lib/branch-lock.ts` | `BranchLockManager` — prevents concurrent worktree creation on same branch |
| `packages/agent-runner/src/lib/worktree-include.ts` | `applyWorktreeInclude()` — copies additional files into worktree |
| `packages/agent-runner/src/lib/worktree-setup.ts` | `runSetupScript()` — runs `.astro/setup.sh` in new worktree |

---

## 6. Worktree Lifecycle

```
Task dispatched
    │
    ▼
prepareTaskWorkspace()
    │ Detect git state, bootstrap if needed
    ▼
createWorktree()
    │ git worktree add -b <branch> <path> <startpoint>
    │ Init submodules, apply worktree-include, run setup script
    │ Copy CLAUDE.md if untracked
    ▼
Agent executes in worktree cwd
    │ Reads/writes files, runs commands
    │ All changes scoped to task branch
    ▼
Task completes
    │
    ├─ Success + PR delivery mode
    │   │ pushAndCreatePR() — push branch, open PR
    │   │ cleanup: remove worktree dir, keep branch
    │   ▼
    │   PR created on remote
    │
    ├─ Success + push/branch delivery
    │   │ Push branch to remote
    │   │ cleanup: remove worktree dir, keep branch
    │   ▼
    │   Branch available on remote
    │
    └─ Failure or direct delivery
        │ cleanup: remove worktree dir AND branch
        ▼
        Clean state restored
```

### Cleanup

After task completion, `cleanupWorktree()` removes:
1. The worktree directory (`git worktree remove --force`)
2. Prunes stale worktree references (`git worktree prune`)
3. Deletes the task branch (unless `keepBranch: true` for PR delivery)

The project branch (`astro/{shortProjectId}`) is **never deleted** — it accumulates work across tasks.

In debug mode (`preserveWorktrees: true`), worktrees are kept for inspection.

---

## 7. Configuration

### `.astro/config.json`

```json
{
  "baseBranch": "main",
  "branchPrefix": "astro/"
}
```

- `baseBranch` — override auto-detected default branch (main/master/develop)
- `branchPrefix` — prefix for all task branches (default: `astro/`)

### Agent directory name

Configurable per-task via `task.agentDir`. Defaults to `.astro`. Can be set to `.claude` for Claude Code compatibility.

### Worktree root override

`TaskExecutor` constructor accepts `worktreeRoot` option to override the default `{gitRoot}/{agentDir}/worktrees/` location.
