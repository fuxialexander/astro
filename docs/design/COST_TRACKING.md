# Cost Tracking and Resource Management — Design Document

> **Status: PROPOSED** — Partially implemented (~20%, basic usage tracking exists)

## 1. Overview

Astro needs a resource management system that treats AI spending the same way AWS treats compute: as a measurable, budgetable, forecastable resource. As agents run more tasks across more machines, the cost of AI execution becomes a management problem, not just an accounting one.

This document describes three capabilities:
1. **Cost instrumentation** — capture granular cost data per execution turn
2. **Budget system** — set limits, enforce policies, alert on thresholds
3. **Waste detection and optimization** — find where money is being lost and help the human fix it

### 1.1 Design Principle: Track Where Money Is Wasted, Not Just Where It Goes

Model-specific cost predictions ("a sonnet task costs ~$2") reset every model release — new pricing, new efficiency, new token usage patterns. The durable value of cost tracking is in answering questions about the work and the human:

| Fragile (resets with model changes) | Durable (survives model changes) |
|--------------------------------------|----------------------------------|
| "Budget $2 per sonnet task" | "35% of total spend is on failed retries" |
| "Opus costs 4.5× more than sonnet" | "Tasks with under-specified descriptions cost 3.2× more" |
| "Forecast: $285 this month at current rate" | "The auth module consumes 40% of project budget due to retry rate" |
| "Haiku is cheapest per task" | "You spend $12/week on tasks you always auto-approve anyway" |

The system captures per-model cost data (useful for current model selection), but the **insight layer** identifies structural waste patterns that persist regardless of pricing changes.

### 1.2 Current State

Astro already captures basic usage metrics:
- `UsageMetrics` type: `inputTokens`, `outputTokens`, `estimatedCostUsd`, `model`, `turnsUsed`, `durationMs`
- `usage-store.ts`: session-level accumulators (`totalCostUsd`, `totalInputTokens`, etc.)
- `usageMetrics` DB table: one row per user per day
- `usage-metrics-hook.ts`: event hook that aggregates from `task.completed` events

**Gaps**: No per-project breakdown, no per-model tracking, no budgets, no alerts, no forecasting, no turn-level cost attribution, no real-time cost streaming during execution.

---

## 2. Cost Model

### 2.1 Cost Hierarchy

Cost flows through a hierarchy. Every dollar spent is attributable at every level:

```
Organization (server mode)
└── User
    └── Project
        └── Milestone (optional grouping)
            └── Plan Node (task)
                └── Execution (one run of a task, may have retries)
                    └── Subroutine (implement, verify, commit, etc.)
                        └── Turn (one AI request/response round-trip)
```

Each level aggregates the costs below it. This enables questions like:
- "How much did Project X cost this week?" (project level)
- "Which task in Milestone 2 burned the most tokens?" (node level)
- "Was the verify subroutine worth the cost?" (subroutine level)
- "Which turn triggered the expensive tool call?" (turn level)

### 2.2 Cost Record

Every AI interaction produces a cost record:

```typescript
interface CostRecord {
  id: string
  timestamp: Date

  // Attribution hierarchy
  userId: string
  projectId: string
  nodeId: string
  executionId: string
  subroutineName?: string        // 'implement', 'verify', 'git-commit', etc.
  turnIndex?: number             // 0-based turn within the execution/subroutine

  // Model info
  provider: string               // 'claude-sdk', 'claude-code', 'codex'
  model: string                  // 'claude-sonnet-4-20250514', etc.
  machineId?: string             // which machine ran this

  // Token metrics
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number       // prompt cache hits
  cacheWriteTokens?: number      // prompt cache writes

  // Cost (in USD)
  costUsd: number                // computed from tokens × model pricing

  // Execution context
  durationMs: number             // wall-clock time for this turn
  toolCalls?: number             // number of tool calls in this turn
  status: 'success' | 'error'   // did this turn succeed?
}
```

### 2.3 Model Pricing Table

Cost computation requires a pricing table. This lives in the backend and is updatable without code changes:

```typescript
interface ModelPricing {
  model: string                  // regex pattern, e.g. 'claude-sonnet-4.*'
  inputPricePerMToken: number    // $ per million input tokens
  outputPricePerMToken: number   // $ per million output tokens
  cacheReadPricePerMToken?: number
  cacheWritePricePerMToken?: number
  effectiveDate: string          // ISO date, for historical accuracy
}
```

