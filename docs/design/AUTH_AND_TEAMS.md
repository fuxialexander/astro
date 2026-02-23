# Authentication, Registration, and Teams — Production Design

> **Status:** PARTIALLY IMPLEMENTED — Passkeys + magic link are live.
> Teams with auto-creation and data isolation are implemented.
> OAuth (Google/GitHub) and email verification gates are designed but not yet implemented.
> This document specifies the production-grade auth system and documents
> critical implementation lessons from production debugging.

---

## 1. Design Principles

1. **Low barrier to entry.** Anyone with an email can register in seconds.
2. **Verified before trusted.** Unverified accounts exist but cannot run agents, invite members, or access sensitive operations. This prevents throwaway-account abuse.
3. **Multiple login methods.** Passkeys, magic link, Google, GitHub. Users choose; the system links them to one identity by email.
4. **Teams are first-class.** Every user belongs to at least one team (their personal workspace). All data is team-scoped. Team switching is explicit in the UI.

---

## 2. Account Lifecycle

```
                           ┌─────────────┐
                           │  Anonymous   │
                           └──────┬──────┘
                                  │ enters email
                                  ▼
                         ┌────────────────┐
    ┌────────────────────│  Registration  │────────────────────┐
    │ passkey            └────────┬───────┘            OAuth   │
    │                             │ magic link                 │
    ▼                             ▼                            ▼
┌──────────┐            ┌──────────────┐            ┌──────────────┐
│ Unverified│◄──────────│  Unverified  │            │   Verified   │
│ (passkey) │           │ (pending OTP)│            │  (OAuth)     │
└─────┬────┘            └──────┬───────┘            └──────┬───────┘
      │ clicks verify          │ clicks link                │
      │ email link             │ in email                   │
      ▼                        ▼                            │
┌──────────────────────────────────────────────────────────┐│
│                     Verified Account                     │◄┘
│  • Can execute tasks         • Can invite team members   │
│  • Can register machines     • Can create API keys       │
│  • Can create teams          • Full platform access      │
└──────────────────────────────────────────────────────────┘
```

### 2.1 What Unverified Accounts CAN Do

- Browse the UI and create projects (within their personal workspace)
- Create and edit plans (plan graph, tasks, descriptions)
- Use AI plan generation (chat-based planning — cheap, bounded cost)
- View settings, edit profile

### 2.2 What Unverified Accounts CANNOT Do

- **Execute tasks** (dispatch to agent runners) — this is the expensive operation
- **Register machines** (device auth flow)
- **Create or join teams** (beyond their auto-created personal workspace)
- **Invite members**
- **Create API keys**

This means a bad actor who mass-creates accounts with fake emails can see the UI but cannot consume compute resources. The verification gate sits exactly where cost begins.

### 2.3 Verification Triggers

> **Note:** The backend currently creates passkey-registered users with `email_confirm: true` (see `register-verify` in `server/routes/auth.ts`), which means Supabase sets `email_confirmed_at` immediately at registration. No verification gate is actually enforced — unverified accounts are not blocked from dispatching tasks or registering machines. The design below describes the intended behavior, but the gate (checking `email_confirmed_at` in the dispatch engine and device-auth routes) has not been implemented.

An account becomes verified when any of these occur:

1. **OAuth login** — Google or GitHub confirms the email. Verified immediately.
2. **Magic link click** — User clicks the OTP link in their email. Supabase sets `email_confirmed_at`.
3. **Explicit verification email** — System sends a "verify your account" email; user clicks the link. Same mechanism as magic link under the hood.

The system checks verification by reading `auth.users.email_confirmed_at IS NOT NULL` from Supabase.

---

## 3. Registration Flows

### 3.1 Email + Passkey Registration (current, enhanced)

```
Frontend                          Backend                         Supabase
   │                                │                                │
   │─── POST /check-user ──────────▶│                                │
   │◄── { exists: false } ──────────│                                │
   │                                │                                │
   │  [User enters name]            │                                │
   │                                │                                │
   │─── POST /register-options ────▶│                                │
   │◄── { options, challenge } ─────│                                │
   │                                │                                │
   │  [Browser: WebAuthn ceremony]  │                                │
   │                                │                                │
   │─── POST /register-verify ────▶│── admin.createUser() ─────────▶│
   │                                │◄── { user } ──────────────────│
   │                                │                                │
   │                                │── store passkey_credential ───▶│
   │                                │── create personal team ───────▶│
   │                                │── send verification email ────▶│
   │                                │                                │
   │◄── { verified: true,          │                                │
   │      emailVerified: false,    │                                │
   │      session } ───────────────│                                │
   │                                │                                │
   │  [User lands in app with      │                                │
   │   banner: "Verify your email  │                                │
   │   to unlock full features"]   │                                │
```

**Key change from current:** Registration creates the account with `email_confirm: false` and sends a verification email. The user can use the app immediately (plan, browse) but cannot execute tasks until they click the verification link.

### 3.2 Email + Magic Link Registration

```
Frontend                          Backend / Supabase
   │                                │
   │─── POST /check-user ──────────▶│
   │◄── { exists: false } ──────────│
   │                                │
   │  [User enters name]            │
   │                                │
   │─── supabase.auth.signInWithOtp({ email }) ──────────▶│
   │                                │  [Supabase sends magic link]
   │                                │
   │  "Check your email"            │
   │                                │
   │  [User clicks link in email]   │
   │                                │
   │◄── onAuthStateChange(SIGNED_IN) ─── session created ─│
   │                                │
   │  [Account is VERIFIED because the user proved email ownership]
```

Magic link registration is inherently verified — clicking the link proves email ownership. The `email_confirmed_at` field is set automatically by Supabase.

### 3.3 Google OAuth Registration

> **NOT YET IMPLEMENTED** — Google OAuth is designed but not wired up. The Supabase provider configuration and frontend OAuth buttons have not been created.

