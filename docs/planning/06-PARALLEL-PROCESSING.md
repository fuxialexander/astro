# Parallel Processing Analysis

## Current Parallel Processing Capabilities

### What Already Works

1. **Plan Graph Parallelism**
   - Tasks without dependencies can run in parallel
   - The graph topology naturally expresses parallelism
   - Fan-out/fan-in patterns are supported
   - New: `detectParallelBranches()` in `graph-utils.ts` identifies parallel groups

2. **Input Parallelization (New)**
   - Templates can declare `inputParallelization` config
   - Multi-value parameters are split into parallel branches
   - Merge strategies: concatenate, aggregate, individual, merge-directories
   - Example: 3 arXiv URLs → 3 parallel paper-to-slides branches

3. **Multi-Machine Execution**
   - Agent runners on multiple machines connect via relay
   - Machine selector (round-robin, priority, least-loaded) routes tasks
   - Multiple tasks dispatch to different machines simultaneously

4. **Agent Runner Concurrency**
   - `maxConcurrentTasks` setting per runner (configurable)
   - Each task gets its own git worktree (no file conflicts)
   - Git worktree isolation enables true parallel execution

### What's the Current Limitation?

**Astro's parallelism is at the TASK level, not within tasks.**

Compare with FAI:
- FAI: Process 1000 scripts in parallel within ONE workflow (semaphore-controlled)
- Astro: Each "process 1 script" is a separate task → 1000 tasks in the plan graph

This means:
- Higher token overhead (each task starts fresh with full context)
- Plan graph becomes unwieldy with 1000+ nodes
- No semaphore/concurrency control within a batch

## Do We Need to Worry About Parallel Processing?

### Short Answer: Not yet for most use cases

For the current target use cases (petition letters, paper writing, paper reviews, code documentation), the task-level parallelism is sufficient:

| Use Case | Typical Parallel Branches | Task-Level Sufficient? |
|----------|--------------------------|------------------------|
| H-1B Petition | 6-8 sections in parallel | Yes |
| Paper Writing | 8-12 sections in parallel | Yes |
| Paper Review (multi-paper) | 3-10 papers in parallel | Yes |
| Code Documentation | 5-15 modules in parallel | Yes |
| ML Training | 1-4 experiments | Yes |

### When Parallel Processing Becomes Critical

Batch processing scenarios where FAI-style parallelism matters:

| Scenario | Scale | Needs Batch Parallelism? |
|----------|-------|--------------------------|
| Classify 1000 security alerts | 1000 items | Yes |
| Process 500 patient records | 500 items | Yes |
| Analyze 200 legal contracts | 200 items | Yes |
| Review 50 papers for conference | 50 items | Maybe (5 per machine × 10 machines) |

**Recommendation: Address batch parallelism in Q2-Q3 as an enterprise feature, not a blocker for launch.**

## Architecture for Future Batch Processing

If we need FAI-style batch processing, here's how to add it:

### Option A: Batch Task Type (Recommended)

Add a new task type that processes multiple items within a single agent session:

```typescript
interface BatchPlanNode extends PlanNode {
  batch: {
    items: unknown[];           // Array of items to process
    concurrency: number;        // Max parallel LLM calls
    itemSchema: JSONSchema;     // Schema for each item
    resultSchema: JSONSchema;   // Schema for each result
  };
}
```

The agent receives all items and processes them with internal concurrency control.

### Option B: Auto-Scaling Task Fanout

The dispatch engine automatically fans out a batch task into sub-tasks:

```typescript
// User creates 1 "Review 50 papers" task
// Dispatch engine creates 50 sub-tasks, dispatches to available machines
// Results aggregated back into parent task

interface FanoutConfig {
  maxConcurrency: number;       // Global concurrency limit
  perMachineLimit: number;      // Tasks per machine
  retryPolicy: RetryPolicy;
  aggregationStrategy: 'collect' | 'reduce' | 'stream';
}
```

### Option C: Skills-Based Batch Processing

A skill teaches the agent how to batch-process items:

```markdown
# SKILL.md: batch-processor

When processing multiple items:
1. Split input into chunks of 10
2. Process each chunk sequentially
3. Within each chunk, process items in parallel (up to 5 concurrent)
4. Aggregate results into a single output file
5. Include progress tracking (item X of Y)
```

## What's Already Handled Well

### Graph-Level Parallelism ✓
- The plan graph topology naturally expresses task dependencies
- Independent tasks can run simultaneously
- The dispatch engine handles this automatically

### Input Parallelization ✓
- Templates with `inputParallelization` config split multi-value parameters
- Each value becomes its own branch in the plan graph
- Merge tasks aggregate results

### Multi-Machine Distribution ✓
- Multiple agent runners handle tasks in parallel
- Machine selector balances load
- Tasks isolated via git worktrees

## Recommended Actions

1. **Now**: No changes needed — task-level parallelism is sufficient for current use cases
2. **Q2**: Add batch task type for enterprise scenarios requiring 100+ item processing
3. **Q3**: Add concurrency controls (per-project rate limiting, token budgets)
4. **Q4**: Add batch results aggregation and structured output storage