Default pricing loaded from `server/lib/cost/model-pricing.ts`. Users can override for custom API agreements.

### 2.4 Data Flow

```
Agent Runner                          Backend                      Frontend
     │                                    │                            │
     │ task.tool_result                   │                            │
     │ (includes token counts per turn)   │                            │
     │ ──────────────────────────────────►│                            │
     │                                    │ compute cost from          │
     │                                    │ tokens × pricing table     │
     │                                    │                            │
     │                                    │ write CostRecord to DB     │
     │                                    │                            │
     │                                    │ SSE: cost_update event     │
     │                                    │ ──────────────────────────►│
     │                                    │                            │ update live cost
     │                                    │                            │ display on task
     │                                    │                            │
     │ task.result                        │                            │
     │ (final metrics)                    │                            │
     │ ──────────────────────────────────►│                            │
     │                                    │ finalize execution cost    │
     │                                    │ aggregate to project       │
     │                                    │ check budget policies      │
     │                                    │                            │
     │                                    │ SSE: execution_cost_final  │
     │                                    │ ──────────────────────────►│
     │                                    │                            │ update dashboard
```

**Key change from current state**: Cost is computed **per turn during execution** (not just at completion), enabling live cost display and mid-execution budget enforcement.

---

## 3. Budget System

### 3.1 Budget Hierarchy

Budgets mirror the cost hierarchy. Each level can have an optional budget that constrains spending below it:

```typescript
interface Budget {
  id: string
  scope: 'organization' | 'user' | 'project' | 'node'
  scopeId: string               // orgId, userId, projectId, or nodeId
  periodType: 'daily' | 'weekly' | 'monthly' | 'total'
  limitUsd: number
  alertThresholds: number[]     // e.g., [0.5, 0.8, 0.95] = alert at 50%, 80%, 95%
  policy: BudgetPolicy
  createdAt: Date
  updatedAt: Date
}

interface BudgetPolicy {
  onThreshold: 'alert'                       // notify user
  onExceeded: 'alert' | 'downgrade' | 'pause' | 'block'
  downgradeModel?: string                    // e.g., 'claude-haiku' when over budget
  allowOveragePercent?: number               // e.g., 10 = allow 10% overage before hard block
}
```

### 3.2 Budget Policies

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `alert` | Send notification, continue execution | Monitoring — human decides |
| `downgrade` | Switch to cheaper model mid-execution | Cost optimization — graceful degradation |
| `pause` | Pause new task dispatches, finish running tasks | Soft limit — don't start new work |
| `block` | Cancel running tasks, refuse new dispatches | Hard limit — emergency stop |

### 3.3 Budget Enforcement Flow

```
Task dispatched
    │
    ▼
Check project budget remaining
    │
    ├── remaining > task estimate → proceed
    ├── remaining < task estimate but > 0 → proceed with alert
    └── remaining ≤ 0 → apply policy (block/pause/downgrade)
    │
    ▼
During execution (per-turn cost update)
    │
    ├── crossed alert threshold → send notification
    ├── crossed budget limit → apply onExceeded policy
    └── within budget → continue
```

### 3.4 Cost Estimation (Transient)

Before dispatching a task, estimate its cost to check against budgets. **Note**: these estimates are inherently transient — they depend on current model pricing and efficiency, which change with every model release. The system uses them for budget enforcement but does not build long-term predictions on them.

```typescript
interface CostEstimate {
  estimatedCostUsd: number
  estimatedTokens: number
  confidence: 'low' | 'medium' | 'high'
  basis: 'historical_similar' | 'estimate_heuristic' | 'user_specified'
  // Transient: based on current model pricing, not a durable prediction
  modelVersion: string
  pricingDate: Date
}
```

Estimation methods (in priority order):
1. **Historical**: Average cost of similar tasks in same project (same estimate size, same type)
2. **Heuristic**: Based on task estimate (`XS`=~$0.50, `S`=~$2, `M`=~$8, `L`=~$25, `XL`=~$80) and model
3. **User override**: User sets explicit budget per task

These estimates are recalculated when model pricing changes. They are useful for budget guardrails, not for long-term planning.

---

## 4. Waste Detection and Optimization

Forecasting absolute cost is fragile (depends on model pricing, which changes). What's durable is identifying **structural waste** — patterns where money is spent inefficiently regardless of model.

### 4.1 Waste Categories

