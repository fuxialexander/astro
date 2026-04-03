/**
 * Channel Notification Hook
 *
 * Bridges AstroEvent → ChannelNotification.
 * Listens to task lifecycle events and fans them out to all
 * registered channel notification senders via the channel router.
 *
 * Notifications are enriched with execution results, summaries,
 * cost/duration metrics, and PR links when available.
 */

import type { EventHook, TaskCompletedEvent } from '../types.js'
import { channelRouter } from '../../channel/channel-router.js'
import type { ChannelNotification, NotificationType } from '../../channel/channel-types.js'
import { db } from '../../db/index.js'
import { planNodes, projects } from '../../db/schema.js'
import { eq } from 'drizzle-orm'

const BASE_URL = process.env.ASTRO_BASE_URL || 'http://localhost:5173'

/**
 * Build a rich summary for a completed task.
 * Includes: executive summary / key findings, PR link, cost, duration.
 */
function buildCompletedSummary(event: TaskCompletedEvent): string {
  const taskTitle = event.node?.title || 'Unknown task'
  const projectName = event.project?.name
  const result = event.result
  const lines: string[] = []

  // Header with project context
  if (projectName) {
    lines.push(`**${taskTitle}** (${projectName})`)
  } else {
    lines.push(`**${taskTitle}**`)
  }
  lines.push('')

  // Executive summary from structured result
  const summary = result?.summary
  if (summary?.executiveSummary) {
    lines.push(summary.executiveSummary)
    lines.push('')
  } else if (summary?.workCompleted) {
    lines.push(summary.workCompleted)
    lines.push('')
  }

  // Key findings (up to 5)
  if (summary?.keyFindings && summary.keyFindings.length > 0) {
    for (const finding of summary.keyFindings.slice(0, 5)) {
      lines.push(`- ${finding}`)
    }
    lines.push('')
  }

  // PR link
  const prUrl = result?.prUrl || summary?.prUrl
  const prNumber = result?.prNumber || summary?.prNumber
  if (prUrl) {
    lines.push(`**PR:** [#${prNumber || '?'}](${prUrl})`)
  } else if (result?.branchName) {
    lines.push(`**Branch:** \`${result.branchName}\``)
  }

  // Metrics line (cost + duration + model)
  const metrics = result?.metrics
  if (metrics) {
    const parts: string[] = []
    if (metrics.durationMs) {
      const mins = Math.round(metrics.durationMs / 60000)
      parts.push(mins > 0 ? `${mins}m` : `${Math.round(metrics.durationMs / 1000)}s`)
    }
    if (metrics.totalCost) {
      parts.push(`$${metrics.totalCost.toFixed(2)}`)
    }
    if (metrics.numTurns) {
      parts.push(`${metrics.numTurns} turns`)
    }
    if (parts.length > 0) {
      lines.push(parts.join(' · '))
    }
  }

  return lines.filter(l => l !== undefined).join('\n').trim() || `Task completed: ${taskTitle}`
}

/**
 * Build a summary for a failed task.
 */
function buildFailedSummary(event: { node?: { title?: string }; project?: { name?: string }; error: string }): string {
  const taskTitle = event.node?.title || 'Unknown task'
  const projectName = event.project?.name
  const lines: string[] = []

  if (projectName) {
    lines.push(`**${taskTitle}** (${projectName})`)
  } else {
    lines.push(`**${taskTitle}**`)
  }
  lines.push('')
  lines.push(`**Error:** ${event.error}`)

  return lines.join('\n')
}

