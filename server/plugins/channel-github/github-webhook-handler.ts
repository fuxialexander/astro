/**
 * GitHub Webhook Event Handlers
 *
 * Dispatches incoming GitHub webhook events to appropriate handlers.
 * Chat-like interactions (@astro mentions) are routed through the channel router.
 *
 * Loop prevention: checks `syncSource` field on plan nodes before processing.
 * If syncSource='sync', the change originated from Astro→GitHub sync and the
 * webhook echo should be skipped to avoid infinite loops.
 */

import type { GitHubChannelConfig, InboundMessage, ChannelRouter } from '../../lib/channel/channel-types.js'
import { postGitHubComment } from './github-api.js'
import { astroEventTransport } from '../../lib/events/astro-event-transport.js'
import { lookupGitHubProject } from '../../lib/github-store.js'
import { githubCommentBus } from '../../lib/github-comment-bus.js'
import { db } from '../../lib/db/index.js'
import { planNodes, projects } from '../../lib/db/schema.js'
import { eq, and } from 'drizzle-orm'
import {
  isSyncEcho,
  githubStateToAstro,
  githubLabelsToPriority,
  resolveGitHubLoginToAstroUser,
} from '../../lib/github-sync-utils.js'
import type { GitHubSyncSettings } from '@astro/core/types'
import { DEFAULT_GITHUB_SYNC_SETTINGS } from '@astro/core/types'

/**
 * Load sync settings for a project, falling back to defaults.
 */
async function loadSyncSettings(projectId: string): Promise<GitHubSyncSettings> {
  try {
    const [project] = await db.select({
      githubSyncSettings: projects.githubSyncSettings,
    }).from(projects).where(eq(projects.id, projectId)).limit(1)

    if (project?.githubSyncSettings) {
      return { ...DEFAULT_GITHUB_SYNC_SETTINGS, ...(project.githubSyncSettings as GitHubSyncSettings) }
    }
  } catch {
    // Fall through to defaults
  }
  return DEFAULT_GITHUB_SYNC_SETTINGS
}

/**
 * Check if a specific field is enabled for sync in the given direction.
 */
function isFieldEnabled(settings: GitHubSyncSettings, field: string, direction: 'github_to_astro' | 'astro_to_github'): boolean {
  if (!settings.enabled) return false
  if (settings.direction !== 'bidirectional' && settings.direction !== direction) return false
  return settings.enabledFields.includes(field)
}

