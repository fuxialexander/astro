/**
 * Integration test: Project CRUD
 *
 * Tests the full HTTP path for project operations:
 * POST create → GET list → GET by ID → PATCH update → DELETE
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestServer, request, postJson, patchJson, del, db } from '../helpers/test-server.js'
import { projects } from '../../server/lib/db/schema.js'

beforeAll(async () => {
  await setupTestServer()
})

beforeEach(async () => {
  await db.delete(projects)
})

describe('POST /api/data/projects', () => {
  it('creates a project and returns 201 with teamId/ownerId assigned', async () => {
    const res = await postJson('/api/data/projects', {
      name: 'Test Project',
      description: 'A test project',
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('Test Project')
    expect(body.description).toBe('A test project')
    expect(body.ownerId).toBeTruthy()
    expect(body.teamId).toBeTruthy()
    expect(body.id).toBeTruthy()
    expect(body.status).toBe('active')
  })

  it('creates a project with a specific ID', async () => {
    const id = '11111111-1111-1111-1111-111111111111'
    const res = await postJson('/api/data/projects', {
      id,
      name: 'Specific ID Project',
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe(id)
  })
})

describe('GET /api/data/projects', () => {
  it('returns empty array when no projects', async () => {
    const res = await request('/api/data/projects')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('returns created projects', async () => {
    await postJson('/api/data/projects', { name: 'Project A' })
    await postJson('/api/data/projects', { name: 'Project B' })

    const res = await request('/api/data/projects')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    const names = body.map((p: { name: string }) => p.name)
    expect(names).toContain('Project A')
    expect(names).toContain('Project B')
  })
})

describe('GET /api/data/projects/:id', () => {
  it('returns a specific project', async () => {
    const createRes = await postJson('/api/data/projects', { name: 'Specific Project' })
    const created = await createRes.json()

    const res = await request(`/api/data/projects/${created.id}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(created.id)
    expect(body.name).toBe('Specific Project')
  })

  it('returns 404 for non-existent project', async () => {
    const res = await request('/api/data/projects/99999999-9999-9999-9999-999999999999')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/data/projects/:id', () => {
  it('updates project fields', async () => {
    const createRes = await postJson('/api/data/projects', { name: 'Original' })
    const created = await createRes.json()

    const res = await patchJson(`/api/data/projects/${created.id}`, {
      name: 'Updated',
      description: 'Updated description',
      status: 'archived',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Updated')
    expect(body.description).toBe('Updated description')
    expect(body.status).toBe('archived')
  })

  it('returns 404 for non-existent project', async () => {
    const res = await patchJson('/api/data/projects/99999999-9999-9999-9999-999999999999', {
      name: 'nope',
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/data/projects/:id', () => {
  it('deletes a project and returns ok', async () => {
    const createRes = await postJson('/api/data/projects', { name: 'To Delete' })
    const created = await createRes.json()

    const deleteRes = await del(`/api/data/projects/${created.id}`)
    expect(deleteRes.status).toBe(200)
    const body = await deleteRes.json()
    expect(body.ok).toBe(true)

    // Verify gone
    const getRes = await request(`/api/data/projects/${created.id}`)
    expect(getRes.status).toBe(404)
  })

  it('returns 404 for non-existent project', async () => {
    const res = await del('/api/data/projects/99999999-9999-9999-9999-999999999999')
    expect(res.status).toBe(404)
  })
})
