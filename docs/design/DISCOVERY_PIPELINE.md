# Discovery Mode & Pipeline Maturation

How Astro supports scientific discovery projects: exploratory execution, output organization, task maturation into reproducible pipelines, and cascade re-execution.

> **Status:** Design — not yet implemented
> **Depends on:** AGENTIC_WORKFLOW.md, WORKSPACE_V2.md, DATA_MODEL.md
> **Last updated:** 2026-04-08

---

## 1. Problem Statement

Astro was built for software engineering workflows: branch per task, PR-based delivery, merge queues. Scientific discovery projects have fundamentally different needs.

### Gaps in Current System

| Gap | Impact |
|-----|--------|
| **No discovery-oriented preset** | Scientists must manually configure delivery mode, worktree, merge queue for every project |
| **Execution settings scattered** | Delivery mode on repo-config dialog, merge queue on project-overview, worktree per-dispatch — no single surface |
| **No output organization convention** | Agent writes files wherever; outputs from different tasks mix; no clean cleanup on prune |
| **Prune doesn't cascade to milestones** | Pruning a milestone leaves child tasks active; user must prune each manually |
| **Pruned task outputs contaminate context** | Dependency context injection includes outputs from pruned nodes |
| **Stale code misleads agents** | After pivoting (e.g., T2/T3 → T10), old scripts remain on disk; agents find and reuse wrong approaches |
| **No "rerun from here"** | When upstream analysis changes, all downstream must be manually re-dispatched |
| **No pipeline maturation** | Tasks that complete with working scripts can't be re-executed deterministically; every rerun pays full agent cost |
| **No cascade re-execution** | Changing one upstream task requires manually identifying and rerunning all downstream dependents |

### Real-World Example

From a genomics co-binding analysis project (29 tasks, 7 milestones):

```
M1 (Data) → M_cobind (T10 + T6) → M2 (ESR1 downstream: T4, T5, ...)
                                  → M3 (AR downstream: T7, ...)
                                  → M4 (Comparative: T8, ...)
                                  → M5 (Report) → M6 (Publication)
```

- T10 superseded T2/T3 (motif-first → ChIP co-occupancy-first). Old scripts had to be manually moved to `deprecated/`.
- T6's task description says "Ignore all the existing files in the current working directory" — a workaround for stale script contamination.
- Changing T10's threshold invalidates T4, T5, T8, and 8 other downstream tasks. No automated way to rerun them.
- Each rerun dispatches a full AI agent (~minutes, ~cost) even though the scripts already exist and just need re-execution (~seconds).

---

## 2. Design Overview

### Two-Phase Execution Model

```
Phase 1: EXPLORATION                    Phase 2: RE-EXECUTION
┌─────────────────────────┐            ┌─────────────────────────┐
│ AI agent dispatched      │            │ Script executed directly │
│ Writes scripts + outputs │───────────▶│ Fast, deterministic      │
│ Interactive, creative    │  matures   │ Cascade-aware            │
│ Branch per task          │            │ Branch per task          │
│ Minutes, $$              │            │ Seconds, free            │
└─────────────────────────┘            └─────────────────────────┘
```

Tasks start in Phase 1 (agent exploration) and mature into Phase 2 (pipeline re-execution) as they produce working scripts. The plan graph gradually solidifies from a research plan into a reproducible pipeline.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Branch delivery mode for discovery** (not direct) | Branches provide code isolation — pruned branch = stale scripts gone. No ignore-file hacks needed. |
| **Outputs in gitignored `analysis/` directory** | Outputs persist across branches (for comparison), code is branch-isolated (for cleanup). Symmetric isolation. |
| **Output dirs scoped by milestone/task** | Enables `rm -rf` cleanup on prune. Human-readable slugs from task titles. |
| **Pipeline engine built into agent runner** (not Snakemake) | Tight integration with Astro UI, git branches, agent dispatch. Agent-powered reruns can't be done by external tools. ~400 lines. |
| **No rigid directory enforcement** | Prompt guidance + `metadata.outputDir` — agent follows convention, Astro tracks the mapping. |
| **Task maturation is automatic** | Agent produces script → Astro detects it → task becomes pipeline-ready. No manual "convert to pipeline" step. |

---

## 3. Discovery Mode Toggle

### UI: Inbox Creation Form

A "Discovery" toggle in the plan creation toolbar, next to the YOLO button:

```
[📎 Attach] [📄 skill.md] [📋 Examples]    [Provider ▾] [🔬 Discovery] [⚡ YOLO] [▶ Start]
```

### What It Sets

When toggled ON, presets the following project-level settings:

| Setting | Value | Why |
|---------|-------|-----|
| `deliveryMode` | `'branch'` | Code isolation via branches, auto-merge on accept, auto-delete on prune |
| `useWorktree` | `false` | No heavy worktree isolation — lightweight branches suffice |
| `mergeQueueEnabled` | `false` | No PRs, no merge queue — direct merge to main |
| Vision doc append | `DISCOVERY_MODE_INSTRUCTIONS` | Prompt guidance for output organization, commit conventions |

Discovery mode is a **UI preset**, not a schema type. No `projectType: 'scientific'` column. User can change any setting individually afterward in the repo-config dialog.

### DISCOVERY_MODE_INSTRUCTIONS

Appended to the vision document:

```markdown
## Project Structure

This project uses discovery mode for exploratory analysis.

- `src/` or project root — Scripts and code (git-tracked, commit regularly)
- `data/` — Input data (read-only, do not modify or commit)
- `analysis/{milestone}/{task}/` — All generated outputs go here
  - Milestone and task directory names will be provided in your task prompt
  - Each task directory is self-contained: figures, tables, intermediate files
  - When comparing approaches, use parallel directories under the milestone

## Rules

1. Write all generated outputs to the `analysis/` directory specified in your task prompt
2. Do NOT read from or reference any files in `.archived/` or `deprecated/`
3. Commit code changes with descriptive messages at logical checkpoints
4. Reference output file paths explicitly when reporting findings
```

### Files Changed

- `src/pages/inbox-home.tsx` — Discovery toggle button + state
- `src/stores/execution-store.ts` — Accept discovery overrides in `startSession()`
- `packages/core/src/prompt-templates.ts` — `DISCOVERY_MODE_INSTRUCTIONS` constant

---

## 4. Consolidated Execution Settings

### Repo Config Dialog

Replace the binary "Git workflow / Direct" toggle with a full execution settings panel:

```
Configure Workspace
─────────────────────────────
Machine         [Select machine ▾]
Working Dir     [/path/to/project    ]
Repository      [git@github.com:... ]
Target Branch   [main ▾]

Execution
─────────────────────────────
Delivery Mode   [PR] [Push] [Branch] [Direct]
Worktree        [ON] / OFF          ← hidden when Direct
Auto-merge PRs  [ON] / OFF          ← hidden unless PR mode
Merge Method    [Squash ▾]          ← hidden unless auto-merge ON
```

Delivery mode options shown contextually:

| Mode | When shown | Behavior |
|------|-----------|----------|
| **PR** | Git + remote detected | Branch per task, creates PR |
| **Push** | Git + remote detected | Commits to branch, pushes to remote |
| **Branch** | Git detected | Local branches, auto-merge to main |
| **Direct** | Always | In-place, serial execution |