export const channelNotificationHook: EventHook = async (event) => {
  let notification: ChannelNotification | null = null

  switch (event.type) {
    case 'task.completed': {
      const completedUrl = (event.nodeId?.startsWith('playground-') || event.nodeId?.startsWith('session-'))
        ? `${BASE_URL}/playground?projectId=${event.projectId}`
        : `${BASE_URL}/project/${event.projectId}/task/${event.nodeId}`
      notification = {
        type: 'task.completed' as NotificationType,
        projectId: event.projectId,
        summary: buildCompletedSummary(event),
        astroUrl: completedUrl,
        metadata: {
          nodeId: event.nodeId,
          executionId: event.executionId,
        },
      }
      break
    }

    case 'task.failed': {
      const failedUrl = (event.nodeId?.startsWith('playground-') || event.nodeId?.startsWith('session-'))
        ? `${BASE_URL}/playground?projectId=${event.projectId}`
        : `${BASE_URL}/project/${event.projectId}/task/${event.nodeId}`
      notification = {
        type: 'task.failed' as NotificationType,
        projectId: event.projectId,
        summary: buildFailedSummary(event),
        astroUrl: failedUrl,
        metadata: {
          nodeId: event.nodeId,
          executionId: event.executionId,
          error: event.error,
        },
      }
      break
    }

    case 'approval.requested': {
      const approvalUrl = event.nodeId?.startsWith('plan-')
        ? BASE_URL
        : (event.nodeId?.startsWith('playground-') || event.nodeId?.startsWith('session-'))
          ? `${BASE_URL}/playground?projectId=${event.projectId}`
          : `${BASE_URL}/project/${event.projectId}/task/${event.nodeId}`

      // Enrich with task title and project name for better approval context
      let taskTitle: string | undefined
      let projectName: string | undefined
      let recentContext: string | undefined
      try {
        const [node] = await db.select({ title: planNodes.title })
          .from(planNodes)
          .where(eq(planNodes.id, event.nodeId))
          .limit(1)
        taskTitle = node?.title

        const [project] = await db.select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, event.projectId))
          .limit(1)
        projectName = project?.name

        // Include subroutine name as additional context if available
        if (event.subroutine?.name) {
          recentContext = `Running: ${event.subroutine.name}`
        }
      } catch {
        // non-critical — continue without enrichment
      }

      // Build a rich summary that gives the user full context
      const summaryLines: string[] = []
      if (taskTitle && projectName) {
        summaryLines.push(`**${taskTitle}** (${projectName})`)
      } else if (taskTitle) {
        summaryLines.push(`**${taskTitle}**`)
      }
      if (recentContext) {
        summaryLines.push(recentContext)
      }
      summaryLines.push('')
      summaryLines.push(event.message)
      // If options are available, list them so users have context even in non-Telegram channels
      if (event.options && event.options.length > 0) {
        summaryLines.push('')
        summaryLines.push('Options: ' + event.options.join(' · '))
      }

      notification = {
        type: 'approval.requested' as NotificationType,
        projectId: event.projectId,
        summary: summaryLines.filter(Boolean).join('\n').trim() || `Approval needed: ${event.message}`,
        astroUrl: approvalUrl,
        metadata: {
          approvalId: event.approvalId,
          nodeId: event.nodeId,
          options: event.options,
          taskTitle,
          projectName,
          freeText: Array.isArray(event.options) && event.options.length === 0, // explicitly empty = free-text reply mode
        },
      }
      break
    }

    case 'branch.pruned': {
      notification = {
        type: 'branch.pruned' as NotificationType,
        projectId: event.projectId,
        summary: `Branch pruned: ${event.prunedNodes.length} nodes removed${event.reason ? ` — ${event.reason}` : ''}`,
        astroUrl: `${BASE_URL}/project/${event.projectId}/plan`,
        metadata: {
          branchNodeId: event.branchNodeId,
          prunedNodes: event.prunedNodes,
        },
      }
      break
    }

    case 'project.completed': {
      const projectName = event.project?.name || 'Unknown project'
      const lines: string[] = [`All tasks finished for **${projectName}**`]

      if (event.projectPrUrl) {
        lines.push('')
        lines.push(`**Final PR:** [#${event.projectPrNumber || '?'}](${event.projectPrUrl})`)
      }

      notification = {
        type: 'project.completed' as NotificationType,
        projectId: event.projectId,
        summary: lines.join('\n'),
        astroUrl: `${BASE_URL}/project/${event.projectId}/plan`,
        metadata: {
          projectBranch: event.projectBranch,
          prUrl: event.projectPrUrl,
          prNumber: event.projectPrNumber,
        },
      }
      break
    }
  }

  if (notification) {
    await channelRouter.sendNotification(notification)
  }
}
