/**
 * Integration test: Plan graph CRUD (nodes + edges)
 *
 * Tests bulk PUT, single node/edge CRUD, and cascading edge cleanup on node deletion.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestServer, request, postJson, patchJson, putJson, del, db } from '../helpers/test-server.js'
import { projects, planNodes, planEdges } from '../../server/lib/db/schema.js'

let projectId: string

beforeAll(async () => {
  await setupTestServer()
})

beforeEach(async () => {
  // Clean plan data and projects between tests
  await db.delete(planEdges)
  await db.delete(planNodes)
  await db.delete(projects)

  // Create a fresh project for each test
  const res = await postJson('/api/data/projects', { name: 'Plan Test Project' })
  const body = await res.json()
  projectId = body.id
})

describe('PUT /api/data/plan/:projectId (bulk update)', () => {
  it('replaces all nodes and edges', async () => {
    const res = await putJson(`/api/data/plan/${projectId}`, {
      nodes: [
        { id: 'node-1', type: 'task', title: 'Task 1', status: 'planned', position: { x: 0, y: 0 } },
        { id: 'node-2', type: 'task', title: 'Task 2', status: 'planned', position: { x: 100, y: 0 } },
      ],
      edges: [
        { id: 'edge-1', source: 'node-1', target: 'node-2', type: 'dependency' },
      ],
    })
    expect(res.status).toBe(200)

    // Verify via GET
    const getRes = await request(`/api/data/plan/${projectId}`)
    expect(getRes.status).toBe(200)
    const plan = await getRes.json()
    expect(plan.nodes).toHaveLength(2)
    expect(plan.edges).toHaveLength(1)
    expect(plan.nodes[0].title).toBeDefined()
    expect(plan.edges[0].source).toBe('node-1')
    expect(plan.edges[0].target).toBe('node-2')
  })

  it('returns 404 for non-existent project', async () => {
    const res = await putJson('/api/data/plan/99999999-9999-9999-9999-999999999999', {
      nodes: [],
      edges: [],
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid project ID', async () => {
    const res = await putJson('/api/data/plan/not-a-uuid', {
      nodes: [],
      edges: [],
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/data/plan/:projectId', () => {
  it('returns nodes and edges for a project', async () => {
    // Seed some data
    await putJson(`/api/data/plan/${projectId}`, {
      nodes: [
        { id: 'n1', type: 'task', title: 'Node 1', position: { x: 0, y: 0 } },
      ],
      edges: [],
    })

    const res = await request(`/api/data/plan/${projectId}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.nodes).toHaveLength(1)
    expect(body.nodes[0].id).toBe('n1')
    expect(body.nodes[0].title).toBe('Node 1')
    expect(body.nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(body.edges).toHaveLength(0)
  })

  it('returns 404 for non-existent project', async () => {
    const res = await request('/api/data/plan/99999999-9999-9999-9999-999999999999')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/data/plan/nodes (single node)', () => {
  it('creates a single node', async () => {
    const res = await postJson('/api/data/plan/nodes', {
      id: 'new-node',
      projectId,
      type: 'task',
      title: 'New Task',
      status: 'planned',
      position: { x: 50, y: 50 },
    })
    expect(res.status).toBe(201)

    // Verify it exists
    const getRes = await request(`/api/data/plan/${projectId}`)
    const plan = await getRes.json()
    expect(plan.nodes).toHaveLength(1)
    expect(plan.nodes[0].id).toBe('new-node')
  })

  it('returns 404 for non-existent project', async () => {
    const res = await postJson('/api/data/plan/nodes', {
      id: 'orphan',
      projectId: '99999999-9999-9999-9999-999999999999',
      type: 'task',
      title: 'Orphan',
    })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/data/plan/nodes/:id', () => {
  it('updates node fields', async () => {
    await postJson('/api/data/plan/nodes', {
      id: 'update-me',
      projectId,
      type: 'task',
      title: 'Original Title',
      status: 'planned',
    })

    const res = await patchJson('/api/data/plan/nodes/update-me', {
      title: 'Updated Title',
      status: 'in_progress',
    })
    expect(res.status).toBe(200)

    // Verify
    const getRes = await request(`/api/data/plan/${projectId}`)
    const plan = await getRes.json()
    const node = plan.nodes.find((n: { id: string }) => n.id === 'update-me')
    expect(node.title).toBe('Updated Title')
    expect(node.status).toBe('in_progress')
  })

  it('returns 404 for non-existent node', async () => {
    const res = await patchJson('/api/data/plan/nodes/does-not-exist', {
      title: 'nope',
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/data/plan/nodes/:id', () => {
  it('deletes a node and its connected edges', async () => {
    // Create two nodes and an edge
    await postJson('/api/data/plan/nodes', {
      id: 'del-node-1',
      projectId,
      type: 'task',
      title: 'Node 1',
    })
    await postJson('/api/data/plan/nodes', {
      id: 'del-node-2',
      projectId,
      type: 'task',
      title: 'Node 2',
    })
    await postJson('/api/data/plan/edges', {
      id: 'del-edge-1',
      projectId,
      source: 'del-node-1',
      target: 'del-node-2',
    })

    // Delete node 1
    const res = await del('/api/data/plan/nodes/del-node-1')
    expect(res.status).toBe(200)

    // Verify node 1 is gone and edge is cleaned up
    const getRes = await request(`/api/data/plan/${projectId}`)
    const plan = await getRes.json()
    expect(plan.nodes).toHaveLength(1)
    expect(plan.nodes[0].id).toBe('del-node-2')
    expect(plan.edges).toHaveLength(0)
  })

  it('returns 404 for non-existent node', async () => {
    const res = await del('/api/data/plan/nodes/no-such-node')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/data/plan/edges', () => {
  it('creates an edge between nodes', async () => {
    await postJson('/api/data/plan/nodes', {
      id: 'edge-src',
      projectId,
      type: 'task',
      title: 'Source',
    })
    await postJson('/api/data/plan/nodes', {
      id: 'edge-tgt',
      projectId,
      type: 'task',
      title: 'Target',
    })

    const res = await postJson('/api/data/plan/edges', {
      id: 'new-edge',
      projectId,
      source: 'edge-src',
      target: 'edge-tgt',
      type: 'dependency',
    })
    expect(res.status).toBe(201)

    const getRes = await request(`/api/data/plan/${projectId}`)
    const plan = await getRes.json()
    expect(plan.edges).toHaveLength(1)
    expect(plan.edges[0].id).toBe('new-edge')
  })
})

describe('DELETE /api/data/plan/edges/:id', () => {
  it('deletes an edge', async () => {
    await postJson('/api/data/plan/nodes', {
      id: 'e-src',
      projectId,
      type: 'task',
      title: 'Src',
    })
    await postJson('/api/data/plan/nodes', {
      id: 'e-tgt',
      projectId,
      type: 'task',
      title: 'Tgt',
    })
    await postJson('/api/data/plan/edges', {
      id: 'rm-edge',
      projectId,
      source: 'e-src',
      target: 'e-tgt',
    })

    const res = await del('/api/data/plan/edges/rm-edge')
    expect(res.status).toBe(200)

    const getRes = await request(`/api/data/plan/${projectId}`)
    const plan = await getRes.json()
    expect(plan.edges).toHaveLength(0)
  })

  it('returns 404 for non-existent edge', async () => {
    const res = await del('/api/data/plan/edges/no-such-edge')
    expect(res.status).toBe(404)
  })
})
