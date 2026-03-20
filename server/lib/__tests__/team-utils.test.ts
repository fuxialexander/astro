import { describe, expect, it } from 'vitest'
import { resolveWritableTeamId } from '../team-utils.js'

describe('resolveWritableTeamId', () => {
  const user = {
    teamId: 'team-a',
    teamIds: ['team-a', 'team-b'],
  }

  it('uses the default active team when teamId is omitted', () => {
    expect(resolveWritableTeamId(user, undefined)).toEqual({ teamId: 'team-a' })
    expect(resolveWritableTeamId(user, null)).toEqual({ teamId: 'team-a' })
    expect(resolveWritableTeamId(user, '')).toEqual({ teamId: 'team-a' })
  })

  it('accepts an explicit teamId inside the users memberships', () => {
    expect(resolveWritableTeamId(user, 'team-b')).toEqual({ teamId: 'team-b' })
  })

  it('rejects teamIds outside the users memberships', () => {
    expect(resolveWritableTeamId(user, 'team-z')).toEqual({ error: 'Invalid teamId' })
    expect(resolveWritableTeamId(user, 123)).toEqual({ error: 'Invalid teamId' })
  })
})