Save stores the **explicit user choice** — no re-derivation from `deriveDeliveryMode()` on every save.

### Merge Queue Moved

Merge queue toggle and method dropdown moved from `project-overview.tsx` into the repo-config dialog. Shown only in PR mode.

### Files Changed

- `src/components/repo-config-dialog.tsx` — Delivery mode picker, worktree toggle, merge queue
- `src/pages/project-overview.tsx` — Remove merge queue section
- `packages/core/src/types.ts` — Add `useWorktree?: boolean` to Project
- `packages/core/src/db/schema.ts` — Add `use_worktree` column
- `server/routes/dispatch.ts` — Read `project.useWorktree` as default

---

## 5. Output Directory Structure

### Convention

```
project/
├── src/                                    # Code — git-tracked
├── data/                                   # Input data — gitignored
├── analysis/                               # ALL outputs — gitignored
│   ├── {milestone-slug}/                   # One dir per milestone
│   │   ├── {task-slug}/                    # One dir per task
│   │   │   ├── results.tsv
│   │   │   ├── figure.png
│   │   │   └── model.pkl
│   │   └── {another-task-slug}/
│   └── {another-milestone-slug}/
├── .gitignore                              # Ignores analysis/, data/
└── scripts/                                # On git branches per task
```

### Slug Generation

Task and milestone slugs are generated from the full title:

```typescript
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 255)
}
```

Examples:
```
"Refined ESR1-TP53 ChIP co-occupancy with 73bp motif annotation"
→ refined-esr1-tp53-chip-co-occupancy-with-73bp-motif-annotation

"GO/KEGG/Reactome pathway enrichment on ESR1-TP53 target genes"
→ go-kegg-reactome-pathway-enrichment-on-esr1-tp53-target-genes
```

Slug is set **once at task creation** and stored in `metadata.outputDir`. Does not change if the title is renamed.

### Why Milestone Parent Folders

With 20-30 tasks, flat `analysis/` is overwhelming. Milestone grouping:
- Enables `rm -rf analysis/{milestone-slug}/` for milestone prune
- Matches how scientists think about their work (analysis phases)
- ~4-5 tasks per group, navigable

Tasks without a milestone go to `analysis/` root.

### What Gets Gitignored

```gitignore
# Generated outputs (large, regeneratable)
analysis/

# Input data (external, immutable)
data/

# Common output formats (catch stragglers)
*.pkl
*.h5ad
*.parquet
```

### Metadata

Stored on `PlanNode.metadata` (existing JSON field, no schema change):

```typescript
metadata: {
  outputDir: "esr1-downstream/pathway-enrichment-on-esr1-tp53-target-genes",
  script: "python scripts/run_enrichment_t4.py",
  pipelineReady: true,
  outputHash: "sha256:abc123..."
}
```

---

## 6. Code Isolation via Branches

### The Problem Branches Solve

After pruning a task, its scripts remain on disk. Agents find them via `grep`, `find`, `cat` and reuse wrong approaches. No agent ignore file (`.claudeignore`, `.codexignore`, `.aiderignore`, `.geminiignore`) reliably prevents this — all can be bypassed via bash/shell tools.

**The only reliable isolation: the files are not on the checked-out branch.**

### How It Works

```
main: ──●──────────●──────────●──────────●────→
        │          ↑merge     ↑merge     │
        ├─T10──────┘          │          ├─T8 (sees both T10+T6 code)
        │                     │
        ├─T6──────────────────┘
        │
        ├─T2 ✗ (pruned → branch deleted → scripts GONE)
        ├─T3 ✗ (pruned → branch deleted → scripts GONE)
```

- **Scripts** (git-tracked): isolated per branch. Pruned branch = scripts gone. Agent on a new branch cannot find them.
- **Outputs** (gitignored in `analysis/`): persist across branches. All experiment results visible from any branch for comparison.

### Branch Lifecycle

| Event | Git Action |
|-------|-----------|
| Task dispatched | `git checkout -b task/{slug} main` |
| Task completes successfully | `git checkout main && git merge task/{slug} --no-ff` |
| Task pruned | `git branch -D task/{slug}` |
| Milestone pruned | Delete all child task branches |
| Task rerun | New branch from main, old merged code available |

### Delivery Mode Integration

| Delivery Mode | Branch behavior | Outputs in `analysis/` |
|--------------|----------------|----------------------|
| **PR** | Branch + remote push + PR | Yes (gitignored) |
| **Push** | Branch + remote push | Yes (gitignored) |
| **Branch** (discovery default) | Local branch, auto-merge | Yes (gitignored) |
| **Direct** | No branch, in-place | Yes (gitignored) |

Discovery mode uses **Branch** delivery — the lightest git isolation that still provides clean prune. No remote, no PRs, no worktrees.

### Agent Ignore (Defense in Depth)

Branches are the primary isolation. As defense in depth, the agent runner can write agent-specific ignore configs before dispatch. The agent runner knows which agent is being used:

| Agent | Config written |
|-------|---------------|
| Claude Code | `.claude/settings.json` → `permissions.deny` |
| Codex | `AGENTS.md` instructions (`.codexignore` is broken) |
| Aider | `.aiderignore` |
| Gemini CLI | `.geminiignore` |
| Pi (ripgrep-based) | `.gitignore` suffices |

This is belt-and-suspenders — the branch isolation handles the 95% case, agent-specific config catches edge cases.

---

## 7. Prune Behavior

### Task Prune

```
1. Mark task status → 'pruned'
2. Delete task branch: git branch -D task/{slug}
   → Scripts are gone (not on main, never merged)
3. Delete output dir: rm -rf analysis/{milestone-slug}/{task-slug}/
   → Outputs are gone
4. Exclude from context injection (already implemented):
   → Pruned nodes' outputs filtered from dependency context in dispatch
```

### Milestone Prune (Cascade)

```
1. Find all tasks with milestoneId === thisMilestone.id
2. For each child task: prune (steps above)
3. Mark milestone status → 'pruned'
4. rm -rf analysis/{milestone-slug}/  (entire dir, one command)
```

### Prune Cleanup Dialog

When user clicks "Prune" on a task or milestone:

```
┌─────────────────────────────────────────────────┐
│ Prune "ESR1-TP53 Downstream Analysis"           │
│                                                  │
│ This will prune 5 tasks:                        │
│   T4: Pathway enrichment              ✓ done    │
│   T5: Tissue expression               ✓ done    │
│   H3K4me3 enrichment                  ● running │
│   CCND1 ERGE proximity                ✓ done    │
│                                                  │
│ ☑ Delete code branches (recommended)            │
│ ☑ Delete output files (340 MB in analysis/)     │
│                                                  │
│ [Prune & Clean Up]  [Prune Only]  [Cancel]      │
└─────────────────────────────────────────────────┘
```

"Prune Only" marks nodes as pruned but leaves files. Useful when the user wants to keep results for reference.

---

## 8. Task Maturation: Exploration → Pipeline

