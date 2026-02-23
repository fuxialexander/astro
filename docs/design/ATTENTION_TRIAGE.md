# Attention Triage — Design Document

> **Status: PROPOSED** — Not yet implemented (~5%)

## 1. Overview

When a human manages 5 agents running 30 tasks across 4 machines, the bottleneck is not compute — it is human attention. The system generates a continuous stream of events: tasks complete, agents request approval, errors occur, costs spike, branches diverge. Without triage, the human either monitors everything (exhausting, doesn't scale) or checks periodically (misses critical moments).

Attention triage is the system that answers: **"What should I look at right now?"**

### 1.1 Design Principles

**Exception-based management.** Everything runs autonomously by default. The system only interrupts the human when something requires judgment, deviates from expectations, or exceeds risk thresholds. A quiet dashboard means things are going well.

**Ranked, not listed.** Pending items are not a flat list. They have computed urgency. The most important item is always at the top. The human can trust that addressing items top-to-bottom is optimal.

**Actionable, not informational.** Every attention item has a clear action: approve, reject, investigate, reallocate, or dismiss. Pure status updates go to the activity feed, not the attention queue.

**Time-aware.** Some items become more urgent over time (a blocked agent waiting for approval burns idle compute). Some become less urgent (a completed task can wait for review). Urgency is dynamic.

**Makes you a better manager.** The durable value of attention triage is not just routing interrupts — it's learning from your decision patterns to reduce future interrupts. As models get faster, the human's attention becomes the dominant bottleneck. The system should actively work to reduce its own interrupt rate by identifying decisions that are predictable, tasks that don't need review, and patterns the human may not be aware of.

### 1.2 Current State

Astro has pieces of an attention system but no unified triage:

- **Approval requests** — `execution-store.ts` tracks `pendingApprovals`; `realtime-store.ts` handles `dynamicApprovals` from MCP tool
- **Dashboard** — shows count of `awaiting_judgment` / `awaiting_approval` nodes
- **Toast notifications** — `toast-store.ts` fires transient toasts (no persistence, no ranking)
- **Push notifications** — `push-notifications.ts` sends APNs for `taskCompleted`, `taskFailed`, `machineDisconnected`, `branchUnblocked`
- **Activity feed** — `realtime-store.ts` keeps last 50 events in memory

**Gaps**: No urgency scoring, no ranking, no "smart inbox" concept, no escalation, no grouping, no attention analytics, no context enrichment on attention items.

---

## 2. Attention Item Model

### 2.1 Core Type

Every event that may require human attention produces an `AttentionItem`:

```typescript
interface AttentionItem {
  id: string
  type: AttentionItemType
  urgency: UrgencyLevel
  urgencyScore: number           // 0-100, computed, determines sort order

  // What happened
  title: string                  // e.g., "Agent requesting approval"
  summary: string                // e.g., "Delete database migration file?"
  detail?: string                // full context, loaded on demand

  // Where it happened
  projectId: string
  projectName: string
  nodeId?: string
  nodeTitle?: string
  executionId?: string
  machineId?: string
  machineName?: string

  // Time pressure
  createdAt: Date
  expiresAt?: Date               // hard deadline (e.g., approval timeout)
  staleSince?: Date              // when this started blocking other work
  estimatedBlockedCostUsd?: number  // $ being wasted while this waits

  // Actions
  actions: AttentionAction[]     // what the human can do
  resolvedAt?: Date
  resolvedAction?: string        // which action was taken
  dismissedAt?: Date

  // Grouping
  groupKey?: string              // for batching related items
  relatedItemIds?: string[]
}

type AttentionItemType =
  | 'approval_request'           // agent needs a decision to continue
  | 'task_failed'                // task failed, needs investigation or retry
  | 'task_awaiting_judgment'     // task completed, needs human quality review
  | 'cost_anomaly'               // unexpected spend pattern
  | 'budget_threshold'           // approaching or exceeding budget
  | 'agent_stuck'                // agent appears to be looping
  | 'conflict_detected'          // two agents modifying overlapping files
  | 'machine_disconnected'       // execution environment lost
  | 'branch_decision'            // exploration branches ready for compare/prune
  | 'milestone_reached'          // milestone complete, strategic checkpoint
  | 'dependency_blocked'         // many tasks blocked on one, consider prioritizing

type UrgencyLevel = 'critical' | 'high' | 'medium' | 'low' | 'info'

interface AttentionAction {
  id: string
  label: string                  // "Approve", "Reject", "Retry", "Investigate"
  style: 'primary' | 'secondary' | 'destructive'
  handler: string                // route to API endpoint
  payload?: Record<string, unknown>
  requiresConfirmation?: boolean
}
```

### 2.2 Attention Item Types

| Type | Source | Why It Needs Attention | Typical Actions |
|------|--------|----------------------|-----------------|
| `approval_request` | Agent calls `AskUserQuestion` tool | Agent is blocked, waiting, burning idle cost | Approve, Reject, Provide answer |
| `task_failed` | Execution returns error | May need retry, different approach, or human fix | Retry, Retry (different model), Investigate, Skip |
| `task_awaiting_judgment` | Task with `verification: 'human'` completes | Human must assess quality before marking done | Approve, Reject (with feedback), Rerun |
| `cost_anomaly` | Cost tracking detects spike | Agent may be stuck in loop, context may be exploding | Investigate, Cancel task, Set budget limit |
| `budget_threshold` | Spend crosses alert threshold | May need to pause, downgrade, or reallocate budget | Acknowledge, Pause project, Increase budget |
| `agent_stuck` | Loop detector triggers | Agent retrying same failing approach | Cancel, Steer (provide guidance), Retry (different approach) |
| `conflict_detected` | Two executions touch same files | Merge conflict likely, one should be paused | Pause one, Rebase, Investigate |
| `machine_disconnected` | Heartbeat timeout | Running tasks may be orphaned | Reconnect, Cancel tasks, Reassign to other machine |
| `branch_decision` | Multiple exploration branches complete | Time to compare results and choose direction | Compare, Prune losers, Invest in winner |
| `milestone_reached` | All tasks in milestone completed | Strategic checkpoint — review and plan next phase | Review, Approve milestone, Adjust plan |
| `dependency_blocked` | One node blocks 3+ downstream nodes | Critical path bottleneck, may need prioritization | Prioritize, Assign more resources, Unblock manually |

---

## 3. Urgency Scoring

### 3.1 Score Computation

Each attention item gets a `urgencyScore` (0-100) computed from weighted factors:

```typescript
function computeUrgencyScore(item: AttentionItem): number {
  let score = baseScore(item.type)

  // Time decay: items get more urgent the longer they wait
  score += timePressure(item)

  // Blocked cost: items blocking expensive work are more urgent
  score += blockedCostPressure(item)

  // Cascade impact: items blocking many downstream tasks are more urgent
  score += cascadeImpact(item)

  // Deadline proximity: items near expiration are more urgent
  score += deadlinePressure(item)

  return Math.min(100, Math.max(0, score))
}
```

### 3.2 Base Scores

Starting urgency by item type:

| Type | Base Score | Rationale |
|------|-----------|-----------|
| `approval_request` | 70 | Agent is literally waiting, burning time |
| `machine_disconnected` | 65 | Tasks may be orphaned |
| `agent_stuck` | 60 | Actively burning tokens on nothing |
| `cost_anomaly` | 55 | Money being wasted now |
| `conflict_detected` | 50 | Will cause problems if not addressed |
| `task_failed` | 45 | May block downstream work |
| `budget_threshold` | 40 | Awareness needed, not immediately blocking |
| `dependency_blocked` | 35 | Strategic, not emergency |
| `task_awaiting_judgment` | 30 | Can wait, nothing is burning |
| `branch_decision` | 25 | Strategic, plan-level |
| `milestone_reached` | 20 | Checkpoint, no urgency |

### 3.3 Pressure Modifiers

**Time pressure**: +1 point per minute waiting, capped at +20.

```typescript
function timePressure(item: AttentionItem): number {
  const minutesWaiting = (Date.now() - item.createdAt.getTime()) / 60_000
  return Math.min(20, minutesWaiting)
}
```

**Blocked cost pressure**: If an agent is idle waiting for approval, estimate the cost of wasted compute. +5 per $1 of estimated blocked cost per hour.

```typescript
function blockedCostPressure(item: AttentionItem): number {
  if (!item.estimatedBlockedCostUsd) return 0
  return Math.min(15, item.estimatedBlockedCostUsd * 5)
}
```

**Cascade impact**: How many tasks are transitively blocked by this item?

```typescript
function cascadeImpact(item: AttentionItem): number {
  // Computed from plan graph: count downstream unblocked-if-resolved nodes
  const blockedCount = countTransitivelyBlockedNodes(item.nodeId)
  return Math.min(15, blockedCount * 3)  // +3 per blocked task, cap 15
}
```

**Deadline pressure**: If the item has an `expiresAt`, urgency ramps up as deadline approaches.

```typescript
function deadlinePressure(item: AttentionItem): number {
  if (!item.expiresAt) return 0
  const remainingMs = item.expiresAt.getTime() - Date.now()
  if (remainingMs <= 0) return 20  // expired
  if (remainingMs < 60_000) return 15  // < 1 min
  if (remainingMs < 300_000) return 10  // < 5 min
  return 0
}
```

### 3.4 Urgency Level Mapping

| Score Range | Level | UI Treatment |
|-------------|-------|-------------|
| 80-100 | `critical` | Red badge, sound notification, push notification |
| 60-79 | `high` | Orange badge, push notification |
| 40-59 | `medium` | Yellow badge |
| 20-39 | `low` | Gray badge |
| 0-19 | `info` | No badge, visible in expanded view |

---

## 4. Attention Sources

### 4.1 Event-Driven Sources (Real-Time)

These produce attention items immediately when events occur:

```
AstroEventTransport
    │
    ├── task.completed + verification='human' ──► task_awaiting_judgment
    ├── task.failed ────────────────────────────► task_failed
    ├── task.cancelled (unexpected) ────────────► investigate
    ├── approval.requested ─────────────────────► approval_request
    ├── branch.pruned (auto) ───────────────────► info only
    ├── merge_queue.failed ─────────────────────► task_failed variant
    │
    ▼
SSE (realtime-store)
    │
    ├── machine:disconnected ───────────────────► machine_disconnected
    ├── task:approval_request ──────────────────► approval_request
    └── cost:anomaly ──────────────────────────► cost_anomaly
```

### 4.2 Computed Sources (Periodic Analysis)

These require analyzing state periodically (every 30-60 seconds):

| Source | Detection Method | Produces |
|--------|-----------------|----------|
| **Agent stuck** | Same tool called 3+ times with same error in last 5 turns | `agent_stuck` |
| **Cost anomaly** | Turn cost > 3× rolling average for this task type | `cost_anomaly` |
| **Dependency bottleneck** | Node with 3+ blocked downstream tasks and status != `in_progress` | `dependency_blocked` |
| **Branch decision** | All leaf nodes in an exploration branch are complete | `branch_decision` |
| **Milestone reached** | All tasks in milestone are `completed` or `auto_verified` | `milestone_reached` |
| **Conflict detection** | Two running executions report `file_change` on same path | `conflict_detected` |

### 4.3 Detector Architecture

```typescript
interface AttentionDetector {
  id: string
  name: string
  /** How often to run (ms). 0 = event-driven only. */
  interval: number
  /** Check current state and produce attention items */
  detect(context: DetectorContext): AttentionItem[]
}

interface DetectorContext {
  // Current state snapshots
  runningExecutions: TaskExecution[]
  planNodes: Map<string, PlanNode>
  planEdges: PlanEdge[]
  costRecords: CostRecord[]      // recent window
  machines: MachineStatus[]

  // Helpers
  getDownstreamNodes(nodeId: string): PlanNode[]
  getRecentTurns(executionId: string, count: number): TurnData[]
}
```

Detectors are registered in a `DetectorRegistry` and run on their configured intervals. Event-driven detectors subscribe to the event transport.

---

## 5. Attention Queue

### 5.1 Store

```typescript
interface AttentionState {
  items: AttentionItem[]                    // sorted by urgencyScore desc
  resolvedItems: AttentionItem[]            // recently resolved, for undo
  activeDetectors: string[]                 // which detectors are running

  // Computed
  criticalCount: number
  highCount: number
  totalUnresolved: number

  // Actions
  addItem: (item: AttentionItem) => void
  resolveItem: (itemId: string, action: string) => void
  dismissItem: (itemId: string) => void
  undoResolve: (itemId: string) => void
  refreshScores: () => void                 // recompute all urgency scores
  batchResolve: (itemIds: string[], action: string) => void
}
```

### 5.2 Score Refresh

Urgency scores are **dynamic** — they change over time even without new events (because time pressure and blocked cost accumulate). The store refreshes scores:

- Every 30 seconds (background timer)
- On any new item added
- On any item resolved (cascade: resolving one item may change others' scores)

### 5.3 Grouping and Batching

Related items can be grouped for batch action:

```typescript
// Group key examples:
// "project:{projectId}:failed"     — all failed tasks in a project
// "execution:{executionId}"        — all items from one execution
// "machine:{machineId}:disconnected" — all items from a disconnected machine
// "approval:{executionId}"         — approval + related context

interface AttentionGroup {
  groupKey: string
  items: AttentionItem[]
  batchActions: AttentionAction[]   // actions that can be applied to all items
  title: string                     // e.g., "3 failed tasks in API Rewrite"
}
```

Example batch: 3 tasks failed because a machine disconnected. Instead of showing 3 separate items, show one group: "3 tasks failed (machine gpu-vm-1 disconnected)" with actions: "Retry all on different machine", "Wait for reconnection", "Cancel all."

---

## 6. Frontend Components

### 6.1 Attention Inbox (replaces dashboard "Needs Attention")

The primary UI for attention triage. Always accessible from the sidebar.

```
┌─ Attention ─── 3 critical · 5 high ──────────────────┐
│                                                       │
│  🔴 Agent waiting for approval (2 min ago)           │
│     Task: "Delete old migration files?"               │
│     Project: API Rewrite → Cleanup Phase              │
│     Blocking: 2 downstream tasks ($4.20/hr idle)      │
│     [Approve] [Reject] [View Context]                 │
│                                                       │
│  🔴 Cost spike detected                              │
│     Task: Implement caching layer ($18.40, 8× avg)    │
│     Project: API Rewrite                              │
│     Turn 12: context grew to 180K tokens              │
│     [Investigate] [Cancel] [Set Budget]               │
│                                                       │
│  🔴 Machine disconnected                             │
│     gpu-vm-1 (last seen 3 min ago)                    │
│     2 running tasks affected                          │
│     [Retry on other machine] [Wait] [Cancel tasks]    │
│                                                       │
│  🟠 3 tasks awaiting review                          │
│     Project: ML Pipeline → Data Prep                  │
│     Completed 15 min ago                              │
│     [Review All] [Auto-approve] [Dismiss]             │
│                                                       │
│  🟠 Branch decision ready                            │
│     "Caching approach" — 2 branches completed         │
│     Redis: 40ms, $3.20 │ In-memory: 15ms, $5.80      │
│     [Compare] [Pick Redis] [Pick In-memory]           │
│                                                       │
│  🟡 Milestone reached: "Phase 1 Complete"             │
│     12/12 tasks done. $45.20 total.                   │
│     [Review Phase 1] [Start Phase 2] [Adjust Plan]    │
│                                                       │
│  ── resolved today ──────────────────────────────     │
│  ✓ Approved: PR creation for auth module (10m ago)    │
│  ✓ Retried: Failed lint check (25m ago)               │
│  ✓ Dismissed: Low-priority task review (1h ago)       │
└───────────────────────────────────────────────────────┘
```

### 6.2 Attention Badge (sidebar)

The sidebar nav item shows a badge with the count of critical+high items:

```
  Dashboard
  Projects
  My Tasks
  Attention  🔴 3
  Environments
```

When there are critical items, the badge pulses. Clicking navigates to the attention inbox.

### 6.3 Inline Attention Indicators

Attention items also appear contextually where they're relevant:

- **Plan graph**: Nodes with attention items show a colored ring
- **Task detail**: Failed/stuck tasks show the attention item's actions directly
- **Project overview**: Attention count per milestone in the progress section

### 6.4 Quick Actions Toast

For critical items, a persistent (non-auto-dismissing) toast appears at the top of any page:

```
┌──────────────────────────────────────────────────────┐
│ 🔴 Agent needs decision: "Delete migration files?"    │
│    [Approve] [Reject] [View]            ── 2:34 ago  │
└──────────────────────────────────────────────────────┘
```

This ensures the human sees critical items even if they're not looking at the attention inbox.

---

## 7. Backend Architecture

### 7.1 Attention Service

New module: `server/lib/attention/`

```
server/lib/attention/
├── attention-service.ts         # Core service: manage items, compute scores
├── attention-store.ts           # In-memory store + DB persistence
├── detectors/
│   ├── types.ts                 # AttentionDetector interface
│   ├── registry.ts              # Detector registration and scheduling
│   ├── approval-detector.ts     # Event-driven: approval requests
│   ├── failure-detector.ts      # Event-driven: task failures
│   ├── judgment-detector.ts     # Event-driven: awaiting judgment
│   ├── cost-detector.ts         # Periodic: cost anomalies
│   ├── stuck-detector.ts        # Periodic: agent loop detection
│   ├── conflict-detector.ts     # Periodic: file conflict detection
│   ├── bottleneck-detector.ts   # Periodic: dependency bottlenecks
│   ├── milestone-detector.ts    # Event-driven: milestone completion
│   └── machine-detector.ts      # Event-driven: machine disconnection
├── scoring.ts                   # Urgency score computation
└── grouping.ts                  # Attention item grouping logic
```

### 7.2 Integration Points

```
                    AstroEventTransport
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        Event-driven   Existing     Cost Tracking
        Detectors      Hooks        Hook
              │                        │
              ▼                        ▼
        AttentionService ◄──── Cost Anomaly
              │                 Detector
              │
              ├── Compute urgency scores
              ├── Group related items
              ├── Persist to DB
              │
              ▼
        SSE: attention_update
              │
              ▼
        Frontend attention-store
              │
              ├── Update inbox
              ├── Show badge
              └── Show critical toast
```

### 7.3 Periodic Detector Runner

```typescript
class DetectorRunner {
  private detectors: Map<string, AttentionDetector> = new Map()
  private intervals: Map<string, NodeJS.Timeout> = new Map()

  register(detector: AttentionDetector) {
    this.detectors.set(detector.id, detector)
    if (detector.interval > 0) {
      this.intervals.set(
        detector.id,
        setInterval(() => this.runDetector(detector), detector.interval)
      )
    }
  }

  private async runDetector(detector: AttentionDetector) {
    const context = await this.buildContext()
    const items = detector.detect(context)
    for (const item of items) {
      this.attentionService.addOrUpdate(item)
    }
  }
}
```

---

## 8. Database Schema

```sql
-- Attention items (persisted for history and analytics)
CREATE TABLE attention_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  type TEXT NOT NULL,
  urgency_level TEXT NOT NULL,
  urgency_score INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  project_id UUID,
  node_id TEXT,
  execution_id TEXT,
  machine_id TEXT,
  group_key TEXT,
  expires_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_action TEXT,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attention_unresolved ON attention_items(user_id)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX idx_attention_project ON attention_items(project_id, created_at);
CREATE INDEX idx_attention_type ON attention_items(type, created_at);

-- Attention analytics (response time, patterns)
CREATE TABLE attention_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  item_id UUID NOT NULL REFERENCES attention_items(id),
  type TEXT NOT NULL,
  urgency_score_at_resolution INTEGER,
  time_to_resolve_ms BIGINT,     -- how long the human took to respond
  action_taken TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 9. SSE Events

| Event | Data | Purpose |
|-------|------|---------|
| `attention_new` | `AttentionItem` | New item added to queue |
| `attention_updated` | `{ id, urgencyScore, urgencyLevel }` | Score recalculated |
| `attention_resolved` | `{ id, action, resolvedAt }` | Item resolved |
| `attention_expired` | `{ id }` | Item past deadline, auto-resolved with default |
| `attention_group` | `AttentionGroup` | Items grouped for batch action |

---

## 10. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/attention` | List unresolved attention items (sorted by urgency) |
| GET | `/api/attention/:id` | Get item with full detail and context |
| POST | `/api/attention/:id/resolve` | Resolve with action |
| POST | `/api/attention/:id/dismiss` | Dismiss (acknowledged, no action) |
| POST | `/api/attention/:id/snooze` | Snooze for N minutes |
| POST | `/api/attention/batch` | Batch resolve multiple items |
| GET | `/api/attention/analytics` | Response time stats, common patterns |

---

## 11. Attention Analytics — Making You a Better Manager

The analytics layer is the most durable part of the attention system. Models will get faster and cheaper, but the human's decision patterns, organizational habits, and workflow bottlenecks persist. This section describes insights that survive model changes.

### 11.1 Decision Pattern Analysis

Track what the human does with attention items to identify automatable patterns:

```
┌─ Your Decision Patterns (last 30 days) ──────────────┐
│                                                       │
│  Predictable decisions (automatable):                 │
│                                                       │
│  ✓ Approval requests: 89% approved                   │
│    By area:                                           │
│    • src/components/ — 97% approve (34/35)           │
│    • server/routes/ — 91% approve (21/23)            │
│    • server/lib/auth/ — 61% approve (14/23)  ← NOT  │
│    → Auto-approve src/components/ + server/routes/?  │
│    → Saves ~53 min/week of approval wait time        │
│                                                       │
│  ✓ First failures: 72% retried immediately           │
│    Exception: budget_exceeded failures (0% retry)     │
│    → Auto-retry on test_failure? (saves ~18 min/wk)  │
│                                                       │
│  Requires genuine judgment:                           │
│  ✗ Branch selection decisions (no clear pattern)      │
│  ✗ Auth module PRs (39% rejection rate)               │
│  ✗ Architecture-level changes (varied responses)      │
│                                                       │
│  Trend: Your predictable decision rate increased      │
│  from 71% → 89% as the project matured               │
│  → More automation possible as project stabilizes     │
└───────────────────────────────────────────────────────┘
```

### 11.2 Human Bottleneck Analysis

Where is the human the slowest part of the pipeline?

```
┌─ Attention Bottleneck Report ────────────────────────┐
│                                                       │
│  Response Time (median):                              │
│  Critical: 45s    High: 8min    Medium: 2hr           │
│                                                       │
│  Time of day pattern:                                 │
│  9am-12pm:  avg 2 min response  (you're attentive)    │
│  12pm-2pm:  avg 45 min response (lunch)               │
│  2pm-6pm:   avg 8 min response  (you're busy)         │
│  6pm-9am:   avg 4.2 hr response (off-hours)           │
│                                                       │
│  Agents blocked waiting for you: avg 1.2 hours/day    │
│  Cost of human latency: ~$3.40/day (idle compute)     │
│                                                       │
│  Biggest bottleneck: judgment reviews                 │
│  65% of total wait time is human review               │
│  → 3 tasks always approved — switch to auto-verify    │
│  → Saves 43 min/week of human time + agent wait       │
│                                                       │
│  Weekly attention load:                               │
│  Mon ████████████ 24 items                            │
│  Tue ██████████████████ 36 items                      │
│  Wed ██████████ 20 items                              │
│  Thu ████████████████ 32 items                        │
│  Fri ████████ 16 items                                │
└───────────────────────────────────────────────────────┘
```

### 11.3 Task Specification Feedback

Connect attention patterns back to task quality — poor task specs generate more attention items:

```
┌─ Spec Quality → Attention Load ──────────────────────┐
│                                                       │
│  Tasks with good specs (acceptance criteria + paths): │
│  avg 0.3 attention items per task                     │
│                                                       │
│  Tasks with poor specs (< 50 words, vague):           │
│  avg 2.1 attention items per task  (7× more)          │
│                                                       │
│  Most common attention from poor specs:               │
│  1. task_failed (agent misunderstood intent)           │
│  2. approval_request (agent unsure, asked for help)    │
│  3. task_awaiting_judgment (output doesn't match      │
│     unstated expectations)                             │
│                                                       │
│  Insight: Writing 2 extra sentences per task          │
│  would eliminate ~40% of your daily attention load    │
└───────────────────────────────────────────────────────┘
```

### 11.4 Organizational Learning

As the system accumulates data across projects, it identifies organizational patterns:

```typescript
interface OrganizationalInsight {
  // Cross-project patterns
  averageAttentionItemsPerProject: number
  attentionLoadTrend: 'increasing' | 'stable' | 'decreasing'

  // What's improving over time
  autoApprovalRate: number         // % of decisions now automated
  averageResponseTime: number      // trending down = human getting faster
  falsePositiveRate: number        // % of items dismissed without action

  // Detector health
  detectorAccuracy: Record<string, {
    truePositives: number          // items that led to action
    falsePositives: number         // items dismissed
    accuracy: number
    suggestion?: string            // e.g., "stuck_detector fires too often, raise threshold"
  }>
}
```

The analytics serve three durable purposes:
1. **Help the human** — see where their time goes, identify automation opportunities, write better task specs
2. **Reduce interrupt rate** — suggest auto-approval, auto-retry, and auto-verification to lower the attention load over time
3. **Self-tune the system** — if a detector produces too many false positives (high dismiss rate), suggest threshold adjustments; if response times are consistently fast for a category, suggest reducing its urgency score

---

## 12. Integration with Cost Tracking

The attention system and cost tracking system are tightly coupled:

| Cost Event | Attention Behavior |
|-----------|-------------------|
| Turn cost > 3× average | Create `cost_anomaly` item with "Investigate" and "Cancel" actions |
| Budget at 80% | Create `budget_threshold` item with "Acknowledge" and "Increase" actions |
| Budget exceeded + policy=pause | Create `budget_threshold` (critical) + auto-pause new dispatches |
| Agent idle waiting for approval | `approval_request` item includes `estimatedBlockedCostUsd` (compute wasted per hour while waiting) |
| Failed task with high cost | `task_failed` item shows cost wasted, suggests whether retry is worth it |

---

## 13. Implementation Phases

### Phase 1: Unified Attention Inbox
- Define `AttentionItem` type and `attention-store.ts` (frontend)
- Convert existing approval requests and `awaiting_judgment` nodes into attention items
- Build attention inbox page (replaces "Needs Attention" dashboard widget)
- Add sidebar badge

### Phase 2: Urgency Scoring
- Implement scoring engine (`scoring.ts`)
- Add time pressure (dynamic recalculation)
- Add cascade impact (query plan graph for downstream blocked count)
- Sort inbox by urgency score

### Phase 3: Event-Driven Detectors
- Build detector framework (`detectors/registry.ts`)
- Implement detectors: approval, failure, judgment, machine disconnection, milestone
- Wire to `AstroEventTransport`
- SSE events for real-time attention updates

### Phase 4: Periodic Detectors
- Implement: stuck agent, cost anomaly, conflict detection, dependency bottleneck
- Build `DetectorRunner` with configurable intervals
- Add context builder for detector state snapshots

### Phase 5: Grouping, Batching, and Analytics
- Group related items (e.g., all failures from a disconnected machine)
- Batch resolve actions
- Attention metrics table
- Analytics dashboard with automation suggestions

### Phase 6: Smart Automation
- Auto-approve patterns (based on historical data)
- Auto-retry on first failure (configurable per project)
- Auto-escalation (if critical item unresolved for N minutes, push notification + email)
- Suggested detector tuning (reduce false positives based on dismiss rate)
