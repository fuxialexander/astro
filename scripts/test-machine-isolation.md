# Machine Isolation Testing

This document describes how to test that machines are properly scoped to users.

## Test Setup

The fix implements per-browser user isolation in IndexedDB mode by:
1. Generating a unique browser user ID (UUID) per browser and storing it in IndexedDB
2. Sending this ID in the `X-User-Id` header for API requests
3. Using this ID for machine registration and filtering

## Testing in IndexedDB Mode (Local Development)

### Test 1: Different Browsers Show Different Machines

1. **Start the dev server:**
   ```bash
   npm run dev
   ```

2. **Browser A (e.g., Chrome):**
   - Open http://localhost:5173
   - Navigate to Environments page
   - Note the browser user ID in the console: `[auth-store] Using browser user ID: <UUID-A>`
   - Register a machine (or use the "Simulate Machine" feature if available)
   - You should see the machine listed

3. **Browser B (e.g., Firefox or Safari):**
   - Open http://localhost:5173 in a DIFFERENT browser
   - Navigate to Environments page
   - Note the browser user ID in the console: `[auth-store] Using browser user ID: <UUID-B>`
   - **Expected:** UUID-B is different from UUID-A
   - **Expected:** You should NOT see the machine from Browser A
   - Register a different machine
   - **Expected:** You should only see the machine you just registered

4. **Back to Browser A:**
   - Refresh the Environments page
   - **Expected:** You should still only see Browser A's machines, not Browser B's machines

### Test 2: Browser User ID Persists Across Sessions

1. **Browser A:**
   - Note the browser user ID from the console
   - Close the browser completely
   - Reopen the browser and navigate to http://localhost:5173
   - **Expected:** The browser user ID should be the SAME as before
   - **Expected:** You should still see the same machines

### Test 3: Machine Operations (Rename, Revoke) Are Scoped

1. **Browser A:**
   - List machines - note a machine ID
   - Try to rename a machine
   - **Expected:** Success

2. **Browser B (using Browser A's machine ID):**
   - Open the browser console
   - Try to revoke Browser A's machine using the API:
     ```javascript
     // Get Browser B's user ID
     const browserUserId = await window.indexedDB.databases().then(dbs => {
       // This is a simplified check - actual ID is in IndexedDB
       return '<UUID-B>'
     })

     // Try to delete Browser A's machine
     fetch('/api/device/machines/<MACHINE-ID-FROM-BROWSER-A>', {
       method: 'DELETE',
       headers: { 'X-User-Id': browserUserId }
     })
     ```
   - **Expected:** 403 Forbidden (Not authorized to revoke this machine)

## Testing in Supabase Mode

In Supabase mode, user isolation is provided by Supabase authentication:

1. **User A:**
   - Sign in with User A credentials
   - Register machines
   - Note the machines listed

2. **User B (same browser or different):**
   - Sign out from User A
   - Sign in with User B credentials
   - **Expected:** Should NOT see User A's machines
   - Register machines
   - **Expected:** Should only see User B's machines

3. **Back to User A:**
   - Sign out from User B
   - Sign in with User A
   - **Expected:** Should see User A's machines again

## Checking the Fix in Database

### IndexedDB Mode (SQLite)

```bash
# View the SQLite database
sqlite3 server/lib/db/nexus.db

# Check machines table with user IDs
SELECT id, name, userId, hostname FROM registered_machines;

# You should see different UUIDs in the userId column
# Each browser will have registered machines with its own unique userId
```

### Supabase Mode

```sql
-- In Supabase SQL Editor
SELECT id, name, user_id, hostname FROM registered_machines;

-- Each user should only see machines with their own user_id
-- RLS policies enforce this at the database level
```

## Expected Behavior Summary

| Mode | User Isolation | User ID Source |
|------|---------------|----------------|
| IndexedDB | Per-browser (persistent UUID) | `crypto.randomUUID()` stored in IndexedDB |
| Supabase | Per authenticated user | Supabase auth user ID |

## Verification Checklist

- [ ] Different browsers show different machines in IndexedDB mode
- [ ] Browser user ID persists across browser restarts
- [ ] Users cannot rename/revoke machines they don't own (403 Forbidden)
- [ ] Different authenticated users see different machines in Supabase mode
- [ ] Console logs show different user IDs for different browsers/users

## Troubleshooting

### All users still see the same machines

**Check:**
1. Browser console: Is the user ID changing between browsers?
   - Look for: `[auth-store] Using browser user ID: <UUID>`
2. Network tab: Is the `X-User-Id` header being sent?
   - Check the `/api/device/machines` request headers
3. Backend logs: Is the middleware using the header?
   - Look for: `[auth] Using browser user ID from header`

### Browser user ID keeps changing

**Possible causes:**
- Browser is in incognito/private mode (IndexedDB is cleared on close)
- Browser storage is being cleared manually
- Using different browser profiles

**Fix:**
- Use normal browser mode (not incognito)
- Don't clear browser storage between tests
- Use the same browser profile