```
Frontend                          Supabase                         Google
   │                                │                                │
   │─── supabase.auth.signInWithOAuth({ provider: 'google' }) ─────▶│
   │                                │                                │
   │  [Browser redirects to Google consent screen] ─────────────────▶│
   │                                │                                │
   │◄── [Redirect back with code] ──│◄── { id_token, email } ──────│
   │                                │                                │
   │                                │  [Supabase creates/links user  │
   │                                │   with email_confirmed_at set] │
   │                                │                                │
   │◄── onAuthStateChange(SIGNED_IN) ─── session ──────────────────│
   │                                │                                │
   │  [ensureUserProfile() +        │                                │
   │   auto-create personal team]   │                                │
```

**Supabase handles all OAuth complexity.** We configure Google as a provider in Supabase dashboard, then call one function on the frontend. The backend only needs:

1. `ensureUserProfile()` on first login to create the `user_profiles` row
2. Auto-create personal team if this is a brand-new user (no team memberships yet)

### 3.4 GitHub OAuth Registration

> **NOT YET IMPLEMENTED** — GitHub OAuth is designed but not wired up. The Supabase provider configuration and frontend OAuth buttons have not been created.

Same flow as Google, using `provider: 'github'`. GitHub provides:
- Email (verified by GitHub)
- Display name
- Avatar URL
- GitHub username (stored in `user_metadata`)

GitHub login is especially useful for Astro because:
- Users who connect GitHub can later use it for repo integration
- The GitHub identity lets us show their avatar and username in team views
- Repository access tokens can be obtained during the same OAuth flow

---

## 4. Login Flows

### 4.1 Decision Tree (Frontend)

> **Note:** When passkey authentication fails with a `NotAllowedError` (e.g., user cancels the WebAuthn ceremony, credential not found on this device, or RP ID mismatch), the frontend falls back to showing alternative login methods (magic link, OAuth buttons, register new passkey) rather than displaying a raw error. See the flow diagram below — the "Fail (NotAllowedError)" arrow leads to the method-choice screen.

```
User enters email
       │
       ▼
  ┌─────────────┐     No     ┌────────────────────────┐
  │ User exists? │───────────▶│ Show registration form  │
  └──────┬──────┘             │ (name + method choice)  │
         │ Yes                └────────────────────────┘
         ▼
  ┌──────────────────┐  Yes  ┌─────────────────────┐
  │ Has passkeys on  │──────▶│ Attempt passkey auth │
  │ this RP domain?  │       └─────────┬───────────┘
  └──────┬───────────┘                 │
         │ No                          │ Success → navigate to app
         ▼                             │ Fail (NotAllowedError) ─┐
  ┌──────────────────┐                                          │
  │ Show login       │◄─────────────────────────────────────────┘
  │ method choices:  │
  │ • Magic link     │
  │ • Google         │
  │ • GitHub         │
  │ • Register new   │
  │   passkey        │
  └──────────────────┘
```

### 4.2 Passkey Login (current)

Works as-is. No changes needed. The existing `login-options` → `startAuthentication` → `login-verify` flow is correct.

### 4.3 Magic Link Login (current)

Works as-is. `supabase.auth.signInWithOtp({ email })` sends the link, user clicks it, `onAuthStateChange` fires with `SIGNED_IN`.

### 4.4 Google Login

```typescript
// Frontend — one line
const { error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: `${window.location.origin}/`,
    queryParams: {
      prompt: 'select_account',  // Always show account picker
    },
  },
})
```

### 4.5 GitHub Login

```typescript
const { error } = await supabase.auth.signInWithOAuth({
  provider: 'github',
  options: {
    redirectTo: `${window.location.origin}/`,
    scopes: 'read:user user:email',  // Minimal scopes for login
  },
})
```

---

## 5. Account Linking

A single user may authenticate via multiple methods. Supabase handles this natively through its `identities` table. The linking logic:

| Scenario | Behavior |
|----------|----------|
| Register via passkey → later login via Google (same email) | Supabase links Google identity to existing account |
| Register via Google → later add passkey | Passkey stored with existing `user_id` |
| Register via GitHub → later login via magic link (same email) | Same account, magic link verifies the email |
| Register via Google (email A) → login via GitHub (email B) | Different accounts — no auto-linking across emails |

**Linking rule:** Same email = same account. Different email = different account. This is simple, predictable, and prevents account hijacking through OAuth provider confusion.

### 5.1 Conflict: Same email, different providers

When a user has registered via passkey with `alice@gmail.com` and then clicks "Sign in with Google" using the same Gmail account:

1. Supabase sees the email matches an existing `auth.users` row
2. Supabase adds a Google identity to that user (no new user created)
3. The user lands in their existing account with all their data

This is the correct behavior and Supabase handles it automatically when `GOTRUE_EXTERNAL_EMAIL_ENABLED` is set.

---

## 6. Abuse Prevention

### 6.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Mass account creation with fake emails | Unverified accounts can't execute tasks (no compute cost) |
| Use throwaway email to run expensive agents | Verification required before task dispatch |
| Credential stuffing (try leaked passwords) | No passwords in the system. Passkeys + OTP only |
| Passkey phishing | RP ID binding makes passkeys unphishable |
| Email enumeration via `/check-user` | Rate limited (30 req/15min per IP), returns minimal info |
| OAuth token theft | Short-lived JWTs, refresh tokens rotated on use |
| Team invitation spam | Only verified admins/owners can send invites |
| Invite link sharing/forwarding | Invite is bound to specific email; accept endpoint verifies match |

### 6.2 Verification Gate — Implementation

The verification check belongs in the **dispatch engine**, not in the auth middleware. This way, unverified users can still call most API endpoints (fetching their own data, editing plans, etc.) but are blocked at the point of compute.

```
File: server/lib/dispatch/dispatch-engine.ts

// Before dispatching a task:
const { data: authUser } = await supabase.auth.admin.getUserById(userId)
if (!authUser?.user?.email_confirmed_at) {
  throw new DispatchError(
    'EMAIL_NOT_VERIFIED',
    'Please verify your email before running tasks. Check your inbox for a verification link.'
  )
}
```

