/**
 * Unit tests for auth routes (server/routes/auth.ts)
 *
 * Tests the ensure-profile and add-passkey endpoints in local mode,
 * and verifies auth route behavior when Supabase is not configured.
 *
 * Note: WebAuthn ceremony tests (register/login) cannot run in CLI
 * because they require a real browser with platform authenticator.
 * These tests focus on the backend API surface and data layer.
 *
 * ── What CANNOT be tested in CLI mode ──────────────────────────────
 * The following flows require a real browser + Supabase and are NOT
 * covered here. They should be tested via E2E browser tests:
 *
 * 1. Passkey registration: startRegistration() → register-options → register-verify
 *    - Requires navigator.credentials.create() (platform authenticator)
 *    - Requires Supabase Auth for user creation and session generation
 *
 * 2. Passkey login: startAuthentication() → login-options → login-verify
 *    - Requires navigator.credentials.get() (platform authenticator)
 *    - Requires Supabase Auth for session generation
 *
 * 3. OAuth login (Google/GitHub): supabase.auth.signInWithOAuth()
 *    - Requires browser redirect to Google/GitHub OAuth consent page
 *    - Requires Supabase Auth with configured OAuth providers
 *    - ensure-profile is called on SIGNED_IN event (tested via data layer)
 *
 * 4. Magic link login: supabase.auth.signInWithOtp()
 *    - Requires Supabase to send email
 *    - Requires clicking link in email to complete auth
 *
 * 5. Add passkey to existing account (server mode):
 *    - Requires active Supabase session + platform authenticator
 *    - options phase: generates WebAuthn challenge
 *    - verify phase: stores credential in passkey_credentials table
 *
 * 6. Session validation with real JWT tokens
 *    - Requires Supabase Auth to issue and validate JWTs
 *
 * 7. Rate limiting behavior
 *    - Rate limiter uses IP-based key; Hono app.request() doesn't
 *      simulate real HTTP with IP headers reliably
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  setupTestServer,
  request,
  postJson,
  requestAs,
} from './helpers/test-server.js'

beforeAll(async () => {
  await setupTestServer()
})

// ── ensure-profile ─────────────────────────────────────────────────

describe('POST /api/auth/ensure-profile (local mode)', () => {
  it('returns ok in local mode', async () => {
    const res = await postJson('/api/auth/ensure-profile', {
      name: 'Test User',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('local')
  })

  it('returns ok with empty body', async () => {
    const res = await postJson('/api/auth/ensure-profile', {})
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('local')
  })

  it('returns ok with only avatarUrl', async () => {
    const res = await postJson('/api/auth/ensure-profile', {
      avatarUrl: 'https://example.com/avatar.png',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns ok with name and avatarUrl', async () => {
    const res = await postJson('/api/auth/ensure-profile', {
      name: 'OAuth User',
      avatarUrl: 'https://example.com/avatar.png',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('is idempotent (multiple calls succeed)', async () => {
    const res1 = await postJson('/api/auth/ensure-profile', { name: 'User A' })
    const res2 = await postJson('/api/auth/ensure-profile', { name: 'User B' })
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    const body1 = await res1.json()
    const body2 = await res2.json()
    expect(body1.ok).toBe(true)
    expect(body2.ok).toBe(true)
  })
})

// ── session ────────────────────────────────────────────────────────

describe('GET /api/auth/session (local mode)', () => {
  it('returns authenticated with dev user', async () => {
    const res = await request('/api/auth/session')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(true)
    expect(body.user.id).toBe('00000000-0000-0000-0000-000000000000')
    expect(body.user.email).toBe('dev@localhost')
    expect(body.mode).toBe('development')
  })

  it('always returns dev user regardless of request headers', async () => {
    // In local mode, session endpoint ignores Authorization header
    const res = await request('/api/auth/session', {
      headers: { 'Authorization': 'Bearer fake-token' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(true)
    expect(body.mode).toBe('development')
  })
})

// ── WebAuthn check-user ────────────────────────────────────────────

describe('POST /api/auth/webauthn/check-user (local mode)', () => {
  it('returns 503 in local mode', async () => {
    const res = await postJson('/api/auth/webauthn/check-user', {
      email: 'test@example.com',
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('Supabase not configured')
  })

  it('returns 503 even with empty email', async () => {
    const res = await postJson('/api/auth/webauthn/check-user', {
      email: '',
    })
    expect(res.status).toBe(503)
  })
})

// ── WebAuthn register ──────────────────────────────────────────────

describe('POST /api/auth/webauthn/register-options (local mode)', () => {
  it('returns 503 in local mode', async () => {
    const res = await postJson('/api/auth/webauthn/register-options', {
      email: 'test@example.com',
      name: 'Test',
    })
    expect(res.status).toBe(503)
  })
})

describe('POST /api/auth/webauthn/register-verify (local mode)', () => {
  it('returns 503 in local mode', async () => {
    const res = await postJson('/api/auth/webauthn/register-verify', {
      email: 'test@example.com',
      name: 'Test',
      credential: {},
    })
    expect(res.status).toBe(503)
  })
})

// ── WebAuthn login ─────────────────────────────────────────────────

describe('POST /api/auth/webauthn/login-options (local mode)', () => {
  it('returns 503 in local mode', async () => {
    const res = await postJson('/api/auth/webauthn/login-options', {
      email: 'test@example.com',
    })
    expect(res.status).toBe(503)
  })

  it('returns 503 even without email (discoverable credential flow)', async () => {
    const res = await postJson('/api/auth/webauthn/login-options', {})
    expect(res.status).toBe(503)
  })
})

describe('POST /api/auth/webauthn/login-verify (local mode)', () => {
  it('returns 503 in local mode', async () => {
    const res = await postJson('/api/auth/webauthn/login-verify', {
      credential: {},
      challengeKey: 'test',
    })
    expect(res.status).toBe(503)
  })
})

// ── add-passkey ────────────────────────────────────────────────────

describe('POST /api/auth/webauthn/add-passkey (local mode)', () => {
  it('returns 503 for options action', async () => {
    const res = await postJson('/api/auth/webauthn/add-passkey', {
      action: 'options',
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('Supabase not configured')
  })

  it('returns 503 for verify action', async () => {
    const res = await postJson('/api/auth/webauthn/add-passkey', {
      action: 'verify',
      credential: {},
    })
    expect(res.status).toBe(503)
  })

  it('returns 503 for invalid action', async () => {
    const res = await postJson('/api/auth/webauthn/add-passkey', {
      action: 'invalid',
    })
    expect(res.status).toBe(503)
  })
})

// ── delete-account ─────────────────────────────────────────────────

describe('DELETE /api/auth/delete-account (local mode)', () => {
  it('returns success in local mode', async () => {
    const res = await request('/api/auth/delete-account', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.message).toContain('IndexedDB mode')
  })

  it('is idempotent (multiple deletes succeed in local mode)', async () => {
    const res1 = await request('/api/auth/delete-account', { method: 'DELETE' })
    const res2 = await request('/api/auth/delete-account', { method: 'DELETE' })
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
  })
})

// ── requireAuth middleware behavior ────────────────────────────────

describe('requireAuth middleware (local mode)', () => {
  it('ensure-profile accessible without explicit auth header', async () => {
    // In local mode, requireAuth auto-assigns dev user
    const res = await postJson('/api/auth/ensure-profile', {})
    expect(res.status).toBe(200)
  })

  it('ensure-profile accessible with X-User-Id header', async () => {
    // Custom user ID should still work (requireAuth resolves team)
    const res = await requestAs('00000000-0000-0000-0000-000000000099', '/api/auth/ensure-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Second User' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
