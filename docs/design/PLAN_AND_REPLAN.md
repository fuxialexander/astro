# Plan Generation, Refinement & Replan

> **Last updated:** 2026-03-06
> **Status:** Active — describes the current plan/replan pipeline after the unified mutation format migration.

How Astro generates, refines, and replans project DAGs: prompt templates, extraction pipelines, mutation application, and error handling.

Related: [AGENTIC_WORKFLOW.md](AGENTIC_WORKFLOW.md) (task execution after the plan exists), [ARCHITECTURE.md](ARCHITECTURE.md) (system overview).

---

## 1. Overview

Astro's planning pipeline has three phases, each with its own prompt template, output format, and extraction logic:

1. **Plan generation** — AI produces a full plan JSON (nodes + edges) from a project description
2. **Plan refinement** — User chats with AI about the existing plan; AI emits incremental mutations
3. **Replan** — AI generates a fresh plan informed by lessons from a prior execution

```
                         ┌─────────────────────┐
                         │  User describes goal │
                         └──────────┬──────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │  Plan Generation (Phase 1)   │
                     │  buildInteractivePlanPrompt  │
                     │  Output: ```json { plan }    │
                     │  Extract: extractPlanJson     │
                     └──────────────┬──────────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │  Plan Refinement (Phase 2)   │
                     │  buildChatSystemPrompt        │
                     │  Output: ```json mutation obj │
                     │  Extract: extractMutations    │
                     └──────────────┬──────────────┘
                                    │  (user requests replan)
                     ┌──────────────▼──────────────┐
                     │  Replan (Phase 3)            │
                     │  buildInteractivePlanPrompt  │
                     │  + ReplanContext              │
                     │  Output: ```json { plan }    │
                     └─────────────────────────────┘
```

---

## 2. Prompt Templates

### 2.1 Template Map

| Function | File | Used By | Output Format |
|---|---|---|---|
| `buildInteractivePlanPrompt()` | `packages/core/src/prompt-templates.ts:792` | Plan generation, replan | Full plan JSON in ` ```json ` fence |
| `buildPlanSystemPrompt()` | `packages/core/src/prompt-templates.ts:145` | One-shot plan (no tools) | Raw JSON (no fences) |
| `buildChatSystemPrompt()` | `packages/core/src/prompt-templates.ts:375` | Project chat (refinement) | ` ```json ` mutation blocks (shape-detected) |
| `buildTaskChatSystemPrompt()` | `packages/core/src/prompt-templates.ts:551` | Task-level chat | Plain text (no plan mutations) |
| `buildTaskExecutionPrompt()` | `packages/core/src/prompt-templates.ts:612` | Task dispatch | Plain text with executive summary |

### 2.2 Interactive Plan Prompt Structure

`buildInteractivePlanPrompt()` assembles these sections in order:

```
┌─────────────────────────────────────────────┐
│  "You are an interactive project planner"    │
├─────────────────────────────────────────────┤
│  ## User's Goal                              │
│  <user_goal> description </user_goal>        │
├─────────────────────────────────────────────┤
│  ## Project Vision Document  (optional)      │
│  <user_vision> vision doc </user_vision>     │
├─────────────────────────────────────────────┤
│  ## Previous Plan — Lessons Learned (replan) │
│  Per-task status badges + follow-ups         │
├─────────────────────────────────────────────┤
│  ## CLAUDE.md / README / Package / File Tree │
│  <user_content> repo context </user_content> │
├─────────────────────────────────────────────┤
│  ## Git Repository State  (optional)         │
│  Current branch, target branch, dirty state  │
├─────────────────────────────────────────────┤
│  ## Available Agent Skills & Tools (optional)│
├─────────────────────────────────────────────┤
│  ## GitHub Integration  (optional)           │
│  "Push to GitHub" final task instructions    │
├─────────────────────────────────────────────┤
│  ## Your Approach                            │
│  1. Quick survey  2. Ask questions           │
│  3. Deep-dive  4. Share reasoning            │
│  5. Produce final plan JSON                  │
├─────────────────────────────────────────────┤
│  ## Plan Output Format (JSON example)        │
│  ## Node Rules / Edge Rules / Constraints    │
│  ## Important (no code, plan only)           │
└─────────────────────────────────────────────┘
```

Key design decisions:
- **Provider-unified**: No `isDirectPlan` branch. Both Claude and Codex get the same prompt. Tool-asking instructions are generic: "If you have a tool to ask the user questions (e.g., AskUserQuestion or an MCP equivalent), use it."
- **Codebase vs no-codebase**: Two approach paths based on whether `repoContext` is provided. With codebase, the agent is told to use Read/Glob/Grep; without, it uses WebSearch/WebFetch.
- **Security**: All user-provided content wrapped in XML delimiters (`<user_vision>`, `<user_content>`, `<user_goal>`) to reduce prompt injection risk.

### 2.3 Chat System Prompt Structure (Refinement)

`buildChatSystemPrompt()` assembles:

```
┌──────────────────────────────────────────────┐
│  Role: planning assistant with tool access    │
│  Available tools: Read, Grep, Bash, Web, etc │
├──────────────────────────────────────────────┤
│  Vision doc  (optional, in <user_vision>)    │
│  Current plan nodes  (with IDs, titles,      │
│    status, deps, milestones)                 │
│  Current edges                               │
│  Available milestones                        │
├──────────────────────────────────────────────┤
│  Skills injection  (optional)                │
├──────────────────────────────────────────────┤
│  ## Modifying the Plan                       │
│  Mutation format spec + example              │
│  Decomposition rules                         │
│  Rules (omit unchanged, CRITICAL emit block) │
└──────────────────────────────────────────────┘
```

The plan context section renders each node as:
```
- **[node-id]** Title (type, status, priority: P, estimate: E, milestone: M [mid], depends on: ...)
  Description text
