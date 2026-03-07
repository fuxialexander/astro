# Project-Level Knowledge Sharing

> **Last updated:** 2026-03-06
> **Status:** Active — describes the current knowledge propagation system including project knowledge store.

How context and learned facts flow between tasks in Astro's agent loop: dependency outputs, vision documents, project knowledge, and the gaps that remain.

Related: [AGENTIC_WORKFLOW.md](AGENTIC_WORKFLOW.md) (task execution pipeline), [PLAN_AND_REPLAN.md](PLAN_AND_REPLAN.md) (plan generation and mutation).

---

## 1. Overview

Each task in Astro's DAG runs as an independent agent session. The agent receives a prompt assembled from multiple context sources. Knowledge flows through three mechanisms:

1. **Vision document** — Global project context, injected into every task
2. **Dependency outputs** — Direct DAG parent outputs, injected into dependent tasks
3. **Project knowledge store** — Cross-task learned facts, available to ALL downstream tasks regardless of graph position

```
┌─────────────────────────────────────────────────────────────────┐
│                    Execution Prompt                              │
├─────────────────────────────────────────────────────────────────┤
│  System instructions                                            │
│  ─────────────────────────────────────────────────────────────  │
│  Vision document  (global, every task)            ~4.5K tokens  │
│  ─────────────────────────────────────────────────────────────  │
│  Agent skills  (backend-scoped)                                 │
│  ─────────────────────────────────────────────────────────────  │
│  Project knowledge  (all completed tasks)         ≤16K chars    │
│  ─────────────────────────────────────────────────────────────  │
│  Graph position context  (depth, siblings, branch)              │
│  ─────────────────────────────────────────────────────────────  │
│  Dependency outputs  (direct DAG parents only)    ≤20K per dep  │
│  ─────────────────────────────────────────────────────────────  │
│  Current task  (title, description, criteria)                   │
│  ─────────────────────────────────────────────────────────────  │
│  Execution instructions + executive summary format              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Context Sources

### 2.1 Vision Document

| Aspect | Details |
|---|---|
| Scope | Every task in the project |
| Source | `projects.visionDoc` field |
| Injection | Top of execution prompt, wrapped in `<user_vision>` delimiters |
| Mutable | User can edit at any time; next dispatched task gets the updated version |
| Purpose | Strategic alignment — product goals, research questions, constraints |

The vision document is the primary mechanism for ensuring all agents work toward the same goal. It's read-only to agents (no agent can modify it).

### 2.2 Dependency Outputs

| Aspect | Details |
|---|---|
| Scope | Direct DAG parents only (not transitive) |
| Source | `plan_nodes.executionOutput` field (stored after task completion) |
| Truncation | 20,000 bytes per dependency output |
| Injection | `## Previous Task Outputs` section with per-dependency subsections |
| Availability | Only from `completed` or `auto_verified` dependencies |

When task B depends on task A via a DAG edge, B's prompt includes A's execution output. This is the primary mechanism for sequential information propagation.

```
Task A (completed)                Task B (dispatched)
  │                                 │
  ├─ executionOutput: "..."  ──────▶├─ dependencyOutputs: [
  │                                 │     { title: "Task A",
  │                                 │       output: "...",
  │                                 │       status: "completed" }
  │                                 │   ]
```

Each dependency output includes metadata: `nodeId`, `title`, `output`, `truncated` flag, `status`, and optionally `prUrl`, `prNumber`, `branchName`.

### 2.3 Project Knowledge Store

| Aspect | Details |
|---|---|
| Scope | All tasks in the project (regardless of graph position) |
| Source | Auto-extracted from task summaries on completion |
| Storage | `project_knowledge` table, keyed by `(projectId, key)` |
| Budget | 16,000 chars total, sorted by recency (most recent first) |
| Entry limit | 2,000 chars per entry |
| Injection | `## Project Knowledge` section with per-entry subsections |

This is the cross-task bridge that closes the gap between dependency outputs (direct parents only) and the need for broader project awareness.

### 2.4 Graph Position Context

Each task receives metadata about its position in the DAG:

| Field | Description |
|---|---|
| `depth` | Longest path from root (0 = root node) |
| `upstreamCount` | Total ancestor count |
| `downstreamCount` | Total descendant count |
| `isOnBranch` | Whether the task is on a parallel branch |
| `branchId` | Branch identifier (if applicable) |
| `parallelSiblings` | Count of tasks with the same parent set |

This helps the agent understand its position in the project and calibrate behavior (e.g., a leaf task at depth 0 is exploratory; a task at depth 3 with 5 upstream ancestors should build on prior work).

