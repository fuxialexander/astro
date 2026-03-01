/**
 * GitHub Token Resolver
 *
 * Shared utility for resolving a GitHub access token for a project.
 * Used by multiple hooks and services that need to call GitHub APIs
 * on behalf of a project's owner or team.
 *
 * Priority:
 * 1. Project owner's GitHub connection
 * 2. Any team member's GitHub connection (if team-scoped project)
 */

import { db } from './db/index.js'
import { githubConnections, teamMembers } from './db/schema.js'
import { eq } from 'drizzle-orm'

/**
 * Find a GitHub access token for the given owner/team.
 *
 * @param ownerId - The user ID of the project owner
 * @param teamId - The team ID (if the project is team-scoped)
 * @returns The access token, or null if no connection is available
 */
export async function findAccessToken(
  ownerId: string,
  teamId: string | null,
): Promise<string | null> {
  // Try project owner first
  const [ownerConn] = await db
    .select({ accessToken: githubConnections.accessToken })
    .from(githubConnections)
    .where(eq(githubConnections.userId, ownerId))
    .limit(1)

  if (ownerConn?.accessToken) {
    return ownerConn.accessToken
  }

  // Fall back to any team member with a GitHub connection
  if (teamId) {
    const [memberConn] = await db
      .select({ accessToken: githubConnections.accessToken })
      .from(githubConnections)
      .innerJoin(
        teamMembers,
        eq(teamMembers.userId, githubConnections.userId),
      )
      .where(eq(teamMembers.teamId, teamId))
      .limit(1)

    if (memberConn?.accessToken) {
      return memberConn.accessToken
    }
  }

  return null
}
