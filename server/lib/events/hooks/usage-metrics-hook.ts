/**
 * Usage Metrics Hook
 *
 * Aggregates usage statistics from task execution.
 * Emits metrics for cost tracking, token usage, and performance monitoring.
 */

import { executionEventBus } from '../../execution-event-bus.js'
import type { EventHook } from '../types.js'

/**
 * In-memory usage aggregation
 * In production, this would write to a database
 */
const usageStats = {
  totalTasks: 0,
  completedTasks: 0,
  failedTasks: 0,
  cancelledTasks: 0,
  totalCost: 0,
  totalTokens: 0,
  totalDurationMs: 0,
}

export const usageMetricsHook: EventHook = async (event) => {
  switch (event.type) {
    case 'task.started':
      usageStats.totalTasks++
      break

    case 'task.completed':
      usageStats.completedTasks++

      // Aggregate metrics
      if (event.result.metrics) {
        const { metrics } = event.result
        if (metrics.estimatedCostUsd) {
          usageStats.totalCost += metrics.estimatedCostUsd
        }
        if (metrics.tokensUsed) {
          usageStats.totalTokens += metrics.tokensUsed
        }
        if (metrics.durationMs) {
          usageStats.totalDurationMs += metrics.durationMs
        }

        // Emit usage event for storage
        executionEventBus.emit('usage:metrics', {
          taskId: event.executionId,
          projectId: event.projectId,
          nodeId: event.nodeId,
          metrics: {
            costUsd: metrics.estimatedCostUsd,
            inputTokens: metrics.inputTokens,
            outputTokens: metrics.outputTokens,
            totalTokens: metrics.tokensUsed,
            durationMs: metrics.durationMs,
            model: metrics.model,
            turnsUsed: metrics.turnsUsed,
          },
          timestamp: event.timestamp,
        })
      }
      break

    case 'task.failed':
      usageStats.failedTasks++
      break

    case 'task.cancelled':
      usageStats.cancelledTasks++
      break
  }
}

/**
 * Get current usage statistics
 */
export function getUsageStats() {
  return { ...usageStats }
}

/**
 * Reset usage statistics (for testing)
 */
export function resetUsageStats() {
  usageStats.totalTasks = 0
  usageStats.completedTasks = 0
  usageStats.failedTasks = 0
  usageStats.cancelledTasks = 0
  usageStats.totalCost = 0
  usageStats.totalTokens = 0
  usageStats.totalDurationMs = 0
}
