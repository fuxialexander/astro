# Realtime Sync

Collaborative multi-device sync system built on Supabase Realtime.

## Overview

The realtime sync system enables automatic synchronization of data across multiple devices for the same user. When a user makes changes on one device, those changes automatically appear on their other devices in real-time via Supabase's PostgreSQL change data capture (CDC) over WebSockets.

**Components:**
1. **Supabase Realtime** - PostgreSQL CDC via WebSockets
2. **`src/lib/realtime-sync.ts`** - Client-side subscription management
3. **`src/stores/auth-store.ts`** - Lifecycle management (setup on auth, teardown on signout)
4. **Zustand stores** - Local state with optimistic updates

**Data Flow:**
```
User Action (Device A) → Zustand Store (optimistic) → API Call →
PostgreSQL Write → Supabase Realtime CDC → WebSocket → realtime-sync.ts →
Zustand Store Update (Device B) → React Re-render
```

**Latency:** ~120-450ms end-to-end from action to cross-device update.

## Subscribed Tables

| Table | Events | Scope | Notes |
|-------|--------|-------|-------|
| `projects` | INSERT, UPDATE, DELETE | Own + shared projects | Full project sync |
| `plan_nodes` | INSERT, UPDATE, DELETE | Accessible projects | Task/milestone sync |
| `plan_edges` | INSERT, UPDATE, DELETE | Accessible projects | Graph edge sync |
| `user_profiles` | INSERT, UPDATE | Own profile only | User settings |
| `display_settings` | INSERT, UPDATE | Per-user per-view | UI preferences |
| `task_chat_sessions` | INSERT, UPDATE, DELETE | Own sessions | Chat metadata |
| `task_chat_messages` | INSERT, UPDATE | Own sessions | Chat messages (WIP) |

### Conflict Resolution

All tables use **last-write-wins** (no operational transform yet). Concurrent edits of the same field will overwrite each other.

## Implementation Details

### Preventing Infinite Loops

The system uses direct `setState()` instead of calling store action methods to avoid triggering API calls when receiving updates from the API:

```typescript
// Good: direct state update (no API call)
case 'UPDATE':
  const project = mapProject(payload.new)
  const store = useProjectStore.getState()
  const updated = store.projects.map(p => p.id === project.id ? project : p)
  useProjectStore.setState({ projects: updated })
```

### Deduplication

Checks for existing records before adding new ones to prevent duplicates from optimistic updates:

```typescript
case 'INSERT':
  const node = mapNode(payload.new)
  const store = usePlanStore.getState()
  if (!store.nodes.some(n => n.id === node.id)) {
    store.nodes.push(node)
    usePlanStore.setState({ nodes: [...store.nodes] })
  }
```

### Client ID Tracking

A unique client ID is generated per page load. Supabase Realtime doesn't support filtering by client ID, so all clients receive all events (including their own). Deduplication handles this.

### Field Mapping

Database uses `snake_case`, frontend uses `camelCase`. The `mapNode()`, `mapProject()`, etc. functions handle conversion. Plan nodes use `client_id` in DB mapped to `id` in frontend.

## Lifecycle

### Setup (on authentication)
1. User signs in via WebAuthn/passkey
2. `auth-store.initialize()` detects authenticated session
3. Calls `setupRealtimeSync()`
4. Creates 7 Supabase channels (one per table)
5. Handlers registered for INSERT/UPDATE/DELETE events

### Teardown (on signout)
1. `auth-store.signOut()` calls `teardownRealtimeSync()`
2. Removes all active channels via `supabase.removeChannel()`
3. Clears state and sets `realtimeSyncEnabled = false`

### Local Mode
Automatically disabled when running in local mode (PGlite, no Supabase):
```typescript
if (!shouldUseSupabase()) {
  return  // No-op in local mode
}
```

### Reconnection
Supabase Realtime handles reconnection automatically with exponential backoff. Events missed during disconnect are NOT replayed.

## Configuration

### Environment Variables
```bash
VITE_SUPABASE_URL=...       # Supabase project URL
VITE_SUPABASE_ANON_KEY=...  # Public anon key (RLS enforced)
VITE_ASTRO_LOCAL_MODE=true # Set to disable realtime sync
```

### Database Setup
Tables must be in the `supabase_realtime` publication:
```sql
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
-- Expected: initiatives, projects, plan_nodes, plan_edges, task_executions,
--           registered_machines, user_profiles, display_settings,
--           task_chat_sessions, task_chat_messages
```

## Quick Reference

### Check Sync Status
```typescript
import { isRealtimeSyncEnabled, getClientId } from '@/lib/realtime-sync'
console.log('Sync enabled:', isRealtimeSyncEnabled())
console.log('Client ID:', getClientId())
```

### Subscription Status (browser console)
```
[realtime-sync] projects subscription status: SUBSCRIBED
[realtime-sync] plan_nodes subscription status: SUBSCRIBED
...
```

Statuses: `SUBSCRIBED` (ok), `TIMED_OUT` (network issue), `CLOSED` (auth issue), `CHANNEL_ERROR` (error)

## Performance

| Metric | Value |
|--------|-------|
| Idle bandwidth | ~1-2 KB/s (heartbeats) |
| Active editing | ~5-10 KB/s |
| Per-event size | ~200-500 bytes |
| Memory overhead | ~100 KB (7 subscriptions) |
| Per-event CPU | ~5-10 ms (imperceptible) |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| No updates appearing | Sync not enabled | Check env vars, ensure not in local mode |
| Duplicate updates | Client receives own events | Deduplication should handle; check handler code |
| Stale data after reconnect | Missed events not replayed | Refresh page or call `store.load()` |
| High bandwidth | Channel leak | Call `teardownRealtimeSync()` before re-setup |

## Limitations & Future Work

**Current limitations:**
1. Last-write-wins conflict resolution
2. No client ID filtering (all clients get all events)
3. Chat message session lookup not implemented
4. No event replay after disconnect

**Planned improvements:**
- Operational Transform for text fields
- Presence tracking (who's online)
- Conflict resolution UI
- Selective sync (only active projects)

## Security

All subscriptions respect Row-Level Security (RLS). Users can only see their own data plus shared projects. Subscriptions use the same JWT token as API calls.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/realtime-sync.ts` | Core subscription implementation |
| `src/stores/auth-store.ts` | Lifecycle management |
| `supabase/migrations/00000000000000_initial_schema.sql` | DB publication setup |
