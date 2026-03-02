# GitHub Workflow: Accumulative Project Branch Model

## Overview

Astro uses an **accumulative project branch model** where all task work in a project is collected on a shared project branch. Each task creates a per-task branch, opens a PR against the project branch, and auto-merges it. When all tasks complete, a final **"Push to GitHub"** task node opens a PR from the project branch to the user-configured base branch.

## Branch Model

```
<base branch> ──────────────────────────────────────── <base branch> (unchanged)
  │
  └── astro/7b19a9  (project branch, accumulates all task work)
        │
        ├── astro/7b19a9-n1  →  PR #1 → auto-merge → astro/7b19a9
        ├── astro/7b19a9-n2  →  PR #2 → auto-merge → astro/7b19a9
        ├── astro/7b19a9-n3  →  PR #3 → auto-merge → astro/7b19a9
        │
        └── "Push to GitHub" task  →  PR: astro/7b19a9 → <base branch>
```

`<base branch>` is the branch configured in the project's source settings (e.g., `main`, `develop`, `release`). It defaults to `main` when not specified.

### Branch Naming

| Branch Type | Pattern | Example |
|-------------|---------|---------|
| Project branch | `astro/{shortProjectId}` | `astro/7b19a9` |
| Task branch | `astro/{shortProjectId}-{shortNodeId}` | `astro/7b19a9-n7` |

- `shortProjectId`: First 6 hex chars of the project UUID (after stripping hyphens)
- `shortNodeId`: Either `n{number}` (server-assigned node number) or last 6 hex chars of the node UUID

The `shortNodeId` computation was fixed to avoid collision with the project ID prefix. Previously, AI-generated node IDs were prefixed with `projectId.slice(0,8)`, causing `getShortId()` to produce identical results for both.

## "Push to GitHub" Task Node

When a project has a GitHub repo configured (`githubOwner` + `githubRepo`), AI-generated plans include an explicit **"Push to GitHub"** task node. This node:

1. Is a regular `task` (type: `task`, not a milestone) — an agent executes it
2. Depends on ALL other task nodes (always the very last step)
3. Opens a PR from `astro/{shortProjectId}` → `<base branch>`
4. Waits for CI checks (tests, lint, AI code review) and fixes failures (up to 3 retry cycles)
5. Auto-wires when users add new tasks — new tasks become dependencies of the Push node
6. Is re-triggerable: users can reset and re-run after adding more tasks

When this node exists, the `project-completion-hook` is disabled to prevent duplicate PRs.

### When it appears

| Project Configuration | Push Node? |
|-----------------------|------------|
| GitHub repo configured (`githubOwner` + `githubRepo` set) | Yes |
| Local-only workdir (no GitHub repo) | No |
| Playground projects | No |

### Auto-wiring on task addition

When a user adds a new task to a plan that has a "Push to GitHub" node, the plan store automatically:
1. Creates a `dependency` edge from the new task → Push node
2. Updates the Push node's dependencies array

This ensures the Push node always remains the final task regardless of when tasks are added.

## Complete Workflow: Two-Round Example

This diagram shows the full lifecycle across two rounds of execution, including the case where the project branch is deleted after the first round's PR is merged.

### Round 1: AI generates plan, user adds task, everything runs

