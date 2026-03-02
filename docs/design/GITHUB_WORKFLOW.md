# GitHub Workflow: Accumulative Project Branch Model

## Overview

Astro uses an **accumulative project branch model** where all task work in a project is collected on a shared project branch. Each task creates a per-task branch, opens a PR against the project branch, and auto-merges it. When all tasks complete, a final PR is created from the project branch to the repository's default branch (usually `main`).

## Branch Model

```
main ────────────────────────────────────────────────── main (unchanged)
  │
  └── astro/7b19a9  (project branch, accumulates all task work)
        │
        ├── astro/7b19a9-n1  →  PR #1 → auto-merge → astro/7b19a9
        ├── astro/7b19a9-n2  →  PR #2 → auto-merge → astro/7b19a9
        ├── astro/7b19a9-n3  →  PR #3 → auto-merge → astro/7b19a9
        │
        └── Final PR: astro/7b19a9 → main  (created on project completion)
```

### Branch Naming

| Branch Type | Pattern | Example |
|-------------|---------|---------|
| Project branch | `astro/{shortProjectId}` | `astro/7b19a9` |
| Task branch | `astro/{shortProjectId}-{shortNodeId}` | `astro/7b19a9-n7` |

- `shortProjectId`: First 6 hex chars of the project UUID (after stripping hyphens)
- `shortNodeId`: Either `n{number}` (server-assigned node number) or last 6 hex chars of the node UUID

The `shortNodeId` computation was fixed to avoid collision with the project ID prefix. Previously, AI-generated node IDs were prefixed with `projectId.slice(0,8)`, causing `getShortId()` to produce identical results for both.

## Worktree Lifecycle

### First Task in a Project

1. `ensureProjectBranch()` checks if `origin/astro/{shortProjectId}` exists
2. If not, creates it from `origin/main` and pushes
3. Worktree created: `git worktree add -b astro/{shortProjectId}-n1 {path} origin/astro/{shortProjectId}`
4. `commitBeforeSha` captured from the start point

### Subsequent Tasks

1. `ensureProjectBranch()` confirms project branch exists (idempotent, no-op)
2. `git fetch origin` ensures latest project branch tip
3. Worktree branches from `origin/astro/{shortProjectId}` — includes all prior merged task work
4. `commitBeforeSha` captured from the updated project branch tip

### Cleanup

- **Task branch**: Cleaned up by `deleteRemoteBranch()` on re-execution or by `--delete-branch` during auto-merge
- **Project branch**: **Never deleted** during task reset. Protected in both `createWorktree()` and the reset endpoint.
- **Worktree directory**: Removed after task completion or on re-execution

## PR Lifecycle

### Per-Task PRs

1. Agent executes in the worktree (task branch)
2. On completion, `pushAndCreatePR()` pushes the task branch and creates a PR
3. PR base is the **project branch** (not `main`)
4. `autoMerge: true` triggers immediate squash-merge via `gh pr merge --squash --delete-branch`
5. `commitAfterSha` captured from the project branch after merge
6. PR data (`prUrl`, `prNumber`, `commitBeforeSha`, `commitAfterSha`) persisted to `planNodes`

### Final Project PR

Triggered by the `project-completion-hook` when:
- A `task.completed` event fires with `status: 'success'`
- All non-deleted nodes in the project are in terminal states (`completed`, `auto_verified`, `pruned`)
- Project has a GitHub repo configured
- No existing `projectPrUrl`

The final PR:
- Source: project branch (`astro/{shortProjectId}`)
- Target: repository default branch (from `project.source.baseBranch`, usually `main`)
- Title: `[Astro] {project.name}`
- Body: Project description + per-task summary with PR links
- Created via GitHub REST API (server-side, uses project owner's GitHub token)
- Data persisted to `projects` table (`projectBranch`, `projectPrUrl`, `projectPrNumber`)

## Branch Lock Serialization

All tasks in the same project share a **project-scoped lock** in `BranchLockManager`.

```
Lock key: {resolvedWorkdir}::{shortProjectId}
```

This ensures tasks serialize because:
1. Task A creates worktree from project branch tip
2. Task A executes, creates PR, auto-merges
3. Lock released → Task B acquires lock
4. Task B creates worktree from **updated** project branch tip (includes Task A's work)

Without serialization, Task B might branch from a stale project branch and miss Task A's changes.

## Reset / Re-execution Behavior

When a task is reset:

1. **PR closed**: Per-task PR closed via GitHub API
2. **Task branch deleted**: Remote task branch deleted via GitHub API
3. **Project branch preserved**: Guard prevents deletion of `astro/{shortProjectId}`
4. **DB fields cleared**: `prUrl`, `prNumber`, `branchName`, `commitBeforeSha`, `commitAfterSha` set to null
5. **Re-execution**: New worktree branches from current project branch tip (includes other tasks' work)

### Corner Case: Reset Middle Task

If Tasks 1, 2, 3 completed and Task 2 is reset:
- Tasks 1 and 3's changes remain on the project branch
- Re-executing Task 2 will branch from the project branch tip (which includes Tasks 1+3)
- Task 2's new PR merges on top of the existing work

## Delivery Modes

| Mode | Behavior |
|------|----------|
| `pr` | Push task branch + create PR against project branch + auto-merge |
| `push` | Push task branch to origin (no PR, no auto-merge) |
| `branch` | Commit locally, branch stays local |
| `copy` | Worktree preserved, no git operations |
| `direct` | No worktree, work in-place |

The accumulative model only applies to `pr` delivery mode. Other modes bypass the project branch workflow.

## Schema

### `projects` table additions

| Column | Type | Description |
|--------|------|-------------|
| `project_branch` | text | Project branch name (e.g., `astro/7b19a9`) |
| `project_pr_url` | text | Final PR URL |
| `project_pr_number` | integer | Final PR number |

### `plan_nodes` table additions

| Column | Type | Description |
|--------|------|-------------|
| `commit_before_sha` | text | Project branch SHA before task's PR merged |
| `commit_after_sha` | text | Project branch SHA after task's PR merged |

All columns nullable. Migration: `supabase/migrations/20260302000000_project_branch_model.sql`.

## Key Files

| File | Role |
|------|------|
| `server/routes/dispatch.ts` | Computes `projectBranch`, passes to agent runner |
| `packages/agent-runner/src/lib/worktree.ts` | `ensureProjectBranch()`, branches from project branch |
| `packages/agent-runner/src/lib/git-pr.ts` | `mergePullRequest()`, auto-merge + SHA capture |
| `packages/agent-runner/src/lib/branch-lock.ts` | Project-scoped lock key |
| `packages/agent-runner/src/lib/task-executor.ts` | Wires `autoMerge`, passes commit SHAs |
| `server/lib/events/hooks/pr-creation-hook.ts` | Persists commit SHAs |
| `server/lib/events/hooks/project-completion-hook.ts` | Creates final PR on project completion |
