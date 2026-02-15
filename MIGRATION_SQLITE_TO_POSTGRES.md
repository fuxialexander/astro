# SQLite to Postgres Migration Summary

## Overview
Successfully migrated the Nexus backend from SQLite to Supabase Postgres. This migration aligns the Drizzle ORM schema with the Supabase Postgres schema defined in `supabase/migrations/20260209000000_initial_schema.sql`.

## Schema Changes

### Import Changes
- Changed from `drizzle-orm/sqlite-core` to `drizzle-orm/pg-core`
- Changed `sqliteTable` to `pgTable`
- Added Postgres-specific types: `uuid`, `timestamp`, `boolean`, `date`, `jsonb`, `primaryKey`

### Column Type Migrations
- **IDs**: `text('id')` → `uuid('id').defaultRandom()` (except where text IDs needed for compatibility)
- **Timestamps**: `integer('created_at', { mode: 'timestamp_ms' })` → `timestamp('created_at').defaultNow()`
- **Booleans**: `integer('is_connected', { mode: 'boolean' })` → `boolean('is_connected')`
- **Arrays**: `text('domains', { mode: 'json' }).$type<string[]>()` → `text('domains').array()`
- **JSON**: `text('labels', { mode: 'json' })` → `jsonb('labels')`
- **Dates**: `text('start_date')` → `date('start_date')`

### Table-Specific Changes

#### projects
- `userId` → `ownerId` (UUID)
- Removed `repository`, `defaultEnvironment`, `defaultMachineId` columns (not in Postgres schema)

#### plan_nodes
- Added `clientId` field to preserve client-generated IDs
- Split `position` object into `positionX` and `positionY` (real)
- Removed `dependencies` array (moved to separate junction table)
- Removed `boardOrder` (not in Postgres schema)

#### plan_node_dependencies (NEW)
- Junction table for node dependencies
- Composite primary key: (node_project_id, node_client_id, depends_on_client_id)

#### plan_edges
- Added `clientId` field
- `source` → `sourceClientId`
- `target` → `targetClientId`

#### user_profiles
- Moved `apiKeys` from separate table to jsonb column
- Arrays now use native Postgres array types

#### api_keys (REMOVED)
- Merged into `user_profiles.api_keys` as jsonb

#### display_settings
- Removed auto-increment `id` column
- Now uses composite primary key: (user_id, view_key)

#### usage_metrics
- Removed auto-increment `id` column
- Now uses composite primary key: (user_id, session_date)

#### task_chat_messages
- `sessionNodeId` + `sessionUserId` → `sessionId` (UUID foreign key)
- `timestamp` → `createdAt`

#### app_settings (REMOVED)
- Table no longer exists in Postgres schema

#### NEW TABLES
- `project_members` - for shared project access
- `task_executions` - execution tracking
- `tool_traces` - per-execution tool traces
- `file_changes` - per-execution file changes
- `refresh_tokens` - OAuth refresh tokens
- `passkey_credentials` - WebAuthn credentials

## Backend Code Changes (server/routes/data.ts)

### Removed Imports
- `apiKeys` (merged into userProfiles)
- `appSettings` (no longer exists)

### Projects Routes
- Updated all references from `projects.userId` to `projects.ownerId`

### Plan Routes
- Updated node creation/updates to split `position` into `positionX`/`positionY`
- Removed `dependencies` field handling
- Updated to use `clientId` instead of `id` for compatibility
- Updated edges to use `clientId`, `sourceClientId`, `targetClientId`

### Profile Routes
- Simplified to return userProfiles directly (apiKeys now embedded)
- Updated PUT endpoint to save apiKeys as jsonb

### Display Settings
- Updated PATCH endpoint to use composite key (user_id, view_key) instead of id

### Chat Routes
- Updated to use `session.id` instead of composite (sessionNodeId, sessionUserId)
- Messages now reference `sessionId` UUID

### Removed Routes
- `/settings` GET and PATCH (appSettings table removed)

## Frontend Impact

The frontend will need updates to handle:
1. Position data structure change (`position: {x, y}` → `positionX`, `positionY`)
2. Dependencies moved from node array to junction table
3. API keys embedded in profile response
4. Chat messages keyed by session UUID instead of (nodeId, userId)

## Migration Status

✅ Schema file updated to match Postgres
✅ Backend data routes updated
✅ Server starts without errors
✅ Authentication working correctly
⚠️ Frontend may need updates for data structure changes
⚠️ Test full signup/login flow
⚠️ Verify plan graph loading works with new structure

## Next Steps

1. Test user signup/login with passkeys
2. Verify dashboard loads profile correctly
3. Test plan graph rendering with new position fields
4. Update frontend stores if needed to handle new data structures
5. Run full lint check and fix any remaining errors