```
                        ┌─────────────────────────────────────────────────┐
                        │              PLAN GENERATION                    │
                        │                                                 │
                        │  AI generates:                                  │
                        │    n1: "Setup database"                         │
                        │    n2: "Build API endpoints"                    │
                        │    n3: "Push to GitHub"  (depends on n1, n2)    │
                        └───────────────┬─────────────────────────────────┘
                                        │
                        ┌───────────────▼─────────────────────────────────┐
                        │              USER ADDS TASK                     │
                        │                                                 │
                        │  User adds: n4: "Add frontend tests"           │
                        │  Auto-wire: n4 → n3 (Push depends on n4 too)   │
                        │                                                 │
                        │  Task pool:                                     │
                        │    n1: planned ─┐                               │
                        │    n2: planned ─┤                               │
                        │    n4: planned ─┼── n3: "Push to GitHub"        │
                        └───────────────┬─────────────────────────────────┘
                                        │
                        ┌───────────────▼─────────────────────────────────┐
                        │              TASK EXECUTION                     │
                        │                                                 │
                        │  GitHub repo:  <base branch>                    │
                        │                   │                             │
                        │  Create project branch:                         │
                        │    astro/7b19a9  ← branched from <base branch>  │
                        │                                                 │
                        │  Execute n1:                                    │
                        │    worktree → astro/7b19a9-n1                   │
                        │    PR #1: astro/7b19a9-n1 → astro/7b19a9       │
                        │    auto-merge ✓                                 │
                        │    n1: completed                                │
                        │                                                 │
                        │  Execute n2:                                    │
                        │    worktree → astro/7b19a9-n2                   │
                        │    (branches from updated project branch tip)   │
                        │    PR #2: astro/7b19a9-n2 → astro/7b19a9       │
                        │    auto-merge ✓                                 │
                        │    n2: completed                                │
                        │                                                 │
                        │  Execute n4:                                    │
                        │    worktree → astro/7b19a9-n4                   │
                        │    PR #4: astro/7b19a9-n4 → astro/7b19a9       │
                        │    auto-merge ✓                                 │
                        │    n4: completed                                │
                        └───────────────┬─────────────────────────────────┘
                                        │
                        ┌───────────────▼─────────────────────────────────┐
                        │         "PUSH TO GITHUB" EXECUTION              │
                        │                                                 │
                        │  All deps complete → execute n3                  │
                        │  deliveryMode overridden to 'push'              │
                        │  Agent receives special dispatch instructions:   │
                        │                                                 │
                        │  1. Check for existing PR                       │
                        │     gh pr list --head astro/7b19a9              │
                        │     → none found                                │
                        │                                                 │
                        │  2. Create final PR                             │
                        │     gh pr create                                │
                        │       --base <base branch>                      │
                        │       --head astro/7b19a9                       │
                        │     → PR #5 created                             │
                        │                                                 │
                        │  3. Wait for CI                                 │
                        │     gh pr checks #5 --watch                     │
                        │     → Lint fails!                               │
                        │                                                 │
                        │  4. Fix & retry (cycle 1/3)                     │
                        │     Read failure → fix lint → push to           │
                        │     astro/7b19a9 → re-check → ✓ all pass       │
                        │                                                 │
                        │  n3: completed                                  │
                        └───────────────┬─────────────────────────────────┘
                                        │
                        ┌───────────────▼─────────────────────────────────┐
                        │              POST-ROUND 1                       │
                        │                                                 │
                        │  GitHub state:                                  │
                        │    PR #5: astro/7b19a9 → <base branch> (open)   │
                        │    All CI checks passing                        │
                        │                                                 │
                        │  User or maintainer merges PR #5 on GitHub      │
                        │  GitHub auto-deletes astro/7b19a9 branch        │
                        │  (delete branch on merge)                       │
                        │                                                 │
                        │  <base branch> now includes all Round 1 work    │
                        └─────────────────────────────────────────────────┘
```

### Round 2: User adds more tasks after branch was deleted

```
                        ┌─────────────────────────────────────────────────┐
                        │              USER ADDS MORE TASKS               │
                        │                                                 │
                        │  User resets n3 "Push to GitHub" → planned      │
                        │  User adds: n5: "Add dark mode"                 │
                        │  Auto-wire: n5 → n3 (Push depends on n5)        │
                        │                                                 │
                        │  Task pool:                                     │
                        │    n1: completed ─┐                             │
                        │    n2: completed ─┤                             │
                        │    n4: completed ─┼── n3: "Push to GitHub"      │
                        │    n5: planned   ─┘       (reset → planned)     │
                        └───────────────┬─────────────────────────────────┘
                                        │
                        ┌───────────────▼─────────────────────────────────┐
                        │              TASK EXECUTION (ROUND 2)           │
                        │                                                 │
                        │  GitHub state: astro/7b19a9 branch DELETED      │
                        │  (was removed when PR #5 merged)                │
                        │                                                 │
                        │  Execute n5:                                    │
                        │    ensureProjectBranch() detects branch missing  │
                        │    Re-creates astro/7b19a9 from <base branch>   │
                        │    (<base branch> already has Round 1 work)     │
                        │                                                 │
                        │    worktree → astro/7b19a9-n5                   │
                        │    (branches from fresh project branch)         │
                        │    PR #6: astro/7b19a9-n5 → astro/7b19a9       │
                        │    auto-merge ✓                                 │
                        │    n5: completed                                │
                        └───────────────┬─────────────────────────────────┘
                                        │
                        ┌───────────────▼─────────────────────────────────┐
                        │        "PUSH TO GITHUB" EXECUTION (ROUND 2)     │
                        │                                                 │
                        │  All deps complete → execute n3 (re-run)         │
                        │                                                 │
                        │  1. Check for existing PR                       │
                        │     gh pr list --head astro/7b19a9              │
                        │     → PR #5 found but state: "MERGED"           │
                        │     → Create a new PR                           │
                        │                                                 │
                        │  2. Create new PR                               │
                        │     gh pr create                                │
                        │       --base <base branch>                      │
                        │       --head astro/7b19a9                       │
                        │     → PR #7 created                             │
                        │     (only contains Round 2 delta: dark mode)    │
                        │                                                 │
                        │  3. Wait for CI → all pass ✓                    │
                        │                                                 │
                        │  n3: completed                                  │
                        └───────────────┬─────────────────────────────────┘
                                        │
                        ┌───────────────▼─────────────────────────────────┐
                        │              POST-ROUND 2                       │
                        │                                                 │
                        │  GitHub state:                                  │
                        │    PR #7: astro/7b19a9 → <base branch> (open)   │
                        │    Contains only n5's delta (dark mode)          │
                        │    <base branch> already has n1+n2+n4 from R1   │
                        │                                                 │
                        │  Clean delta because:                           │
                        │    Project branch was re-created from           │
                        │    <base branch> which already has Round 1      │
                        └─────────────────────────────────────────────────┘
```

