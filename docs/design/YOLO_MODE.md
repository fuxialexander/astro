# YOLO Mode

> Fully autonomous plan execution — generate, dispatch, and complete all tasks without human intervention.

## Concept

YOLO mode is Astro's "hands-off" execution model. When enabled, the system:

1. Generates a plan from the user's goal
2. Dispatches all tasks automatically (respecting dependency order)
3. Auto-approves safety checks, tool approvals, and task completions
4. Delivers a single summary notification when everything finishes

The user's only interaction is describing the goal and pressing "Generate". Everything else is automatic.

## Controls

There are two independent controls that affect task execution behavior:

### 1. Global YOLO (`yoloMode`)

A single global setting stored in `user_profiles.settings.yoloMode`. Toggled from two places that are **fully synced** — changing one changes the other:

| Location | UI Element |
|----------|------------|
| **Sidebar** | "YOLO" switch (expanded) or Zap icon (collapsed) |
| **Plan generation page** | "YOLO" pill button next to Generate |

The sidebar toggle calls `setYoloMode(enabled)`. The plan page toggle calls both `setAutoExecute(next)` (local auto-dispatch flag) and `setYoloMode(next)` (global). A `useEffect` keeps the plan page button in sync when the sidebar toggle changes.

The server reads YOLO mode fresh from the database on every check (not cached). Toggling YOLO mid-execution takes effect immediately on the next event.

### 2. Per-node verification (`verification: 'auto' | 'human'`)

Set by the AI during plan generation. The AI uses `verification: 'auto'` for programmatically verifiable tasks (tests pass, build succeeds, file created) and `verification: 'human'` for tasks requiring judgment (design decisions, research quality, strategy). Default is `'auto'`.

This is a per-node field — different tasks in the same plan can have different verification modes. Users can also change it manually in the node inspector.

### How they interact

Global YOLO is an **override**. When YOLO is on, it overrides per-node verification — even `verification: 'human'` tasks are auto-verified. When YOLO is off, per-node verification takes effect.

There is no project-level YOLO setting. YOLO is either globally on (all projects) or globally off.

## Behavior Matrix

### Case 1: YOLO OFF + verification = auto

The default for most tasks. Manual dispatch, but tasks auto-verify when successful.

| Stage | Behavior |
|-------|----------|
| **After planning** | Plan is shown. User reviews. No auto-dispatch. |
| **Task dispatch** | User clicks "Execute All" or dispatches individual tasks manually. |
| **Safety check** | Dialog shown — user must click "Proceed". |
| **Tool approval** | Dialog shown — user must select an option. |
| **Task succeeds** | `auto_verified` — no human review needed. |
| **Task fails** | `awaiting_judgment` — user must review. |
| **Downstream** | Auto-dispatched (because parent is `auto_verified`). |

**Experience:** User reviews plan, clicks Execute All, approves safety/tool prompts as they appear, tasks cascade automatically as long as they succeed.

### Case 2: YOLO OFF + verification = human

For strategic/judgment tasks. Fully manual pipeline.

| Stage | Behavior |
|-------|----------|
| **After planning** | Plan is shown. User reviews. No auto-dispatch. |
| **Task dispatch** | User clicks "Execute All" or dispatches individually. |
| **Safety check** | Dialog shown — user must click "Proceed". |
| **Tool approval** | Dialog shown — user must select an option. |
| **Task succeeds** | `awaiting_judgment` — user must review the output and approve. |
| **Task fails** | `awaiting_judgment` — user must review. |
| **Downstream** | **Blocked** until user manually approves the parent (changes status to `completed`). |

**Experience:** Maximum human oversight. Every task requires review before downstream work starts. Used for research decisions, design reviews, or anything where quality matters more than speed.

### Case 3: YOLO ON + verification = auto

Fully automatic. The happy path for YOLO.

