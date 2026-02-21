/**
 * PR Creation Hook
 *
 * Automatically creates GitHub pull requests when tasks complete successfully.
 * Triggered by task.completed events when the node has autoPr enabled.
 *
 * After creating a PR, this hook:
 * 1. Mutates event.node in-place (prUrl, prNumber) so downstream hooks
 *    (e.g., merge-queue-hook) can see the PR data when hooks run sequentially.
 * 2. Updates the database to persist the PR metadata.
 */

import type { AstroEvent, EventHook } from '../types.js'
import { db } from '../../db/index.js'
import { planNodes } from '../../db/schema.js'
import { eq } from 'drizzle-orm'

export const prCreationHook: EventHook = async (event: AstroEvent) => {
  if (event.type !== 'task.completed') return

  const { result, node, project } = event

  // Only create PR if task succeeded
  if (result.status !== 'success') return

  // Check if node has auto-PR enabled
  if (!node.autoPr) return

  // Get GitHub token
  const githubToken = process.env.GITHUB_TOKEN
  if (!githubToken) {
    console.warn('[pr-creation-hook] GITHUB_TOKEN not set, skipping PR creation')
    return
  }

  // Get repository from project or result metadata
  const repository = project?.repository || (result.metadata as Record<string, unknown>)?.repository as string | undefined
  if (!repository) {
    console.warn('[pr-creation-hook] No repository found, skipping PR creation')
    return
  }

  // Parse repository (format: owner/repo or URL)
  let owner: string
  let repo: string
  if (repository.includes('/') && !repository.includes('://')) {
    ;[owner, repo] = repository.split('/')
  } else {
    const match = repository.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
    if (!match) {
      console.warn('[pr-creation-hook] Could not parse repository URL:', repository)
      return
    }
    owner = match[1]
    repo = match[2]
  }

  if (!owner || !repo) {
    console.warn('[pr-creation-hook] Invalid repository format, expected owner/repo')
    return
  }

  // Get PR metadata from result
  const metadata = result.metadata as Record<string, unknown> | undefined
  const prBranch = metadata?.prBranch as string | undefined
  const prTitle = metadata?.prTitle as string | undefined || node.title
  const prBody = metadata?.prBody as string | undefined || `Automated PR for task: ${node.title}\n\n${result.stdout || ''}`
  const prBaseBranch = metadata?.prBaseBranch as string | undefined || 'main'

  if (!prBranch) {
    console.warn('[pr-creation-hook] No prBranch in result metadata, skipping PR creation')
    return
  }

  try {
    // Create PR via GitHub API
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
        head: prBranch,
        base: prBaseBranch,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('[pr-creation-hook] Failed to create PR:', error)
      return
    }

    const pr = await response.json() as { html_url: string; number: number }

    console.log(`[pr-creation-hook] Created PR #${pr.number}: ${pr.html_url}`)

    // Mutate event.node in-place so downstream hooks (merge-queue-hook) see the PR data
    node.prUrl = pr.html_url
    node.prNumber = pr.number

    // Persist PR metadata to the database
    try {
      await db.update(planNodes)
        .set({
          prUrl: pr.html_url,
          prNumber: pr.number,
          updatedAt: new Date(),
        })
        .where(eq(planNodes.clientId, node.id))
    } catch (dbError) {
      // Database update is best-effort — the in-place mutation already
      // ensures the merge-queue-hook can proceed in this same event cycle.
      console.error('[pr-creation-hook] Failed to persist PR data to database:', dbError)
    }
  } catch (error) {
    console.error('[pr-creation-hook] Error creating PR:', error)
  }
}