Similarly, in `server/routes/device-auth.ts` (machine registration):
```
// Before issuing device codes:
if (!authUser?.user?.email_confirmed_at) {
  return c.json({ error: 'Email verification required to register machines' }, 403)
}
```

### 6.3 Rate Limits (Current + Additions)

| Endpoint | Current | Proposed |
|----------|---------|----------|
| `/auth/webauthn/check-user` | 30/15min per IP | Keep |
| `/auth/webauthn/register-options` | 30/15min per IP | Keep |
| `/auth/webauthn/login-options` | 30/15min per IP | Keep |
| `/api/dispatch/task` | None | 10/min per user (verified only) |
| `/api/teams/invite` | None | 20/hour per user |
| `/api/device/authorize` | None | 5/hour per user (verified only) |

### 6.4 Email Verification Flow

After passkey registration:

```
Backend (register-verify):
  1. Create user with email_confirm: false
  2. Store passkey credential
  3. Create personal team
  4. Generate magic link → extract verification URL
  5. Send verification email using email-service.ts
  6. Return session (user can use app immediately)

Email contains:
  Subject: "Verify your Astro account"
  Body: "Click to verify your email and unlock full features"
  Link: https://astro.example.com/auth/callback#token_hash=xxx&type=magiclink

When user clicks:
  1. Supabase verifies the OTP token
  2. Sets email_confirmed_at on auth.users
  3. onAuthStateChange fires with updated user
  4. Frontend removes the "verify your email" banner
```

---

## 7. Session Management

### 7.1 Session Token Flow

All authentication methods ultimately produce a **Supabase JWT session**:

- **Passkey login:** Backend verifies WebAuthn → calls `admin.generateLink({ type: 'magiclink' })` → frontend exchanges `hashed_token` via `verifyOtp()` → Supabase issues JWT
- **Magic link:** Supabase sends email → user clicks → Supabase issues JWT
- **OAuth:** Supabase handles the OAuth code exchange → issues JWT

The frontend stores the JWT in Supabase's built-in session management (localStorage + auto-refresh). The backend validates JWTs via `supabase.auth.getUser(token)`.

### 7.2 Token Refresh

Supabase auto-refreshes tokens before expiry. The `onAuthStateChange` listener in `auth-store.ts` already handles `TOKEN_REFRESHED` events. No changes needed.

### 7.3 Session Invalidation

- **Sign out:** Calls `supabase.auth.signOut()` → clears all local state
- **Account deletion:** Backend calls `admin.deleteUser()` → all sessions invalidated server-side
- **Password/credential change:** Not applicable (no passwords)

---

## 8. Teams

### 8.1 Data Model (Current)

```
teams
  id            UUID PK
  name          TEXT
  description   TEXT
  created_at    TIMESTAMP
  updated_at    TIMESTAMP

team_members
  team_id       UUID FK → teams.id
  user_id       UUID FK → auth.users.id
  role          TEXT ('owner' | 'admin' | 'member')
  joined_at     TIMESTAMP
  PK (team_id, user_id)

invite_tokens
  id            UUID PK
  token         TEXT UNIQUE
  team_id       UUID FK → teams.id
  email         TEXT
  invited_by    UUID
  role          TEXT
  expires_at    TIMESTAMP
  used_at       TIMESTAMP
  created_at    TIMESTAMP
```

This schema is correct and sufficient. No changes needed.

### 8.2 Team Lifecycle

```
User registers
      │
      ▼
Personal workspace auto-created
  (team name: "{name}'s workspace")
  (user role: owner)
      │
      ├── User creates additional teams ──▶ New team, user is owner
      │
      ├── User receives invite ──▶ Clicks link ──▶ Joins team as member/admin
      │
      └── User creates project ──▶ Project belongs to active team
```

### 8.3 Team Roles and Permissions

| Permission | Owner | Admin | Member |
|------------|-------|-------|--------|
| View team projects | Yes | Yes | Yes |
| Create projects | Yes | Yes | Yes |
| Execute tasks | Yes | Yes | Yes |
| Edit any project | Yes | Yes | Own only |
| Invite members | Yes | Yes | No |
| Remove members | Yes | Yes (not owners) | No |
| Change member roles | Yes | No | No |
| Delete team | Yes | No | No |
| Edit team settings | Yes | Yes | No |
| Register machines for team | Yes | Yes | No |
| View billing/usage | Yes | Yes | No |

### 8.4 Team-Scoped Data

All data is scoped to teams. When a user switches teams, they see different:
- Projects
- Plans and tasks
- Execution history
- Registered machines (machines can be shared within a team)
- Usage metrics

The current schema already has `team_id` on `projects`, `initiatives`, and `registered_machines`. This is sufficient for team-scoped data isolation.

### 8.5 Personal Workspace

Every user gets one auto-created personal workspace. This team:
- Cannot be deleted
- Cannot have members added (single-user)
- Acts as the default when no team context is set
- Has name format: `{userName}'s workspace`

The personal workspace concept means a user who never creates or joins a team still has a fully functional experience. Teams are additive, not required.

---

## 9. Frontend: Login Page Redesign

### 9.1 Layout

```
┌──────────────────────────────────────┐
│             ✦ Astro                  │
│                                      │
│    Sign in to continue               │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  📧  your@email.com           │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │       ➡  Continue              │  │
│  └────────────────────────────────┘  │
│                                      │
│  ──────────── or ────────────────    │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  G  Continue with Google       │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │  🐙 Continue with GitHub       │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

### 9.2 Flow After Email Entry

**Existing user with passkeys:**
```
┌──────────────────────────────────────┐
│             ✦ Astro                  │
│                                      │
│    Welcome back                      │
│    alice@example.com                 │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  🔐  Sign in with passkey     │  │  ← Primary
│  └────────────────────────────────┘  │
│                                      │
│    ✉️  Send me a sign-in link        │  ← Secondary
│    ← Use a different email           │  ← Tertiary
│                                      │
└──────────────────────────────────────┘
```

**New user:**
```
┌──────────────────────────────────────┐
│             ✦ Astro                  │
│                                      │
│    Create your account               │
│    alice@example.com                 │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Your name                     │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  🔐  Create account            │  │  ← Passkey (if available)
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  ✉️  Create with email link    │  │  ← Magic link
│  └────────────────────────────────┘  │
│                                      │
│    ← Different email                 │
│                                      │
└──────────────────────────────────────┘
```

### 9.3 Verification Banner

After passkey registration (user is logged in but email not verified):

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠️  Verify your email to unlock task execution and team     │
│     features. Check your inbox or [resend verification].     │
└──────────────────────────────────────────────────────────────┘
```

