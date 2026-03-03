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
import { githubCommentBus } from '../../lib/github-comment-bus.js'
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

  const sender = comment.user as Record<string, unknown> | undefined
  const issueNumber = issue.number as number
  const commentId = comment.id as number
  const [owner, repoName] = repoFullName.split('/')

  // Broadcast the new comment to connected SSE clients for real-time updates
  githubCommentBus.emit({
    owner,
    repo: repoName,
    number: issueNumber,
    comment: {
      id: commentId,
      nodeId: (comment.node_id as string) ?? '',
      body: (comment.body as string) ?? '',
      htmlUrl: (comment.html_url as string) ?? '',
      createdAt: (comment.created_at as string) ?? '',
      updatedAt: (comment.updated_at as string) ?? '',
      user: {
        login: (sender?.login as string) ?? '',
        avatarUrl: (sender?.avatar_url as string) ?? '',
        id: (sender?.id as number) ?? 0,
      },
    },
  })

  // Only process @astro mentions for AI chat
  const commentBody = comment.body as string
  if (!commentBody || !commentBody.toLowerCase().includes('@astro')) return

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
 * Handle `pull_request` webhook events.
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

  switch (action) {
    case 'opened':
      console.log(`[github-channel] PR #${prNumber} opened in ${repoFullName}: "${prTitle}" → plan task creation for project ${projectId}`)
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
  const conclusion = checkRun.conclusion as string | undefined

  console.log(`[github-channel] Check run "${checkName}" ${action} (conclusion: ${conclusion ?? 'pending'}) in ${repoFullName} → verification status for project ${projectId}`)
}
