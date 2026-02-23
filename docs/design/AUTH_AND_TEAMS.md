# Authentication, Registration, and Teams — Production Design

> **Status:** PARTIALLY IMPLEMENTED — Passkeys + magic link are live.
> Teams with auto-creation and data isolation are implemented.
> OAuth (Google/GitHub) is designed but not yet implemented.
> This document specifies the production-grade auth system and documents
> critical implementation lessons from production debugging.
>
> **Design revision (2026-02-22):** Removed the email verification gate.
> Astro is a coordination layer — the backend never calls AI directly, and
> agents bring their own compute (Claude API keys + machines). There is no
> server-side cost to protect, so there is no reason to gate features behind
> email verification. All registration methods grant full access immediately.
> Agents (e.g., OpenClaw) are welcome as first-class users — they are a
> distribution channel, not a threat.

---

## 1. Design Principles

1. **Zero friction registration.** Anyone with an email can register in seconds and immediately use all features. No verification gates, no feature walls.
2. **Multiple login methods, all equal.** Passkeys, magic link, Google, GitHub. All grant full access. Users choose based on convenience; the system links them to one identity by email.
3. **Agents are welcome.** Astro is a coordination layer — the backend never calls AI directly. Agents bring their own compute (Claude API keys + machines via the relay). There is no server-side cost to protect, so agents (e.g., OpenClaw) can self-register and use the platform freely. They are a distribution channel: agent discovers Astro → human owner sees value → becomes a user → invites team.
4. **Passkey is optional, not required.** Passkey provides phishing-resistant login and faster sign-in (biometric), but it is never mandatory. Users can register and operate entirely via magic link or OAuth.
5. **Teams are first-class.** Every user belongs to at least one team (their personal workspace). All data is team-scoped. Team switching is explicit in the UI.

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
┌──────────────┐       ┌──────────────────┐       ┌──────────────────┐
│ Full Account │       │  Full Account    │       │  Full Account    │
│ (passkey)    │       │  (magic link)    │       │  (OAuth)         │
└──────┬───────┘       └────────┬─────────┘       └────────┬─────────┘
       │                        │                           │
       └────────────────────────┼───────────────────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │      Active Account      │
                   │  • Full platform access   │
                   │  • Execute tasks          │
                   │  • Register machines      │
                   │  • Create/join teams      │
                   │  • Invite members         │
                   │  • Create API keys        │
                   └──────────────────────────┘
```

All registration methods grant **full access immediately**. There is no verification gate.

### 2.1 Why No Verification Gate?

The original design gated task execution behind email verification to prevent compute abuse. This was based on the assumption that unverified accounts could consume expensive server-side AI resources.

**This assumption is wrong for Astro's architecture:**

1. **The backend never calls AI directly** (see `ARCHITECTURE.md` §1.3). All AI execution flows through the Relay to Agent Runners on the user's own machines.
2. **Agents bring their own Claude API keys.** The cost of task execution is borne by the user/agent, not by Astro.
3. **Agents bring their own compute.** Agent runners connect to the relay with their own hardware. Astro is a coordination layer.
4. **Storage costs are negligible.** Projects, plans, and metadata are small. The Postgres cost of a million empty accounts is trivial.

The only server-side resource worth protecting is **API endpoint bandwidth**, which is handled by standard rate limiting (§6.3), not feature gating.

### 2.2 Agents as First-Class Users

Agents (e.g., OpenClaw) can register and use Astro the same way humans do. The expected virality loop:

```
Agent discovers Astro → creates account (magic link or device-auth)
  → creates projects, dispatches tasks to own machines
  → human owner sees value in the planning layer
  → human creates their own account or takes over agent's account
  → human invites teammates → organic growth
```

Blocking agent registration would block this distribution channel. Since agents can't consume our resources (they bring their own), there is no reason to gate them.

### 2.3 Adding Passkey After Registration

Users who registered via magic link or OAuth can add a passkey later for faster login:

```
POST /api/auth/webauthn/add-passkey
  → requires authenticated session (any method)
  → generates WebAuthn registration options for existing user
  → browser biometric ceremony
  → stores new credential against user_id
```

The UI nudges this with a non-blocking banner:

```
┌──────────────────────────────────────────────────────────┐
│ Add a passkey for faster sign-in.  [Add passkey]  [Later]│
└──────────────────────────────────────────────────────────┘
```

---

## 3. Registration Flows

### 3.1 Email + Passkey Registration (current)

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
   │                                │                                │
   │◄── { verified: true,          │                                │
   │      session } ───────────────│                                │
   │                                │                                │
   │  [User lands in app with      │                                │
   │   full access immediately]    │                                │
```

Registration creates the account with `email_confirm: true` and grants full access immediately. No verification email, no feature gates.

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