This banner appears at the top of every page until `email_confirmed_at` is set. It includes a "resend" button that calls `supabase.auth.resend({ type: 'signup', email })`.

---

## 10. Frontend: Team UI

### 10.1 Team Switcher (Sidebar)

The sidebar currently shows the user's avatar and name. Add a team switcher below it:

```
┌──────────────────────────┐
│  👤 Alice                │
│  📂 Alice's workspace  ▾ │  ← Team switcher dropdown
│───────────────────────────│
│  Alice's workspace    ✓  │
│  Acme Corp               │
│  Research Lab             │
│  ─────────────────────── │
│  + Create team            │
│  ⚙ Team settings          │
└──────────────────────────┘
```

Selecting a team:
1. Updates `activeTeamId` in a new `team-context-store`
2. All data-fetching stores re-fetch with the new team scope
3. URL doesn't change (team context is global, not in the URL)

### 10.2 Settings → Teams Tab (Enhanced)

The current teams tab in settings has the structure but handlers were stubs. They're now wired to real endpoints. Enhance the UI:

```
┌─ Teams ──────────────────────────────────────────────┐
│                                                       │
│  Your Teams                     [+ Create Team]       │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 📂 Alice's workspace          owner    Personal │ │
│  │ 📂 Acme Corp                  admin    3 members│ │
│  │ 📂 Research Lab               member   7 members│ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ─── Acme Corp ───────────────────────────────────── │
│                                                       │
│  Members (3)                                          │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 👤 Alice             alice@acme.com      admin  │ │
│  │ 👤 Bob               bob@acme.com        owner  │ │
│  │ 👤 Charlie           charlie@acme.com    member │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Pending Invitations (1)                              │
│  ┌─────────────────────────────────────────────────┐ │
│  │ ✉️ dave@acme.com     member   Expires in 5d  ✕ │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Invite Member                                        │
│  ┌──────────────────────────┐ ┌──────┐ ┌────────┐   │
│  │ email@example.com        │ │member│ │ Invite  │   │
│  └──────────────────────────┘ └──────┘ └────────┘   │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### 10.3 Invite Acceptance Page

New route: `/invite/:token`

```
┌──────────────────────────────────────┐
│             ✦ Astro                  │
│                                      │
│    You're invited to join            │
│    Acme Corp                         │
│                                      │
│    Invited by: Bob (bob@acme.com)    │
│    Role: member                      │
│    Expires: Feb 28, 2026             │
│                                      │
│  ┌────────────────────────────────┐  │
│  │     Accept Invitation          │  │  ← If logged in
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Sign in to accept             │  │  ← If not logged in
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

If the user is not logged in, they're redirected to `/login?redirect=/invite/:token`. After login/registration, they return here and accept.

---

## 11. Supabase Configuration

### 11.1 OAuth Provider Setup

**Google:**
```
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOTRUE_EXTERNAL_GOOGLE_SECRET=<from Google Cloud Console>
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://astro-supabase.example.com/auth/v1/callback
```

**GitHub:**
```
GOTRUE_EXTERNAL_GITHUB_ENABLED=true
GOTRUE_EXTERNAL_GITHUB_CLIENT_ID=<from GitHub Developer Settings>
GOTRUE_EXTERNAL_GITHUB_SECRET=<from GitHub Developer Settings>
GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI=https://astro-supabase.example.com/auth/v1/callback
```

For local development with `supabase start`, add these to `supabase/config.toml`:

```toml
[auth.external.google]
enabled = true
client_id = "env(GOOGLE_CLIENT_ID)"
secret = "env(GOOGLE_CLIENT_SECRET)"

[auth.external.github]
enabled = true
client_id = "env(GITHUB_CLIENT_ID)"
secret = "env(GITHUB_CLIENT_SECRET)"
```

### 11.2 Email Verification Settings

```toml
[auth]
enable_signup = true
double_confirm_changes = true  # Require email confirmation for email changes

[auth.email]
enable_signup = true
enable_confirmations = true  # Send verification emails
```

### 11.3 Redirect URLs

Configure allowed redirect URLs in Supabase dashboard:
- `https://astro.fuxialexander.work/**`
- `http://localhost:5173/**`

---

## 12. Backend Changes Required

### 12.1 Auth Route Changes

**`server/routes/auth.ts`**

1. **`register-verify`**: Change `email_confirm: true` to `email_confirm: false` for passkey registration. Send verification email after account creation.

2. **New endpoint: `POST /api/auth/resend-verification`**
   ```typescript
   // Resend the verification email
   const { error } = await supabase.auth.resend({
     type: 'signup',
     email,
   })
   ```

3. **New endpoint: `GET /api/auth/user-status`**
   ```typescript
   // Returns { verified: boolean, providers: string[], teams: number }
   // Frontend uses this to show/hide the verification banner
   ```

### 12.2 OAuth Session Handling

**New file: `server/routes/oauth-callback.ts`** (or handled in auth.ts)

After OAuth login, Supabase redirects back to the frontend. The frontend's `onAuthStateChange` fires. We need a post-login hook:

```typescript
// In auth-store.ts onAuthStateChange handler:
if (event === 'SIGNED_IN' && session) {
  // Ensure user profile exists (OAuth users may not have one)
  await fetch(apiUrl('/api/auth/ensure-profile'), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: session.user.user_metadata?.full_name || session.user.user_metadata?.name,
      avatarUrl: session.user.user_metadata?.avatar_url,
    }),
  })
}
```

