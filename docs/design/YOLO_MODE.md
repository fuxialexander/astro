# YOLO Mode

> Fully autonomous plan execution — generate, dispatch, and complete all tasks without human intervention.

## Concept

YOLO mode is Astro's "hands-off" execution model. When enabled, the system:

1. Generates a plan from the user's goal
2. Dispatches all tasks automatically (respecting dependency order)
3. Auto-approves safety checks, tool approvals, and task completions
4. Delivers a single summary notification when everything finishes

The user's only interaction is describing the goal and pressing "Generate". Everything else is automatic.

## How to Enable

YOLO mode can be toggled in three places:

| Location | Scope | UI Element |
|----------|-------|------------|
| **Sidebar** | Global setting | Zap icon button (collapsed) or "Auto Approval" switch (expanded) |
| **Plan generation page** | Per-generation | "YOLO" toggle next to the Generate button |
| **Inline approval card** | One-off | "YOLO" button on individual approval prompts |

The setting is stored as `yoloMode: 'true'` in the user's profile settings (`user_profiles.settings` JSONB column). It persists across sessions.

```
sidebar.tsx      → useSettingsStore.setYoloMode(enabled)
settings-store   → dataClient.updateSettings({ yoloMode: String(enabled) })
server           → user_profiles.settings.yoloMode = 'true'
```

**Important:** The server reads YOLO mode fresh from the database on every check (not cached per SSE session). This means toggling YOLO mid-execution takes effect immediately on the next event.

## Behavior at Each Stage

### Stage 1: Plan Generation + Auto-Dispatch

When a plan finishes generating and YOLO mode is on:

```
Plan generation completes (SSE 'result' event)
  → execution-store.ts: onPlanComplete()
    → Check yoloMode from settings-store
    → If YOLO: dispatch ALL root tasks (no dependencies) immediately
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

When a task finishes execution, the server determines the final plan node status. In YOLO mode, successful tasks are `auto_verified` regardless of the node's `verification` field:

```
Agent Runner → task_result (status: 'completed') → Relay → Server (dispatch.ts)
  → isSuccess && deliveryOk
    → verification === 'auto'? → auto_verified (always, YOLO or not)
    → verification === 'human' && isYoloMode(userId)? → auto_verified
    → else → awaiting_judgment (requires human review)
  → !isSuccess → awaiting_judgment (failures always need human review)
```

The `finalStatus` is:
- Computed server-side before the SSE event
- Included in the SSE `result` event payload as `finalStatus`
- Used by the frontend directly (no re-computation)
- Persisted to `streaming_events` table for page-refresh hydration

**File:** `server/routes/dispatch.ts` (result handler, line ~1208)
**File:** `server/lib/yolo-mode.ts` — shared `isYoloMode(userId)` utility

### Stage 5: Auto-Dispatch Downstream Tasks

When a task reaches `auto_verified`, the server automatically dispatches dependent tasks:

```
Task auto_verified → dispatch.ts: autoDispatchDownstream(projectId, nodeId)
  → Find all nodes whose dependencies are now satisfied
  → Dispatch each one (same machine, same provider)
  → Each downstream task follows the same YOLO pipeline
```

This cascade continues until all tasks in the plan are complete or a failure stops a branch.

**File:** `server/routes/data.ts` (line ~813) — `autoDispatchDownstream()`
**File:** `server/routes/dispatch.ts` (line ~1350) — triggers autoDispatchDownstream on auto_verified

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
  │
  ▼
Plan Generation (SSE stream)
  │
  ▼ plan_result extracted
  │
  ├── YOLO off: Show plan, user clicks "Execute All" or dispatches individually
  │
  └── YOLO on: Auto-dispatch all root tasks immediately
        │
        ▼ (for each task)
        │
        ├─ Safety check? → Auto-proceed (no dialog)
        │
        ├─ Tool approval? → Auto-select first option (no dialog)
        │
        ├─ Task completes successfully?
        │   ├── auto_verified (skip awaiting_judgment)
        │   └── Auto-dispatch downstream tasks
        │
        └─ Task fails?
            └── awaiting_judgment (human review needed even in YOLO)
                 └── Browser notification: "Task failed, needs attention"

All tasks terminal → Final summary notification
```

## Files

| File | Role |
|------|------|
| `server/lib/yolo-mode.ts` | `isYoloMode(userId)` — reads fresh from DB |
| `server/routes/events.ts` | Safety auto-proceed, approval auto-respond |
| `server/routes/dispatch.ts` | Task completion auto-verify, `finalStatus` in SSE, auto-dispatch downstream, `/approval-response` YOLO check |
| `src/stores/settings-store.ts` | `yoloMode` state, `setYoloMode()`, persists to `user_profiles.settings` |
| `src/stores/execution-store.ts` | Auto-dispatch all tasks on plan complete, uses `finalStatus` from server |
| `src/stores/realtime-store.ts` | Safety auto-proceed activity logging, catch-up reconciliation uses `finalStatus` |
| `src/pages/project-new-plan.tsx` | YOLO toggle on plan generation page, registers auto-execute callback |
| `src/components/layout/sidebar.tsx` | Global YOLO toggle (Zap icon) |
| `src/lib/notifications.ts` | Browser notification helpers |
| `src/lib/streaming-event-hydrator.ts` | Hydrates `finalStatus` from persisted events |
| `docs/design/SAFETY_CHECK.md` | Safety check system (YOLO is Layer 3) |

## Known Issues

### Fixed (PR #682)

- **`finalStatus` not in SSE event**: Server computed the correct YOLO-aware status but didn't include it in the SSE result payload. Frontend fell back to `node.verification === 'auto'` check which ignores YOLO. Fixed by moving `finalNodeStatus` computation before the SSE event and adding `finalStatus` to `resultData`.

### Open

- **Per-task notifications in YOLO**: Each task completion fires an individual browser notification. Should be suppressed in YOLO with a single summary at plan completion.
- **No progress indicator**: No visual indicator of how many tasks in the plan are complete vs remaining during YOLO execution.
- **Failed task cascading**: When a task fails in YOLO, downstream tasks are blocked but the user isn't notified until they check. Should proactively alert on first failure.
