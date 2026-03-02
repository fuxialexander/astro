# Workflow Engine: Internal Workflow System Design

## Current Workflow Capabilities

### What Astro Has Today

1. **Plan Graphs** — DAG-based task organization with dependencies
2. **Templates** — Parameterized project blueprints that generate plan graphs
3. **Dispatch Engine** — Task queue → provider selection → execution → result routing
4. **Event Hooks** — Post-execution actions (PR creation, merge queue, git pull, etc.)
5. **Skills** — Domain-specific instructions injected into agent prompts
6. **Approval System** — Human-in-the-loop gates for strategic decisions

### What's Missing for True Workflows

1. **Conditional branching** — "If task A output contains X, run task B; else run task C"
2. **Loops/iteration** — "Repeat until quality threshold met"
3. **Scheduled triggers** — "Run this plan every Monday at 9am"
4. **Webhook triggers** — "When GitHub issue opened, create and run a plan"
5. **Workflow versioning** — "Pin this exact plan + prompts + model to v1.2.3"
6. **Composability** — "This workflow calls another workflow as a step"

## Proposed Workflow System

### Design Principles

1. **Graph-First** — Workflows ARE plan graphs, not a separate concept
2. **Template-Driven** — Workflows are templates with trigger conditions
3. **Event-Reactive** — Workflows respond to events (webhooks, schedules, completions)
4. **Skills-Enhanced** — Skills provide domain knowledge; workflows provide orchestration
5. **Agent-Executed** — Tasks still run on agent runners, not server-side

### Workflow = Template + Trigger + State Machine

```typescript
interface Workflow {
  id: string;
  name: string;
  version: string;

  // The template that generates the plan graph
  templateId: string;
  templateParameters: Record<string, unknown>;

  // When to trigger
  triggers: WorkflowTrigger[];

  // State machine for conditional logic
  transitions: WorkflowTransition[];

  // Execution settings
  execution: {
    maxConcurrentRuns: number;
    retryPolicy: RetryPolicy;
    timeout: number;
    autoDispatch: boolean;
  };
}

type WorkflowTrigger =
  | { type: 'manual' }
  | { type: 'schedule'; cron: string }
  | { type: 'webhook'; source: 'github' | 'slack' | 'custom'; event: string }
  | { type: 'event'; eventType: string; filter: Record<string, unknown> }
  | { type: 'completion'; workflowId: string; status: string }

interface WorkflowTransition {
  from: string;           // Task/node ID
  to: string;             // Next task/node ID
  condition: {
    type: 'output-contains' | 'exit-code' | 'approval' | 'always';
    value?: unknown;
  };
}
```

### Example: Automated Paper Review Workflow

```typescript
const reviewWorkflow: Workflow = {
  id: 'auto-paper-review',
  name: 'Automated Paper Review Pipeline',
  version: '1.0.0',
  templateId: 'astro/paper-review',

  triggers: [
    { type: 'webhook', source: 'custom', event: 'paper.submitted' },
    { type: 'manual' },
  ],

  transitions: [
    // If paper has code, run reproducibility check
    {
      from: 'technical-check',
      to: 'reproducibility-check',
      condition: { type: 'output-contains', value: 'github.com' },
    },
    // If review is "reject", run detailed critique
    {
      from: 'overall-assessment',
      to: 'detailed-critique',
      condition: { type: 'output-contains', value: 'reject' },
    },
  ],

  execution: {
    maxConcurrentRuns: 5,
    retryPolicy: { maxRetries: 2, backoffMs: 5000 },
    timeout: 3600000, // 1 hour
    autoDispatch: true,
  },
}
```

### Example: CI/CD Pipeline Workflow

```typescript
const ciWorkflow: Workflow = {
  id: 'ci-pipeline',
  name: 'AI-Assisted CI Pipeline',
  version: '1.0.0',
  templateId: 'astro/code-review',

  triggers: [
    { type: 'webhook', source: 'github', event: 'pull_request.opened' },
    { type: 'webhook', source: 'github', event: 'pull_request.synchronize' },
  ],

  transitions: [
    // Run security check after code review
    { from: 'code-review', to: 'security-check', condition: { type: 'always' } },
    // If security issues found, create fix task
    {
      from: 'security-check',
      to: 'auto-fix',
      condition: { type: 'output-contains', value: 'VULNERABILITY' },
    },
  ],

  execution: {
    maxConcurrentRuns: 10,
    autoDispatch: true,
  },
}
```

