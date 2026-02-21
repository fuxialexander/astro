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
 * - GITHUB_TOKEN environment variable is set
 */

import type { EventHook } from '../types.js'
import { addLabelsToIssue, enableAutoMerge } from '../../../plugins/channel-github/github-api.js'

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
    console.log('[merge-queue-hook] No prNumber found, skipping')
    return
  }

  // Get GitHub token
  const githubToken = process.env.GITHUB_TOKEN
  if (!githubToken) {
    console.warn('[merge-queue-hook] GITHUB_TOKEN not set, skipping merge queue enqueue')
    return
  }

  // Get repository from project
  const repository = project.repository
  if (!repository) {
    console.warn('[merge-queue-hook] No repository found on project, skipping')
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
      console.warn('[merge-queue-hook] Could not parse repository URL:', repository)
      return
    }
    owner = match[1]
    repo = match[2]
  }

  if (!owner || !repo) {
    console.warn('[merge-queue-hook] Invalid repository format')
    return
  }

  try {
    // Step 1: Label the PR
    const labels = [
      'astro-managed',
      `astro-project:${event.projectId}`,
      `astro-node:${event.nodeId}`,
    ]

    console.log(`[merge-queue-hook] Labeling PR #${prNumber} with:`, labels)
    await addLabelsToIssue(githubToken, owner, repo, prNumber, labels)

    // Step 2: Enable auto-merge (this enqueues the PR in the merge queue)
    const mergeMethod = toGraphQLMergeMethod(project.mergeQueueMergeMethod)
    console.log(`[merge-queue-hook] Enabling auto-merge on PR #${prNumber} with method: ${mergeMethod}`)
    const autoMergeResult = await enableAutoMerge(githubToken, owner, repo, prNumber, mergeMethod)

    if (!autoMergeResult.success) {
      console.error(`[merge-queue-hook] Failed to enable auto-merge on PR #${prNumber}: ${autoMergeResult.error}`)
      return
    }

    console.log(`[merge-queue-hook] PR #${prNumber} enqueued for merge (method: ${mergeMethod})`)

    // Note: Node mergeQueueStatus update happens via webhook events when GitHub
    // processes the merge queue (merge_group events)
  } catch (error) {
    console.error('[merge-queue-hook] Error processing merge queue:', error)
  }
}
