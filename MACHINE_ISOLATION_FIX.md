# Machine Isolation Fix

**Issue:** Users could see all registered machines regardless of who registered them, in both IndexedDB and Supabase modes.

**Root Causes:**

## 1. IndexedDB Mode (Local Development)
All users shared a fixed user ID (`00000000-0000-0000-0000-000000000000`) in the backend auth middleware, causing all machines to be registered under the same userId.

## 2. Supabase Mode (Production)
The backend was using the **service role client** which bypasses RLS (Row Level Security) policies. Even though RLS policies were correctly defined, they were never enforced because the service role bypasses all RLS.

---

## Solutions Implemented

### IndexedDB Mode: Per-Browser User Isolation

**Changes:**

1. **src/lib/db.ts**
   - Added `getBrowserUserId()` function that generates and persists a unique UUID per browser using `crypto.randomUUID()`
   - This UUID is stored in IndexedDB and persists across sessions
   - Each browser now acts as a separate "user"

2. **src/stores/auth-store.ts**
   - Updated `initialize()` to use `getBrowserUserId()` instead of hardcoded `'dev'` string
   - Logs the browser user ID for debugging

3. **src/stores/machines-store.ts**
   - Updated `fetchMachines()`, `revokeMachine()`, and `renameMachine()` to send browser user ID in `X-User-Id` header when in IndexedDB mode

4. **server/middleware/auth.ts**
   - Updated `requireAuth` middleware to read `X-User-Id` header in IndexedDB mode
   - Uses this ID instead of the fixed dev UUID
   - Falls back to fixed UUID for backward compatibility

**Result:**
- Each browser generates and maintains its own unique user ID
- Machines registered from different browsers have different userIds
- Machine listing correctly filters per browser
- No UI changes needed - transparent to users

### Supabase Mode: RLS Enforcement

**Changes:**

1. **server/lib/supabase.ts** (no changes needed - `createUserClient()` already exists)
   - The `createUserClient(accessToken)` function creates a Supabase client scoped to the user's JWT
   - This client respects RLS policies

2. **server/routes/device-auth.ts**
   - **GET `/device/machines`**: Now uses `createUserClient()` with RLS instead of `getServiceClient()` with manual filtering
   - **GET `/device/machines/:id`**: Updated to use RLS in Supabase mode
   - **PATCH `/device/machines/:id`**: Updated to use RLS for updates
   - **DELETE `/device/machines/:id`**: Updated to use RLS for deletes
   - All endpoints retain manual filtering for IndexedDB mode

**Result:**
- In Supabase mode, all machine queries now use the user-scoped client
- RLS policies are properly enforced at the database level
- Users can only see, update, and delete their own machines
- Database-level security instead of application-level filtering

---

## Testing

### IndexedDB Mode Test

1. **Browser A (e.g., Chrome):**
   ```bash
   npm run dev
   # Open http://localhost:5173
   # Navigate to Environments
   # Check console for: [auth-store] Using browser user ID: <UUID-A>
   # Register a machine
   ```

2. **Browser B (e.g., Firefox):**
   ```bash
   # Open http://localhost:5173 in a different browser
   # Navigate to Environments
   # Check console for: [auth-store] Using browser user ID: <UUID-B>
   # Verify UUID-B ≠ UUID-A
   # Verify you DON'T see machines from Browser A
   # Register a different machine
   ```

3. **Verify isolation:**
   ```bash
   # In SQLite database
   sqlite3 server/lib/db/nexus.db
   SELECT id, name, userId, hostname FROM registered_machines;
   # Should show different UUIDs in userId column
   ```

### Supabase Mode Test

1. **User A:**
   - Sign in with User A credentials
   - Register machines
   - Note the machines listed

2. **User B:**
   - Sign out from User A
   - Sign in with User B credentials
   - Verify you DON'T see User A's machines
   - Register machines
   - Verify you ONLY see User B's machines

3. **Verify RLS:**
   ```sql
   -- In Supabase SQL Editor
   SELECT id, name, user_id, hostname FROM registered_machines;
   -- Each user should only see rows with their own user_id
   -- RLS is enforced at database level
   ```

### API-Level Testing

```bash
# Test in IndexedDB mode
curl -H "X-User-Id: <UUID-1>" http://localhost:3001/api/device/machines

# Test in Supabase mode
curl -H "Authorization: Bearer <ACCESS-TOKEN>" http://localhost:3001/api/device/machines
```

---

## Migration Notes

### For Existing Installations

**IndexedDB Mode:**
- Existing machines registered with the old fixed UUID will remain under that UUID
- New machines will be registered with the browser-specific UUID
- To clean up: Clear IndexedDB storage or manually update machine userIds in SQLite

**Supabase Mode:**
- No migration needed - existing RLS policies are now properly enforced
- Existing machines should already have correct user_id values
- If machines were somehow registered with wrong user_ids, they will become inaccessible (as intended)

### Environment Variables

No new environment variables required. The fix works with existing configuration:

**IndexedDB Mode:**
```bash
# No Supabase env vars OR
USE_INDEXEDDB_ONLY=true
```

**Supabase Mode:**
```bash
SUPABASE_URL=<your-url>
SUPABASE_ANON_KEY=<your-key>
SUPABASE_SERVICE_ROLE_KEY=<your-key>  # For server-side operations that need to bypass RLS
```

---

## Security Improvements

1. **Database-Level Security (Supabase):**
   - RLS policies now enforced instead of application-level filtering
   - Defense in depth: even if application logic has bugs, database prevents unauthorized access

2. **Per-Browser Isolation (IndexedDB):**
   - Each browser maintains its own user identity
   - Machines scoped to the registering browser
   - Simple and transparent to users

3. **Authorization Checks:**
   - All endpoints verify ownership before operations
   - 403 Forbidden for unauthorized access attempts
   - Audit logging for machine registration and revocation

---

## Architecture Diagram

### Before Fix

```
IndexedDB Mode:
  Browser A → Backend (userId: 0000...) → SQLite (all machines with userId: 0000...)
  Browser B → Backend (userId: 0000...) → SQLite (all machines with userId: 0000...)
  ❌ Both browsers see all machines

Supabase Mode:
  User A → Backend (service role) → Supabase (RLS bypassed) → All machines
  User B → Backend (service role) → Supabase (RLS bypassed) → All machines
  ❌ Both users see all machines
```

### After Fix

```
IndexedDB Mode:
  Browser A → Backend (userId: UUID-A) → SQLite (machines with userId: UUID-A)
  Browser B → Backend (userId: UUID-B) → SQLite (machines with userId: UUID-B)
  ✅ Each browser sees only its machines

Supabase Mode:
  User A → Backend (user client A) → Supabase (RLS: user_id = A) → User A machines
  User B → Backend (user client B) → Supabase (RLS: user_id = B) → User B machines
  ✅ Each user sees only their machines
```

---

## Files Modified

1. `src/lib/db.ts` - Browser user ID generation
2. `src/stores/auth-store.ts` - Use browser user ID
3. `src/stores/machines-store.ts` - Send X-User-Id header
4. `server/middleware/auth.ts` - Read X-User-Id header
5. `server/routes/device-auth.ts` - Use RLS in Supabase mode
6. `scripts/test-machine-isolation.md` - Testing documentation

---

## Backward Compatibility

- **IndexedDB Mode:** Falls back to fixed UUID if no `X-User-Id` header present
- **Supabase Mode:** No breaking changes - uses existing RLS policies
- **Existing machines:** Continue to work with their existing userIds
- **API contracts:** No changes to request/response formats