```typescript
interface WasteAnalysis {
  projectId: string
  period: { start: Date; end: Date }

  // Category 1: Retry waste — money spent on failed attempts
  retryWaste: {
    totalWastedUsd: number             // cost of all failed attempts
    percentOfTotal: number             // retry waste as % of total spend
    topCauses: Array<{
      failureReason: FailureReason
      count: number
      totalWastedUsd: number
      suggestion: string               // e.g., "Add test patterns to CLAUDE.md"
    }>
    preventableRetries: number         // retries caused by spec quality issues
  }

  // Category 2: Approval wait waste — cost of idle compute during human review
  approvalWaitWaste: {
    totalIdleHours: number
    estimatedWastedComputeUsd: number  // if machines were reserved during wait
    autoApprovableTasks: number        // tasks where human always approves
    estimatedSavingsUsd: number        // if those were auto-approved
  }

  // Category 3: Context explosion — tasks where token usage grew unexpectedly
  contextExplosions: Array<{
    nodeId: string
    peakTokensPerTurn: number
    normalTokensPerTurn: number
    excessCostUsd: number
    cause: string                      // e.g., "agent read entire node_modules"
  }>

  // Category 4: Wrong-tool-for-job — tasks where a cheaper model would have sufficed
  modelOverspend: {
    tasksWhereHaikuSufficed: number     // opus/sonnet used, but task was simple
    estimatedOverspendUsd: number
    // NOTE: This is transient — depends on current model capabilities
  }
}
```

**What the system surfaces:**
```
Cost Optimization — API Rewrite (this month)

  Total spend: $187.50

  Waste breakdown:
  ■ Retry waste:        $42.30 (23%)
    Top cause: test_failure in auth module (14 retries, $28.40)
    → Add auth test patterns to CLAUDE.md (estimated savings: $20/month)

  ■ Approval wait:      $0 compute wasted, but 5.8h human time
    → Auto-approve src/components/ PRs (saves 35 min/week)

  ■ Context explosion:  $8.20 (4%)
    → Task "Refactor utils" read 180K tokens per turn
    → Add .claudeignore for node_modules

  ■ Effective spend:    $137.00 (73%) — actual productive work
```

### 4.2 Burn Rate Tracking

Track spend velocity to detect anomalies in real time:

```
Daily cost series:
  Day 1: $45  ████████
  Day 2: $62  ████████████
  Day 3: $38  ███████
  Day 4: $210 ██████████████████████████████████████████ ← anomaly
  Day 5: $51  ██████████

7-day average: $81.20/day
Anomaly threshold: $160 (2× average)
Day 4 triggered alert: "Spend spike: $210 (2.6× average)"
  Root cause: agent stuck in retry loop on database migration task
```

### 4.3 Anomaly Detection

Simple but effective: flag when any metric exceeds N× the rolling average.

| Metric | Window | Threshold | Alert | Durable? |
|--------|--------|-----------|-------|----------|
| Daily spend | 7-day rolling avg | 2× | "Cost spike" | Yes — detects structural problems |
| Per-task cost | Same-estimate avg | 3× | "Task over-budget" | Yes — indicates spec or code issues |
| Turn count per task | Same-type avg | 2× | "Agent may be looping" | Yes — agent stuck pattern |
| Token-per-turn | 10-turn rolling avg | 3× | "Context explosion" | Yes — repo/config issue |

The "agent looping" detector is especially valuable — a stuck agent retrying the same failing approach is the most common source of unexpected cost. This pattern persists across model generations.

### 4.4 Project-Level Forecast (Transient)

Given a project's plan graph, estimate total remaining cost. **Note**: this forecast is model-dependent and should be labeled as such in the UI.

```typescript
interface ProjectForecast {
  projectId: string
  computedAt: Date
  // Clearly labeled: "Based on current model pricing as of {date}"
  pricingBasis: string

  // Spent (durable: actual historical data)
  totalSpentUsd: number
  tasksCompleted: number

  // Remaining (transient: depends on model pricing)
  estimatedRemainingUsd: number
  estimatedRemainingRange: { low: number; high: number }
  tasksRemaining: number

  // Projections
  estimatedTotalUsd: number
  dailyBurnRate: number         // trailing 7-day average $/day
  dailyTaskRate: number         // trailing 7-day average tasks/day

  // Durable insight alongside transient forecast
  wastePercentage: number       // what % of spend is structural waste
  optimizationPotentialUsd: number  // how much could be saved by fixing waste
}

---

## 5. Database Schema

### 5.1 New Tables

```sql
-- Granular cost records (one per AI turn)
CREATE TABLE cost_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  project_id UUID NOT NULL,
  node_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  subroutine_name TEXT,
  turn_index INTEGER,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  machine_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  tool_calls INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_cost_records_project ON cost_records(project_id, created_at);