**New endpoint: `POST /api/auth/ensure-profile`**
```typescript
// Uses existing ensureUserProfile() + auto-create team logic
// Sets name and avatar from OAuth metadata
// Idempotent — safe to call on every login
```

### 12.3 Dispatch Engine — Verification Gate

**`server/lib/dispatch/dispatch-engine.ts`**

Add verification check before task dispatch:

```typescript
async function verifyUserCanDispatch(userId: string): Promise<void> {
  const supabase = getServiceClient()
  const { data } = await supabase.auth.admin.getUserById(userId)

  if (!data?.user?.email_confirmed_at) {
    throw new Error(
      'Email verification required. Please check your inbox and click the verification link before running tasks.'
    )
  }
}
```

### 12.4 Device Auth — Verification Gate

**`server/routes/device-auth.ts`**

Add verification check before issuing device codes:

```typescript
// In POST /api/device/authorize:
if (!authUser?.email_confirmed_at) {
  return c.json({
    error: 'Email verification required to register machines',
  }, 403)
}
```

---

## 13. Frontend Changes Required

### 13.1 Login Page (`src/pages/login.tsx`)

Add OAuth buttons below the email form:

```typescript
import { getSupabase } from "@/lib/supabase-client"

const handleGoogleLogin = async () => {
  const supabase = getSupabase()
  if (!supabase) return
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${from}` },
  })
}

