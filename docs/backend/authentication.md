# Authentication

WebAuthn/passkey authentication implementation for Astro.

## Overview

Astro uses **WebAuthn (passkeys)** for passwordless authentication in Server Mode. In Local Mode, authentication is disabled (single-user).

**Implementation:**
- Frontend: `@simplewebauthn/browser`
- Backend: `@simplewebauthn/server`
- Storage: Supabase `auth.users` + `passkey_credentials` table

## Authentication Flow

### Registration (New User)

```
User clicks "Sign up with passkey"
  ↓
Frontend: pages/login.tsx
  └─ GET /api/auth/webauthn/register-options
      ↓
Backend: Generates challenge
  ├─ Random challenge (32 bytes)
  ├─ User ID (new UUID)
  └─ RP ID (astro.fuxialexander.work)
  ↓
Frontend: navigator.credentials.create()
  ├─ User approves with biometric/PIN
  └─ Returns attestation
  ↓
Frontend: POST /api/auth/webauthn/register-verify
  ↓
Backend: Verifies attestation
  ├─ Validates challenge
  ├─ Extracts public key
  ├─ Creates user in auth.users
  ├─ Stores credential in passkey_credentials
  └─ Returns Supabase session tokens
  ↓
Frontend: Stores tokens
  ├─ Sets supabase.auth session
  └─ Redirects to dashboard
```

### Login (Returning User)

```
User clicks "Sign in with passkey"
  ↓
Frontend: Optional username entry
  └─ GET /api/auth/webauthn/login-options
      ↓
Backend: Generates assertion challenge
  ├─ Random challenge
  ├─ Optional: allowCredentials (for specific user)
  └─ Returns challenge
  ↓
Frontend: navigator.credentials.get()
  ├─ User approves with biometric/PIN
  └─ Returns assertion
  ↓
Frontend: POST /api/auth/webauthn/login-verify
  ↓
Backend: Verifies assertion
  ├─ Finds passkey_credentials by credential ID
  ├─ Retrieves user from auth.users
  ├─ Validates signature with stored public key
  ├─ Checks counter (prevent replay)
  ├─ Creates Supabase session
  └─ Returns session tokens
  ↓
Frontend: Sets session + redirects
```

## WebAuthn Endpoints

### POST /api/auth/webauthn/register-options

Generate registration challenge for new user.

**Request:**
```json
{
  "email": "user@example.com",
  "name": "Jane Doe"
}
```

**Response:**
```json
{
  "options": {
    "challenge": "base64-encoded-challenge",
    "rp": {
      "name": "Astro",
      "id": "astro.fuxialexander.work"
    },
    "user": {
      "id": "base64-user-id",
      "name": "user@example.com",
      "displayName": "Jane Doe"
    },
    "pubKeyCredParams": [
      { "type": "public-key", "alg": -7 },
      { "type": "public-key", "alg": -257 }
    ],
    "authenticatorSelection": {
      "authenticatorAttachment": "platform",
      "requireResidentKey": true,
      "userVerification": "required"
    },
    "timeout": 60000
  }
}
```

### POST /api/auth/webauthn/register-verify

Verify attestation and create user.

**Request:**
```json
{
  "email": "user@example.com",
  "name": "Jane Doe",
  "attestationResponse": {
    "id": "credential-id",
    "rawId": "base64-raw-id",
    "response": {
      "clientDataJSON": "base64-client-data",
      "attestationObject": "base64-attestation"
    },
    "type": "public-key"
  }
}
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "session": {
    "access_token": "jwt-token",
    "refresh_token": "refresh-token",
    "expires_in": 3600
  }
}
```

### POST /api/auth/webauthn/login-options

Generate assertion challenge for login.

**Request:**
```json
{
  "email": "user@example.com"  // Optional
}
```

**Response:**
```json
{
  "options": {
    "challenge": "base64-challenge",
    "rpId": "astro.fuxialexander.work",
    "allowCredentials": [
      {
        "type": "public-key",
        "id": "base64-credential-id",
        "transports": ["internal", "usb"]
      }
    ],
    "userVerification": "required",
    "timeout": 60000
  }
}
```

### POST /api/auth/webauthn/login-verify

Verify assertion and create session.

**Request:**
```json
{
  "assertionResponse": {
    "id": "credential-id",
    "rawId": "base64-raw-id",
    "response": {
      "clientDataJSON": "base64-client-data",
      "authenticatorData": "base64-auth-data",
      "signature": "base64-signature",
      "userHandle": "base64-user-handle"
    },
    "type": "public-key"
  }
}
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "session": {
    "access_token": "jwt-token",
    "refresh_token": "refresh-token",
    "expires_in": 3600
  }
}
```

## Passkey Credentials Storage