```

This gives the AI exact node IDs for precise `updateNodes` targeting.

---

## 3. Plan Generation Pipeline

### 3.1 Data Flow

```
User clicks "Generate Plan"
        │
        ▼
startPlanGeneration()              ← src/stores/execution-store.ts
  ├─ Create project in store
  ├─ Create execution entry (nodeId: plan-{projectId})
  └─ POST /api/dispatch/task       ← fire-and-forget
        │
        ▼
Dispatch route                     ← server/routes/dispatch.ts
  ├─ Build system prompt: buildInteractivePlanPrompt(description, options)
  ├─ User prompt: description
  └─ streamChatViaRelay()          ← server/routes/agent.ts
        │
        ▼
Agent Runner (via relay)
  ├─ Explores codebase (Read, Glob, Grep)
  ├─ Asks clarifying questions (AskUserQuestion / MCP)
  ├─ Shares reasoning (text chunks → SSE)
  └─ Outputs final plan JSON in ```json fence
        │
        ▼
Frontend SSE processing            ← processSSEStreamWithReconnect()
  ├─ text events → accumulate in streamText
  ├─ tool_use/tool_result events → activity timeline
  └─ result/done event → trigger extraction
        │
        ▼
extractPlanJsonFromText(streamText) ← packages/core/src/plan-extraction.ts
  ├─ Strategy 1: Find all ```json fences, try last-first
  ├─ Strategy 2: Find last "projectName", brace-balance forward
  └─ Returns { projectName, nodes[], edges[] } or null
        │
        ▼
applyPlanFromText()                ← src/stores/execution-store.ts
  ├─ Map short IDs (n1, n2) → UUIDs
  ├─ Build PlanNode[] with all fields
  ├─ Build PlanEdge[] with resolved IDs
  └─ planStore.setProjectPlan(projectId, nodes, edges)
        │
        ▼
