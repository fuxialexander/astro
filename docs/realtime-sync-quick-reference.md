# Realtime Sync Quick Reference

## Table Subscriptions

| Table | Events | Scope | Notes |
|-------|--------|-------|-------|
| `projects` | INSERT, UPDATE, DELETE | Own + shared projects | Full project sync |
| `plan_nodes` | INSERT, UPDATE, DELETE | Accessible projects | Task/milestone sync |
| `plan_edges` | INSERT, UPDATE, DELETE | Accessible projects | Graph edge sync |
| `user_profiles` | INSERT, UPDATE | Own profile only | User settings |
| `display_settings` | INSERT, UPDATE | Per-user per-view | UI preferences |
| `task_chat_sessions` | INSERT, UPDATE, DELETE | Own sessions | Chat metadata |
| `task_chat_messages` | INSERT, UPDATE | Own sessions | Chat messages (WIP) |

## Event Flow

```
User Action → Store Update → IndexedDB → API → PostgreSQL → CDC → WebSocket → Other Devices
   (0ms)         (instant)      (5ms)    (50ms)  (10ms)    (50ms)   (50ms)     (200ms)
```

**Total latency**: ~120-450ms from action to cross-device update.

## Code Snippets

### Check if Sync is Enabled

```typescript
import { isRealtimeSyncEnabled } from '@/lib/realtime-sync'

if (isRealtimeSyncEnabled()) {
  console.log('Realtime sync is active')
}
```

### Manual Setup/Teardown

```typescript
import { setupRealtimeSync, teardownRealtimeSync } from '@/lib/realtime-sync'

// Setup (normally done by auth-store)
setupRealtimeSync()

// Teardown
await teardownRealtimeSync()
```

### Debug Client ID

```typescript
import { getClientId } from '@/lib/realtime-sync'

console.log('Client ID:', getClientId())
// Output: client-1707999123456-a1b2c3
```

## Subscription Status

Open browser console and look for:

```
[realtime-sync] Setting up subscriptions...
[realtime-sync] projects subscription status: SUBSCRIBED
[realtime-sync] plan_nodes subscription status: SUBSCRIBED
[realtime-sync] plan_edges subscription status: SUBSCRIBED
[realtime-sync] user_profiles subscription status: SUBSCRIBED
[realtime-sync] display_settings subscription status: SUBSCRIBED
[realtime-sync] task_chat_sessions subscription status: SUBSCRIBED
[realtime-sync] task_chat_messages subscription status: SUBSCRIBED
[realtime-sync] 7 subscriptions active
```

### Possible Statuses

- ✅ `SUBSCRIBED` - Working correctly
- ⏳ `TIMED_OUT` - Connection issue (check network)
- 🔴 `CLOSED` - Channel closed (check auth)
- ⚠️ `CHANNEL_ERROR` - Error occurred (check logs)

## Database Setup

### Check Publication

```sql
-- List tables in supabase_realtime publication
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime';
```

**Expected output**:
```
initiatives
projects
plan_nodes
plan_edges
task_executions
registered_machines
user_profiles
display_settings
task_chat_sessions
task_chat_messages
```

### Add Missing Table

```sql
-- If a table is missing from the publication
alter publication supabase_realtime add table <table_name>;
```

## Troubleshooting

### Problem: No updates appearing

**Diagnosis**:
```typescript
// Check if sync is enabled
console.log('Sync enabled:', isRealtimeSyncEnabled())

// Check Supabase mode
import { shouldUseSupabase } from '@/lib/supabase-client'
console.log('Supabase mode:', shouldUseSupabase())
```

**Fixes**:
1. Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set
2. Ensure `VITE_USE_INDEXEDDB_ONLY` is NOT set to `true`
3. Check browser console for subscription status
4. Verify table is in `supabase_realtime` publication

### Problem: Duplicate updates

**Cause**: Client receives own events back from server.

**Expected behavior**: Deduplication logic prevents duplicates. If you see duplicates, check:

```typescript
// In store subscription handler
if (!store.nodes.some(n => n.id === node.id)) {
  // Only add if not already present
  // ← This check should prevent duplicates
}
```

### Problem: Stale data after reconnect

**Cause**: Events missed during disconnect are not replayed.

**Workaround**:
```typescript
// Manually refetch data
await useProjectStore.getState().load()
await usePlanStore.getState().load()
await useUserProfileStore.getState().load()
await useDisplaySettingsStore.getState().load()
await useTaskChatStore.getState().load()
```

### Problem: High bandwidth usage

**Diagnosis**: Check number of active subscriptions.

```typescript
// In realtime-sync.ts
console.log('Active channels:', activeChannels.length)
```

**Expected**: 7 channels (one per table).

**Fix**: If more than 7, there's a leak. Call `teardownRealtimeSync()` before setting up new subscriptions.

## Environment Variables

```bash
# Required for realtime sync
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...

# Disable realtime sync (IndexedDB-only mode)
VITE_USE_INDEXEDDB_ONLY=true
```

## Performance Metrics

### Bandwidth (per event)

- Small update (status change): ~200 bytes
- Medium update (task creation): ~500 bytes
- Large update (vision doc): ~2-5 KB

### Idle Bandwidth

- Heartbeat pings: ~1-2 KB/s (7 subscriptions)
- Compression: ~30% savings (gzip)

### Memory

- Per subscription: ~15 KB
- Total (7 subscriptions): ~100 KB

### CPU

- Per event processing: ~5-10 ms
- React re-render: ~1-5 ms
- Total: ~10-15 ms (imperceptible)

## Security

### RLS Policies

All subscriptions respect Row-Level Security (RLS):

- Users can only see their own data
- Shared projects visible to members
- Service role bypasses RLS (backend only)

### Authentication

Subscriptions use the same JWT token as API calls:

```typescript
const supabase = createClient(URL, ANON_KEY, {
  auth: {
    autoRefreshToken: true,  // ← Auto-refresh on expiry
    persistSession: true,    // ← Persist across page reloads
  },
})
```

Token is automatically included in WebSocket handshake.

## Debugging Commands

```typescript
// Enable verbose logging (add to realtime-sync.ts)
const supabase = getSupabase()
supabase.channel('debug').subscribe((status, err) => {
  console.log('Channel status:', status, err)
})

// Check active channels
console.log('Active channels:', supabase.getChannels())

// Check subscription count
console.log('Subscription count:', supabase.getChannels().length)

// Force reconnect
await supabase.removeAllChannels()
setupRealtimeSync()
```

## Related Files

| File | Purpose |
|------|---------|
| `src/lib/realtime-sync.ts` | Core implementation |
| `src/stores/auth-store.ts` | Lifecycle management |
| `REALTIME_SYNC.md` | Full documentation |
| `docs/realtime-sync-example.md` | Usage examples |
| `REALTIME_SYNC_IMPLEMENTATION.md` | Implementation summary |
| `supabase/migrations/00000000000002_enable_realtime_sync.sql` | Database setup |

---

**Last updated**: 2026-02-15