### The Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                        Task Lifecycle                            │
│                                                                  │
│  PLANNED ──▶ AGENT RUN ──▶ COMPLETED ──▶ PIPELINE-READY        │
│     │           │              │               │                 │
│     │     AI explores,    Script exists,   Can re-execute       │
│     │     writes code,    outputs exist    script directly       │
│     │     produces        but unverified   without AI agent      │
│     │     outputs                                                │
│     │                                                            │
│     │         ◀── follow-up chat ──                              │
│     │        (agent modifies script,                             │
│     │         task stays pipeline-ready)                         │
│     │                                                            │
│     │         ◀── description changed ──                         │
│     │        (needs agent re-exploration,                        │
│     │         drops back to AGENT RUN)                           │
└─────────────────────────────────────────────────────────────────┘
```

### Automatic Detection

After agent completes a task, the agent runner checks what was produced:

```typescript
async function onTaskComplete(task: PlanNode, result: ExecutionResult) {
  const scripts = result.fileChanges
    .filter(f => /\.(py|R|sh|jl)$/.test(f.path))
    .filter(f => f.changeType === 'created' || f.changeType === 'modified')

  if (scripts.length >= 1) {
    // Heuristic: single script = entry point; multiple = pick largest/main
    const mainScript = scripts.length === 1
      ? scripts[0]
      : scripts.find(s => s.path.includes('main') || s.path.includes(slugify(task.title)))
        ?? scripts[0]

    task.metadata.script = `python ${mainScript.path}`
    task.metadata.pipelineReady = true
  }

  task.metadata.outputHash = await hashDirectory(`analysis/${task.metadata.outputDir}`)
}
```

### Rerun Behavior Based on Maturity

| Maturity | What "Rerun" does | Speed | Cost |
|----------|------------------|-------|------|
| No script | Full agent dispatch (Phase 1) | Minutes | $$ |
| Script exists, unverified | Try script; if fails, fall back to agent | Seconds if works | Free / $$ fallback |
| Pipeline-ready | Execute script directly (Phase 2) | Seconds | Free |

### Visual Indicator in Plan Graph

Task nodes display their execution mode:

```
  ┌──────────────────────────┐     ┌──────────────────────────┐
  │ T4: Pathway enrichment   │     │ New analysis task         │
  │ ✓ completed              │     │ ○ planned                │
  │ ⚡ pipeline-ready         │     │ 🤖 needs agent           │
  └──────────────────────────┘     └──────────────────────────┘
```

---

## 9. Cascade Re-execution

### The Problem

When an upstream task's outputs change (via rerun or follow-up chat), all downstream tasks that consumed those outputs are now stale. With 20+ tasks in a DAG, manually identifying and rerunning them is error-prone.

### Staleness Detection

Simple timestamp-based (like Make):

```typescript
function isStale(task: PlanNode, allNodes: PlanNode[]): boolean {
  const outputDir = `analysis/${task.metadata.outputDir}`
  if (!existsSync(outputDir)) return true

  const myNewest = newestMtime(outputDir)

  for (const depId of task.dependencies) {
    const dep = allNodes.find(n => n.id === depId)
    if (!dep?.metadata?.outputDir) continue
    const depNewest = newestMtime(`analysis/${dep.metadata.outputDir}`)
    if (depNewest > myNewest) return true  // upstream is newer
  }
  return false
}
```

Timestamps are sufficient because:
- The scientist is in the loop (not unattended batch execution)
- File modification times update naturally when scripts rerun
- No need for hash-based detection — user already knows what changed

### "Rerun From Here" Flow

```
User clicks "Rerun" on T10
    │
    ▼
┌─ Astro marks T10 + all downstream as stale ─┐
│  T10 ● rerunning                              │
│  T4  ⚠ stale                                  │
│  T5  ⚠ stale                                  │
│  T8  ⚠ stale (depends on T10 + T6)            │
│  T6  ✓ fresh (no dependency on T10)            │
└───────────────────────────────────────────────┘
    │
    ▼
┌─ Execute in topological order ───────────────┐
│  1. Clear T10 output dir                      │
│  2. Run T10 (pipeline if ready, else agent)   │
│  3. T10 done → T4 and T5 can run in parallel  │
│  4. Clear T4 output, run T4                   │
│  5. Clear T5 output, run T5 (parallel with 4) │
│  6. T4+T5+T6 done → T8 can run               │
│  7. Clear T8 output, run T8                   │
│  8. All done. Stale flags cleared.            │
└───────────────────────────────────────────────┘
```

### Follow-Up Chat → Cascade

```
1. User opens follow-up chat on completed T10
2. Agent modifies script and/or outputs (on a branch)
3. Branch merged to main
4. Astro re-hashes T10 output dir
5. If hash changed:
   a. Mark all downstream as ⚠ stale
   b. Show banner: "T10 outputs changed. 4 downstream tasks stale."
   c. [Rerun All Stale]  [Rerun Selected...]  [Dismiss]
6. Default: auto-cascade rerun (configurable toggle to disable)
```

### Auto-Cascade Toggle

| Setting | Behavior |
|---------|----------|
| **Auto-cascade ON** (default) | Follow-up change → auto-rerun all stale downstream |
| **Auto-cascade OFF** | Just mark stale, user triggers rerun manually |

OFF is useful for "batch edit mode" — user tweaks multiple upstream tasks before triggering one cascade.

### Early Termination Optimization

During cascade, if a task's output hash is identical before vs after rerun (the upstream change didn't affect this task's results), skip its downstream:

```
T10 changed → rerun T4 → T4 output identical → skip T8 (not actually stale)
```

This avoids unnecessary reruns when changes don't propagate.

---

## 10. Pipeline Engine (Built into Agent Runner)

### Why Build, Not Use Snakemake

| Reason | Detail |
|--------|--------|
| **Agent-powered reruns** | Pipeline-not-ready tasks need AI agent dispatch, not just script execution. Snakemake can't do this. |
| **Seamless UI integration** | Real-time stale indicators, progress streaming, one-click cascade — all native in Astro's plan graph |
| **Git branch management** | Branch create/merge/delete per task, integrated with prune and rerun |
| **Follow-up chat → cascade** | Chat modifies outputs → automatic downstream invalidation. No external tool supports this. |
| **Mixed execution modes** | Some tasks pipeline-ready (fast script), others need agent (creative). Same cascade handles both. |
| **No external dependency** | Works on any machine without Snakemake/Nextflow installed |
| **Small scope** | ~400 lines — the complex parts (DAG, dispatch, HPC) already exist in Astro |

### Architecture

```
packages/agent-runner/src/lib/pipeline/
├── dag.ts           — Topo sort, find downstream, staleness check    (~80 lines)
├── executor.ts      — Run task: script (fast) or agent (full)        (~120 lines)
├── git.ts           — Branch create/merge/delete per execution       (~80 lines)
├── hasher.ts        — Directory content hashing                      (~30 lines)
└── index.ts         — Cascade orchestrator                           (~100 lines)
```

### Core: Cascade Executor

```typescript
async function cascadeRerun(taskId: string, nodes: PlanNode[]) {
  const stale = [taskId, ...findStaleDownstream(taskId, nodes)]
  const sorted = topologicalSort(stale, nodes)
  const levels = groupByTopologicalLevel(sorted)

  for (const level of levels) {
    // Tasks in the same level have no mutual dependencies → run in parallel
    await Promise.all(level.map(task => rerunTask(task)))
  }
}

