# User Behavior Tracking

Activity logging, analytics, and observability for Astro.

## Overview

Astro tracks user behavior at three levels:
1. **Activity Events** - User-visible timeline (project updates, task completions)
2. **Observation Events** - LangSmith-compatible AI observability (traces, spans)
3. **Audit Logs** - Security and compliance audit trail

## Activity Events

### Table: `activity_events`

User-visible activity feed for projects.

**Schema:**
```typescript
{
  id: uuid
  userId: uuid
  projectId: uuid
  type: text              // Event type identifier
  title: text             // Human-readable title
  description: text       // Additional context
  nodeId: text            // Associated plan node (optional)
  metadata: jsonb         // Structured event data
  createdAt: timestamp
}
```

### Common Event Types

| Type | Title | Description | Metadata |
|------|-------|-------------|----------|
| `project.created` | "Project created" | User created a new project | `{ projectName }` |
| `task.dispatched` | "Task dispatched" | Task sent to agent | `{ nodeId, machineId }` |
| `task.completed` | "Task completed" | Task execution finished | `{ nodeId, status, duration }` |
| `approval.requested` | "Approval requested" | Agent asked for approval | `{ question, options }` |
| `approval.approved` | "Approval granted" | User approved request | `{ response }` |
| `branch.pruned` | "Branch pruned" | Cancelled task tree | `{ nodeIds[] }` |
| `pr.created` | "PR created" | GitHub PR opened | `{ prUrl, prNumber }` |

### Creating Activity Events

**Backend (automatic):**
```typescript
import { createActivityEvent } from '@/server/lib/events/activity-tracker'

await createActivityEvent({
  userId: user.id,
  projectId: project.id,
  type: 'task.completed',
  title: 'Task completed',
  description: `"${node.title}" finished successfully`,
  nodeId: node.id,
  metadata: { status: 'completed', duration: 120000 }
})
```

**Event Transport:**
Activity events are automatically:
1. Written to `activity_events` table
2. Broadcast via SSE to connected clients
3. Cached in IndexedDB for offline access

## Observation Events

### Table: `observation_events`

LangSmith-compatible observability for AI operations.

**Schema:**
```typescript
{
  id: text               // UUID
  traceId: text          // Trace identifier
  parentObservationId: text
  type: text             // 'trace' | 'span' | 'generation' | 'event'
  name: text
  startTime: timestamp
  endTime: timestamp
  input: jsonb
  output: jsonb
  model: text
  inputTokens: integer
  outputTokens: integer
  estimatedCostUsd: real
  level: text            // 'default' | 'debug' | 'warning' | 'error'
  metadata: jsonb
  projectId: uuid
  nodeId: text
  statusMessage: text
  createdAt: timestamp
}
```

### Observation Types

**Trace** - Top-level operation (e.g., plan generation session)
**Span** - Nested operation (e.g., tool call within session)
**Generation** - LLM API call with token counts
**Event** - Point-in-time event (e.g., approval requested)

### Creating Observations

```typescript
import { observability } from '@/server/lib/observability'

// Start trace
const trace = observability.trace({
  name: 'plan-generation',
  input: { projectId, description },
  metadata: { repository }
})

// Start span
const span = trace.span({
  name: 'repo-context-fetch',
  input: { repoUrl }
})

// Record generation
const gen = trace.generation({
  name: 'claude-plan',
  model: 'claude-3-5-sonnet-20241022',
  input: { prompt },
  output: { plan },
  inputTokens: 1500,
  outputTokens: 800,
  estimatedCostUsd: 0.015
})

// End span/trace
span.end({ output: { fileCount: 42 } })
trace.end({ output: { nodeCount: 12 } })
```

### LangSmith Integration

Observation events use LangSmith-compatible format. Export to LangSmith:

```bash
# Export observations to JSONL
psql $DATABASE_URL -c "
  COPY (
    SELECT jsonb_build_object(
      'id', id,
      'trace_id', trace_id,
      'type', type,
      'name', name,
      'start_time', start_time,
      'end_time', end_time,
      'inputs', input,
      'outputs', output,
      'metadata', metadata
    )
    FROM observation_events
    WHERE created_at > NOW() - INTERVAL '7 days'
  ) TO '/tmp/observations.jsonl'
"

# Import to LangSmith
langsmith dataset upload /tmp/observations.jsonl --name astro-observations
```

## Audit Logs

### Table: `audit_logs`

Security and compliance audit trail for sensitive operations.

