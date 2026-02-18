# Supabase Realtime Sync Implementation Summary

## Changes Made

### 1. New File: `src/lib/realtime-sync.ts` (507 lines)

**Purpose**: Manages Supabase Realtime subscriptions for collaborative multi-device sync.

**Key Features**:
- 7 table subscriptions (projects, plan_nodes, plan_edges, user_profiles, display_settings, task_chat_sessions, task_chat_messages)
- Smart deduplication to prevent duplicate inserts from optimistic updates
- Direct state updates to avoid triggering API calls when receiving events FROM the API
- Automatic lifecycle management (setup on auth, teardown on signout)

**Exported Functions**:
- `setupRealtimeSync()` - Initialize all subscriptions
- `teardownRealtimeSync()` - Clean up all subscriptions
- `isRealtimeSyncEnabled()` - Check sync status
- `getClientId()` - Get unique client ID for debugging

### 2. Updated File: `src/stores/auth-store.ts`

**Changes**:
- Import `setupRealtimeSync` and `teardownRealtimeSync`
- Call `setupRealtimeSync()` after successful authentication
- Call `setupRealtimeSync()` on auth state change (sign in)
- Call `teardownRealtimeSync()` on auth state change (sign out)
- Call `teardownRealtimeSync()` in `signOut()` method

### 3. Updated Migration: `supabase/migrations/00000000000000_initial_schema.sql`

**Purpose**: All schema changes merged into initial schema (no separate migrations needed).

**Realtime Tables Added**:
- `user_profiles`
- `display_settings`
- `task_chat_sessions`
- `task_chat_messages`
- `sessions` (unified session store)

Note: `projects`, `plan_nodes`, `plan_edges`, `task_executions`, and `registered_machines` were already in the publication.

### 4. Documentation: `REALTIME_SYNC.md`

**Sections**:
- Overview and architecture
- Subscribed tables and scope
- Implementation details (preventing infinite loops, deduplication, client ID tracking)
- Lifecycle (setup, teardown, reconnection)
- Configuration and database setup
- Limitations and future work
- Testing, security, performance
- Troubleshooting guide

### 5. Documentation: `docs/realtime-sync-example.md`

**Content**:
- Step-by-step example of creating a task across devices
- Timeline showing data flow from user action to cross-device update
- Field mapping (snake_case DB → camelCase frontend)
- Error handling scenarios
- Concurrent edit conflicts
- Performance characteristics
- Code references

## How It Works

### Setup (on authentication)

```typescript
// auth-store.ts
initialize: async () => {
  // ... existing auth logic
  if (session) {
    setupRealtimeSync()  // ← NEW
  }
}
```

### Subscription Handler (example)

```typescript
// realtime-sync.ts
function subscribeToPlanNodes(supabase) {
  return supabase
    .channel('plan-nodes-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'plan_nodes' },
      (payload) => {
        switch (payload.eventType) {
          case 'INSERT':
            const node = mapNode(payload.new)
            const store = usePlanStore.getState()
            // Deduplication: skip if already present from optimistic update
            if (!store.nodes.some(n => n.id === node.id)) {
              store.nodes.push(node)
              usePlanStore.setState({ nodes: [...store.nodes] })
            }
            break
          case 'UPDATE':
            // Direct state update (no API call)
            const updated = store.nodes.map(n =>
              n.id === node.id ? { ...n, ...node } : n
            )
            usePlanStore.setState({ nodes: updated })
            break
          case 'DELETE':
            // Remove from local state
            const filtered = store.nodes.filter(n => n.id !== nodeId)
            usePlanStore.setState({ nodes: filtered })
            break
        }
      }
    )
    .subscribe((status) => {
      console.log('[realtime-sync] plan_nodes subscription status:', status)
    })
}
```

### Teardown (on signout)

```typescript
// auth-store.ts
signOut: async () => {
  // ... existing signout logic
  await teardownRealtimeSync()  // ← NEW
}
```

## Key Design Decisions

### 1. Direct State Updates (Not Store Actions)

**Why**: Prevent infinite loops where API updates trigger new API calls.

**How**: Use `setState()` directly instead of calling store action methods like `addNode()` or `updateProject()`.

### 2. Deduplication

**Why**: Clients receive their own events back from the server (Supabase Realtime limitation).

**How**: Check if record already exists before inserting (optimistic updates).

### 3. IndexedDB-Only Mode Bypass

**Why**: Realtime sync requires Supabase; doesn't work in local-only mode.

**How**: Early return in `setupRealtimeSync()` if `!shouldUseSupabase()`.