async function rerunTask(task: PlanNode) {
  const outputDir = `analysis/${task.metadata.outputDir}`

  // 1. Clear previous outputs
  await rm(outputDir, { recursive: true, force: true })

  // 2. Execute based on maturity
  if (task.metadata.pipelineReady && task.metadata.script) {
    // Phase 2: fast, deterministic script execution
    await exec(`git checkout -b task/${task.slug} main`)
    await exec(task.metadata.script)
    await exec(`git checkout main && git merge task/${task.slug} --no-ff`)
    await exec(`git branch -d task/${task.slug}`)
  } else {
    // Phase 1: full agent dispatch
    await dispatchToAgent(task)
  }

  // 3. Update hash
  task.metadata.outputHash = await hashDirectory(outputDir)
}
```

### Dispatch Integration

New dispatch mode in `server/routes/dispatch.ts`:

```typescript
// Existing modes:
POST /api/dispatch          — single task dispatch (agent)

// New:
POST /api/dispatch/rerun    — rerun single task (pipeline or agent)
POST /api/dispatch/cascade  — rerun task + all stale downstream
```

The cascade endpoint:
1. Receives target task ID
2. Walks DAG to find all stale downstream
3. Returns the execution plan (for UI preview / dry-run)
4. Executes in topological order
5. Streams progress via existing SSE pipeline

---

## 11. Context Injection Updates

### Active vs Pruned Scripts

When dispatching a task, the context assembler includes a file inventory:

```markdown
## Working Directory State

Active scripts (you may reference/modify):
- scripts/cobind_all_chipseq.py (from: "ESR1-TP53 ChIP co-occupancy")
- scripts/run_enrichment_t4.py (from: "Pathway enrichment")

Your outputs should go to:
- analysis/esr1-downstream/pathway-enrichment-on-esr1-tp53-target-genes/

Your inputs (from upstream tasks):
- analysis/both-co-occupancy-pipelines/esr1-tp53-cobind/.../all_chipseq_genes.tsv
```

This steers the agent to the right files even on first exploration.

### Pruned Node Exclusion

Already implemented: pruned nodes' `executionOutput` is filtered from dependency context in `server/routes/dispatch.ts`:

```typescript
const depNode = allProjectNodes.find(n => n.clientId === depId)
if (!depNode) continue
if (depNode.status === 'pruned') continue  // skip pruned outputs
```

---

## 12. Complete Task Lifecycle

### Happy Path: New Task

```
1. Task created (by user or plan generation)
   → metadata.outputDir = "{milestone-slug}/{slugify(title)}"
   → metadata.script = null
   → metadata.pipelineReady = false

2. Task dispatched (first run)
   → git checkout -b task/{slug} main
   → mkdir -p analysis/{metadata.outputDir}
   → Agent explores, writes scripts, produces outputs
   → Agent completes

3. Post-completion
   → Detect script: metadata.script = "python scripts/analysis.py"
   → Hash outputs: metadata.outputHash = hash(analysis/{outputDir})
   → metadata.pipelineReady = true
   → git checkout main && git merge task/{slug}

4. Task is now pipeline-ready
   → Future reruns execute script directly (seconds, not minutes)
