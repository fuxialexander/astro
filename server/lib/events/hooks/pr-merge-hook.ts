/**
 * PR Merge Hook
 *
 * When a GitHub PR is merged (merge_queue.succeeded event), update the
 * associated plan node status to 'completed' directly in the database.
 *
 * This provides reliable server-side persistence so that the status
 * transition happens even when no SSE clients are connected.
 *
 * Mirrors Linear's behavior: merging a PR automatically closes the linked issue.
 */

import type { EventHook } from '../types.js'
import { db } from '../../db/index.js'
import { planNodes } from '../../db/schema.js'
import { eq } from 'drizzle-orm'

/** Terminal statuses that should NOT be overridden by a PR merge event. */
const TERMINAL_STATUSES = new Set(['completed', 'pruned'])

export const prMergeHook: EventHook = async (event) => {
  if (event.type !== 'merge_queue.succeeded') return

  const { nodeId } = event

  // Look up the current node status
  const [node] = await db
    .select({ id: planNodes.id, status: planNodes.status })
    .from(planNodes)
    .where(eq(planNodes.id, nodeId))
    .limit(1)

  if (!node) {
    console.log(`[pr-merge-hook] Node ${nodeId} not found, skipping`)
    return
  }

  // Skip if already in a terminal status
  if (TERMINAL_STATUSES.has(node.status ?? '')) {
    console.log(
      `[pr-merge-hook] Node ${nodeId} already in terminal status '${node.status}', skipping`
    )
    return
  }

  // Transition to completed and record the merged queue status
  await db
    .update(planNodes)
    .set({
      status: 'completed',
      mergeQueueStatus: 'merged',
      updatedAt: new Date(),
    })
    .where(eq(planNodes.id, nodeId))

  console.log(
    `[pr-merge-hook] Node ${nodeId} transitioned from '${node.status}' → 'completed' after PR merge`
  )
}
