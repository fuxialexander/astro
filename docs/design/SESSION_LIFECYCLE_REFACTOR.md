# Session/Project Lifecycle Refactor (Option C)

> **Status**: Planned
> **Date**: 2026-03-28
> **Goal**: Unify plan, playground, and project flows into a single "session" concept

## Architecture Overview (Current State)

The system currently has three distinct flows that share ~80% of their logic but diverge at critical junctions:

**Plan flow** (`startPlanGeneration`): Creates a project with `projectType: 'plan'`, uses nodeId `plan-<projectId>`, dispatches with `isInteractivePlan: true`, which causes the server at `server/routes/dispatch.ts:1197` to call `buildInteractivePlanPrompt()` and set relay task `type: 'plan'`.

**Playground flow** (`startPlaygroundSession`): Creates a project with `projectType: 'playground'`, uses nodeId `playground-<projectId>`, dispatches with `isInteractivePlan: false`, which causes the server at `dispatch.ts:1214` to call `buildUnifiedPlaygroundPrompt()` and set relay task `type: 'playground'`.

**Regular project**: `projectType: 'default'`, plan nodes created manually or via plan session. Individual task nodes dispatched by nodeId.

The key divergence points are:
1. **Node ID prefix** -- `plan-` vs `playground-` -- used everywhere for routing, UI selection, steer/cancel, `isExecutionNodeId()` guard
2. **`projectType` column** -- `'plan'` vs `'playground'` vs `'default'` -- used for sidebar categorization, filtering in ~15 files
3. **`isInteractivePlan` boolean** -- dispatched to server, determines system prompt and relay task type
4. **Promotion hack** -- `data.ts:925` and `plan-store.ts:428` promote `playground` to `default` when plan nodes are created
5. **Separate cancel/steer methods** -- `cancelPlanGeneration` vs `cancelPlaygroundSession`, `steerPlanGeneration` vs `steerPlaygroundSession` -- functionally identical except for nodeId prefix

## Design Principles

1. **Single node ID prefix**: Use `session-<projectId>` for all unified sessions. The `plan-` and `playground-` prefixes currently serve as routing discriminants; replacing them with a single prefix eliminates the branching.

2. **Remove `projectType` as a categorization signal**: Instead, derive sidebar placement from whether a project has plan nodes (a runtime query, not a stored enum).

3. **Single prompt pathway**: Use `buildUnifiedPlaygroundPrompt()` for all sessions. It already handles both planning (via astro-cli) and direct execution.

4. **No promotion hack**: When a session creates plan nodes, no `projectType` mutation is needed. The sidebar simply re-derives its categories.

## Phased Implementation

### Phase 0: Preparation (Non-Breaking Additions)

**Goal**: Add the new unified primitives alongside existing ones. Zero behavioral change. Everything is additive.

#### Step 0.1: Add `session-` node ID support

**File**: `src/stores/execution-store.ts`

- Add a new helper function `isSessionNodeId(nodeId: string)` that returns `true` for `session-` prefixed IDs.
- Update `isExecutionNodeId()` to also exclude `session-` prefixed IDs (same treatment as `playground-`):
  ```
  return !nodeId.startsWith('playground-') && !nodeId.startsWith('session-')
  ```
- This ensures existing summary parsing, persist logic, etc. correctly handle session nodes.

#### Step 0.2: Add derived sidebar categorization helper

**File**: New helper in `src/lib/project-categorization.ts`

- Create a function `categorizeProjects(projects, planNodes)` that returns `{ projectsWithNodes: Project[], recentSessions: Project[] }`.
- Logic: A project appears in "PROJECTS" if `planNodes.some(n => n.projectId === p.id && !n.deletedAt)`, otherwise in "RECENT".
- This function will be used by the sidebar in Phase 2 to replace the `projectType` filter.

#### Step 0.3: Add `startSession()` method to execution store

**File**: `src/stores/execution-store.ts`

- Add a new `startSession()` method that is a merge of `startPlanGeneration` and `startPlaygroundSession`. Key differences from both:
  - Uses `projectType: 'default'` always (no `'plan'` or `'playground'`)
  - Uses nodeId `session-<projectId>`
  - Dispatches with `isInteractivePlan: false` (the unified prompt handles both modes)
  - Includes all option fields from both methods (visionDoc, resumeSessionId, forkSession, selectedBackends, etc.)
  - Accepts an optional `teamId` parameter. Plan flow uses workspace filter; playground uses personal team. Session should accept both patterns via caller.
- Add corresponding `cancelSession(projectId)` and `steerSession(projectId, message)` -- structurally identical to the playground versions but using `session-` prefix.

**File**: `server/routes/dispatch.ts`

- Add handling for `session-` prefixed nodeIds. When `nodeId.startsWith('session-')` and `isInteractivePlan === false`, use `buildUnifiedPlaygroundPrompt()` (same as current playground path).
- Add the relay task type for session nodes: use `type: 'playground'` for backward compatibility with existing agent runners.

