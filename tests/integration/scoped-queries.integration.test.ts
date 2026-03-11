/**
 * Integration test: Scoped query correctness
 *
 * Validates that the endpoints fixed in PR #892 (replacing full table scans
 * with scoped queries) return correct results:
 * 1. GET /plan — only returns nodes/edges for the user's team projects
 * 2. GET /executions — only returns executions for the user's team projects
 * 3. Cross-team isolation: User B's data is invisible to User A
 * 4. Empty results: user with no projects gets empty arrays, not errors
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  setupTestServer,
  request,
  postJson,
  postJsonAs,
  getAs,
  db,
  bootstrapSecondUser,
  SECOND_USER_ID,
} from '../helpers/test-server.js'
import { projects, planNodes, planEdges, taskExecutions } from '../../server/lib/db/schema.js'

beforeAll(async () => {
  await setupTestServer()
  await bootstrapSecondUser()
})

beforeEach(async () => {
  await db.delete(taskExecutions)
  await db.delete(planEdges)
  await db.delete(planNodes)
  await db.delete(projects)
})

describe('GET /api/data/plan (bulk — scoped query)', () => {
  it('returns only nodes for the current user team', async () => {
    // User A creates project
    const projA = await (await postJson('/api/data/projects', { name: 'A Plan' })).json()

    // User B creates project
    const projB = await (await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Plan' })).json()

    // Insert nodes directly to avoid PUT edge-upsert issues in PGlite
    await db.insert(planNodes).values([
      { projectId: projA.id, clientId: 'a-node-1', type: 'task', title: 'A Task 1', positionX: 0, positionY: 0 },
      { projectId: projA.id, clientId: 'a-node-2', type: 'task', title: 'A Task 2', positionX: 100, positionY: 0 },
    ])
    await db.insert(planNodes).values([
      { projectId: projB.id, clientId: 'b-node-1', type: 'task', title: 'B Task 1', positionX: 0, positionY: 0 },
    ])

    // User A fetches bulk plan — should only see A's nodes
    const res = await request('/api/data/plan')
    expect(res.status).toBe(200)
    const plan = await res.json()

    expect(plan.nodes).toHaveLength(2)
    expect(plan.nodes.map((n: { id: string }) => n.id).sort()).toEqual(['a-node-1', 'a-node-2'])

    // User B fetches bulk plan — should only see B's nodes
    const resB = await getAs(SECOND_USER_ID, '/api/data/plan')
    expect(resB.status).toBe(200)
    const planB = await resB.json()

    expect(planB.nodes).toHaveLength(1)
    expect(planB.nodes[0].id).toBe('b-node-1')
  })

  it('returns empty arrays when user has no projects', async () => {
    // User B creates a project with a node (User A has none)
    const projB = await (await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Only' })).json()
    await db.insert(planNodes).values({
      projectId: projB.id, clientId: 'b1', type: 'task', title: 'B Task', positionX: 0, positionY: 0,
    })

    // User A fetches — should get empty, not an error
    const res = await request('/api/data/plan')
    expect(res.status).toBe(200)
    const plan = await res.json()
    expect(plan.nodes).toEqual([])
    expect(plan.edges).toEqual([])
  })

  it('soft-deleted nodes are excluded from bulk plan', async () => {
    const proj = await (await postJson('/api/data/projects', { name: 'Soft Delete Test' })).json()

    // Insert nodes directly — one alive, one soft-deleted
    await db.insert(planNodes).values([
      { projectId: proj.id, clientId: 'alive', type: 'task', title: 'Alive', positionX: 0, positionY: 0 },
      { projectId: proj.id, clientId: 'dead', type: 'task', title: 'Dead', positionX: 100, positionY: 0, deletedAt: new Date() },
    ])

    // Bulk plan should only show the alive node
    const res = await request('/api/data/plan')
    expect(res.status).toBe(200)
    const plan = await res.json()
    expect(plan.nodes).toHaveLength(1)
    expect(plan.nodes[0].id).toBe('alive')
  })

  it('edges are scoped to user team projects', async () => {
    const projA = await (await postJson('/api/data/projects', { name: 'A Edge' })).json()
    const projB = await (await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Edge' })).json()

    // Insert edges directly
    await db.insert(planNodes).values([
      { projectId: projA.id, clientId: 'an1', type: 'task', title: 'A1', positionX: 0, positionY: 0 },
      { projectId: projA.id, clientId: 'an2', type: 'task', title: 'A2', positionX: 100, positionY: 0 },
    ])
    await db.insert(planEdges).values({
      projectId: projA.id, clientId: 'ae1', sourceClientId: 'an1', targetClientId: 'an2',
    })

    await db.insert(planNodes).values([
      { projectId: projB.id, clientId: 'bn1', type: 'task', title: 'B1', positionX: 0, positionY: 0 },
      { projectId: projB.id, clientId: 'bn2', type: 'task', title: 'B2', positionX: 100, positionY: 0 },
    ])
    await db.insert(planEdges).values({
      projectId: projB.id, clientId: 'be1', sourceClientId: 'bn1', targetClientId: 'bn2',
    })

    // User A only sees A's edge
    const resA = await request('/api/data/plan')
    const planA = await resA.json()
    expect(planA.edges).toHaveLength(1)
    expect(planA.edges[0].source).toBe('an1')

    // User B only sees B's edge
    const resB = await getAs(SECOND_USER_ID, '/api/data/plan')
    const planB = await resB.json()
    expect(planB.edges).toHaveLength(1)
    expect(planB.edges[0].source).toBe('bn1')
  })
})

describe('GET /api/data/executions (scoped query)', () => {
  it('returns only executions for the current user team projects', async () => {
    // User A creates project
    const projA = await (await postJson('/api/data/projects', { name: 'A Exec' })).json()

    // User B creates project
    const projB = await (await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Exec' })).json()

    // Insert executions directly for both projects
    await db.insert(taskExecutions).values({
      executionId: 'exec-a-1',
      nodeClientId: 'node-a-1',
      projectId: projA.id,
      status: 'success',
    })
    await db.insert(taskExecutions).values({
      executionId: 'exec-b-1',
      nodeClientId: 'node-b-1',
      projectId: projB.id,
      status: 'success',
    })

    // User A fetches executions — should only see A's
    const res = await request('/api/data/executions')
    expect(res.status).toBe(200)
    const execs = await res.json()
    const nodeIds = Object.keys(execs)
    expect(nodeIds).toEqual(['node-a-1'])
    expect(execs['node-a-1'].executionId).toBe('exec-a-1')

    // User B fetches executions — should only see B's
    const resB = await getAs(SECOND_USER_ID, '/api/data/executions')
    expect(resB.status).toBe(200)
    const execsB = await resB.json()
    const nodeIdsB = Object.keys(execsB)
    expect(nodeIdsB).toEqual(['node-b-1'])
  })

  it('returns empty object when user has no projects', async () => {
    // Only User B has a project
    const projB = await (await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Only Exec' })).json()
    await db.insert(taskExecutions).values({
      executionId: 'exec-b-only',
      nodeClientId: 'node-b-only',
      projectId: projB.id,
      status: 'running',
    })

    // User A fetches — should get empty object, not error
    const res = await request('/api/data/executions')
    expect(res.status).toBe(200)
    const execs = await res.json()
    expect(Object.keys(execs)).toHaveLength(0)
  })
})
