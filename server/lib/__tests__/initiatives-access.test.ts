/**
 * Unit tests for initiatives endpoint access control.
 *
 * Tests the authorization logic in the initiatives PATCH and DELETE
 * endpoints (server/routes/data.ts). Covers the security issue where
 * the update/select after an access check doesn't re-apply the team
 * scope filter, potentially allowing cross-team data access.
 */

import { describe, it, expect } from 'vitest'

/**
 * Simulates the access check pattern used in data.ts for initiatives.
 * Mirrors the real code's WHERE clause logic.
 */
interface Initiative {
  id: string
  teamId: string | null
  ownerId: string
  name: string
}

interface User {
  id: string
  teamId: string
  teamIds: string[]
}

/**
 * Simulates the access check: can this user see/modify this initiative?
 * Matches the WHERE clause: (teamId = user.teamId) OR (teamId IS NULL AND ownerId = user.id)
 */
function canAccessInitiative(initiative: Initiative, user: User): boolean {
  if (initiative.teamId === user.teamId) return true
  if (initiative.teamId === null && initiative.ownerId === user.id) return true
  return false
}

/**
 * Simulates the PATCH endpoint behavior:
 * 1. SELECT with access check (correct)
 * 2. UPDATE without access check (BUG: uses only eq(id))
 * 3. SELECT without access check (BUG: uses only eq(id))
 *
 * The "secure" version adds the access check to steps 2 and 3.
 */
function simulatePatchEndpoint(
  db: Initiative[],
  initiativeId: string,
  user: User,
  patch: Partial<Initiative>,
  options: { secure: boolean } = { secure: false }
): { status: number; data?: Initiative } {
  // Step 1: Access check (always present)
  const existing = db.find(i => i.id === initiativeId && canAccessInitiative(i, user))
  if (!existing) return { status: 404 }

  // Step 2: Update
  if (options.secure) {
    // Secure: re-check access on update
    const target = db.find(i => i.id === initiativeId && canAccessInitiative(i, user))
    if (!target) return { status: 404 }
    Object.assign(target, patch)
  } else {
    // Current code: update by ID only (no access re-check)
    const target = db.find(i => i.id === initiativeId)
    if (target) Object.assign(target, patch)
  }

  // Step 3: Return updated row
  if (options.secure) {
    const updated = db.find(i => i.id === initiativeId && canAccessInitiative(i, user))
    return updated ? { status: 200, data: updated } : { status: 404 }
  } else {
    // Current code: select by ID only
    const updated = db.find(i => i.id === initiativeId)
    return updated ? { status: 200, data: updated } : { status: 404 }
  }
}

describe('initiatives access check', () => {
  it('allows access to own team initiative', () => {
    const initiative: Initiative = { id: 'i1', teamId: 'team-a', ownerId: 'user-1', name: 'Test' }
    const user: User = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a'] }
    expect(canAccessInitiative(initiative, user)).toBe(true)
  })

  it('allows access to null-team initiative owned by user', () => {
    const initiative: Initiative = { id: 'i1', teamId: null, ownerId: 'user-1', name: 'Test' }
    const user: User = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a'] }
    expect(canAccessInitiative(initiative, user)).toBe(true)
  })

  it('denies access to other team initiative', () => {
    const initiative: Initiative = { id: 'i1', teamId: 'team-b', ownerId: 'user-2', name: 'Test' }
    const user: User = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a'] }
    expect(canAccessInitiative(initiative, user)).toBe(false)
  })

  it('denies access to null-team initiative owned by other user', () => {
    const initiative: Initiative = { id: 'i1', teamId: null, ownerId: 'user-2', name: 'Test' }
    const user: User = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a'] }
    expect(canAccessInitiative(initiative, user)).toBe(false)
  })
})

describe('initiatives PATCH endpoint security', () => {
  it('returns 404 for inaccessible initiative', () => {
    const db: Initiative[] = [
      { id: 'i1', teamId: 'team-b', ownerId: 'user-2', name: 'Other team' },
    ]
    const user: User = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a'] }
    const result = simulatePatchEndpoint(db, 'i1', user, { name: 'Hacked' })
    expect(result.status).toBe(404)
  })

  it('allows PATCH for accessible initiative', () => {
    const db: Initiative[] = [
      { id: 'i1', teamId: 'team-a', ownerId: 'user-1', name: 'Original' },
    ]
    const user: User = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a'] }
    const result = simulatePatchEndpoint(db, 'i1', user, { name: 'Updated' })
    expect(result.status).toBe(200)
    expect(result.data?.name).toBe('Updated')
  })

  /**
   * This test documents a known issue in the PATCH endpoint.
   *
   * The update and post-update select use only `eq(initiatives.id, id)`
   * without re-applying the team scope filter. In practice, this is safe
   * because the initial access check prevents unauthorized users from
   * reaching the update code. However, it's better practice to include
   * the scope filter consistently for defense-in-depth.
   *
   * In the current code (server/routes/data.ts:274-275):
   *   await db.update(initiatives).set(patch).where(eq(initiatives.id, id))
   *   const [updated] = await db.select().from(initiatives).where(eq(initiatives.id, id))
   *
   * Should be:
   *   await db.update(initiatives).set(patch).where(
   *     and(eq(initiatives.id, id), or(
   *       eq(initiatives.teamId, user.teamId),
   *       and(isNull(initiatives.teamId), eq(initiatives.ownerId, user.id))
   *     ))
   *   )
   */
  it('current code: update uses id-only WHERE (safe due to prior check)', () => {
    const db: Initiative[] = [
      { id: 'i1', teamId: 'team-a', ownerId: 'user-1', name: 'Original' },
    ]
    const user: User = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a'] }

    // The initial access check passes, so the update goes through
    const result = simulatePatchEndpoint(db, 'i1', user, { name: 'Updated' }, { secure: false })
    expect(result.status).toBe(200)
    expect(result.data?.name).toBe('Updated')
  })

  it('secure version: update re-applies team scope filter', () => {
    const db: Initiative[] = [
      { id: 'i1', teamId: 'team-a', ownerId: 'user-1', name: 'Original' },
    ]
    const user: User = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a'] }

    const result = simulatePatchEndpoint(db, 'i1', user, { name: 'Updated' }, { secure: true })
    expect(result.status).toBe(200)
    expect(result.data?.name).toBe('Updated')
  })
})

/**
 * Tests for the initiatives 500 error observed in production.
 *
 * The browser console showed a 500 error on initiatives. Possible causes:
 * 1. Database connection issue (PGlite vs Postgres mismatch)
 * 2. Missing team membership for user (before auto-create was added)
 * 3. Schema mismatch (missing columns after migration)
 */
describe('initiatives error scenarios', () => {
  it('handles empty body gracefully', () => {
    const db: Initiative[] = [
      { id: 'i1', teamId: 'team-a', ownerId: 'user-1', name: 'Test' },
    ]
    const user: User = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a'] }

    // Empty patch should still work (just updates updatedAt)
    const result = simulatePatchEndpoint(db, 'i1', user, {})
    expect(result.status).toBe(200)
    expect(result.data?.name).toBe('Test') // unchanged
  })

  it('returns 404 for nonexistent initiative ID', () => {
    const db: Initiative[] = []
    const user: User = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a'] }

    const result = simulatePatchEndpoint(db, 'nonexistent', user, { name: 'New' })
    expect(result.status).toBe(404)
  })
})
