/**
 * GitHub Field Sync Hook (Astro → GitHub)
 *
 * Triggered on task.completed, task.started, and plan node updates.
 * Pushes Astro-owned fields (status, priority, estimate, title) to GitHub.
 *
 * Data ownership model:
 * - Astro owns: status, priority, estimate, dependencies → pushed as labels/state
 * - Shared: title (last-write-wins with syncVersion conflict detection)
 * - GitHub owns: issue body/description
 *
 * Loop prevention:
 * - Sets syncSource='sync' before pushing to GitHub
 * - Webhook handler checks syncSource and skips if 'sync'
 * - Resets syncSource to 'user' after SYNC_SOURCE_RESET_DELAY_MS
 */

import type { AstroEvent, EventHook } from '../types.js'
import { db } from '../../db/index.js'
import { planNodes, projects } from '../../db/schema.js'
import { eq } from 'drizzle-orm'
import { resolveGitHubToken } from '../../github-client.js'
import {
  astroStatusToGitHub,
  priorityToGitHubLabel,
  estimateToGitHubLabel,
  updateGitHubIssue,
  syncGitHubIssueLabels,
  getGitHubIssue,
  resolveAstroUserToGitHubLogin,
  SYNC_SOURCE_RESET_DELAY_MS,
} from '../../github-sync-utils.js'
import { logSyncOperation } from '../../github-sync-logger.js'

const LOG_PREFIX = '[github-field-sync]'

/**
 * Sync a plan node's fields to its linked GitHub issue.
 *
 * Called from the event hook for task lifecycle events and
 * exported for use by the API route for manual field sync.
 */
