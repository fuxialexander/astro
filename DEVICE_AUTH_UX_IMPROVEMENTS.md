# Device Auth UX Improvements

## Problems Fixed

### 1. Device Auth Redirect Flow Broken
**Issue:** When users click the device auth URL but aren't logged in, they'd be redirected to login, then after successful login redirected to `/tasks`, losing the device code context entirely. The agent would keep polling but never get authorized.

**Flow Before:**
```
1. Agent shows: https://nexus.app/device?code=HSWU-4YNB
2. User clicks → Not logged in
3. Shows "Login Required" button
4. User clicks → /login
5. User logs in → Redirects to /tasks (default)
6. Device code lost! ❌
7. Agent keeps polling but never completes
```

**Flow After:**
```
1. Agent shows: https://nexus.app/device?code=HSWU-4YNB
2. User clicks → Not logged in
3. Auto-redirects to /login?redirect=/device?code=HSWU-4YNB
4. User logs in → Redirects back to /device?code=HSWU-4YNB
5. Device auth page loads with code preserved ✅
6. User clicks "Authorize"
7. Agent completes setup successfully
```

### 2. Login/Signup Split Confusing
**Issue:** Users had to choose between "Sign in" and "Sign up" modes, but WebAuthn/passkeys handle both cases automatically. This created unnecessary friction.

**Before:**
- Separate "Sign in with Passkey" and "Create Passkey" buttons
- User had to know if they had a passkey or not
- Toggle between signin/signup modes
- Confusing for new users

**After:**
- Single "Continue with Passkey" button (unified flow)
- Automatically tries authentication first
- If no passkey exists, seamlessly creates one
- Email optional for sign-in (any passkey), required for sign-up
- Still allows explicit signin/signup modes for troubleshooting

## Changes Made

### `src/pages/device-auth.tsx`
1. **Auto-redirect on unauthenticated** (line 63-72):
   - Detects when user is not logged in
   - Preserves device code in redirect URL
   - Redirects to `/login?redirect=/device?code=XXX`

2. **Updated UI** (line 237-246):
   - Removed manual "Log In" button
   - Shows "Redirecting to login..." spinner instead
   - Seamless transition

### `src/pages/login.tsx`
1. **Query param redirect support** (line 14-19):
   - Added `useSearchParams` import
   - Reads `?redirect=` query param
   - Falls back to `location.state.from` (existing behavior)
   - Defaults to `/` if neither present

2. **Unified passkey handler** (line 30-157):
   - New `handlePasskey()` replaces separate signin/signup handlers
   - **Auto mode logic:**
     ```typescript
     1. Try authentication (works if passkey exists)
     2. If successful → redirect to destination
     3. If fails + auto mode + email provided → create passkey
     4. If fails + auto mode + no email → ask for email
     5. If fails + signin mode → show error "No passkey found"
     ```
   - Removed old `handlePasskeySignIn` and `handlePasskeySignUp`

3. **Updated UI** (line 229-288):
   - **Mode type:** Added `"auto"` to `"signin" | "signup"`
   - **Default mode:** Changed to `"auto"`
   - **Button text:**
     - Auto/signin: "Continue with Passkey"
     - Signup: "Create Passkey"
   - **Email field placeholder:**
     - Auto: "Optional" + help text
     - Signin: "Optional for passkey sign-in"
     - Signup: "you@example.com"
   - **Toggle links:**
     - Auto mode: "Having trouble? Create a new passkey"
     - Signin mode: "Don't have a passkey? Sign up"
     - Signup mode: "Already have a passkey? Sign in"

## User Experience

### Device Auth Flow (Fixed)
```bash
# Terminal shows:
$ npx @nexus/agent setup
...
ℹ Please authorize this device

  Open this URL in your browser:
  https://nexus.app/device?code=HSWU-4YNB
```

**User clicks URL:**
1. **Not logged in** → Auto-redirects to login with code preserved
2. **Logs in** → Returns to device auth page with code intact
3. **Reviews device info** → Clicks "Authorize"
4. **Success!** → Agent continues setup

**No more lost device codes!**

### Login Flow (Unified)
**First-time user:**
1. Opens login page
2. Sees "Continue with Passkey"
3. (Optional) Enters email
4. Clicks button → Browser prompts to create passkey
5. Creates passkey → Logged in!

**Returning user:**
1. Opens login page
2. Sees "Continue with Passkey"
3. Clicks button → Browser shows saved passkeys
4. Selects passkey → Logged in!

**No mode selection needed!**

## Testing

### Test Device Auth Redirect
```bash
# 1. Make sure you're logged out
# 2. Run agent setup
cd packages/agent-runner
npm run build
npx @nexus/agent setup

# 3. Click the device URL when prompted
# 4. Verify: Redirects to login, then back to device auth after login
# 5. Verify: Device code is preserved and visible
# 6. Click "Authorize"
# 7. Verify: Agent completes setup
```

### Test Unified Login
**First-time user:**
```
1. Open /login
2. Enter email: test@example.com
3. Click "Continue with Passkey"
4. Create passkey when browser prompts
5. Should be logged in
```

**Returning user:**
```
1. Open /login
2. Click "Continue with Passkey" (leave email blank)
3. Select existing passkey
4. Should be logged in
```

**With redirect param:**
```
1. Open /login?redirect=/device?code=TEST-CODE
2. Login with passkey
3. Should redirect to /device?code=TEST-CODE
```

## Benefits

1. **No lost device codes** - Auth flow preserves context
2. **Fewer clicks** - One button for both login and signup
3. **Less confusion** - No mode selection needed
4. **Faster onboarding** - Seamless passkey creation/auth
5. **Better DX** - Agent setup "just works"

## Migration

No breaking changes. Existing behavior preserved:
- `location.state.from` still works for redirect
- Explicit signin/signup modes still available
- Dev mode flow unchanged
