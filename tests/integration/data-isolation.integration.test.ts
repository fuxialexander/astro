/**
 * Integration test: Cross-team data isolation
 *
 * Validates that User A (LOCAL_USER_ID / LOCAL_TEAM_ID) cannot see or modify
 * data belonging to User B (SECOND_USER_ID / SECOND_TEAM_ID), and vice versa.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  setupTestServer,
  request,
  postJson,
  postJsonAs,
  patchJson,
  del,
  getAs,
  putJsonAs,
  db,
  bootstrapSecondUser,
  SECOND_USER_ID,
} from '../helpers/test-server.js'
import { projects, planNodes, planEdges, initiatives } from '../../server/lib/db/schema.js'

beforeAll(async () => {
  await setupTestServer()
  await bootstrapSecondUser()
})

beforeEach(async () => {
  await db.delete(planEdges)
  await db.delete(planNodes)
  await db.delete(projects)
  await db.delete(initiatives)
})

describe('Project isolation', () => {
  it('User A cannot see User B projects', async () => {
    // User A creates a project
    const resA = await postJson('/api/data/projects', { name: 'A Project' })
    expect(resA.status).toBe(201)

    // User B creates a project
    const resB = await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Project' })
    expect(resB.status).toBe(201)

    // User A lists projects — should only see A's project
    const listA = await request('/api/data/projects')
    const projectsA = await listA.json()
    expect(projectsA).toHaveLength(1)
    expect(projectsA[0].name).toBe('A Project')

    // User B lists projects — should only see B's project
    const listB = await getAs(SECOND_USER_ID, '/api/data/projects')
    const projectsB = await listB.json()
    expect(projectsB).toHaveLength(1)
    expect(projectsB[0].name).toBe('B Project')
  })

  it('User A gets 404 when accessing User B project by ID', async () => {
    // User B creates project
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'Private B' })
    const created = await createRes.json()

    // User A tries to access it
    const getRes = await request(`/api/data/projects/${created.id}`)
    expect(getRes.status).toBe(404)
  })

  it('User A gets 404 when trying to PATCH User B project', async () => {
    // User B creates project
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Only' })
    const created = await createRes.json()

    // User A tries to update it
    const patchRes = await patchJson(`/api/data/projects/${created.id}`, { name: 'Hacked' })
    expect(patchRes.status).toBe(404)
  })

  it('User A gets 404 when trying to DELETE User B project', async () => {
    // User B creates project
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Secure' })
    const created = await createRes.json()

    // User A tries to delete it
    const deleteRes = await del(`/api/data/projects/${created.id}`)
    expect(deleteRes.status).toBe(404)
  })
})

describe('Plan node isolation', () => {
  it('User A cannot see plan nodes for User B projects', async () => {
    // User B creates project and nodes
    const projRes = await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Plan Project' })
    const proj = await projRes.json()

    await putJsonAs(SECOND_USER_ID, `/api/data/plan/${proj.id}`, {
      nodes: [
        { id: 'b-node-1', type: 'task', title: 'B Task', position: { x: 0, y: 0 } },
      ],
      edges: [],
    })

    // User A tries to read plan for B's project
    const planRes = await request(`/api/data/plan/${proj.id}`)
    expect(planRes.status).toBe(404) // Project not found for User A's team
  })
})

describe('Initiative isolation', () => {
  it('User A cannot see User B initiatives', async () => {
    // User A creates initiative
    await postJson('/api/data/initiatives', { name: 'A Initiative' })

    // User B creates initiative
    await postJsonAs(SECOND_USER_ID, '/api/data/initiatives', { name: 'B Initiative' })

    // User A lists — should only see own
    const listA = await request('/api/data/initiatives')
    const initsA = await listA.json()
    expect(initsA).toHaveLength(1)
    expect(initsA[0].name).toBe('A Initiative')

    // User B lists — should only see own
    const listB = await getAs(SECOND_USER_ID, '/api/data/initiatives')
    const initsB = await listB.json()
    expect(initsB).toHaveLength(1)
    expect(initsB[0].name).toBe('B Initiative')
  })

  it('User A gets 404 when accessing User B initiative', async () => {
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/data/initiatives', { name: 'B Private Init' })
    const created = await createRes.json()

    const getRes = await request(`/api/data/initiatives/${created.id}`)
    expect(getRes.status).toBe(404)
  })

  it('User A gets 404 when trying to PATCH User B initiative', async () => {
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/data/initiatives', { name: 'B Init' })
    const created = await createRes.json()

    const patchRes = await patchJson(`/api/data/initiatives/${created.id}`, { name: 'Hacked Init' })
    expect(patchRes.status).toBe(404)
  })

  it('User A gets 404 when trying to DELETE User B initiative', async () => {
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/data/initiatives', { name: 'B Secure Init' })
    const created = await createRes.json()

    const deleteRes = await del(`/api/data/initiatives/${created.id}`)
    expect(deleteRes.status).toBe(404)
  })
})
