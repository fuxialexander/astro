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
      notification = {
        type: 'task.completed' as NotificationType,
        projectId: event.projectId,
        summary: `Task completed: ${taskTitle}`,
        astroUrl: `${BASE_URL}/project/${event.projectId}/task/${event.nodeId}`,
        metadata: {
          nodeId: event.nodeId,
          executionId: event.executionId,
        },
      }
      break
    }

    case 'task.failed': {
      const failedTitle = event.node?.title || 'Unknown task'
      notification = {
        type: 'task.failed' as NotificationType,
        projectId: event.projectId,
        summary: `Task failed: ${failedTitle} — ${event.error}`,
        astroUrl: `${BASE_URL}/project/${event.projectId}/task/${event.nodeId}`,
        metadata: {
          nodeId: event.nodeId,
          executionId: event.executionId,
          error: event.error,
        },
      }
      break
    }

    case 'approval.requested': {
      notification = {
        type: 'approval.requested' as NotificationType,
        projectId: event.projectId,
        summary: `Approval needed: ${event.message}`,
        astroUrl: `${BASE_URL}/project/${event.projectId}/task/${event.nodeId}`,
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
