# Connected-Component Delivery Branches

## Overview

This document replaces the single "project branch" accumulative model with a **per-connected-component delivery branch** model. Instead of funneling all task work through one branch (`astro/{shortProjectId}`), the system computes connected components of the task graph and assigns each component its own **delivery branch**. Each delivery branch accumulates work from its component's tasks and creates its own PR to the base branch.

This enables truly parallel, independent work streams — e.g., solving 5 unrelated GitHub issues produces 5 small, reviewable PRs instead of one monolithic PR.

## Motivation

The existing accumulative project branch model is too rigid for projects with many independent tasks:

| Scenario | Old Model | New Model |
|----------|-----------|-----------|
| 5 independent GitHub issues | 1 branch, 1 giant PR, serialized merges | 5 branches, 5 small PRs, fully parallel |
| 2 milestones + 1 loose task | 1 branch, all interleaved | 2-3 branches, clean separation |
| Linear pipeline (A→B→C→D) | 1 branch | 1 branch (same as before) |

The old model is a special case of the new model: when all tasks are connected, there is exactly one component and one delivery branch — identical behavior.

## Connected Component Algorithm

### Graph Model

The task graph is treated as **undirected** for connectivity analysis. Connections include:

| Connection Type | Source | Why |
|----------------|--------|-----|
| Dependency edge | `plan_edges` (type=`dependency`) | Tasks with dependencies must share delivery context |
| Branch edge | `plan_edges` (type=`branch`) | Decision branches are part of the same work stream |
| Milestone containment | `plan_nodes.milestoneId` | A milestone and its tasks are logically coupled |
| `node.dependencies[]` | `plan_nodes.dependencies` array | Defensive — covers same ground as edges |

**Why milestone containment is critical:** Consider Milestone M containing tasks T1-T3, and task T4 that depends on M. Without treating containment as an edge, T1-T3 and T4 could end up in separate components — T4 would be in a different PR than the milestone it depends on.

### Algorithm: Union-Find

```
Input:  nodes: PlanNode[], edges: PlanEdge[]
Output: Map<componentId, nodeId[]>

1. Initialize disjoint set: each node is its own component
2. For each edge (dependency or branch): union(source, target)
3. For each node with milestoneId: union(node, milestone)
4. For each node.dependencies[]: union(node, dependency)  [defensive]
5. Group nodes by root → return components
```

Time complexity: O(n * alpha(n)) — practically O(n).

### Filtering

Before computing components, **exclude non-executable nodes**:

- Pruned tasks (`status = 'pruned'`) — dead branches
- The "Push to GitHub" node — this is replaced by per-component auto-PR

Milestone nodes (type `milestone`) ARE included in the connectivity computation but are NOT executable — they serve only as connectors. A component that contains only milestones and no tasks does not get a delivery branch.

## Delivery Branch Naming

### Branch Name Format

```
Delivery branch:  astro/{shortProjectId}-{shortDeliveryId}
Task branch:      astro/{shortProjectId}-{shortDeliveryId}-{shortNodeId}

Examples:
  astro/7b19a9-e4f1a2           (delivery branch)
  astro/7b19a9-e4f1a2-n3        (task branch within component)
```

- `shortProjectId`: First 6 hex chars of project UUID (unchanged from current model)
- `shortDeliveryId`: First 6 hex chars of a randomly generated UUID, created once when the delivery branch record is inserted into the DB
- `shortNodeId`: `n{number}` or last 6 hex chars of node UUID (unchanged)

### Why UUID-based, Not Sequential

Sequential indices (`d1`, `d2`, `d3`) are fragile under re-planning:

```
Initial:  d1={T1,T2}  d2={T3,T4}  d3={T5}
Re-plan merges d1+d2 → restart → new branch d4={T1,T2,T3,T4}
Now d3 exists but d1,d2 are obsolete and d4 is new — confusing in logs.
```

UUID-based names are **immutable** — old branches keep their names in historical logs. New branches get new IDs. No renaming, no ambiguity.

### Singleton Optimization