Astro's abuse surface is narrow because the backend is a **coordination layer**, not a compute provider. The backend never calls AI directly — agents bring their own Claude API keys and machines. The primary resources to protect are API endpoint bandwidth and Postgres storage.

| Threat | Risk | Mitigation |
|--------|------|------------|
| Mass account creation (bots) | **Low** — accounts are cheap (Postgres rows). No compute to steal. | Rate limiting on registration endpoints |
| Agents creating accounts | **Not a threat** — agents are welcome. They bring their own compute. | N/A (this is a feature, not a bug) |
| Credential stuffing (try leaked passwords) | **None** — no passwords in the system | Passkeys + OTP only |
| Passkey phishing | **None** | RP ID binding makes passkeys unphishable |
| Email enumeration via `/check-user` | **Low** | Rate limited (30 req/15min per IP), returns minimal info |
| OAuth token theft | **Low** | Short-lived JWTs, refresh tokens rotated on use |
| Team invitation spam | **Medium** | Only admins/owners can send invites; rate limited |
| Invite link sharing/forwarding | **Low** | Invite is bound to specific email; accept endpoint verifies match |
| API endpoint DDoS | **Medium** | Per-IP and per-user rate limiting on all endpoints |

### 6.2 No Verification Gate

The previous design gated task dispatch and machine registration behind email verification (`email_confirmed_at`). **This gate has been removed** because:

1. Task execution runs on the user's/agent's own machines via the relay — no server-side AI cost
2. Plan generation runs on the user's/agent's own machines via the relay — no server-side AI cost
3. Storage costs for projects/plans are negligible
4. The gate would block legitimate agents (OpenClaw, etc.) from using the platform

All features are available immediately after registration, regardless of method.

### 6.3 Rate Limits

Rate limiting is the primary abuse prevention mechanism. It protects API bandwidth without blocking features.

| Endpoint | Current | Target |
|----------|---------|--------|
| `/auth/webauthn/check-user` | 30/15min per IP | Keep |
| `/auth/webauthn/register-options` | 30/15min per IP | Keep |
| `/auth/webauthn/login-options` | 30/15min per IP | Keep |
| `/api/dispatch/task` | None | 10/min per user |
| `/api/teams/invite` | None | 20/hour per user |
| `/api/device/authorize` | None | 10/hour per user |
| `/api/data/*` | None | 100/min per user |

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

### 9.3 Passkey Nudge Banner

For users who registered via magic link or OAuth (no passkey), show a non-blocking nudge:

```
┌──────────────────────────────────────────────────────────────┐
│ Add a passkey for faster sign-in.  [Add passkey]  [Later]    │
└──────────────────────────────────────────────────────────────┘
```

This banner appears until the user either adds a passkey or dismisses it. Dismissal is persisted in `user_profiles` metadata. The banner does NOT block any features — it is purely a convenience suggestion.

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

### 11.2 Email Settings

```toml
[auth]
enable_signup = true
double_confirm_changes = true  # Require email confirmation for email changes

[auth.email]
enable_signup = true
enable_confirmations = false  # No verification emails — full access on registration
```

### 11.3 Redirect URLs

Configure allowed redirect URLs in Supabase dashboard:
- `https://astro.your-domain.com/**`
- `http://localhost:5173/**`

---

## 12. Backend Changes Required

### 12.1 Auth Route Changes

**`server/routes/auth.ts`**

1. **`register-verify`**: Keep `email_confirm: true`. No verification email needed — full access is granted immediately.

2. **New endpoint: `POST /api/auth/webauthn/add-passkey`**
   ```typescript
   // Allows authenticated users to add a passkey to their existing account.
   // Same WebAuthn registration ceremony, but skips admin.createUser().
   // Stores credential against the existing user_id.
   ```

3. **No verification endpoints needed.** The `resend-verification` and `user-status` endpoints from the previous design are not needed since there is no verification gate.

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

### 12.3 No Dispatch or Device Auth Gates

The previous design added `email_confirmed_at` checks in the dispatch engine and device-auth routes. **These are not needed.** The backend never calls AI directly — agents bring their own compute. All authenticated users can dispatch tasks and register machines immediately.

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

### 13.2 Passkey Nudge Banner Component

New component: `src/components/passkey-nudge-banner.tsx`

