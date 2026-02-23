# Agent Performance Tracking — Design Document

> **Status: PROPOSED** — Not yet implemented (0%)

## 1. Overview

### 1.1 What This Document Is About

When agents execute tasks, Astro captures the raw data: text output, tool calls, file changes, token counts. But it does not capture the data needed to answer management questions:

- **Where is time being spent** — AI thinking, waiting for human, waiting for compute?
- **How long did this task actually take**, including retries and human review cycles?
- **What makes tasks succeed or fail** — task description quality, codebase complexity, context provided?
- **Where is the human the bottleneck**, and which human decisions could be automated?

This document designs the performance tracking system. It captures granular timing, preserves execution attempt history, and surfaces **durable insights** about the work, the codebase, and the human — not transient benchmarks about specific models.

### 1.2 Design Principle: Track What Survives Model Changes

Model-specific metrics (speed, cost, success rate) reset every time a new model releases. A carefully calibrated performance model for claude-sonnet-4 becomes worthless when claude-sonnet-5 ships. This system focuses on insights that are durable:

| Fragile (resets every model release) | Durable (survives model changes) |
|--------------------------------------|----------------------------------|
| "Sonnet takes 8 minutes on bug fixes" | "Tasks in the auth module take 2.5× longer than average" |
| "Opus has 94% success rate" | "Tasks with descriptions under 50 words fail 3× more often" |
| "Use sonnet, it's 4× cheaper" | "85% of elapsed time is human review, not AI execution" |
| "This agent is faster this week" | "Adding 500 words to vision doc cut retry rate from 35% to 12%" |
| "Haiku costs $0.35 per task" | "You approve 89% of auth PRs — auto-approve?" |

