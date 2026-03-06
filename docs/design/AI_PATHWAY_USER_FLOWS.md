# AI Pathway User Flows

What users see and do for each AI pathway, which pathways overlap, and how they map to frontend pages.

**Last updated:** 2026-03-05

**Companion doc:** `AI_PROVIDER_PATHWAYS.md` (technical architecture, provider capabilities)

---

## 1. User Journey Map

Each numbered pathway maps to the technical pathway in `AI_PROVIDER_PATHWAYS.md`.

```
User opens Astro
    |
    +---> Create New Project (project-new-plan page)
    |       |
    |       +---> [P3] Interactive Plan Session
    |       |       User enters goal + settings, clicks "Start"
    |       |       Agent brainstorms with full tool access
    |       |       Produces structured plan (nodes/edges)
    |       |         |
    |       |         +---> [P7] Plan Chat (refinement)
    |       |                 User sends follow-up messages
    |       |                 "Split task 3 into two subtasks"
    |       |                 "Add a testing phase after deployment"
    |       |                 Agent updates plan via mutations
    |       |
    |       +---> [P5] Template Application (DEAD CODE)
    |               UseTemplateSheet was intended to apply templates
    |               to existing plans via structured JSON generation,
    |               but was never wired to any page
    |
    +---> Examples (/examples page)
    |       |
    |       +---> Click example card → TemplatePickerDialog
    |               Configure params, machine, working dir
    |               "Enter Plan Mode" → navigates to /plan with prefill
    |               (uses Pathway 3, NOT Pathway 5)
    |
    +---> Plan View (plan-view page, existing project)
    |       |
    |       +---> [P6] Project Chat (sidebar)
    |       |       User opens chat sidebar
    |       |       "What's the status of the auth module?"
    |       |       Read-only tools, general discussion
    |       |
    |       +---> [P1] Task Execution (per node)
    |       |       User clicks "Execute" on a plan node
    |       |       Agent works: reads files, writes code, creates PR
    |       |         |
    |       |         +---> [P14] Steering (during execution)
    |       |         |       "Focus on the error handling first"
    |       |         |
    |       |         +---> [P10] Summary (auto, after completion)
    |       |         +---> [P11] Title Gen (auto, if no title)
    |       |         +---> [P13] Labels (auto, on creation)
    |       |
    |       +---> Task Detail (task-detail page)
    |               |
    |               +---> [P8] Task Chat
    |               |       "Why did you choose this approach?"
    |               |       Session resume supported
    |               |
    |               +---> [P12] Refine (button)
    |                       "Improve this task description"
    |
    +---> Playground (playground page)
    |       |
    |       +---> [P2] Playground Execution
    |               User enters goal, clicks "Start"
    |               Same as task execution but ephemeral
    |               Follow-up via steering
    |
    +---> HPC Dispatch (HPC-specific UI)
            |
            +---> [P4] Slurm Dispatch
                    User configures Slurm resources
                    Agent runs on machine with Slurm access
                    Submits jobs to cluster
```

---

## 2. Pathway Pair Analysis

### Pair 1: Pathway 3 (Interactive Plan) vs Pathway 5 (Plan Generation)

**These look similar but are fundamentally different. And critically: Pathway 5 is entirely dead code.**

| | P3: Interactive Plan | P5: Plan Generation |
|---|---|---|
| **Frontend trigger** | `startPlanGeneration()` in execution-store | `generatePlan()` in api-client |
| **Called from** | `project-new-plan.tsx` (primary plan creation page) | **NOWHERE** (see below) |
| **API route** | `POST /api/dispatch/task` with `isInteractivePlan: true` | `POST /api/agent/generate-plan` |
| **Backend handler** | `routes/dispatch.ts` | `routes/agent.ts` |
| **Task type** | `execution` (full agentic) | `plan` (text-only, no tools) |
| **Has tools?** | Yes -- Read, Write, Bash, Grep, Glob, etc. | No -- text-only completion |
| **Output format** | Free-form text; plan JSON extracted server-side | Forced `json_schema` structured output |
| **Skills loaded** | Yes (settingSources on SDK, native on CLI) | No (text-only fast path on SDK) |
| **Multi-turn** | Yes -- agent loop with many turns | Limited -- 1-3 turns for JSON generation |
| **User can steer** | Yes -- user sends messages during generation | Limited |
| **Prompt builder** | `buildInteractivePlanPrompt()` | `buildPlanSystemPrompt()` |
| **Follow-up** | Transitions to Pathway 7 (project-chat) | None |