---

## 3. Knowledge Auto-Extraction Pipeline

When a task completes, its summary is automatically decomposed into project knowledge entries.

```
Task completes with summary
        │
        ▼
extractKnowledgeFromSummary()          ← server/routes/dispatch.ts
  │
  ├─ Slugify title: "Set up database schema"
  │                → "set_up_database_schema"
  │
  ├─ Extract up to 3 entries:
  │   ┌─ findings_{slug}  ← from summary.keyFindings (bullet list)
  │   ├─ summary_{slug}   ← from summary.executiveSummary
  │   └─ work_{slug}      ← from summary.workCompleted (fallback)
  │
  └─ Upsert into project_knowledge
     ON CONFLICT (projectId, key) DO UPDATE
```

### Entry Types

| Key Pattern | Source Field | When Created |
|---|---|---|
| `findings_{slug}` | `summary.keyFindings[]` | Always (if keyFindings non-empty) |
| `summary_{slug}` | `summary.executiveSummary` | Always (if present) |
| `work_{slug}` | `summary.workCompleted` | Only if no findings or summary |

### Deterministic Keys

Keys are derived from task titles via `slugifyTitle()`. This means:
- Re-executing a task updates the same knowledge entries (upsert, not duplicate)
- Knowledge entries are human-readable and predictable
- Example: "Implement JWT Auth" → `findings_implement_jwt_auth`

### Retrieval for Downstream Tasks

When dispatching a new task:
1. Query all `project_knowledge` rows for the project
2. Sort by `updatedAt` DESC (most recent first)
3. Cap at 16,000 chars total (always include at least 1 entry even if it exceeds the budget)
4. Inject as `## Project Knowledge` with per-entry subsections including source attribution

```markdown
## Project Knowledge

### findings_implement_jwt_auth (from: "Implement JWT Auth")
- JWT tokens expire after 24h
- Refresh tokens stored in httpOnly cookies
- Auth middleware validates on every request

### summary_setup_database (from: "Set up Database Schema")
PostgreSQL with Drizzle ORM. 5 tables: users, projects, tasks, sessions, events.
Foreign keys enforce referential integrity. Migrations in supabase/migrations/.
```

---

## 4. What Flows Where

```
                    ┌─────────────────┐
                    │  Vision Document │
                    │  (every task)    │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
     ┌──────▼──────┐  ┌─────▼──────┐  ┌──────▼──────┐
     │  Task A      │  │  Task B     │  │  Task C     │
     │  (depth 0)   │  │  (depth 0)  │  │  (depth 1)  │
     │              │  │             │  │  deps: [A]   │
     └──────┬───────┘  └──────┬──────┘  └──────┬──────┘
            │                 │                │
            │  executionOutput│                │
            │  + knowledge    │  knowledge     │  A's output
            │  extraction     │  extraction    │  + all knowledge
            ▼                 ▼                ▼
     ┌──────────────────────────────────────────────┐
     │          project_knowledge table              │
     │  findings_task_a, summary_task_a,             │
     │  findings_task_b, summary_task_b              │
     │                                               │
     │  → Available to ALL downstream tasks          │
     └──────────────────────────────────────────────┘
```

### Source-Scope Matrix

| Source | Scope | Mechanism | Budget |
|---|---|---|---|
| Vision document | All tasks | `visionDoc` in every prompt | ~4.5K tokens |
| Dependency output | Direct DAG parents only | `dependencyOutputs` in prompt | 20K chars per dep |
| Project knowledge | All tasks in project | `knowledgeEntries` in prompt | 16K chars total |
| Repository state | All tasks on same machine | Git worktree reflects prior commits | N/A |
| Session history | Same task only (steer/chat) | `sessions` table | Full history |

---

## 5. Knowledge Gaps and Mitigations

### 5.1 Current Gaps

| Gap | Description | Impact |
|---|---|---|
| Parallel sibling outputs | Tasks at the same depth with no edges can't see each other's full outputs | Parallel branches can't coordinate without a merge point |
| Cross-milestone aggregation | No milestone-level summary roll-up | After milestone, downstream tasks only see individual task knowledge, not a synthesized view |
| Real-time cross-task context | Running tasks can't see outputs from other running tasks | Parallel tasks may duplicate work |
| Pruned branch outputs | Dependency outputs disappear when a task is pruned | Recovery requires checking project knowledge (which persists) |

### 5.2 How Project Knowledge Mitigates

The project knowledge store closes several of these gaps:

