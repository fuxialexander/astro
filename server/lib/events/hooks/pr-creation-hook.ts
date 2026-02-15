/**
 * PR Creation Hook
 *
 * Automatically creates GitHub pull requests when tasks complete successfully.
 * Triggered by task.completed events with PR metadata.
 */

import type { EventHook } from '../types.js'

/**
 * GitHub PR creation hook
 *
 * Creates a PR when:
 * - Task completes successfully
 * - Task result includes PR metadata (branch, title, body)
 * - GITHUB_TOKEN environment variable is set
 *
 * Example task result metadata:
 * {
 *   prBranch: 'feature/add-login',
 *   prTitle: 'Add user login functionality',
 *   prBody: 'Implements #123\n\n- Add login form\n- Add auth middleware',
 *   prBaseBranch: 'main',
 *   repository: 'owner/repo'
 * }
 */
export const prCreationHook: EventHook = async (event) => {
  if (event.type !== 'task.completed') return

  const { result, node, project } = event

  // Only create PR if task succeeded
  if (result.status !== 'success') return

  // Check if node has auto-PR enabled
  if (!node.autoPR) return

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

  // Parse repository (format: owner/repo)
  const [owner, repo] = repository.split('/')
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

    // TODO: Update node with PR URL (requires nodeUpdateCallback integration)
    // For now, just log success
  } catch (error) {
    console.error('[pr-creation-hook] Error creating PR:', error)
  }
}