**Key insight: Pathway 5 is entirely dead code.** Both callers of `generatePlan()` are unreachable:

1. **`UseTemplateSheet`** (`use-template-sheet.tsx`) -- this component calls `generatePlan()` to apply a template to an existing plan, but it is **never imported or rendered** by any page.
2. **`startGeneration()`** in `agent-store.ts` -- this store function calls `generatePlan()` but is **never invoked** from any UI component.

**What about Examples?** The UI has an **Examples page** (`/examples`) that shows curated example cards. Despite the underlying data model using "templates" in code, the UI calls them "Examples." The flow is:

```
1. User opens Examples page (examples.tsx)
2. Clicks an example card → opens TemplatePickerDialog (NOT UseTemplateSheet)
3. Configures parameters, machine, working directory
4. Clicks "Enter Plan Mode"
5. Dialog resolves template description → navigates to /plan with prefilled form data
6. User reviews prefilled goal on the plan creation page
7. Clicks "Start Planning"
8. [P3] startPlanGeneration() dispatches to /api/dispatch/task with isInteractivePlan=true
9. Agent brainstorms interactively (full tools, multi-turn)
10. Server extracts plan JSON from agent output
11. Plan nodes/edges appear in UI
12. [P7] User can refine plan via project-chat
```

**The Examples page uses Pathway 3 (Interactive Plan), not Pathway 5.** It pre-fills the plan creation form with the resolved template description, then lets the user trigger P3 as normal.

**Should Pathway 5 be removed?** The backend route (`/api/agent/generate-plan`) works correctly and could be useful for a future "quick plan from template" feature. But all frontend callers are dead code:
- `UseTemplateSheet` -- never rendered (was intended for applying templates to existing plans)
- `startGeneration()` in agent-store -- never called
- The Examples page uses `TemplatePickerDialog` → Plan page → P3 instead

**Cleanup candidates:**
- Remove `UseTemplateSheet` component (dead code)
- Remove `startGeneration()` from `agent-store.ts` (dead code)
- Keep `/api/agent/generate-plan` backend route (functional, may be useful later)

### Pair 2: Pathway 6 (Project Chat) vs Pathway 7 (Plan Chat)

**These are almost identical in implementation but serve different user contexts.**

| | P6: Project Chat | P7: Plan Chat |
|---|---|---|
| **Frontend component** | `ChatPanel` in `chat-panel.tsx` | `PlanGeneration` in `plan-generation.tsx` |
| **Page** | Plan View page (sidebar) | Plan Creation page (chat phase, after initial plan) |
| **When** | Anytime on plan view | After plan generation completes |
| **Default model** | Agent runner default | **Haiku** (cost optimization) |
| **Plan mutations** | No -- general discussion | **Yes** -- parses `astro-updates`, `astro-edges`, `astro-add-nodes` |
| **System prompt** | `buildChatSystemPrompt()` | `buildChatSystemPrompt()` (identical) |
| **Schema** | `chatSchema` | `chatSchema` (identical) |
| **Skills** | Yes (backend-scoped) | Yes (backend-scoped, identical) |
| **Relay function** | `streamChatViaRelay()` | `streamChatViaRelay()` (identical) |
| **API route** | `POST /api/agent/chat` | `POST /api/agent/project-chat` |
| **Backend difference** | Line 740: `model: model \|\| undefined` | Line 789: `model: model \|\| 'haiku'` |

**The backend code is identical except for one line: the default model.**