CREATE INDEX idx_cost_records_user_daily ON cost_records(user_id, created_at);
CREATE INDEX idx_cost_records_execution ON cost_records(execution_id);
CREATE INDEX idx_cost_records_node ON cost_records(node_id);

-- Materialized daily rollups (refreshed by cron or on-demand)
CREATE TABLE cost_daily_rollup (
  user_id UUID NOT NULL REFERENCES auth.users(id),
  project_id UUID NOT NULL,
  date DATE NOT NULL,
  total_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
  total_input_tokens BIGINT NOT NULL DEFAULT 0,
  total_output_tokens BIGINT NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_failed INTEGER NOT NULL DEFAULT 0,
  executions INTEGER NOT NULL DEFAULT 0,
  dominant_model TEXT,             -- model with highest spend that day
  PRIMARY KEY (user_id, project_id, date)
);

-- Budgets
CREATE TABLE budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  scope TEXT NOT NULL,              -- 'user', 'project', 'node'
  scope_id TEXT NOT NULL,           -- userId, projectId, or nodeId
  period_type TEXT NOT NULL,        -- 'daily', 'weekly', 'monthly', 'total'
  limit_usd NUMERIC(10, 2) NOT NULL,
  alert_thresholds NUMERIC[] DEFAULT '{0.5, 0.8, 0.95}',
  policy JSONB NOT NULL DEFAULT '{"onThreshold":"alert","onExceeded":"alert"}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope, scope_id, period_type)
);

