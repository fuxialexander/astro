/**
 * Linear Webhook Event Handlers
 *
 * Dispatches incoming Linear webhook events to appropriate handlers.
 * Chat-like interactions (@astro mentions in comments) are routed through the channel router.
 */

import type { LinearChannelConfig, InboundMessage, ChannelRouter } from '../../lib/channel/channel-types.js'
import { postLinearComment } from './linear-api.js'

/**
 * Handle Linear issue events (create, update, remove).
 */
export async function handleLinearIssueEvent(
  payload: Record<string, unknown>,
  config: LinearChannelConfig
): Promise<void> {
  const action = payload.action as string
  const data = payload.data as Record<string, unknown> | undefined

  if (!data) return

  const issueId = data.id as string
  const issueTitle = data.title as string | undefined
  const teamId = data.teamId as string | undefined

  if (!teamId) return

  const projectId = config.teamMappings[teamId]
  if (!projectId) return

  switch (action) {
    case 'create':
      console.log(`[linear-channel] Issue created "${issueTitle}" (${issueId}) in team ${teamId} → optional plan task creation for project ${projectId}`)
      break
    case 'update': {
      const updatedFrom = payload.updatedFrom as Record<string, unknown> | undefined
      const changedFields = updatedFrom ? Object.keys(updatedFrom) : []
      console.log(`[linear-channel] Issue "${issueTitle}" (${issueId}) updated [${changedFields.join(', ')}] → status/assignee/priority sync for project ${projectId}`)
      break
    }
    case 'remove':
      console.log(`[linear-channel] Issue "${issueTitle}" (${issueId}) removed → mark as pruned for project ${projectId}`)
      break
    default:
      console.log(`[linear-channel] Issue event "${action}" for ${issueId} in team ${teamId}`)
  }
}

/**
 * Handle Linear comment events.
 * Routes @astro mentions to the agent chat and posts the response back.
 */
export async function handleLinearCommentEvent(
  payload: Record<string, unknown>,
  config: LinearChannelConfig,
  channelRouter: ChannelRouter
): Promise<void> {
  const action = payload.action as string
  if (action !== 'create') return

  const data = payload.data as Record<string, unknown> | undefined
  if (!data) return

  const commentBody = data.body as string | undefined
  if (!commentBody || !commentBody.toLowerCase().includes('@astro')) return

  const commentId = data.id as string
  const issueId = data.issueId as string | undefined
  const user = data.user as Record<string, unknown> | undefined

  if (!issueId) return

  // Resolve project ID from the issue's team
  // Linear webhook payloads for comments include issue data
  const issue = payload.data as Record<string, unknown>
  const teamId = (issue?.teamId as string) ?? ''

  const projectId = config.teamMappings[teamId]
  if (!projectId) {
    // Try to find project from any mapping if team can't be resolved
    const firstProjectId = Object.values(config.teamMappings)[0]
    if (!firstProjectId) return
    console.log(`[linear-channel] Could not resolve team for comment, using first mapped project`)
  }

  const resolvedProjectId = projectId ?? Object.values(config.teamMappings)[0]
  if (!resolvedProjectId) return

  console.log(`[linear-channel] @astro mention in comment on issue ${issueId} by ${user?.name}`)

  const message: InboundMessage = {
    sourceMessageId: commentId,
    channel: 'linear',
    text: commentBody,
    sender: {
      id: (user?.id as string) ?? 'unknown',
      name: (user?.name as string) ?? 'unknown',
    },
    conversationRef: {
      channelId: teamId,
      threadId: issueId,
      metadata: { issueId },
    },
    projectId: resolvedProjectId,
  }

  const response = await channelRouter.routeMessage(message)

  await postLinearComment(config.apiToken, issueId, response.text)
}

/**
 * Handle Linear project events (create, update, remove).
 */
export async function handleLinearProjectEvent(
  payload: Record<string, unknown>,
  config: LinearChannelConfig
): Promise<void> {
  const action = payload.action as string
  const data = payload.data as Record<string, unknown> | undefined

  if (!data) return

  const projectName = data.name as string | undefined
  const projectId = data.id as string

  // Linear projects may span teams — log for awareness
  console.log(`[linear-channel] Project "${projectName}" (${projectId}) ${action} → project status sync`)

  // Check if any mapped teams are affected
  for (const [teamId, astroProjectId] of Object.entries(config.teamMappings)) {
    console.log(`[linear-channel] Checking team ${teamId} (Astro project ${astroProjectId}) for project sync`)
  }
}
