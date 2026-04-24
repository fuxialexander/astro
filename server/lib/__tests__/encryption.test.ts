/**
 * Tests for server/lib/encryption.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetEncryptionForTests,
  decrypt,
  decryptJsonb,
  encrypt,
  encryptJsonb,
  isEncrypted,
} from '../encryption.js'
import { randomBytes } from 'node:crypto'

const TEST_KEY = randomBytes(32).toString('base64')

describe('encryption', () => {
  let savedKey: string | undefined
  let savedLocalMode: string | undefined
  let savedSupabaseUrl: string | undefined
  let savedSupabaseKey: string | undefined

  beforeEach(() => {
    savedKey = process.env.ASTRO_ENCRYPTION_KEY
    savedLocalMode = process.env.ASTRO_LOCAL_MODE
    savedSupabaseUrl = process.env.SUPABASE_URL
    savedSupabaseKey = process.env.SUPABASE_ANON_KEY
    process.env.ASTRO_ENCRYPTION_KEY = TEST_KEY
    __resetEncryptionForTests()
  })

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.ASTRO_ENCRYPTION_KEY
    } else {
      process.env.ASTRO_ENCRYPTION_KEY = savedKey
    }
    if (savedLocalMode === undefined) {
      delete process.env.ASTRO_LOCAL_MODE
    } else {
      process.env.ASTRO_LOCAL_MODE = savedLocalMode
    }
    if (savedSupabaseUrl === undefined) {
      delete process.env.SUPABASE_URL
    } else {
      process.env.SUPABASE_URL = savedSupabaseUrl
    }
    if (savedSupabaseKey === undefined) {
      delete process.env.SUPABASE_ANON_KEY
    } else {
      process.env.SUPABASE_ANON_KEY = savedSupabaseKey
    }
    __resetEncryptionForTests()
  })

  it('round-trips a plaintext string', () => {
    const blob = encrypt('hello world')
    expect(blob).toMatch(/^enc:v1:/)
    expect(decrypt(blob)).toBe('hello world')
  })

  it('round-trips a JSON object', () => {
    const obj = { botToken: 'xoxb-abcdef', scopes: ['chat:write'] }
    const blob = encrypt(obj)
    expect(decrypt(blob)).toBe(JSON.stringify(obj))
  })

  it('produces different ciphertext for the same plaintext (fresh IV)', () => {
    const a = encrypt('same')
    const b = encrypt('same')
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe('same')
    expect(decrypt(b)).toBe('same')
  })

  it('rejects a tampered ciphertext', () => {
    const blob = encrypt('secret')
    // Flip a byte in the base64 payload
    const prefix = 'enc:v1:'
    const body = blob.slice(prefix.length)
    const bytes = Buffer.from(body, 'base64')
    bytes[bytes.length - 5] ^= 0xff
    const tampered = prefix + bytes.toString('base64')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('isEncrypted detects raw blobs', () => {
    expect(isEncrypted(encrypt('x'))).toBe(true)
    expect(isEncrypted('plain string')).toBe(false)
    expect(isEncrypted({ foo: 'bar' })).toBe(false)
    expect(isEncrypted(null)).toBe(false)
  })

  it('isEncrypted detects jsonb wrapper', () => {
    const wrapped = encryptJsonb({ secret: 'value' })
    expect(isEncrypted(wrapped)).toBe(true)
    expect(wrapped.encrypted).toMatch(/^enc:v1:/)
  })

  it('decryptJsonb returns the original object', () => {
    const original = { botToken: 't', signingSecret: 's' }
    const stored = encryptJsonb(original)
    expect(decryptJsonb<typeof original>(stored)).toEqual(original)
  })

  it('decryptJsonb passes through legacy plaintext objects', () => {
    const legacy = { apiKey: 'legacy-plain' }
    expect(decryptJsonb(legacy)).toEqual(legacy)
  })

  it('decryptJsonb passes null through unchanged', () => {
    expect(decryptJsonb(null)).toBeNull()
  })

  it('throws on decrypt of a non-blob string', () => {
    expect(() => decrypt('not an encrypted value')).toThrow()
  })

  it('falls back to an ephemeral key when env var is missing (local mode only)', () => {
    delete process.env.ASTRO_ENCRYPTION_KEY
    // Force local mode so the fallback path is exercised
    process.env.ASTRO_LOCAL_MODE = 'true'
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    __resetEncryptionForTests()
    const blob = encrypt('ephemeral test')
    expect(decrypt(blob)).toBe('ephemeral test')
  })

  it('throws in server mode when ASTRO_ENCRYPTION_KEY is missing', () => {
    delete process.env.ASTRO_ENCRYPTION_KEY
    // Force server mode: explicitly disable local mode + provide Supabase env
    process.env.ASTRO_LOCAL_MODE = 'false'
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'test-anon-key'
    __resetEncryptionForTests()
    expect(() => encrypt('server-mode test')).toThrow(/ASTRO_ENCRYPTION_KEY/)
    expect(() => encrypt('server-mode test')).toThrow(/UNRECOVERABLE/)
  })

  it('rejects a key that is the wrong length', () => {
    process.env.ASTRO_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64')
    __resetEncryptionForTests()
    expect(() => encrypt('x')).toThrow(/32 bytes/)
  })
})
