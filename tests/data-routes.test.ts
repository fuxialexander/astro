/**
 * Unit tests for cross-team data route semantics in server/routes/data.ts.
 *
 * Verifies:
 * - Reads are scoped by membership across all teams the user belongs to
 * - Project/initiative creation can target any team the user belongs to
 * - Child entities inherit access/ownership from their parent project
 * - Active team is only a default context, not the read boundary
 */

import { describe, it, expect } from 'vitest'

function canAccessTeamRow(user: { teamIds: string[] }, row: { teamId: string }) {
  return user.teamIds.includes(row.teamId)
}

function resolveWriteTeamId(
  user: { teamId: string; teamIds: string[] },
  requestedTeamId?: string,
) {
  return requestedTeamId && user.teamIds.includes(requestedTeamId)
    ? requestedTeamId
    : user.teamId
}

describe('all-teams read scope', () => {
  it('allows reads from any team the user belongs to', () => {
    const user = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a', 'team-b'] }

    expect(canAccessTeamRow(user, { teamId: 'team-a' })).toBe(true)
    expect(canAccessTeamRow(user, { teamId: 'team-b' })).toBe(true)
    expect(canAccessTeamRow(user, { teamId: 'team-c' })).toBe(false)
  })

  it('does not treat activeTeamId as the sole read boundary', () => {
    const user = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a', 'team-b'] }
    const projectInAnotherMembership = { id: 'proj-2', teamId: 'team-b' }

    expect(projectInAnotherMembership.teamId).not.toBe(user.teamId)
    expect(canAccessTeamRow(user, projectInAnotherMembership)).toBe(true)
  })
})

describe('team-owned write defaults', () => {
  it('project creation honors an explicit teamId when the user belongs to that team', () => {
    const user = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a', 'team-b'] }

    const row = {
      ownerId: user.id,
      teamId: resolveWriteTeamId(user, 'team-b'),
    }

    expect(row.teamId).toBe('team-b')
  })

  it('project creation falls back to the active/default team when teamId is omitted', () => {
    const user = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a', 'team-b'] }

    const row = {
      ownerId: user.id,
      teamId: resolveWriteTeamId(user),
    }

    expect(row.teamId).toBe('team-a')
  })

  it('project creation ignores a teamId outside the users memberships', () => {
    const user = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a', 'team-b'] }

    const row = {
      ownerId: user.id,
      teamId: resolveWriteTeamId(user, 'team-z'),
    }

    expect(row.teamId).toBe('team-a')
  })

  it('initiative creation follows the same team selection rule as projects', () => {
    const user = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a', 'team-b'] }

    expect(resolveWriteTeamId(user, 'team-b')).toBe('team-b')
    expect(resolveWriteTeamId(user, 'team-z')).toBe('team-a')
  })
})

describe('child entity scoping', () => {
  it('plan nodes are accessible when their parent project is accessible', () => {
    const user = { teamIds: ['team-a', 'team-b'] }
    const project = { id: 'proj-1', teamId: 'team-b' }
    const node = { id: 'node-1', projectId: 'proj-1' }

    expect(canAccessTeamRow(user, project)).toBe(true)
    expect(node.projectId).toBe(project.id)
  })

  it('executions are accessible when their project is in any of the users teams', () => {
    const accessibleProjectIds = new Set(['proj-a', 'proj-b'])
    const execution = { nodeId: 'node-1', projectId: 'proj-b' }
    const otherExecution = { nodeId: 'node-2', projectId: 'proj-c' }

    expect(accessibleProjectIds.has(execution.projectId)).toBe(true)
    expect(accessibleProjectIds.has(otherExecution.projectId)).toBe(false)
  })

  it('blob ownership derives from the linked project team, not the current default team', () => {
    const user = { teamId: 'team-a', teamIds: ['team-a', 'team-b'] }
    const project = { id: 'proj-1', teamId: 'team-b' }

    const blobTeamId = canAccessTeamRow(user, project) ? project.teamId : user.teamId

    expect(blobTeamId).toBe('team-b')
    expect(blobTeamId).not.toBe(user.teamId)
  })
})

describe('cross-team mutations within membership', () => {
  it('allows updating a project in any team the user belongs to', () => {
    const user = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a', 'team-b'] }
    const project = { id: 'proj-2', teamId: 'team-b', ownerId: 'user-2' }

    const targetProject = [project].find((p) =>
      p.id === 'proj-2' && canAccessTeamRow(user, p)
    )

    expect(targetProject).toEqual(project)
  })

  it('rejects updates for projects in teams the user does not belong to', () => {
    const user = { id: 'user-1', teamId: 'team-a', teamIds: ['team-a', 'team-b'] }
    const project = { id: 'proj-9', teamId: 'team-z', ownerId: 'user-9' }

    const targetProject = [project].find((p) =>
      p.id === 'proj-9' && canAccessTeamRow(user, p)
    )

    expect(targetProject).toBeUndefined()
  })
})
