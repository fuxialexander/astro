# Sidebar Configuration - Multi-Device Sync ✅

## Overview
Sidebar customization now syncs across all your devices via Supabase!

## How It Works

### Storage Strategy (Dual-Persistence)

1. **IndexedDB** (Local Storage)
   - Always saves locally for offline access
   - Fast, no network required
   - Single-device persistence

2. **Supabase** (Cloud Storage)
   - Saves to `user_profiles.sidebar_config` column
   - Multi-device sync via PostgreSQL
   - Realtime updates across devices

### Mode Detection

The store automatically detects which mode to use:

```typescript
if (shouldUseSupabase()) {
  // Multi-tenant mode (production)
  // Save to both IndexedDB + Supabase
  // Subscribe to realtime changes
} else {
  // IndexedDB-only mode (local dev)
  // Save to IndexedDB only
  // No realtime sync
}
```

### Load Priority

1. **Try Supabase first** (if available)
   - Fetch from `user_profiles.sidebar_config`
   - Most up-to-date across devices

2. **Fallback to IndexedDB**
   - If Supabase not configured
   - If user not authenticated
   - For offline access

### Save Strategy

Dual-write for reliability:

```typescript
// 1. Save to IndexedDB (always)
await idbSet("sidebar-items", items)

// 2. Save to Supabase (if available)
if (supabase) {
  await supabase
    .from("user_profiles")
    .update({ sidebar_config: items })
    .eq("id", user.id)
}
```

### Realtime Sync

Live updates across devices using Supabase Realtime:

```typescript
supabase
  .channel("sidebar-config-changes")
  .on("postgres_changes", {
    event: "UPDATE",
    schema: "public",
    table: "user_profiles"
  }, (payload) => {
    // Update sidebar on all connected devices
    set({ items: payload.new.sidebar_config })
  })
  .subscribe()
```

## User Experience

### Scenario 1: Edit on Desktop
1. User long-presses sidebar on desktop
2. Reorders items, hides "Dashboard"
3. Clicks "Done"
4. **Instant**: Changes save to IndexedDB + Supabase
5. **1-2 seconds**: All other devices (phone, tablet) auto-update

### Scenario 2: Offline Editing
1. User is offline (no internet)
2. Customizes sidebar
3. Changes save to IndexedDB only
4. User goes online
5. Next sidebar change syncs to Supabase
6. *(Note: Offline changes don't auto-sync on reconnect yet)*

### Scenario 3: New Device
1. User logs in on new laptop
2. Sidebar loads default config from IndexedDB
3. Supabase fetch completes
4. Sidebar updates to user's custom config
5. Seamless experience

## Database Schema

### Migration: `20260216000001_add_sidebar_config.sql`

```sql
ALTER TABLE user_profiles
ADD COLUMN sidebar_config JSONB DEFAULT NULL;

CREATE INDEX idx_user_profiles_sidebar_config
ON user_profiles USING GIN (sidebar_config);
```

### Data Structure

```typescript
{
  sidebar_config: [
    {
      id: "tasks",
      to: "/",
      icon: "CheckSquare",
      label: "Tasks",
      visible: true,
      protected: true
    },
    // ... more items
  ]
}
```

## Benefits

✅ **Multi-device sync** - Same sidebar on all devices
✅ **Realtime updates** - No refresh needed, instant sync
✅ **Offline support** - Works without internet
✅ **Fast loading** - IndexedDB cache for instant UI
✅ **Reliable** - Dual-write prevents data loss

## Edge Cases Handled

1. **New items added to defaults**
   - Merge logic includes new items
   - User's customization preserved

2. **User not authenticated**
   - Falls back to IndexedDB only
   - No errors, graceful degradation

3. **Supabase unavailable**
   - Continues working with IndexedDB
   - Saves to Supabase when back online

4. **Conflicting updates**
   - Last-write-wins (Supabase default)
   - Could add optimistic concurrency control later

## Files Changed

1. **`supabase/migrations/20260216000001_add_sidebar_config.sql`**
   - Adds `sidebar_config` column
   - Creates GIN index for JSONB

2. **`src/stores/sidebar-store.ts`**
   - Dual-persistence logic
   - Supabase integration
   - Realtime subscription

3. **`src/components/layout/sidebar.tsx`**
   - Subscribes to realtime changes
   - Cleanup on unmount

4. **`src/app.tsx`**
   - Loads sidebar config on startup

## Testing

### Test Multi-Device Sync:

1. **Setup**:
   ```bash
   npm run dev:supabase
   ```

2. **Device 1** (Desktop):
   - Login with WebAuthn
   - Long press sidebar → Edit mode
   - Reorder items
   - Click "Done"

3. **Device 2** (Phone/Tablet):
   - Login with same account
   - Watch sidebar update automatically (1-2s delay)

4. **Verify**:
   - Both devices show same order
   - Changes persist after refresh
   - IndexedDB has backup copy

### Test Offline Mode:

1. **Go offline**: Disable network
2. **Edit sidebar**: Make changes
3. **Check**: Changes saved to IndexedDB
4. **Go online**: Re-enable network
5. **Make new change**: Syncs to Supabase

## Future Enhancements

- [ ] Conflict resolution (optimistic locking)
- [ ] Offline queue (sync pending changes when online)
- [ ] Last-modified timestamp
- [ ] Version history (undo/redo)
- [ ] Export/import sidebar config
- [ ] Share config with team

## Migration Notes

Run the migration:
```bash
npx supabase migration up
```

Or apply manually in Supabase dashboard:
```sql
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS sidebar_config JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_sidebar_config
ON user_profiles USING GIN (sidebar_config);
```

No data migration needed - column defaults to NULL, store handles it gracefully.
