/**
 * GitHub Webhook Event Handlers
 *
 * Dispatches incoming GitHub webhook events to appropriate handlers.
 * Chat-like interactions (@astro mentions) are routed through the channel router.
 */

import type { GitHubChannelConfig, InboundMessage, ChannelRouter } from '../../lib/channel/channel-types.js'
import { postGitHubComment } from './github-api.js'
import { astroEventTransport } from '../../lib/events/astro-event-transport.js'
import { lookupGitHubProject } from '../../lib/github-store.js'
import { db } from '../../lib/db/index.js'
import { planNodes } from '../../lib/db/schema.js'
import { eq, and } from 'drizzle-orm'

/**
 * Handle `issues` webhook events.
 */
export async function handleIssueEvent(
  payload: Record<string, unknown>,
  config: GitHubChannelConfig
): Promise<void> {
  const action = payload.action as string
  const issue = payload.issue as Record<string, unknown> | undefined
  const repo = payload.repository as Record<string, unknown> | undefined
  const repoFullName = repo?.full_name as string | undefined

  if (!issue || !repoFullName) return

  const projectId = config.repoMappings[repoFullName]
    ?? await lookupGitHubProject(repoFullName)
  if (!projectId) return

  const issueNumber = issue.number as number
  const issueTitle = issue.title as string
  const issueBody = (issue.body as string) || ''
  const issueUrl = issue.html_url as string

  switch (action) {
    case 'opened': {
      // Check if already exists (idempotency)
      const [existing] = await db.select({ id: planNodes.id })
        .from(planNodes)
        .where(and(
          eq(planNodes.projectId, projectId),
          eq(planNodes.githubIssueNumber, issueNumber)
        ))
        .limit(1)

      if (!existing) {
        await db.insert(planNodes).values({
          projectId,
          clientId: `gh-issue-${issueNumber}`,
          type: 'task',
          title: issueTitle,
          description: issueBody,
          status: 'planned',
          verification: 'human',
          githubIssueNumber: issueNumber,
          githubIssueUrl: issueUrl,
          links: [{ id: `gh-${issueNumber}`, type: 'github_issue', url: issueUrl, title: issueTitle, state: 'open', number: issueNumber }],
        })
      }
      break
    }
    case 'closed': {
      // Merge links to preserve user-added entries
      const [closedNode] = await db.select({ id: planNodes.id, links: planNodes.links })
        .from(planNodes)
        .where(and(eq(planNodes.projectId, projectId), eq(planNodes.githubIssueNumber, issueNumber)))
        .limit(1)
      if (closedNode) {
        const existingLinks = (closedNode.links ?? []) as Array<{ id: string; type: string; url: string; title: string; state?: string; number?: number; targetId?: string }>
        const ghLink = { id: `gh-${issueNumber}`, type: 'github_issue', url: issueUrl, title: issueTitle, state: 'closed', number: issueNumber }
        const mergedLinks = [...existingLinks.filter((l) => l.id !== ghLink.id), ghLink]
        await db.update(planNodes).set({
          status: 'completed',
          links: mergedLinks,
          updatedAt: new Date(),
        }).where(eq(planNodes.id, closedNode.id))
      }
      break
    }
    case 'reopened': {
      // Merge links to preserve user-added entries
      const [reopenedNode] = await db.select({ id: planNodes.id, links: planNodes.links })
        .from(planNodes)
        .where(and(eq(planNodes.projectId, projectId), eq(planNodes.githubIssueNumber, issueNumber)))
        .limit(1)
      if (reopenedNode) {
        const existingLinks = (reopenedNode.links ?? []) as Array<{ id: string; type: string; url: string; title: string; state?: string; number?: number; targetId?: string }>
        const ghLink = { id: `gh-${issueNumber}`, type: 'github_issue', url: issueUrl, title: issueTitle, state: 'open', number: issueNumber }
        const mergedLinks = [...existingLinks.filter((l) => l.id !== ghLink.id), ghLink]
        await db.update(planNodes).set({
          status: 'planned',
          links: mergedLinks,
          updatedAt: new Date(),
        }).where(eq(planNodes.id, reopenedNode.id))
      }
      break
    }
    case 'edited': {
      await db.update(planNodes).set({
        title: issueTitle,
        description: issueBody,
        updatedAt: new Date(),
      }).where(and(
        eq(planNodes.projectId, projectId),
        eq(planNodes.githubIssueNumber, issueNumber)
      ))
      break
    }
    default:
      // labeled/unlabeled etc. — skip for initial implementation
      break
  }
}

