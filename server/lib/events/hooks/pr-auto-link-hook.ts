/**
 * PR Auto-Link Hook
 *
 * Handles the pr.linked event by persisting branch/PR data to the plan node
 * and adding a GitHub PR link entry to the node's links array.
 *
 * This hook is triggered when:
 * 1. A push webhook matches a branch to a plan node (auto-branch)
 * 2. A PR opened webhook matches head branch or body reference (auto-branch / auto-body-reference)
 * 3. A manual link is created via POST /api/github/pr/link (manual)
 */

import type { AstroEvent, EventHook } from '../types.js'
import { db } from '../../db/index.js'
import { planNodes } from '../../db/schema.js'
import { eq } from 'drizzle-orm'

export const prAutoLinkHook: EventHook = async (event: AstroEvent) => {
  if (event.type !== 'pr.linked') return

  const { nodeId, prNumber, prUrl, branchName, linkSource } = event

  console.log(`[pr-auto-link] Linking PR to node ${nodeId}: prNumber=${prNumber}, branchName=${branchName}, source=${linkSource}`)

  // Build the DB update set
  const updateSet: Record<string, unknown> = { updatedAt: new Date() }
  if (branchName) updateSet.branchName = branchName
  if (prUrl) updateSet.prUrl = prUrl
  if (prNumber !== undefined) updateSet.prNumber = prNumber

  try {
    // Fetch existing node to merge links
    const [existing] = await db.select({
      id: planNodes.id,
      links: planNodes.links,
      branchName: planNodes.branchName,
      prNumber: planNodes.prNumber,
    })
      .from(planNodes)
      .where(eq(planNodes.clientId, nodeId))
      .limit(1)

    if (!existing) {
      console.warn(`[pr-auto-link] Node ${nodeId} not found, skipping`)
      return
    }

    // Don't overwrite existing PR data with less specific data
    // (e.g., don't overwrite prNumber if already set and new event only has branchName)
    if (existing.prNumber && !prNumber) {
      delete updateSet.prNumber
      delete updateSet.prUrl
    }
    if (existing.branchName && !branchName) {
      delete updateSet.branchName
    }

    // Add/update GitHub PR link in links array
    if (prNumber && prUrl) {
      const existingLinks = (existing.links ?? []) as Array<{
        id: string; type: string; url: string; title: string; state?: string; number?: number; targetId?: string
      }>
      const prLinkId = `gh-pr-${prNumber}`
      const prLink = {
        id: prLinkId,
        type: 'github_pr',
        url: prUrl,
        title: `PR #${prNumber}`,
        state: 'open' as const,
        number: prNumber,
      }
      const mergedLinks = [...existingLinks.filter((l) => l.id !== prLinkId), prLink]
      updateSet.links = mergedLinks
    }

    await db.update(planNodes)
      .set(updateSet)
      .where(eq(planNodes.clientId, nodeId))

    console.log(`[pr-auto-link] Successfully linked ${linkSource}: node=${nodeId}, pr=${prNumber ?? 'none'}, branch=${branchName ?? 'none'}`)
  } catch (dbError) {
    console.error('[pr-auto-link] Failed to persist link data:', dbError)
  }
}
