/**
 * Tests for Skills API routes and Skill Store
 *
 * Covers:
 * ── API Routes (server/routes/skills.ts) ──────────────────────
 * - GET /api/skills — list all skills with eligibility status
 * - POST /api/skills/register — bulk register skills
 * - POST /api/skills/install — stub returns 501
 * - DELETE /api/skills/:name — remove a skill by name
 * - PUT /api/skills/:name/config — update skill configuration
 * - Auth: all routes require authentication
 * - Edge cases: empty registry, non-existent skills, invalid payloads
 *
 * ── Skill Store (src/stores/skill-store.ts) ───────────────────
 * - load() — fetches from API and populates store
 * - addSkill() — adds skill to local state
 * - removeSkill() — removes skill from local state
 * - enableSkill() / disableSkill() — toggles enabled flag
 * - updateSkillConfig() — updates per-skill config
 * - getEligibleSkills() — filters by enabled && !disableModelInvocation
 * - getSkillPromptInjection() — builds XML prompt string
 *
 * ── Skill Manager (server/lib/skill-manager.ts) ──────────────
 * - addSkill / removeSkill / getAllSkills / getEligibleSkills
 * - loadSkills (bulk replace)
 * - updateSkillConfig (merge semantics)
 *
 * ── Skill Injector (packages/core/src/skill-injector.ts) ─────
 * - getEligibleSkills — stateless filter
 * - buildSkillPromptInjection — XML generation
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════
// Part 1: API Route Tests (Integration — PGlite-backed test server)
// ═══════════════════════════════════════════════════════════════════════

import {
  setupTestServer,
  request,
  postJson,
  putJson,
  del,
} from './helpers/test-server.js'
import { skillManager } from '../server/lib/skill-manager.js'

beforeAll(async () => {
  await setupTestServer()
})

// Reset skill manager state between test groups
function clearSkillManager() {
  skillManager.loadSkills([])
}

// ── GET /api/skills ─────────────────────────────────────────────────

describe('GET /api/skills', () => {
  beforeEach(() => {
    clearSkillManager()
  })

  it('returns empty list when no skills are registered', async () => {
    const res = await request('/api/skills')
    expect(res.status).toBe(200)

    const data = await res.json() as { skills: unknown[]; total: number }
    expect(data.skills).toEqual([])
    expect(data.total).toBe(0)
  })

  it('returns all registered skills with correct fields', async () => {
    skillManager.addSkill({
      name: 'test-skill',
      description: 'A test skill',
      instructions: 'Do the thing',
      source: 'builtin',
      enabled: true,
    })

    const res = await request('/api/skills')
    expect(res.status).toBe(200)

    const data = await res.json() as {
      skills: Array<{
        name: string
        description: string
        source: string
        enabled: boolean
        eligible: boolean
        userInvocable: boolean
        pluginId?: string
        config?: Record<string, unknown>
      }>
      total: number
    }

    expect(data.total).toBe(1)
    expect(data.skills).toHaveLength(1)
    expect(data.skills[0]!.name).toBe('test-skill')
    expect(data.skills[0]!.description).toBe('A test skill')
    expect(data.skills[0]!.source).toBe('builtin')
    expect(data.skills[0]!.enabled).toBe(true)
    expect(data.skills[0]!.eligible).toBe(true)
    expect(data.skills[0]!.userInvocable).toBe(true)
  })

  it('correctly marks disabled skills as non-eligible', async () => {
    skillManager.addSkill({
      name: 'disabled-skill',
      description: 'A disabled skill',
      instructions: 'Disabled instructions',
      source: 'workspace',
      enabled: false,
    })

    const res = await request('/api/skills')
    const data = await res.json() as { skills: Array<{ name: string; eligible: boolean; enabled: boolean }> }

    expect(data.skills[0]!.enabled).toBe(false)
    expect(data.skills[0]!.eligible).toBe(false)
  })

  it('correctly marks disableModelInvocation skills as non-eligible', async () => {
    skillManager.addSkill({
      name: 'no-model-skill',
      description: 'Manual only',
      instructions: 'Manual instructions',
      source: 'builtin',
      enabled: true,
      disableModelInvocation: true,
    })

    const res = await request('/api/skills')
    const data = await res.json() as { skills: Array<{ name: string; eligible: boolean; enabled: boolean }> }

    expect(data.skills[0]!.enabled).toBe(true)
    expect(data.skills[0]!.eligible).toBe(false)
  })

  it('returns multiple skills', async () => {
    skillManager.addSkill({
      name: 'skill-a',
      description: 'Skill A',
      instructions: 'A instructions',
      source: 'builtin',
      enabled: true,
    })
    skillManager.addSkill({
      name: 'skill-b',
      description: 'Skill B',
      instructions: 'B instructions',
      source: 'workspace',
      enabled: false,
    })
    skillManager.addSkill({
      name: 'skill-c',
      description: 'Skill C',
      instructions: 'C instructions',
      source: 'clawhub',
      enabled: true,
      disableModelInvocation: true,
    })

    const res = await request('/api/skills')
    const data = await res.json() as { skills: Array<{ name: string; eligible: boolean }>; total: number }

    expect(data.total).toBe(3)
    const names = data.skills.map(s => s.name)
    expect(names).toContain('skill-a')
    expect(names).toContain('skill-b')
    expect(names).toContain('skill-c')

    // Only skill-a should be eligible (enabled + !disableModelInvocation)
    const eligible = data.skills.filter(s => s.eligible)
    expect(eligible).toHaveLength(1)
    expect(eligible[0]!.name).toBe('skill-a')
  })

  it('includes pluginId and config when present', async () => {
    skillManager.addSkill({
      name: 'plugin-skill',
      description: 'From plugin',
      instructions: 'Plugin instructions',
      source: 'plugin',
      pluginId: 'my-plugin-v1',
      enabled: true,
      config: { apiKey: 'sk-test', region: 'us-west-2' },
    })

    const res = await request('/api/skills')
    const data = await res.json() as { skills: Array<{ pluginId?: string; config?: Record<string, unknown> }> }

    expect(data.skills[0]!.pluginId).toBe('my-plugin-v1')
    expect(data.skills[0]!.config).toEqual({ apiKey: 'sk-test', region: 'us-west-2' })
  })
})

// ── POST /api/skills/register ───────────────────────────────────────

describe('POST /api/skills/register', () => {
  beforeEach(() => {
    clearSkillManager()
  })

  it('registers skills in bulk', async () => {
    const res = await postJson('/api/skills/register', {
      skills: [
        { name: 'bulk-1', description: 'First', instructions: 'Do first' },
        { name: 'bulk-2', description: 'Second', instructions: 'Do second' },
      ],
    })

    expect(res.status).toBe(200)
    const data = await res.json() as { success: boolean; total: number }
    expect(data.success).toBe(true)
    expect(data.total).toBe(2)

    // Verify skills are actually in the manager
    const all = skillManager.getAllSkills()
    expect(all).toHaveLength(2)
    expect(all.map(s => s.name)).toContain('bulk-1')
    expect(all.map(s => s.name)).toContain('bulk-2')
  })

  it('defaults source to workspace and enabled to true', async () => {
    await postJson('/api/skills/register', {
      skills: [{ name: 'default-skill', description: 'Test', instructions: 'Test' }],
    })

    const all = skillManager.getAllSkills()
    const skill = all.find(s => s.name === 'default-skill')
    expect(skill).toBeDefined()
    expect(skill!.source).toBe('workspace')
    expect(skill!.enabled).toBe(true)
  })

  it('respects custom source and enabled values', async () => {
    await postJson('/api/skills/register', {
      skills: [{
        name: 'custom-skill',
        description: 'Custom',
        instructions: 'Custom instructions',
        source: 'builtin',
        enabled: false,
      }],
    })

    const all = skillManager.getAllSkills()
    const skill = all.find(s => s.name === 'custom-skill')
    expect(skill!.source).toBe('builtin')
    expect(skill!.enabled).toBe(false)
  })

  it('returns 400 when skills is not an array', async () => {
    const res = await postJson('/api/skills/register', {
      skills: 'not-an-array',
    })
    expect(res.status).toBe(400)

    const data = await res.json() as { error: string }
    expect(data.error).toBe('skills must be an array')
  })

  it('overwrites existing skill with same name', async () => {
    skillManager.addSkill({
      name: 'overwrite-me',
      description: 'Original',
      instructions: 'Original instructions',
      source: 'builtin',
      enabled: true,
    })

    await postJson('/api/skills/register', {
      skills: [{
        name: 'overwrite-me',
        description: 'Updated',
        instructions: 'New instructions',
      }],
    })

    const all = skillManager.getAllSkills()
    const skill = all.find(s => s.name === 'overwrite-me')
    expect(skill!.description).toBe('Updated')
  })

  it('registers empty array without error', async () => {
    const res = await postJson('/api/skills/register', { skills: [] })
    expect(res.status).toBe(200)

    const data = await res.json() as { success: boolean; total: number }
    expect(data.success).toBe(true)
    expect(data.total).toBe(0)
  })
})

// ── POST /api/skills/install (stub) ─────────────────────────────────

describe('POST /api/skills/install', () => {
  it('returns 501 (not implemented)', async () => {
    const res = await postJson('/api/skills/install', { name: 'some-skill' })
    expect(res.status).toBe(501)

    const data = await res.json() as { error: string }
    expect(data.error).toContain('not yet implemented')
  })
})

// ── DELETE /api/skills/:name ────────────────────────────────────────

describe('DELETE /api/skills/:name', () => {
  beforeEach(() => {
    clearSkillManager()
  })

  it('removes an existing skill', async () => {
    skillManager.addSkill({
      name: 'delete-me',
      description: 'To be deleted',
      instructions: 'Delete instructions',
      source: 'workspace',
      enabled: true,
    })

    const res = await del('/api/skills/delete-me')
    expect(res.status).toBe(200)

    const data = await res.json() as { success: boolean; name: string }
    expect(data.success).toBe(true)
    expect(data.name).toBe('delete-me')

    // Verify removal
    expect(skillManager.getAllSkills()).toHaveLength(0)
  })

  it('returns 404 for non-existent skill', async () => {
    const res = await del('/api/skills/nonexistent')
    expect(res.status).toBe(404)

    const data = await res.json() as { error: string }
    expect(data.error).toContain("'nonexistent' not found")
  })

  it('handles skills with special characters in name', async () => {
    skillManager.addSkill({
      name: 'my-special_skill.v2',
      description: 'Special',
      instructions: 'Special instructions',
      source: 'workspace',
      enabled: true,
    })

    const res = await del('/api/skills/my-special_skill.v2')
    expect(res.status).toBe(200)
    expect(skillManager.getAllSkills()).toHaveLength(0)
  })
})

// ── PUT /api/skills/:name/config ────────────────────────────────────

describe('PUT /api/skills/:name/config', () => {
  beforeEach(() => {
    clearSkillManager()
  })

  it('updates skill configuration', async () => {
    skillManager.addSkill({
      name: 'configurable',
      description: 'Configurable skill',
      instructions: 'Config instructions',
      source: 'workspace',
      enabled: true,
    })

    const res = await putJson('/api/skills/configurable/config', {
      apiKey: 'sk-new-key',
      region: 'eu-west-1',
    })

    expect(res.status).toBe(200)
    const data = await res.json() as { success: boolean; name: string }
    expect(data.success).toBe(true)
    expect(data.name).toBe('configurable')

    // Verify config was updated on the skill
    const skill = skillManager.getAllSkills().find(s => s.name === 'configurable')
    expect(skill!.config).toEqual({ apiKey: 'sk-new-key', region: 'eu-west-1' })
  })

  it('merges config with existing values', async () => {
    skillManager.addSkill({
      name: 'merge-config',
      description: 'Merge test',
      instructions: 'Merge instructions',
      source: 'workspace',
      enabled: true,
      config: { existing: 'value', apiKey: 'old-key' },
    })

    await putJson('/api/skills/merge-config/config', {
      apiKey: 'new-key',
      newField: 42,
    })

    const skill = skillManager.getAllSkills().find(s => s.name === 'merge-config')
    expect(skill!.config).toEqual({
      existing: 'value',
      apiKey: 'new-key',
      newField: 42,
    })
  })

  it('returns 404 for non-existent skill', async () => {
    const res = await putJson('/api/skills/nonexistent/config', {
      key: 'value',
    })
    expect(res.status).toBe(404)

    const data = await res.json() as { error: string }
    expect(data.error).toContain("'nonexistent' not found")
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part 2: Skill Manager Unit Tests (server/lib/skill-manager.ts)
// ═══════════════════════════════════════════════════════════════════════

describe('SkillManager', () => {
  beforeEach(() => {
    clearSkillManager()
  })

  it('addSkill stores a skill', () => {
    skillManager.addSkill({
      name: 'mgr-test',
      description: 'Manager test',
      instructions: 'Test',
      source: 'builtin',
      enabled: true,
    })

    expect(skillManager.getAllSkills()).toHaveLength(1)
    expect(skillManager.getAllSkills()[0]!.name).toBe('mgr-test')
  })

  it('loadSkills replaces all existing skills', () => {
    skillManager.addSkill({
      name: 'existing',
      description: 'Will be replaced',
      instructions: 'Old',
      source: 'builtin',
      enabled: true,
    })

    skillManager.loadSkills([
      { name: 'new-1', description: 'New 1', instructions: 'N1', source: 'workspace', enabled: true },
      { name: 'new-2', description: 'New 2', instructions: 'N2', source: 'workspace', enabled: false },
    ])

    const all = skillManager.getAllSkills()
    expect(all).toHaveLength(2)
    expect(all.map(s => s.name)).not.toContain('existing')
    expect(all.map(s => s.name)).toContain('new-1')
    expect(all.map(s => s.name)).toContain('new-2')
  })

  it('removeSkill returns true for existing skill', () => {
    skillManager.addSkill({
      name: 'removable',
      description: 'Removable',
      instructions: 'R',
      source: 'workspace',
      enabled: true,
    })

    expect(skillManager.removeSkill('removable')).toBe(true)
    expect(skillManager.getAllSkills()).toHaveLength(0)
  })

  it('removeSkill returns false for non-existent skill', () => {
    expect(skillManager.removeSkill('ghost')).toBe(false)
  })

  it('getEligibleSkills filters disabled and disableModelInvocation', () => {
    skillManager.loadSkills([
      { name: 'eligible', description: 'E', instructions: 'E', source: 'builtin', enabled: true },
      { name: 'disabled', description: 'D', instructions: 'D', source: 'builtin', enabled: false },
      { name: 'no-model', description: 'NM', instructions: 'NM', source: 'builtin', enabled: true, disableModelInvocation: true },
    ])

    const eligible = skillManager.getEligibleSkills()
    expect(eligible).toHaveLength(1)
    expect(eligible[0]!.name).toBe('eligible')
  })

  it('updateSkillConfig returns true and merges config', () => {
    skillManager.addSkill({
      name: 'cfg',
      description: 'Config test',
      instructions: 'C',
      source: 'workspace',
      enabled: true,
      config: { a: 1 },
    })

    const result = skillManager.updateSkillConfig('cfg', { b: 2 })
    expect(result).toBe(true)

    const skill = skillManager.getAllSkills().find(s => s.name === 'cfg')
    expect(skill!.config).toEqual({ a: 1, b: 2 })
  })

  it('updateSkillConfig returns false for non-existent skill', () => {
    expect(skillManager.updateSkillConfig('nope', { x: 1 })).toBe(false)
  })

  it('getSkillPromptInjection builds XML for eligible skills', () => {
    skillManager.loadSkills([
      { name: 'xml-skill', description: 'XML test', instructions: 'Do XML things', source: 'builtin', enabled: true },
    ])

    const xml = skillManager.getSkillPromptInjection()
    expect(xml).toContain('<skills>')
    expect(xml).toContain('</skills>')
    expect(xml).toContain('<skill name="xml-skill" description="XML test">')
    expect(xml).toContain('Do XML things')
  })

  it('getSkillPromptInjection returns empty string when no eligible skills', () => {
    skillManager.loadSkills([
      { name: 'disabled', description: 'D', instructions: 'D', source: 'builtin', enabled: false },
    ])

    expect(skillManager.getSkillPromptInjection()).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part 3: Skill Injector Unit Tests (packages/core/src/skill-injector.ts)
// ═══════════════════════════════════════════════════════════════════════

import { getEligibleSkills, buildSkillPromptInjection } from '../packages/core/src/skill-injector.js'
import type { OpenClawSkill } from '../packages/core/src/types/skill.js'

describe('getEligibleSkills (stateless)', () => {
  it('returns only enabled skills without disableModelInvocation', () => {
    const skills: OpenClawSkill[] = [
      { name: 'a', description: 'A', instructions: 'A', source: 'builtin', enabled: true },
      { name: 'b', description: 'B', instructions: 'B', source: 'builtin', enabled: false },
      { name: 'c', description: 'C', instructions: 'C', source: 'builtin', enabled: true, disableModelInvocation: true },
      { name: 'd', description: 'D', instructions: 'D', source: 'builtin', enabled: true, disableModelInvocation: false },
    ]

    const result = getEligibleSkills(skills)
    expect(result).toHaveLength(2)
    expect(result.map(s => s.name)).toEqual(['a', 'd'])
  })

  it('returns empty array for empty input', () => {
    expect(getEligibleSkills([])).toEqual([])
  })

  it('returns empty array when all disabled', () => {
    const skills: OpenClawSkill[] = [
      { name: 'off', description: 'Off', instructions: 'Off', source: 'builtin', enabled: false },
    ]
    expect(getEligibleSkills(skills)).toEqual([])
  })
})

describe('buildSkillPromptInjection (stateless)', () => {
  it('builds XML with eligible skills', () => {
    const skills: OpenClawSkill[] = [
      { name: 'my-skill', description: 'My Skill', instructions: 'Use this skill', source: 'builtin', enabled: true },
    ]

    const xml = buildSkillPromptInjection(skills)
    expect(xml).toBe(
      '<skills>\n  <skill name="my-skill" description="My Skill">\nUse this skill\n  </skill>\n</skills>'
    )
  })

  it('returns empty string when no eligible skills', () => {
    const skills: OpenClawSkill[] = [
      { name: 'off', description: 'Off', instructions: 'Off', source: 'builtin', enabled: false },
    ]
    expect(buildSkillPromptInjection(skills)).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(buildSkillPromptInjection([])).toBe('')
  })

  it('includes multiple eligible skills', () => {
    const skills: OpenClawSkill[] = [
      { name: 'alpha', description: 'Alpha', instructions: 'Alpha body', source: 'builtin', enabled: true },
      { name: 'beta', description: 'Beta', instructions: 'Beta body', source: 'workspace', enabled: true },
    ]

    const xml = buildSkillPromptInjection(skills)
    expect(xml).toContain('<skill name="alpha"')
    expect(xml).toContain('<skill name="beta"')
    expect(xml).toContain('Alpha body')
    expect(xml).toContain('Beta body')
  })

  it('excludes non-eligible skills from XML', () => {
    const skills: OpenClawSkill[] = [
      { name: 'visible', description: 'V', instructions: 'V', source: 'builtin', enabled: true },
      { name: 'hidden', description: 'H', instructions: 'H', source: 'builtin', enabled: false },
    ]

    const xml = buildSkillPromptInjection(skills)
    expect(xml).toContain('visible')
    expect(xml).not.toContain('hidden')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part 4: Skill Store Unit Tests (src/stores/skill-store.ts)
// ═══════════════════════════════════════════════════════════════════════

// Mock fetch for the store's load() method
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock api-url so the store resolves URLs correctly
vi.mock('../src/lib/api-url', () => ({
  apiUrl: (path: string) => `http://localhost:3001${path}`,
}))

describe('useSkillStore', () => {
  let useSkillStore: typeof import('../src/stores/skill-store').useSkillStore

  beforeEach(async () => {
    vi.resetModules()
    mockFetch.mockReset()

    // Re-mock after resetModules
    vi.doMock('../src/lib/api-url', () => ({
      apiUrl: (path: string) => `http://localhost:3001${path}`,
    }))

    const mod = await import('../src/stores/skill-store')
    useSkillStore = mod.useSkillStore
  })

  // ── Initial state ───────────────────────────────────────────────

  it('has correct initial state', () => {
    const state = useSkillStore.getState()
    expect(state.skills).toBeInstanceOf(Map)
    expect(state.skills.size).toBe(0)
    expect(state.loaded).toBe(false)
  })

  // ── load() ──────────────────────────────────────────────────────

  describe('load()', () => {
    it('fetches skills from API and populates store', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skills: [
            {
              name: 'loaded-skill',
              description: 'Loaded',
              instructions: 'Load instructions',
              source: 'builtin',
              enabled: true,
              userInvocable: true,
            },
          ],
          total: 1,
        }),
      })

      await useSkillStore.getState().load()

      const state = useSkillStore.getState()
      expect(state.loaded).toBe(true)
      expect(state.skills.size).toBe(1)
      expect(state.skills.get('loaded-skill')).toBeDefined()
      expect(state.skills.get('loaded-skill')!.description).toBe('Loaded')
    })

    it('marks loaded=true on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal error' }),
      })

      await useSkillStore.getState().load()

      const state = useSkillStore.getState()
      expect(state.loaded).toBe(true)
      expect(state.skills.size).toBe(0)
    })

    it('marks loaded=true on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await useSkillStore.getState().load()

      const state = useSkillStore.getState()
      expect(state.loaded).toBe(true)
      expect(state.skills.size).toBe(0)
    })

    it('calls the correct API URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [], total: 0 }),
      })

      await useSkillStore.getState().load()

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/api/skills')
    })

    it('handles null skills array gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: null, total: 0 }),
      })

      await useSkillStore.getState().load()

      const state = useSkillStore.getState()
      expect(state.loaded).toBe(true)
      expect(state.skills.size).toBe(0)
    })

    it('loads multiple skills', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skills: [
            { name: 'a', description: 'A', source: 'builtin', enabled: true },
            { name: 'b', description: 'B', source: 'workspace', enabled: false },
            { name: 'c', description: 'C', source: 'clawhub', enabled: true, pluginId: 'plug-1', config: { key: 'val' } },
          ],
          total: 3,
        }),
      })

      await useSkillStore.getState().load()

      const state = useSkillStore.getState()
      expect(state.skills.size).toBe(3)
      expect(state.skills.get('c')!.pluginId).toBe('plug-1')
      expect(state.skills.get('c')!.config).toEqual({ key: 'val' })
    })
  })

  // ── addSkill() ──────────────────────────────────────────────────

  describe('addSkill()', () => {
    it('adds a skill to the store', () => {
      useSkillStore.getState().addSkill({
        name: 'new-skill',
        description: 'New',
        instructions: 'New instructions',
        source: 'workspace',
        enabled: true,
      })

      expect(useSkillStore.getState().skills.size).toBe(1)
      expect(useSkillStore.getState().skills.get('new-skill')!.description).toBe('New')
    })

    it('overwrites existing skill with same name', () => {
      const store = useSkillStore.getState()
      store.addSkill({
        name: 'dup',
        description: 'Original',
        instructions: 'O',
        source: 'builtin',
        enabled: true,
      })
      store.addSkill({
        name: 'dup',
        description: 'Updated',
        instructions: 'U',
        source: 'builtin',
        enabled: false,
      })

      expect(useSkillStore.getState().skills.size).toBe(1)
      expect(useSkillStore.getState().skills.get('dup')!.description).toBe('Updated')
    })
  })

  // ── removeSkill() ───────────────────────────────────────────────

  describe('removeSkill()', () => {
    it('removes an existing skill', () => {
      const store = useSkillStore.getState()
      store.addSkill({
        name: 'to-remove',
        description: 'Remove me',
        instructions: 'R',
        source: 'workspace',
        enabled: true,
      })

      store.removeSkill('to-remove')
      expect(useSkillStore.getState().skills.size).toBe(0)
    })

    it('does nothing for non-existent skill', () => {
      const store = useSkillStore.getState()
      store.addSkill({
        name: 'keep',
        description: 'Keep me',
        instructions: 'K',
        source: 'workspace',
        enabled: true,
      })

      store.removeSkill('nonexistent')
      expect(useSkillStore.getState().skills.size).toBe(1)
    })
  })

  // ── enableSkill() / disableSkill() ──────────────────────────────

  describe('enableSkill() / disableSkill()', () => {
    beforeEach(() => {
      useSkillStore.getState().addSkill({
        name: 'toggle-skill',
        description: 'Toggle',
        instructions: 'T',
        source: 'builtin',
        enabled: false,
      })
    })

    it('enableSkill sets enabled to true', () => {
      useSkillStore.getState().enableSkill('toggle-skill')
      expect(useSkillStore.getState().skills.get('toggle-skill')!.enabled).toBe(true)
    })

    it('disableSkill sets enabled to false', () => {
      useSkillStore.getState().enableSkill('toggle-skill')
      useSkillStore.getState().disableSkill('toggle-skill')
      expect(useSkillStore.getState().skills.get('toggle-skill')!.enabled).toBe(false)
    })

    it('enableSkill does nothing for non-existent skill', () => {
      useSkillStore.getState().enableSkill('ghost')
      expect(useSkillStore.getState().skills.size).toBe(1) // only toggle-skill
    })

    it('disableSkill does nothing for non-existent skill', () => {
      useSkillStore.getState().disableSkill('ghost')
      expect(useSkillStore.getState().skills.size).toBe(1)
    })

    it('toggling creates a new Map reference (immutable update)', () => {
      const mapBefore = useSkillStore.getState().skills
      useSkillStore.getState().enableSkill('toggle-skill')
      const mapAfter = useSkillStore.getState().skills
      expect(mapBefore).not.toBe(mapAfter)
    })
  })

  // ── updateSkillConfig() ─────────────────────────────────────────

  describe('updateSkillConfig()', () => {
    it('replaces skill config', () => {
      useSkillStore.getState().addSkill({
        name: 'cfg-skill',
        description: 'Config',
        instructions: 'C',
        source: 'workspace',
        enabled: true,
        config: { old: 'value' },
      })

      useSkillStore.getState().updateSkillConfig('cfg-skill', { new: 'value' })

      // Store replaces config (does not merge like SkillManager)
      expect(useSkillStore.getState().skills.get('cfg-skill')!.config).toEqual({ new: 'value' })
    })

    it('does nothing for non-existent skill', () => {
      useSkillStore.getState().updateSkillConfig('ghost', { key: 'val' })
      expect(useSkillStore.getState().skills.size).toBe(0)
    })
  })

  // ── getEligibleSkills() ─────────────────────────────────────────

  describe('getEligibleSkills()', () => {
    it('returns only enabled skills without disableModelInvocation', () => {
      const store = useSkillStore.getState()
      store.addSkill({ name: 'ok', description: 'OK', instructions: 'OK', source: 'builtin', enabled: true })
      store.addSkill({ name: 'off', description: 'Off', instructions: 'Off', source: 'builtin', enabled: false })
      store.addSkill({ name: 'no-model', description: 'NM', instructions: 'NM', source: 'builtin', enabled: true, disableModelInvocation: true })

      const eligible = useSkillStore.getState().getEligibleSkills()
      expect(eligible).toHaveLength(1)
      expect(eligible[0]!.name).toBe('ok')
    })

    it('returns empty array when no skills loaded', () => {
      expect(useSkillStore.getState().getEligibleSkills()).toEqual([])
    })
  })

  // ── getSkillPromptInjection() ───────────────────────────────────

  describe('getSkillPromptInjection()', () => {
    it('returns XML for eligible skills', () => {
      useSkillStore.getState().addSkill({
        name: 'prompt-skill',
        description: 'Prompt Skill',
        instructions: 'Do prompt things',
        source: 'builtin',
        enabled: true,
      })

      const xml = useSkillStore.getState().getSkillPromptInjection()
      expect(xml).toContain('<skills>')
      expect(xml).toContain('</skills>')
      expect(xml).toContain('prompt-skill')
      expect(xml).toContain('Do prompt things')
    })

    it('returns empty string when no eligible skills', () => {
      useSkillStore.getState().addSkill({
        name: 'disabled',
        description: 'D',
        instructions: 'D',
        source: 'builtin',
        enabled: false,
      })

      expect(useSkillStore.getState().getSkillPromptInjection()).toBe('')
    })

    it('returns empty string when store is empty', () => {
      expect(useSkillStore.getState().getSkillPromptInjection()).toBe('')
    })
  })
})
