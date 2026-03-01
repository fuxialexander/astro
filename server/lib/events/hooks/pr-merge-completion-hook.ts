/**
 * PR Merge Completion Hook
 *
 * When a PR is merged (merge_queue.succeeded event), this hook
 * transitions the associated task from 'auto_verified' to 'completed'
 * and triggers downstream auto-dispatch.
 *
 * This ensures task completion is persisted server-side regardless of
 * whether a client has the page open to receive the SSE notification.
 *
 * Triggered by: merge_queue.succeeded events (from GitHub webhook handler)
 */

import type { EventHook } from '../types.js'
import { db } from '../../db/index.js'
import { planNodes } from '../../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { autoDispatchDownstream } from '../../dispatch/auto-dispatch.js'

export const prMergeCompletionHook: EventHook = async (event) => {
  if (event.type !== 'merge_queue.succeeded') return

  const { nodeId, projectId, prNumber, mergedSha } = event

  console.log(`[pr-merge-completion] PR #${prNumber} merged for node ${nodeId} in project ${projectId}`)

  // Find the node by clientId + projectId
  const [node] = await db.select({ id: planNodes.id, clientId: planNodes.clientId, status: planNodes.status })
    .from(planNodes)
    .where(and(
      eq(planNodes.clientId, nodeId),
      eq(planNodes.projectId, projectId)
    ))
    .limit(1)

  if (!node) {
    console.warn(`[pr-merge-completion] Node ${nodeId} not found in project ${projectId}`)
    return
  }

  // Only transition from auto_verified → completed (don't overwrite other statuses)
  if (node.status !== 'auto_verified' && node.status !== 'in_progress' && node.status !== 'awaiting_judgment') {
    console.log(`[pr-merge-completion] Node ${nodeId} status is '${node.status}', skipping (only transitions from auto_verified/in_progress/awaiting_judgment)`)
    return
  }

  try {
    // Update node status to completed + record merge metadata
    const updateSet: Record<string, unknown> = {
      status: 'completed',
      mergeQueueStatus: 'merged',
      updatedAt: new Date(),
    }
    if (mergedSha) {
      updateSet.executionOutput = `PR #${prNumber} merged (${mergedSha.slice(0, 7)})`
    }

    await db.update(planNodes)
      .set(updateSet)
      .where(eq(planNodes.clientId, nodeId))

    console.log(`[pr-merge-completion] Node ${nodeId} status updated to 'completed' (PR #${prNumber} merged)`)

    // Trigger auto-dispatch of downstream nodes
    autoDispatchDownstream(projectId, nodeId).catch((err) => {
      console.warn('[pr-merge-completion] Auto-dispatch downstream failed:', err)
    })
  } catch (error) {
    console.error('[pr-merge-completion] Failed to update node status:', error)
  }
}