The real differentiation is **frontend-side**:
- **Project Chat** (`ChatPanel`): General-purpose chat sidebar on the plan view page. User discusses the project, asks questions, gets analysis. No plan mutations.
- **Plan Chat** (`PlanGeneration`): Interactive plan refinement during plan creation. The frontend **parses structured plan mutations** from the AI's response (code blocks tagged `astro-updates`, `astro-edges`, `astro-add-nodes`) and applies them to the plan graph. This is what makes "Add a testing phase" actually create new nodes.

**Should they be merged?** The backend routes could be merged (just pass `model: 'haiku'` from the frontend when in plan context). But the frontend components are genuinely different -- `PlanGeneration` has mutation parsing that `ChatPanel` doesn't need. Keeping separate API routes gives cleaner analytics and allows future divergence.

---

## 3. Complete Frontend-to-Pathway Map

### What the User Sees for Each Pathway

#### P1: Task Execution
- **Page:** Plan View or Task Detail
- **Trigger:** Click green "Execute" button on a plan node
- **User sees:** Status badge changes: planned -> dispatched -> in_progress. Real-time activity stream shows: text output, tool calls (Read, Write, Bash), file changes, approval requests. Final status: completed/failed.
- **Duration:** Minutes to hours
- **Skills:** Yes (provider + compute backend + user)
- **Stored:** streaming_events + taskExecutions + planNodes

#### P2: Playground
- **Page:** `/playground`
- **Trigger:** Enter goal description + settings, click "Start"
- **User sees:** Landing phase with goal input -> Activity phase with streaming output. File sidebar shows changed files. Can send follow-up messages (steering). Post-completion chat available.
- **Duration:** Minutes to hours
- **Skills:** Yes (provider + compute backend + user)
- **Stored:** streaming_events + taskExecutions

#### P3: Interactive Plan
- **Page:** `/project-new-plan`
- **Trigger:** Enter goal + settings, click "Start"
- **User sees:** Full-height streaming activity. Agent brainstorms, may read files, asks clarifying questions (approval cards). Plan nodes appear when agent produces structured output. Transitions to project-chat phase.
- **Duration:** 1-5 minutes
- **Skills:** Yes (provider + compute backend + user)
- **Stored:** streaming_events

#### P4: HPC/Slurm Dispatch
- **Page:** HPC dispatch UI
- **Trigger:** Configure Slurm resources (partition, GPU, nodes, time), click "Dispatch"
- **User sees:** Same as P1 (task execution) but on HPC machine. Agent submits Slurm jobs, monitors with squeue/sacct.
- **Duration:** Minutes to hours (depends on Slurm queue)
- **Skills:** Yes (Claude SDK only, HPC-specific compute backend skills)
- **Stored:** streaming_events + taskExecutions

#### P5: Plan Generation (structured) -- DEAD CODE
- **Page:** Was intended for `UseTemplateSheet` (applying templates to existing plans)
- **Trigger:** None -- `UseTemplateSheet` is never rendered; `startGeneration()` in agent-store is never called
- **User sees:** N/A -- unreachable from UI. The **Examples page** uses `TemplatePickerDialog` → Plan page → Pathway 3 instead.
- **Duration:** Would be 10-30 seconds if reachable
- **Skills:** No (text-only fast path)
- **Stored:** streaming_events
- **Note:** Backend route `/api/agent/generate-plan` is functional; only frontend callers are dead

#### P6: Project Chat
- **Page:** Plan View (sidebar)
- **Trigger:** Type message in chat sidebar, press Enter
- **User sees:** Resizable chat sidebar (right or bottom layout). Messages stream in real-time. Can reference plan nodes with @mentions. Tool results inline (Read, Grep results).
- **Duration:** Seconds per response
- **Skills:** Yes (provider + compute backend + user)
- **Stored:** streaming_events

#### P7: Plan Chat
- **Page:** `/project-new-plan` (chat phase, after P3 completes)
- **Trigger:** Type refinement message, press Enter
- **User sees:** Full-height activity feed. AI responses may include plan mutations that automatically update the plan graph: new nodes added, edges modified, task descriptions updated.
- **Duration:** Seconds per response
- **Skills:** Yes (provider + compute backend + user)
- **Stored:** streaming_events

