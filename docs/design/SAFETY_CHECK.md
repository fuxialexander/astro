# Safety Check System

> Working-directory safety validation for AI agent execution.

## Problem

AI agents executing in non-git directories can modify or delete files with no way to revert. The safety check system detects risky working directories and gives users control over how to proceed. However, the original design prompts **per-task**, which is disruptive when running multi-task plans — every task in a project sharing the same non-git directory triggers the same dialog.

## Architecture

### Safety Tiers

The agent-runner classifies each working directory into one of four tiers:

| Tier | Condition | Behavior |
|------|-----------|----------|
| **SAFE** | Git repo with clean state, or worktree isolation | Execute immediately |
| **GUARDED** | Git repo with uncommitted changes | Warn, continue |
| **RISKY** | Non-git directory, or git + uncommitted without worktree | Require user confirmation |
| **UNSAFE** | Non-git parallel execution, or git + uncommitted + parallel | Block execution |

### Data Flow

```
Agent Runner                    Relay Server              Server (events.ts / dispatch.ts)           Frontend
    |                               |                              |                                    |
    |-- performSafetyCheck() ------>|                              |                                    |
    |   (detect git, tier)          |                              |                                    |
    |                               |                              |                                    |
    |-- task_safety_prompt -------->|-- emit safety_prompt ------->|                                    |
    |   {taskId, tier, warning,     |                              |                                    |
    |    options, machineId}        |                              |                                    |
    |                               |                              |-- [YOLO?] auto-proceed ----------->|  (activity log only)
    |                               |                              |-- [project approved?] auto ------->|  (activity log only)
    |                               |                              |-- [else] SSE safety_prompt ------->|  (show dialog)
    |                               |                              |                                    |
    |                               |                              |<-- POST /safety-decision -----------|
    |                               |                              |    {taskId, machineId, decision}    |
    |                               |                              |                                    |
    |<-- task_safety_decision ------|<-- sendSafetyDecision -------|                                    |
    |   {decision}                  |                              |                                    |
    |                               |                              |-- cache approval per-dir ----------|
    |-- execute based on decision   |                              |-- emit safety_approved per-project |
```

### Decision Options

When prompted, users choose one of:

| Decision | Effect |
|----------|--------|
| `proceed` | Execute in non-git directory at your own risk |
| `init-git` | Run `git init` before execution |
| `sandbox` | Execute in an isolated copy (`~/.astro/sandbox/{taskId}`) |
| `cancel` | Abort the task |

## Approval Escalation (3 layers)

Safety prompts are suppressed through three complementary mechanisms, evaluated in order:

### Layer 1: `skipSafetyCheck` flag (dispatch-time)

Set on the task payload by the server **before** it reaches the agent-runner:

- **Text-only tasks** (refine, summarize, title generation): Always `true` — no filesystem access.
- **Previously approved directory**: `approvedSafetyDirs.has(workingDirectory)` — if any prior task in the same working directory was approved, subsequent dispatches skip the check entirely.
- **Playground tasks** with explicit `skipSafetyCheck` from client.

This is the most efficient suppression — the agent-runner never runs the safety check at all.

### Layer 2: Per-project approval (SSE-time)

Tracked in the SSE handler's `safetyApprovedProjects` Set (per SSE session):

When a safety prompt arrives from the agent-runner, the server checks:
1. Resolve `taskId` -> `projectId` via `executionContextStore`
2. If `safetyApprovedProjects.has(projectId)` -> auto-proceed silently

The Set is populated when:
- **YOLO mode** auto-proceeds a safety prompt for a project
- **User manually approves** a safety prompt -> dispatch.ts emits `task:safety_approved` with projectId -> events.ts adds to Set

This handles the **parallel dispatch race**: tasks dispatched before the first approval response still get auto-proceeded when their safety prompt arrives, because the project is already in the approved set.

### Layer 3: YOLO mode (SSE-time)

When YOLO mode is enabled (user setting), **all** safety prompts auto-proceed:

1. Read YOLO setting fresh from DB (not cached, so mid-session toggles work)
2. Send `proceed` decision to agent-runner
3. Persist `safety_response` event for hydration
4. Send `task:safety_auto_proceeded` SSE event to browser (activity feed, no dialog)
5. Add project to `safetyApprovedProjects` (so even if YOLO is toggled off, rest of project is approved)

### Summary: Which layer catches what

| Scenario | Layer | User sees |
|----------|-------|-----------|
| Text-only task (summarize, refine) | L1: skipSafetyCheck | Nothing |
| 2nd+ task in same directory | L1: approvedSafetyDirs | Nothing |
| 2nd+ task in same project (parallel) | L2: per-project Set | Activity log |
| YOLO mode enabled | L3: YOLO auto-proceed | Activity log |
| First task, non-YOLO, new project | None | Safety dialog |

## Persistence & Hydration

All safety events are persisted to the `streaming_events` table:

| Event Type | When | Data |
|------------|------|------|
| `safety_prompt` | Agent sends prompt | `{safetyTier, warning, options, machineId}` |
| `safety_response` | User or YOLO responds | `{decision, autoApproved?}` |

On page refresh, `streaming-event-hydrator.ts`:
1. Finds all `safety_prompt` events
2. Finds all `safety_response` events
3. Returns only **unanswered** prompts as `pendingSafetyPrompts`
4. Realtime store reconstructs `safetyPrompts` Map -> dialog re-appears

## Frontend State

```typescript
// realtime-store.ts
interface SafetyPromptRequest {
  taskId: string
  safetyTier: string
  warning?: string
  machineId?: string
  options: Array<{ id: string; label: string; description?: string }>
  timestamp: Date
}

safetyPrompts: Map<string, SafetyPromptRequest>  // taskId -> prompt
respondToSafetyPrompt(taskId, decision) -> POST /api/dispatch/safety-decision
```

The `SafetyPromptDialog` component renders the first pending prompt (FIFO). On confirm/cancel/error, the prompt is always removed from the map to prevent stuck dialogs.

## SSE Event Types

| Event | Direction | Purpose |
|-------|-----------|---------|
| `task:safety_prompt` | Server -> Browser | Show safety dialog |
| `task:safety_auto_proceeded` | Server -> Browser | YOLO/per-project auto-proceed notification |

## Files

| File | Role |
|------|------|
| `packages/agent-runner/src/lib/workdir-safety.ts` | Tier detection logic |
| `packages/agent-runner/src/lib/task-executor.ts` | Safety check orchestration, decision handling |
| `packages/agent-runner/src/types.ts` | Message types |
| `server/lib/relay-server.ts` | WebSocket forwarding, `sendSafetyDecision()` |
| `server/routes/dispatch.ts` | `approvedSafetyDirs`, `dispatchedTaskDirs`, `/safety-decision` endpoint |
| `server/routes/events.ts` | YOLO auto-proceed, per-project approval, SSE emission |
| `src/stores/realtime-store.ts` | `safetyPrompts` Map, `respondToSafetyPrompt()` |
| `src/components/safety-prompt-dialog.tsx` | Dialog UI |
| `src/lib/streaming-event-hydrator.ts` | Page-refresh recovery |
| `src/lib/realtime-client.ts` | SSE event type registration |
