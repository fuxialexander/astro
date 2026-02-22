/**
 * Usage Metrics Hook Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { usageMetricsHook, getUsageStats, resetUsageStats } from '../usage-metrics-hook.js'
import type { TaskCompletedEvent, TaskStartedEvent, TaskFailedEvent } from '../../types.js'
import type { PlanNode } from '../../../../../src/types/index.js'
import type { TaskResult } from '../../../dispatch/types.js'

describe('Usage Metrics Hook', () => {
  beforeEach(() => {
    resetUsageStats()
  })

  const createMockNode = (): PlanNode => ({
    id: 'node-1',
    title: 'Test Task',
    description: 'Test description',
    status: 'planned',
    type: 'task',
    position: { x: 0, y: 0 },
  })

  describe('Task Started', () => {
    it('should increment total tasks on task.started', async () => {
      const event: TaskStartedEvent = {
        type: 'task.started',
        taskId: 'task-1',
        nodeId: 'node-1',
        projectId: 'proj-1',
        executionId: 'exec-1',
        timestamp: new Date(),
        node: createMockNode(),
      }

      await usageMetricsHook(event)

      const stats = getUsageStats()
      expect(stats.totalTasks).toBe(1)
    })
  })

  describe('Task Completed', () => {
    it('should increment completed tasks', async () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
      }

      const event: TaskCompletedEvent = {
        type: 'task.completed',
        taskId: 'task-1',
        nodeId: 'node-1',
        projectId: 'proj-1',
        executionId: 'exec-1',
        result,
        node: createMockNode(),
        timestamp: new Date(),
      }

      await usageMetricsHook(event)

      const stats = getUsageStats()
      expect(stats.completedTasks).toBe(1)
    })

    it('should aggregate cost metrics', async () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        metrics: {
          durationMs: 1000,
          estimatedCostUsd: 0.015,
          tokensUsed: 1500,
          inputTokens: 1000,
          outputTokens: 500,
        },
        providerId: 'test',
        completedAt: new Date(),
      }

      const event: TaskCompletedEvent = {
        type: 'task.completed',
        taskId: 'task-1',
        nodeId: 'node-1',
        projectId: 'proj-1',
        executionId: 'exec-1',
        result,
        node: createMockNode(),
        timestamp: new Date(),
      }

      await usageMetricsHook(event)

      const stats = getUsageStats()
      expect(stats.totalCost).toBe(0.015)
      expect(stats.totalTokens).toBe(1500)
      expect(stats.totalDurationMs).toBe(1000)
    })

    it('should aggregate multiple task metrics', async () => {
      const tasks = [
        { cost: 0.01, tokens: 1000, duration: 500 },
        { cost: 0.02, tokens: 2000, duration: 1000 },
        { cost: 0.015, tokens: 1500, duration: 750 },
      ]

      for (const task of tasks) {
        const result: TaskResult = {
          taskId: `task-${task.cost}`,
          status: 'success',
          metrics: {
            durationMs: task.duration,
            estimatedCostUsd: task.cost,
            tokensUsed: task.tokens,
          },
          providerId: 'test',
          completedAt: new Date(),
        }

        const event: TaskCompletedEvent = {
          type: 'task.completed',
          taskId: result.taskId,
          nodeId: 'node-1',
          projectId: 'proj-1',
          executionId: `exec-${task.cost}`,
          result,
          node: createMockNode(),
          timestamp: new Date(),
        }

        await usageMetricsHook(event)
      }

      const stats = getUsageStats()
      expect(stats.completedTasks).toBe(3)
      expect(stats.totalCost).toBeCloseTo(0.045, 3)
      expect(stats.totalTokens).toBe(4500)
      expect(stats.totalDurationMs).toBe(2250)
    })

    it('should handle missing metrics gracefully', async () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
      }

      const event: TaskCompletedEvent = {
        type: 'task.completed',
        taskId: 'task-1',
        nodeId: 'node-1',
        projectId: 'proj-1',
        executionId: 'exec-1',
        result,
        node: createMockNode(),
        timestamp: new Date(),
      }

      await usageMetricsHook(event)

      const stats = getUsageStats()
      expect(stats.completedTasks).toBe(1)
      expect(stats.totalCost).toBe(0)
      expect(stats.totalTokens).toBe(0)
      expect(stats.totalDurationMs).toBe(1000)
    })
  })

  describe('Task Failed', () => {
    it('should increment failed tasks', async () => {
      const event: TaskFailedEvent = {
        type: 'task.failed',
        taskId: 'task-1',
        nodeId: 'node-1',
        projectId: 'proj-1',
        executionId: 'exec-1',
        error: 'Task failed',
        node: createMockNode(),
        timestamp: new Date(),
      }

      await usageMetricsHook(event)

      const stats = getUsageStats()
      expect(stats.failedTasks).toBe(1)
    })
  })

  describe('Task Cancelled', () => {
    it('should increment cancelled tasks', async () => {
      const event = {
        type: 'task.cancelled' as const,
        taskId: 'task-1',
        nodeId: 'node-1',
        projectId: 'proj-1',
        executionId: 'exec-1',
        reason: 'User cancelled',
        timestamp: new Date(),
      }

      await usageMetricsHook(event)

      const stats = getUsageStats()
      expect(stats.cancelledTasks).toBe(1)
    })
  })

  describe('Reset Stats', () => {
    it('should reset all statistics', async () => {
      // Add some stats
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        metrics: {
          durationMs: 1000,
          estimatedCostUsd: 0.015,
          tokensUsed: 1500,
        },
        providerId: 'test',
        completedAt: new Date(),
      }

      const event: TaskCompletedEvent = {
        type: 'task.completed',
        taskId: 'task-1',
        nodeId: 'node-1',
        projectId: 'proj-1',
        executionId: 'exec-1',
        result,
        node: createMockNode(),
        timestamp: new Date(),
      }

      await usageMetricsHook(event)

      let stats = getUsageStats()
      expect(stats.completedTasks).toBe(1)

      // Reset
      resetUsageStats()

      stats = getUsageStats()
      expect(stats.totalTasks).toBe(0)
      expect(stats.completedTasks).toBe(0)
      expect(stats.failedTasks).toBe(0)
      expect(stats.cancelledTasks).toBe(0)
      expect(stats.totalCost).toBe(0)
      expect(stats.totalTokens).toBe(0)
      expect(stats.totalDurationMs).toBe(0)
    })
  })
})
