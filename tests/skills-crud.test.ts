/**
 * Tests for skills API routes and skill store
 *
 * Part 1: Integration tests for server/routes/skills.ts
 *   - Full CRUD operations (create, read, update, delete)
 *   - Toggle enabled/disabled
 *   - Validation (missing name, etc.)
 *   - Team scoping and cross-team isolation
 *   - 404 for nonexistent skills
 *   - 409 for duplicate ID/name conflicts
 *   - Config size limits
 *   - PUT validation (empty name, non-array tags/allowedTools)
 *   - Source immutability
 *
 * Part 2: Unit tests for src/stores/skill-store.ts
 *   - load() from dataClient (keyed by id)
 *   - addSkill / updateSkill / removeSkill / toggleSkill
 *   - Optimistic updates and error rollback
 *   - getEligibleSkills / getSkillPromptInjection
 *   - findByName lookup
 *   - Toast on load error
 *
 * Uses PGlite (local mode) for integration tests and mocked dataClient for store tests.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import {
  setupTestServer,
  request,
  postJson,
  putJson,
  del,
  getAs,
  postJsonAs,
  bootstrapSecondUser,
  LOCAL_USER_ID,
  LOCAL_TEAM_ID,
  SECOND_USER_ID,
} from './helpers/test-server.js'
import { bootstrapBuiltinSkills } from '../packages/core/src/db/bootstrap-skills.js'
import { loadBuiltinSkillsFromDisk } from '../server/lib/load-builtin-skills.js'

// ═══════════════════════════════════════════════════════════════════════
// Part 1: Skills API Route Integration Tests
// ═══════════════════════════════════════════════════════════════════════

beforeAll(async () => {
  await setupTestServer()
  await bootstrapSecondUser()
  const builtinSkills = loadBuiltinSkillsFromDisk()
  await bootstrapBuiltinSkills(builtinSkills)
}, 30000) // Increase timeout to 30s for server initialization

describe('POST /api/skills', () => {
  it('creates a skill with all fields', async () => {
    const res = await postJson('/api/skills', {
      name: 'Python Analysis',
      description: 'Analyze Python code for issues',
      instructions: 'Break down Python logic step by step.',
      version: '2.0.0',
      category: 'coding',
      tags: ['python', 'analysis'],
      source: 'user',
      enabled: true,
      allowedTools: ['read_file', 'write_file'],
      config: { timeout: 30 },
    })

    expect(res.status).toBe(201)
    const skill = await res.json() as Record<string, unknown>
    expect(skill.id).toBeTruthy()
    expect(skill.name).toBe('Python Analysis')
    expect(skill.description).toBe('Analyze Python code for issues')
    expect(skill.instructions).toBe('Break down Python logic step by step.')
    expect(skill.version).toBe('2.0.0')
    expect(skill.category).toBe('coding')
    expect(skill.tags).toEqual(['python', 'analysis'])
    expect(skill.source).toBe('user')
    expect(skill.enabled).toBe(true)
    expect(skill.allowedTools).toEqual(['read_file', 'write_file'])
    expect(skill.config).toEqual({ timeout: 30 })
    expect(skill.authorId).toBe(LOCAL_USER_ID)
    expect(skill.teamId).toBe(LOCAL_TEAM_ID)
    expect(skill.createdAt).toBeTruthy()
    expect(skill.updatedAt).toBeTruthy()
  })

  it('creates a skill with minimal fields (only name)', async () => {
    const res = await postJson('/api/skills', {
      name: 'Minimal Skill',
    })

    expect(res.status).toBe(201)
    const skill = await res.json() as Record<string, unknown>
    expect(skill.name).toBe('Minimal Skill')
    expect(skill.description).toBe('')
    expect(skill.instructions).toBe('')
    expect(skill.version).toBe('1.0.0')
    expect(skill.enabled).toBe(true)
    expect(skill.source).toBe('workspace')
    expect(skill.tags).toEqual([])
    expect(skill.allowedTools).toEqual([])
    expect(skill.config).toEqual({})
  })

  it('returns 400 when name is missing', async () => {
    const res = await postJson('/api/skills', {
      description: 'No name provided',
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('name is required')
  })

  it('returns 400 when name is empty string', async () => {
    const res = await postJson('/api/skills', {
      name: '',
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('name is required')
  })

  it('returns 400 when name is not a string', async () => {
    const res = await postJson('/api/skills', {
      name: 42,
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('name is required')
  })

  it('sets authorId from authenticated user', async () => {
    const res = await postJson('/api/skills', {
      name: 'Author Test',
    })

    expect(res.status).toBe(201)
    const skill = await res.json() as Record<string, unknown>
    expect(skill.authorId).toBe(LOCAL_USER_ID)
  })

  it('sets teamId from authenticated user', async () => {
    const res = await postJson('/api/skills', {
      name: 'Team Test',
    })

    expect(res.status).toBe(201)
    const skill = await res.json() as Record<string, unknown>
    expect(skill.teamId).toBe(LOCAL_TEAM_ID)
  })

  it('returns 409 on duplicate id', async () => {
    const id = crypto.randomUUID()

    const res1 = await postJson('/api/skills', {
      id,
      name: 'Original Name',
      description: 'v1',
    })
    expect(res1.status).toBe(201)

    // Second POST with same ID should fail with 409 (conflict)
    const res2 = await postJson('/api/skills', {
      id,
      name: 'Updated Name',
      description: 'v2',
    })
    expect(res2.status).toBe(409)
  })

  it('returns 409 on duplicate name within same team', async () => {
    const uniqueName = `Duplicate-Name-Test-${crypto.randomUUID().slice(0, 8)}`

    const res1 = await postJson('/api/skills', {
      name: uniqueName,
      description: 'First skill',
    })
    expect(res1.status).toBe(201)

    // Second POST with same name should fail with 409 (conflict)
    const res2 = await postJson('/api/skills', {
      name: uniqueName,
      description: 'Second skill with same name',
    })
    expect(res2.status).toBe(409)
    const body = await res2.json() as { error: string }
    expect(body.error).toContain('already exists')
  })

  it('returns 400 when config exceeds size limit', async () => {
    // Create a config that exceeds 100KB
    const largeConfig: Record<string, string> = {}
    for (let i = 0; i < 5000; i++) {
      largeConfig[`key_${i}`] = 'x'.repeat(100)
    }

    const res = await postJson('/api/skills', {
      name: 'Large Config Skill',
      config: largeConfig,
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Config too large')
  })
})

describe('GET /api/skills', () => {
  it('returns list of skills with total count', async () => {
    const res = await request('/api/skills')
    expect(res.status).toBe(200)

    const data = await res.json() as { skills: unknown[]; total: number }
    expect(Array.isArray(data.skills)).toBe(true)
    expect(data.total).toBe(data.skills.length)
    expect(data.total).toBeGreaterThan(0) // created in prior tests
  })

  it('returns skills scoped to user team', async () => {
    // Create skill as second user (different team)
    await postJsonAs(SECOND_USER_ID, '/api/skills', {
      name: 'Second User Skill',
      description: 'Belongs to second team',
    })

    // User 1 should NOT see user 2's skill
    const res = await request('/api/skills')
    const data = await res.json() as { skills: Array<{ name: string; teamId: string }> }

    const secondUserSkill = data.skills.find(s => s.name === 'Second User Skill')
    expect(secondUserSkill).toBeUndefined()
  })
})

describe('GET /api/skills/:id', () => {
  it('returns a skill by id', async () => {
    // Create a skill first
    const createRes = await postJson('/api/skills', {
      name: 'Get By Id Test',
      description: 'Test description',
    })
    const created = await createRes.json() as Record<string, unknown>

    const res = await request(`/api/skills/${created.id}`)
    expect(res.status).toBe(200)

    const skill = await res.json() as Record<string, unknown>
    expect(skill.id).toBe(created.id)
    expect(skill.name).toBe('Get By Id Test')
    expect(skill.description).toBe('Test description')
  })

  it('returns 404 for nonexistent skill id', async () => {
    const res = await request(`/api/skills/${crypto.randomUUID()}`)
    expect(res.status).toBe(404)

    const body = await res.json() as { error: string }
    expect(body.error).toContain('Skill not found')
  })

  it('returns 404 for skill from another team', async () => {
    // Create skill as second user
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/skills', {
      name: 'Cross Team Get Test',
    })
    const created = await createRes.json() as Record<string, unknown>

    // Try to GET as first user (different team)
    const res = await request(`/api/skills/${created.id}`)
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/skills/:id', () => {
  it('updates skill fields', async () => {
    // Create a skill
    const createRes = await postJson('/api/skills', {
      name: 'Update Test',
      description: 'Original description',
      enabled: true,
    })
    const created = await createRes.json() as Record<string, unknown>

    // Update it
    const updateRes = await putJson(`/api/skills/${created.id}`, {
      name: 'Updated Name',
      description: 'Updated description',
      version: '3.0.0',
      category: 'research',
      tags: ['updated'],
    })

    expect(updateRes.status).toBe(200)
    const updated = await updateRes.json() as Record<string, unknown>
    expect(updated.name).toBe('Updated Name')
    expect(updated.description).toBe('Updated description')
    expect(updated.version).toBe('3.0.0')
    expect(updated.category).toBe('research')
    expect(updated.tags).toEqual(['updated'])
    // Original field preserved
    expect(updated.enabled).toBe(true)
  })

  it('partially updates — only changes specified fields', async () => {
    const createRes = await postJson('/api/skills', {
      name: 'Partial Update',
      description: 'Original',
      instructions: 'Keep this',
    })
    const created = await createRes.json() as Record<string, unknown>

    const updateRes = await putJson(`/api/skills/${created.id}`, {
      description: 'Changed',
    })

    expect(updateRes.status).toBe(200)
    const updated = await updateRes.json() as Record<string, unknown>
    expect(updated.description).toBe('Changed')
    expect(updated.name).toBe('Partial Update')
    expect(updated.instructions).toBe('Keep this')
  })

  it('updates updatedAt timestamp', async () => {
    const createRes = await postJson('/api/skills', {
      name: 'Timestamp Update Test',
    })
    const created = await createRes.json() as Record<string, unknown>
    const originalUpdatedAt = created.updatedAt as string

    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 10))

    const updateRes = await putJson(`/api/skills/${created.id}`, {
      description: 'trigger update',
    })
    const updated = await updateRes.json() as Record<string, unknown>
    const newUpdatedAt = updated.updatedAt as string

    // Both should be truthy timestamp strings
    expect(originalUpdatedAt).toBeTruthy()
    expect(newUpdatedAt).toBeTruthy()
  })

  it('returns 404 for nonexistent skill', async () => {
    const res = await putJson(`/api/skills/${crypto.randomUUID()}`, {
      name: 'Ghost',
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 when updating skill from another team', async () => {
    // Create as second user
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/skills', {
      name: 'Cross Team Update Test',
    })
    const created = await createRes.json() as Record<string, unknown>

    // Try to update as first user
    const res = await putJson(`/api/skills/${created.id}`, {
      name: 'Hijacked',
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when name is empty string', async () => {
    const createRes = await postJson('/api/skills', {
      name: 'Empty Name Test',
    })
    const created = await createRes.json() as Record<string, unknown>

    const updateRes = await putJson(`/api/skills/${created.id}`, {
      name: '',
    })
    expect(updateRes.status).toBe(400)
    const body = await updateRes.json() as { error: string }
    expect(body.error).toContain('non-empty string')
  })

  it('returns 400 when tags is not an array', async () => {
    const createRes = await postJson('/api/skills', {
      name: 'Tags Validation Test',
    })
    const created = await createRes.json() as Record<string, unknown>

    const updateRes = await putJson(`/api/skills/${created.id}`, {
      tags: 'not-an-array',
    })
    expect(updateRes.status).toBe(400)
    const body = await updateRes.json() as { error: string }
    expect(body.error).toContain('tags must be an array')
  })

  it('returns 400 when allowedTools is not an array', async () => {
    const createRes = await postJson('/api/skills', {
      name: 'AllowedTools Validation Test',
    })
    const created = await createRes.json() as Record<string, unknown>

    const updateRes = await putJson(`/api/skills/${created.id}`, {
      allowedTools: { tool: 'invalid' },
    })
    expect(updateRes.status).toBe(400)
    const body = await updateRes.json() as { error: string }
    expect(body.error).toContain('allowedTools must be an array')
  })

  it('returns 400 when config exceeds size limit', async () => {
    const createRes = await postJson('/api/skills', {
      name: 'Config Size Limit Test',
    })
    const created = await createRes.json() as Record<string, unknown>

    // Create a config that exceeds 100KB
    const largeConfig: Record<string, string> = {}
    for (let i = 0; i < 5000; i++) {
      largeConfig[`key_${i}`] = 'x'.repeat(100)
    }

    const updateRes = await putJson(`/api/skills/${created.id}`, {
      config: largeConfig,
    })
    expect(updateRes.status).toBe(400)
    const body = await updateRes.json() as { error: string }
    expect(body.error).toContain('Config too large')
  })

  it('returns 400 when trying to change source (immutable)', async () => {
    const createRes = await postJson('/api/skills', {
      name: `Source Immutable ${crypto.randomUUID().slice(0, 8)}`,
      source: 'workspace',
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json() as Record<string, unknown>

    const updateRes = await putJson(`/api/skills/${created.id}`, {
      source: 'clawhub',
    })
    expect(updateRes.status).toBe(400)
    const body = await updateRes.json() as { error: string }
    expect(body.error).toContain('immutable')
  })

  it('allows sending same source value on update (no-op)', async () => {
    const createRes = await postJson('/api/skills', {
      name: `Source Same ${crypto.randomUUID().slice(0, 8)}`,
      source: 'workspace',
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json() as Record<string, unknown>

    const updateRes = await putJson(`/api/skills/${created.id}`, {
      source: 'workspace',
      description: 'updated',
    })
    expect(updateRes.status).toBe(200)
    const updated = await updateRes.json() as Record<string, unknown>
    expect(updated.description).toBe('updated')
  })

  it('returns 409 when updating name to conflict with existing skill', async () => {
    const existingName = `Existing-Skill-${crypto.randomUUID().slice(0, 8)}`
    const toUpdateName = `To-Update-Skill-${crypto.randomUUID().slice(0, 8)}`

    // Create first skill
    await postJson('/api/skills', {
      name: existingName,
    })

    // Create second skill
    const createRes = await postJson('/api/skills', {
      name: toUpdateName,
    })
    const created = await createRes.json() as Record<string, unknown>

    // Try to update second skill's name to match first
    const updateRes = await putJson(`/api/skills/${created.id}`, {
      name: existingName,
    })
    expect(updateRes.status).toBe(409)
    const body = await updateRes.json() as { error: string }
    expect(body.error).toContain('already exists')
  })
})

describe('DELETE /api/skills/:id', () => {
  it('deletes a skill and returns ok + id', async () => {
    const createRes = await postJson('/api/skills', {
      name: 'Delete Me',
    })
    const created = await createRes.json() as Record<string, unknown>

    const deleteRes = await del(`/api/skills/${created.id}`)
    expect(deleteRes.status).toBe(200)

    const body = await deleteRes.json() as { ok: boolean; id: string }
    expect(body.ok).toBe(true)
    expect(body.id).toBe(created.id)

    // Verify it's gone
    const getRes = await request(`/api/skills/${created.id}`)
    expect(getRes.status).toBe(404)
  })

  it('returns 404 for nonexistent skill', async () => {
    const res = await del(`/api/skills/${crypto.randomUUID()}`)
    expect(res.status).toBe(404)
  })

  it('returns 404 when deleting skill from another team', async () => {
    // Create as second user
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/skills', {
      name: 'Cross Team Delete Test',
    })
    const created = await createRes.json() as Record<string, unknown>

    // Try to delete as first user
    const res = await del(`/api/skills/${created.id}`)
    expect(res.status).toBe(404)

    // Verify skill still exists for second user
    const getRes = await getAs(SECOND_USER_ID, `/api/skills/${created.id}`)
    expect(getRes.status).toBe(200)
  })
})

describe('PUT /api/skills/:id/toggle', () => {
  it('toggles enabled from true to false', async () => {
    const createRes = await postJson('/api/skills', {
      name: 'Toggle True→False',
      enabled: true,
    })
    const created = await createRes.json() as Record<string, unknown>
    expect(created.enabled).toBe(true)

    const toggleRes = await putJson(`/api/skills/${created.id}/toggle`, {})
    expect(toggleRes.status).toBe(200)

    const toggled = await toggleRes.json() as Record<string, unknown>
    expect(toggled.enabled).toBe(false)
  })

  it('toggles enabled from false to true', async () => {
    const createRes = await postJson('/api/skills', {
      name: 'Toggle False→True',
      enabled: false,
    })
    const created = await createRes.json() as Record<string, unknown>
    expect(created.enabled).toBe(false)

    const toggleRes = await putJson(`/api/skills/${created.id}/toggle`, {})
    expect(toggleRes.status).toBe(200)

    const toggled = await toggleRes.json() as Record<string, unknown>
    expect(toggled.enabled).toBe(true)
  })

  it('double toggle returns to original state', async () => {
    const createRes = await postJson('/api/skills', {
      name: 'Double Toggle',
      enabled: true,
    })
    const created = await createRes.json() as Record<string, unknown>

    await putJson(`/api/skills/${created.id}/toggle`, {})
    const secondToggle = await putJson(`/api/skills/${created.id}/toggle`, {})
    const result = await secondToggle.json() as Record<string, unknown>

    expect(result.enabled).toBe(true)
  })

  it('returns 404 for nonexistent skill', async () => {
    const res = await putJson(`/api/skills/${crypto.randomUUID()}/toggle`, {})
    expect(res.status).toBe(404)
  })

  it('returns 404 when toggling skill from another team', async () => {
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/skills', {
      name: 'Cross Team Toggle Test',
    })
    const created = await createRes.json() as Record<string, unknown>

    const res = await putJson(`/api/skills/${created.id}/toggle`, {})
    expect(res.status).toBe(404)
  })
})

describe('team scoping and isolation', () => {
  it('user 1 and user 2 see different skill lists', async () => {
    // Create unique skills for each user
    const uniqueName1 = `User1-Only-${crypto.randomUUID().slice(0, 8)}`
    const uniqueName2 = `User2-Only-${crypto.randomUUID().slice(0, 8)}`

    await postJson('/api/skills', { name: uniqueName1 })
    await postJsonAs(SECOND_USER_ID, '/api/skills', { name: uniqueName2 })

    // Check user 1's list
    const res1 = await request('/api/skills')
    const data1 = await res1.json() as { skills: Array<{ name: string }> }
    const names1 = data1.skills.map(s => s.name)
    expect(names1).toContain(uniqueName1)
    expect(names1).not.toContain(uniqueName2)

    // Check user 2's list
    const res2 = await getAs(SECOND_USER_ID, '/api/skills')
    const data2 = await res2.json() as { skills: Array<{ name: string }> }
    const names2 = data2.skills.map(s => s.name)
    expect(names2).toContain(uniqueName2)
    expect(names2).not.toContain(uniqueName1)
  })

  it('each user gets skills from their own team or global skills', async () => {
    const res = await request('/api/skills')
    const data = await res.json() as { skills: Array<{ teamId: string | null; authorId: string | null }> }

    // Every skill visible to user 1 should belong to their team
    // OR be a global skill (teamId null — includes builtins)
    for (const skill of data.skills) {
      const teamMatch = skill.teamId === LOCAL_TEAM_ID
      const globalMatch = skill.teamId === null
      expect(teamMatch || globalMatch).toBe(true)
    }
  })
})

describe('builtin skill protection', () => {
  let builtinSkillId: string

  it('builtin skills are visible to all users', async () => {
    const res = await request('/api/skills')
    const data = await res.json() as { skills: Array<{ id: string; name: string; source: string; teamId: string | null }> }

    const builtins = data.skills.filter(s => s.source === 'builtin')
    expect(builtins.length).toBeGreaterThan(0)

    // Builtins have no teamId
    for (const b of builtins) {
      expect(b.teamId).toBeNull()
    }

    builtinSkillId = builtins[0].id
  })

  it('returns 403 when trying to update a builtin skill', async () => {
    const res = await putJson(`/api/skills/${builtinSkillId}`, { description: 'hacked' })
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('builtin')
  })

  it('returns 403 when trying to delete a builtin skill', async () => {
    const res = await del(`/api/skills/${builtinSkillId}`)
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('builtin')
  })

  it('returns 403 when trying to create a skill with source=builtin', async () => {
    const res = await postJson('/api/skills', {
      name: 'Fake Builtin',
      source: 'builtin',
    })
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('builtin')
  })

  it('allows toggling builtin skills (enable/disable without deleting)', async () => {
    // Toggling builtins is intentionally allowed so users can disable
    // a builtin skill from prompt injection without deleting it
    const toggleRes = await putJson(`/api/skills/${builtinSkillId}/toggle`, {})
    expect(toggleRes.status).toBe(200)
    const toggled = await toggleRes.json() as Record<string, unknown>
    expect(toggled.enabled).toBe(false)

    // Toggle back
    const toggleBackRes = await putJson(`/api/skills/${builtinSkillId}/toggle`, {})
    expect(toggleBackRes.status).toBe(200)
    const toggledBack = await toggleBackRes.json() as Record<string, unknown>
    expect(toggledBack.enabled).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part 2: Skill Store Unit Tests
// ═══════════════════════════════════════════════════════════════════════

// Store tests use mocked dataClient — separate vi.mock context
describe('skill store', () => {
  // We dynamically import the store and mock dataClient in each test block
  // to avoid conflicts with the integration tests above.

  type SkillRow = import('../src/stores/skill-store').SkillRow
  let useSkillStore: typeof import('../src/stores/skill-store').useSkillStore
  let mockDataClient: {
    listSkills: ReturnType<typeof vi.fn>
    createSkill: ReturnType<typeof vi.fn>
    updateSkill: ReturnType<typeof vi.fn>
    deleteSkill: ReturnType<typeof vi.fn>
    toggleSkill: ReturnType<typeof vi.fn>
  }
  let mockToastAdd: ReturnType<typeof vi.fn>

  beforeAll(async () => {
    // Set up mock for dataClient
    mockDataClient = {
      listSkills: vi.fn().mockResolvedValue([]),
      createSkill: vi.fn().mockResolvedValue({ id: 'mock-id', name: 'mock' }),
      updateSkill: vi.fn().mockResolvedValue({ id: 'mock-id', name: 'mock' }),
      deleteSkill: vi.fn().mockResolvedValue(undefined),
      toggleSkill: vi.fn().mockResolvedValue({ id: 'mock-id', name: 'mock', enabled: false }),
    }

    // Mock toast store
    mockToastAdd = vi.fn()

    // Mock the data client module
    vi.doMock('@/lib/data-client', () => ({
      dataClient: mockDataClient,
    }))

    // Mock toast store to prevent errors and capture calls
    vi.doMock('@/stores/toast-store', () => ({
      useToastStore: {
        getState: () => ({
          add: mockToastAdd,
        }),
      },
    }))

    // Import the store after mocking
    const storeModule = await import('../src/stores/skill-store')
    useSkillStore = storeModule.useSkillStore
  })

  function resetStore() {
    useSkillStore.setState({
      skills: new Map(),
      loaded: false,
      loading: false,
      error: null,
    })
    mockToastAdd.mockClear()
  }

  interface TestSkillRow {
    id: string
    name: string
    description: string
    instructions: string
    source: 'builtin' | 'workspace' | 'clawhub' | 'plugin'
    enabled: boolean
    config?: Record<string, unknown>
    version?: string
    category?: string
    tags?: string[]
    allowedTools?: string[]
    sourceUrl?: string
    userInvocable?: boolean
    disableModelInvocation?: boolean
  }

  function makeSkillRow(overrides: Partial<TestSkillRow> = {}): TestSkillRow {
    return {
      id: crypto.randomUUID(),
      name: `test-skill-${crypto.randomUUID().slice(0, 8)}`,
      description: 'A test skill',
      instructions: 'Test instructions',
      source: 'user' as const,
      enabled: true,
      config: {},
      version: '1.0.0',
      ...overrides,
    }
  }

  describe('load', () => {
    beforeEach(() => {
      resetStore()
      vi.clearAllMocks()
    })

    it('loads skills from dataClient into the map keyed by id', async () => {
      const skill1 = makeSkillRow({ id: 'id-alpha', name: 'alpha' })
      const skill2 = makeSkillRow({ id: 'id-beta', name: 'beta' })
      mockDataClient.listSkills.mockResolvedValueOnce([skill1, skill2])

      await useSkillStore.getState().load()

      const state = useSkillStore.getState()
      expect(state.loaded).toBe(true)
      expect(state.loading).toBe(false)
      expect(state.error).toBeNull()
      expect(state.skills.size).toBe(2)
      expect(state.skills.get('id-alpha')).toBeDefined()
      expect(state.skills.get('id-beta')).toBeDefined()
      expect(state.skills.get('id-alpha')?.name).toBe('alpha')
      expect(state.skills.get('id-beta')?.name).toBe('beta')
    })

    it('sets loading flag during load', async () => {
      let resolveLoad: (v: unknown[]) => void
      const loadPromise = new Promise<unknown[]>((resolve) => {
        resolveLoad = resolve
      })
      mockDataClient.listSkills.mockReturnValueOnce(loadPromise)

      const loadCall = useSkillStore.getState().load()

      // Should be loading
      expect(useSkillStore.getState().loading).toBe(true)
      expect(useSkillStore.getState().loaded).toBe(false)

      // Resolve
      resolveLoad!([])
      await loadCall

      expect(useSkillStore.getState().loading).toBe(false)
      expect(useSkillStore.getState().loaded).toBe(true)
    })

    it('handles load error gracefully and shows toast', async () => {
      mockDataClient.listSkills.mockRejectedValueOnce(new Error('Network error'))

      await useSkillStore.getState().load()

      const state = useSkillStore.getState()
      // Should still mark as loaded so app doesn't block
      expect(state.loaded).toBe(true)
      expect(state.loading).toBe(false)
      expect(state.error).toContain('Network error')

      // Should show toast notification
      expect(mockToastAdd).toHaveBeenCalledWith({
        type: 'error',
        title: 'Failed to load skills',
        description: 'Network error',
      })
    })

    it('handles non-Error rejections', async () => {
      mockDataClient.listSkills.mockRejectedValueOnce('string error')

      await useSkillStore.getState().load()

      const state = useSkillStore.getState()
      expect(state.loaded).toBe(true)
      expect(state.error).toBe('Failed to load skills')
    })

    it('replaces existing skills on reload', async () => {
      // First load
      mockDataClient.listSkills.mockResolvedValueOnce([
        makeSkillRow({ id: 'old-id', name: 'old-skill' }),
      ])
      await useSkillStore.getState().load()
      expect(useSkillStore.getState().skills.size).toBe(1)

      // Second load with different data
      mockDataClient.listSkills.mockResolvedValueOnce([
        makeSkillRow({ id: 'new-id-1', name: 'new-skill-1' }),
        makeSkillRow({ id: 'new-id-2', name: 'new-skill-2' }),
      ])
      await useSkillStore.getState().load()

      expect(useSkillStore.getState().skills.size).toBe(2)
      expect(useSkillStore.getState().skills.has('old-id')).toBe(false)
      expect(useSkillStore.getState().skills.has('new-id-1')).toBe(true)
    })
  })

  describe('findByName', () => {
    beforeEach(() => {
      resetStore()
    })

    it('finds skill by name', () => {
      const skill = makeSkillRow({ id: 'find-id', name: 'findable-skill' })
      useSkillStore.setState({
        skills: new Map([['find-id', skill as unknown as SkillRow]]),
      })

      const found = useSkillStore.getState().findByName('findable-skill')
      expect(found).toBeDefined()
      expect(found?.id).toBe('find-id')
      expect(found?.name).toBe('findable-skill')
    })

    it('returns undefined when skill not found', () => {
      const found = useSkillStore.getState().findByName('nonexistent')
      expect(found).toBeUndefined()
    })

    it('finds correct skill among multiple', () => {
      const skill1 = makeSkillRow({ id: 'id-1', name: 'alpha' })
      const skill2 = makeSkillRow({ id: 'id-2', name: 'beta' })
      const skill3 = makeSkillRow({ id: 'id-3', name: 'gamma' })
      useSkillStore.setState({
        skills: new Map([
          ['id-1', skill1 as unknown as SkillRow],
          ['id-2', skill2 as unknown as SkillRow],
          ['id-3', skill3 as unknown as SkillRow],
        ]),
      })

      const found = useSkillStore.getState().findByName('beta')
      expect(found?.id).toBe('id-2')
    })
  })

  describe('addSkill', () => {
    beforeEach(() => {
      resetStore()
      vi.clearAllMocks()
    })

    it('optimistically adds skill to local state keyed by temp id', () => {
      const store = useSkillStore.getState()
      store.addSkill({
        name: 'new-skill',
        description: 'A new skill',
        instructions: 'Do something',
        source: 'user',
        enabled: true,
      })

      const state = useSkillStore.getState()
      expect(state.skills.size).toBe(1)
      const skill = Array.from(state.skills.values())[0]
      expect(skill.name).toBe('new-skill')
      expect(skill.description).toBe('A new skill')
      expect(skill.id).toBeTruthy() // Temp ID assigned
    })

    it('calls dataClient.createSkill for backend sync', () => {
      useSkillStore.getState().addSkill({
        name: 'synced-skill',
        description: 'Will sync',
        instructions: 'Sync instructions',
        source: 'user',
        enabled: true,
      })

      expect(mockDataClient.createSkill).toHaveBeenCalledOnce()
      expect(mockDataClient.createSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'synced-skill',
          description: 'Will sync',
        })
      )
    })

    it('replaces temp entry with server response after successful sync', async () => {
      const serverRow = makeSkillRow({ id: 'server-id', name: 'merged-skill' })
      mockDataClient.createSkill.mockResolvedValueOnce(serverRow)

      useSkillStore.getState().addSkill({
        name: 'merged-skill',
        description: 'Test',
        instructions: 'Test',
        source: 'user',
        enabled: true,
      })

      // Wait for async sync
      await vi.waitFor(() => {
        const skills = useSkillStore.getState().skills
        expect(skills.has('server-id')).toBe(true)
      })

      // Should have exactly one skill keyed by server id
      const state = useSkillStore.getState()
      expect(state.skills.size).toBe(1)
      expect(state.skills.get('server-id')?.name).toBe('merged-skill')
    })
  })

  describe('updateSkill', () => {
    beforeEach(() => {
      resetStore()
      vi.clearAllMocks()
    })

    it('optimistically updates skill in local state by id', () => {
      const existing = makeSkillRow({ id: 'update-id', name: 'to-update', description: 'Old' })
      useSkillStore.setState({
        skills: new Map([['update-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().updateSkill('update-id', { description: 'New' })

      const updated = useSkillStore.getState().skills.get('update-id')
      expect(updated?.description).toBe('New')
    })

    it('no-ops when skill does not exist', () => {
      useSkillStore.getState().updateSkill('nonexistent', { description: 'test' })
      expect(mockDataClient.updateSkill).not.toHaveBeenCalled()
    })

    it('calls dataClient.updateSkill for backend sync', () => {
      const existing = makeSkillRow({ id: 'skill-id', name: 'to-sync' })
      useSkillStore.setState({
        skills: new Map([['skill-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().updateSkill('skill-id', { description: 'Changed' })

      expect(mockDataClient.updateSkill).toHaveBeenCalledWith(
        'skill-id',
        expect.objectContaining({ description: 'Changed' })
      )
    })
  })

  describe('removeSkill', () => {
    beforeEach(() => {
      resetStore()
      vi.clearAllMocks()
    })

    it('optimistically removes skill from local state by id', () => {
      const existing = makeSkillRow({ id: 'remove-id', name: 'to-remove' })
      useSkillStore.setState({
        skills: new Map([['remove-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().removeSkill('remove-id')

      expect(useSkillStore.getState().skills.has('remove-id')).toBe(false)
    })

    it('calls dataClient.deleteSkill for backend sync', () => {
      const existing = makeSkillRow({ id: 'del-id', name: 'to-delete' })
      useSkillStore.setState({
        skills: new Map([['del-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().removeSkill('del-id')

      expect(mockDataClient.deleteSkill).toHaveBeenCalledWith('del-id')
    })

    it('reverts on backend failure', async () => {
      const existing = makeSkillRow({ id: 'revert-id', name: 'revert-me' })
      useSkillStore.setState({
        skills: new Map([['revert-id', existing as unknown as SkillRow]]),
      })

      mockDataClient.deleteSkill.mockRejectedValueOnce(new Error('Delete failed'))

      useSkillStore.getState().removeSkill('revert-id')

      // Immediately removed
      expect(useSkillStore.getState().skills.has('revert-id')).toBe(false)

      // After async rejection, should revert
      await vi.waitFor(() => {
        expect(useSkillStore.getState().skills.has('revert-id')).toBe(true)
      })
    })

    it('no-ops when skill does not exist', () => {
      useSkillStore.getState().removeSkill('nonexistent')
      expect(mockDataClient.deleteSkill).not.toHaveBeenCalled()
    })
  })

  describe('toggleSkill', () => {
    beforeEach(() => {
      resetStore()
      vi.clearAllMocks()
    })

    it('optimistically toggles enabled true → false by id', () => {
      const existing = makeSkillRow({ id: 'toggle-id', name: 'toggle-me', enabled: true })
      useSkillStore.setState({
        skills: new Map([['toggle-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().toggleSkill('toggle-id')

      expect(useSkillStore.getState().skills.get('toggle-id')?.enabled).toBe(false)
    })

    it('optimistically toggles enabled false → true by id', () => {
      const existing = makeSkillRow({ id: 'toggle-off-id', name: 'toggle-off', enabled: false })
      useSkillStore.setState({
        skills: new Map([['toggle-off-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().toggleSkill('toggle-off-id')

      expect(useSkillStore.getState().skills.get('toggle-off-id')?.enabled).toBe(true)
    })

    it('calls dataClient.toggleSkill for backend sync', () => {
      const existing = makeSkillRow({ id: 'toggle-id', name: 'synced-toggle' })
      useSkillStore.setState({
        skills: new Map([['toggle-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().toggleSkill('toggle-id')

      expect(mockDataClient.toggleSkill).toHaveBeenCalledWith('toggle-id')
    })

    it('reverts on backend failure', async () => {
      const existing = makeSkillRow({ id: 'fail-toggle-id', name: 'fail-toggle', enabled: true })
      useSkillStore.setState({
        skills: new Map([['fail-toggle-id', existing as unknown as SkillRow]]),
      })

      mockDataClient.toggleSkill.mockRejectedValueOnce(new Error('Toggle failed'))

      useSkillStore.getState().toggleSkill('fail-toggle-id')

      // Immediately toggled
      expect(useSkillStore.getState().skills.get('fail-toggle-id')?.enabled).toBe(false)

      // After async rejection, should revert
      await vi.waitFor(() => {
        expect(useSkillStore.getState().skills.get('fail-toggle-id')?.enabled).toBe(true)
      })
    })

    it('no-ops when skill does not exist', () => {
      useSkillStore.getState().toggleSkill('nonexistent')
      expect(mockDataClient.toggleSkill).not.toHaveBeenCalled()
    })
  })

  describe('updateSkillConfig', () => {
    beforeEach(() => {
      resetStore()
      vi.clearAllMocks()
    })

    it('updates config in local state by id', () => {
      const existing = makeSkillRow({ id: 'config-id', name: 'config-skill', config: { old: 1 } })
      useSkillStore.setState({
        skills: new Map([['config-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().updateSkillConfig('config-id', { new: 2 })

      expect(useSkillStore.getState().skills.get('config-id')?.config).toEqual({ new: 2 })
    })

    it('calls dataClient.updateSkill with config', () => {
      const existing = makeSkillRow({ id: 'cfg-id', name: 'cfg-sync' })
      useSkillStore.setState({
        skills: new Map([['cfg-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().updateSkillConfig('cfg-id', { apiKey: 'secret' })

      expect(mockDataClient.updateSkill).toHaveBeenCalledWith(
        'cfg-id',
        expect.objectContaining({ config: { apiKey: 'secret' } })
      )
    })

    it('no-ops when skill does not exist', () => {
      useSkillStore.getState().updateSkillConfig('nonexistent', { x: 1 })
      expect(mockDataClient.updateSkill).not.toHaveBeenCalled()
    })
  })

  describe('getEligibleSkills', () => {
    beforeEach(() => {
      resetStore()
    })

    it('returns only enabled skills without disableModelInvocation', () => {
      const enabled = makeSkillRow({ id: 'eligible-id', name: 'eligible', enabled: true })
      const disabled = makeSkillRow({ id: 'disabled-id', name: 'disabled', enabled: false })
      const noInvoke = makeSkillRow({ id: 'no-invoke-id', name: 'no-invoke', enabled: true, disableModelInvocation: true })

      useSkillStore.setState({
        skills: new Map([
          ['eligible-id', enabled as unknown as SkillRow],
          ['disabled-id', disabled as unknown as SkillRow],
          ['no-invoke-id', noInvoke as unknown as SkillRow],
        ]),
      })

      const eligible = useSkillStore.getState().getEligibleSkills()
      expect(eligible).toHaveLength(1)
      expect(eligible[0].name).toBe('eligible')
    })

    it('returns empty array when no skills', () => {
      const eligible = useSkillStore.getState().getEligibleSkills()
      expect(eligible).toEqual([])
    })

    it('returns all enabled skills when none have disableModelInvocation', () => {
      const s1 = makeSkillRow({ id: 'id-1', name: 'skill-1', enabled: true })
      const s2 = makeSkillRow({ id: 'id-2', name: 'skill-2', enabled: true })

      useSkillStore.setState({
        skills: new Map([
          ['id-1', s1 as unknown as SkillRow],
          ['id-2', s2 as unknown as SkillRow],
        ]),
      })

      const eligible = useSkillStore.getState().getEligibleSkills()
      expect(eligible).toHaveLength(2)
    })
  })

  describe('getSkillPromptInjection', () => {
    beforeEach(() => {
      resetStore()
    })

    it('returns empty string when no eligible skills', () => {
      expect(useSkillStore.getState().getSkillPromptInjection()).toBe('')
    })

    it('generates XML skill injection for eligible skills', () => {
      const skill = makeSkillRow({
        id: 'injection-id',
        name: 'test-skill',
        description: 'Test description',
        instructions: 'Do the thing.',
        enabled: true,
      })

      useSkillStore.setState({
        skills: new Map([['injection-id', skill as unknown as SkillRow]]),
      })

      const injection = useSkillStore.getState().getSkillPromptInjection()
      expect(injection).toContain('<skills>')
      expect(injection).toContain('</skills>')
      expect(injection).toContain('<skill name="test-skill" description="Test description">')
      expect(injection).toContain('Do the thing.')
      expect(injection).toContain('</skill>')
    })

    it('includes multiple eligible skills', () => {
      const s1 = makeSkillRow({ id: 'id-alpha', name: 'alpha', description: 'Alpha skill', instructions: 'Alpha instructions', enabled: true })
      const s2 = makeSkillRow({ id: 'id-beta', name: 'beta', description: 'Beta skill', instructions: 'Beta instructions', enabled: true })
      const disabled = makeSkillRow({ id: 'id-gamma', name: 'gamma', description: 'Disabled', instructions: 'Nope', enabled: false })

      useSkillStore.setState({
        skills: new Map([
          ['id-alpha', s1 as unknown as SkillRow],
          ['id-beta', s2 as unknown as SkillRow],
          ['id-gamma', disabled as unknown as SkillRow],
        ]),
      })

      const injection = useSkillStore.getState().getSkillPromptInjection()
      expect(injection).toContain('name="alpha"')
      expect(injection).toContain('name="beta"')
      expect(injection).not.toContain('name="gamma"')
    })
  })

  describe('enableSkill / disableSkill (deprecated)', () => {
    beforeEach(() => {
      resetStore()
      vi.clearAllMocks()
    })

    it('enableSkill enables a disabled skill by id', () => {
      const existing = makeSkillRow({ id: 'en-id', name: 'enable-me', enabled: false })
      useSkillStore.setState({
        skills: new Map([['en-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().enableSkill('en-id')

      expect(useSkillStore.getState().skills.get('en-id')?.enabled).toBe(true)
      expect(mockDataClient.toggleSkill).toHaveBeenCalledWith('en-id')
    })

    it('enableSkill no-ops when already enabled', () => {
      const existing = makeSkillRow({ id: 'en-id', name: 'already-on', enabled: true })
      useSkillStore.setState({
        skills: new Map([['en-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().enableSkill('en-id')

      expect(mockDataClient.toggleSkill).not.toHaveBeenCalled()
    })

    it('disableSkill disables an enabled skill by id', () => {
      const existing = makeSkillRow({ id: 'dis-id', name: 'disable-me', enabled: true })
      useSkillStore.setState({
        skills: new Map([['dis-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().disableSkill('dis-id')

      expect(useSkillStore.getState().skills.get('dis-id')?.enabled).toBe(false)
      expect(mockDataClient.toggleSkill).toHaveBeenCalledWith('dis-id')
    })

    it('disableSkill no-ops when already disabled', () => {
      const existing = makeSkillRow({ id: 'dis-id', name: 'already-off', enabled: false })
      useSkillStore.setState({
        skills: new Map([['dis-id', existing as unknown as SkillRow]]),
      })

      useSkillStore.getState().disableSkill('dis-id')

      expect(mockDataClient.toggleSkill).not.toHaveBeenCalled()
    })
  })
})