/**
 * Handle `issues` webhook events.
 *
 * Enhanced with:
 * - Loop prevention via syncSource check
 * - Sync tracking (syncSource='github', githubSyncVersion increment)
 * - Label→priority mapping for labeled/unlabeled events
 * - Assignee mapping for assigned/unassigned events
 * - State reason tracking (completed vs not_planned)
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

  // Load per-project sync settings
  const syncSettings = await loadSyncSettings(projectId)

  // If sync is disabled entirely, skip all issue events
  if (!syncSettings.enabled) {
    console.log(`[github-channel] Sync disabled for project ${projectId} — skipping issue event`)
    return
  }

  // If direction is 'astro_to_github' only, skip GitHub→Astro sync
  if (syncSettings.direction === 'astro_to_github') {
    console.log(`[github-channel] Direction is astro_to_github only — skipping GitHub→Astro sync`)
    return
  }

  const issueNumber = issue.number as number
  const issueTitle = issue.title as string
  const issueBody = (issue.body as string) || ''
  const issueUrl = issue.html_url as string
  const issueState = issue.state as string
  const stateReason = issue.state_reason as string | undefined
  const issueLabels = ((issue.labels as Array<Record<string, unknown>>) || []).map(
    (l) => ({ name: l.name as string, color: l.color as string })
  )
  const issueAssignee = issue.assignee as Record<string, unknown> | null

  // ── Loop prevention: check if this change originated from Astro sync ──
  if (action !== 'opened') {
    const [existingNode] = await db.select({
      id: planNodes.id,
      syncSource: planNodes.syncSource,
    })
      .from(planNodes)
      .where(and(
        eq(planNodes.projectId, projectId),
        eq(planNodes.githubIssueNumber, issueNumber)
      ))
      .limit(1)

    if (existingNode && isSyncEcho(existingNode.syncSource)) {
      console.log(
        `[github-channel] Skipping issue #${issueNumber} '${action}' event — ` +
        `syncSource='sync' (echo from Astro→GitHub push)`
      )
      return
    }
  }

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
        // Extract priority from labels if present
        const priority = githubLabelsToPriority(issueLabels)

        // Resolve assignee if present → store in metadata
        let assigneeMetadata: Record<string, unknown> | undefined
        if (issueAssignee) {
          const login = issueAssignee.login as string
          const userId = await resolveGitHubLoginToAstroUser(login)
          if (userId) {
            assigneeMetadata = { githubAssignee: login, assigneeUserId: userId }
          }
        }

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
          syncSource: 'github',
          githubSyncVersion: 1,
          githubSyncedAt: new Date(),
          ...(priority ? { priority } : {}),
          ...(assigneeMetadata ? { metadata: assigneeMetadata } : {}),
          links: [{ id: `gh-${issueNumber}`, type: 'github_issue', url: issueUrl, title: issueTitle, state: 'open', number: issueNumber }],
        })
      }
      break
    }
    case 'closed': {
      if (!isFieldEnabled(syncSettings, 'status', 'github_to_astro')) break
      const astroStatus = githubStateToAstro(issueState, stateReason)

      const [closedNode] = await db.select({
        id: planNodes.id,
        links: planNodes.links,
        githubSyncVersion: planNodes.githubSyncVersion,
      })
        .from(planNodes)
        .where(and(eq(planNodes.projectId, projectId), eq(planNodes.githubIssueNumber, issueNumber)))
        .limit(1)

      if (closedNode) {
        const existingLinks = (closedNode.links ?? []) as Array<{ id: string; type: string; url: string; title: string; state?: string; number?: number; targetId?: string }>
        const ghLink = { id: `gh-${issueNumber}`, type: 'github_issue', url: issueUrl, title: issueTitle, state: 'closed', number: issueNumber }
        const mergedLinks = [...existingLinks.filter((l) => l.id !== ghLink.id), ghLink]
        await db.update(planNodes).set({
          status: astroStatus,
          links: mergedLinks,
          syncSource: 'github',
          githubSyncVersion: (closedNode.githubSyncVersion ?? 0) + 1,
          githubSyncedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(planNodes.id, closedNode.id))
      }
      break
    }
    case 'reopened': {
      if (!isFieldEnabled(syncSettings, 'status', 'github_to_astro')) break
      const [reopenedNode] = await db.select({
        id: planNodes.id,
        links: planNodes.links,
        githubSyncVersion: planNodes.githubSyncVersion,
      })
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
          syncSource: 'github',
          githubSyncVersion: (reopenedNode.githubSyncVersion ?? 0) + 1,
          githubSyncedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(planNodes.id, reopenedNode.id))
      }
      break
    }
    case 'edited': {
      // GitHub owns body/description, shared ownership of title (last-write-wins)
      const titleEnabled = isFieldEnabled(syncSettings, 'title', 'github_to_astro')
      const descEnabled = isFieldEnabled(syncSettings, 'description', 'github_to_astro')
      if (!titleEnabled && !descEnabled) break

      const [editedNode] = await db.select({
        id: planNodes.id,
        githubSyncVersion: planNodes.githubSyncVersion,
      })
        .from(planNodes)
        .where(and(
          eq(planNodes.projectId, projectId),
          eq(planNodes.githubIssueNumber, issueNumber)
        ))
        .limit(1)

      if (editedNode) {
        await db.update(planNodes).set({
          ...(titleEnabled ? { title: issueTitle } : {}),
          ...(descEnabled ? { description: issueBody } : {}),
          syncSource: 'github',
          githubSyncVersion: (editedNode.githubSyncVersion ?? 0) + 1,
          githubSyncedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(planNodes.id, editedNode.id))
      }
      break
    }
    case 'labeled':
    case 'unlabeled': {
      if (!isFieldEnabled(syncSettings, 'priority', 'github_to_astro')) break
      // Sync priority labels from GitHub → Astro
      const priority = githubLabelsToPriority(issueLabels)
      const [labeledNode] = await db.select({
        id: planNodes.id,
        githubSyncVersion: planNodes.githubSyncVersion,
      })
        .from(planNodes)
        .where(and(
          eq(planNodes.projectId, projectId),
          eq(planNodes.githubIssueNumber, issueNumber)
        ))
        .limit(1)

      if (labeledNode) {
        await db.update(planNodes).set({
          ...(priority !== null ? { priority } : {}),
          syncSource: 'github',
          githubSyncVersion: (labeledNode.githubSyncVersion ?? 0) + 1,
          githubSyncedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(planNodes.id, labeledNode.id))
      }
      break
    }
    case 'assigned':
    case 'unassigned': {
      if (!isFieldEnabled(syncSettings, 'assignee', 'github_to_astro')) break
      // Map GitHub assignee → Astro user via githubConnections
      // Store in metadata since there's no dedicated assigneeId column
      let assigneeMetadata: Record<string, unknown> = {}
      if (issueAssignee) {
        const login = issueAssignee.login as string
        const userId = await resolveGitHubLoginToAstroUser(login)
        assigneeMetadata = {
          githubAssignee: login,
          ...(userId ? { assigneeUserId: userId } : {}),
        }
      }

      const [assignedNode] = await db.select({
        id: planNodes.id,
        githubSyncVersion: planNodes.githubSyncVersion,
        metadata: planNodes.metadata,
      })
        .from(planNodes)
        .where(and(
          eq(planNodes.projectId, projectId),
          eq(planNodes.githubIssueNumber, issueNumber)
        ))
        .limit(1)

      if (assignedNode) {
        const existingMetadata = (assignedNode.metadata ?? {}) as Record<string, unknown>
        await db.update(planNodes).set({
          metadata: { ...existingMetadata, ...assigneeMetadata },
          syncSource: 'github',
          githubSyncVersion: (assignedNode.githubSyncVersion ?? 0) + 1,
          githubSyncedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(planNodes.id, assignedNode.id))
      }
      break
    }
    default:
      break
  }
}

/**
 * Maximum number of recent comments stored on a plan node's githubComments field.
 */