const handleGitHubLogin = async () => {
  const supabase = getSupabase()
  if (!supabase) return
  await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${window.location.origin}${from}`,
      scopes: 'read:user user:email',
    },
  })
}
```

### 13.2 Verification Banner Component

New component: `src/components/verification-banner.tsx`

```typescript
export function VerificationBanner() {
  const user = useAuthStore((s) => s.user)
  const [resending, setResending] = useState(false)

  // email_confirmed_at is in user.user_metadata or user object
  const isVerified = !!user?.email_confirmed_at
  if (isVerified) return null

  const handleResend = async () => {
    setResending(true)
    await fetch(apiUrl('/api/auth/resend-verification'), {
      method: 'POST',
      headers: { /* auth headers */ },
    })
    setResending(false)
  }

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-sm">
      Verify your email to unlock task execution and team features.
      <button onClick={handleResend}>
        {resending ? 'Sending...' : 'Resend verification email'}
      </button>
    </div>
  )
}
```

Add this to `app-layout.tsx` above `<Outlet />`.

### 13.3 Team Context Store

New store: `src/stores/team-context-store.ts`

```typescript
interface TeamContextState {
  activeTeamId: string | null
  teams: Array<{ id: string; name: string; role: string }>
  setActiveTeam: (teamId: string) => void
  loadTeams: () => Promise<void>
}
```

All data-fetching stores read `activeTeamId` and pass it as a filter parameter to backend APIs.

### 13.4 Invite Acceptance Page

New route: `/invite/:token` → `src/pages/invite-accept.tsx`

Fetches invite details from `GET /api/teams/invite/:token`, shows team name and inviter, and calls `POST /api/teams/accept/:token` on accept.

---

## 14. Implementation Phases

### Phase 1: Verification Gate (Immediate Priority)

**Goal:** Prevent unverified accounts from consuming compute.

1. Change `register-verify` to set `email_confirm: false`
2. Send verification email on registration
3. Add `POST /api/auth/resend-verification`
4. Add `GET /api/auth/user-status`
5. Add verification check in dispatch engine
6. Add `VerificationBanner` component
7. Frontend: check `email_confirmed_at` and show banner

### Phase 2: OAuth Providers

**Goal:** Google and GitHub login.

1. Configure Google OAuth in Supabase
2. Configure GitHub OAuth in Supabase
3. Add OAuth buttons to login page
4. Add `POST /api/auth/ensure-profile` endpoint
5. Wire `onAuthStateChange` to call ensure-profile for OAuth users
6. Test: new Google user → gets profile + personal team
7. Test: existing passkey user → links Google identity

### Phase 3: Team UI Enhancements

**Goal:** Team switching and invite acceptance.

1. Create `team-context-store.ts`
2. Add team switcher to sidebar
3. Enhance settings → teams tab (already mostly done)
4. Create `/invite/:token` page
5. Wire project creation to use `activeTeamId`
6. Add team scope to data fetching

### Phase 4: Polish

**Goal:** Production readiness.

1. Rate limits on dispatch and device-auth
2. Audit logging for auth events
3. Account deletion cascade improvements
4. Session management UI (active sessions, revoke)
5. Email templates (branded HTML for verification + invite)

---

## 15. Security Considerations

### 15.1 Passkey Credential ID Uniqueness

The `passkey_credentials` table uses `id` (WebAuthn credential ID) as the primary key. This is globally unique per (RP ID, authenticator) pair, but could theoretically collide if two users register from the same device with the same RP ID.

**Mitigation:** The `excludeCredentials` parameter in `generateRegistrationOptions` prevents the authenticator from reusing an existing credential ID. If a collision occurs anyway, the INSERT fails with a unique constraint violation, and the user sees an error asking them to try again.

**Future consideration:** If this becomes an issue, switch to a synthetic primary key (UUID) and make `(id, user_id)` a unique constraint instead.

### 15.2 Email Enumeration

The `/check-user` endpoint reveals whether an email is registered. This is necessary for the "passkey vs registration" decision tree but leaks information.

**Current mitigation:** Rate limiting (30/15min per IP).

**Future mitigation:** Use constant-time responses (same delay for exists/not-exists), or remove the check-user step and always attempt passkey auth first, falling through to registration on failure.

### 15.3 OAuth Token Security

Supabase handles OAuth token exchange server-side. The frontend never sees the OAuth access token — only the Supabase JWT. The OAuth access/refresh tokens are stored in Supabase's `auth.identities` table, encrypted at rest.

### 15.4 Magic Link Security

Magic links are single-use, expire in 1 hour (Supabase default), and are bound to the requesting IP (optional Supabase setting). The link contains a hashed token, not the raw token.

---

## 16. Migration Path

### From Current State

The current system works. The changes are additive — no breaking migrations.

1. Existing passkey users: unaffected. Their `email_confirmed_at` is set (because `createUser` was called with `email_confirm: true`).
2. Existing magic link users: already verified (clicked the link).
3. New passkey users after Phase 1: unverified until they click the verification email. But they can still browse and plan.

### Database Changes

No schema changes needed. All auth state lives in Supabase's `auth.users` table (managed by Supabase, not our migrations). The `user_profiles`, `teams`, `team_members`, and `invite_tokens` tables already exist.

The only new table consideration is if we want a `user_auth_methods` table to track which methods a user has configured (for the settings → security page). But Supabase's `auth.identities` already provides this information.

---

## 17. Local Mode — No Authentication

Local mode (`USE_INDEXEDDB_ONLY=true` or no Supabase env vars) uses a completely different path that bypasses the entire auth system. **None of the authentication bugs described in this document affect local mode.**

### 17.1 How Local Mode Works

```
src/lib/app-mode.ts:
  isLocalMode() → true when Supabase is not configured

auth-store.ts initialize():
  if (isLocalMode()) {
    set({ session: null, user: null, loading: false, initialized: true })
    return  // ← Skips all Supabase auth
  }

DataLoader (src/app.tsx):
  shouldLoadData = isLocalMode() || !!(authInitialized && session)
  // In local mode: shouldLoadData = true (always)
  // session is null — but local mode doesn't care
```

**Key differences:**

| Concern | Server Mode | Local Mode |
|---------|-------------|------------|
| Authentication | WebAuthn passkeys + magic link + (future) OAuth | None |
| User identity | Supabase `auth.users.id` | Fixed `LOCAL_USER_ID` constant |
| Team scoping | `X-Team-Id` header on all API calls | Fixed `LOCAL_TEAM_ID` constant |
| Session management | Supabase JWT + refresh tokens | No sessions |
| Data isolation | RLS policies per user/team | Single user, no isolation |
| Store reset on user change | Required (see §18.3) | N/A — user never changes |
| WelcomeProfileDialog | Can race with API load | Profile loaded from IndexedDB (instant) |

### 17.2 Why Local Mode Has No Auth Bugs

The entire class of authentication bugs stems from **state transitions between users** — signing out of one account and into another, or registering a new account while stale state from a previous session persists. In local mode:

1. There is no sign-in or sign-out — the app always loads
2. There is no `session` object — `auth-store` sets `session: null` and stops
3. The `X-Team-Id` header uses a fixed constant — it can never be stale
4. There is no WebAuthn ceremony — no RP ID to mismatch
5. DataLoader loads all stores unconditionally — no two-phase team-first requirement

Local mode is effectively a single-user desktop app with IndexedDB persistence.

---

## 18. Implemented Authentication Flow — State Machine

This section documents the **actual implemented flow** as of 2026-02-22, including all edge cases discovered through production debugging.

### 18.1 Complete Login/Registration State Machine

```
┌─────────────────────────────────────────────────────────────────────┐
│                      APP STARTUP                                    │
│                                                                     │
│  auth-store.initialize()                                            │
│       │                                                             │
│       ├─ isLocalMode()? ──Yes──▶ set(session:null, initialized:true)│
│       │                         ▶ DataLoader loads everything       │
│       │                         ▶ DONE (no auth)                    │
│       │                                                             │
│       └─ No (server mode)                                           │
│            │                                                        │
│            ▼                                                        │
│    supabase.auth.getSession()                                       │
│            │                                                        │
│            ├─ Has session? ──Yes──▶ set(session, initialized:true)  │
│            │                       ▶ setupRealtimeSync()            │
│            │                       ▶ DataLoader Phase 1: loadTeams()│
│            │                       ▶ DataLoader Phase 2: all stores │
│            │                       ▶ AuthGuard allows routes        │
│            │                                                        │
│            └─ No session ──▶ set(null, initialized:true)            │
│                              ▶ AuthGuard redirects to /login        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      LOGIN PAGE (/login)                            │
│                                                                     │
│  ┌──────────┐                                                       │
│  │  EMAIL   │ User enters email, presses Enter / clicks Continue    │
│  │  STEP    │                                                       │
│  └────┬─────┘                                                       │
│       │                                                             │
│       ▼                                                             │
│  POST /api/auth/webauthn/check-user { email }                       │
│       │                                                             │
│       ├─ { exists: true, hasCredentials: true }                     │
│       │    ▶ Existing user WITH passkeys on this RP domain          │
│       │    ▶ setStep("authenticating")                              │
│       │    ▶ Jump to PASSKEY LOGIN flow ─────────────────────┐      │
│       │                                                      │      │
│       ├─ { exists: true, hasCredentials: false, name: "X" }  │      │
│       │    ▶ Returning user WITHOUT passkeys (new device,    │      │
│       │      credentials purged, or RP_ID changed)           │      │
│       │    ▶ Pre-fill name with "X" from database            │      │
│       │    ▶ setIsReturningUser(true)                        │      │
│       │    ▶ setStep("name") — show "Welcome back!"         │      │
│       │    ▶ Jump to PASSKEY REGISTRATION flow ──────┐       │      │
│       │                                              │       │      │
│       └─ { exists: false }                           │       │      │
│            ▶ Brand new user                          │       │      │
│            ▶ setIsReturningUser(false)               │       │      │
│            ▶ setStep("name") — show "Create account" │       │      │
│            ▶ Jump to PASSKEY REGISTRATION flow ──────┤       │      │
│                                                      │       │      │
│  ┌───────────────────────────────────────────────────┘       │      │
│  │  PASSKEY REGISTRATION FLOW                                │      │
│  │                                                           │      │
│  │  ┌──────────┐                                             │      │
│  │  │  NAME    │ User enters/confirms name                   │      │
│  │  │  STEP    │ Clicks "Create Account" / "Register Passkey"│      │
│  │  └────┬─────┘                                             │      │
│  │       │                                                   │      │
│  │       ▼                                                   │      │
│  │  ★ CRITICAL: supabase.auth.signOut()                      │      │
│  │    (Clear stale session BEFORE registration —             │      │
│  │     prevents identity confusion bug, see §18.4)           │      │
│  │       │                                                   │      │
│  │       ▼                                                   │      │
│  │  POST /api/auth/webauthn/register-options { email, name } │      │
│  │       │                                                   │      │
│  │       ▼                                                   │      │
│  │  Browser WebAuthn ceremony (Face ID / Touch ID)           │      │
│  │       │                                                   │      │
│  │       ▼                                                   │      │
│  │  POST /api/auth/webauthn/register-verify { email, name,   │      │
│  │                                            credential }   │      │
│  │       │                                                   │      │
│  │  Backend does:                                            │      │
│  │    1. admin.createUser({ email, email_confirm: true })    │      │
│  │    2. Store passkey credential in passkey_credentials     │      │
│  │    3. Create user_profiles row with name                  │      │
│  │    4. Auto-create personal team                           │      │
│  │    5. admin.generateLink({ type:'magiclink', email })     │      │
│  │    6. Return { session: { properties: { hashed_token } } }│      │
│  │       │                                                   │      │
│  │       ▼                                                   │      │
│  │  Frontend exchanges hashed_token:                         │      │
│  │    supabase.auth.verifyOtp({ token_hash, type:'magiclink'})│     │
│  │       │                                                   │      │
│  │       ▼                                                   │      │
│  │  Wait for onAuthStateChange(SIGNED_IN)                    │      │
│  │    (Up to 2s timeout — ensures session is in store        │      │
│  │     before navigating)                                    │      │
│  │       │                                                   │      │
│  │       ▼                                                   │      │
│  │  navigate(from) → App loads                               │      │
│  └───────────────────────────────────────────────────────────┘      │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────────┘
│  │  PASSKEY LOGIN FLOW
│  │
│  │  POST /api/auth/webauthn/login-options { email }
│  │       │
│  │       ▼
│  │  Browser WebAuthn ceremony (authenticate existing credential)
│  │       │
│  │       ▼
│  │  POST /api/auth/webauthn/login-verify { credential, challengeKey }
│  │       │
│  │  Backend does:
│  │    1. Verify credential against stored passkey
│  │    2. admin.generateLink({ type:'magiclink', email })
│  │    3. Return { session: { properties: { hashed_token } } }
│  │       │
│  │       ▼
│  │  Frontend exchanges hashed_token (same as registration)
│  │       │
│  │       ▼
│  │  Wait for onAuthStateChange(SIGNED_IN)
│  │       │
│  │       ▼
│  │  navigate(from) → App loads
│  └───────────────────────────────────────────────────────────────────
│
│  ALTERNATIVE: MAGIC LINK FLOW
│
│  User clicks "Sign in with email link"
│       │
│       ▼
│  supabase.auth.signInWithOtp({ email, emailRedirectTo })
│       │
│       ▼
│  setStep("magic_link_sent") — "Check your email"
│       │
│       ▼
│  User clicks link in email → Supabase creates session
│       → onAuthStateChange(SIGNED_IN) fires
│       → App loads
│
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                  POST-LOGIN: DataLoader                              │
│                                                                     │
│  ★ TWO-PHASE LOADING (prevents stale team ID bug, see §18.3)       │
│                                                                     │
│  Phase 1 (depends on: shouldLoadData, userId):                      │
│    1. Detect user change: lastUserIdRef.current !== userId?          │
│       → Yes: resetAllStores() — clears ALL Zustand stores +        │
│         clears _activeTeamId in both data-client and api-client     │
│    2. loadTeams() → fetches teams → calls setActiveTeamId(id)       │
│       → This sets X-Team-Id header for all subsequent API calls     │
│                                                                     │
│  Phase 2 (depends on: shouldLoadData, teamsLoaded):                 │
│    3. Only runs AFTER teamsLoaded === true                           │
│    4. Loads: projects, plan, settings, profile, executions, etc.    │
│    5. Connects realtime (Supabase Realtime channels)                │
│    6. Caches browser hostname                                       │
│                                                                     │
│  Loading screen shown until allLoaded (including teamsLoaded)       │
└─────────────────────────────────────────────────────────────────────┘
```

### 18.2 WebAuthn RP ID — Domain Configuration

The WebAuthn Relying Party ID (RP ID) determines which domain passkeys are bound to. This is the single most critical configuration value in the auth system.

```
RP_ID must match the FRONTEND domain (where the browser runs):
  ✓  RP_ID = "astro.fuxialexander.work"     (frontend domain)
  ✗  RP_ID = "astro-api.fuxialexander.work"  (backend domain — WRONG)
  ✗  RP_ID = "localhost"                      (dev only — breaks production)

RP_ORIGIN must match the FRONTEND origin:
  ✓  RP_ORIGIN = "https://astro.fuxialexander.work"
  ✗  RP_ORIGIN = "https://astro-api.fuxialexander.work"

server/routes/auth.ts reads these from env:
  const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost'
  const RP_ORIGIN = process.env.WEBAUTHN_RP_ORIGIN || 'http://localhost:5173'
```

**What happens when RP_ID is wrong:**
- Registration succeeds (the browser accepts any RP ID on the current origin)
- Login fails with `SecurityError` — the authenticator looks for a credential matching the RP ID and can't find one
- Existing passkeys become invalid — they were registered under the wrong RP ID
- The user sees: "Passkey configuration error. The server's domain settings don't match this site."
- Fix requires: correct the env vars AND delete the stale `passkey_credentials` rows from Supabase

### 18.3 Stale Team ID — The X-Team-Id Header Bug

**The bug:** After switching users (sign out → sign in as different user), the new user sees the old user's data.

**Root cause chain:**
```
1. User A logs in
2. team-store.load() fetches User A's teams
3. setActiveTeamId("team-A-id") sets module-level _activeTeamId
4. All API calls include X-Team-Id: team-A-id
5. User A signs out (but _activeTeamId is NOT cleared)
6. User B logs in (or registers)
7. DataLoader starts loading stores — WITH the stale X-Team-Id: team-A-id
8. Backend RLS says "User B is not a member of team-A-id" → returns empty data
   OR: backend returns team A's data (if RLS is misconfigured)
9. User B sees empty/wrong data
```

**The fix (implemented in `src/app.tsx`):**
```
function resetAllStores() {
  // Reset team store FIRST — clears stale team ID from API headers
  useTeamStore.setState({ teams: [], teamMembers: {}, loaded: false })
  setActiveTeamId(undefined)       // ← Clears data-client._activeTeamId
  setApiActiveTeamId(undefined)    // ← Clears api-client._activeTeamId
  // ... reset all other stores ...
}
```

**Plus two-phase DataLoader:**
- Phase 1: Load teams (which calls `setActiveTeamId(newTeamId)`)
- Phase 2: Load everything else (all API calls now use correct `X-Team-Id`)

**Invariant:** `_activeTeamId` must ALWAYS belong to the currently authenticated user. Any code path that changes the user (login, logout, registration) must clear `_activeTeamId` before any API calls.

### 18.4 Identity Confusion — Stale Session During Registration

**The bug:** User A is logged in. User A navigates to /login and registers a NEW account (User B). After registration completes, the app shows User A's data.

**Root cause:**
```
1. User A is logged in — Supabase session is in localStorage
2. User A goes to /login and enters a new email
3. Backend register-verify creates User B, generates a magic link
4. Frontend calls supabase.auth.verifyOtp(token_hash) for User B
5. BUT: Supabase's session management sees the existing User A session
   and may not fully replace it, OR onAuthStateChange fires with
   the session but DataLoader doesn't detect it as a "user change"
6. The stores still hold User A's data
```

**The fix (implemented in `src/pages/login.tsx`):**
```typescript
// Clear any stale session before registration to prevent identity conflicts
const supabase = getSupabase()
if (supabase) {
  await supabase.auth.signOut()  // ← Ensures clean slate
}
// THEN proceed with registration...
```

**Plus:** DataLoader tracks `lastUserIdRef` and calls `resetAllStores()` when `userId` changes.

### 18.5 WelcomeProfileDialog Race Condition

**The bug:** The "Welcome! Set your name" dialog appears even for users who already have a name set.

**Root cause:**
```
1. WelcomeProfileDialog reads useUserProfileStore(s => s.profile)
2. On mount, the store hasn't loaded from the API yet
3. profile.name is the default empty value
4. !profile.name evaluates to true → dialog opens
5. A moment later, the API response arrives with the actual name
6. But the dialog is already open
```

**The fix (implemented in `src/components/welcome-profile-dialog.tsx`):**
```typescript
const loaded = useUserProfileStore((s) => s.loaded)
useEffect(() => {
  if (dismissed) return
  if (!loaded) return  // ← Wait until API response arrives
  const needsName = !profile.name || profile.name.includes("@") || ...
  if (needsName) {
    const timer = setTimeout(() => setOpen(true), 1000)
    return () => clearTimeout(timer)
  }
}, [profile.name, loaded, dismissed])
```

**General principle:** Never make UI decisions based on Zustand store state until `loaded === true`.

### 18.6 Returning User Without Passkeys

**The bug:** A user who previously registered but has no passkeys on the current RP domain (e.g., after RP_ID was fixed) is treated as a brand new user and asked for their name again.

**Root cause:** `check-user` returned `{ exists: true, hasCredentials: false }` but no name — so the frontend showed the full registration form.

**The fix:**
- Backend `check-user` now returns `{ exists, hasCredentials, name }` from `user_profiles`
- Frontend detects `exists && !hasCredentials && existingName` → pre-fills name, shows "Welcome back! Register a new passkey"
- Button says "Register Passkey" instead of "Create Account"

---

## 19. Critical Invariants

These invariants must be maintained. Violating any of them produces the bugs described above.

1. **RP_ID = frontend domain.** Not backend domain. Not localhost in production. Checked via `WEBAUTHN_RP_ID` env var.

2. **`_activeTeamId` always matches current user.** Clear it in `resetAllStores()`. Set it only in `team-store.load()` after fetching the current user's teams.

3. **Teams load before everything else.** DataLoader Phase 1 (teams) must complete before Phase 2 (projects, plans, etc.) because all API calls use `X-Team-Id`.

4. **Sign out before new registration.** `login.tsx` calls `supabase.auth.signOut()` at the start of `handleRegister()` to prevent session overlap.

5. **Don't read store state before `loaded === true`.** Any component that makes decisions based on store data (profile name, team list, etc.) must check the `loaded` flag first.

6. **`resetAllStores()` must reset ALL stores.** When a new store is added to DataLoader, it must also be added to `resetAllStores()`. The team store must be reset FIRST (to clear the X-Team-Id header).

---

## 20. Testing Checklist

### Registration
- [ ] New user: enter email → enter name → passkey ceremony → lands in app with correct data
- [ ] New user: enter email → click "Email link instead" → receive email → click link → lands in app
- [ ] Returning user without passkey: enter email → sees "Welcome back!" with pre-filled name → register passkey → lands in app

### Login
- [ ] Existing user with passkey: enter email → auto-authenticates → lands in app
- [ ] Existing user, passkey fails: sees error → can try magic link

### User Switching
- [ ] Sign out → sign in as different user → sees new user's data (not old user's)
- [ ] Register User A → sign out → register User B → User B sees own empty workspace
- [ ] Sign out → sign in → team ID in network requests matches new user's team

### Local Mode
- [ ] Start with `npm run dev:indexeddb` → app loads immediately, no login page
- [ ] No auth-related errors in console
- [ ] All features work without authentication
