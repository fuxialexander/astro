/**
 * Merge Queue Hook
 *
 * Automatically labels completed task PRs and enables auto-merge
 * so GitHub's merge queue processes them.
 *
 * Triggered by task.completed events when:
 * - Task completed successfully
 * - Project has mergeQueueEnabled = true
 * - Node has a prNumber
 * - A GitHub token is available (see resolution chain below)
 *
 * Token resolution is delegated to `resolveGitHubToken()` (see github-client.ts):
 * 1. GitHub App installation token (preferred — has necessary write permissions)
 * 2. GITHUB_TOKEN env var (for CI/CD compatibility)
 * 3. Project owner's OAuth token (may lack permissions for auto-merge)
 * 4. Any team member's OAuth token (last resort)
 *
 * Note: enabling auto-merge via GraphQL requires the token to have `repo` scope
 * (OAuth) or write access (GitHub App). If the resolved token lacks sufficient
 * permissions the API call will fail with a 403 and the error will be logged.
 */

import type { EventHook } from '../types.js'
import { addLabelsToIssue, enableAutoMerge } from '../../../plugins/channel-github/github-api.js'
import { resolveGitHubToken } from '../../github-client.js'
import { db } from '../../db/index.js'
import { projects } from '../../db/schema.js'
import { eq } from 'drizzle-orm'

const LOG_PREFIX = '[merge-queue-hook]'

/**
 * Map frontend merge method names to GitHub GraphQL enum values
 */
function toGraphQLMergeMethod(method?: string): 'MERGE' | 'SQUASH' | 'REBASE' {
  switch (method) {
    case 'merge': return 'MERGE'
    case 'rebase': return 'REBASE'
    case 'squash':
    default: return 'SQUASH'
  }
}

export const mergeQueueHook: EventHook = async (event) => {
  if (event.type !== 'task.completed') return

  const { result, node, project } = event

  // Only process successful tasks
  if (result.status !== 'success') return

  // Check if project has merge queue enabled
  if (!project?.mergeQueueEnabled) return

  // Get PR number from node or result metadata
  const prNumber = node.prNumber ?? (result.metadata as Record<string, unknown>)?.prNumber as number | undefined
  if (!prNumber) {
    console.log(`${LOG_PREFIX} No prNumber found, skipping`)
    return
  }

  // Get repository from project
  const repository = project.repository
  if (!repository) {
    console.warn(`${LOG_PREFIX} No repository found on project, skipping`)
    return
  }

  // Parse repository (format: owner/repo or URL)
  let owner: string
  let repo: string
  if (repository.includes('/') && !repository.includes('://')) {
    // Simple owner/repo format
    ;[owner, repo] = repository.split('/')
  } else {
    // URL format: extract owner/repo from git URL
    const match = repository.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
    if (!match) {
      console.warn(`${LOG_PREFIX} Could not parse repository URL:`, repository)
      return
    }
    owner = match[1]
    repo = match[2]
  }

  if (!owner || !repo) {
    console.warn(`${LOG_PREFIX} Invalid repository format`)
    return
  }

  // Look up the project from DB to get ownerId/teamId for OAuth fallback
  const [dbProject] = await db
    .select({ ownerId: projects.ownerId, teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, event.projectId))
    .limit(1)

  const ownerId = dbProject?.ownerId
  const teamId = dbProject?.teamId ?? null

  // Resolve GitHub token via the unified priority chain
  const tokenResult = await resolveGitHubToken(owner, repo, ownerId, teamId)
  if (!tokenResult) {
    console.warn(
      `${LOG_PREFIX} No GitHub token available for ${owner}/${repo} ` +
      `— skipping merge queue enqueue for PR #${prNumber}. ` +
      `Configure GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY or GITHUB_TOKEN to enable this feature.`
    )
    return
  }

  console.log(
    `${LOG_PREFIX} Using ${tokenResult.type} token (${tokenResult.source}) ` +
    `for PR #${prNumber} in ${owner}/${repo}`
  )
  const githubToken = tokenResult.token

  try {
    // Step 1: Label the PR
    const labels = [
      'astro-managed',
      `astro-project:${event.projectId}`,
      `astro-node:${event.nodeId}`,
    ]

    console.log(`${LOG_PREFIX} Labeling PR #${prNumber} with:`, labels)
    await addLabelsToIssue(githubToken, owner, repo, prNumber, labels)

    // Step 2: Enable auto-merge (this enqueues the PR in the merge queue)
    const mergeMethod = toGraphQLMergeMethod(project.mergeQueueMergeMethod)
    console.log(`${LOG_PREFIX} Enabling auto-merge on PR #${prNumber} with method: ${mergeMethod}`)
    const autoMergeResult = await enableAutoMerge(githubToken, owner, repo, prNumber, mergeMethod)

    if (!autoMergeResult.success) {
      console.error(
        `${LOG_PREFIX} Failed to enable auto-merge on PR #${prNumber}: ${autoMergeResult.error}. ` +
        `Ensure the token has sufficient permissions (write access or 'repo' scope).`
      )
      return
    }

    console.log(`${LOG_PREFIX} PR #${prNumber} enqueued for merge (method: ${mergeMethod})`)

    // Note: Node mergeQueueStatus update happens via webhook events when GitHub
    // processes the merge queue (merge_group events)
  } catch (error) {
    console.error(`${LOG_PREFIX} Error processing merge queue:`, error)
  }
}
