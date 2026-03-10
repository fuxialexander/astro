# Delivery Mode Safety

> How Astro selects delivery mode and baseBranch for task execution, with defense-in-depth against non-git directory crashes.

---

## Problem

When creating a project pointing at a non-git directory, the frontend stores `baseBranch: 'main'` as a default. The agent-runner trusts this value without validation. If the directory later gains a git repo (via agent `git init` or safety `init-git`) with a non-standard default branch, `git branch astro/<id> main` crashes because `main` doesn't exist.

The delivery mode override (safety decision to direct mode) doesn't fire for builtin templates because they skip the safety prompt, so `approvedSafetyDirs` is never populated.

---

## Delivery Mode Decision Matrix

| Directory State | Git Available | YOLO Mode | Delivery Mode | baseBranch | Parallel Tasks |
|---|---|---|---|---|---|
| Git repo with remote (GitHub) | Yes | N/A | `pr` | Auto-detected | Yes (worktrees) |
| Git repo with remote (other) | Yes | N/A | `push` | Auto-detected | Yes (worktrees) |
| Git repo, local only | Yes | N/A | `branch` | Auto-detected | Yes (worktrees) |
| Git repo, uncommitted changes | Yes | N/A | `branch` (warned) | Auto-detected | Yes if worktree, No otherwise |
| Non-git dir, normal mode | Yes | Off | Prompt -> `direct` or init-git | Set after init / undefined | Depends on choice |
| Non-git dir, YOLO mode | Yes | On | `direct` (auto) | undefined | No (serial lock) |
| Non-git dir, no git binary | No | N/A | `direct` (auto) | undefined | No (serial lock) |
| Builtin template, non-git | Yes | N/A | `direct` (recommended) | undefined | No (serial lock) |

### Decision Flowchart

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#dbeafe', 'primaryBorderColor': '#93c5fd', 'primaryTextColor': '#1e293b', 'lineColor': '#64748b', 'textColor': '#334155', 'fontSize': '14px', 'fontFamily': 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'}}}%%
flowchart TD
    classDef blue fill:#dbeafe,stroke:#93c5fd,color:#1e293b
    classDef green fill:#dcfce7,stroke:#86efac,color:#1e293b
    classDef amber fill:#fef3c7,stroke:#fcd34b,color:#1e293b
    classDef rose fill:#ffe4e6,stroke:#fda4af,color:#1e293b
    classDef slate fill:#f1f5f9,stroke:#cbd5e1,color:#1e293b

    A["Directory detected"]:::blue --> B{"isGitRepo?"}:::amber
    B -->|Yes| C{"Has remote?"}:::amber
    B -->|No| D{"Git available?"}:::amber
    C -->|GitHub| E["deliveryMode: pr"]:::green
    C -->|Other remote| F["deliveryMode: push"]:::green
    C -->|No remote| G["deliveryMode: branch"]:::green
    D -->|No| H["deliveryMode: direct"]:::slate
    D -->|Yes, YOLO| H
    D -->|Yes, normal| I{"User prompt"}:::amber
    I -->|init-git| J["git init -> branch"]:::green
    I -->|proceed| H
    I -->|sandbox| K["deliveryMode: copy"]:::slate
