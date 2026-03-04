/**
 * SSE Notification Hook
 *
 * Emits Server-Sent Events for real-time UI updates.
 * Bridges task execution events to the execution event bus for SSE delivery.
 */

import { executionEventBus } from '../../execution-event-bus.js'
import type { EventHook } from '../types.js'

export const sseNotificationHook: EventHook = async (event) => {
  switch (event.type) {
    case 'task.started':
      executionEventBus.emit('task:started', {
        taskId: event.executionId,
        nodeId: event.nodeId,
        projectId: event.projectId,
      })
      break

    case 'task.progress':
      executionEventBus.emit('task:progress', {
        taskId: event.executionId,
        progress: event.percentage,
        message: event.message,
      })
      break

    case 'task.completed':
      executionEventBus.emit('task:result', {
        result: {
          taskId: event.executionId,
          status: event.result.status === 'success' ? 'completed' : 'failed',
          output: event.result.stdout,
          duration: event.result.metrics?.durationMs,
          metrics: event.result.metrics,
          branchName: event.result.branchName,
          prUrl: event.result.prUrl,
          prNumber: event.result.prNumber,
          deliveryStatus: event.result.deliveryStatus,
        },
      })
      break

    case 'task.failed':
      executionEventBus.emit('task:result', {
        result: {
          taskId: event.executionId,
          status: 'failed',
          output: event.error,
        },
      })
      break

    case 'task.cancelled':
      executionEventBus.emit('task:cancelled', {
        taskId: event.executionId,
        nodeId: event.nodeId,
        projectId: event.projectId,
        reason: event.reason,
      })
      break

    case 'branch.pruned':
      executionEventBus.emit('branch:pruned', {
        branchNodeId: event.branchNodeId,
        projectId: event.projectId,
        prunedNodes: event.prunedNodes,
        cancelledTasks: event.cancelledTasks,
        reason: event.reason,
      })
      break

    case 'merge_queue.failed':
      executionEventBus.emit('merge_queue:failed', {
        nodeId: event.nodeId,
        projectId: event.projectId,
        prNumber: event.prNumber,
        reason: event.reason,
        branchName: event.branchName,
      })
      break

    case 'merge_queue.succeeded':
      executionEventBus.emit('merge_queue:succeeded', {
        nodeId: event.nodeId,
        projectId: event.projectId,
        prNumber: event.prNumber,
        branchName: event.branchName,
        mergedSha: event.mergedSha,
      })
      break

    case 'pr.linked':
      executionEventBus.emit('pr:linked', {
        nodeId: event.nodeId,
        projectId: event.projectId,
        prNumber: event.prNumber,
        prUrl: event.prUrl,
        branchName: event.branchName,
        linkSource: event.linkSource,
      })
      break
  }
}
