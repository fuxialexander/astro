# Realtime Sync Example

This document shows a practical example of how the realtime sync system works across devices.

## Scenario: Creating a New Task

Alice is working on a project called "Website Redesign" and wants to create a new task. She has Astro open on both her laptop and her phone.

### Timeline

**T0: Initial State (Both Devices)**

Laptop and phone both show the project with 3 existing tasks:

```
Project: Website Redesign
├── Task 1: Design mockups (completed)
├── Task 2: Implement header (in_progress)
└── Task 3: Add footer (planned)
```

**T1: Alice clicks "Add Task" on Laptop**

1. Laptop creates a new task node in Zustand store (optimistic update)
2. Laptop saves to IndexedDB (offline cache)
3. Laptop makes POST request to `/api/data/nodes`
4. Backend inserts into `plan_nodes` table

```typescript
// Laptop: usePlanStore.addNode()
const newNode: PlanNode = {
  id: "task-123",
  projectId: "proj-1",
  title: "Add contact form",
  description: "Implement contact form with validation",
  status: "planned",
  // ... other fields
}
```

**T2: Database Insert (PostgreSQL)**

```sql
INSERT INTO plan_nodes (
  project_id,
  client_id,
  title,
  description,
  status,
  position_x,
  position_y,
  ...
) VALUES (
  'proj-1',
  'task-123',
  'Add contact form',
  'Implement contact form with validation',
  'planned',
  400,
  200,
  ...
);
```

**T3: Supabase Realtime CDC**

PostgreSQL triggers a change data capture event:

```json
{
  "type": "INSERT",
  "schema": "public",
  "table": "plan_nodes",
  "commit_timestamp": "2026-02-15T10:30:00Z",
  "new": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "proj-1",
    "client_id": "task-123",
    "title": "Add contact form",
    "description": "Implement contact form with validation",
    "status": "planned",
    "position_x": 400,
    "position_y": 200,
    ...
  }
}
```

**T4: WebSocket Event to All Clients**

Both laptop and phone receive the event via their active WebSocket subscriptions.

**T5: Laptop Processes Event**

```typescript
// realtime-sync.ts on Laptop
case 'INSERT':
  const node = mapNode(payload.new)  // Maps DB fields to frontend types
  const store = usePlanStore.getState()
  if (!store.nodes.some(n => n.id === node.id)) {
    // Already exists from optimistic update, skip
  }
```

Laptop skips the insert because it already has the node from the optimistic update at T1.

**T6: Phone Processes Event**

```typescript
// realtime-sync.ts on Phone
case 'INSERT':
  const node = mapNode(payload.new)  // Maps DB fields to frontend types
  const store = usePlanStore.getState()
  if (!store.nodes.some(n => n.id === node.id)) {
    // New node! Add it
    store.nodes.push(node)
    usePlanStore.setState({ nodes: [...store.nodes] })
  }
```

Phone adds the new node to its local store.

**T7: Phone React Re-render**

```
Project: Website Redesign
├── Task 1: Design mockups (completed)
├── Task 2: Implement header (in_progress)
├── Task 3: Add footer (planned)
└── Task 4: Add contact form (planned)  ← NEW!
```

The phone now displays the new task without any manual refresh!

## Field Mapping

The database schema uses snake_case columns, but the frontend uses camelCase. The `mapNode()` function handles this conversion:

```typescript
function mapNode(row: Record<string, unknown>): PlanNode {
  return {
    // Frontend uses client_id as the node id
    id: row.client_id as string,

    // Map snake_case to camelCase
    projectId: row.project_id as string,

    // Position is split into x/y in DB, combined in frontend
    position: {
      x: row.position_x as number,
      y: row.position_y as number,
    },

    // Convert timestamps to Date objects
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),

    // ... other fields
  } as PlanNode
}
```

## Error Handling

### Network Error During POST

If the POST request to `/api/data/nodes` fails:

1. Laptop keeps the optimistic update (task still visible)
2. Phone never receives the event (task not visible)
3. User sees error toast: "Failed to create task"
4. On page refresh, task disappears (not in DB)

**Future improvement**: Implement rollback of optimistic updates on error.

### WebSocket Disconnection

If the phone loses connection:

1. Supabase client automatically attempts reconnection
2. Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
3. On reconnect, subscription resumes
4. **Gap**: Events missed during disconnect are NOT replayed

**Workaround**: User can pull-to-refresh or call `store.load()` to refetch from API.

## Multi-Field Updates

When updating multiple fields of a task:

```typescript
// Alice updates task on laptop
updateNode("task-123", {
  status: "in_progress",
  description: "Updated description",
})
```

The backend performs a single UPDATE:

```sql
UPDATE plan_nodes
SET
  status = 'in_progress',
  description = 'Updated description',
  updated_at = NOW()
WHERE client_id = 'task-123';
```

Phone receives a single UPDATE event with all changed fields:

```json
{
  "type": "UPDATE",
  "old": { ... },
  "new": {
    "client_id": "task-123",
    "status": "in_progress",
    "description": "Updated description",
    "updated_at": "2026-02-15T10:35:00Z",
    ...
  }
}
```

## Concurrent Edits (Conflict)

**Scenario**: Alice edits the task description on her laptop while Bob (project collaborator) edits it on his desktop.

1. **T0**: Both start with `description: "Original description"`
2. **T1**: Alice types "Alice's version"
3. **T2**: Bob types "Bob's version"
4. **T3**: Alice saves (sends UPDATE)
5. **T4**: Bob saves (sends UPDATE)
6. **T5**: DB processes Alice's UPDATE → `description: "Alice's version"`
7. **T6**: DB processes Bob's UPDATE → `description: "Bob's version"` (overwrites Alice)

**Result**: Bob's version wins (last-write-wins).

**Future improvement**: Implement operational transform (OT) or conflict detection UI.

## Performance Characteristics

### Latency

Typical latency from action to cross-device update:

1. Optimistic update: **0 ms** (instant)
2. API request: **50-200 ms** (to Hono backend)
3. Database write: **5-10 ms** (PostgreSQL)
4. CDC event: **10-50 ms** (Supabase Realtime)
5. WebSocket delivery: **50-200 ms** (to other devices)

**Total**: ~120-450 ms from action to cross-device update.

### Bandwidth

Per-event overhead:

- WebSocket frame: ~50 bytes
- JSON payload: ~200-500 bytes (varies by table)
- Compression: ~30% savings (gzip)

**Example**: Creating a task sends ~350 bytes to each subscribed device.

## Code References

| File | Function | Purpose |
|------|----------|---------|
| `src/lib/realtime-sync.ts` | `subscribeToProjects()` | Subscribe to projects table |
| `src/lib/realtime-sync.ts` | `subscribeToPlanNodes()` | Subscribe to plan_nodes table |
| `src/lib/realtime-sync.ts` | `subscribeToPlanEdges()` | Subscribe to plan_edges table |
| `src/lib/realtime-sync.ts` | `setupRealtimeSync()` | Initialize all subscriptions |
| `src/lib/realtime-sync.ts` | `teardownRealtimeSync()` | Clean up subscriptions |
| `src/stores/auth-store.ts` | `initialize()` | Call setupRealtimeSync on auth |
| `src/stores/auth-store.ts` | `signOut()` | Call teardownRealtimeSync on signout |

---

**Last updated**: 2026-02-15