Plan visible in graph/list/timeline views
```

### 3.2 Plan JSON Extraction

`extractPlanJsonFromText()` in `packages/core/src/plan-extraction.ts`:

1. **Fenced JSON blocks** — Regex `/```json\s*\n([\s\S]*?)\n```/g` collects all matches. Tries them in reverse order (last first, since the plan is typically the final output). Validates by checking `parsed.nodes && Array.isArray(parsed.nodes)`.

2. **Raw JSON fallback** — Finds last occurrence of `"projectName"`, walks backward to find opening `{`, brace-balances forward to find the complete object. Parses and validates.

This two-strategy approach handles: fenced JSON (normal case), unfenced JSON (one-shot prompt), and multiple JSON blocks in the same response (picks the plan, not config snippets).

### 3.3 Plan Application

After extraction, `applyPlanFromText()` transforms the raw plan into store-ready objects:

- **ID resolution**: Short IDs from the AI (n1, n2, m1) are mapped to UUIDs. If a node with the same short ID already exists (replan), its UUID is reused.
- **HTML content**: `description` is escaped and wrapped in `<p>` tags for the TipTap editor.
- **Execution preservation**: When replanning, existing execution state (`executionId`, `executionOutput`, etc.) is preserved on nodes that map to the same short ID.
- **Layout**: `reorganizeProject()` auto-layouts nodes after application.

### 3.4 Error Handling

| Scenario | Behavior |
|---|---|
| No JSON found in response | Warning toast: "Plan extraction failed — try regenerating" |
| JSON parse error | Falls through to next strategy; if all fail, toast shown |
| SSE stream disconnects | Reconnect with catch-up from `streaming_events` table (5 retries, exponential backoff) |
| Agent runner crashes | Execution stays in "running"; user can cancel and retry |

---

## 4. Plan Refinement Pipeline (Chat Mutations)

### 4.1 Mutation Format

The AI outputs incremental plan changes in a single ` ```json ` fenced block. The JSON object's top-level keys (`updateNodes`, `addNodes`, `updateEdges`) are the disambiguator — no custom fence tag needed:

````
```json
{
  "updateNodes": [
    { "nodeId": "abc-123", "priority": "urgent", "estimate": "M" },
    { "nodeTitle": "Deploy to production", "status": "pruned" }
  ],
  "addNodes": [
    {
      "id": "temp1",
      "title": "Add caching layer",
      "description": "Set up Redis cache",
      "dependencies": ["abc-123"],
      "priority": "high",
      "estimate": "M"
    }
  ],
  "updateEdges": [
    { "action": "add", "source": "temp1", "target": "deploy-id", "type": "dependency" }
  ]
}
```
````

All three arrays are optional — include only what's needed. The prompt instructs the AI to emit only one ` ```json ` block per response (to avoid ambiguity with other JSON snippets).

### 4.2 Extraction Strategy

`extractMutations()` in `src/lib/plan-mutations.ts` uses shape-based detection:

1. **Primary** — Find all ` ```json ` fenced blocks. Parse each; if the resulting object has `updateNodes`, `addNodes`, or `updateEdges` arrays, treat it as a mutation block and remove it from the clean content.
2. **Legacy fallback** — If no mutations found via primary strategy, check for older ` ```astro-plan-change `, ` ```astro-updates `, ` ```astro-edges `, ` ```astro-add-nodes ` fences (backward compat with older chat history).

Shape detection is done by `isMutationObject()` which checks for the presence of any of the three known array keys. This avoids requiring models to remember a custom fence tag — standard ` ```json ` with the right fields is sufficient.

### 4.3 Mutation Application

`applyMutationsToStore()` in `src/lib/plan-mutations.ts` applies mutations directly to the Zustand plan store:

```
extractMutations(rawAssistantText)
        │
        ▼
  { cleanContent, mutations: { nodeUpdates, edgeOps, newNodes } }
        │
        ▼
applyMutationsToStore(projectId, mutations)
  │
  ├─ 1. Create new nodes (addNodes)
  │     ├─ Generate real UUIDs
  │     ├─ Map temp IDs → real IDs
  │     ├─ Wire dependency edges
  │     └─ reorganizeProject() for layout
  │
  ├─ 2. Update existing nodes (updateNodes)
  │     ├─ Resolve by nodeId (preferred) or nodeTitle (fuzzy)
  │     ├─ Filter out internal fields
  │     ├─ Auto-generate HTML content from description
  │     └─ Reconcile dependency edges on change
  │
  └─ 3. Apply edge operations (updateEdges)
        ├─ action: "add" → addEdge + update target dependencies
        └─ action: "remove" → removeEdge + update target dependencies
```

**Node resolution**: When `nodeTitle` is used instead of `nodeId`, the code does case-insensitive matching. If `type` is also provided, it narrows candidates. Ambiguous matches (multiple nodes with same title) are skipped with a console warning.

**Internal field protection**: Fields like `id`, `projectId`, `createdAt`, `position`, `executionId`, `branchName`, `prUrl` cannot be overwritten via mutations. They are in the `INTERNAL_FIELDS` set.

### 4.4 Dual Mutation Paths

The chat panel handles two kinds of plan modifications:

```
┌──────────────────┐     ┌──────────────────────┐
│  Server mutations │     │  Client mutations     │
│  (MCP tools)      │     │  (JSON text blocks)   │
├──────────────────┤     ├──────────────────────┤
│  create_task      │     │  ```json with shape:  │
│  update_task      │     │  { updateNodes,       │
│  delete_task      │     │    addNodes,          │
│  create_dependency│     │    updateEdges }      │
├──────────────────┤     ├──────────────────────┤
│  Sets             │     │  onDone callback:     │
│  needsPlanRefresh │     │  extractMutations()   │
│  → store.load()   │     │  applyMutationsToStore│
└──────────────────┘     └──────────────────────┘
```

MCP tools modify the plan server-side (via the agent runner's tool execution), then the frontend refreshes from the API. Text-block mutations are parsed and applied client-side for instant feedback.

### 4.5 Error Handling

| Scenario | Behavior |
|---|---|
| No mutations found, but response contains mutation-like JSON | Warning toast: "Plan changes not applied — try asking again" |
| Node title not found | Console warning, mutation skipped (other mutations still apply) |
| Ambiguous title match | Console warning, mutation skipped |
| JSON parse error in mutation block | Block left in output as-is (not removed from clean content) |

The heuristic detection checks for patterns like `[{"nodeId"` or `[{"action"` in the raw text to determine if the AI intended mutations but used the wrong format.

---

## 5. Replan Pipeline

### 5.1 When Replan Triggers

A replan happens when the user wants to regenerate the plan after some tasks have executed. This is different from refinement (which tweaks the existing plan) — replan generates a completely new plan graph.

### 5.2 Context Assembly

```
startReplanSession(projectId, changeDescription, lessons, previousPlanSummary)
        │
        ▼
Build ReplanContext:
  {
    previousPlanSummary: "Original plan had 8 tasks across 2 milestones..."
    changeDescription: "Scope changed to exclude mobile support"
    lessons: [
      { taskTitle: "Set up API", status: "success",
        executionSummary: "REST API with 5 endpoints",
        followUps: ["Add rate limiting"] },
      { taskTitle: "Build mobile app", status: "not_executed" },
      { taskTitle: "Write tests", status: "failure",
        executionSummary: "3 of 12 tests failing on auth module" },
    ]
  }
```

### 5.3 Prompt Injection

The replan context appears in the interactive plan prompt as:

```markdown
## Previous Plan — Lessons Learned

This is a **replan**. A previous plan was executed and the user wants to iterate.

### Previous Plan Summary
Original plan had 8 tasks across 2 milestones...

### What Changed
Scope changed to exclude mobile support

### Per-Task Lessons
✅ **Set up API** — Create REST API endpoints
  - Summary: REST API with 5 endpoints
  - Follow-ups: Add rate limiting
⏭️ **Build mobile app** — Build React Native app
❌ **Write tests** — Write integration test suite
  - Summary: 3 of 12 tests failing on auth module

### Guidance for Replanning
- Tasks that succeeded can be kept as-is or refined
- Tasks that partially succeeded may need scope adjustment
- Failed tasks should be redesigned with a different approach
- Tasks not executed may still be relevant
```

### 5.4 Archive and Replace

The replan flow:

1. `archiveProjectForReplan()` — Soft-deletes ALL live nodes in the project (sets `deletedAt`)
2. AI generates a completely new plan (same flow as Phase 1)
3. `setProjectPlan()` — Replaces all nodes/edges in the store
4. Old nodes remain in the database with `deletedAt` set (recoverable)

---

## 6. Extraction Code Map

| Extraction Function | Location | Input | Output |
|---|---|---|---|
| `extractPlanJsonFromText()` | `packages/core/src/plan-extraction.ts` | Full streaming text | `{ projectName, nodes[], edges[] }` or `null` |
| `extractMutations()` | `src/lib/plan-mutations.ts` | Assistant message text | `{ cleanContent, mutations: AppliedMutations }` |
| `applyPlanFromText()` | `src/stores/execution-store.ts` | projectId + text | Applies to plan store |
| `applyMutationsToStore()` | `src/lib/plan-mutations.ts` | projectId + mutations | `{ affectedNodeIds, resolvedMutations }` |

---

## 7. Key Files Reference

| File | Description |
|---|---|
| `packages/core/src/prompt-templates.ts` | All prompt builders: plan generation, chat, task execution |
| `packages/core/src/plan-extraction.ts` | Plan JSON extraction from streaming text |
| `src/lib/plan-mutations.ts` | Mutation extraction (shape-based + legacy fallback) and store application |
| `src/stores/execution-store.ts` | Plan generation orchestration, SSE processing, plan application |
| `src/stores/plan-store.ts` | Plan graph state: nodes, edges, CRUD, archive, reorganize |
| `src/components/plan-generation/plan-generation.tsx` | Plan generation UI, activity timeline, post-plan chat |
| `src/components/agent/chat-panel.tsx` | Project sidebar chat, mutation extraction on done |
| `server/routes/dispatch.ts` | Dispatch route: builds prompt, starts relay stream |
| `server/routes/agent.ts` | Chat routes: project-chat, task-chat, SSE streaming |
| `packages/core/src/types.ts` | `ReplanContext` interface definition |
