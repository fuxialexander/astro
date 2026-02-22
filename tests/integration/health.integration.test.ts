/**
 * Integration test: Health & Provider endpoints
 *
 * Smoke test — validates that createApp() works, PGlite is initialized,
 * and the basic health/provider endpoints respond correctly.
 *
 * In relay-only mode, health returns relay status and providers returns
 * connected agent runners (empty list when no runners connected).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { setupTestServer, request } from '../helpers/test-server.js'

beforeAll(async () => {
  await setupTestServer()
})

describe('GET /api/health', () => {
  it('returns status ok with indexeddb mode', async () => {
    const res = await request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.mode).toBe('indexeddb')
    expect(body.authenticated).toBe(true)
    expect(body.relay).toBeDefined()
    expect(body.relay.connectedRunners).toBe(0)
  })
})

describe('GET /api/providers', () => {
  it('returns provider list (empty when no runners connected)', async () => {
    const res = await request('/api/providers')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('providers')
    expect(Array.isArray(body.providers)).toBe(true)
    expect(body.providers).toHaveLength(0)
  })
})
