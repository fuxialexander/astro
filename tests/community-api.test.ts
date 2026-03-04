/**
 * Tests for community marketplace API routes (server/routes/community.ts)
 *
 * Covers:
 * - Publish plan (POST /api/community/plans)
 * - List plans (GET /api/community/plans)
 * - Get plan detail (GET /api/community/plans/:id)
 * - Update plan (PUT /api/community/plans/:id)
 * - Delete plan (DELETE /api/community/plans/:id)
 * - Fork plan (POST /api/community/plans/:id/fork)
 * - Star/unstar plan (POST /api/community/plans/:id/star)
 * - Trending (GET /api/community/plans/trending)
 * - Categories (GET /api/community/plans/categories)
 * - Comments (POST/GET /api/community/plans/:id/comments)
 * - Visibility filtering (public/team/unlisted)
 * - Validation (visibility enum, required fields)
 *
 * Uses PGlite (local mode) for integration tests.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  setupTestServer,
  request,
  postJson,
  putJson,
  del,
  postJsonAs,
  getAs,
  bootstrapSecondUser,
  getApp,
  SECOND_USER_ID,
} from './helpers/test-server.js'

// ═══════════════════════════════════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════════════════════════════════

beforeAll(async () => {
  await setupTestServer()
  await bootstrapSecondUser()
}, 30000)

// Helper to create a plan
const samplePlan = (overrides: Record<string, unknown> = {}) => ({
  title: `Test Plan ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  description: 'A test community plan',
  planData: {
    nodes: [
      { id: 'node-1', title: 'Task 1', type: 'task', status: 'planned', position: { x: 0, y: 0 } },
      { id: 'node-2', title: 'Task 2', type: 'task', status: 'planned', position: { x: 200, y: 0 } },
    ],
    edges: [
      { id: 'edge-1', source: 'node-1', target: 'node-2', type: 'default' },
    ],
  },
  category: 'engineering',
  tags: ['test', 'automation'],
  visibility: 'public',
  ...overrides,
})

// Helper: PUT JSON as a specific user
function putJsonAs(userId: string, path: string, body: unknown): Promise<Response> {
  return getApp().request(path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
    },
    body: JSON.stringify(body),
  })
}

// ═══════════════════════════════════════════════════════════════════════
// POST /api/community/plans — Publish
// ═══════════════════════════════════════════════════════════════════════

describe('POST /api/community/plans', () => {
  it('publishes a plan with all fields', async () => {
    const res = await postJson('/api/community/plans', samplePlan())
    expect(res.status).toBe(201)
    const plan = await res.json() as Record<string, unknown>
    expect(plan.id).toBeTruthy()
    expect(plan.title).toContain('Test Plan')
    expect(plan.description).toBe('A test community plan')
    expect(plan.category).toBe('engineering')
    expect(plan.tags).toEqual(['test', 'automation'])
    expect(plan.visibility).toBe('public')
    expect(plan.starsCount).toBe(0)
    expect(plan.forksCount).toBe(0)
  })

  it('rejects missing title', async () => {
    const res = await postJson('/api/community/plans', samplePlan({ title: '' }))
    expect(res.status).toBe(400)
  })

  it('rejects missing planData', async () => {
    const res = await postJson('/api/community/plans', samplePlan({ planData: null }))
    expect(res.status).toBe(400)
  })

  it('rejects invalid planData (no nodes/edges)', async () => {
    const res = await postJson('/api/community/plans', samplePlan({ planData: { foo: 'bar' } }))
    expect(res.status).toBe(400)
  })

  it('rejects invalid visibility enum', async () => {
    const res = await postJson('/api/community/plans', samplePlan({ visibility: 'private' }))
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain('visibility must be one of')
  })

  it('strips execution fields from nodes', async () => {
    const planWithExecution = samplePlan({
      planData: {
        nodes: [
          {
            id: 'n1',
            title: 'Task',
            executionId: 'exec-123',
            executionOutput: 'secret output',
            executionError: 'error details',
            executionStartedAt: '2026-01-01',
            executionCompletedAt: '2026-01-02',
          },
        ],
        edges: [],
      },
    })
    const res = await postJson('/api/community/plans', planWithExecution)
    expect(res.status).toBe(201)
    const plan = await res.json() as Record<string, unknown>
    const planData = plan.planData as { nodes: Record<string, unknown>[] }
    expect(planData.nodes[0].executionId).toBeUndefined()
    expect(planData.nodes[0].executionOutput).toBeUndefined()
    expect(planData.nodes[0].executionError).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// GET /api/community/plans — List
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/community/plans', () => {
  it('lists public plans with pagination', async () => {
    await postJson('/api/community/plans', samplePlan({ title: 'List Test Plan' }))

    const res = await request('/api/community/plans')
    expect(res.status).toBe(200)
    const body = await res.json() as { plans: unknown[]; pagination: { total: number } }
    expect(body.plans.length).toBeGreaterThan(0)
    expect(body.pagination).toBeDefined()
    expect(body.pagination.total).toBeGreaterThan(0)
  })

  it('filters by search', async () => {
    const uniqueTitle = `SearchUnique-${Date.now()}`
    await postJson('/api/community/plans', samplePlan({ title: uniqueTitle }))

    const res = await request(`/api/community/plans?search=${uniqueTitle}`)
    expect(res.status).toBe(200)
    const body = await res.json() as { plans: Array<{ title: string }> }
    expect(body.plans.some(p => p.title === uniqueTitle)).toBe(true)
  })

  it('filters by category', async () => {
    const uniqueCategory = `cat-${Date.now()}`
    await postJson('/api/community/plans', samplePlan({ category: uniqueCategory }))

    const res = await request(`/api/community/plans?category=${uniqueCategory}`)
    expect(res.status).toBe(200)
    const body = await res.json() as { plans: Array<{ category: string }> }
    expect(body.plans.every(p => p.category === uniqueCategory)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// GET /api/community/plans/:id — Detail
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/community/plans/:id', () => {
  it('returns plan details', async () => {
    const createRes = await postJson('/api/community/plans', samplePlan())
    const created = await createRes.json() as Record<string, unknown>

    const res = await request(`/api/community/plans/${created.id}`)
    expect(res.status).toBe(200)
    const plan = await res.json() as Record<string, unknown>
    expect(plan.id).toBe(created.id)
    expect(plan.planData).toBeDefined()
  })

  it('returns 404 for nonexistent plan', async () => {
    const res = await request('/api/community/plans/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// PUT /api/community/plans/:id — Update
// ═══════════════════════════════════════════════════════════════════════

describe('PUT /api/community/plans/:id', () => {
  it('updates own plan', async () => {
    const createRes = await postJson('/api/community/plans', samplePlan())
    const created = await createRes.json() as Record<string, unknown>

    const res = await putJson(`/api/community/plans/${created.id}`, {
      description: 'Updated description',
      tags: ['updated'],
    })
    expect(res.status).toBe(200)
    const updated = await res.json() as Record<string, unknown>
    expect(updated.description).toBe('Updated description')
    expect(updated.tags).toEqual(['updated'])
  })

  it('rejects update by non-author', async () => {
    const createRes = await postJson('/api/community/plans', samplePlan())
    const created = await createRes.json() as Record<string, unknown>

    // Second user can read (public plan)
    const readRes = await getAs(SECOND_USER_ID, `/api/community/plans/${created.id}`)
    expect(readRes.status).toBe(200)

    // But cannot update
    const updateRes = await putJsonAs(SECOND_USER_ID, `/api/community/plans/${created.id}`, {
      description: 'Hacked',
    })
    expect(updateRes.status).toBe(403)
  })

  it('rejects invalid visibility enum on update', async () => {
    const createRes = await postJson('/api/community/plans', samplePlan())
    const created = await createRes.json() as Record<string, unknown>

    const res = await putJson(`/api/community/plans/${created.id}`, {
      visibility: 'secret',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain('visibility must be one of')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// DELETE /api/community/plans/:id — Soft delete
// ═══════════════════════════════════════════════════════════════════════

describe('DELETE /api/community/plans/:id', () => {
  it('soft-deletes own plan', async () => {
    const createRes = await postJson('/api/community/plans', samplePlan())
    const created = await createRes.json() as Record<string, unknown>

    const res = await del(`/api/community/plans/${created.id}`)
    expect(res.status).toBe(200)

    // Plan should no longer appear
    const listRes = await request(`/api/community/plans/${created.id}`)
    expect(listRes.status).toBe(404)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// POST /api/community/plans/:id/star — Star/unstar
// ═══════════════════════════════════════════════════════════════════════

describe('POST /api/community/plans/:id/star', () => {
  it('stars and unstars a plan atomically', async () => {
    const createRes = await postJson('/api/community/plans', samplePlan())
    const created = await createRes.json() as Record<string, unknown>

    // Star
    const starRes = await postJson(`/api/community/plans/${created.id}/star`, {})
    expect(starRes.status).toBe(200)
    const starBody = await starRes.json() as { starred: boolean; starsCount: number }
    expect(starBody.starred).toBe(true)
    expect(starBody.starsCount).toBe(1)

    // Unstar
    const unstarRes = await postJson(`/api/community/plans/${created.id}/star`, {})
    expect(unstarRes.status).toBe(200)
    const unstarBody = await unstarRes.json() as { starred: boolean; starsCount: number }
    expect(unstarBody.starred).toBe(false)
    expect(unstarBody.starsCount).toBe(0)
  })

  it('returns 404 for nonexistent plan', async () => {
    const res = await postJson('/api/community/plans/00000000-0000-0000-0000-000000000000/star', {})
    expect(res.status).toBe(404)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// POST /api/community/plans/:id/fork — Fork
// ═══════════════════════════════════════════════════════════════════════

describe('POST /api/community/plans/:id/fork', () => {
  it('forks a plan and increments forksCount', async () => {
    const createRes = await postJson('/api/community/plans', samplePlan())
    const created = await createRes.json() as Record<string, unknown>

    const forkRes = await postJson(`/api/community/plans/${created.id}/fork`, {
      projectName: 'Forked Project',
    })
    expect(forkRes.status).toBe(201)
    const forkBody = await forkRes.json() as { projectId: string }
    expect(forkBody.projectId).toBeTruthy()

    // Verify forksCount incremented
    const detailRes = await request(`/api/community/plans/${created.id}`)
    const detail = await detailRes.json() as Record<string, unknown>
    expect(detail.forksCount).toBe(1)
  })

  it('returns 403 for unlisted plan by non-author', async () => {
    const createRes = await postJson('/api/community/plans', samplePlan({ visibility: 'unlisted' }))
    const created = await createRes.json() as Record<string, unknown>

    const forkRes = await postJsonAs(SECOND_USER_ID, `/api/community/plans/${created.id}/fork`, {
      projectName: 'Stolen Fork',
    })
    expect(forkRes.status).toBe(403)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// GET /api/community/plans/trending — Trending
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/community/plans/trending', () => {
  it('returns trending plans (not captured by :id route)', async () => {
    const res = await request('/api/community/plans/trending')
    expect(res.status).toBe(200)
    const body = await res.json() as { plans: unknown[] }
    expect(Array.isArray(body.plans)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// GET /api/community/plans/categories — Categories
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/community/plans/categories', () => {
  it('returns categories with counts (not captured by :id route)', async () => {
    const res = await request('/api/community/plans/categories')
    expect(res.status).toBe(200)
    const body = await res.json() as { categories: Array<{ category: string; count: number }> }
    expect(Array.isArray(body.categories)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Comments — POST/GET /api/community/plans/:id/comments
// ═══════════════════════════════════════════════════════════════════════

describe('Community plan comments', () => {
  it('adds and lists comments', async () => {
    const createRes = await postJson('/api/community/plans', samplePlan())
    const created = await createRes.json() as Record<string, unknown>

    // Add comment
    const commentRes = await postJson(`/api/community/plans/${created.id}/comments`, {
      content: 'Great plan!',
    })
    expect(commentRes.status).toBe(201)
    const comment = await commentRes.json() as Record<string, unknown>
    expect(comment.content).toBe('Great plan!')

    // List comments
    const listRes = await request(`/api/community/plans/${created.id}/comments`)
    expect(listRes.status).toBe(200)
    const comments = await listRes.json() as { comments: unknown[] }
    expect(comments.comments.length).toBeGreaterThan(0)
  })

  it('rejects empty comment', async () => {
    const createRes = await postJson('/api/community/plans', samplePlan())
    const created = await createRes.json() as Record<string, unknown>

    const res = await postJson(`/api/community/plans/${created.id}/comments`, { content: '' })
    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Visibility filtering — unlisted plans hidden from non-authors
// ═══════════════════════════════════════════════════════════════════════

describe('Visibility filtering', () => {
  it('hides unlisted plans from non-authors in list', async () => {
    const uniqueTitle = `Unlisted-${Date.now()}`
    await postJson('/api/community/plans', samplePlan({
      title: uniqueTitle,
      visibility: 'unlisted',
    }))

    // Author can find it
    const authorRes = await request(`/api/community/plans?search=${uniqueTitle}`)
    const authorBody = await authorRes.json() as { plans: Array<{ title: string }> }
    expect(authorBody.plans.some(p => p.title === uniqueTitle)).toBe(true)

    // Second user cannot find it
    const otherRes = await getAs(SECOND_USER_ID, `/api/community/plans?search=${uniqueTitle}`)
    const otherBody = await otherRes.json() as { plans: Array<{ title: string }> }
    expect(otherBody.plans.some(p => p.title === uniqueTitle)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// My plans — GET /api/community/my-plans
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/community/my-plans', () => {
  it('returns only current user plans', async () => {
    const uniqueTitle = `MyPlan-${Date.now()}`
    await postJson('/api/community/plans', samplePlan({ title: uniqueTitle }))

    const res = await request('/api/community/my-plans')
    expect(res.status).toBe(200)
    const body = await res.json() as { plans: Array<{ title: string }> }
    expect(body.plans.some(p => p.title === uniqueTitle)).toBe(true)

    // Second user should not see it
    const otherRes = await getAs(SECOND_USER_ID, '/api/community/my-plans')
    const otherBody = await otherRes.json() as { plans: Array<{ title: string }> }
    expect(otherBody.plans.some(p => p.title === uniqueTitle)).toBe(false)
  })
})
