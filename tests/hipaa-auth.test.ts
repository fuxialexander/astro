/**
 * Unit tests for HIPAA auth helpers (server/lib/hipaa-auth.ts).
 *
 * Covers:
 *   - mintHipaaSessionToken signs HS256 JWTs that verifyHipaaSessionToken accepts
 *   - JWT carries sub / email / iat / exp
 *   - verifyHipaaSessionToken rejects tokens signed with a different secret
 *   - verifyHipaaSessionToken rejects expired tokens
 *   - verifyHipaaSessionToken rejects malformed tokens
 *
 * These tests are pure — they never touch Drizzle or PGlite — so they run as
 * regular vitest units regardless of DB / Supabase availability.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import jwt from 'jsonwebtoken'

const TEST_SECRET = 'unit-test-relay-jwt-secret-do-not-use-in-prod'

describe('hipaa-auth — JWT mint + verify', () => {
  beforeEach(() => {
    process.env.RELAY_JWT_SECRET = TEST_SECRET
  })

  it('mintHipaaSessionToken returns an HS256 JWT verifiable with the same secret', async () => {
    const { mintHipaaSessionToken, verifyHipaaSessionToken } = await import(
      '../server/lib/hipaa-auth.js'
    )
    const { token, expiresAt } = mintHipaaSessionToken({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'unit@example.com',
    })
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)
    expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))

    const payload = verifyHipaaSessionToken(token)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('11111111-1111-1111-1111-111111111111')
    expect(payload!.email).toBe('unit@example.com')
    expect(payload!.exp).toBe(expiresAt)
    expect(payload!.iat).toBeLessThanOrEqual(payload!.exp)
  })

  it('verifyHipaaSessionToken rejects tokens signed with a different secret', async () => {
    const { verifyHipaaSessionToken } = await import('../server/lib/hipaa-auth.js')
    const forged = jwt.sign(
      { sub: 'attacker', email: 'a@example.com' },
      'totally-different-secret',
      { algorithm: 'HS256', expiresIn: '24h' },
    )
    expect(verifyHipaaSessionToken(forged)).toBeNull()
  })

  it('verifyHipaaSessionToken rejects expired tokens', async () => {
    const { verifyHipaaSessionToken } = await import('../server/lib/hipaa-auth.js')
    const expired = jwt.sign(
      { sub: 'user', email: 'u@example.com' },
      TEST_SECRET,
      { algorithm: 'HS256', expiresIn: -10 }, // already expired
    )
    expect(verifyHipaaSessionToken(expired)).toBeNull()
  })

  it('verifyHipaaSessionToken rejects malformed tokens', async () => {
    const { verifyHipaaSessionToken } = await import('../server/lib/hipaa-auth.js')
    expect(verifyHipaaSessionToken('not-a-jwt')).toBeNull()
    expect(verifyHipaaSessionToken('aaa.bbb.ccc')).toBeNull()
  })

  it('mintHipaaSessionToken throws when RELAY_JWT_SECRET is missing', async () => {
    delete process.env.RELAY_JWT_SECRET
    const { mintHipaaSessionToken } = await import('../server/lib/hipaa-auth.js')
    expect(() =>
      mintHipaaSessionToken({ id: 'x', email: 'x@x' }),
    ).toThrow(/RELAY_JWT_SECRET/)
  })
})

describe('auth middleware — HIPAA X-Internal-Dispatch audits', () => {
  // This suite exercises the HIPAA branch of server/middleware/auth.ts that
  // logs an audit event on every X-Internal-Dispatch attempt (valid or not).
  // auth-middleware.test.ts sets isHipaaMode: () => false globally, so we
  // need a dedicated module graph here with isHipaaMode: () => true.
  it('logs INTERNAL_DISPATCH_USED when X-Internal-Dispatch is rejected in HIPAA mode', async () => {
    vi.resetModules()

    // Mock mode: server + HIPAA
    vi.doMock('../server/lib/app-mode.js', () => ({
      isLocalMode: () => false,
      isHipaaMode: () => true,
    }))

    // Capture audit writes
    const auditCalls: unknown[] = []
    vi.doMock('../server/middleware/audit.js', () => ({
      logAuditEvent: async (entry: unknown) => {
        auditCalls.push(entry)
      },
      AuditActions: {
        INTERNAL_DISPATCH_USED: 'auth.internal_dispatch_used',
      },
    }))

    vi.doMock('../server/lib/db/bootstrap-local.js', () => ({
      LOCAL_USER_ID: '00000000-0000-0000-0000-000000000000',
      LOCAL_TEAM_ID: '00000000-0000-0000-0000-000000000001',
    }))
    vi.doMock('../server/lib/supabase.js', () => ({
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'test-key',
    }))
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
    }))
    vi.doMock('../server/lib/db/index.js', () => ({
      db: {
        select: () => ({ from: () => ({ where: async () => [] }) }),
        insert: () => ({ values: () => ({ returning: async () => [{ id: 'team-auto' }] }) }),
      },
    }))
    vi.doMock('../server/lib/db/schema.js', () => ({
      teamMembers: {},
      teams: {},
    }))
    vi.doMock('drizzle-orm', () => ({
      eq: () => ({}),
    }))

    // RELAY_JWT_SECRET must exist so we hit the HMAC verification path rather
    // than the "server misconfiguration" rejection.
    process.env.RELAY_JWT_SECRET = 'hipaa-middleware-audit-test-secret'

    const contextVars: Record<string, unknown> = {}
    const c = {
      req: {
        header: (name: string) => {
          const h: Record<string, string> = {
            'X-Internal-Dispatch': 'deadbeef', // invalid HMAC → should still audit
            'X-User-Id': 'internal-user-1',
            'X-Team-Id': 'internal-team-1',
            'user-agent': 'vitest',
            'x-forwarded-for': '127.0.0.1',
          }
          return h[name]
        },
        query: () => undefined as string | undefined,
        path: '/api/data/plan',
        method: 'POST',
      },
      set: (key: string, value: unknown) => { contextVars[key] = value },
      get: (key: string) => contextVars[key],
      json: (body: unknown, status: number) => ({ body, status }),
      _vars: contextVars,
    }

    const { requireAuth } = await import('../server/middleware/auth.js')
    const result = await requireAuth(c as never, async () => {})

    // Invalid HMAC → 401, but audit event MUST have been written.
    expect((result as { status: number } | undefined)?.status).toBe(401)
    expect(auditCalls.length).toBeGreaterThanOrEqual(1)
    const entry = auditCalls[0] as { action: string; userId: string; details: { valid: boolean; path: string } }
    expect(entry.action).toBe('auth.internal_dispatch_used')
    expect(entry.userId).toBe('internal-user-1')
    expect(entry.details.valid).toBe(false)
    expect(entry.details.path).toBe('/api/data/plan')

    vi.doUnmock('../server/lib/app-mode.js')
    vi.doUnmock('../server/middleware/audit.js')
  })
})

describe('passkey-store — getPasskeyStore() factory', () => {
  it('returns the PGlite-backed store when in HIPAA mode', async () => {
    process.env.ASTRO_HIPAA_MODE = 'true'
    process.env.RELAY_JWT_SECRET = TEST_SECRET
    const { getPasskeyStore, _resetPasskeyStoreForTests } = await import(
      '../server/lib/passkey-store.js'
    )
    _resetPasskeyStoreForTests()
    const store = getPasskeyStore()
    // Surface area only — we don't run real DB queries here. Factory must
    // return an object that has the documented PasskeyStore methods.
    expect(typeof store.findByCredentialId).toBe('function')
    expect(typeof store.listForUser).toBe('function')
    expect(typeof store.insert).toBe('function')
    expect(typeof store.updateCounter).toBe('function')
    expect(typeof store.updateLastUsed).toBe('function')
    expect(typeof store.delete).toBe('function')
    delete process.env.ASTRO_HIPAA_MODE
    _resetPasskeyStoreForTests()
  })
})