#### P8: Task Chat
- **Page:** Task Detail page
- **Trigger:** Type message in task chat panel, press Enter
- **User sees:** Chat messages in scrollable area. Can discuss task output, ask "why did you choose this approach?", request analysis of results. Supports session resume across page refreshes.
- **Duration:** Seconds per response
- **Skills:** Yes (provider + compute backend + user)
- **Stored:** streaming_events

#### P9: Compact
- **Page:** Not directly visible
- **Trigger:** Auto-triggered when conversation context exceeds limit
- **User sees:** Nothing -- transparent to user. Context window is silently compressed.
- **Duration:** 5-15 seconds
- **Skills:** No
- **Stored:** streaming_events

#### P10: Task Summary
- **Page:** Task Detail (auto-appears after execution)
- **Trigger:** Auto-triggered when task completes
- **User sees:** Summary card appears in task detail with structured findings, files changed, follow-ups.
- **Duration:** 5-15 seconds
- **Skills:** No
- **Stored:** Not persisted (returned to caller only)

#### P11: Title Generation
- **Page:** Plan View (during task creation)
- **Trigger:** Auto-triggered when creating a task with description but no title
- **User sees:** Title field auto-fills after brief delay
- **Duration:** 2-5 seconds
- **Skills:** No
- **Stored:** Not persisted (returned to caller only)

#### P12: Refine
- **Page:** Task Detail or Plan View
- **Trigger:** Click "Refine" button on task/project
- **User sees:** Improved title and description appear, replacing original
- **Duration:** 5-10 seconds
- **Skills:** No
- **Stored:** Not persisted (returned to caller only)

#### P13: Label Suggestion
- **Page:** Plan View (during task creation)
- **Trigger:** Auto-triggered when creating a new task
- **User sees:** Label badges auto-appear on the task (Frontend, Backend, Testing, etc.)
- **Duration:** 2-5 seconds
- **Skills:** No
- **Stored:** Not persisted (returned to caller only)

#### P14: Steering
- **Page:** Task Detail (during execution)
- **Trigger:** Type message in steer chat while task is running
- **User sees:** Message appears in activity feed. Agent acknowledges and adjusts behavior. Or if task completed, triggers session resume.
- **Duration:** Instant (inject) or seconds (resume response)
- **Skills:** N/A (modifies existing session)
- **Stored:** streaming_events (steer_message event)

#### P15: Plan Extraction Retry
- **Page:** Not visible
- **Trigger:** Auto when plan JSON extraction fails after P3
- **User sees:** Nothing -- transparent fallback. If it works, plan appears. If it fails, user sees "Plan generation failed" error.
- **Duration:** 5-30 seconds
- **Skills:** No
- **Stored:** streaming_events (plan_result if successful)

#### P16: Server-Side Summary
- **Page:** Not visible (affects PR body)
- **Trigger:** Auto when generating PR body after execution
- **User sees:** PR description on GitHub includes AI-generated summary
- **Duration:** 5-15 seconds
- **Skills:** No
- **Stored:** Not persisted

---

## 4. Skill Injection Summary

### Which pathways load skills?

```
Provider Skills (settingSources / native CLI):
  [P1] Task Execution        -- YES
  [P2] Playground             -- YES
  [P3] Interactive Plan       -- YES
  [P4] HPC/Slurm             -- YES (Claude SDK only)
  [P5] Plan Generation        -- NO  (text-only fast path)
  [P6] Project Chat           -- YES (fixed in PR #52)
  [P7] Plan Chat              -- YES (fixed in PR #52)
  [P8] Task Chat              -- YES (fixed in PR #52)
  [P9-P16]                    -- NO  (one-shot / control / fallback)

Compute Backend Skills (server-side injection into prompt):
  [P1] Task Execution        -- YES (getBackendScopedSkillInjection)
  [P2] Playground             -- YES
  [P3] Interactive Plan       -- YES (via buildInteractivePlanPrompt)
  [P4] HPC/Slurm             -- YES (HPC-specific)
  [P5] Plan Generation        -- YES (via buildPlanSystemPrompt)
  [P6] Project Chat           -- YES (via buildChatSystemPrompt)
  [P7] Plan Chat              -- YES (via buildChatSystemPrompt)
  [P8] Task Chat              -- YES (via buildTaskChatSystemPrompt)
  [P9-P16]                    -- NO

User Environment Context (loadEnvironmentContext):
  [P1] Task Execution        -- YES
  [P3] Interactive Plan       -- YES
  [P5] Plan Generation        -- YES
  [P6] Project Chat           -- YES
  [P7] Plan Chat              -- YES
  [P8] Task Chat              -- YES
  [P2,P4,P9-P16]             -- Varies / NO
```