When a component has exactly **one executable task**, the delivery branch IS the working branch. No intermediate task branch is created.

```
Multi-task component:
  delivery branch: astro/7b19a9-e4f1a2   (accumulation)
    ├── task branch: astro/7b19a9-e4f1a2-n1 → merge into delivery
    ├── task branch: astro/7b19a9-e4f1a2-n2 → merge into delivery
    └── PR: delivery branch → base branch

Singleton component:
  delivery branch: astro/7b19a9-a3c7b1   (agent works directly here)
    └── PR: delivery branch → base branch
```

This eliminates the unnecessary branch indirection for the common case of independent tasks.

## Lifecycle

### Plan Finalization

```
Plan finalized (user clicks "Execute All" or first task dispatched)
    │
    ▼
computeConnectedComponents(nodes, edges)
    │
    ▼
For each component with ≥1 executable task:
    │
    ├── Create delivery_branches DB record
    │     • id: new UUID
    │     • branch_name: astro/{shortProjectId}-{shortDeliveryId}
    │     • is_singleton: component has exactly 1 task
    │     • node_ids: snapshot of node IDs in this component
    │     • status: 'active'
    │
    └── Update plan_nodes.delivery_branch_id for all tasks in component
```

### Task Dispatch

When dispatching a task:

1. Look up the task's `delivery_branch_id` → get the `DeliveryBranch` record
2. Include in dispatch payload:
   - `deliveryBranch`: branch name (e.g., `astro/7b19a9-e4f1a2`)
   - `isSingleton`: whether agent works directly on delivery branch
   - `baseBranch`: the base branch for final PR (e.g., `main`)
3. Agent runner receives payload and:
   - Calls `ensureDeliveryBranch(deliveryBranch)` (replaces `ensureProjectBranch()`)
   - If singleton: creates worktree on delivery branch directly
   - If multi-task: creates task branch from delivery branch tip

### Component Completion

When the last task in a component completes:

1. Detect completion: all executable tasks in the component have status `completed` or `auto_verified`
2. If the component's delivery branch has a remote:
   - Rebase delivery branch onto latest base branch
   - Create PR: delivery branch → base branch
   - Record `pr_url`, `pr_number` on the `delivery_branches` record
3. Update `delivery_branches.status` to `'pr_created'`

This replaces the single "Push to GitHub" node with automatic per-component PR creation.

### Worktree Structure

```
.astro/worktrees/
├── 7b19a9-e4f1a2/               ← delivery branch worktree (persistent, for file browsing)
│                                    Multi-task: detached HEAD at delivery branch tip
│                                    Singleton: attached to delivery branch
├── 7b19a9-e4f1a2-n1/            ← task worktree (temporary, multi-task only)
├── 7b19a9-e4f1a2-n2/            ← task worktree (temporary, multi-task only)
├── 7b19a9-a3c7b1/               ← singleton delivery branch worktree (= working dir)
└── ...
```

## Re-planning

### Invariant

> **Components are immutable after any task in them starts executing.**

Once a task begins execution on a delivery branch, its commits are interleaved with other tasks' commits on that branch. The git history cannot be cleanly separated.

### What Re-planning Can Do Freely

| Action | Impact |
|--------|--------|
| Change task title/description | No component change — just DB update |
| Add a new task with no dependencies | New singleton component, new delivery branch |
| Add a new task connected to an existing component | Joins existing component, assigned to existing delivery branch |
| Change task verification mode | No component change |
| Remove an unexecuted task | Component may shrink but delivery branch unaffected |

### What Requires Restart

Any re-plan that changes the **component structure of tasks with executed work** requires a restart of affected components.

#### Detection

After re-planning produces a new graph:

```
1. Recompute connected components on the new graph
2. For each delivery branch with executed tasks:
     Check if all its executed tasks are still in the same new component
3. If any delivery branch's executed tasks are now split across components
   OR two delivery branches' executed tasks are now in the same component:
     → structural change detected → restart required
```

#### Corner Case: Why Splitting Executed Tasks Is Unsafe