The system captures model-specific data (it's useful short-term), but the **insight layer** extracts properties of the work, the codebase, and the human that persist regardless of which model is running.

### 1.3 Five Durable Insight Categories

1. **Task specification quality** — Do better-written task descriptions lead to fewer retries? This helps the human write better tasks.
2. **Codebase difficulty profile** — Which parts of the codebase are hardest to modify? This is a property of the code, not the model.
3. **Human workflow bottlenecks** — Where does the human's time go? As AI gets faster, the human becomes the increasing bottleneck.
4. **Organizational patterns** — Which decisions are predictable (auto-approve) vs genuinely require judgment? This is about the human, not the model.
5. **Return on context investment** — Does investing in better CLAUDE.md, vision docs, or dependency outputs measurably improve outcomes? This survives model changes because it's about instruction quality.

### 1.4 Current State

**What exists:**
- `TaskExecution.startedAt` / `completedAt` — execution-level wall clock
- `PlanNode.actualStartDate` / `actualEndDate` — first attempt to final completion
- `observationEvents` table — per-turn `startTime`/`endTime`, token counts, tool durations
- `UsageMetrics` — `durationMs`, `turnsUsed`, token counts per execution
- `DispatchQueueEntry.retryCount` / `maxRetries` — retry tracking in dispatch queue

**What's missing:**
- No execution attempt history (old execution is overwritten on retry)
- No time decomposition (AI time vs human wait time vs compute wait time)
- No agent identity that persists across tasks
- No performance baselines or comparisons
- No tracking of context that was available to the agent

---

## 2. Time Model

### 2.1 The Full Task Timeline

A task's lifetime is not a single execution. It includes multiple attempts, human review cycles, and wait time:

```
Task created
  │
  ├─ Wait (queued, dependencies not met)
  │
  ├─ Attempt 1
  │   ├─ Dispatch latency (queue → agent runner)
  │   ├─ Workspace prep (worktree creation)
  │   ├─ AI execution
  │   │   ├─ Turn 1: 2.3s (read files)
  │   │   ├─ Turn 2: 4.1s (write code)
  │   │   ├─ Turn 3: 8.7s (run tests, tool wait)
  │   │   └─ Turn 4: 1.2s (commit)
  │   ├─ Post-execution (PR creation, cleanup)
  │   └─ Result: FAILED (tests failed)
  │
  ├─ Human review time (4 hours — human was asleep)
  │   └─ Decision: retry with feedback
  │
  ├─ Attempt 2
  │   ├─ AI execution (faster — has context from attempt 1)
  │   │   ├─ Turn 1: 1.8s (read diff from attempt 1)
  │   │   ├─ Turn 2: 3.2s (fix the bug)
  │   │   └─ Turn 3: 6.1s (run tests — pass)
  │   ├─ Post-execution (PR creation)
  │   └─ Result: SUCCESS
  │
  ├─ Human judgment time (20 minutes)
  │   └─ Decision: approved
  │
  └─ Task complete
```

### 2.2 Time Categories

Every span of time in a task's lifetime falls into one category:

```typescript
type TimeCategory =
  | 'queued'              // waiting for dependencies or dispatch slot
  | 'dispatch_latency'    // between dispatch and agent runner receiving task
  | 'workspace_prep'      // worktree creation, repo clone, setup scripts
  | 'ai_execution'        // AI turns (thinking + tool execution)
  | 'ai_turn_thinking'    // within a turn: model inference time
  | 'ai_turn_tool'        // within a turn: tool execution time (bash, file I/O)
  | 'post_execution'      // PR creation, cleanup, result packaging
  | 'human_review'        // waiting for human judgment/approval
  | 'human_approval'      // waiting for dynamic approval mid-execution
  | 'compute_wait'        // SLURM queue time, cloud VM provisioning
  | 'retry_gap'           // time between attempt failure and next attempt start
```

### 2.3 Turn-Level Timing

Each AI turn already has `startTime`/`endTime` in `observationEvents`. Extend with decomposition:

```typescript
interface TurnTiming {
  turnIndex: number
  startTime: Date
  endTime: Date
  totalMs: number

  // Decomposition
  thinkingMs: number          // time from turn start to first tool call (or end if no tools)
  toolExecutionMs: number     // sum of all tool call durations in this turn
  toolWaitMs: number          // time waiting for tool results (network, compute)

  // Context
  inputTokens: number
  outputTokens: number
  cacheHitTokens: number
  toolCalls: number
  toolNames: string[]         // which tools were used

  // Derived
  tokensPerSecond: number     // output throughput
  costUsd: number
}
```

### 2.4 Execution Attempt Record

The core change: **preserve every attempt**, not just the latest.

```typescript
interface ExecutionAttempt {
  id: string                    // unique attempt ID
  executionId: string           // groups attempts for same dispatch
  nodeId: string
  projectId: string
  attemptNumber: number         // 1-based

  // Agent identity
  providerId: string            // 'claude-code', 'claude-sdk', 'codex'
  model: string                 // 'claude-sonnet-4-20250514'
  machineId: string
  machineName?: string
  sessionId?: string            // provider session (for resume tracking)

  // Timing
  dispatchedAt: Date
  startedAt?: Date              // when agent runner began execution
  completedAt?: Date
  totalMs?: number              // startedAt → completedAt

  // Time decomposition
  workspacePrepMs?: number
  aiExecutionMs?: number        // sum of all turn times
  postExecutionMs?: number
  totalTurns?: number

  // Result
  status: 'success' | 'failure' | 'cancelled' | 'timeout'
  failureReason?: FailureReason
  failureDetail?: string

  // Cost
  inputTokens: number
  outputTokens: number
  costUsd: number

  // Output
  branchName?: string
  prUrl?: string
  filesChanged: number
  linesAdded: number
  linesRemoved: number

  // Context provided to agent
  contextSnapshot: AgentContextSnapshot
}

type FailureReason =
  | 'test_failure'           // tests/build failed
  | 'tool_error'             // a tool call errored
  | 'timeout'                // execution exceeded time limit
  | 'budget_exceeded'        // cost limit hit
  | 'user_cancelled'         // human cancelled
  | 'agent_loop'             // stuck in retry loop
  | 'workspace_error'        // worktree/repo setup failed
  | 'provider_error'         // AI provider API error
  | 'unknown'
```

### 2.5 Task Performance Record

Aggregates across all attempts for a single task node:

```typescript
interface TaskPerformance {
  nodeId: string
  projectId: string

  // Attempt history
  totalAttempts: number
  successfulAttempt?: number     // which attempt succeeded (null if still failing)
  attempts: ExecutionAttempt[]

  // Total timeline
  firstDispatchedAt: Date        // when work first started
  finalCompletedAt?: Date        // when task was finally approved/verified
  totalElapsedMs?: number        // first dispatch → final completion

  // Time decomposition (across all attempts)
  totalAiExecutionMs: number     // sum of AI time across all attempts
  totalHumanReviewMs: number     // sum of time waiting for human decisions
  totalComputeWaitMs: number     // sum of SLURM queue time, etc.
  totalRetryGapMs: number        // sum of gaps between attempts
  totalWastedMs: number          // AI time on failed attempts

  // Cost (across all attempts)
  totalCostUsd: number
  wastedCostUsd: number          // cost of failed attempts
  effectiveCostUsd: number       // cost of the successful attempt only

  // Efficiency
  firstAttemptSuccessRate: number // 1.0 if first attempt succeeded, 0.0 if not
  costEfficiency: number         // effectiveCostUsd / totalCostUsd (1.0 = no waste)
  humanBottleneckRatio: number   // totalHumanReviewMs / totalElapsedMs
}
```

---

## 3. Agent Context Tracking

### 3.1 Why Context Matters

Two executions of the "same" task can perform very differently based on what context the agent had:

| Context Factor | Impact |
|---------------|--------|
| Vision doc quality | Agent understands project goals → fewer wrong turns |
| Dependency outputs | Agent has upstream results → doesn't redo work |
| CLAUDE.md content | Agent knows project conventions → fewer style issues |
| Previous attempt feedback | Agent knows what failed → avoids same mistake |
| File tree size | Larger codebase → more tokens per turn, slower |
| Session continuity | Resumed session → agent remembers prior context |

To track performance improvement, we must record **what the agent knew** at execution time.

### 3.2 Context Snapshot

Captured at the start of each execution attempt:

```typescript
interface AgentContextSnapshot {
  // What was injected into the prompt
  visionDocLength: number        // chars of vision doc
  dependencyOutputCount: number  // number of upstream results included
  dependencyOutputLength: number // total chars
  fileTreeSize: number           // number of files in repo context
  customInstructions?: string[]  // CLAUDE.md, project rules, etc.

  // Agent's prior experience
  priorAttemptsOnThisNode: number
  priorFeedback?: string[]       // human feedback from rejected attempts
  sessionResumed: boolean        // is this a resumed session?
  priorTasksInProject: number    // how many tasks this agent has done in this project
  priorTasksOnThisMachine: number

  // Environment
  executionStrategy: string      // 'direct', 'docker', 'slurm', etc.
  workingDirectoryType: 'worktree' | 'direct' | 'sandbox'
  mcpServersLoaded: string[]     // which MCP tool servers were available
}
```

### 3.3 Agent Identity

An "agent" in the performance model is not just a provider — it's a combination of:

```typescript
interface AgentIdentity {
  providerId: string             // 'claude-code', 'claude-sdk', 'codex'
  model: string                  // specific model version
  machineId: string              // physical machine
  contextFingerprint: string     // hash of context snapshot (for grouping similar contexts)
}
```

The `contextFingerprint` enables comparing "same agent, same context type, different tasks" and "same agent, different context, same task type."

---

## 4. Durable Insight Analysis

The primary value of performance tracking is not benchmarking models (which resets every release). It is extracting insights about the work, the codebase, and the human that persist regardless of which model is executing.

### 4.1 Task Specification Quality

**Question: Do better-written tasks lead to fewer retries?**

This is durable because it's about the human's ability to write clear specifications, not the model's ability to interpret them.

```typescript
interface TaskSpecQuality {
  nodeId: string
  projectId: string

  // Specification metrics (measurable properties of the task description)
  descriptionLength: number        // chars
  descriptionWordCount: number
  hasAcceptanceCriteria: boolean   // contains "should", "must", "verify", etc.
  hasExampleOutput: boolean        // contains code blocks, examples
  hasNegativeConstraints: boolean  // contains "do not", "avoid", etc.
  referencesExistingCode: boolean  // contains file paths, function names
  estimateProvided: boolean
  dependencyOutputsAvailable: number

  // Outcome (what happened)
  firstAttemptSuccess: boolean
  totalAttempts: number
  totalCostUsd: number
  humanRejections: number

  // Derived insight
  specQualityScore: number         // 0-100, weighted from above metrics
}
```

**What the system surfaces:**
```
Task Specification Analysis (last 60 days)
┌──────────────────────────────────────┬──────────┬───────────┐
│ Spec Quality                         │ 1st Try  │ Avg Cost  │
│                                      │ Success  │           │
├──────────────────────────────────────┼──────────┼───────────┤
│ < 50 words, no acceptance criteria   │ 41%      │ $6.80     │
│ 50-200 words, has criteria           │ 72%      │ $3.20     │
│ 200+ words, with examples + paths    │ 89%      │ $2.10     │
└──────────────────────────────────────┴──────────┴───────────┘
Insight: Tasks with acceptance criteria succeed 1.8× more on first try.
Recommendation: Add "verify by:" section to task descriptions.
```

This insight holds whether the model is sonnet, opus, or a future model that doesn't exist yet.

### 4.2 Codebase Difficulty Profile

**Question: Which parts of the codebase are hardest to modify?**

This is durable because it's a property of the code, not the model. Complex authentication middleware is harder to modify than a README, regardless of model generation.

```typescript
interface CodebaseDifficulty {
  // Computed per directory or module
  path: string                     // e.g., 'server/lib/dispatch/'
  projectId: string

  // Aggregate stats across all tasks touching this path
  tasksAttempted: number
  firstAttemptSuccessRate: number
  averageAttempts: number
  averageRetryCount: number
  averageCostPerTask: number

  // Relative difficulty
  difficultyMultiplier: number     // e.g., 2.5 = 2.5× harder than project average
  commonFailureReasons: Array<{ reason: FailureReason; count: number }>

  // Cross-model consistency
  consistentlyHard: boolean        // true if hard across multiple models (= code problem, not model problem)
}
```

**What the system surfaces:**
```
Codebase Difficulty Map — API Rewrite project

  server/lib/dispatch/     ██████████ 2.5× avg difficulty
    87 tasks, 51% first-try success, common failure: test_failure
    Hard across all models → code is genuinely complex

  server/routes/           ████ 1.0× (average)
    42 tasks, 78% first-try success

  src/components/ui/       ██ 0.5× (easy)
    31 tasks, 92% first-try success

  server/lib/auth/         █████████ 2.2× avg difficulty
    28 tasks, 54% first-try success, common failure: test_failure
    → Consider: better test fixtures, clearer auth flow docs
```

### 4.3 Human Workflow Bottlenecks

**Question: Where does the human's time go?**

This gets more valuable as AI gets faster. When model execution drops from 5 minutes to 30 seconds, the 4-hour human review time becomes 99.8% of elapsed time instead of 98%.

```
Project: ML Pipeline — Time decomposition (all tasks)

AI execution:    ████████████████████████  62%  (14.2 hours)
Human review:    ██████████               26%  (5.8 hours)  ← bottleneck
Compute wait:    ███                       8%  (1.8 hours)
Workspace prep:  █                         2%  (0.5 hours)
Retry gaps:      █                         2%  (0.4 hours)

Human review breakdown:
  Judgment reviews:     3.8h (65%)  — 42 tasks, avg 5.4 min each
  Approval requests:    1.2h (21%)  — 18 requests, avg 4 min each
  Steer responses:      0.8h (14%)  — 12 interventions

Automation opportunities:
  • 8 judgment reviews always approved → switch to auto-verify (saves ~43 min/week)
  • 89% of approval_requests approved → auto-approve for this project?
  • 65% of human review is on auto-verifiable tasks → save ~3.5 hours
```

### 4.4 Organizational Patterns

**Question: Which decisions are predictable (auto-approve) vs genuinely require judgment?**

This is about the human, not the model. It identifies habitual patterns the human may not be aware of.

```typescript
interface DecisionPattern {
  projectId: string
  userId: string

  // What type of decision
  decisionType: 'approval' | 'judgment' | 'retry' | 'branch_selection'

  // Historical pattern
  totalDecisions: number
  mostCommonAction: string         // e.g., 'approve', 'retry', 'reject'
  mostCommonActionRate: number     // e.g., 0.89 = chosen 89% of the time
  averageResponseTimeMs: number

  // Predictability
  predictable: boolean             // true if mostCommonActionRate > 0.85
  automatable: boolean             // predictable + no recent exceptions

  // Recommendation
  suggestion?: string              // "Auto-approve PRs in src/components/"
  estimatedTimeSavedPerWeek?: number // minutes
}
```

**What the system surfaces:**
```
Decision Patterns — You (last 30 days)

  Predictable (automatable):
  ✓ Approve agent PRs in src/components/   (94% approve rate, 47 decisions)
    → Auto-approve would save ~35 min/week

  ✓ Retry on first test_failure             (88% retry rate, 23 decisions)
    → Auto-retry would save ~18 min/week

  Genuinely requires judgment:
  ✗ PRs touching server/lib/auth/           (61% approve, 39% reject+feedback)
  ✗ Branch selection decisions               (no clear pattern)
  ✗ Architecture-level approvals             (varied responses)
```

### 4.5 Return on Context Investment

**Question: Does investing in better instructions measurably improve outcomes?**

This is durable because it measures instruction quality, not model capability. Better CLAUDE.md helps every model.

```typescript
interface ContextROI {
  projectId: string

  // Before/after comparison for each context change
  contextChanges: Array<{
    date: Date
    changeType: 'claude_md_update' | 'vision_doc_update' | 'dependency_added' | 'feedback_provided'
    changeSizeChars: number
    changeDescription: string

    // Performance before (10 tasks before change)
    beforeSuccessRate: number
    beforeMedianCost: number
    beforeMedianAttempts: number

    // Performance after (10 tasks after change)
    afterSuccessRate: number
    afterMedianCost: number
    afterMedianAttempts: number

    // Impact
    successRateChange: number       // positive = improvement
    costChange: number              // negative = cheaper
    attemptsChange: number          // negative = fewer retries
    estimatedROI: number            // cost saved / effort to write context
  }>

  // Overall project trajectory
  learningCurve: Array<{
    weekNumber: number
    cumulativeContextChars: number
    successRate: number
    medianCost: number
  }>
}
```

**What the system surfaces:**
```
Context ROI — API Rewrite project

  Context investment over 3 weeks:
  Week 1: 200 chars in CLAUDE.md → 72% success, $3.20/task
  Week 2: +600 chars (auth patterns) → 81% success, $2.40/task  (↑9%, ↓25% cost)
  Week 3: +600 chars (test conventions) → 88% success, $1.90/task  (↑7%, ↓21% cost)

  Most impactful additions:
  1. "Always run npm test before committing" — cut test_failure retries by 60%
  2. Auth token refresh pattern documentation — eliminated a recurring failure mode
  3. Vision doc section on API versioning — reduced wrong-approach attempts

  Estimated value: $1,200 words of context saved ~$84 in retry costs over 3 weeks
```

### 4.6 Model-Specific Data (Transient but Useful)

The system still captures model-specific performance data — it's useful for short-term decisions like model selection. But it's clearly labeled as transient.

```typescript
interface ModelSnapshot {
  // This data has a shelf life — valid until the next model release
  validAsOf: Date
  model: string

  // Current performance (will change with next model version)
  medianExecutionMs: number
  firstAttemptSuccessRate: number
  medianCostPerTask: number

  // Relative to other current models
  speedRank: number                // 1 = fastest
  qualityRank: number              // 1 = highest success rate
  costRank: number                 // 1 = cheapest

  // Recommendation (transient — regenerated on model changes)
  recommendation: string           // e.g., "Best cost/quality for this project"
}
```

**What was different about the successful retry?** (This analysis combines durable and transient insights)

```
Task: "Fix authentication middleware" (node-abc123)

Attempt 1 (FAILED — test_failure, 3m 22s, $2.10):
  Context: vision doc + file tree, no prior feedback
  Turns: 8, tool calls: 14
  Failure: wrote middleware but missed edge case in token refresh

Attempt 2 (SUCCESS, 1m 48s, $1.20):
  Context: vision doc + file tree + feedback "handle token refresh edge case"
  Turns: 4, tool calls: 8
  Improvement: 47% faster, 43% cheaper, targeted fix

Durable insight: Human feedback on specific edge case was the key differentiator.
  → Consider adding token refresh edge case to CLAUDE.md to prevent future failures.
Transient data: Both attempts used sonnet-4 on the same machine.
```

---

## 5. Database Schema

### 5.1 New Tables

```sql
-- Execution attempts (preserves history, one node can have many)
CREATE TABLE execution_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id TEXT NOT NULL,       -- groups attempts for same dispatch
  node_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  attempt_number INTEGER NOT NULL DEFAULT 1,

  -- Agent identity
  provider_id TEXT NOT NULL,
  model TEXT,
  machine_id TEXT,
  machine_name TEXT,
  session_id TEXT,

  -- Timing
  dispatched_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_ms INTEGER,

  -- Time decomposition
  workspace_prep_ms INTEGER,
  ai_execution_ms INTEGER,
  post_execution_ms INTEGER,
  total_turns INTEGER,

  -- Result
  status TEXT NOT NULL,             -- 'success', 'failure', 'cancelled', 'timeout'
  failure_reason TEXT,
  failure_detail TEXT,

  -- Cost
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  cost_usd NUMERIC(10, 6) DEFAULT 0,

  -- Output
  branch_name TEXT,
  pr_url TEXT,
  files_changed INTEGER DEFAULT 0,
  lines_added INTEGER DEFAULT 0,
  lines_removed INTEGER DEFAULT 0,

  -- Context at time of execution
  context_snapshot JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attempts_node ON execution_attempts(node_id, attempt_number);
CREATE INDEX idx_attempts_project ON execution_attempts(project_id, created_at);
CREATE INDEX idx_attempts_provider ON execution_attempts(provider_id, model, created_at);
CREATE INDEX idx_attempts_machine ON execution_attempts(machine_id, created_at);

-- Turn-level timing (one row per AI turn per attempt)
CREATE TABLE turn_timings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES execution_attempts(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,

  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  total_ms INTEGER NOT NULL,

  -- Decomposition
  thinking_ms INTEGER,
  tool_execution_ms INTEGER,
  tool_wait_ms INTEGER,

  -- Tokens
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_hit_tokens INTEGER DEFAULT 0,

  -- Tools
  tool_calls INTEGER DEFAULT 0,
  tool_names TEXT[],

  -- Cost
  cost_usd NUMERIC(10, 6) DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_turns_attempt ON turn_timings(attempt_id, turn_index);

-- Task performance summary (materialized, one row per node)
CREATE TABLE task_performance (
  node_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),

  total_attempts INTEGER DEFAULT 0,
  successful_attempt INTEGER,         -- which attempt number succeeded

  first_dispatched_at TIMESTAMPTZ,
  final_completed_at TIMESTAMPTZ,
  total_elapsed_ms BIGINT,

  -- Time decomposition
  total_ai_execution_ms BIGINT DEFAULT 0,
  total_human_review_ms BIGINT DEFAULT 0,
  total_compute_wait_ms BIGINT DEFAULT 0,
  total_retry_gap_ms BIGINT DEFAULT 0,
  total_wasted_ms BIGINT DEFAULT 0,

  -- Cost
  total_cost_usd NUMERIC(10, 4) DEFAULT 0,
  wasted_cost_usd NUMERIC(10, 4) DEFAULT 0,
  effective_cost_usd NUMERIC(10, 4) DEFAULT 0,

  -- Efficiency
  first_attempt_success BOOLEAN,
  cost_efficiency NUMERIC(5, 4),       -- effective / total
  human_bottleneck_ratio NUMERIC(5, 4),-- human_review / total_elapsed

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, project_id)
);

-- Agent performance daily rollup
CREATE TABLE agent_performance_daily (
  user_id UUID NOT NULL REFERENCES auth.users(id),
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  machine_id TEXT,
  date DATE NOT NULL,

  tasks_attempted INTEGER DEFAULT 0,
  tasks_succeeded INTEGER DEFAULT 0,
  first_attempt_successes INTEGER DEFAULT 0,
  total_attempts INTEGER DEFAULT 0,

  median_execution_ms INTEGER,
  p95_execution_ms INTEGER,
  median_turns INTEGER,
  median_cost_usd NUMERIC(10, 4),
  total_cost_usd NUMERIC(10, 4) DEFAULT 0,

  -- By task estimate
  by_estimate JSONB,                   -- { "S": { count, medianMs, successRate }, ... }
  by_task_type JSONB,                  -- { "bug-fix": { count, medianMs, successRate }, ... }

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider_id, model, date)
);

-- Human review timing (tracks the gap between task completion and human decision)
CREATE TABLE human_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  attempt_id UUID REFERENCES execution_attempts(id),

  event_type TEXT NOT NULL,           -- 'judgment', 'approval', 'steer_response'
  presented_at TIMESTAMPTZ NOT NULL,  -- when the item appeared in attention queue
  responded_at TIMESTAMPTZ,           -- when the human acted
  response_time_ms BIGINT,            -- responded_at - presented_at
  decision TEXT,                       -- 'approved', 'rejected', 'retry', etc.
  feedback TEXT,                       -- human feedback text (if provided)

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_human_review_node ON human_review_events(node_id);
CREATE INDEX idx_human_review_user ON human_review_events(user_id, created_at);
```

### 5.2 Local Mode (IndexedDB)

IndexedDB stores: `astro-execution-attempts`, `astro-turn-timings`, `astro-task-performance`.

Rollups computed client-side on demand (no materialized views in IndexedDB).

---

## 6. Data Collection Points

### 6.1 Where Timing Data Is Captured

```
Agent Runner                          Backend                      Frontend
     │                                    │                            │
     │ task.dispatch received              │                            │
     │ ├─ record dispatchedAt             │                            │
     │ ├─ workspace prep start            │                            │
     │ │   └─ workspace prep end          │                            │
     │ │       record workspacePrepMs     │                            │
     │ ├─ AI execution start              │                            │
     │ │   ├─ Turn 0 start               │                            │
     │ │   │   ├─ thinking...             │                            │
     │ │   │   ├─ tool call start         │                            │
     │ │   │   │   └─ tool call end       │                            │
     │ │   │   └─ Turn 0 end             │                            │
     │ │   │       send task.turn_timing ─┼───► store TurnTiming       │
     │ │   │                              │     SSE: turn_timing ──────┼─► live display
     │ │   ├─ Turn 1 start               │                            │
     │ │   │   └─ ...                     │                            │
     │ │   └─ AI execution end            │                            │
     │ │       record aiExecutionMs       │                            │
     │ ├─ post-execution start            │                            │
     │ │   └─ PR creation, cleanup        │                            │
     │ │       record postExecutionMs     │                            │
     │ └─ task.result ───────────────────►│                            │
     │     includes full timing breakdown │                            │
     │                                    │ create ExecutionAttempt     │
     │                                    │ update TaskPerformance      │
     │                                    │ SSE: attempt_complete ──────┼─► update UI
     │                                    │                            │
     │                                    │ [if awaiting_judgment]      │
     │                                    │ record presented_at ────────┼─► attention queue
     │                                    │                            │
     │                                    │ [human responds]           │
     │                                    │ ◄─────────────────────────┼── user action
     │                                    │ record responded_at        │
     │                                    │ compute response_time_ms   │
     │                                    │ store HumanReviewEvent     │
```

### 6.2 New WebSocket Message

```typescript
interface TaskTurnTiming {
  type: 'task.turn_timing'
  taskId: string
  turnIndex: number
  startTime: string              // ISO timestamp
  endTime: string
  totalMs: number
  thinkingMs: number
  toolExecutionMs: number
  inputTokens: number
  outputTokens: number
  cacheHitTokens: number
  toolCalls: number
  toolNames: string[]
  costUsd: number
}
```

### 6.3 Enhanced Task Result

Extend the existing `task.result` message:

```typescript
interface EnhancedTaskResult extends TaskResult {
  timing: {
    dispatchedAt: string
    startedAt: string
    completedAt: string
    workspacePrepMs: number
    aiExecutionMs: number
    postExecutionMs: number
    totalTurns: number
  }
  contextSnapshot: AgentContextSnapshot
  attemptNumber: number
}
```

---

## 7. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/performance/task/:nodeId` | Task performance (all attempts, time decomposition) |
| GET | `/api/performance/project/:id` | Project performance summary (time breakdown, agent comparison) |
| GET | `/api/performance/project/:id/timeline` | Time series of execution performance over project lifetime |
| GET | `/api/performance/agent` | Agent performance profiles (filterable by provider, model, machine) |
| GET | `/api/performance/agent/compare` | Compare agents on same task type |
| GET | `/api/performance/agent/learning` | Learning effectiveness scores |
| GET | `/api/performance/attempt/:id/turns` | Turn-level timing for a specific attempt |
| GET | `/api/performance/human-review` | Human review timing analytics |

---

## 8. Frontend Components

### 8.1 Task Performance Panel (task-detail enhancement)

```
┌─ Performance ── Task: Fix auth middleware ────────────┐
│                                                       │
│  Total time: 5h 14m (dispatched → approved)           │
│                                                       │
│  ┌─ Timeline ──────────────────────────────────────┐  │
│  │ Attempt 1   ███░░░░░░░  3m 22s  FAILED          │  │
│  │ Human       ░░░░░░░░░░░░░░░░░░░  4h 8m          │  │
│  │ Attempt 2   ██░░░░░░░░  1m 48s  SUCCESS          │  │
│  │ Review      ░░░░░░      20m                       │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  Time breakdown:                                      │
│  AI execution:    5m 10s  (1.6%)                      │
│  Human review:    4h 28m  (85.5%)  ← bottleneck       │
│  Retry gap:       0s      (0%)                        │
│  Other:           46m     (12.9%)                     │
│                                                       │
│  Attempt 1 → 2 improvement:                           │
│  Time:  3m 22s → 1m 48s  (↓47%)                      │
│  Cost:  $2.10 → $1.20    (↓43%)                      │
│  Turns: 8 → 4            (↓50%)                       │
│  Context added: human feedback on token refresh       │
│                                                       │
│  Turn-by-turn (Attempt 2):                            │
│  ┌─────┬────────┬─────────┬────────┬────────┐        │
│  │Turn │ Time   │ Tokens  │ Tools  │ Cost   │        │
│  ├─────┼────────┼─────────┼────────┼────────┤        │
│  │  0  │  1.8s  │  12,400 │ Read×3 │ $0.15  │        │
│  │  1  │  3.2s  │  24,100 │ Write  │ $0.42  │        │
│  │  2  │  6.1s  │  38,500 │ Bash   │ $0.63  │        │
│  └─────┴────────┴─────────┴────────┴────────┘        │
└───────────────────────────────────────────────────────┘
```

### 8.2 Project Insights Dashboard

Organized around the five durable insight categories, with transient model data in a collapsible section:

```
┌─ Project Insights: API Rewrite ──────────────────────┐
│                                                       │
│  ── Your Bottlenecks ──────────────────────────────   │
│  Time Breakdown (all tasks):                          │
│  ██████████████████████████░░░░░░░░░░                │
│  AI 62%    Human 26%    Compute 8%    Other 4%       │
│                                                       │
│  You spent 5.8h reviewing tasks this week.            │
│  89% of approvals were approved → auto-approve?       │
│  Estimated time saved: 3.5h/week                      │
│                                                       │
│  ── Task Specification Quality ────────────────────   │
│  Tasks with acceptance criteria: 72% first-try success│
│  Tasks without: 41% first-try success                 │
│  → Adding criteria saves ~$3.60/task in retries       │
│                                                       │
│  ── Codebase Difficulty ───────────────────────────   │
│  Hard spots: server/lib/dispatch/ (2.5×), auth/ (2.2×)│
│  Easy spots: src/components/ui/ (0.5×)                │
│  → Consider better test fixtures for auth module      │
│                                                       │
│  ── Context ROI ───────────────────────────────────   │
│  CLAUDE.md grew 200 → 1,400 words over 3 weeks       │
│  Success rate: 72% → 88% (+22%)                       │
│  Cost per task: $3.20 → $1.90 (↓41%)                 │
│  Most impactful addition: auth token refresh patterns │
│                                                       │
│  ── Automation Opportunities ──────────────────────   │
│  • Auto-approve PRs in src/components/ (saves 35m/wk) │
│  • Auto-retry on first test_failure (saves 18m/wk)    │
│  • Switch 8 tasks to auto-verify (saves 43m/wk)       │
│                                                       │
│  ▸ Model Comparison (transient — valid until next     │
│    model release)                                     │
│  ┌──────────────┬────────┬────────┬────────┐         │
│  │ Agent        │ Speed  │ Cost   │ Success│         │
│  ├──────────────┼────────┼────────┼────────┤         │
│  │ sonnet/laptop│ 2m 15s │ $1.80  │ 87%    │         │
│  │ opus/laptop  │ 3m 40s │ $8.20  │ 94%    │         │
│  └──────────────┴────────┴────────┴────────┘         │
└───────────────────────────────────────────────────────┘
```

---

## 9. Integration with Cost Tracking and Attention Triage

### With Cost Tracking (COST_TRACKING.md)
- `ExecutionAttempt.costUsd` feeds into cost records
- `TaskPerformance.wastedCostUsd` enables "cost of retries" analysis
- Turn-level timing enables precise cost-per-turn attribution
- Learning effectiveness score correlates context investment with cost reduction

### With Attention Triage (ATTENTION_TRIAGE.md)
- `human_review_events` table measures human response latency
- `humanBottleneckRatio` identifies tasks where human review is the slowest stage
- Attention analytics can suggest: "You always approve these — enable auto-verification"
- Agent stuck detection uses turn timing patterns (same tool, same error, increasing turn times)

---

## 10. Implementation Phases

### Phase 1: Execution Attempt History
- Create `execution_attempts` table
- Modify dispatch engine to create attempt records (not overwrite)
- Expose attempt history in task detail UI
- Store basic timing (dispatchedAt, startedAt, completedAt)

### Phase 2: Turn-Level Timing
- Add `task.turn_timing` WebSocket message to agent runner
- Create `turn_timings` table
- Display turn-by-turn breakdown in task detail
- Time decomposition (thinking vs tool execution)

### Phase 3: Task Performance Aggregation
- Create `task_performance` materialized table
- Compute time decomposition across attempts
- Add human review event tracking
- Display task performance panel in UI

### Phase 4: Agent Comparison and Learning
- Create `agent_performance_daily` rollup
- Build agent comparison queries and API endpoints
- Learning effectiveness score computation
- Project performance dashboard

### Phase 5: Context Tracking and Recommendations
- Capture `AgentContextSnapshot` per attempt
- Correlate context changes with performance changes
- Generate suggestions (auto-verify, model selection, context improvements)
- Display learning curves and trend analysis