## Implementation Phases

### Phase 1: Workflow Triggers (Week 1-3)

Add trigger support to the existing dispatch engine:

```typescript
// server/lib/workflow/trigger-manager.ts
class TriggerManager {
  // Register cron triggers
  registerSchedule(workflowId: string, cron: string): void

  // Handle incoming webhooks
  handleWebhook(source: string, event: string, payload: unknown): void

  // Listen for internal events
  handleEvent(eventType: string, data: unknown): void
}
```

Integration points:
- `server/routes/workflows.ts` — CRUD for workflow definitions
- `server/plugins/channel-github/` — GitHub webhook → workflow trigger
- `server/lib/events/` — Internal event → workflow trigger

### Phase 2: Conditional Transitions (Week 3-5)

Add conditional logic to the dispatch engine:

```typescript
// After task completion, evaluate transitions
async function evaluateTransitions(
  workflow: Workflow,
  completedTask: PlanNode,
  result: TaskResult
): Promise<string[]> {
  const nextTaskIds: string[] = [];

  for (const transition of workflow.transitions) {
    if (transition.from !== completedTask.id) continue;

    const matches = evaluateCondition(transition.condition, result);
    if (matches) {
      nextTaskIds.push(transition.to);
    }
  }

  return nextTaskIds;
}
```

### Phase 3: Workflow Versioning (Week 5-7)

Pin exact configuration for reproducibility:

```typescript
interface WorkflowVersion {
  workflowId: string;
  version: string;
  template: UseCaseTemplate;     // Frozen template
  skills: SkillSnapshot[];       // Frozen skill contents
  model: string;                 // Frozen model ID
  promptHash: string;            // Hash of all prompts
  createdAt: string;
}
```

### Phase 4: Workflow Composability (Week 7-9)

Allow workflows to call other workflows:

```typescript
interface CompositeStep {
  type: 'workflow';
  workflowId: string;
  parameters: Record<string, unknown>;
  waitForCompletion: boolean;
}
```

## Relationship Between Skills, Templates, and Workflows

```
Skills (HOW to do something)
  ↓ referenced by
Templates (WHAT to create — project blueprint)
  ↓ used by
Workflows (WHEN to run — triggers + orchestration)
  ↓ executed by
Agent Runners (WHERE to run — compute backends)
```

**Skills** teach agents domain knowledge (K8s commands, legal writing style)
**Templates** define project structure (parameters → plan graph)
**Workflows** add automation (triggers, conditions, scheduling)
**Agent Runners** provide compute (local, SSH, K8s, SLURM, cloud)

## Comparison with FAI Workflows

| Feature | FAI (LangGraph) | Astro Workflows |
|---------|-----------------|-----------------|
| Graph definition | Fixed in code | AI-generated from templates |
| Node execution | Server-side LLM calls | Distributed agent runners |
| Conditional routing | Hardcoded `if/else` | Output-based transitions |
| Triggers | REST API only | Webhooks, schedules, events |
| Versioning | YAML config per version | Full snapshot (template + skills + model) |
| Batch processing | Semaphore concurrency | Task-level parallelism |
| Reproducibility | Strong (frozen versions) | Strong (version snapshots) |
| Adaptability | None (fixed graph) | Full (agents modify plan) |

## Priority

| Component | Priority | Effort | Impact |
|-----------|----------|--------|--------|
| Manual workflow trigger | **High** | 1 week | Foundation |
| Webhook triggers (GitHub) | **High** | 1 week | Automation |
| Conditional transitions | **Medium** | 2 weeks | Intelligence |
| Schedule triggers | **Medium** | 1 week | Automation |
| Workflow versioning | **Medium** | 2 weeks | Enterprise |
| Composability | **Low** | 2 weeks | Advanced |
