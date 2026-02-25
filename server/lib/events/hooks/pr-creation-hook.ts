/**
 * PR Creation Hook
 *
 * Records PR data from agent runner results and optionally creates PRs via GitHub API.
 *
 * Three paths:
 * 1. Agent already created PR → record prUrl/prNumber/branchName to DB
 * 2. No PR from agent, autoPr enabled → create PR via GitHub API, then record
 * 3. Branch only, no PR, no autoPr → record branchName to DB for tracking
 *
 * After recording, this hook mutates event.node in-place so downstream hooks
 * (e.g., merge-queue-hook) can see the PR data when hooks run sequentially.
 */

import type { AstroEvent, EventHook } from '../types.js'
import { db } from '../../db/index.js'
import { planNodes } from '../../db/schema.js'
import { eq } from 'drizzle-orm'

/**
 * Persist branchName/prUrl/prNumber to the planNodes table and mutate event.node in-place.
 */
async function persistPrData(
  nodeId: string,
  node: { branchName?: string; prUrl?: string; prNumber?: number },
  data: { branchName?: string; prUrl?: string; prNumber?: number },
): Promise<void> {
  // Mutate event.node in-place so downstream hooks see the data
  if (data.branchName) node.branchName = data.branchName
  if (data.prUrl) node.prUrl = data.prUrl
  if (data.prNumber) node.prNumber = data.prNumber

  // Build the DB update set (only include non-undefined fields)
  const updateSet: Record<string, unknown> = { updatedAt: new Date() }
  if (data.branchName) updateSet.branchName = data.branchName
  if (data.prUrl) updateSet.prUrl = data.prUrl
  if (data.prNumber !== undefined) updateSet.prNumber = data.prNumber

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

  const { result, node, project } = event

  console.log(`[pr-creation-hook] Processing task.completed: nodeId=${node.id}, status=${result.status}, prUrl=${result.prUrl}, prNumber=${result.prNumber}, branchName=${result.branchName}`)

  // Only process successful tasks
  if (result.status !== 'success') return

  // Path 1: Agent already created PR — just record it
  if (result.prUrl && result.prNumber) {
    console.log(`[pr-creation-hook] Recording agent-created PR #${result.prNumber}: ${result.prUrl}`)
    await persistPrData(node.id, node, {
      branchName: result.branchName,
      prUrl: result.prUrl,
      prNumber: result.prNumber,
    })
    return
  }

  // Path 2: No PR from agent, autoPr enabled, branch exists → create via GitHub API
  if (node.autoPr && result.branchName) {
    const githubToken = process.env.GITHUB_TOKEN
    if (!githubToken) {
      console.warn('[pr-creation-hook] GITHUB_TOKEN not set, recording branch only')
      await persistPrData(node.id, node, { branchName: result.branchName })
      return
    }

    // Get repository from project
    const repository = project?.repository
    if (!repository) {
      console.warn('[pr-creation-hook] No repository found on project, recording branch only')
      await persistPrData(node.id, node, { branchName: result.branchName })
      return
    }

    // Parse repository (format: owner/repo or URL)
    let owner: string | undefined
    let repo: string | undefined
    if (repository.includes('/') && !repository.includes('://')) {
      ;[owner, repo] = repository.split('/')
    } else {
      const match = repository.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
      if (match) {
        owner = match[1]
        repo = match[2]
      }
    }

    if (!owner || !repo) {
      console.warn('[pr-creation-hook] Could not parse repository:', repository)
      await persistPrData(node.id, node, { branchName: result.branchName })
      return
    }

    try {
      const prTitle = node.number ? `[#${node.number}] ${node.title}` : node.title || `Task: ${node.id}`
      const prBody = `Automated PR for task: ${node.title}\n\n${result.stdout || ''}`

      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: prTitle,
          body: prBody,
          head: result.branchName,
          base: 'main',
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        console.error('[pr-creation-hook] Failed to create PR:', error)
        // Still record the branch
        await persistPrData(node.id, node, { branchName: result.branchName })
        return
      }

      const pr = await response.json() as { html_url: string; number: number }
      console.log(`[pr-creation-hook] Created PR #${pr.number}: ${pr.html_url}`)

      await persistPrData(node.id, node, {
        branchName: result.branchName,
        prUrl: pr.html_url,
        prNumber: pr.number,
      })
    } catch (error) {
      console.error('[pr-creation-hook] Error creating PR:', error)
      // Still record the branch
      await persistPrData(node.id, node, { branchName: result.branchName })
    }
    return
  }

  // Path 3: Branch only, no PR, no autoPr → record branch for tracking
  if (result.branchName) {
    console.log(`[pr-creation-hook] Recording branch: ${result.branchName}`)
    await persistPrData(node.id, node, { branchName: result.branchName })
  }
}