export async function syncNodeToGitHub(
  nodeId: string,
  options: {
    /** Which fields changed — sync only those. If empty, sync all. */
    changedFields?: string[]
  } = {}
): Promise<{ success: boolean; error?: string }> {
  const { changedFields } = options

  // Look up the plan node
  const [node] = await db
    .select({
      id: planNodes.id,
      clientId: planNodes.clientId,
      projectId: planNodes.projectId,
      title: planNodes.title,
      status: planNodes.status,
      priority: planNodes.priority,
      estimate: planNodes.estimate,
      metadata: planNodes.metadata,
      githubIssueNumber: planNodes.githubIssueNumber,
      githubSyncVersion: planNodes.githubSyncVersion,
      syncSource: planNodes.syncSource,
    })
    .from(planNodes)
    .where(eq(planNodes.clientId, nodeId))
    .limit(1)

  if (!node?.githubIssueNumber) {
    return { success: true } // No linked issue — nothing to sync
  }

  // Look up the project for GitHub credentials and sync settings
  const [project] = await db
    .select({
      ownerId: projects.ownerId,
      teamId: projects.teamId,
      githubOwner: projects.githubOwner,
      githubRepo: projects.githubRepo,
      projectType: projects.projectType,
      githubSyncSettings: projects.githubSyncSettings,
    })
    .from(projects)
    .where(eq(projects.id, node.projectId))
    .limit(1)

  if (!project || project.projectType !== 'github') {
    return { success: true } // Not a GitHub-linked project
  }

  if (!project.githubOwner || !project.githubRepo) {
    return { success: false, error: 'Project missing GitHub owner/repo' }
  }

  // Check sync settings — respect enabled flag and direction
  const syncSettings = project.githubSyncSettings as Record<string, unknown> | null
  if (syncSettings) {
    // If sync is disabled, skip
    if (syncSettings.enabled === false) {
      return { success: true }
    }
    // If direction is 'github_to_astro' only, skip Astro→GitHub push
    if (syncSettings.direction === 'github_to_astro') {
      return { success: true }
    }
  }

  // Determine which fields are enabled for sync
  const enabledFields = (syncSettings?.enabledFields as string[] | undefined) ??
    ['title', 'status', 'priority', 'assignee', 'labels', 'estimate']

  // Custom label mapping for priority labels
  const labelMapping = (syncSettings?.labelMapping as Record<string, string> | undefined) ?? {}

  const { githubOwner: owner, githubRepo: repo } = project

  // Resolve GitHub token
  const tokenResult = await resolveGitHubToken(owner, repo, project.ownerId, project.teamId)
  if (!tokenResult) {
    console.warn(
      `${LOG_PREFIX} No GitHub token available for ${owner}/${repo} — skipping sync`
    )
    return { success: false, error: 'No GitHub token available' }
  }

  const accessToken = tokenResult.token
  const issueNumber = node.githubIssueNumber

  // Mark the node as syncing (prevents webhook echo)
  const currentVersion = node.githubSyncVersion ?? 0
  const newVersion = currentVersion + 1

  await db.update(planNodes).set({
    syncSource: 'sync',
    githubSyncVersion: newVersion,
    githubSyncedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(planNodes.id, node.id))

  // Schedule reset of syncSource back to 'user'
  setTimeout(async () => {
    try {
      // Only reset if syncSource is still 'sync' (not changed by another operation)
      const [current] = await db
        .select({ syncSource: planNodes.syncSource })
        .from(planNodes)
        .where(eq(planNodes.id, node.id))
        .limit(1)

      if (current?.syncSource === 'sync') {
        await db.update(planNodes).set({
          syncSource: 'user',
          updatedAt: new Date(),
        }).where(eq(planNodes.id, node.id))
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to reset syncSource:`, err)
    }
  }, SYNC_SOURCE_RESET_DELAY_MS)

  try {
    // Fetch current issue state for label sync
    const currentIssue = await getGitHubIssue(accessToken, owner, repo, issueNumber)

    // ── Sync title ──
    const shouldSyncTitle = enabledFields.includes('title') && (!changedFields || changedFields.includes('title'))
    if (shouldSyncTitle && node.title) {
      // Only update if title actually changed (avoid no-op API calls)
      if (!currentIssue || currentIssue.title !== node.title) {
        const titleResult = await updateGitHubIssue(accessToken, owner, repo, issueNumber, {
          title: node.title,
        })
        if (!titleResult.success) {
          console.warn(`${LOG_PREFIX} Failed to sync title: ${titleResult.error}`)
        }
      }
    }

    // ── Sync status → GitHub state ──
    const shouldSyncStatus = enabledFields.includes('status') && (!changedFields || changedFields.includes('status'))
    if (shouldSyncStatus && node.status) {
      const ghState = astroStatusToGitHub(node.status)

      // Only update if state actually changed
      if (!currentIssue || currentIssue.state !== ghState.state) {
        const stateResult = await updateGitHubIssue(accessToken, owner, repo, issueNumber, {
          state: ghState.state,
          state_reason: ghState.state === 'closed' ? ghState.state_reason : undefined,
        })
        if (!stateResult.success) {
          console.warn(`${LOG_PREFIX} Failed to sync status: ${stateResult.error}`)
        } else {
          console.log(
            `${LOG_PREFIX} Synced status '${node.status}' → GitHub state '${ghState.state}' ` +
            `for issue #${issueNumber} in ${owner}/${repo}`
          )
        }
      }
    }

    // ── Sync priority + estimate → labels ──
    const shouldSyncPriority = enabledFields.includes('priority') && (!changedFields || changedFields.includes('priority'))
    const shouldSyncEstimate = enabledFields.includes('estimate') && (!changedFields || changedFields.includes('estimate'))

    if ((shouldSyncPriority || shouldSyncEstimate) && currentIssue) {
      const desiredLabels: Array<{ name: string; color: string }> = []
      const managedPrefixes: string[] = []

      if (shouldSyncPriority) {
        managedPrefixes.push('priority:')
        const priorityLabel = priorityToGitHubLabel(node.priority ?? undefined, labelMapping)
        if (priorityLabel) desiredLabels.push(priorityLabel)
      }

      if (shouldSyncEstimate) {
        managedPrefixes.push('estimate:')
        const estimateLabel = estimateToGitHubLabel(node.estimate ?? undefined)
        if (estimateLabel) desiredLabels.push(estimateLabel)
      }

      await syncGitHubIssueLabels(
        accessToken,
        owner,
        repo,
        issueNumber,
        currentIssue.labels,
        desiredLabels,
        managedPrefixes
      )
    }

    // ── Sync assignee ──
    // Assignee is stored in metadata.assigneeUserId since there's no dedicated column
    const shouldSyncAssignee = enabledFields.includes('assignee') && (!changedFields || changedFields.includes('assignee'))
    const metadata = (node.metadata ?? {}) as Record<string, unknown>
    const assigneeUserId = metadata.assigneeUserId as string | undefined
    if (shouldSyncAssignee && assigneeUserId) {
      const ghLogin = await resolveAstroUserToGitHubLogin(assigneeUserId)
      if (ghLogin) {
        const currentAssignees = currentIssue?.assignees.map((a) => a.login) ?? []
        if (!currentAssignees.includes(ghLogin)) {
          await updateGitHubIssue(accessToken, owner, repo, issueNumber, {
            assignees: [ghLogin],
          })
        }
      }
    }

    console.log(
      `${LOG_PREFIX} Synced node '${nodeId}' → issue #${issueNumber} in ${owner}/${repo} ` +
      `(version: ${newVersion}, fields: ${changedFields?.join(', ') || 'all'})`
    )

    await logSyncOperation({
      projectId: node.projectId,
      nodeId,
      direction: 'astro_to_github',
      action: changedFields?.includes('status')
        ? (node.status === 'completed' || node.status === 'pruned' ? 'close' : 'update')
        : 'update',
      status: 'success',
      metadata: { issueNumber, fields: changedFields ?? ['all'], version: newVersion },
    })

    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG_PREFIX} Sync failed for node '${nodeId}':`, msg)

    await logSyncOperation({
      projectId: node.projectId,
      nodeId,
      direction: 'astro_to_github',
      action: 'update',
      status: 'error',
      errorMessage: msg,
      metadata: { issueNumber, fields: changedFields ?? ['all'] },
    })

    return { success: false, error: msg }
  }
}

/**
 * Event hook that syncs Astro task changes to GitHub issues.
 *
 * Listens to:
 * - task.completed → close GitHub issue
 * - task.started → reopen GitHub issue (if it was closed)
 */
export const githubFieldSyncHook: EventHook = async (event: AstroEvent) => {
  // Only handle events that affect GitHub-synced fields
  switch (event.type) {
    case 'task.completed': {
      await syncNodeToGitHub(event.nodeId, {
        changedFields: ['status'],
      })
      break
    }
    case 'task.started': {
      await syncNodeToGitHub(event.nodeId, {
        changedFields: ['status'],
      })
      break
    }
    // Other events (task.failed, branch.pruned) could be handled here too
    case 'task.failed': {
      // Failed tasks don't change GitHub state
      break
    }
    case 'branch.pruned': {
      // Prune all nodes in the branch
      for (const prunedNodeId of event.prunedNodes) {
        await syncNodeToGitHub(prunedNodeId, {
          changedFields: ['status'],
        })
      }
      break
    }
    default:
      break
  }
}
