/**
 * Unit tests for bootstrap-local.ts
 *
 * Verifies:
 * - Fixed UUIDs are correct
 * - Bootstrap creates team, user, and membership
 * - Bootstrap is idempotent (skips existing rows)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the database module
const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockWhere = vi.fn()
const mockInsert = vi.fn()
const mockValues = vi.fn()

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockDb = {
  select: mockSelect,
  insert: mockInsert,
}

vi.mock('../server/lib/db/index.js', () => ({
  db: new Proxy({}, {
    get(_, prop) {
      if (prop === 'select') return mockSelect
      if (prop === 'insert') return mockInsert
      return undefined
    },
  }),
}))

vi.mock('../server/lib/db/schema.js', () => ({
  teams: { id: 'teams.id' },
  teamMembers: { userId: 'teamMembers.userId' },
  userProfiles: { id: 'userProfiles.id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: (field: string, value: string) => ({ field, value, type: 'eq' }),
}))

describe('bootstrap-local constants', () => {
  it('LOCAL_USER_ID is the expected fixed UUID', async () => {
    const { LOCAL_USER_ID } = await import('../server/lib/db/bootstrap-local.js')
    expect(LOCAL_USER_ID).toBe('00000000-0000-0000-0000-000000000000')
  })

  it('LOCAL_TEAM_ID is the expected fixed UUID', async () => {
    const { LOCAL_TEAM_ID } = await import('../server/lib/db/bootstrap-local.js')
    expect(LOCAL_TEAM_ID).toBe('00000000-0000-0000-0000-000000000001')
  })

  it('LOCAL_USER_ID and LOCAL_TEAM_ID are different', async () => {
    const { LOCAL_USER_ID, LOCAL_TEAM_ID } = await import('../server/lib/db/bootstrap-local.js')
    expect(LOCAL_USER_ID).not.toBe(LOCAL_TEAM_ID)
  })
})

describe('bootstrapLocalMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default chain: select().from().where() returns empty array (nothing exists)
    mockWhere.mockResolvedValue([])
    mockFrom.mockReturnValue({ where: mockWhere })
    mockSelect.mockReturnValue({ from: mockFrom })
    mockValues.mockResolvedValue(undefined)
    mockInsert.mockReturnValue({ values: mockValues })
  })

  it('creates all three rows when nothing exists', async () => {
    const { bootstrapLocalMode } = await import('../server/lib/db/bootstrap-local.js')
    await bootstrapLocalMode()

    // Should call insert 3 times: team, user profile, team membership
    expect(mockInsert).toHaveBeenCalledTimes(3)
  })

  it('skips creation when rows already exist', async () => {
    // Return existing row for each select query
    mockWhere.mockResolvedValue([{ id: 'existing' }])

    const { bootstrapLocalMode } = await import('../server/lib/db/bootstrap-local.js')
    await bootstrapLocalMode()

    // Should not call insert at all since everything exists
    expect(mockInsert).toHaveBeenCalledTimes(0)
  })

  it('creates only missing rows (partial bootstrap)', async () => {
    let callCount = 0
    // First call (team): exists, second (user): missing, third (membership): missing
    mockWhere.mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve([{ id: 'existing-team' }])
      return Promise.resolve([])
    })

    const { bootstrapLocalMode } = await import('../server/lib/db/bootstrap-local.js')
    await bootstrapLocalMode()

    // Should insert user profile + membership but skip team
    expect(mockInsert).toHaveBeenCalledTimes(2)
  })

  it('logs messages during bootstrap', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { bootstrapLocalMode } = await import('../server/lib/db/bootstrap-local.js')
    await bootstrapLocalMode()

    // Should log the initial message and completion message at minimum
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[bootstrap]')
    )
    // Verify the completion log
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('bootstrap complete')
    )
    // When inserting all three rows, should also log creation messages
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Created local team')
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Created local user profile')
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Created local team membership')
    )

    logSpy.mockRestore()
  })

  it('handles DB insert failure gracefully (propagates error)', async () => {
    // select returns empty (nothing exists) so insert will be attempted
    mockValues.mockRejectedValue(new Error('disk full'))

    const { bootstrapLocalMode } = await import('../server/lib/db/bootstrap-local.js')

    // Bootstrap should propagate the insert error
    await expect(bootstrapLocalMode()).rejects.toThrow('disk full')
  })
})
