# Timestamp Conversion Fix

## Problem
Backend was throwing repeated `TypeError: value.toISOString is not a function` errors:
```
TypeError: value.toISOString is not a function
    at PgTimestamp.mapToDriverValue (/Users/xf2217/Repos/nexus/node_modules/src/pg-core/columns/timestamp.ts:68:16)
```

## Root Cause
The issue was in `server/routes/data.ts` timestamp field conversions. The code was using simple truthy checks:

```typescript
createdAt: body.createdAt ? new Date(body.createdAt) : now
```

**Why this fails:**
1. If `body.createdAt` is an empty object `{}` or array `[]`, it's truthy
2. `new Date({})` creates an **Invalid Date** object
3. Drizzle calls `.toISOString()` on the Invalid Date → TypeError

**Example:**
```javascript
new Date(undefined) // Invalid Date
new Date({})        // Invalid Date
new Date([])        // Invalid Date

// All throw: TypeError: Invalid time value
invalidDate.toISOString()
```

## Solution
Changed all timestamp conversions to validate type before creating Date objects:

**Before:**
```typescript
createdAt: body.createdAt ? new Date(body.createdAt) : now
```

**After:**
```typescript
createdAt: (typeof body.createdAt === 'string' || typeof body.createdAt === 'number')
  ? new Date(body.createdAt)
  : now
```

This ensures we only pass strings or numbers to `new Date()`, preventing Invalid Date objects.

## Files Modified

### server/routes/data.ts
Fixed 12 timestamp conversion locations across multiple endpoints:
- `/data/projects` (POST) - createdAt, updatedAt
- `/data/initiatives` (POST) - createdAt, updatedAt
- `/data/plan/nodes` (POST) - createdAt, updatedAt, executionStartedAt, executionCompletedAt
- `/data/plan/bulk` (POST) - createdAt, updatedAt, executionStartedAt, executionCompletedAt
- `/data/profile` (PUT) - createdAt
- `/chat/:nodeId/session` (POST) - createdAt
- `/chat/:nodeId/messages` (POST) - createdAt (2 locations)

### scripts/test-github-oauth.ts
Fixed unused variable lint error (unrelated to timestamp issue).

## Testing
- ✅ TypeScript compilation passes: `npm run build`
- ✅ Lint checks pass: `npm run lint` (0 errors, 2 pre-existing warnings)
- ✅ All timestamp fields now properly validated before Date conversion

## Impact
This fix prevents the database errors that were occurring during:
- Plan generation (saving nodes/edges)
- Project/initiative creation
- Task execution updates
- Chat message creation
- User profile updates

The errors were causing silent failures in data persistence while the operations appeared to succeed.