```
Before re-plan:
  CC1: {T1, T2, T3} on delivery branch d1
  T1 executed → commits on d1
  T2 executed → commits on d1 (interleaved with T1)
  T3 not yet executed

Re-plan removes edge T1→T2, splitting:
  CC1a: {T1, T3}
  CC1b: {T2}
```

**Problem**: T1 and T2's commits are co-mingled on d1.
- If CC1a keeps d1 → d1's PR includes T2's changes (wrong component)
- If CC1b gets d1 → same problem in reverse
- If both get new branches → T3 loses access to T1's work, T2's work is orphaned
- Cannot cherry-pick T2 out if T1 and T2 touched the same files

**Solution**: Restart both CC1a and CC1b — close d1, create fresh delivery branches, re-queue all tasks.

#### Corner Case: Why Merging Executed Components Is Unsafe

```
Before re-plan:
  CC1: {T1, T2} on d1 — T1 executed
  CC2: {T3, T4} on d2 — T3 executed

Re-plan adds edge T2→T3, merging into one component.
```

**Problem**: T1's work is on d1, T3's work is on d2. The merged component needs all work on one branch.
- Merging d2 into d1 (git merge) could conflict
- Even if clean, changes the commit history that d1's PR shows
- Adds complexity (branch merge logic) for a rare case

**Solution**: Restart the merged component — close d1 and d2, create fresh delivery branch, re-queue T1, T2, T3, T4.

### Restart Mechanism

When a structural change is detected:

1. **User confirmation required** — show in plan chat what will happen
2. **Cancel in-progress tasks** — abort active executions, remove worktrees
3. **Close delivery branches** — mark as `obsolete` in DB, close any open PRs
4. **Create new delivery branches** — fresh branches from base for each new component
5. **Re-queue tasks** — all tasks in affected components reset to `planned` status
6. **Log to plan chat** — structured message showing what was killed, closed, and re-queued

### Restart Chat Log Format

The plan chat receives a structured streaming event sequence:

```
── Delivery branch restructuring required ──

Re-plan changed component structure. The following delivery branches have
executed tasks that can no longer be cleanly separated:

  astro/7b19a9-e4f1a2 (3 tasks, 2 executed)
    T1 "Setup database" (completed)
    T2 "Build API" (completed)
    T3 "Write tests" (planned)

  astro/7b19a9-b7c8d9 (2 tasks, 1 executed)
    T4 "Add auth" (completed)
    T5 "Add logging" (planned)

Actions:
  Cancelled: (none — no tasks in progress)
  Closed: astro/7b19a9-e4f1a2 (PR #12 closed)
  Closed: astro/7b19a9-b7c8d9 (PR #15 closed)
  Re-queued: T1, T2, T3, T4, T5

New delivery branches:
  astro/7b19a9-c1d2e3 ← {T1, T2, T4, T5} (merged component)
  astro/7b19a9-f9a8b7 ← {T3} (singleton)

── Resuming execution ──
```

### Re-planning Decision Tree

```
Re-plan produces new graph
    │
    ▼
Recompute connected components
    │
    ▼
Compare with existing delivery branches
    │
    ├── No structural change
    │     • New unexecuted tasks → assign to existing delivery branches
    │     • Removed unexecuted tasks → no git impact
    │     • Continue execution
    │
    ├── New independent component (no executed tasks)
    │     • Create new delivery branch
    │     • No restart needed
    │
    └── Structural change involving executed tasks
          │
          ├── Any delivery branch's executed tasks split across new components?
          │     → Restart affected components
          │
          └── Multiple delivery branches' executed tasks merged into one?
                → Restart affected components
```

## Schema

### New Table: `delivery_branches`

```sql
CREATE TABLE IF NOT EXISTS delivery_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch_name TEXT NOT NULL,
  is_singleton BOOLEAN NOT NULL DEFAULT false,
  node_ids TEXT[] NOT NULL DEFAULT '{}',
  pr_url TEXT,
  pr_number INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  -- 'active': branch in use, tasks executing
  -- 'pr_created': all tasks done, PR opened
  -- 'merged': PR merged into base
  -- 'obsolete': replaced by restart
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_branches_project_branch
  ON delivery_branches(project_id, branch_name)
  WHERE deleted_at IS NULL;
```