/**
 * Handle `issue_comment` webhook events.
 * Routes @astro mentions to the agent chat and posts the response back.
 */
export async function handleIssueCommentEvent(
  payload: Record<string, unknown>,
  config: GitHubChannelConfig,
  channelRouter: ChannelRouter
): Promise<void> {
  const action = payload.action as string
  if (action !== 'created') return

  const comment = payload.comment as Record<string, unknown> | undefined
  const issue = payload.issue as Record<string, unknown> | undefined
  const repo = payload.repository as Record<string, unknown> | undefined

  if (!comment || !issue || !repo) return

  const repoFullName = repo.full_name as string
  const projectId = config.repoMappings[repoFullName]
    ?? await lookupGitHubProject(repoFullName)
  if (!projectId) return

  const commentBody = comment.body as string
  if (!commentBody || !commentBody.toLowerCase().includes('@astro')) return

  const sender = comment.user as Record<string, unknown> | undefined
  const issueNumber = issue.number as number
  const commentId = comment.id as number
  const [owner, repoName] = repoFullName.split('/')

  console.log(`[github-channel] @astro mention in issue #${issueNumber} comment by ${sender?.login}`)

  const message: InboundMessage = {
    sourceMessageId: String(commentId),
    channel: 'github',
    text: commentBody,
    sender: {
      id: String(sender?.id ?? 'unknown'),
      name: (sender?.login as string) ?? 'unknown',
      avatarUrl: sender?.avatar_url as string | undefined,
    },
    conversationRef: {
      channelId: repoFullName,
      threadId: String(issueNumber),
      metadata: { owner, repo: repoName, issueNumber },
    },
    projectId,
  }

  const response = await channelRouter.routeMessage(message)

  await postGitHubComment(
    config.authToken,
    owner,
    repoName,
    issueNumber,
    response.text
  )
}

/**
 * Extract PR metadata for storage on plan nodes.
 */
function extractPrData(pr: Record<string, unknown>): {
  title: string
  branch: string
  diffStats: { additions: number; deletions: number; changedFiles: number }
  ciStatus: string
  reviewStatus: string
  reviewers: string[]
  mergedAt: string | null
  closedAt: string | null
} {
  const head = pr.head as Record<string, unknown> | undefined
  const requestedReviewers = (pr.requested_reviewers as Array<Record<string, unknown>>) || []

  let reviewStatus = 'pending'
  if (pr.merged) reviewStatus = 'merged'
  else if (pr.state === 'closed') reviewStatus = 'closed'
  else if (pr.draft) reviewStatus = 'draft'

  return {
    title: (pr.title as string) || '',
    branch: (head?.ref as string) || '',
    diffStats: {
      additions: (pr.additions as number) || 0,
      deletions: (pr.deletions as number) || 0,
      changedFiles: (pr.changed_files as number) || 0,
    },
    ciStatus: 'pending', // Will be updated by check_run events
    reviewStatus,
    reviewers: requestedReviewers.map((r) => (r.login as string) || '').filter(Boolean),
    mergedAt: (pr.merged_at as string | null) ?? null,
    closedAt: (pr.closed_at as string | null) ?? null,
  }
}

/**
 * Find the plan node linked to a PR by branch name or PR number.
 */
