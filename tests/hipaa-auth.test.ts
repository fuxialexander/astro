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
import { describe, it, expect, beforeEach } from 'vitest'
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