```typescript
export function PasskeyNudgeBanner() {
  const user = useAuthStore((s) => s.user)
  const profile = useUserProfileStore((s) => s.profile)
  const [dismissed, setDismissed] = useState(false)

  // Check if user already has passkeys (via profile metadata or identities)
  const hasPasskey = profile?.metadata?.hasPasskey
  if (hasPasskey || dismissed) return null

  const handleAddPasskey = async () => {
    // Navigate to passkey registration flow
    // POST /api/auth/webauthn/add-passkey
  }

  return (
    <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 py-2 text-sm flex items-center justify-between">
      <span>Add a passkey for faster sign-in.</span>
      <div className="flex gap-2">
        <button onClick={handleAddPasskey}>Add passkey</button>
        <button onClick={() => setDismissed(true)}>Later</button>
      </div>
    </div>
  )
}
```

Add this to `app-layout.tsx` above `<Outlet />`. Dismissal state persisted via user profile metadata.

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

### Phase 1: OAuth Providers (Immediate Priority)

**Goal:** Google and GitHub login — the fastest registration paths.

1. Configure Google OAuth in Supabase
2. Configure GitHub OAuth in Supabase
3. Add OAuth buttons to login page
4. Add `POST /api/auth/ensure-profile` endpoint
5. Wire `onAuthStateChange` to call ensure-profile for OAuth users
6. Test: new Google user → gets profile + personal team
7. Test: existing passkey user → links Google identity

### Phase 2: Add-Passkey Flow

**Goal:** Let existing users add passkeys for faster login.

1. Add `POST /api/auth/webauthn/add-passkey` endpoint
2. Add passkey nudge banner component
3. Add passkey management to settings → security tab
4. Test: magic link user → adds passkey → can login with passkey

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

1. Rate limits on all API endpoints (§6.3)
2. Audit logging for auth events
3. Account deletion cascade improvements
4. Session management UI (active sessions, revoke)
5. Email templates (branded HTML for invites)

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

1. Existing passkey users: unaffected. Their `email_confirmed_at` is set (because `createUser` was called with `email_confirm: true`). They continue to have full access.
2. Existing magic link users: unaffected.
3. New users: can register via any method (passkey, magic link, OAuth) and get full access immediately.

No verification gate was ever enforced in production, so removing it from the design requires zero code changes to the dispatch engine or device-auth routes.

### Database Changes

No schema changes needed. All auth state lives in Supabase's `auth.users` table (managed by Supabase, not our migrations). The `user_profiles`, `teams`, `team_members`, and `invite_tokens` tables already exist.

Supabase's `auth.identities` table tracks which login methods a user has configured (passkey, Google, GitHub). No additional table needed.

---

## 17. Local Mode — No Authentication

Local mode (`ASTRO_LOCAL_MODE=true` or no Supabase env vars) uses a completely different path that bypasses the entire auth system. **None of the authentication bugs described in this document affect local mode.**

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
| Authentication | Passkeys (optional) + magic link + Google/GitHub OAuth | None |
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
│  │       (email_confirm: true → full access immediately,     │      │
│  │        no verification gate — see §2.1)                   │      │
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
  ✓  RP_ID = "astro.your-domain.com"     (frontend domain)
  ✗  RP_ID = "astro-api.your-domain.com"  (backend domain — WRONG)
  ✗  RP_ID = "localhost"                      (dev only — breaks production)

RP_ORIGIN must match the FRONTEND origin:
  ✓  RP_ORIGIN = "https://astro.your-domain.com"
  ✗  RP_ORIGIN = "https://astro-api.your-domain.com"

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
- [ ] New user: enter email → enter name → passkey ceremony → lands in app with full access
- [ ] New user: enter email → click "Email link instead" → receive email → click link → lands in app with full access
- [ ] New user: click "Continue with Google" → OAuth flow → lands in app with profile + personal team
- [ ] New user: click "Continue with GitHub" → OAuth flow → lands in app with profile + personal team
- [ ] Returning user without passkey: enter email → sees "Welcome back!" with pre-filled name → register passkey → lands in app
- [ ] All registration methods: user can immediately dispatch tasks, register machines, create teams (no gates)

### Login
- [ ] Existing user with passkey: enter email → auto-authenticates → lands in app
- [ ] Existing user, passkey fails: sees error → can try magic link or OAuth
- [ ] Existing passkey user logs in via Google (same email) → same account, data preserved

### Add Passkey (post-registration)
- [ ] Magic link user: sees passkey nudge banner → clicks "Add passkey" → WebAuthn ceremony → passkey stored
- [ ] OAuth user: can add passkey from settings → security tab
- [ ] After adding passkey: can login with passkey on next visit
- [ ] Dismissing nudge banner: banner does not reappear

### User Switching
- [ ] Sign out → sign in as different user → sees new user's data (not old user's)
- [ ] Register User A → sign out → register User B → User B sees own empty workspace
- [ ] Sign out → sign in → team ID in network requests matches new user's team

### Local Mode
- [ ] Start with `npm run dev:local` → app loads immediately, no login page
- [ ] No auth-related errors in console
- [ ] All features work without authentication
