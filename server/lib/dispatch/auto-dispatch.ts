/**
 * Auto-Dispatch Downstream
 *
 * Shared utility to find downstream nodes whose dependencies are all completed
 * and emit task:ready SSE events to trigger auto-dispatch.
 *
 * Used by:
 * - data.ts PATCH /plan/nodes/:id (manual status changes)
 * - pr-merge-completion-hook (PR merge → task completion)
 */

import { db } from '../db/index.js'
import { planNodes, planEdges } from '../db/schema.js'
import { eq, and, isNull } from 'drizzle-orm'
import { executionEventBus } from '../execution-event-bus.js'

const COMPLETED_STATUSES = ['completed', 'auto_verified']

/**
 * Find downstream nodes whose dependencies are all completed, emit task:ready SSE events.
 */
export async function autoDispatchDownstream(projectId: string, completedNodeId: string): Promise<void> {
  const allNodes = await db.select().from(planNodes)
    .where(and(eq(planNodes.projectId, projectId), isNull(planNodes.deletedAt)))
  const allEdges = await db.select().from(planEdges)
    .where(and(eq(planEdges.projectId, projectId), isNull(planEdges.deletedAt)))

  const downstreamIds = allEdges
    .filter(e => e.sourceClientId === completedNodeId)
    .map(e => e.targetClientId)

  for (const downId of downstreamIds) {
    const downNode = allNodes.find(n => n.clientId === downId)
    if (!downNode || downNode.type !== 'task') continue
    if (downNode.status !== 'planned') continue

    const depEdges = allEdges.filter(e => e.targetClientId === downId)
    const allDepsMet = depEdges.every(depEdge => {
      const depNode = allNodes.find(n => n.clientId === depEdge.sourceClientId)
      return depNode && COMPLETED_STATUSES.includes(depNode.status)
    })

    if (allDepsMet) {
      executionEventBus.emit('task:ready', { nodeId: downId, projectId })
    }
  }
}
