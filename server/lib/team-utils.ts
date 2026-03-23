import { and, count, eq, isNull, ne } from 'drizzle-orm'
import { db } from './db/index.js'
import {
  blobs,
  environmentConfigs,
  githubAppInstallations,
  initiatives,
  machineInstructions,
  projects,
  machineTeamShares,
  sharedPlans,
  skills,
  teams,
} from './db/schema.js'
import type { AuthUser } from '../middleware/auth.js'

export const PERSONAL_WORKSPACE_DESCRIPTION = 'Personal workspace'
export const LEGACY_PERSONAL_WORKSPACE_DESCRIPTION = 'Auto-created personal workspace'

export function isPersonalWorkspaceDescription(description: string | null | undefined): boolean {
  return description === PERSONAL_WORKSPACE_DESCRIPTION
    || description === LEGACY_PERSONAL_WORKSPACE_DESCRIPTION
}

export function isPersonalWorkspaceTeam(team: { description?: string | null } | null | undefined): boolean {
  return isPersonalWorkspaceDescription(team?.description)
}

export async function getTeamById(teamId: string): Promise<{ id: string; name: string; description: string } | null> {
  const [team] = await db.select({
    id: teams.id,
    name: teams.name,
    description: teams.description,
  }).from(teams).where(eq(teams.id, teamId)).limit(1)

  return team ?? null
}

export async function countBlockingTeamResources(teamId: string): Promise<Array<{ key: string; label: string; count: number }>> {
  const [
    projectResult,
    initiativeResult,
    blobResult,
    machineResult,
    instructionResult,
    envConfigResult,
    githubInstallResult,
    skillResult,
    sharedPlanResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(projects).where(and(eq(projects.teamId, teamId), ne(projects.status, 'deleted'))),
    db.select({ count: count() }).from(initiatives).where(eq(initiatives.teamId, teamId)),
    db.select({ count: count() }).from(blobs).where(eq(blobs.teamId, teamId)),
    db.select({ count: count() }).from(machineTeamShares).where(eq(machineTeamShares.teamId, teamId)),
    db.select({ count: count() }).from(machineInstructions).where(eq(machineInstructions.teamId, teamId)),
    db.select({ count: count() }).from(environmentConfigs).where(eq(environmentConfigs.teamId, teamId)),
    db.select({ count: count() }).from(githubAppInstallations).where(eq(githubAppInstallations.teamId, teamId)),
    db.select({ count: count() }).from(skills).where(eq(skills.teamId, teamId)),
    db.select({ count: count() }).from(sharedPlans).where(and(eq(sharedPlans.teamId, teamId), isNull(sharedPlans.deletedAt))),
  ])

  const resources = [
    { key: 'projects', label: 'projects', count: projectResult[0]?.count ?? 0 },
    { key: 'initiatives', label: 'initiatives', count: initiativeResult[0]?.count ?? 0 },
    { key: 'blobs', label: 'files', count: blobResult[0]?.count ?? 0 },
    { key: 'machines', label: 'shared machines', count: machineResult[0]?.count ?? 0 },
    { key: 'instructions', label: 'machine instructions', count: instructionResult[0]?.count ?? 0 },
    { key: 'environmentConfigs', label: 'environment configs', count: envConfigResult[0]?.count ?? 0 },
    { key: 'githubAppInstallations', label: 'GitHub app installations', count: githubInstallResult[0]?.count ?? 0 },
    { key: 'skills', label: 'skills', count: skillResult[0]?.count ?? 0 },
    { key: 'sharedPlans', label: 'team-visible shared plans', count: sharedPlanResult[0]?.count ?? 0 },
  ]

  return resources.filter((resource) => resource.count > 0)
}

export function resolveWritableTeamId(
  user: Pick<AuthUser, 'teamId' | 'teamIds'>,
  requestedTeamId: unknown,
): { teamId: string } | { error: string } {
  if (requestedTeamId === undefined || requestedTeamId === null || requestedTeamId === '') {
    return { teamId: user.teamId }
  }

  if (typeof requestedTeamId !== 'string' || !user.teamIds.includes(requestedTeamId)) {
    return { error: 'Invalid teamId' }
  }

  return { teamId: requestedTeamId }
}