- **Parallel siblings**: Even though Task B can't see Task A's full output, it CAN see `findings_task_a` from the knowledge store
- **Pruned branches**: Knowledge entries from pruned tasks persist (they're not deleted on prune)
- **Cross-milestone**: Knowledge entries from tasks under Milestone 1 are available to tasks under Milestone 2

### 5.3 Remaining Limitations

- **No real-time sharing**: Knowledge is extracted on task completion. Running tasks can't see each other's in-progress findings.
- **No selective injection**: All knowledge entries are injected (up to budget). There's no relevance filtering — a task about frontend styling receives backend database findings too.
- **Entry count growth**: As projects grow, older entries may be pushed out by the 16K budget. Only recency-sorted, not relevance-sorted.
- **Summary quality depends on agent**: If the agent produces a poor executive summary, the extracted knowledge will be low-value.

---

## 6. Token Budget

### Estimates

| Component | Approximate Size |
|---|---|
| System instructions | ~1K tokens |
| Vision document | ~4.5K tokens |
| Agent skills | ~1-3K tokens |
| Project knowledge (16K chars) | ~4K tokens |
| Graph position context | ~200 tokens |
| Per-dependency output (20K chars) | ~5K tokens each |
| Task description + criteria | ~0.5-2K tokens |
| **Total (N dependencies)** | **~13K + 5K x N** |

With Claude's 200K context window, a task with 5 dependencies uses ~38K tokens for the initial prompt, leaving ~162K for the agent's multi-turn conversation.

### Budget Controls

| Parameter | Default | Location |
|---|---|---|
| `maxDependencyOutputSize` | 20,000 bytes | `packages/core/src/dispatch/context-assembler.ts` |
| `maxKnowledgeSize` | 16,000 bytes | `packages/core/src/dispatch/context-assembler.ts` |
| Per-knowledge-entry max | 2,000 chars | `server/routes/dispatch.ts` |
| Knowledge entry count | Unlimited (budget-capped) | Sorted by recency, at least 1 included |

---

## 7. Frontend Knowledge UI

Users can view, edit, and manage project knowledge entries:

| Component | Location | Purpose |
|---|---|---|
| Knowledge panel | `src/components/knowledge-panel.tsx` | View/edit/delete entries |
| Knowledge store | `src/stores/knowledge-store.ts` | Zustand state management |
| API endpoints | `server/routes/data.ts` | CRUD: GET/POST/DELETE `/api/data/knowledge` |

Users can manually add knowledge entries (e.g., domain expertise, configuration notes) that will be injected alongside auto-extracted entries. Manual entries follow the same budget rules.

---

## 8. Data Model

### project_knowledge Table

```sql
CREATE TABLE project_knowledge (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id),
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  source_node_id    TEXT,
  source_task_title TEXT,
  milestone_id      TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, key)
);
```

### Drizzle Schema

```typescript
// packages/core/src/db/schema.ts
export const projectKnowledge = pgTable('project_knowledge', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  key: text('key').notNull(),
  value: text('value').notNull(),
  sourceNodeId: text('source_node_id'),
  sourceTaskTitle: text('source_task_title'),
  milestoneId: text('milestone_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [uniqueIndex('pk_project_key').on(t.projectId, t.key)])
```

---

## 9. Best Practices

1. **Write clear executive summaries** — The agent's summary becomes project knowledge. Encourage structured output (key findings as bullet points, clear status).
2. **Use milestone summary tasks** — For complex milestones with many parallel branches, add a "Summarize milestone" task that depends on all branch outputs and writes a synthesized view.
3. **Manual knowledge for domain expertise** — Add entries for architecture decisions, API credentials locations, coding conventions, or environment quirks that every task should know.
4. **Vision doc for strategic context** — Keep the vision document focused on "why" and "what", not "how". The knowledge store handles "what we've learned".

---

## 10. Key Files Reference

| File | Description |
|---|---|
| `packages/core/src/dispatch/context-assembler.ts` | Assembles full execution context: vision, deps, knowledge, graph position |
| `packages/core/src/dispatch/types.ts` | `AssembledContext`, `DependencyOutput`, `KnowledgeEntry` types |
| `packages/core/src/prompt-templates.ts` | `buildTaskExecutionPrompt()` — injects all context into prompt |
| `packages/core/src/db/schema.ts` | `projectKnowledge` table schema |
| `server/routes/dispatch.ts` | Knowledge extraction on task completion, knowledge fetching on dispatch |
| `src/stores/knowledge-store.ts` | Frontend Zustand store for knowledge entries |
| `src/components/knowledge-panel.tsx` | UI for viewing/editing knowledge entries |
| `server/routes/data.ts` | Knowledge CRUD API endpoints |