```

### Rerun (Same Description)

```
1. Clear analysis/{outputDir}/*
2. git checkout -b task/{slug}-rerun main
3. Execute metadata.script (fast, deterministic)
4. Merge branch
5. Update outputHash
6. If hash changed → mark downstream stale
```

### Rerun (Different Description / Follow-Up Chat)

```
1. Clear analysis/{outputDir}/*
2. git checkout -b task/{slug}-v2 main
3. Dispatch to AI agent with new description
4. Agent writes new/modified script, produces outputs
5. Post-completion: update metadata.script, outputHash
6. Merge branch
7. If hash changed → mark downstream stale → optional cascade
```

### Prune

```
1. git branch -D task/{slug}
   → Scripts removed (never merged, or reverted)
2. rm -rf analysis/{milestone-slug}/{task-slug}/
   → Outputs removed
3. Mark status → 'pruned'
4. Downstream tasks: mark stale or cascade prune
```

### New Task Added to Existing Milestone

```
1. metadata.outputDir = "{existing-milestone-slug}/{slugify(new-title)}"
2. Dispatch to agent → creates new output dir under milestone
3. Independent of other tasks in same milestone
```

### Task Moved Between Milestones

```
1. mv analysis/{old-milestone}/{task-slug} analysis/{new-milestone}/{task-slug}
2. Update metadata.outputDir path
3. Downstream input paths auto-resolved from metadata
```

### Milestone Prune

```
1. For each child task: delete branch + delete output dir
2. rm -rf analysis/{milestone-slug}/  (catches any stragglers)
3. Mark milestone + all children → 'pruned'
```

---

## 13. UI/UX

### Plan Graph Indicators

Task nodes show execution maturity and staleness:

```
 ┌────────────────────────────┐    ┌────────────────────────────┐
 │ T10: ESR1-TP53 cobind      │    │ T4: Pathway enrichment     │
 │ ✓ completed                │    │ ⚠ stale                    │
 │ ⚡ pipeline-ready            │    │ ⚡ pipeline-ready            │
 └────────────────────────────┘    └────────────────────────────┘

 ┌────────────────────────────┐    ┌────────────────────────────┐
 │ New analysis task           │    │ T6: AR-TP53 cobind         │
 │ ○ planned                  │    │ ✓ completed                │
 │ 🤖 needs agent              │    │ ✓ fresh                    │
 └────────────────────────────┘    └────────────────────────────┘
```

### Context Menu Actions

Right-click on a task node:

```
┌──────────────────────┐
│ ▶ Run                │  ← dispatch (agent or pipeline based on maturity)
│ 🔄 Rerun             │  ← force rerun this task
│ 🔄 Rerun from here   │  ← rerun this + all stale downstream
│ 💬 Follow up         │  ← open chat to modify this task
│ ──────────────────── │
│ ✂ Prune             │  ← prune with cleanup dialog
│ 📋 Copy output path  │  ← copy analysis/{...} path
└──────────────────────┘
```

### Stale Cascade Banner

When upstream outputs change (via follow-up chat or rerun):

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠ T10 outputs changed. 4 downstream tasks are stale.       │
│                                                              │
│   T4 (pathway enrichment)        ⚠ stale  ⚡ pipeline      │
│   T5 (tissue expression)         ⚠ stale  ⚡ pipeline      │
│   T8 (sexual dimorphism)         ⚠ stale  ⚡ pipeline      │
│   T9 (integrated report)         ⚠ stale  🤖 agent         │
│                                                              │
│   Estimated rerun: ~2 min (3 pipeline + 1 agent)            │
│                                                              │
│   [Rerun All]  [Rerun Selected...]  [Dismiss]               │
└─────────────────────────────────────────────────────────────┘
```

### Pipeline Status View

A "Pipeline" tab on the project view showing execution readiness:

```
Pipeline Status                           [Auto-cascade: ON ▾]
────────────────────────────────────────────────────────────
T1  Fetch ChIP-seq peaks          ✓ fresh   ⚡ pipeline    12s
T10 ESR1-TP53 cobind              ● modified ⚡ pipeline    42s
T6  AR-TP53 cobind                ✓ fresh   ⚡ pipeline    38s
T4  Pathway enrichment            ⚠ stale   ⚡ pipeline    18s
T5  Tissue expression             ⚠ stale   ⚡ pipeline    25s
T8  Sexual dimorphism             ⚠ stale   ⚡ pipeline    31s
T9  Integrated report             ⚠ stale   🤖 agent      ~5min

                          Total rerun: ~2 min (6 pipeline + 1 agent)
                          [Rerun All Stale]  [Dry Run]
```

---

## 14. Implementation Order

| Step | What | Files | Risk |
|------|------|-------|------|
| 1 | Discovery mode toggle | `inbox-home.tsx`, `execution-store.ts`, `prompt-templates.ts` | Low |
| 2 | Consolidated execution settings | `repo-config-dialog.tsx`, `project-overview.tsx` | Low |
| 3 | `useWorktree` schema + dispatch | `types.ts`, `schema.ts`, `dispatch.ts` | Medium |
| 4 | Milestone-aware prune | `plan-store.ts`, `node-inspector.tsx` | Low |
| 5 | Pruned node context exclusion | `dispatch.ts` context assembly | Low |
| 6 | Output dir generation (`metadata.outputDir`) | `plan-store.ts` (on node create) | Low |
| 7 | Output dir in dispatch prompt | `prompt-templates.ts`, context assembler | Low |
| 8 | Pipeline engine: DAG + staleness | `agent-runner/pipeline/dag.ts` | Medium |
| 9 | Pipeline engine: executor | `agent-runner/pipeline/executor.ts` | Medium |
| 10 | Pipeline engine: git integration | `agent-runner/pipeline/git.ts` | Medium |
| 11 | "Rerun from here" dispatch endpoint | `dispatch.ts` | Medium |
| 12 | "Rerun from here" UI | Plan graph context menu, cascade banner | Medium |
| 13 | Auto-maturation detection | Agent runner post-completion hook | Low |
| 14 | Pipeline status view | New project tab component | Low |

Steps 1-5 are already partially implemented (from prior work in this session). Steps 6-14 are new.

---

## 15. Key Files

| File | Changes |
|------|---------|
| `src/pages/inbox-home.tsx` | Discovery mode toggle |
| `src/stores/execution-store.ts` | Accept discovery overrides in startSession |
| `src/components/repo-config-dialog.tsx` | Consolidated execution settings |
| `src/pages/project-overview.tsx` | Remove merge queue (moved to repo-config) |
| `packages/core/src/types.ts` | `useWorktree` on Project |
| `packages/core/src/db/schema.ts` | `use_worktree` column |
| `packages/core/src/prompt-templates.ts` | Discovery instructions, output dir in prompts |
| `server/routes/dispatch.ts` | Cascade rerun endpoint, pruned node exclusion |
| `src/stores/plan-store.ts` | `pruneMilestone()`, `metadata.outputDir` generation |
| `src/components/node-inspector.tsx` | Milestone-aware prune, rerun actions |
| `packages/agent-runner/src/lib/pipeline/` | **New**: Pipeline engine (~400 lines) |

---

## 16. Verification

1. **Discovery toggle**: Create project with Discovery ON → `deliveryMode: 'branch'`, `useWorktree: false`, `mergeQueueEnabled: false`. Vision doc includes discovery instructions.
2. **Output dirs**: Complete a task → outputs appear in `analysis/{milestone}/{task}/`. Different task's outputs don't collide.
3. **Branch isolation**: Prune a task → its branch deleted, scripts gone from main. New agent dispatched for another task cannot find pruned scripts.
4. **Milestone prune**: Prune milestone → all child branches deleted, `analysis/{milestone}/` removed, child tasks marked pruned.
5. **Pipeline maturation**: Complete task with Python script → `metadata.pipelineReady = true`, `metadata.script` set. Rerun uses script directly (seconds, not minutes).
6. **Cascade rerun**: Modify T10 via follow-up chat → T4, T5, T8 marked stale. Click "Rerun All Stale" → tasks execute in topological order, pipeline-ready tasks run fast.
7. **Stale detection**: Touch upstream output → downstream correctly detected as stale. Upstream output unchanged → downstream stays fresh.
8. **Build**: `npm run build` passes. `npm run lint` passes.

---

## 17. Known Gaps & Solutions

### 17.1 Direct Mode Fallback

**Gap:** The design assumes branch delivery for code isolation. Users who choose direct mode get no code isolation on prune — stale scripts remain on disk.

**Solution:** Layered degradation.

| Delivery Mode | Code isolation | Output isolation | Prune cleanup |
|--------------|---------------|-----------------|---------------|
| **Branch** (recommended) | Full (branch delete) | Full (rm -rf dir) | Complete |
| **Direct** | Prompt-only (weak) | Full (rm -rf dir) | Outputs clean, code best-effort |

For direct mode specifically:
1. **Auto-move to `deprecated/`:** On prune, use git diff between task start/end SHAs to identify files the task created. Move them to `deprecated/{task-slug}/`. Not bulletproof (agents can `find deprecated/`) but reduces accidental reuse.
2. **Strong prompt steering:** Context injection includes explicit "DO NOT reference" list for deprecated scripts, plus "Write new scripts from scratch" instruction.
3. **Recommend branch mode:** When user selects Direct in repo-config, show an info banner: "Branch mode provides better isolation for exploratory projects. Direct mode relies on prompt-based steering which is less reliable."

SHA bookending for direct mode:

```typescript
// Record HEAD before and after task execution
const startSha = execSync('git rev-parse HEAD').toString().trim()
// ... agent runs ...
const endSha = execSync('git rev-parse HEAD').toString().trim()

// On prune: identify task's files
const taskFiles = execSync(`git diff --name-only ${startSha}..${endSha}`).toString().split('\n')
// Move to deprecated/
for (const file of taskFiles) {
  mv(file, `deprecated/${taskSlug}/${basename(file)}`)
}
```

Store `startSha` and `endSha` on `metadata` for later use.

### 17.2 Multi-Machine Cascade

**Gap:** Tasks may run on different machines (laptop, HPC cluster, cloud). Cascade rerun needs to dispatch each task to the correct machine, and `analysis/` directories are local to each machine.

**Solution:** The cascade orchestrator runs on the **server** (not the agent runner), and dispatches each task to its assigned machine via the existing dispatch pipeline.

```
Server (cascade orchestrator)
  │
  ├── Dispatch T10 → Machine A (HPC, SLURM)
  │     └── Runs script, outputs to analysis/ on Machine A
  │
  ├── Dispatch T4 → Machine B (laptop)
  │     └── Needs T10 outputs... but they're on Machine A
  │
  └── Problem: T4 can't read T10's outputs across machines
```

**Cross-machine output transfer:**

Option A: **Shared filesystem** (NFS, FUSE mount) — common on HPC. If machines share a filesystem, `analysis/` is the same physical location. No transfer needed.

Option B: **Output sync via relay** — after task completes, agent runner uploads key output files to the server (or object storage). Downstream task's machine downloads them before execution. Add to task metadata:

```typescript
metadata: {
  outputDir: "esr1-downstream/pathway-enrichment",
  outputFiles: [
    { path: "all_chipseq_genes.tsv", size: 2400000, hash: "sha256:..." }
  ],
  machine: "hpc-cluster-1"
}
```

Option C: **Pin dependent tasks to same machine** — simplest. If T4 depends on T10, and T10 ran on Machine A, dispatch T4 to Machine A too. The dispatch engine already knows task dependencies; extend it to prefer the upstream task's machine.

**Recommendation:** Start with Option C (same-machine pinning). It handles 90% of cases. Add Option B (output sync) later for true cross-machine pipelines.

### 17.3 Project Scaffolding

**Gap:** When a discovery mode project starts, who creates `analysis/`, `data/`, `.gitignore`? Leaving it to the agent is unreliable — the agent might not follow the convention on its first run.

**Solution:** Agent runner scaffolds the project directory on first dispatch for a discovery-mode project.

```typescript
// In agent-runner, before first task execution
async function scaffoldDiscoveryProject(workdir: string, project: Project) {
  if (project.deliveryMode !== 'branch') return
  if (existsSync(join(workdir, '.astro', 'scaffolded'))) return  // already done

  // Create directories
  await mkdir(join(workdir, 'analysis'), { recursive: true })
  await mkdir(join(workdir, 'data'), { recursive: true })

  // Write .gitignore if it doesn't exist or doesn't cover analysis/
  const gitignorePath = join(workdir, '.gitignore')
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : ''
  if (!existing.includes('analysis/')) {
    const additions = [
      '',
      '# Astro discovery mode — generated outputs',
      'analysis/',
      '',
      '# Input data (external, immutable)',
      'data/',
    ].join('\n')
    appendFileSync(gitignorePath, additions)
  }

  // Mark as scaffolded
  await mkdir(join(workdir, '.astro'), { recursive: true })
  writeFileSync(join(workdir, '.astro', 'scaffolded'), new Date().toISOString())

  // Commit scaffold
  execSync('git add .gitignore && git commit -m "chore: scaffold discovery project structure"', { cwd: workdir })
}
```

Runs once, idempotent, committed to git so all branches inherit it.

### 17.4 Script Location Convention

**Gap:** The doc is ambiguous about where scripts live — project root, `scripts/`, or wherever the agent decides.

**Solution:** Don't enforce a location. The agent writes scripts wherever it naturally would (project root is common for scientists). `metadata.script` records the exact command needed to re-execute.

```typescript
metadata: {
  // Could be any of these — agent decides, Astro records:
  script: "python cobind_all_chipseq.py",
  script: "python scripts/run_enrichment.py",
  script: "Rscript analysis_pipeline.R",
  script: "bash run_analysis.sh",
}
```

The discovery mode prompt gently suggests organization but doesn't enforce:

```markdown
When writing analysis scripts, consider organizing them in a `scripts/` directory.
But any location is fine — Astro will track the script path automatically.
```

The maturation detector captures whatever path the agent used. Pipeline reruns invoke that exact command.

### 17.5 Pipeline Export (Snakefile / Nextflow / Makefile)

**Gap:** Scientists publishing papers need reproducibility artifacts independent of Astro. The pipeline should be exportable to the standard tools their community uses.

**Solution:** "Export Pipeline" action on the project view that generates a standalone pipeline definition in the user's preferred format.

#### Supported Export Targets

| Format | File | Use case | Community |
|--------|------|----------|-----------|
| **Snakemake** | `Snakefile` | Bioinformatics, genomics | Most popular in computational biology |
| **Nextflow** | `main.nf` | Cloud genomics, nf-core pipelines | Standard for large-scale genomics |
| **Makefile** | `Makefile` | Universal, zero deps | Works everywhere, no install needed |

#### Snakemake Export

```python
# Generated by Astro — standalone reproducible pipeline
# Run with: snakemake -j4
# Conda: snakemake --use-conda -j4

rule all:
    input: "analysis/comparative/sexual-dimorphism"

rule esr1_tp53_cobind:
    input: "data/"
    output: directory("analysis/both-co-occupancy-pipelines/esr1-tp53-cobind")
    conda: "envs/analysis.yaml"
    shell: "python scripts/cobind_all_chipseq.py"

rule pathway_enrichment:
    input: "analysis/both-co-occupancy-pipelines/esr1-tp53-cobind"
    output: directory("analysis/esr1-downstream/pathway-enrichment")
    conda: "envs/analysis.yaml"
    shell: "python scripts/run_enrichment_t4.py"
```

#### Nextflow Export

```groovy
// Generated by Astro — standalone reproducible pipeline
// Run with: nextflow run main.nf

process esr1_tp53_cobind {
    publishDir 'analysis/both-co-occupancy-pipelines/esr1-tp53-cobind', mode: 'copy'
    conda 'envs/analysis.yaml'

    input:
    path data_dir from Channel.fromPath('data/')

    output:
    path '*' into cobind_results

    script:
    """
    python scripts/cobind_all_chipseq.py
    """
}

process pathway_enrichment {
    publishDir 'analysis/esr1-downstream/pathway-enrichment', mode: 'copy'
    conda 'envs/analysis.yaml'

    input:
    path cobind from cobind_results

    output:
    path '*' into enrichment_results

    script:
    """
    python scripts/run_enrichment_t4.py
    """
}
```

#### Makefile Export

```makefile
# Generated by Astro — standalone reproducible pipeline
# Run with: make -j4

.PHONY: all clean

all: analysis/comparative/sexual-dimorphism

analysis/both-co-occupancy-pipelines/esr1-tp53-cobind: data/
	python scripts/cobind_all_chipseq.py

analysis/esr1-downstream/pathway-enrichment: analysis/both-co-occupancy-pipelines/esr1-tp53-cobind
	python scripts/run_enrichment_t4.py

clean:
	rm -rf analysis/
```

#### Environment Isolation Strategy

Pipeline reproducibility requires pinning the execution environment. Different tools suit different contexts:

| Tool | Best for | Lockfile | Speed | Isolation |
|------|----------|----------|-------|-----------|
| **Docker** | Full reproducibility, CI, publication | `Dockerfile` | Slow build, fast run | Complete (OS-level) |
| **uv** | Python-only projects | `uv.lock` | Very fast | Virtualenv |
| **pixi** (mamba-based) | Python + R + system deps | `pixi.lock` | Fast | Conda env |
| **pak** | R-only projects | `pak.lock` / `renv.lock` | Fast | R library |
| **mamba/micromamba** | Legacy conda envs | `environment.yml` | Fast (not conda) | Conda env |

**Never use conda directly** — mamba/micromamba are drop-in replacements that are 10-50x faster.

Astro auto-detects the project's environment tool and generates the appropriate lockfile:

```typescript
function detectEnvironmentTool(workdir: string): EnvironmentTool {
  if (existsSync(join(workdir, 'Dockerfile')))       return 'docker'
  if (existsSync(join(workdir, 'pyproject.toml')))    return 'uv'       // uv uses pyproject.toml
  if (existsSync(join(workdir, 'pixi.toml')))         return 'pixi'
  if (existsSync(join(workdir, 'renv.lock')))         return 'pak'
  if (existsSync(join(workdir, 'environment.yml')))   return 'mamba'
  return 'uv'  // default for new projects — fastest, simplest
}
```

#### Environment in Exported Pipelines

Each export format uses the detected environment tool:

**Snakemake + uv:**
```python
rule esr1_tp53_cobind:
    input: "data/"
    output: directory("analysis/both-co-occupancy-pipelines/esr1-tp53-cobind")
    shell: "uv run python scripts/cobind_all_chipseq.py"
```

**Snakemake + Docker:**
```python
container: "docker://astro-pipeline:latest"

rule esr1_tp53_cobind:
    input: "data/"
    output: directory("analysis/both-co-occupancy-pipelines/esr1-tp53-cobind")
    shell: "python scripts/cobind_all_chipseq.py"
```

**Nextflow + Docker:**
```groovy
process esr1_tp53_cobind {
    container 'astro-pipeline:latest'
    // ...
}
```

**Nextflow + mamba:**
```groovy
process esr1_tp53_cobind {
    conda 'envs/environment.yml'
    // ...
}
```

#### Dockerfile Generation

For maximum reproducibility (publication-grade), Astro can auto-generate a Dockerfile:

```dockerfile
# Generated by Astro
FROM python:3.11-slim

# System deps (if pixi/mamba detected)
RUN apt-get update && apt-get install -y bedtools samtools

# Python deps
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen

# Pipeline scripts
COPY scripts/ scripts/

# Entry point
ENTRYPOINT ["snakemake", "-j4"]
```

#### Generator Architecture

All export targets share the same core logic — read the DAG, emit format-specific syntax:

```typescript
interface PipelineExporter {
  formatName: string
  fileExtension: string
  generate(tasks: PlanNode[], edges: Edge[], options: ExportOptions): string
}

interface ExportOptions {
  envTool: 'docker' | 'uv' | 'pixi' | 'pak' | 'mamba'
  includeEnvDefs: boolean
  includeDockerfile: boolean
}

const readyTasks = nodes.filter(n => n.metadata?.pipelineReady && n.metadata?.script)
const sorted = topoSort(readyTasks)

const exporters: Record<string, PipelineExporter> = {
  snakemake: new SnakemakeExporter(),
  nextflow:  new NextflowExporter(),
  makefile:  new MakefileExporter(),
}

const envTool = detectEnvironmentTool(workdir)
const output = exporters[format].generate(sorted, edges, { envTool, includeEnvDefs: true })
```

#### What Gets Exported Alongside

```
pipeline-export/
├── Snakefile (or main.nf or Makefile)
├── scripts/                    # Copies of all task scripts
│   ├── cobind_all_chipseq.py
│   ├── run_enrichment_t4.py
│   └── ...
├── envs/                       # Environment definition (one of):
│   ├── pyproject.toml + uv.lock       # if uv
│   ├── pixi.toml + pixi.lock          # if pixi
│   ├── environment.yml                 # if mamba
│   └── renv.lock                       # if pak (R)
├── Dockerfile                  # Optional, for publication-grade reproducibility
├── README.md                   # Auto-generated documentation
│   ├── Pipeline overview (from project description)
│   ├── What each step does (from task descriptions)
│   ├── Input data requirements
│   ├── How to run (with and without Docker)
│   └── Output directory structure
└── config.yaml                 # Parameters extracted from task descriptions
```

**UI:** Buttons in the Pipeline Status view:

```
[Export Pipeline ▾]
  ├── Snakemake
  ├── Nextflow
  └── Makefile

[Environment ▾]                 ← auto-detected, user can override
  ├── uv (Python)        ● detected
  ├── pixi (Python + R + system)
  ├── mamba (conda compat)
  ├── Docker (full isolation)
  └── pak (R only)
```

Writes to project root or a `pipeline-export/` subdirectory. Committed to git.

### 17.5.1 Pipeline Verification (Reproducibility Testing)

**Gap:** An exported pipeline might not reproduce the same results as the original Astro agent execution. Non-determinism (random seeds, API calls, floating-point order, timestamps) can cause silent divergence.

**Solution:** Optional "Verify Pipeline" action that re-executes the exported pipeline and compares outputs against stored hashes.

#### Verification Flow

```
User clicks [Verify Pipeline]
    │
    ▼
┌─ Preparation ─────────────────────────────────────────┐
│ 1. Record current output hashes for all pipeline-ready │
│    tasks (from metadata.outputHash)                    │
│ 2. Move current analysis/ to analysis.reference/       │
│ 3. Run the exported pipeline from scratch:             │
│    snakemake -j4  (or nextflow run main.nf)           │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Comparison ──────────────────────────────────────────┐
│ 4. Hash each task's output dir in fresh analysis/      │
│ 5. Compare against reference hashes                    │
│ 6. Report:                                             │
│                                                        │
│    Pipeline Verification Results                       │
│    ──────────────────────────────────────              │
│    T10 ESR1-TP53 cobind          ✓ identical           │
│    T6  AR-TP53 cobind            ✓ identical           │
│    T4  Pathway enrichment        ⚠ differs (2 files)  │
│    T5  Tissue expression         ✓ identical           │
│                                                        │
│    T4 diff details:                                    │
│      enrichment.tsv: 99.97% match (float rounding)    │
│      barplot.png:    binary differs (timestamp in PNG) │
│                                                        │
│ 7. Restore analysis.reference/ → analysis/             │
└────────────────────────────────────────────────────────┘
```

#### Comparison Modes

Not all outputs are byte-identical across runs. The verifier supports tiered comparison:

| File type | Comparison method | Tolerance |
|-----------|------------------|-----------|
| `.tsv`, `.csv` | Numeric diff (per-cell) | Configurable: exact, 1e-6, 1e-3 |
| `.bed`, `.gtf` | Sorted line diff | Exact after sorting |
| `.json` | Semantic JSON diff | Key-order independent |
| `.png`, `.pdf` | Perceptual hash (pHash) | Threshold: 95% similarity |
| `.pkl`, `.h5ad` | SHA-256 | Exact (binary) |
| Other binary | SHA-256 | Exact |

```typescript
interface VerificationResult {
  taskId: string
  taskTitle: string
  status: 'identical' | 'within_tolerance' | 'differs' | 'missing'
  files: {
    path: string
    referenceHash: string
    verifiedHash: string
    match: boolean
    detail?: string  // "float rounding in column 3" / "PNG metadata differs"
  }[]
}
```

#### Handling Non-Determinism

Common sources and fixes that the verifier suggests:

| Source | Detection | Suggested fix |
|--------|-----------|---------------|
| Random seeds | Numeric diff varies across runs | Add `random.seed(42)` / `np.random.seed(42)` to script |
| Timestamps in output | PNG/PDF metadata differs, data identical | Strip metadata: `exiftool -all= output.png` |
| Float ordering | `.tsv` rows in different order, values match | Sort output before writing |
| API responses | Entire output differs | Cache API responses locally in `data/` |
| Python dict ordering | JSON keys in different order | Use `json.dumps(sort_keys=True)` |

After verification, Astro can optionally **auto-inject determinism fixes** into the scripts:

```typescript
// If random seed issue detected, suggest/apply:
const fix = `import random; random.seed(42); import numpy as np; np.random.seed(42)\n`
// Prepend to script and re-verify
```

#### UI

```
Pipeline Status                               [Auto-cascade: ON ▾]
─────────────────────────────────────────────────────────────────
...
[Export Pipeline ▾]  [Verify Pipeline]  [Rerun All Stale]  [Dry Run]

Verification running... ████████░░░░ 6/10 tasks verified
```

After verification:

```
┌──────────────────────────────────────────────────────────┐
│ Pipeline Verification Complete                            │
│                                                           │
│ 8/10 tasks: ✓ identical                                  │
│ 1/10 tasks: ⚠ within tolerance (float rounding)          │
│ 1/10 tasks: ✗ differs (random seed not fixed)            │
│                                                           │
│ Overall: ⚠ Mostly reproducible (9/10 within tolerance)   │
│                                                           │
│ [Fix Non-Determinism]  [Export Verified Pipeline]  [Close]│
└──────────────────────────────────────────────────────────┘
```

"Export Verified Pipeline" stamps the exported pipeline with a verification badge and includes the comparison report, suitable for supplementary materials in a publication.

### 17.6 Recovery from Accidental Prune

**Gap:** Prune deletes output directories (`rm -rf`). No undo for outputs. Git branches can be recovered via `git reflog` but outputs cannot.

**Solution:** Soft-delete with TTL.

```typescript
async function pruneTaskOutputs(task: PlanNode, workdir: string) {
  const outputDir = join(workdir, 'analysis', task.metadata.outputDir)
  const trashDir = join(workdir, '.trash', task.metadata.outputDir)

  if (existsSync(outputDir)) {
    // Move to .trash/ instead of deleting
    await mkdir(dirname(trashDir), { recursive: true })
    await rename(outputDir, trashDir)

    // Record TTL metadata
    writeFileSync(join(trashDir, '.prune-meta.json'), JSON.stringify({
      prunedAt: new Date().toISOString(),
      taskId: task.id,
      taskTitle: task.title,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()  // 7 days
    }))
  }
}
```

`.trash/` is gitignored. A periodic cleanup job (or pre-dispatch hook) purges expired entries:

```typescript
async function purgeExpiredTrash(workdir: string) {
  const trashDir = join(workdir, '.trash')
  if (!existsSync(trashDir)) return

  for (const entry of readdirSync(trashDir, { recursive: true })) {
    const metaPath = join(trashDir, entry, '.prune-meta.json')
    if (!existsSync(metaPath)) continue
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    if (new Date(meta.expiresAt) < new Date()) {
      await rm(join(trashDir, entry), { recursive: true })
    }
  }
}
```

**Recovery UI:** In the prune cleanup dialog, add a note:

```
Output files will be moved to .trash/ and automatically deleted after 7 days.
To recover: mv .trash/{task-slug} analysis/{milestone}/{task-slug}
```

For git branches: `git reflog` shows deleted branches for ~90 days. Include the branch name in the prune confirmation dialog so the user can recover if needed.

### 17.7 Environment Capture

**Gap:** Pipeline reruns assume the same execution environment. If packages changed between runs, scripts may fail or produce different results.

**Solution:** Auto-detect and capture the environment tool at task completion, using the same hierarchy from Section 17.5.

#### Detection and Snapshot

After task completion, the agent runner detects and snapshots the active environment:

```typescript
async function captureEnvironment(workdir: string): Promise<EnvironmentSnapshot> {
  // Detect what's being used (same logic as export)
  const tool = detectEnvironmentTool(workdir)

  switch (tool) {
    case 'uv':
      // uv.lock is already deterministic — just record it exists
      return { tool: 'uv', lockfile: 'uv.lock', python: await getPythonVersion() }

    case 'pixi':
      // pixi.lock is already deterministic
      return { tool: 'pixi', lockfile: 'pixi.lock' }

    case 'mamba':
      // Export current env (never use conda — always mamba/micromamba)
      await exec('micromamba env export > environment.lock.yml', { cwd: workdir })
      return { tool: 'mamba', lockfile: 'environment.lock.yml' }

    case 'pak':
      // renv.lock is already deterministic
      return { tool: 'pak', lockfile: 'renv.lock' }

    case 'docker':
      // Image digest is the lock
      const digest = await exec('docker inspect --format={{.Id}} astro-pipeline')
      return { tool: 'docker', imageDigest: digest.trim() }

    default:
      // Fallback: generate uv.lock from current pip state
      await exec('uv pip compile --generate-hashes -o requirements.lock', { cwd: workdir })
      return { tool: 'uv', lockfile: 'requirements.lock', python: await getPythonVersion() }
  }
}
```

#### Stored on Task Metadata

```typescript
metadata: {
  script: "python scripts/run_enrichment.py",
  pipelineReady: true,
  environment: {
    tool: "uv",
    lockfile: "uv.lock",
    python: "3.11.5"
  }
}
```

#### Rerun with Environment Restoration

```typescript
async function rerunTask(task: PlanNode, workdir: string) {
  const env = task.metadata.environment
  let cmd = task.metadata.script

  switch (env?.tool) {
    case 'uv':
      cmd = `uv run ${cmd}`
      break
    case 'pixi':
      cmd = `pixi run ${cmd}`
      break
    case 'mamba':
      const envName = task.metadata.environment.envName || 'astro-pipeline'
      cmd = `micromamba run -n ${envName} ${cmd}`
      break
    case 'pak':
      cmd = `Rscript -e 'renv::restore()' && ${cmd}`
      break
    case 'docker':
      cmd = `docker run --rm -v ${workdir}:/work -w /work astro-pipeline ${cmd}`
      break
  }

  await exec(cmd, { cwd: workdir })
}
```

#### Project-Level Default

Most scientific projects use a single environment for all tasks. Set once in repo-config:

```
Environment Tool    [uv ▾]        ← auto-detected, user can override
```

Per-task override is possible (e.g., one task needs R while the rest use Python) but rarely needed.

### 17.8 Input Data Versioning

**Gap:** If `data/samples.h5ad` is replaced with a newer version, ALL tasks are potentially stale. The staleness check only looks at upstream task outputs, not root input data files.

**Solution:** Treat root input data as a virtual "source node" in the DAG.

```typescript
function isStale(task: PlanNode, allNodes: PlanNode[], dataDir: string): boolean {
  const outputDir = `analysis/${task.metadata.outputDir}`
  if (!existsSync(outputDir)) return true
  const myNewest = newestMtime(outputDir)

  // Check upstream task outputs (existing logic)
  for (const depId of task.dependencies) {
    const dep = allNodes.find(n => n.id === depId)
    if (!dep?.metadata?.outputDir) continue
    if (newestMtime(`analysis/${dep.metadata.outputDir}`) > myNewest) return true
  }

  // Check root input data — tasks with no upstream dependencies
  // are "root" tasks that read directly from data/
  if (task.dependencies.length === 0 || isRootDataConsumer(task)) {
    if (newestMtime(dataDir) > myNewest) return true
  }

  return false
}
```

Root tasks (no dependencies, or explicitly marked as data consumers) become stale when anything in `data/` is newer than their outputs. This cascades naturally — if T1 is stale because data changed, T10 (depends on T1) is stale too.

**For explicit tracking:** Record data file hashes at task completion:

```typescript
metadata: {
  inputDataHash: {
    "data/samples.h5ad": "sha256:abc123...",
    "data/tp53_peaks.bed": "sha256:def456..."
  }
}
```

On rerun check, compare current file hashes against recorded hashes. More precise than timestamps, catches data replacement even if mtime is preserved (e.g., `cp -p`).

**UI indicator:** When input data changes, show a banner on the project view:

```
┌──────────────────────────────────────────────────────────┐
│ ⚠ Input data changed: data/samples.h5ad (modified 2h ago) │
│   3 root tasks and 12 downstream tasks may be stale.     │
│   [Check Staleness]  [Dismiss]                            │
└──────────────────────────────────────────────────────────┘
```