**Schema:**
```typescript
{
  id: uuid
  userId: uuid
  action: text           // Action identifier
  resourceType: text     // Resource type
  resourceId: text       // Resource ID
  details: jsonb         // Non-sensitive context
  ipAddress: text
  userAgent: text
  createdAt: timestamp
}
```

### Common Audit Actions

| Action | Resource Type | Details |
|--------|---------------|---------|
| `account.create` | `account` | User signed up |
| `account.delete` | `account` | User deleted account |
| `api_key.create` | `api_key` | API key created |
| `api_key.revoke` | `api_key` | API key revoked |
| `machine.register` | `machine` | Agent runner registered |
| `machine.revoke` | `machine` | Agent runner revoked |
| `project.delete` | `project` | Project deleted |
| `member.add` | `project_member` | Project member added |
| `member.remove` | `project_member` | Project member removed |

### Creating Audit Logs

```typescript
import { auditLog } from '@/server/lib/audit'

await auditLog({
  userId: user.id,
  action: 'api_key.create',
  resourceType: 'api_key',
  resourceId: apiKey.id,
  details: { provider: 'anthropic', name: 'My API Key' },
  ipAddress: req.headers.get('x-forwarded-for'),
  userAgent: req.headers.get('user-agent')
})
```

### Audit Log Retention

- **Retention policy**: 90 days (configurable)
- **Archival**: Export to S3 for long-term storage
- **Access**: Only user can view their own logs (RLS policy)

## Usage Metrics

### Table: `usage_metrics`

Daily usage aggregation per user.

**Schema:**
```typescript
{
  userId: uuid
  sessionDate: date
  totalCostUsd: real
  totalInputTokens: integer
  totalOutputTokens: integer
  tasksCompleted: integer
  tasksFailed: integer
  updatedAt: timestamp
}
```

### Automatic Aggregation

Usage is automatically tracked on task completion:

```typescript
// After task execution
const metrics = {
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  estimatedCostUsd: result.estimatedCostUsd
}

// Upsert into usage_metrics (daily aggregate)
await db.insert(usageMetrics).values({
  userId: user.id,
  sessionDate: new Date().toISOString().split('T')[0],
  ...metrics
}).onConflictDoUpdate({
  target: [usageMetrics.userId, usageMetrics.sessionDate],
  set: {
    totalCostUsd: sql`${usageMetrics.totalCostUsd} + ${metrics.estimatedCostUsd}`,
    totalInputTokens: sql`${usageMetrics.totalInputTokens} + ${metrics.inputTokens}`,
    totalOutputTokens: sql`${usageMetrics.totalOutputTokens} + ${metrics.outputTokens}`,
    tasksCompleted: sql`${usageMetrics.tasksCompleted} + 1`
  }
})
```

### Querying Usage

```typescript
// Get weekly usage
const usage = await db.query.usageMetrics.findMany({
  where: and(
    eq(usageMetrics.userId, user.id),
    gte(usageMetrics.sessionDate, weekAgo)
  )
})

// Calculate totals
const totals = {
  cost: usage.reduce((sum, m) => sum + m.totalCostUsd, 0),
  inputTokens: usage.reduce((sum, m) => sum + m.totalInputTokens, 0),
  outputTokens: usage.reduce((sum, m) => sum + m.totalOutputTokens, 0),
  tasksCompleted: usage.reduce((sum, m) => sum + m.tasksCompleted, 0)
}
```

## Privacy & Compliance

### Data Minimization
- **PII**: Only store essential user data (name, email)
- **API Keys**: Stored encrypted, only last 4 chars visible
- **Logs**: No sensitive data in audit logs (use `details` for non-sensitive context)

### GDPR Compliance
- **Right to access**: Users can export all their data
- **Right to deletion**: Account deletion cascades to all user data
- **Data portability**: Export to JSON format

### Export User Data

```typescript
// Export all user data
const userData = {
  profile: await getUserProfile(userId),
  projects: await getUserProjects(userId),
  activityEvents: await getUserActivity(userId),
  auditLogs: await getUserAuditLogs(userId),
  usageMetrics: await getUserUsage(userId)
}

// Return as JSON
return new Response(JSON.stringify(userData, null, 2), {
  headers: {
    'Content-Type': 'application/json',
    'Content-Disposition': 'attachment; filename="astro-data-export.json"'
  }
})
```

## Related Documentation

- [Database Schema](./database-schema.md) - Table definitions
- [RLS Policies](./rls-policies.md) - Access control
- [Observability](../../OBSERVABILITY_AND_SAFETY.md) - Full observability guide
- [Activity Feed](../../ACTIVITY_FEED.md) - Activity feed implementation