async function findLinkedNode(projectId: string, prNumber: number, branchName?: string) {
  // First try by prNumber
  const [byPr] = await db.select({
    id: planNodes.id,
    clientId: planNodes.clientId,
    githubPrData: planNodes.githubPrData,
  })
    .from(planNodes)
    .where(and(
      eq(planNodes.projectId, projectId),
      eq(planNodes.prNumber, prNumber)
    ))
    .limit(1)

  if (byPr) return byPr

  // Fallback: try by branch name (astro/<nodeClientId>)
  if (branchName) {
    const nodeClientId = extractNodeIdFromBranch(branchName)
    if (nodeClientId) {
      const [byBranch] = await db.select({
        id: planNodes.id,
        clientId: planNodes.clientId,
        githubPrData: planNodes.githubPrData,
      })
        .from(planNodes)
        .where(and(
          eq(planNodes.projectId, projectId),
          eq(planNodes.clientId, nodeClientId)
        ))
        .limit(1)

      if (byBranch) return byBranch
    }
  }

  return null
}

/**
 * Handle `pull_request` webhook events.
 * Enhanced to include diff stats, review status, and CI status in the webhook payload.
 * Stores PR metadata on the linked plan node (githubPrData JSON field).
 */
export async function handlePullRequestEvent(
  payload: Record<string, unknown>,
  config: GitHubChannelConfig
): Promise<void> {
  const action = payload.action as string
  const pr = payload.pull_request as Record<string, unknown> | undefined
  const repo = payload.repository as Record<string, unknown> | undefined
  const repoFullName = repo?.full_name as string | undefined

  if (!pr || !repoFullName) return

  const projectId = config.repoMappings[repoFullName]
    ?? await lookupGitHubProject(repoFullName)
  if (!projectId) return

  const prNumber = pr.number as number
  const prTitle = pr.title as string
  const headRef = (pr.head as Record<string, unknown>)?.ref as string | undefined
  const prData = extractPrData(pr)

  // Update githubPrData on the linked plan node for all PR actions
  const linkedNode = await findLinkedNode(projectId, prNumber, headRef)
  if (linkedNode) {
    // Preserve existing ciStatus if we already have it
    const existingPrData = linkedNode.githubPrData as Record<string, unknown> | null
    const ciStatus = existingPrData?.ciStatus as string || prData.ciStatus

    await db.update(planNodes).set({
      githubPrData: { ...prData, ciStatus },
      updatedAt: new Date(),
    }).where(eq(planNodes.id, linkedNode.id))

    console.log(`[github-channel] Updated githubPrData on node ${linkedNode.clientId} for PR #${prNumber}`)
  }

  switch (action) {
    case 'opened':
      console.log(`[github-channel] PR #${prNumber} opened in ${repoFullName}: "${prTitle}" (${prData.diffStats.changedFiles} files, +${prData.diffStats.additions}/-${prData.diffStats.deletions}) → project ${projectId}`)
      break
    case 'synchronize':
      console.log(`[github-channel] PR #${prNumber} synchronized in ${repoFullName}: "${prTitle}" (${prData.diffStats.changedFiles} files, +${prData.diffStats.additions}/-${prData.diffStats.deletions})`)
      break
    case 'closed': {
      const merged = pr.merged as boolean
      const mergedSha = pr.merge_commit_sha as string | undefined
      if (merged) {
        console.log(`[github-channel] PR #${prNumber} merged in ${repoFullName}: "${prTitle}" → task completion for project ${projectId}`)

        // Emit merge queue succeeded event for astro-managed PRs
        const nodeId = extractNodeIdFromBranch(headRef)
        if (nodeId) {
          await astroEventTransport.emitEvent({
            type: 'merge_queue.succeeded',
            nodeId,
            projectId,
            prNumber,
            branchName: headRef || '',
            mergedSha,
            timestamp: new Date(),
          })
        }
      } else {
        console.log(`[github-channel] PR #${prNumber} closed (not merged) in ${repoFullName}: "${prTitle}"`)
      }
      break
    }
    case 'dequeued': {
      // PR removed from merge queue
      console.log(`[github-channel] PR #${prNumber} dequeued from merge queue in ${repoFullName}: "${prTitle}"`)
      const nodeId = extractNodeIdFromBranch(headRef)
      if (nodeId) {
        const reason = (payload.reason as string) || 'removed'
        await astroEventTransport.emitEvent({
          type: 'merge_queue.failed',
          nodeId,
          projectId,
          prNumber,
          reason: mapDequeueReason(reason),
          branchName: headRef || '',
          timestamp: new Date(),
        })
      }
      break
    }
    case 'review_requested':
      console.log(`[github-channel] PR #${prNumber} review requested in ${repoFullName}: reviewers=[${prData.reviewers.join(', ')}]`)
      break
    default:
      console.log(`[github-channel] PR event "${action}" for #${prNumber} in ${repoFullName}`)
  }
}