```

---

## baseBranch Resolution Chain

The agent-runner resolves the base branch through a prioritized chain defined in `worktree.ts`. Each step falls through to the next if it cannot produce a valid ref:

```
dispatchBaseBranch (from server, NOW VALIDATED -- ref must exist)
  | (if ref doesn't exist, discard)
readBaseBranch (from .astro/config.json)
  | (if no config)
getDefaultBranch auto-detection:
  1. origin/HEAD symbolic ref
  2. origin/main or origin/master
  3. Local main or master branch
  4. HEAD's current branch name
  5. Any local branch (first found) <-- NEW
  6. 'main' (hardcoded last resort)
```

### Resolution Flowchart

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#dbeafe', 'primaryBorderColor': '#93c5fd', 'primaryTextColor': '#1e293b', 'lineColor': '#64748b', 'textColor': '#334155', 'fontSize': '14px', 'fontFamily': 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'}}}%%
flowchart TD
    classDef blue fill:#dbeafe,stroke:#93c5fd,color:#1e293b
    classDef green fill:#dcfce7,stroke:#86efac,color:#1e293b
    classDef amber fill:#fef3c7,stroke:#fcd34b,color:#1e293b
    classDef slate fill:#f1f5f9,stroke:#cbd5e1,color:#1e293b

    A["Start: resolve baseBranch"]:::blue --> B{"dispatchBaseBranch\nfrom server?"}:::amber
    B -->|"Yes, ref exists"| C["Use dispatchBaseBranch"]:::green
    B -->|"No / ref missing"| D{"readBaseBranch\nfrom .astro/config.json?"}:::amber
    D -->|Yes| E["Use config baseBranch"]:::green
    D -->|No config| F{"origin/HEAD\nsymbolic ref?"}:::amber
    F -->|Yes| G["Use origin/HEAD target"]:::green
    F -->|No| H{"origin/main or\norigin/master?"}:::amber
    H -->|Yes| I["Use origin/main or origin/master"]:::green
    H -->|No| J{"Local main or\nmaster branch?"}:::amber
    J -->|Yes| K["Use local main/master"]:::green
    J -->|No| L{"HEAD's current\nbranch name?"}:::amber
    L -->|Yes| M["Use HEAD branch"]:::green
    L -->|No| N{"Any local\nbranch?"}:::amber
    N -->|Yes| O["Use first local branch"]:::green
    N -->|No| P["Hardcoded: 'main'"]:::slate
```

---

## Safety Tier System

| Tier | Condition | Behavior |
|---|---|---|
| SAFE | Git repo, clean working tree | Execute immediately, worktree isolation |
| GUARDED | Git repo, uncommitted changes | Warning shown, proceed with worktree |
| RISKY | Non-git directory | Prompt: init-git / proceed / sandbox / cancel |
| UNSAFE | Non-git + parallel task running | Block until current task completes |

### Safety Tier Flowchart

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#dbeafe', 'primaryBorderColor': '#93c5fd', 'primaryTextColor': '#1e293b', 'lineColor': '#64748b', 'textColor': '#334155', 'fontSize': '14px', 'fontFamily': 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'}}}%%
flowchart TD
    classDef blue fill:#dbeafe,stroke:#93c5fd,color:#1e293b
    classDef green fill:#dcfce7,stroke:#86efac,color:#1e293b
    classDef amber fill:#fef3c7,stroke:#fcd34b,color:#1e293b
    classDef rose fill:#ffe4e6,stroke:#fda4af,color:#1e293b
    classDef slate fill:#f1f5f9,stroke:#cbd5e1,color:#1e293b

    A["Evaluate directory"]:::blue --> B{"Is git repo?"}:::amber
    B -->|Yes| C{"Clean working tree?"}:::amber
    B -->|No| D{"Parallel task\nrunning?"}:::amber
    C -->|Yes| E["SAFE: Execute immediately"]:::green
    C -->|No| F["GUARDED: Warning shown"]:::amber
    D -->|No| G["RISKY: Prompt user"]:::rose
    D -->|Yes| H["UNSAFE: Block"]:::rose
```

---

## Three-Layer Defense

| Layer | Location | What it prevents |
|---|---|---|
| Frontend | `project-new-plan.tsx` | Don't store `baseBranch: 'main'` for non-git dirs |
| Server | `dispatch.ts` | Override delivery mode when safety decision = 'proceed' |
| Agent-runner | `worktree.ts` | Validate baseBranch ref exists before using it |

Any single layer prevents the crash. All three together provide defense-in-depth.

### Defense-in-Depth Diagram

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#dbeafe', 'primaryBorderColor': '#93c5fd', 'primaryTextColor': '#1e293b', 'lineColor': '#64748b', 'textColor': '#334155', 'fontSize': '14px', 'fontFamily': 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'}}}%%
flowchart LR
    classDef blue fill:#dbeafe,stroke:#93c5fd,color:#1e293b
    classDef green fill:#dcfce7,stroke:#86efac,color:#1e293b
    classDef amber fill:#fef3c7,stroke:#fcd34b,color:#1e293b
    classDef slate fill:#f1f5f9,stroke:#cbd5e1,color:#1e293b

    A["Non-git directory\ncreated as project"]:::blue --> B["Layer 1: Frontend\nDon't store baseBranch: main"]:::amber
    B -->|"baseBranch = undefined"| C["Layer 2: Server\nOverride to direct mode"]:::amber
    C -->|"deliveryMode = direct"| D["Layer 3: Agent-runner\nValidate ref exists"]:::amber
    D -->|"Ref missing -> auto-detect"| E["Safe execution"]:::green

    B -->|"If layer 1 missed"| C
    C -->|"If layer 2 missed"| D
    D -->|"If all missed"| F["Crash prevented by\nref validation fallback"]:::green
```

---

## Planned Improvement: Upfront Safety Decision

**Current flow:** Create project -> dispatch task -> agent-runner safety check -> user decides

**Problem:** baseBranch already stored in DB, builtin templates skip safety check

**Planned flow:** Create project -> detect non-git dir -> prompt user upfront -> store correct deliveryMode + baseBranch

**Benefits:** Decision before any dispatch, correct DB state, YOLO auto-direct

### Current vs. Planned Flow

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#dbeafe', 'primaryBorderColor': '#93c5fd', 'primaryTextColor': '#1e293b', 'lineColor': '#64748b', 'textColor': '#334155', 'fontSize': '14px', 'fontFamily': 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'}}}%%
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant DB as Database
    participant SV as Server
    participant AR as Agent-Runner

    rect rgb(255, 228, 230)
        Note over U,AR: Current Flow (reactive)
        U->>FE: Create project (non-git dir)
        FE->>DB: Store baseBranch: 'main'
        U->>SV: Dispatch task
        SV->>AR: Execute task
        AR->>AR: Detect non-git dir
        AR->>U: Safety prompt (init-git / proceed / sandbox)
        U->>AR: Choose 'proceed'
        AR->>AR: deliveryMode = direct
        Note right of AR: baseBranch 'main' in DB is stale/wrong
    end

    rect rgb(220, 252, 231)
        Note over U,AR: Planned Flow (proactive)
        U->>FE: Create project (non-git dir)
        FE->>FE: Detect non-git dir
        FE->>U: Safety prompt (init-git / proceed / sandbox)
        U->>FE: Choose delivery approach
        FE->>DB: Store correct deliveryMode + baseBranch
        U->>SV: Dispatch task
        SV->>AR: Execute task (correct mode from start)
        Note right of AR: No safety prompt needed, DB is correct
    end
```

---

## Edge Cases

- **Agent creates git repo during execution** -- Directory state changes mid-project. The safety tier evaluated at dispatch time no longer reflects reality. Subsequent tasks should re-evaluate.
- **Server restart** -- `approvedSafetyDirs` cache cleared. The delivery mode override doesn't fire for existing projects that previously had safety decisions. Must rely on agent-runner validation layer.
- **Stale DB data from before fix** -- Projects created before the three-layer defense was implemented may have `baseBranch: 'main'` for non-git dirs. The agent-runner validates the ref and falls back to auto-detect.
- **Builtin templates** -- `skipSafetyCheck=true` means the safety decision is never cached in `approvedSafetyDirs`. The server-layer override never fires. Must rely on agent-runner validation as the last line of defense.
- **Race condition on parallel dispatch** -- Two tasks dispatched simultaneously for a non-git dir could both attempt to `git init`. The serial lock (UNSAFE tier) prevents this.
- **Worktree cleanup failure** -- If a worktree branch is left behind from a crashed task, the next task may fail to create a worktree with the same name. The agent-runner implements force-remove + prune as a fallback cleanup path.

---

## Key Files

| File | Role |
|---|---|
| `server/routes/dispatch.ts` | Dispatch pipeline, delivery mode resolution, safety cache |
| `packages/agent-runner/src/lib/worktree.ts` | baseBranch validation, worktree creation |
| `packages/agent-runner/src/lib/workdir-safety.ts` | Safety tier detection |
| `packages/agent-runner/src/lib/task-executor.ts` | Workspace preparation, delivery mode handling |
| `src/pages/project-new-plan.tsx` | Project creation, baseBranch default |
| `src/lib/project-source.ts` | ProjectSource resolution |

---

*See also: WORKSPACE_V2.md | SAFETY_CHECK.md | YOLO_MODE.md | GIT_WORKTREE.md | EXECUTION_GUARDRAILS.md*
