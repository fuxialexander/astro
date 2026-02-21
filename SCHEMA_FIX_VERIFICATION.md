# Schema Mismatch Verification Report

## Issue
DrizzleQueryError occurring when querying `user_profiles` table - database expecting `preferred_machines` but queries were using `preferred_environments`.

## Investigation Results

### Database Schema ✅
Verified via direct PostgreSQL query:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'user_profiles'
  AND column_name IN ('preferred_machines', 'preferred_environments', 'default_machine_id', 'default_provider');
```

**Results:**
- ✅ `preferred_machines` ARRAY NOT NULL DEFAULT '{}'
- ✅ `default_machine_id` text NULL
- ✅ `default_provider` text NULL
- ✅ `preferred_environments` does NOT exist (correctly removed)

### Drizzle Schema ✅
File: `server/lib/db/schema.ts` (line 137)
```typescript
preferredMachines: text('preferred_machines').array().notNull().default([]),
defaultMachineId: text('default_machine_id'),
defaultProvider: text('default_provider'),
```

### Migration ✅
File: `supabase/migrations/20260221200000_replace_preferred_environments_with_machines.sql`
- Correctly adds `preferred_machines` column
- Correctly drops `preferred_environments` column
- Migration has been successfully applied to the database

### Test Query ✅
Successfully updated and queried the dev user profile:
```sql
UPDATE user_profiles
SET preferred_machines = ARRAY['machine-1', 'machine-2'],
    default_machine_id = 'machine-1',
    default_provider = 'claude-code'
WHERE id = '00000000-0000-0000-0000-000000000000';
-- Result: UPDATE 1 (successful)
```

## Root Cause
Database logs showed queries attempting to SELECT `preferred_environments`:
```
ERROR: column "preferred_environments" does not exist at character 83
STATEMENT: select "id", "name", "email", ..., "preferred_environments", ...
```

These errors were from a **stale backend server process** (tsx watch) that was running with cached old code. The current codebase is correct.

## Resolution
✅ **No code changes needed** - schema migration already applied and codebase is correct.
⚠️ **Action required** - Restart the backend server to clear the cached schema:
```bash
# Kill the running tsx process
pkill -f "tsx watch.*server/index.ts"

# Restart the backend
npm run dev:backend
```

## Verification Timestamp
- Date: 2026-02-21 09:30 UTC
- Commit: 882a4a1 (fix: move variable declarations before usage in plan-canvas and execution-panel)
- Branch: astro/afbe1388-schema-mismatch-fix