### Why this is robust

| Scenario | System Behavior |
|----------|-----------------|
| Project branch deleted after merge | `ensureProjectBranch()` re-creates it from `<base branch>` (which already has prior work) |
| PR already merged | Agent detects merged state via `gh pr list`, creates a new PR |
| CI fails on final PR | Agent reads failures, fixes code, pushes to project branch, retries (3 cycles) |
| AI reviewer requests changes | Agent reads review comments via GitHub API, addresses feedback, pushes fixes |
| User adds tasks after plan generation | Auto-wiring keeps Push node as the final dependency |
| User resets Push node and re-runs | Works idempotently — checks for existing PR first |
| Multiple rounds of execution | Each round creates clean delta PRs because the project branch rebases from `<base branch>` |

## Worktree Lifecycle

### First Task in a Project

1. `ensureProjectBranch()` checks if `origin/astro/{shortProjectId}` exists
2. If not, creates it from `origin/<base branch>` and pushes
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
3. PR base is the **project branch** (not `<base branch>`)
4. `autoMerge: true` triggers immediate squash-merge via `gh pr merge --squash --delete-branch`
5. `commitAfterSha` captured from the project branch after merge
6. PR data (`prUrl`, `prNumber`, `commitBeforeSha`, `commitAfterSha`) persisted to `planNodes`

### Final Project PR ("Push to GitHub" task)

Created by the **"Push to GitHub" task node** executing as a regular agent task:

1. Agent checks for existing PR via `gh pr list`
2. Creates PR: `astro/{shortProjectId}` → `<base branch>` (if no open PR exists)
3. Waits for CI: `gh pr checks --watch`
4. On failure: reads details, fixes code, pushes to project branch, retries (up to 3 cycles)
5. On AI review feedback: reads comments via GitHub API, addresses suggestions, pushes
6. Reports success when all checks pass

**Fallback**: When no explicit Push node exists (legacy projects), the `project-completion-hook` creates the final PR server-side when all nodes reach terminal states.

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

### Corner Case: Project Branch Deleted After Merge

If the final PR was merged and GitHub auto-deleted the project branch:
- Resetting the Push node and re-running works because `ensureProjectBranch()` re-creates the branch from `<base branch>`
- The new project branch already contains all prior work (it's on `<base branch>`)
- Only new task work appears as a delta in the next final PR

## Delivery Modes

| Mode | Behavior |
|------|----------|
| `pr` | Push task branch + create PR against project branch + auto-merge |
| `push` | Push task branch to origin (no PR, no auto-merge). **Used by "Push to GitHub" node.** |
| `branch` | Commit locally, branch stays local |
| `copy` | Worktree preserved, no git operations |
| `direct` | No worktree, work in-place |

The accumulative model only applies to `pr` delivery mode. The "Push to GitHub" node uses `push` mode — the agent creates the PR itself via `gh`.

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
| `packages/core/src/prompt-templates.ts` | `GitHubContextForPrompt` interface, injects Push node instructions into plan prompts |
| `server/routes/dispatch.ts` | Computes `projectBranch`, detects Push nodes, injects special dispatch instructions |
| `server/routes/agent.ts` | Passes GitHub context to `buildPlanSystemPrompt` |
| `src/stores/plan-store.ts` | Auto-wires new tasks as dependencies of Push node |
| `packages/agent-runner/src/lib/worktree.ts` | `ensureProjectBranch()`, branches from project branch |
| `packages/agent-runner/src/lib/git-pr.ts` | `mergePullRequest()`, auto-merge + SHA capture |
| `packages/agent-runner/src/lib/branch-lock.ts` | Project-scoped lock key |
| `packages/agent-runner/src/lib/task-executor.ts` | Wires `autoMerge`, passes commit SHAs |
| `server/lib/events/hooks/pr-creation-hook.ts` | Persists commit SHAs |
| `server/lib/events/hooks/project-completion-hook.ts` | Legacy fallback: creates final PR on project completion (skipped when Push node exists) |