**Testing checkpoint**: Start sessions from the console via `useExecutionStore.getState().startSession(...)`. Verify dispatch succeeds, SSE events flow, activity renders. No UI changes yet.

---

### Phase 1: Unified Entry Points (Wire New UI to `startSession`)

**Goal**: Make both the inbox and `/plan` page use `startSession()` under the hood. Existing methods remain for backward compat with in-flight sessions.

#### Step 1.1: Update Inbox Home to use `startSession`

**File**: `src/pages/inbox-home.tsx`

- Replace `startPlaygroundSession` call with `startSession`.
- Keep same route navigation initially -- the Playground page will handle both nodeId prefixes.

#### Step 1.2: Update Plan Page to use `startSession`

**File**: `src/pages/project-new-plan.tsx`

- Replace `startPlanGeneration` call with `startSession`, passing the same options plus `visionDoc`.
- Replace `startPlanGenerationForProject` call with an analogous session method.
- The key change: no longer sends `isInteractivePlan: true`. The unified prompt handles planning via astro-cli instructions.
- Keep the plan page's vision doc, advanced settings, etc. -- these just become additional options passed to `startSession`.

#### Step 1.3: Update Playground page to handle `session-` nodeIds

**File**: `src/pages/playground.tsx`

- Change execution lookup to also check `session-${activeProjectId}` (try session first, fallback to playground for backward compat).
- Update cancel/steer calls to use the session variants when the execution uses a `session-` nodeId.
- Add a helper: `getNodeIdForProject(projectId, executions)` that checks `session-`, `playground-`, `plan-` in order and returns the first match.

#### Step 1.4: Update PlanGeneration component for session nodeIds

**File**: `src/components/plan-generation/plan-generation.tsx`

- Change nodeId derivation to also check for `session-` prefix.
- Update cancel/steer to use session-aware methods.
- Handle both old `plan-` executions and new `session-` ones.

**Testing checkpoint**: Create sessions from both inbox and /plan page. Verify dispatch succeeds, SSE events flow, activity renders, plan_result events fire when the AI creates plan nodes via astro-cli, steer/cancel works.

---

### Phase 2: Dynamic Sidebar Categorization

**Goal**: Replace the `projectType`-based sidebar split with a plan-node-based derivation.

#### Step 2.1: Update Sidebar categorization

**File**: `src/components/layout/sidebar.tsx`

- Replace `activeProjects` and `playgroundProjects` with new derivation:
  ```typescript
  const projectsWithPlanNodes = useMemo(() => {
    const projectIdsWithNodes = new Set(planNodes.map(n => n.projectId))
    return projects.filter(p => p.status === "active" && projectIdsWithNodes.has(p.id))
  }, [projects, planNodes])

  const recentSessions = useMemo(() => {
    const projectIdsWithNodes = new Set(planNodes.map(n => n.projectId))
    return projects.filter(p => p.status === "active" && !projectIdsWithNodes.has(p.id))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
  }, [projects, planNodes])
  ```
- Rename the "PLAYGROUND" section header to "RECENT".
- Update `navigateToProject` to check for any active execution and whether the project has plan nodes.

#### Step 2.2: Update other `projectType` filters

Apply the same pattern to all files that filter on `projectType`:

| File | Change |
|------|--------|
| `src/pages/inbox-home.tsx` | Replace `p.projectType !== "playground"` with plan-node-based check |
| `src/pages/projects.tsx` | Same |
| `src/pages/dashboard.tsx` | Replace `regularProjects`/`playgroundProjects` with node-based |
| `src/pages/initiatives.tsx` | Same |
| `src/pages/active-tasks.tsx` | Replace `project?.projectType === "playground"` with runtime node check |
| `src/components/command-palette/index.tsx` | Same split |
| `src/lib/project-grouping.ts` | Replace `projectType === "playground"` check; add optional `hasPlanNodes` param |

#### Step 2.3: Remove the promotion hack

**File**: `server/routes/data.ts`

- Remove the `if (project.projectType === 'playground')` auto-promote block. No longer needed since categorization is node-based.

**File**: `src/stores/plan-store.ts`

- Remove the client-side promotion hack. No longer needed.

**Testing checkpoint**:
- Create a session from inbox (no plan nodes) -- appears in RECENT
- That session creates plan nodes via astro-cli -- instantly moves to PROJECTS
- Clicking it in PROJECTS navigates to plan view
- Old playground projects still appear correctly

---

### Phase 3: Cleanup and Dead Code Removal

**Goal**: Remove the old parallel code paths now that everything uses sessions.

#### Step 3.1: Remove old execution store methods

**File**: `src/stores/execution-store.ts`

- Remove `startPlanGeneration`, `startPlanGenerationForProject`, `cancelPlanGeneration`, `steerPlanGeneration`, `cleanupPlanGeneration`
- Remove `startPlaygroundSession`, `cancelPlaygroundSession`, `steerPlaygroundSession`
- Update the interface type to remove old method signatures.