const MAX_STORED_COMMENTS = 50

/**
 * Append a comment to the plan node's githubComments JSONB field (last N comments).
 */
async function appendCommentToNode(
  projectId: string,
  issueNumber: number,
  commentData: {
    id: number
    author: { login: string; avatar: string }
    body: string
    createdAt: string
    updatedAt: string
    type: 'issue_comment' | 'review_comment'
    inReplyTo?: number
    path?: string
    line?: number
  }
): Promise<void> {
  const [node] = await db.select({ id: planNodes.id, githubComments: planNodes.githubComments })
    .from(planNodes)
    .where(and(eq(planNodes.projectId, projectId), eq(planNodes.githubIssueNumber, issueNumber)))
    .limit(1)

  if (!node) return

  const existing = (node.githubComments ?? []) as Array<typeof commentData>
  // Deduplicate by comment ID
  const filtered = existing.filter(c => c.id !== commentData.id)
  const updated = [...filtered, commentData].slice(-MAX_STORED_COMMENTS)

  await db.update(planNodes).set({
    githubComments: updated,
    updatedAt: new Date(),
  }).where(eq(planNodes.id, node.id))
}

/**
 * Handle `issue_comment` webhook events.
 * Routes @astro mentions to the agent chat and posts the response back.
 * Stores all new comments on linked plan nodes.
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
  const commentBody = (comment.body as string) ?? ''
  const [owner, repoName] = repoFullName.split('/')

  // Store comment on the linked plan node
  try {
    await appendCommentToNode(projectId, issueNumber, {
      id: commentId,
      author: {
        login: (sender?.login as string) ?? 'unknown',
        avatar: (sender?.avatar_url as string) ?? '',
      },
      body: commentBody,
      createdAt: comment.created_at as string,
      updatedAt: comment.updated_at as string,
      type: 'issue_comment',
    })
  } catch (err) {
    // TODO: implement dead-letter queue for failed webhook DB writes
    console.error(`[github-channel] Failed to store issue comment:`, {
      event: 'issue_comment',
      issueNumber,
      commentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Broadcast the new comment to connected SSE clients for real-time updates
  githubCommentBus.emit({
    owner,
    repo: repoName,
    number: issueNumber,
    comment: {
      id: commentId,
      nodeId: (comment.node_id as string) ?? '',
      body: commentBody,
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

  // Only route @astro mentions to the channel router
  if (!commentBody.toLowerCase().includes('@astro')) return

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
    ciStatus: 'pending',
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
 * Handle `pull_request_review_comment` webhook events.
 * Stores inline review comments on linked plan nodes.
 */