-- Budget alert history (so we don't re-alert)
CREATE TABLE budget_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  threshold_percent NUMERIC NOT NULL,
  current_spend_usd NUMERIC(10, 4) NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Model pricing (admin-editable)
CREATE TABLE model_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_pattern TEXT NOT NULL,       -- regex, e.g. 'claude-sonnet-4.*'
  input_price_per_m_token NUMERIC(10, 6) NOT NULL,
  output_price_per_m_token NUMERIC(10, 6) NOT NULL,
  cache_read_price_per_m_token NUMERIC(10, 6),
  cache_write_price_per_m_token NUMERIC(10, 6),
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.2 Local Mode (IndexedDB)

In local mode, cost records are stored in IndexedDB with the same structure. Budgets are optional but available. Rollups computed client-side.

IndexedDB stores: `astro-cost-records`, `astro-budgets`, `astro-cost-daily`.

---

## 6. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cost/summary` | Current period summary (total, by project, by model) |
| GET | `/api/cost/project/:id` | Project cost breakdown (by node, by milestone, by day) |
| GET | `/api/cost/project/:id/forecast` | Project cost forecast |
| GET | `/api/cost/history` | Time-series cost data (daily/weekly, filterable) |
| GET | `/api/cost/execution/:id` | Per-turn cost breakdown for an execution |
| POST | `/api/budgets` | Create/update budget |
| GET | `/api/budgets` | List budgets |
| DELETE | `/api/budgets/:id` | Remove budget |
| GET | `/api/cost/anomalies` | Current active anomalies |

---

## 7. SSE Events

New events during execution:

| Event | Data | Purpose |
|-------|------|---------|
| `cost_update` | `{ executionId, turnIndex, costUsd, totalCostUsd, inputTokens, outputTokens, model }` | Live cost ticker during task execution |
| `budget_alert` | `{ budgetId, scope, threshold, currentSpend, limitUsd, policy }` | Budget threshold crossed |
| `cost_anomaly` | `{ type, metric, value, expected, executionId?, projectId? }` | Anomaly detected |
| `budget_action` | `{ budgetId, action, executionId?, reason }` | Budget policy enforced (downgrade/pause/block) |

---

## 8. Frontend Components

### 8.1 Cost Dashboard Widget (dashboard.tsx enhancement)

Replaces the current simple "Token Spend" stat card with:

```
┌─ Cost Overview ──────────────────────────────────────┐
│                                                       │
│  Today: $42.30          This Week: $187.50            │
│  ████████░░ 84% of $50  ██████░░░░ 62% of $300       │
│                                                       │
│  Burn Rate: $38/day avg (↑12% vs last week)           │
│  Forecast: $285 this month                            │
│                                                       │
│  By Project:                                          │
│  ■ API Rewrite     $95.20  ███████████                │
│  ■ ML Pipeline     $62.10  ███████                    │
│  ■ Documentation   $30.20  ████                       │
│                                                       │
│  By Model:                                            │
│  ■ claude-sonnet   $142.30 (76%)                      │
│  ■ claude-opus     $38.20  (20%)                      │
│  ■ claude-haiku    $7.00   (4%)                       │
└───────────────────────────────────────────────────────┘
```

### 8.2 Live Cost Ticker (task-detail enhancement)

During execution, show running cost next to the task output:

```
┌─ Task: Implement auth middleware ──── $3.42 (running) ─┐
│                                                         │
│  Turn 1: $0.15 (sonnet, 12K tokens)                    │
│  Turn 2: $0.28 (sonnet, 24K tokens) — Read 8 files     │
│  Turn 3: $0.45 (sonnet, 38K tokens) — Write auth.ts    │
│  Turn 4: $2.54 (sonnet, 180K tokens) ← context grew    │
│                 ⚠ 3.2× average turn cost                │
│                                                         │
│  Budget: $8.00 remaining for this task                  │
│  Estimate: ~$6 total (based on similar M-size tasks)    │
└─────────────────────────────────────────────────────────┘
```

### 8.3 Budget Settings (settings.tsx or per-project)

```
┌─ Budgets ────────────────────────────────────────────┐
│                                                       │
│  Monthly limit:  $500    [Edit]                       │
│  Alert at: 50%, 80%, 95%                              │
│  When exceeded: ● Alert  ○ Downgrade  ○ Pause         │
│                                                       │
│  Per-Project Budgets:                                 │
│  ┌─────────────────────┬────────┬──────────────────┐ │
│  │ Project             │ Budget │ Policy           │ │
│  ├─────────────────────┼────────┼──────────────────┤ │
│  │ API Rewrite         │ $200/mo│ Pause on exceed  │ │
│  │ ML Pipeline         │ $150/mo│ Downgrade→haiku  │ │
│  │ (default)           │ no cap │ Alert only       │ │
│  └─────────────────────┴────────┴──────────────────┘ │
└───────────────────────────────────────────────────────┘
```

---

## 9. Integration with Existing Systems

### 9.1 Event Transport Hook

New hook: `server/lib/events/hooks/cost-tracking-hook.ts`

Subscribes to:
- `task.started` — record execution start, look up budget
- `task.progress` — if progress includes token data, create cost record
- `task.completed` — finalize execution cost, check budget
- `task.failed` — record cost of failed execution (still counts)

### 9.2 Observation Collector Integration

The existing `observation-collector.ts` already tracks per-turn data. Extend it to emit `cost_update` SSE events per turn, not just at completion.

### 9.3 Agent Runner Changes

The agent runner already reports `UsageMetrics` in `task.result`. Additional change: report **per-turn token counts** in `task.tool_result` or a new `task.turn_complete` message so the backend can compute turn-level costs in real time.

```typescript
// New WebSocket message type
interface TaskTurnComplete {
  type: 'task.turn_complete'
  taskId: string
  turnIndex: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  model: string
  toolCalls: number
  durationMs: number
}
```

---

## 10. Implementation Phases

### Phase 1: Instrumentation (foundation)
- Add `cost_records` table and `CostRecord` type
- Add `model_pricing` table with default pricing data
- Create `cost-tracking-hook.ts` in event transport
- Emit `cost_update` SSE event per turn during execution
- Display live cost ticker on task detail page

### Phase 2: Aggregation and Visualization
- Add `cost_daily_rollup` table
- Build `/api/cost/*` endpoints
- Add cost dashboard widget
- Add per-project cost breakdown in project overview

### Phase 3: Budgets and Policies
- Add `budgets` and `budget_alerts` tables
- Budget CRUD endpoints
- Budget enforcement in dispatch engine
- Budget settings UI

### Phase 4: Forecasting and Anomaly Detection
- Project forecast computation
- Burn rate tracking
- Anomaly detection (looping agent, context explosion)
- Anomaly alerts via SSE + push notifications