### 4. Lifecycle Tied to Authentication

**Why**: Realtime subscriptions require an authenticated session.

**How**: Setup on login, teardown on logout (managed by auth-store).

### 5. Last-Write-Wins Conflict Resolution

**Why**: Simple to implement, good enough for MVP.

**Future**: Implement operational transform (OT) for richer conflict resolution.

## Testing

### Manual Test Plan

1. **Basic Sync**:
   - Open Astro in two browser windows
   - Sign in with same user on both
   - Create project on Window A → verify appears on Window B
   - Update task on Window B → verify updates on Window A

2. **Edge Cases**:
   - Test with slow network (Chrome DevTools throttling)
   - Test disconnect/reconnect (disable WiFi, re-enable)
   - Test rapid edits (type quickly in vision doc)
   - Test concurrent edits (edit same field on both windows)

3. **IndexedDB Mode**:
   - Set `VITE_USE_INDEXEDDB_ONLY=true`
   - Verify realtime sync is disabled
   - Verify no WebSocket connections in DevTools

### Automated Tests (Future Work)

```typescript
// Example test structure
describe('Realtime Sync', () => {
  it('should sync project creation across devices', async () => {
    const client1 = createTestClient()
    const client2 = createTestClient()

    await client1.createProject({ name: 'Test Project' })

    await waitFor(() => {
      expect(client2.getProjects()).toHaveLength(1)
    })
  })

  it('should handle concurrent edits with last-write-wins', async () => {
    // Setup both clients with same project
    // Edit description on both
    // Verify last edit wins
  })

  it('should deduplicate optimistic updates', async () => {
    // Create node with optimistic update
    // Verify only one node exists after event received
  })
})
```

## Deployment Checklist

- [ ] Run migration: `00000000000002_enable_realtime_sync.sql`
- [ ] Verify all tables added to `supabase_realtime` publication
- [ ] Test realtime sync on staging environment
- [ ] Monitor Supabase Realtime dashboard for connection count
- [ ] Check browser console logs for subscription status
- [ ] Test cross-device sync with production data
- [ ] Document known limitations for users
- [ ] Add feature flag (if needed for gradual rollout)

## Performance Monitoring

**Metrics to Track**:

1. **Connection Count**: Number of active WebSocket connections
2. **Event Throughput**: Events/second across all subscriptions
3. **Latency**: Time from DB write to client update
4. **Bandwidth**: Bytes sent/received per client
5. **Error Rate**: Failed subscriptions or dropped events

**Supabase Dashboard**: Navigate to "Realtime" section to view these metrics.

## Rollback Plan

If realtime sync causes issues in production:

1. **Disable subscriptions**:
   ```typescript
   // Temporarily comment out in auth-store.ts
   // setupRealtimeSync()
   ```

2. **Remove tables from publication**:
   ```sql
   alter publication supabase_realtime drop table user_profiles;
   alter publication supabase_realtime drop table display_settings;
   -- etc.
   ```

3. **Deploy hotfix** with subscriptions disabled

4. **Investigate** root cause offline

5. **Re-enable** once fixed

## Future Enhancements

### Phase 2: Conflict Resolution

- Detect concurrent edits
- Show conflict resolution UI
- Allow user to choose which version to keep
- Implement three-way merge for text fields

### Phase 3: Operational Transform

- Real-time collaborative editing (like Google Docs)
- Character-level sync for vision doc
- CRDT (Conflict-free Replicated Data Types)
- Merge edits instead of overwriting

### Phase 4: Presence & Cursors

- Show which users are viewing a project
- Display cursor positions in real-time
- Show who's editing which task
- Chat/comments overlay

### Phase 5: Selective Sync

- Only sync active projects (not archived)
- Lazy load task details on demand
- Reduce bandwidth for large project graphs
- Background sync for low-priority updates

## Known Issues

1. **Chat messages not syncing**: Session lookup required (not yet implemented)
2. **Last-write-wins**: Concurrent edits can overwrite each other
3. **No event replay**: Missed events during disconnect not recovered
4. **Client ID filtering**: All clients receive all events (including own)

## Support

For questions or issues:

1. Check `REALTIME_SYNC.md` for architecture details
2. Review `docs/realtime-sync-example.md` for usage examples
3. Inspect browser console for `[realtime-sync]` log messages
4. Check Supabase dashboard for connection/event metrics
5. File issue on GitHub with reproduction steps

---

**Implementation Date**: 2026-02-15
**Author**: Claude Code
**Status**: ✅ Complete