### Table: `passkey_credentials`

```typescript
{
  id: text (PK)            // Credential ID from WebAuthn
  userId: uuid
  publicKey: text          // Base64-encoded public key
  counter: integer         // Signature counter (prevents replay attacks)
  transports: text[]       // ['internal', 'usb', 'nfc', 'ble']
  deviceName: text         // User-friendly device name
  createdAt: timestamp
  lastUsedAt: timestamp
}
```

**Security:**
- Counter increments on each assertion (detects cloned credentials)
- Public key never leaves server (private key stays on device)
- Credentials scoped to RP ID (domain-bound)

## Session Management

### Supabase Sessions

After successful auth, Astro uses Supabase sessions:

```typescript
// Set session
await supabase.auth.setSession({
  access_token,
  refresh_token
})

// Get session
const { data: { session } } = await supabase.auth.getSession()

// Refresh token
const { data: { session } } = await supabase.auth.refreshSession()

// Sign out
await supabase.auth.signOut()
```

### Session Tokens

- **Access token**: Short-lived JWT (1 hour), used for API requests
- **Refresh token**: Long-lived (30 days), stored in httpOnly cookie
- **Auto-refresh**: Supabase client auto-refreshes before expiry

## Protected Routes

### Frontend Route Protection

```typescript
// app.tsx
import { Navigate } from 'react-router'
import { useSupabaseAuth } from '@/hooks/use-supabase-auth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSupabaseAuth()

  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" replace />

  return <>{children}</>
}

// Usage
<Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
```

### Backend Route Protection

```typescript
// server/middleware/auth.ts
import { requireAuth } from '@/server/lib/auth'

// Hono route
app.get('/api/data/projects', requireAuth, async (c) => {
  const user = c.get('user') // Injected by requireAuth
  // ... query projects for user
})

// requireAuth middleware
export const requireAuth = async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return c.json({ error: 'Invalid token' }, 401)

  c.set('user', user)
  await next()
}
```

## iOS Passkey Support

iOS uses ASAuthorizationController with same backend endpoints:

```swift
// Registration
let challenge = try await fetchRegisterOptions(email: email)
let credential = try await ASAuthorizationController.performRequest(
  .platformPublicKey(
    challenge: challenge,
    userID: userID,
    name: name
  )
)
try await verifyRegistration(credential: credential)

// Login
let challenge = try await fetchLoginOptions()
let assertion = try await ASAuthorizationController.performRequest(
  .platformPublicKey(challenge: challenge)
)
try await verifyAssertion(assertion: assertion)
```

## Security Considerations

### HTTPS Required
WebAuthn requires HTTPS in production. Use `localhost` for development.

### RP ID Configuration
- **Production**: `astro.fuxialexander.work`
- **Development**: `localhost`
- **iOS**: Must match app's associated domain

### Challenge Expiry
- Registration challenges expire after 5 minutes
- Login challenges expire after 5 minutes
- Stored in-memory (not persisted)

### Counter Validation
Signature counter prevents credential cloning:
```typescript
if (assertion.counter <= stored.counter) {
  throw new Error('Possible credential clone detected')
}
// Update counter after successful auth
await updateCredentialCounter(credentialId, assertion.counter)
```

## Auth ↔ Profile Sync

Supabase `auth.users` is the source of truth for user existence. A Postgres trigger (`handle_new_user`) auto-creates a `user_profiles` row on signup, but if the trigger fails (constraint error, timeout), the two tables can desync.

**Safety mechanisms:**
- **Hardened trigger**: Uses `ON CONFLICT DO NOTHING` + exception handler so it never blocks `auth.users` insert
- **`find_auth_user_by_email` RPC**: Efficient email lookup in `auth.users` (avoids expensive `admin.listUsers()`)
- **`ensureUserProfile()` helper** (`server/lib/ensure-user-profile.ts`): Called by auth endpoints to self-heal — if `user_profiles` is missing for a known `auth.users` entry, it creates the row via upsert
- **Profile sync on update**: `PUT /api/data/profile` syncs name/email back to `auth.users.user_metadata`

All auth endpoints (`check-user`, `register-options`, `register-verify`, `login-options`, `login-verify`) fall back to the RPC when `user_profiles` lookup misses, then call `ensureUserProfile()` to repair the desync.

## Fallback Authentication

For environments where WebAuthn is unavailable, consider:
- Email magic links (Supabase built-in)
- OAuth providers (GitHub, Google)

## Related Documentation

- [Database Schema](./database-schema.md) - `passkey_credentials` table
- [RLS Policies](./rls-policies.md) - Access control for passkeys
- [Server Mode Setup](../setup/server-mode.md) - Enabling authentication
- [Device Authorization](./device-authorization.md) - Machine auth (different flow)