#### Step 3.2: Remove `buildInteractivePlanPrompt` usage

**File**: `server/routes/dispatch.ts`

- Remove the `if (isInteractivePlan)` branch. All sessions use the unified prompt.
- Keep `isInteractivePlan` in the Zod schema for backward compat (just ignore it), or mark deprecated.

#### Step 3.3: Simplify `isInteractivePlan` references

**File**: `server/routes/dispatch.ts`

- `isPushToGithub` check no longer needs `!isInteractivePlan` guard.
- Relay task type assignment simplifies. Sessions use `type: 'playground'`.
- YOLO auto-dispatch: extend trigger to `nodeId.startsWith('session-') && isSuccess && yoloEnabled`.

#### Step 3.4: Clean up `projectType` references

- **`packages/core/src/db/schema.ts`**: Keep the column (backward compat) but stop writing `'plan'` or `'playground'`. All new projects get `'default'`.
- **All frontend files**: Remove `projectType` filtering logic replaced in Phase 2.

#### Step 3.5: Remove `buildInteractivePlanPrompt` function

**File**: `packages/core/src/prompt-templates.ts`

- Mark `buildInteractivePlanPrompt` as deprecated or remove it.
- Verify `buildUnifiedPlaygroundPrompt` receives all needed context (vision doc, skills, replan context).
- **Gap**: Replan context needs to be wired into the unified prompt or injected as a user message.

#### Step 3.6: Clean up other references

- **`src/hooks/use-convert-to-project.ts`**: Set `projectType: 'default'` instead of `'plan'`.

**Testing checkpoint**: Full regression. Start sessions from inbox and /plan. Verify plan creation, YOLO auto-dispatch, steer, cancel, plan_result rendering, navigation, sidebar categorization.

---

## Risks and Edge Cases

1. **In-flight sessions**: Users may have active `plan-` or `playground-` prefixed executions. Components must continue to recognize old prefixes for at least one release cycle. Add a `getNodeIdForProject(projectId, executions)` helper that tries `session-`, `playground-`, `plan-` in order.

2. **Replan context**: `buildInteractivePlanPrompt` receives `replanContext` which `buildUnifiedPlaygroundPrompt` does not. Ensure replan context is injected as a user message prefix in the dispatch route.

3. **YOLO auto-dispatch timing**: Currently gated on `isInteractivePlan`. When sessions use `isInteractivePlan: false`, this won't trigger. Fix: check `nodeId.startsWith('session-')` instead.

4. **plan_result SSE event routing**: The `task:plan_result` handler is keyed on `taskId` (executionId), not nodeId. It is prefix-agnostic and will work unchanged.

5. **Database migration**: The `projectType` column stays in the schema. Existing `'plan'`/`'playground'` values are harmless since frontend no longer reads them for categorization.

6. **`project-grouping.ts` API change**: `getProjectGroupDescriptor` checks `projectType === "playground"`. Change to accept optional `hasPlanNodes` boolean parameter.

7. **Agent runner backward compatibility**: Use relay task `type: 'playground'` for unified sessions to avoid breaking existing agent runners that don't know about `'session'` type.

---

## Summary of Changes by File

| File | Phase | Change |
|------|-------|--------|
| `src/stores/execution-store.ts` | 0, 3 | Add `startSession`/`cancelSession`/`steerSession`, then remove old methods |
| `server/routes/dispatch.ts` | 0, 3 | Handle `session-` prefix, simplify prompt selection, fix YOLO gate |
| `src/pages/inbox-home.tsx` | 1, 2 | Wire `startSession`, update project filtering |
| `src/pages/project-new-plan.tsx` | 1 | Wire `startSession` |
| `src/pages/playground.tsx` | 1 | Handle `session-` nodeIds |
| `src/components/plan-generation/plan-generation.tsx` | 1 | Handle `session-` nodeIds |
| `src/components/layout/sidebar.tsx` | 2 | Node-based categorization, rename PLAYGROUND to RECENT |
| `server/routes/data.ts` | 2 | Remove promotion hack |
| `src/stores/plan-store.ts` | 2 | Remove client-side promotion |
| `src/pages/dashboard.tsx` | 2 | Node-based project split |
| `src/pages/projects.tsx` | 2 | Node-based filtering |
| `src/pages/active-tasks.tsx` | 2 | Node-based playground detection |
| `src/pages/initiatives.tsx` | 2 | Node-based filtering |
| `src/components/command-palette/index.tsx` | 2 | Node-based project/session split |
| `src/lib/project-grouping.ts` | 2 | Node-based group descriptor |
| `packages/core/src/prompt-templates.ts` | 3 | Deprecate `buildInteractivePlanPrompt` |
| `src/hooks/use-convert-to-project.ts` | 3 | Use `projectType: 'default'` |
