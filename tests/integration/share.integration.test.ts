/**
 * Integration test: Share bundle store
 *
 * Tests the /api/share endpoints (POST bundle, GET bundle, download counter).
 * Mounts shareRoute directly since it's gated by !isIndexedDBMode() in production.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { setupTestServer, db } from '../helpers/test-server.js'
import { sharedBundles } from '../../server/lib/db/schema.js'
import { shareRoute } from '../../server/routes/share.js'

let app: Hono

beforeAll(async () => {
  await setupTestServer()
  // Mount shareRoute directly (bypasses isIndexedDBMode gate)
  app = new Hono()
  app.route('/api/share', shareRoute)
})

beforeEach(async () => {
  await db.delete(sharedBundles)
})

function postShare(body: unknown) {
  return app.request('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getShare(id: string) {
  return app.request(`/api/share/${id}`)
}

describe('POST /api/share', () => {
  it('stores a valid bundle and returns a UUID', async () => {
    const res = await postShare({
      $schema: 'astro-export',
      projects: [],
      nodes: [],
      edges: [],
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBeTruthy()
    // Should be a UUID format
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('returns 400 for invalid bundle (missing $schema)', async () => {
    const res = await postShare({ name: 'not a bundle' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid bundle')
  })

  it('returns 400 for non-object body', async () => {
    const res = await postShare('just a string')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/share/:id', () => {
  it('retrieves a stored bundle', async () => {
    const bundle = {
      $schema: 'astro-export',
      projects: [{ id: 'p1', name: 'Test' }],
      nodes: [],
      edges: [],
    }
    const createRes = await postShare(bundle)
    const { id } = await createRes.json()

    const res = await getShare(id)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.$schema).toBe('astro-export')
    expect(body.projects).toHaveLength(1)
    expect(body.projects[0].name).toBe('Test')
  })

  it('increments download counter on each GET', async () => {
    const createRes = await postShare({
      $schema: 'astro-export',
      data: 'test',
    })
    const { id } = await createRes.json()

    // First download
    await getShare(id)

    // Second download
    await getShare(id)

    // Check the counter in DB
    const { eq } = await import('drizzle-orm')
    const [row] = await db.select().from(sharedBundles).where(eq(sharedBundles.id, id))
    expect(row.downloads).toBe(2)
  })

  it('returns 404 for non-existent bundle', async () => {
    const res = await getShare('99999999-9999-9999-9999-999999999999')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('not found')
  })
})
