/**
 * Tests for scrubAuditDetails in server/middleware/audit.ts
 *
 * The audit-log write path must defensively drop secret-shaped keys,
 * truncate long strings, and recurse into nested structures so that if a
 * caller accidentally passes a raw request body into `details`, nothing
 * sensitive ends up at rest.
 */
import { describe, expect, it } from 'vitest'
import { scrubAuditDetails } from '../../middleware/audit.js'

describe('scrubAuditDetails', () => {
  it('redacts secret-shaped keys case-insensitively', () => {
    const input = {
      userId: 'u1',
      password: 'hunter2',
      Token: 'abc',
      API_KEY: 'sk-xyz',
      accessToken: 'at',
      RefreshToken: 'rt',
      clientSecret: 'cs',
      privateKey: '-----BEGIN',
      credential: 'c',
      cookie: 'session=1',
      Authorization: 'Bearer x',
      safe: 'keep',
    }
    const out = scrubAuditDetails(input)
    expect(out).toEqual({ userId: 'u1', safe: 'keep' })
    // Original untouched
    expect(input.password).toBe('hunter2')
  })

  it('truncates strings longer than 1024 chars', () => {
    const long = 'a'.repeat(1500)
    const out = scrubAuditDetails({ blob: long }) as { blob: string }
    expect(out.blob.length).toBe(1024 + '...[truncated]'.length)
    expect(out.blob.endsWith('...[truncated]')).toBe(true)
    expect(out.blob.startsWith('aaaa')).toBe(true)
  })

  it('recurses into nested objects and arrays', () => {
    const input = {
      outer: {
        password: 'drop-me',
        inner: {
          keep: 'ok',
          token: 'drop-me-too',
          arr: [{ secret: 's', kept: 1 }, 'plain'],
        },
      },
    }
    const out = scrubAuditDetails(input) as Record<string, any>
    expect(out.outer.password).toBeUndefined()
    expect(out.outer.inner.keep).toBe('ok')
    expect(out.outer.inner.token).toBeUndefined()
    expect(out.outer.inner.arr[0].secret).toBeUndefined()
    expect(out.outer.inner.arr[0].kept).toBe(1)
    expect(out.outer.inner.arr[1]).toBe('plain')
  })

  it('depth-limits pathological nesting', () => {
    // Build a very deep object; ensure no stack overflow and object gets cut off
    let deep: Record<string, unknown> = { secret: 's', kept: 'v' }
    for (let i = 0; i < 20; i++) deep = { nest: deep, token: 'drop' }
    const out = scrubAuditDetails(deep)
    // Doesn't throw; sensitive top-level keys are still removed
    expect((out as { token?: unknown }).token).toBeUndefined()
  })
})
