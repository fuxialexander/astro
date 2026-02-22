/**
 * Unit tests for auth middleware (server/middleware/auth.ts)
 *
 * Verifies:
 * - Local mode sets fixed LOCAL_USER_ID and LOCAL_TEAM_ID
 * - AuthUser interface includes teamId and teamIds
 * - Server mode resolves teams from team_members table
 * - X-Team-Id header selects active team
 * - optionalAuth follows the same pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock isLocalMode
let mockIsLocal = true

vi.mock('../server/lib/app-mode.js', () => ({
  isLocalMode: () => mockIsLocal,
}))

vi.mock('../server/lib/db/bootstrap-local.js', () => ({
  LOCAL_USER_ID: '00000000-0000-0000-0000-000000000000',
  LOCAL_TEAM_ID: '00000000-0000-0000-0000-000000000001',
}))

// Mock Supabase
const mockGetUser = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}))

vi.mock('../server/lib/supabase.js', () => ({
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_ANON_KEY: 'test-key',
}))

// Mock team resolution DB query
const mockTeamMemberships = vi.fn()
vi.mock('../server/lib/db/index.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockTeamMemberships,
      }),
    }),
  },
}))

vi.mock('../server/lib/db/schema.js', () => ({
  teamMembers: { teamId: 'team_id', userId: 'user_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: (field: string, value: string) => ({ field, value }),
}))

// Hono context mock
function createMockContext(headers: Record<string, string> = {}) {
  const contextVars: Record<string, unknown> = {}
  return {
    req: {
      header: (name: string) => headers[name],
      query: () => undefined as string | undefined,
    },
    set: (key: string, value: unknown) => { contextVars[key] = value },
    get: (key: string) => contextVars[key],
    json: (body: unknown, status: number) => ({ body, status }),
    // Expose stored values for assertions
    _vars: contextVars,
  }
}

describe('auth middleware — local mode', () => {
  beforeEach(() => {
    mockIsLocal = true
    vi.clearAllMocks()
  })

  it('requireAuth sets fixed user with LOCAL_USER_ID and LOCAL_TEAM_ID', async () => {
    const { requireAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext()
    let nextCalled = false

    await requireAuth(c as never, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    const user = c._vars.user as { id: string; teamId: string; teamIds: string[] }
    expect(user.id).toBe('00000000-0000-0000-0000-000000000000')
    expect(user.teamId).toBe('00000000-0000-0000-0000-000000000001')
    expect(user.teamIds).toEqual(['00000000-0000-0000-0000-000000000001'])
  })

  it('requireAuth uses X-User-Id header when provided in local mode', async () => {
    const { requireAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext({ 'X-User-Id': 'custom-browser-user' })
    let nextCalled = false

    await requireAuth(c as never, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    const user = c._vars.user as { id: string }
    expect(user.id).toBe('custom-browser-user')
  })

  it('optionalAuth sets fixed user in local mode', async () => {
    const { optionalAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext()
    let nextCalled = false

    await optionalAuth(c as never, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    const user = c._vars.user as { id: string; teamId: string }
    expect(user.id).toBe('00000000-0000-0000-0000-000000000000')
    expect(user.teamId).toBe('00000000-0000-0000-0000-000000000001')
  })
})

describe('auth middleware — server mode', () => {
  beforeEach(() => {
    vi.resetModules()
    mockIsLocal = false
    vi.clearAllMocks()
  })

  it('requireAuth returns 401 when no Authorization header', async () => {
    const { requireAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext()

    const result = await requireAuth(c as never, async () => {})

    expect(result).toBeDefined()
    expect((result as { status: number }).status).toBe(401)
  })

  it('requireAuth resolves teamId from team_members', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    })
    mockTeamMemberships.mockResolvedValue([
      { teamId: 'team-a' },
      { teamId: 'team-b' },
    ])

    const { requireAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext({
      'Authorization': 'Bearer valid-token',
    })
    let nextCalled = false

    await requireAuth(c as never, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    const user = c._vars.user as { id: string; teamId: string; teamIds: string[] }
    expect(user.id).toBe('user-123')
    expect(user.teamIds).toEqual(['team-a', 'team-b'])
    // Default active team is the first one
    expect(user.teamId).toBe('team-a')
  })

  it('requireAuth respects X-Team-Id header for active team selection', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    })
    mockTeamMemberships.mockResolvedValue([
      { teamId: 'team-a' },
      { teamId: 'team-b' },
    ])

    const { requireAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext({
      'Authorization': 'Bearer valid-token',
      'X-Team-Id': 'team-b',
    })
    let nextCalled = false

    await requireAuth(c as never, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    const user = c._vars.user as { teamId: string }
    expect(user.teamId).toBe('team-b')
  })

  it('requireAuth ignores X-Team-Id if user is not a member of that team', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    })
    mockTeamMemberships.mockResolvedValue([
      { teamId: 'team-a' },
    ])

    const { requireAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext({
      'Authorization': 'Bearer valid-token',
      'X-Team-Id': 'team-not-member',
    })
    let nextCalled = false

    await requireAuth(c as never, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    const user = c._vars.user as { teamId: string }
    // Falls back to first team
    expect(user.teamId).toBe('team-a')
  })
})

describe('auth middleware — server mode (corner cases)', () => {
  beforeEach(() => {
    vi.resetModules()
    mockIsLocal = false
    vi.clearAllMocks()
  })

  it('user with NO team memberships gets empty teamId and teamIds', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'lonely-user', email: 'lonely@example.com' } },
      error: null,
    })
    // No team memberships at all
    mockTeamMemberships.mockResolvedValue([])

    const { requireAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext({
      'Authorization': 'Bearer valid-token',
    })
    let nextCalled = false

    await requireAuth(c as never, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    const user = c._vars.user as { id: string; teamId: string; teamIds: string[] }
    expect(user.id).toBe('lonely-user')
    expect(user.teamIds).toEqual([])
    expect(user.teamId).toBe('')
  })

  it('Supabase getUser returns error → returns 401', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'JWT expired' },
    })

    const { requireAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext({
      'Authorization': 'Bearer expired-token',
    })

    const result = await requireAuth(c as never, async () => {})

    expect(result).toBeDefined()
    expect((result as { status: number }).status).toBe(401)
  })

  it('resolveTeams DB query throws → returns 401 (catches error)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    })
    // DB query throws an error
    mockTeamMemberships.mockRejectedValue(new Error('DB connection lost'))

    const { requireAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext({
      'Authorization': 'Bearer valid-token',
    })

    const result = await requireAuth(c as never, async () => {})

    expect(result).toBeDefined()
    expect((result as { status: number }).status).toBe(401)
  })

  it('optionalAuth with valid token resolves teams', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-456', email: 'opt@example.com' } },
      error: null,
    })
    mockTeamMemberships.mockResolvedValue([
      { teamId: 'team-x' },
      { teamId: 'team-y' },
    ])

    const { optionalAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext({
      'Authorization': 'Bearer valid-token',
    })
    let nextCalled = false

    await optionalAuth(c as never, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    const user = c._vars.user as { id: string; teamId: string; teamIds: string[] }
    expect(user.id).toBe('user-456')
    expect(user.teamId).toBe('team-x')
    expect(user.teamIds).toEqual(['team-x', 'team-y'])
  })

  it('optionalAuth with invalid token continues without user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid token' },
    })

    const { optionalAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext({
      'Authorization': 'Bearer invalid-token',
    })
    let nextCalled = false

    await optionalAuth(c as never, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    // User should NOT be set
    expect(c._vars.user).toBeUndefined()
  })
})

describe('auth middleware — local mode (query token fallback)', () => {
  beforeEach(() => {
    mockIsLocal = false
    vi.clearAllMocks()
  })

  it('requireAuth falls back to query token param for SSE/EventSource', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'sse-user', email: 'sse@example.com' } },
      error: null,
    })
    mockTeamMemberships.mockResolvedValue([
      { teamId: 'team-sse' },
    ])

    const { requireAuth } = await import('../server/middleware/auth.js')
    // No Authorization header, but token in query params
    const contextVars: Record<string, unknown> = {}
    const c = {
      req: {
        header: () => undefined,
        query: (name: string) => name === 'token' ? 'query-token-value' : undefined,
      },
      set: (key: string, value: unknown) => { contextVars[key] = value },
      get: (key: string) => contextVars[key],
      json: (body: unknown, status: number) => ({ body, status }),
      _vars: contextVars,
    }
    let nextCalled = false

    await requireAuth(c as never, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    const user = c._vars.user as { id: string; teamId: string }
    expect(user.id).toBe('sse-user')
    expect(user.teamId).toBe('team-sse')
  })
})

describe('AuthUser interface', () => {
  it('has teamId and teamIds fields', async () => {
    const { requireAuth } = await import('../server/middleware/auth.js')
    const c = createMockContext()
    mockIsLocal = true

    await requireAuth(c as never, async () => {})

    const user = c._vars.user as Record<string, unknown>
    expect(user).toHaveProperty('teamId')
    expect(user).toHaveProperty('teamIds')
    expect(typeof user.teamId).toBe('string')
    expect(Array.isArray(user.teamIds)).toBe(true)
  })
})