/**
 * Handle `merge_group` webhook events.
 * Fired when GitHub creates or destroys a merge group for the merge queue.
 */
export async function handleMergeGroupEvent(
  payload: Record<string, unknown>,
  config: GitHubChannelConfig
): Promise<void> {
  const action = payload.action as string
  const mergeGroup = payload.merge_group as Record<string, unknown> | undefined
  const repo = payload.repository as Record<string, unknown> | undefined
  const repoFullName = repo?.full_name as string | undefined

  if (!mergeGroup || !repoFullName) return

  const projectId = config.repoMappings[repoFullName]
    ?? await lookupGitHubProject(repoFullName)
  if (!projectId) return

  const headRef = mergeGroup.head_ref as string | undefined

  switch (action) {
    case 'checks_requested':
      console.log(`[github-channel] Merge group checks requested in ${repoFullName} for ref ${headRef}`)
      // The merge queue is testing this group — individual PR status updates
      // are tracked via PR events, not here
      break
    case 'destroyed': {
      // Merge group was destroyed (failed checks, conflicts, or manual removal)
      const reason = (mergeGroup.reason as string) || 'unknown'
      console.log(`[github-channel] Merge group destroyed in ${repoFullName}: ${reason}`)
      // Individual PR dequeue events handle node status updates
      break
    }
    default:
      console.log(`[github-channel] Merge group event "${action}" in ${repoFullName}`)
  }
}

/**
 * Extract nodeId from an Astro branch name (astro/<nodeId>).
 */
function extractNodeIdFromBranch(branchName?: string): string | undefined {
  if (!branchName) return undefined
  const match = branchName.match(/^astro\/(.+)$/)
  return match?.[1]
}

/**
 * Map GitHub dequeue reason to our internal reason type.
 */
function mapDequeueReason(reason: string): 'conflicts' | 'ci_failure' | 'removed' | 'unknown' {
  if (reason.includes('conflict')) return 'conflicts'
  if (reason.includes('ci') || reason.includes('check') || reason.includes('fail')) return 'ci_failure'
  if (reason.includes('remov') || reason.includes('dequeue')) return 'removed'
  return 'unknown'
}

/**
 * Handle `push` webhook events.
 */
export async function handlePushEvent(
  payload: Record<string, unknown>,
  config: GitHubChannelConfig
): Promise<void> {
  const repo = payload.repository as Record<string, unknown> | undefined
  const repoFullName = repo?.full_name as string | undefined

  if (!repoFullName) return

  const projectId = config.repoMappings[repoFullName]
    ?? await lookupGitHubProject(repoFullName)
  if (!projectId) return

  const ref = payload.ref as string
  const commits = payload.commits as unknown[] | undefined
  const commitCount = commits?.length ?? 0

  console.log(`[github-channel] Push to ${ref} in ${repoFullName}: ${commitCount} commit(s) → auto-verification signal for project ${projectId}`)
}

/**
 * Handle `check_run` webhook events.
 * Updates CI status on linked plan nodes in real-time.
 */
