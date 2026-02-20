/**
 * GitHub Webhook Event Handlers
 *
 * Dispatches incoming GitHub webhook events to appropriate handlers.
 * Chat-like interactions (@astro mentions) are routed through the channel router.
 */

import type { GitHubChannelConfig, InboundMessage, ChannelRouter } from '../../lib/channel/channel-types.js'
import { postGitHubComment } from './github-api.js'

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
  if (!projectId) return

  const issueNumber = issue.number as number
  const issueTitle = issue.title as string

  switch (action) {
    case 'opened':
      console.log(`[github-channel] Issue #${issueNumber} opened in ${repoFullName}: "${issueTitle}" → plan task creation for project ${projectId}`)
      break
    case 'closed':
      console.log(`[github-channel] Issue #${issueNumber} closed in ${repoFullName}: "${issueTitle}" → status update for project ${projectId}`)
      break
    case 'labeled': {
      const label = payload.label as Record<string, unknown> | undefined
      console.log(`[github-channel] Issue #${issueNumber} labeled "${label?.name}" in ${repoFullName} → label sync for project ${projectId}`)
      break
    }
    default:
      console.log(`[github-channel] Issue event "${action}" for #${issueNumber} in ${repoFullName}`)
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
  if (!projectId) return

  const prNumber = pr.number as number
  const prTitle = pr.title as string

  switch (action) {
    case 'opened':
      console.log(`[github-channel] PR #${prNumber} opened in ${repoFullName}: "${prTitle}" → plan task creation for project ${projectId}`)
      break
    case 'closed': {
      const merged = pr.merged as boolean
      if (merged) {
        console.log(`[github-channel] PR #${prNumber} merged in ${repoFullName}: "${prTitle}" → task completion for project ${projectId}`)
      } else {
        console.log(`[github-channel] PR #${prNumber} closed (not merged) in ${repoFullName}: "${prTitle}"`)
      }
      break
    }
    default:
      console.log(`[github-channel] PR event "${action}" for #${prNumber} in ${repoFullName}`)
  }
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
  if (!projectId) return

  const checkName = checkRun.name as string
  const conclusion = checkRun.conclusion as string | undefined

  console.log(`[github-channel] Check run "${checkName}" ${action} (conclusion: ${conclusion ?? 'pending'}) in ${repoFullName} → verification status for project ${projectId}`)
}