| Stage | Behavior |
|-------|----------|
| **After planning** | All root tasks (no dependencies) dispatch immediately. |
| **Task dispatch** | Automatic — each task dispatches as soon as its dependencies are `auto_verified`. |
| **Safety check** | Auto-proceed — no dialog, logged to activity feed. |
| **Tool approval** | Auto-approve first option (AI's recommendation) — no dialog. |
| **Task succeeds** | `auto_verified`. |
| **Task fails** | `awaiting_judgment` — user is notified, must review. Downstream blocked. |
| **Downstream** | Auto-dispatched (15s stagger between parallel tasks). |

**Experience:** Generate → walk away → come back to finished project. Failures are the only thing that requires attention.

### Case 4: YOLO ON + verification = human

YOLO overrides per-node verification. Behavior is **identical to Case 3**.

| Stage | Behavior |
|-------|----------|
| **After planning** | All root tasks dispatch immediately. |
| **Task dispatch** | Automatic. |
| **Safety check** | Auto-proceed. |
| **Tool approval** | Auto-approve first option. |
| **Task succeeds** | `auto_verified` — YOLO overrides `verification: 'human'`. |
| **Task fails** | `awaiting_judgment` — user must review. |
| **Downstream** | Auto-dispatched. |

**Experience:** Same as Case 3. The `verification: 'human'` field is ignored when YOLO is on. This is by design — YOLO means "trust the AI for everything."

### Summary table

| | YOLO OFF | YOLO ON |
|---|---|---|
| **Auto-dispatch after planning** | No | Yes |
| **Safety checks** | Dialog (manual) | Auto-proceed |
| **Tool approvals** | Dialog (manual) | Auto-approve |
| **Task succeeds (verification=auto)** | `auto_verified` | `auto_verified` |
| **Task succeeds (verification=human)** | `awaiting_judgment` (manual review) | `auto_verified` (YOLO override) |
| **Task fails** | `awaiting_judgment` | `awaiting_judgment` |
| **Downstream dispatch** | Auto if parent `auto_verified`, blocked if `awaiting_judgment` | Auto (all successes are `auto_verified`) |

### Edge cases

**YOLO toggled mid-execution:** The server reads `yoloMode` fresh from DB on every event. If you turn YOLO on mid-execution:
- Next safety prompt → auto-proceed
- Next tool approval → auto-approve
- Next task completion → auto-verify (if successful)
- Already-dispatched tasks that are waiting at a safety/approval dialog: the dialog stays (the check already happened). User must approve manually or wait for the next event.

**YOLO toggled off mid-execution:** Same — next events use the new setting. Tasks already `auto_verified` stay that way. Tasks currently in-flight: their completion will use the new YOLO=off setting, so `verification: 'human'` tasks will land at `awaiting_judgment`.

**Mixed verification in one plan:** Common. A plan might have 8 tasks where 6 are `verification: 'auto'` (code changes) and 2 are `verification: 'human'` (design review, final QA). With YOLO off, the human-verified tasks create "checkpoints" where the cascade pauses for review. With YOLO on, all 8 tasks cascade automatically.

**Failed task in YOLO:** Failures always require human review, regardless of YOLO. Downstream tasks that depend on the failed task are blocked. Independent branches continue executing.

**Re-execution after YOLO change:** Re-running a task reads the current `yoloMode` from DB. If you initially ran with YOLO off and a task is `awaiting_judgment`, turning YOLO on and re-running will auto-verify on success.

## Implementation Details

### Stage 1: Plan Generation + Auto-Dispatch

When a plan finishes generating and YOLO mode is on:

```
Plan generation completes (SSE 'result' event)
  → execution-store.ts: onPlanComplete()
    → Check autoExecuteProjectIds (set by plan page when YOLO is on)
    → If flagged: dispatch ALL root tasks (no dependencies) immediately
    → As each task completes → server auto-dispatches downstream tasks
```

**File:** `src/stores/execution-store.ts` (line ~2465)
**File:** `src/pages/project-new-plan.tsx` (line ~630) — registers auto-execute callback

For example templates, auto-execute is always registered (YOLO is implicitly on for examples).

The `autoExecuteProjectIds: Set<string>` in execution-store tracks which projects should auto-execute. The flag is consumed (removed) on first use, so re-generating a plan doesn't auto-execute again unless the user re-enables it.

### Stage 2: Safety Check Auto-Proceed

When a task starts in a non-git or risky directory, the agent-runner sends a `task_safety_prompt`. In YOLO mode, this is auto-approved:

```
Agent Runner → task_safety_prompt → Relay → Server (events.ts)
  → isYoloMode(userId) → true
    → Send 'proceed' decision back to agent-runner
    → Persist safety_response event (for hydration)
    → Send 'task:safety_auto_proceeded' SSE to browser (activity log only, no dialog)
    → Add project to safetyApprovedProjects Set (so subsequent tasks skip even if YOLO toggled off)
```

**File:** `server/routes/events.ts` (line ~365)

### Stage 3: Tool Approval Auto-Approve

When an agent requests user input via `ask_user_question` (MCP tool), YOLO auto-selects the first option:

```
Agent Runner → task_approval_request → Relay → Server (events.ts)
  → isYoloMode(userId) → true
    → Auto-select options[0] (the AI's recommendation)
    → Send approval response back to agent-runner
    → Send 'task:approval_auto_responded' SSE to browser
```

**File:** `server/routes/events.ts` (line ~282)
**File:** `server/routes/dispatch.ts` (line ~1865) — `/approval-response` endpoint also checks YOLO

### Stage 4: Task Completion Auto-Verify

When a task finishes execution, the server determines the final plan node status:

```
Agent Runner → task_result (status: 'completed') → Relay → Server (dispatch.ts)
  → isSuccess && deliveryOk
    → verification === 'auto'? → auto_verified (always, YOLO or not)
    → verification === 'human' && isYoloMode(userId)? → auto_verified (YOLO override)
    → else → awaiting_judgment (requires human review)
  → !isSuccess → awaiting_judgment (failures always need human review)
```

The `finalStatus` is:
- Computed server-side before the SSE event
- Included in the SSE `result` event payload as `finalStatus`
- Used by the frontend directly (no re-computation needed)
- Persisted to `streaming_events` table for page-refresh hydration
- Frontend has a fallback that also checks `yoloMode` if server doesn't provide `finalStatus`

**File:** `server/routes/dispatch.ts` (result handler, line ~1208)
**File:** `server/lib/yolo-mode.ts` — shared `isYoloMode(userId)` utility

### Stage 5: Auto-Dispatch Downstream Tasks

When a task reaches `auto_verified`, the server automatically dispatches dependent tasks:

```
Task auto_verified → dispatch.ts: autoDispatchDownstream(projectId, nodeId)
  → Find all nodes whose dependencies are all completed/auto_verified
  → Dispatch each one via serverSideDispatch (internal HTTP request)
  → Each downstream task follows the same YOLO pipeline
```

This cascade continues until all tasks in the plan are complete or a failure stops a branch.

**File:** `server/routes/data.ts` (line ~813) — `autoDispatchDownstream()`
**File:** `server/routes/dispatch.ts` (line ~1350) — triggers autoDispatchDownstream on auto_verified
**File:** `server/lib/server-side-dispatch.ts` — makes internal HTTP dispatch request

Downstream tasks are staggered with a 15-second delay between dispatches to prevent system overload.

## Notification Flow

### Current (per-task notifications)

Each task emits a browser notification on completion:
- `showTaskNotification(project, task, 'completed')` — per task
- Individual toasts for each safety auto-proceed, approval auto-respond

This is noisy in YOLO mode — a 10-task plan generates 10+ notifications.

### Desired (batch summary)

In YOLO mode, the ideal notification flow:

1. **One toast on plan generation**: "Plan generated — executing 8 tasks"
2. **Progress indicator**: Sidebar or dashboard shows "5/8 tasks complete"
3. **One final notification**: "Project complete — 8/8 tasks finished" with a summary of all results
4. **Individual task notifications suppressed** in YOLO mode

The final summary notification should include:
- Total tasks completed / failed
- Total cost and token usage
- Per-task one-line summaries (from `result.summary.workCompleted`)
- Links to any failed tasks that need attention

### Implementation Plan for Batch Summary

**Phase 1: Suppress per-task noise in YOLO**

In `realtime-store.ts`, when processing task results:
- Check `useSettingsStore.getState().yoloMode` before calling `showTaskNotification()`
- In YOLO mode, skip individual task notifications entirely

**Phase 2: Track plan-level completion**

In `realtime-store.ts` or `execution-store.ts`:
- When `auto_verified` event arrives, check if ALL non-milestone nodes in the project plan are terminal (`completed` / `auto_verified` / `pruned`)
- If yes, compute aggregated summary:
  - Count completed/failed/pruned tasks
  - Sum cost/tokens from usage-store
  - Collect `summary.workCompleted` from each task's execution result
- Emit a single `showPlanSummaryNotification()` with the aggregate

**Phase 3: Summary notification UI**

Create a rich notification or toast that shows:
```
Project "Academic Review" complete
  8/8 tasks finished | $2.40 | 45k tokens
  - Parse PDF: Extracted 42 pages, 15 figures
  - Structure Map: Generated argument flow diagram
  - Novelty Analysis: 3 novel contributions identified
  - Report: PDF saved to outputs/review-report.pdf
```

This could be a persistent toast with a "View Details" link to the plan view, or a browser notification with a summary body.

**Phase 4: First-failure alert**

In YOLO mode, a task failure should immediately:
- Show a toast: "Task failed: {title} -- YOLO execution paused on this branch"
- Send a browser notification (even if the tab has focus)
- Continue executing other independent branches that don't depend on the failed task

## Data Flow Diagram

```
User: "Build me a CLI tool"
  |
  v
Plan Generation (SSE stream)
  |
  v plan_result extracted
  |
  +-- YOLO off: Show plan, user clicks "Execute All" or dispatches individually
  |
  +-- YOLO on: Auto-dispatch all root tasks immediately
        |
        v (for each task)
        |
        +- Safety check? -> Auto-proceed (no dialog)
        |
        +- Tool approval? -> Auto-select first option (no dialog)
        |
        +- Task completes successfully?
        |   +-- auto_verified (skip awaiting_judgment)
        |   +-- Auto-dispatch downstream tasks
        |
        +- Task fails?
            +-- awaiting_judgment (human review needed even in YOLO)
                 +-- Browser notification: "Task failed, needs attention"

All tasks terminal -> Final summary notification
```

## Files

| File | Role |
|------|------|
| `server/lib/yolo-mode.ts` | `isYoloMode(userId)` — reads fresh from DB |
| `server/routes/events.ts` | Safety auto-proceed, approval auto-respond |
| `server/routes/dispatch.ts` | Task completion auto-verify, `finalStatus` in SSE, auto-dispatch downstream, `/approval-response` YOLO check |
| `server/lib/server-side-dispatch.ts` | Internal HTTP dispatch for downstream tasks |
| `src/stores/settings-store.ts` | `yoloMode` state, `setYoloMode()`, persists to `user_profiles.settings` |
| `src/stores/execution-store.ts` | Auto-dispatch all tasks on plan complete, `finalStatus` fallback checks YOLO, summaries stored in YOLO mode |
| `src/stores/realtime-store.ts` | SSE result handler and catch-up reconciliation — `finalStatus` fallback checks YOLO |
| `src/pages/project-new-plan.tsx` | YOLO toggle synced with global setting, registers auto-execute callback |
| `src/components/layout/sidebar.tsx` | Global YOLO toggle (Zap icon / "YOLO" switch) |
| `src/lib/notifications.ts` | Browser notification helpers |
| `src/lib/streaming-event-hydrator.ts` | Hydrates `finalStatus` from persisted events |
| `docs/design/SAFETY_CHECK.md` | Safety check system (YOLO is Layer 3) |

## Known Issues

### Fixed (PR #682)

- **`finalStatus` not in SSE event**: Server computed the correct YOLO-aware status but didn't include it in the SSE result payload. Frontend fell back to `node.verification === 'auto'` check which ignores YOLO. Fixed by moving `finalNodeStatus` computation before the SSE event and adding `finalStatus` to `resultData`.

- **Plan page YOLO not synced with global setting**: `autoExecute` defaulted to `true` regardless of global `yoloMode`. Tasks auto-dispatched but server-side checks read `yoloMode=false` from DB. Fixed by initializing from global YOLO, syncing via `useEffect`, and calling `setYoloMode(next)` on every toggle.

- **Frontend fallbacks ignored YOLO**: When server didn't provide `finalStatus` (race condition, old server), both `execution-store.ts` and `realtime-store.ts` only checked `node.verification === 'auto'`. Fixed to also check `useSettingsStore.getState().yoloMode`.

### Open

- **Per-task notifications in YOLO**: Each task completion fires an individual browser notification. Should be suppressed in YOLO with a single summary at plan completion.
- **No progress indicator**: No visual indicator of how many tasks in the plan are complete vs remaining during YOLO execution.
- **Failed task cascading**: When a task fails in YOLO, downstream tasks are blocked but the user isn't notified until they check. Should proactively alert on first failure.
