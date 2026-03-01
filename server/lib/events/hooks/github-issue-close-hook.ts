/**
 * GitHub Issue Close Hook
 *
 * When a task linked to a GitHub issue is completed, close the
 * corresponding GitHub issue via the GitHub API.
 *
 * This ensures bidirectional sync: completing a task in Astro
 * also marks the linked GitHub issue as closed.
 */

import type { AstroEvent, EventHook } from '../types.js'
import { db } from '../../db/index.js'
import { planNodes, projects } from '../../db/schema.js'
import { eq } from 'drizzle-orm'
import { findAccessToken } from '../../github-token-resolver.js'

const GITHUB_API_BASE = 'https://api.github.com'

/**
 * Close a GitHub issue via the API.
 */
async function closeGitHubIssue(
  accessToken: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state: 'closed',
          state_reason: 'completed',
        }),
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      return {
        success: false,
        error: `GitHub API error ${response.status}: ${errorBody}`,
      }
    }

    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

export const githubIssueCloseHook: EventHook = async (event: AstroEvent) => {
  if (event.type !== 'task.completed') return

  const { node, result } = event

  // Only close issues for successfully completed tasks
  if (result.status !== 'success') return

  // Look up the plan node from DB to get githubIssueNumber
  const [dbNode] = await db
    .select({
      githubIssueNumber: planNodes.githubIssueNumber,
      projectId: planNodes.projectId,
    })
    .from(planNodes)
    .where(eq(planNodes.clientId, node.id))
    .limit(1)

  if (!dbNode?.githubIssueNumber) return

  // Look up the project to get GitHub repo info and owner
  const [project] = await db
    .select({
      ownerId: projects.ownerId,
      teamId: projects.teamId,
      githubOwner: projects.githubOwner,
      githubRepo: projects.githubRepo,
      projectType: projects.projectType,
    })
    .from(projects)
    .where(eq(projects.id, dbNode.projectId))
    .limit(1)

  if (!project) {
    console.warn(`[github-issue-close-hook] Project not found: ${dbNode.projectId}`)
    return
  }

  // Only process GitHub-linked projects
  if (project.projectType !== 'github') return
  if (!project.githubOwner || !project.githubRepo) {
    console.warn(`[github-issue-close-hook] Project ${dbNode.projectId} missing GitHub owner/repo`)
    return
  }

  // Find an access token
  const accessToken = await findAccessToken(project.ownerId, project.teamId)
  if (!accessToken) {
    console.warn(
      `[github-issue-close-hook] No GitHub connection found for project ${dbNode.projectId} ` +
      `(owner: ${project.ownerId}, team: ${project.teamId})`
    )
    return
  }

  // Close the issue
  const closeResult = await closeGitHubIssue(
    accessToken,
    project.githubOwner,
    project.githubRepo,
    dbNode.githubIssueNumber,
  )

  if (closeResult.success) {
    console.log(
      `[github-issue-close-hook] Closed GitHub issue #${dbNode.githubIssueNumber} ` +
      `for ${project.githubOwner}/${project.githubRepo}`
    )
  } else {
    console.error(
      `[github-issue-close-hook] Failed to close GitHub issue #${dbNode.githubIssueNumber} ` +
      `for ${project.githubOwner}/${project.githubRepo}: ${closeResult.error}`
    )
  }
}
