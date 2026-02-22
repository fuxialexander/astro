/**
 * Integration test: User profile, display settings, usage metrics, and settings
 *
 * Tests GET/PUT profile, GET/PATCH display settings, GET/PATCH settings,
 * and GET/POST usage metrics round-trips.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestServer, request, putJson, patchJson, postJson, db } from '../helpers/test-server.js'
import { displaySettings, usageMetrics } from '../../server/lib/db/schema.js'

beforeAll(async () => {
  await setupTestServer()
})

describe('GET /api/data/profile', () => {
  it('returns the local user profile', async () => {
    const res = await request('/api/data/profile')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toBeTruthy()
    expect(body.name).toBe('Local User')
    expect(body.email).toBe('dev@localhost')
  })
})

describe('PUT /api/data/profile', () => {
  it('updates profile fields', async () => {
    const res = await putJson('/api/data/profile', {
      name: 'Updated Name',
      bio: 'Test bio',
      domains: ['ai', 'systems'],
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Updated Name')
    expect(body.bio).toBe('Test bio')
    expect(body.domains).toEqual(['ai', 'systems'])
  })

  it('round-trips profile data', async () => {
    await putJson('/api/data/profile', {
      name: 'Round Trip',
      experienceLevel: 'expert',
    })

    const res = await request('/api/data/profile')
    const body = await res.json()
    expect(body.name).toBe('Round Trip')
    expect(body.experienceLevel).toBe('expert')
  })

  it('preserves existing fields on partial update', async () => {
    // Set initial state
    await putJson('/api/data/profile', {
      name: 'Initial',
      bio: 'Initial bio',
    })

    // Partial update — only name
    await putJson('/api/data/profile', {
      name: 'Partial Update',
    })

    const res = await request('/api/data/profile')
    const body = await res.json()
    expect(body.name).toBe('Partial Update')
    expect(body.bio).toBe('Initial bio') // preserved
  })
})

describe('Display Settings', () => {
  beforeEach(async () => {
    await db.delete(displaySettings)
  })

  it('GET returns empty object when no settings', async () => {
    const res = await request('/api/data/display-settings')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({})
  })

  it('PATCH creates and retrieves display settings', async () => {
    // Create settings for "tasks" view
    const patchRes = await patchJson('/api/data/display-settings/tasks', {
      groupBy: 'status',
      orderBy: 'priority',
    })
    expect(patchRes.status).toBe(200)

    // Retrieve all settings
    const getRes = await request('/api/data/display-settings')
    const body = await getRes.json()
    expect(body.tasks).toBeDefined()
    expect(body.tasks.groupBy).toBe('status')
    expect(body.tasks.orderBy).toBe('priority')
  })

  it('PATCH merges with existing settings', async () => {
    // Set initial
    await patchJson('/api/data/display-settings/plan', {
      groupBy: 'status',
      showLabels: true,
    })

    // Update one field
    await patchJson('/api/data/display-settings/plan', {
      groupBy: 'priority',
    })

    const res = await request('/api/data/display-settings')
    const body = await res.json()
    expect(body.plan.groupBy).toBe('priority')
    expect(body.plan.showLabels).toBe(true)
  })
})

describe('Settings', () => {
  it('GET returns default settings', async () => {
    const res = await request('/api/data/settings')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.model).toBeDefined()
  })

  it('PATCH and GET settings round-trip', async () => {
    const patchRes = await patchJson('/api/data/settings', {
      model: 'claude-opus-4-20250514',
      defaultProvider: 'claude-code',
    })
    expect(patchRes.status).toBe(200)

    const getRes = await request('/api/data/settings')
    const body = await getRes.json()
    expect(body.model).toBe('claude-opus-4-20250514')
    expect(body.defaultProvider).toBe('claude-code')
  })
})

describe('Usage Metrics', () => {
  beforeEach(async () => {
    await db.delete(usageMetrics)
  })

  it('GET returns zeroed metrics when no data', async () => {
    const res = await request('/api/data/usage/today')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalCostUsd).toBe(0)
    expect(body.totalInputTokens).toBe(0)
    expect(body.totalOutputTokens).toBe(0)
    expect(body.tasksCompleted).toBe(0)
    expect(body.tasksFailed).toBe(0)
  })

  it('POST increment creates initial metrics', async () => {
    const res = await postJson('/api/data/usage/increment', {
      totalCostUsd: 0.05,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      tasksCompleted: 1,
      tasksFailed: 0,
    })
    expect(res.status).toBe(200)

    const getRes = await request('/api/data/usage/today')
    const body = await getRes.json()
    expect(body.totalInputTokens).toBe(1000)
    expect(body.totalOutputTokens).toBe(500)
    expect(body.tasksCompleted).toBe(1)
  })

  it('POST increment accumulates metrics', async () => {
    // First increment
    await postJson('/api/data/usage/increment', {
      totalInputTokens: 500,
      tasksCompleted: 1,
    })

    // Second increment
    await postJson('/api/data/usage/increment', {
      totalInputTokens: 300,
      tasksCompleted: 2,
    })

    const res = await request('/api/data/usage/today')
    const body = await res.json()
    expect(body.totalInputTokens).toBe(800)
    expect(body.tasksCompleted).toBe(3)
  })
})