export async function handlePRReviewCommentEvent(
  payload: Record<string, unknown>,
  config: GitHubChannelConfig
): Promise<void> {
  const action = payload.action as string
  const comment = payload.comment as Record<string, unknown> | undefined
  const pr = payload.pull_request as Record<string, unknown> | undefined
  const repo = payload.repository as Record<string, unknown> | undefined

  if (!comment || !pr || !repo) return

  const repoFullName = repo.full_name as string
  const projectId = config.repoMappings[repoFullName]
    ?? await lookupGitHubProject(repoFullName)
  if (!projectId) return

  const sender = comment.user as Record<string, unknown> | undefined
  const prNumber = pr.number as number
  const commentId = comment.id as number

  console.log(`[github-channel] PR review comment ${action} on PR #${prNumber} by ${sender?.login}`)

  try {
    if (action === 'created' || action === 'edited') {
      await appendCommentToNode(projectId, prNumber, {
        id: commentId,
        author: {
          login: (sender?.login as string) ?? 'unknown',
          avatar: (sender?.avatar_url as string) ?? '',
        },
        body: (comment.body as string) ?? '',
        createdAt: comment.created_at as string,
        updatedAt: comment.updated_at as string,
        type: 'review_comment',
        inReplyTo: (comment.in_reply_to_id as number) ?? undefined,
        path: (comment.path as string) ?? undefined,
        line: (comment.line as number) ?? (comment.original_line as number) ?? undefined,
      })
    } else if (action === 'deleted') {
      // Remove the deleted comment from the plan node's stored comments
      const [node] = await db.select({ id: planNodes.id, githubComments: planNodes.githubComments })
        .from(planNodes)
        .where(and(eq(planNodes.projectId, projectId), eq(planNodes.githubIssueNumber, prNumber)))
        .limit(1)

      if (node) {
        const existing = (node.githubComments ?? []) as Array<{ id: number }>
        const filtered = existing.filter(c => c.id !== commentId)
        if (filtered.length !== existing.length) {
          await db.update(planNodes).set({
            githubComments: filtered,
            updatedAt: new Date(),
          }).where(eq(planNodes.id, node.id))
        }
      }
    }
  } catch (err) {
    console.error(`[github-channel] Failed to handle PR review comment (${action}):`, {
      event: 'pull_request_review_comment',
      prNumber,
      commentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
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

  const prBody = (pr.body as string) || ''
  const prUrl = pr.html_url as string

  switch (action) {
    case 'opened': {
      console.log(`[github-channel] PR #${prNumber} opened in ${repoFullName}: "${prTitle}" → auto-linking for project ${projectId}`)

      // Strategy 1: Match head branch name to node ID (astro/<nodeId> or task-<nodeId>/*)
      const nodeIdFromBranch = extractNodeIdFromBranch(headRef)
      if (nodeIdFromBranch) {
        const [branchNode] = await db.select({ clientId: planNodes.clientId })
          .from(planNodes)
          .where(and(eq(planNodes.clientId, nodeIdFromBranch), eq(planNodes.projectId, projectId)))
          .limit(1)

        if (branchNode) {
          console.log(`[github-channel] Auto-linking PR #${prNumber} to node '${nodeIdFromBranch}' via branch name`)
          await astroEventTransport.emitEvent({
            type: 'pr.linked',
            nodeId: nodeIdFromBranch,
            projectId,
            prNumber,
            prUrl,
            branchName: headRef || '',
            linkSource: 'auto-branch',
            timestamp: new Date(),
          })
          break
        }
      }

      // Strategy 2: Match astro-task:{nodeId} in PR body
      const bodyNodeIds = extractNodeIdsFromBody(prBody)
      for (const bodyNodeId of bodyNodeIds) {
        const [bodyNode] = await db.select({ clientId: planNodes.clientId })
          .from(planNodes)
          .where(and(eq(planNodes.clientId, bodyNodeId), eq(planNodes.projectId, projectId)))
          .limit(1)

        if (bodyNode) {
          console.log(`[github-channel] Auto-linking PR #${prNumber} to node '${bodyNodeId}' via body reference`)
          await astroEventTransport.emitEvent({
            type: 'pr.linked',
            nodeId: bodyNodeId,
            projectId,
            prNumber,
            prUrl,
            branchName: headRef || '',
            linkSource: 'auto-body-reference',
            timestamp: new Date(),
          })
        }
      }
      break
    }
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
 * Extract nodeId from an Astro branch name.
 * Supports patterns:
 *   - astro/<nodeId>
 *   - task-<nodeId>/*
 *   - astro-task/<nodeId>
 */
function extractNodeIdFromBranch(branchName?: string): string | undefined {
  if (!branchName) return undefined

  // Pattern 1: astro/<nodeId> (primary pattern from agent runner)
  const astroMatch = branchName.match(/^astro\/(.+)$/)
  if (astroMatch) return astroMatch[1]

  // Pattern 2: task-<nodeId> or task-<nodeId>/<anything>
  const taskMatch = branchName.match(/^task-([^/]+)(?:\/.*)?$/)
  if (taskMatch) return taskMatch[1]

  // Pattern 3: astro-task/<nodeId>
  const astroTaskMatch = branchName.match(/^astro-task\/(.+)$/)
  if (astroTaskMatch) return astroTaskMatch[1]

  return undefined
}

/**
 * Extract node IDs from PR body using astro-task:{nodeId} references.
 * Supports multiple references in a single body.
 */
function extractNodeIdsFromBody(body: string): string[] {
  if (!body) return []
  const matches = body.matchAll(/astro-task:([a-zA-Z0-9_-]+)/g)
  return [...matches].map((m) => m[1])
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
 * Extracts node ID from branch name patterns and auto-links branch → plan node.
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

  // Extract branch name from refs/heads/<branchName>
  const branchName = ref.replace('refs/heads/', '')
  const nodeId = extractNodeIdFromBranch(branchName)

  if (nodeId) {
    // Check if this node exists and doesn't already have branchName set
    const [existingNode] = await db.select({
      clientId: planNodes.clientId,
      branchName: planNodes.branchName,
    })
      .from(planNodes)
      .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
      .limit(1)

    if (existingNode && !existingNode.branchName) {
      console.log(`[github-channel] Auto-linking branch '${branchName}' to node '${nodeId}' via push event`)
      await astroEventTransport.emitEvent({
        type: 'pr.linked',
        nodeId,
        projectId,
        branchName,
        linkSource: 'auto-branch',
        timestamp: new Date(),
      })
    }
  }
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

    const existingPrData = linkedNode.githubPrData as Record<string, unknown> | null
    if (!existingPrData) continue

    try {
      // Maintain array of check runs for proper aggregation
      const existingCheckRuns = (existingPrData.checkRuns as Array<{ name: string; status: string; conclusion: string | null }>) ?? []

      // Update or add this check run
      const updatedCheckRuns = existingCheckRuns.filter(cr => cr.name !== checkName)
      updatedCheckRuns.push({ name: checkName, status, conclusion: conclusion ?? null })

      // Compute overall CI status from all check runs
      const allCompleted = updatedCheckRuns.every(cr => cr.status === 'completed')
      const anyFailed = updatedCheckRuns.some(cr =>
        cr.status === 'completed' && (cr.conclusion === 'failure' || cr.conclusion === 'timed_out')
      )
      const allSuccess = allCompleted && updatedCheckRuns.every(cr =>
        cr.conclusion === 'success' || cr.conclusion === 'skipped' || cr.conclusion === 'neutral'
      )

      let ciStatus = 'pending'
      if (anyFailed) ciStatus = 'failure'
      else if (allSuccess) ciStatus = 'success'
      else if (allCompleted) ciStatus = 'failure' // completed but not all success
      // else remains 'pending'

      await db.update(planNodes).set({
        githubPrData: { ...existingPrData, checkRuns: updatedCheckRuns, ciStatus },
        updatedAt: new Date(),
      }).where(eq(planNodes.id, linkedNode.id))

      console.log(`[github-channel] Updated CI status to "${ciStatus}" on node ${linkedNode.clientId} (check: ${checkName}, ${updatedCheckRuns.length} total)`)
    } catch (err) {
      // TODO: implement dead-letter queue for failed webhook DB writes
      console.error(`[github-channel] Failed to update CI status on node ${linkedNode.clientId}:`, {
        event: 'check_run',
        prNumber,
        checkName,
        error: err instanceof Error ? err.message : String(err),
      })
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

  try {
    // Maintain per-reviewer state map for proper aggregation
    const reviewerStates = (existingPrData.reviewerStates as Record<string, string>) ?? {}

    // Update the current reviewer's state
    if (reviewer) {
      if (reviewState === 'dismissed') {
        delete reviewerStates[reviewer]
      } else {
        reviewerStates[reviewer] = reviewState
      }
    }

    // Compute overall review status from all reviewers
    const states = Object.values(reviewerStates)
    let reviewStatus = 'pending'
    if (states.some(s => s === 'changes_requested')) {
      reviewStatus = 'changes_requested'
    } else if (states.length > 0 && states.every(s => s === 'approved')) {
      reviewStatus = 'approved'
    } else if (states.some(s => s === 'approved')) {
      reviewStatus = 'partially_approved'
    } else if (states.some(s => s === 'commented')) {
      reviewStatus = 'commented'
    }

    await db.update(planNodes).set({
      githubPrData: { ...existingPrData, reviewerStates, reviewStatus },
      updatedAt: new Date(),
    }).where(eq(planNodes.id, linkedNode.id))

    console.log(`[github-channel] Updated review status to "${reviewStatus}" on node ${linkedNode.clientId} (reviewer: ${reviewer}, ${states.length} total)`)
  } catch (err) {
    // TODO: implement dead-letter queue for failed webhook DB writes
    console.error(`[github-channel] Failed to update review status on node ${linkedNode.clientId}:`, {
      event: 'pull_request_review',
      prNumber,
      reviewer,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