### `plan_nodes` Addition

```sql
ALTER TABLE plan_nodes
  ADD COLUMN IF NOT EXISTS delivery_branch_id UUID REFERENCES delivery_branches(id);
```

### Backward Compatibility

The `projects.projectBranch`, `projects.projectPrUrl`, and `projects.projectPrNumber` columns remain but are **deprecated**. New code reads/writes `delivery_branches` exclusively. Existing projects with `projectBranch` set and no `delivery_branches` records are treated as single-component projects (legacy mode).

## Code Changes

### packages/core/src/dispatch/

| File | Change |
|------|--------|
| `connected-components.ts` | **New** — `computeConnectedComponents()`, `detectStructuralChange()`, `planDeliveryBranches()` |
| `branch-manager.ts` | Unchanged — still handles branch pruning within a component |
| `types.ts` | Add `DeliveryBranch`, `DeliveryBranchPlan`, `ComponentRestructureAction` types |

### packages/core/src/db/

| File | Change |
|------|--------|
| `schema.ts` | Add `deliveryBranches` table, `deliveryBranchId` column on `planNodes` |

### server/

| File | Change |
|------|--------|
| `routes/dispatch.ts` | Compute/lookup delivery branch per task; pass in dispatch payload |
| `lib/dispatch/dispatch-engine.ts` | Component completion detection; auto-PR trigger |
| `lib/events/hooks/` | New `component-completion-hook.ts` for per-component PR creation |
| `lib/db/schema.ts` | Re-export `deliveryBranches` |

### packages/agent-runner/ (astro-agent repo)

| File | Change |
|------|--------|
| `src/types.ts` | Add `deliveryBranch`, `isSingleton` to task type |
| `src/lib/worktree.ts` | `ensureProjectBranch()` → `ensureDeliveryBranch(branchName)`; singleton worktree mode |
| `src/lib/task-executor.ts` | Use `task.deliveryBranch` instead of `task.projectBranch`; singleton delivery mode |
| `src/lib/git-pr.ts` | PR target = base branch (not project branch) for singletons |

### Terminology Rename

All log messages, prompts, and UI strings: "project branch" → "delivery branch".

| Layer | Files |
|-------|-------|
| Server logs | `dispatch.ts`, `dispatch-engine.ts` |
| Agent prompts | `packages/core/src/prompt-templates.ts` |
| Agent runner | `worktree.ts`, `task-executor.ts`, `git-pr.ts` |
| Design docs | `GITHUB_WORKFLOW.md` (add reference to this doc) |

## Scenarios

### Scenario A: 5 Independent GitHub Issues

```
Graph: [T1]  [T2]  [T3]  [T4]  [T5]   (no edges)

Components: 5 singletons

Delivery branches:
  astro/7b19a9-a1b2c3 ← T1 (singleton, agent works directly here)
  astro/7b19a9-d4e5f6 ← T2 (singleton)
  astro/7b19a9-171819 ← T3 (singleton)
  astro/7b19a9-202122 ← T4 (singleton)
  astro/7b19a9-232425 ← T5 (singleton)

Execution: all 5 run fully in parallel
Result: 5 independent PRs to main, zero merge conflicts
```

### Scenario B: Two Milestones + Loose Task

```
Graph:
  Milestone A → T1, T2 (T2 depends on T1)
  Milestone B → T3
  T4 depends on Milestone A
  T5 (independent)

Components:
  CC1: {Milestone A, T1, T2, T4}  — connected via containment + dependency
  CC2: {Milestone B, T3}           — connected via containment
  CC3: {T5}                         — singleton

Delivery branches:
  astro/7b19a9-aaa111 ← T1, T2, T4 (multi-task, topological order)
  astro/7b19a9-bbb222 ← T3 (singleton, milestone has no executable work)
  astro/7b19a9-ccc333 ← T5 (singleton)

Result: 3 PRs to main
```