export async function handleCheckRunEvent(
  payload: Record<string, unknown>,
  config: GitHubChannelConfig
): Promise<void> {
  const action = payload.action as string
  const checkRun = payload.check_run as Record<string, unknown> | undefined
  const repo = payload.repository as Record<string, unknown> | undefined
  const repoFullName = repo?.full_name as string | undefined

  if (!checkRun || !repoFullName) return

  const projectId = config.repoMappings[repoFullName]
    ?? await lookupGitHubProject(repoFullName)
  if (!projectId) return

  const checkName = checkRun.name as string
  const status = checkRun.status as string
  const conclusion = checkRun.conclusion as string | undefined

  console.log(`[github-channel] Check run "${checkName}" ${action} (status: ${status}, conclusion: ${conclusion ?? 'pending'}) in ${repoFullName} → project ${projectId}`)

  // Find linked node(s) via the check run's associated pull requests
  const pullRequests = (checkRun.pull_requests as Array<Record<string, unknown>>) || []

  for (const prRef of pullRequests) {
    const prNumber = prRef.number as number
    if (!prNumber) continue

    const headRef = (prRef.head as Record<string, unknown> | undefined)?.ref as string | undefined
    const linkedNode = await findLinkedNode(projectId, prNumber, headRef)
    if (!linkedNode) continue

    // Determine CI status from check run conclusion
    let ciStatus = 'pending'
    if (status === 'completed') {
      if (conclusion === 'success' || conclusion === 'skipped' || conclusion === 'neutral') {
        ciStatus = 'success'
      } else if (conclusion === 'failure' || conclusion === 'timed_out') {
        ciStatus = 'failure'
      } else if (conclusion === 'cancelled') {
        ciStatus = 'cancelled'
      } else {
        ciStatus = conclusion || 'unknown'
      }
    } else if (status === 'in_progress') {
      ciStatus = 'in_progress'
    }

    // Update githubPrData.ciStatus on the linked node
    const existingPrData = linkedNode.githubPrData as Record<string, unknown> | null
    if (existingPrData) {
      await db.update(planNodes).set({
        githubPrData: { ...existingPrData, ciStatus },
        updatedAt: new Date(),
      }).where(eq(planNodes.id, linkedNode.id))

      console.log(`[github-channel] Updated CI status to "${ciStatus}" on node ${linkedNode.clientId} (check: ${checkName})`)
    }
  }
}

/**
 * Handle `pull_request_review` webhook events.
 * Updates review status on linked plan nodes in real-time.
 */
export async function handlePullRequestReviewEvent(
  payload: Record<string, unknown>,
  config: GitHubChannelConfig
): Promise<void> {
  const action = payload.action as string
  const review = payload.review as Record<string, unknown> | undefined
  const pr = payload.pull_request as Record<string, unknown> | undefined
  const repo = payload.repository as Record<string, unknown> | undefined
  const repoFullName = repo?.full_name as string | undefined

  if (!review || !pr || !repoFullName) return

  const projectId = config.repoMappings[repoFullName]
    ?? await lookupGitHubProject(repoFullName)
  if (!projectId) return

  const prNumber = pr.number as number
  const headRef = (pr.head as Record<string, unknown>)?.ref as string | undefined
  const reviewState = review.state as string // 'approved', 'changes_requested', 'commented', 'dismissed'
  const reviewer = (review.user as Record<string, unknown>)?.login as string | undefined

  console.log(`[github-channel] PR #${prNumber} review "${reviewState}" by ${reviewer ?? 'unknown'} (action: ${action}) in ${repoFullName}`)

  if (action !== 'submitted' && action !== 'dismissed') return

  const linkedNode = await findLinkedNode(projectId, prNumber, headRef)
  if (!linkedNode) return

  const existingPrData = linkedNode.githubPrData as Record<string, unknown> | null
  if (!existingPrData) return

  // Determine overall review status
  let reviewStatus = 'pending'
  if (reviewState === 'approved') {
    reviewStatus = 'approved'
  } else if (reviewState === 'changes_requested') {
    reviewStatus = 'changes_requested'
  } else if (reviewState === 'commented') {
    reviewStatus = 'commented'
  } else if (reviewState === 'dismissed') {
    reviewStatus = 'pending' // Dismissed review reverts to pending
  }

  await db.update(planNodes).set({
    githubPrData: { ...existingPrData, reviewStatus },
    updatedAt: new Date(),
  }).where(eq(planNodes.id, linkedNode.id))

  console.log(`[github-channel] Updated review status to "${reviewStatus}" on node ${linkedNode.clientId} (reviewer: ${reviewer})`)
}
