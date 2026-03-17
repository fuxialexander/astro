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
const LOCAL_TEAM_2_ID = '00000000-0000-0000-0000-000000000002'
const LOCAL_USER_2_ID = '00000000-0000-0000-0000-000000000010'

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

  // 4. Seed a second team + user for testing team features in local mode
  const [existingTeam2] = await db.select().from(teams).where(eq(teams.id, LOCAL_TEAM_2_ID))
  if (!existingTeam2) {
    await db.insert(teams).values({
      id: LOCAL_TEAM_2_ID,
      name: 'Research Lab',
      description: 'Second team for testing team switcher',
    })
    console.log('[bootstrap] Created second local team (Research Lab)')
  }

  const [existingUser2] = await db.select().from(userProfiles).where(eq(userProfiles.id, LOCAL_USER_2_ID))
  if (!existingUser2) {
    await db.insert(userProfiles).values({
      id: LOCAL_USER_2_ID,
      name: 'Alice (Test)',
      email: 'alice@localhost',
    })
    console.log('[bootstrap] Created second local user (Alice)')
  }

  // Add local user to second team
  const [existingMembership2] = await db.select().from(teamMembers).where(
    eq(teamMembers.teamId, LOCAL_TEAM_2_ID)
  )
  if (!existingMembership2) {
    await db.insert(teamMembers).values({
      teamId: LOCAL_TEAM_2_ID,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })
    // Add Alice to both teams
    await db.insert(teamMembers).values({
      teamId: LOCAL_TEAM_ID,
      userId: LOCAL_USER_2_ID,
      role: 'member',
    }).onConflictDoNothing()
    await db.insert(teamMembers).values({
      teamId: LOCAL_TEAM_2_ID,
      userId: LOCAL_USER_2_ID,
      role: 'member',
    }).onConflictDoNothing()
    console.log('[bootstrap] Created team memberships for second team')
  }

  console.log('[bootstrap] Local-mode bootstrap complete')
}
