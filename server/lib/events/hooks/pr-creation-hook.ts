/**
 * PR Creation Hook
 *
 * Records PR data from agent runner results.
 *
 * Two paths:
 * 1. Agent already created PR → record prUrl/prNumber/branchName to DB
 * 2. Branch only, no PR → record branchName to DB for tracking
 *
 * After recording, this hook mutates event.node in-place so downstream hooks
 * (e.g., merge-queue-hook) can see the PR data when hooks run sequentially.
 */

import type { AstroEvent, EventHook } from '../types.js'
import { db } from '../../db/index.js'
import { planNodes } from '../../db/schema.js'
import { eq } from 'drizzle-orm'

/**
 * Persist branchName/prUrl/prNumber/commitSHAs to the planNodes table and mutate event.node in-place.
 */
async function persistPrData(
  nodeId: string,
  node: { branchName?: string; prUrl?: string; prNumber?: number; commitBeforeSha?: string; commitAfterSha?: string },
  data: { branchName?: string; prUrl?: string; prNumber?: number; commitBeforeSha?: string; commitAfterSha?: string },
): Promise<void> {
  // Mutate event.node in-place so downstream hooks see the data
  if (data.branchName) node.branchName = data.branchName
  if (data.prUrl) node.prUrl = data.prUrl
  if (data.prNumber) node.prNumber = data.prNumber
  if (data.commitBeforeSha) node.commitBeforeSha = data.commitBeforeSha
  if (data.commitAfterSha) node.commitAfterSha = data.commitAfterSha

  // Build the DB update set (only include non-undefined fields)
  const updateSet: Record<string, unknown> = { updatedAt: new Date() }
  if (data.branchName) updateSet.branchName = data.branchName
  if (data.prUrl) updateSet.prUrl = data.prUrl
  if (data.prNumber !== undefined) updateSet.prNumber = data.prNumber
  if (data.commitBeforeSha) updateSet.commitBeforeSha = data.commitBeforeSha
  if (data.commitAfterSha) updateSet.commitAfterSha = data.commitAfterSha

  try {
    await db.update(planNodes)
      .set(updateSet)
      .where(eq(planNodes.clientId, nodeId))
  } catch (dbError) {
    // Database update is best-effort — the in-place mutation already
    // ensures the merge-queue-hook can proceed in this same event cycle.
    console.error('[pr-creation-hook] Failed to persist PR data to database:', dbError)
  }
}

export const prCreationHook: EventHook = async (event: AstroEvent) => {
  if (event.type !== 'task.completed') return

  const { result, node } = event

  console.log(`[pr-creation-hook] Processing task.completed: nodeId=${node.id}, status=${result.status}, prUrl=${result.prUrl}, prNumber=${result.prNumber}, branchName=${result.branchName}`)

  // Persist PR data whenever prUrl/prNumber/branchName exist, regardless of execution status.
  // Delivery may have succeeded even if execution failed, or the agent may have created a PR itself.

  // Path 1: Agent already created PR — just record it
  if (result.prUrl && result.prNumber) {
    console.log(`[pr-creation-hook] Recording agent-created PR #${result.prNumber}: ${result.prUrl}`)
    await persistPrData(node.id, node, {
      branchName: result.branchName,
      prUrl: result.prUrl,
      prNumber: result.prNumber,
      commitBeforeSha: result.commitBeforeSha,
      commitAfterSha: result.commitAfterSha,
    })
    return
  }

  // Path 2: Branch only, no PR → record branch for tracking
  if (result.branchName) {
    console.log(`[pr-creation-hook] Recording branch: ${result.branchName}`)
    await persistPrData(node.id, node, { branchName: result.branchName })
  }
}