### Skill loading has two layers:

1. **Server-side injection** (`getBackendScopedSkillInjection` + `loadEnvironmentContext`): Skills content injected into the system prompt before sending to agent runner. Works with ALL providers. Applied to P1-P8.

2. **Provider-side loading** (`settingSources` on Claude SDK, native on CLI): Provider loads its own skill files (`~/.claude/skills/`, `~/.codex/skills/`). Only works for agentic/chat pathways where the provider has tool access. Applied to P1-P4 (agentic) and P6-P8 (chat).

### Why one-shot pathways (P10-P13) don't load skills

P10-P13 are real, user-visible workflows that produce tangible outputs:
- **P10 Summary**: Structured findings card on the task detail page
- **P11 Title**: Auto-generated task title that appears in plan nodes
- **P12 Refine**: Improved title + description, replaces original
- **P13 Labels**: Suggested labels (Frontend, Backend, Testing, etc.) as badges

These are **"generate once, store the result, discard the trace"** workflows. They use `executeViaRelay()` (no streaming event persistence) instead of `streamChatViaRelay()`. The refined title/description/labels/summary is what matters -- the generation process is ephemeral.

Skills are not loaded because the input (task description, execution output) already contains sufficient context for a one-shot refinement. Injecting compute backend skills into a title generator would add prompt tokens and latency without improving output quality.

P9 (Compact) and P14 (Steering) are control signals, not generation workflows. P15-P16 are last-resort fallbacks that call the Anthropic API directly (not through the relay).

---

## 5. Overlap and Consolidation Opportunities

### Could P6 and P7 be merged?

**Backend: Yes.** The only difference is `model: 'haiku'` default. The frontend could pass this.

**Frontend: No.** `PlanGeneration` parses plan mutations from AI output and applies them to the plan graph. `ChatPanel` doesn't do this. They serve different UX purposes.

**Recommendation:** Keep separate API routes for analytics and future divergence, but document that they share the same backend implementation.

### Could P3 replace P5 entirely?

**P3 already has.** P5 has zero active callers in the UI. The Examples page (the only user-facing "template" feature) pre-fills the Plan page form and uses P3. The `UseTemplateSheet` component that was meant to call P5 was never wired up.

**Recommendation:** Clean up the dead frontend code (`UseTemplateSheet`, `startGeneration()`). Keep the backend route `/api/agent/generate-plan` -- it's functional and could serve a future "quick structured plan" feature, but it's not exposed to users today.

### Could P10-P13 share an implementation?

**Yes, they already do.** All four call `executeViaRelay()` with `type: 'summarize'`, `maxTurns: 1`, different prompt builders. The only differences are:
- Prompt builder function
- Response parsing (JSON extraction vs plain text)
- Fallback behavior

They could share a generic `singleTurnAiCall()` helper.

---

## 6. Missing: HPC + Non-SDK Providers

**Current state:** HPC/Slurm dispatch (P4) forces `claude-sdk` provider. This means Codex, OpenClaw, and OpenCode cannot be used for HPC tasks.

**Why this is a gap:** Users who prefer Codex (or have it as their only provider) cannot use HPC dispatch at all. The constraint exists because only Claude SDK was tested with Slurm workflow patterns.

**See:** `docs/design/HPC_WORKFLOW.md` for the detailed design and plan to support Codex on HPC.
