/**
 * Bootstrap local-mode team and user in PGlite.
 *
 * Creates a fixed team, user profile, and membership on first startup.
 * Idempotent — safe to call on every restart.
 */

import { db } from './index.js'
import { teams, teamMembers, userProfiles } from './schema.js'
import { eq } from 'drizzle-orm'

export const LOCAL_USER_ID = '00000000-0000-0000-0000-000000000000'
export const LOCAL_TEAM_ID = '00000000-0000-0000-0000-000000000001'

export async function bootstrapLocalMode() {
  console.log('[bootstrap] Ensuring local-mode team and user exist...')

  // 1. Ensure team exists
  const [existingTeam] = await db.select().from(teams).where(eq(teams.id, LOCAL_TEAM_ID))
  if (!existingTeam) {
    await db.insert(teams).values({
      id: LOCAL_TEAM_ID,
      name: 'Local',
      description: 'Default local-mode team',
    })
    console.log('[bootstrap] Created local team')
  }

  // 2. Ensure user profile exists
  const [existingUser] = await db.select().from(userProfiles).where(eq(userProfiles.id, LOCAL_USER_ID))
  if (!existingUser) {
    await db.insert(userProfiles).values({
      id: LOCAL_USER_ID,
      name: 'Local User',
      email: 'dev@localhost',
    })
    console.log('[bootstrap] Created local user profile')
  }

  // 3. Ensure team membership exists
  const [existingMembership] = await db.select().from(teamMembers).where(
    eq(teamMembers.userId, LOCAL_USER_ID)
  )
  if (!existingMembership) {
    await db.insert(teamMembers).values({
      teamId: LOCAL_TEAM_ID,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })
    console.log('[bootstrap] Created local team membership')
  }

  console.log('[bootstrap] Local-mode bootstrap complete')
}