### Scenario C: Fully Connected Plan (Backward Compatible)

```
Graph: T1 → T2 → T3 → T4  (linear chain)

Components: 1 component

Delivery branch: astro/7b19a9-xxx000 (acts exactly like today's project branch)

Behavior identical to current model.
```

### Scenario D: Re-plan Adds Independent Task

```
Initial: CC1={T1,T2} on d1, CC2={T3} on d2 (singleton)

Re-plan adds T4 (independent, no edges)

New components: CC1={T1,T2}, CC2={T3}, CC3={T4}

Action: create new delivery branch for T4. No restart. d1 and d2 untouched.
```

### Scenario E: Re-plan Merges Components

```
Initial: CC1={T1,T2} on d1 (T1 executed), CC2={T3} on d2 (T3 executed)

Re-plan adds edge T2→T3, merging into one component.

Detection: d1 has T1 (executed), d2 has T3 (executed) → different branches, same new component

Action: user confirmation → restart
  1. Close d1 (PR if any), close d2
  2. Mark d1, d2 as 'obsolete'
  3. Create d3 for {T1, T2, T3}
  4. Re-queue T1, T2, T3 as 'planned'
  5. Log structured message to plan chat
```

### Scenario F: Re-plan Splits Component

```
Initial: CC1={T1,T2,T3} on d1. T1 and T2 executed, T3 not yet.

Re-plan removes edge T2→T3.

New components: CC1a={T1,T2}, CC1b={T3}

Detection: d1 has T1 and T2 (both executed) in CC1a — OK, they stay together.
           T3 is unexecuted — can freely move.

Action: T3 gets new singleton delivery branch. d1 keeps T1+T2. No restart.
```

### Scenario G: Re-plan Splits Executed Tasks (Restart Required)

```
Initial: CC1={T1,T2,T3} on d1. T1, T2, T3 all executed.

Re-plan removes edge T1→T2.

New components: CC1a={T1,T3}, CC1b={T2}

Detection: d1 has T1 (in CC1a) AND T2 (in CC1b) — both executed, same branch, different new components.
           Commits are co-mingled on d1. Cannot separate.

Action: user confirmation → restart both CC1a and CC1b
  1. Close d1, mark obsolete
  2. Create d-new1 for {T1,T3}, d-new2 for {T2}
  3. Re-queue T1, T2, T3
  4. Log to plan chat
```

## Migration

### Existing Projects

Projects created before this feature that have `projects.projectBranch` set:

1. On first dispatch after upgrade: check if `delivery_branches` records exist
2. If not: create a single delivery branch record mirroring `projectBranch`
3. All tasks assigned to that delivery branch
4. Behavior identical to before — zero regression

### Feature Flag

Gate behind `connected-component-branches` feature flag:

- **Off (default)**: single delivery branch per project (legacy behavior via compatibility shim)
- **On**: full connected-component model

## Key Invariants

1. **Delivery branch IDs are immutable** — UUID-based names never change after creation
2. **Executed work is immutable** — once commits land on a delivery branch, they stay forever
3. **Components are immutable after execution starts** — structural changes require restart
4. **Unexecuted tasks are freely assignable** — no git state to migrate
5. **Singletons skip task branches** — delivery branch = working branch
6. **Old model is a special case** — one component = one delivery branch = same as project branch

## Key Files

| File | Role |
|------|------|
| `packages/core/src/dispatch/connected-components.ts` | Union-Find, component computation, structural change detection |
| `packages/core/src/db/schema.ts` | `deliveryBranches` table definition |
| `server/routes/dispatch.ts` | Delivery branch assignment at dispatch time |
| `server/lib/events/hooks/component-completion-hook.ts` | Auto-PR on component completion |
| `packages/agent-runner/src/lib/worktree.ts` | `ensureDeliveryBranch()`, singleton worktree mode |
| `packages/agent-runner/src/lib/task-executor.ts` | Delivery mode routing |
| `docs/design/DELIVERY_BRANCHES.md` | This document |
