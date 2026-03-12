/**
 * Channel Notification Hook
 *
 * Bridges AstroEvent → ChannelNotification.
 * Listens to task lifecycle events and fans them out to all
 * registered channel notification senders via the channel router.
 */

import type { EventHook } from '../types.js'
import { channelRouter } from '../../channel/channel-router.js'
import type { ChannelNotification, NotificationType } from '../../channel/channel-types.js'

const BASE_URL = process.env.ASTRO_BASE_URL || 'http://localhost:5173'

export const channelNotificationHook: EventHook = async (event) => {
  let notification: ChannelNotification | null = null

  switch (event.type) {
    case 'task.completed': {
      const taskTitle = event.node?.title || 'Unknown task'
      // Playground tasks (nodeId starts with 'playground-') are not plan nodes;
      // link to the playground page instead of task detail to avoid "Task not found".
      const completedUrl = event.nodeId?.startsWith('playground-')
        ? `${BASE_URL}/playground?projectId=${event.projectId}`
        : `${BASE_URL}/project/${event.projectId}/task/${event.nodeId}`
      notification = {
        type: 'task.completed' as NotificationType,
        projectId: event.projectId,
        summary: `Task completed: ${taskTitle}`,
        astroUrl: completedUrl,
        metadata: {
          nodeId: event.nodeId,
          executionId: event.executionId,
        },
      }
      break
    }

    case 'task.failed': {
      const failedTitle = event.node?.title || 'Unknown task'
      // Playground tasks (nodeId starts with 'playground-') are not plan nodes;
      // link to the playground page instead of task detail to avoid "Task not found".
      const failedUrl = event.nodeId?.startsWith('playground-')
        ? `${BASE_URL}/playground?projectId=${event.projectId}`
        : `${BASE_URL}/project/${event.projectId}/task/${event.nodeId}`
      notification = {
        type: 'task.failed' as NotificationType,
        projectId: event.projectId,
        summary: `Task failed: ${failedTitle} — ${event.error}`,
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
      // Route plan generation approvals to dashboard (plan page is empty during generation)
      // Route playground approvals to playground page (no plan node exists)
      const approvalUrl = event.nodeId?.startsWith('plan-')
        ? BASE_URL
        : event.nodeId?.startsWith('playground-')
          ? `${BASE_URL}/playground?projectId=${event.projectId}`
          : `${BASE_URL}/project/${event.projectId}/task/${event.nodeId}`
      notification = {
        type: 'approval.requested' as NotificationType,
        projectId: event.projectId,
        summary: `Approval needed: ${event.message}`,
        astroUrl: approvalUrl,
        metadata: {
          approvalId: event.approvalId,
          nodeId: event.nodeId,
          options: event.options,
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
  }

  if (notification) {
    await channelRouter.sendNotification(notification)
  }
}
