/**
 * PR Creation Hook Tests
 *
 * Tests the two-path logic:
 * Path 1: Agent already created PR → record prUrl/prNumber/branchName
 * Path 2: Branch only, no PR → record branchName only
 */

import { describe, it, expect, vi } from 'vitest'
import { prCreationHook } from '../pr-creation-hook.js'
import type { TaskCompletedEvent } from '../../types.js'
import type { PlanNode } from '../../../../../src/types/index.js'
import type { TaskResult } from '../../../dispatch/types.js'

// Mock the database module
vi.mock('../../../db/index.js', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  },
}))

vi.mock('../../../db/schema.js', () => ({
  planNodes: { clientId: 'client_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}))

describe('PR Creation Hook', () => {
  const createMockEvent = (overrides: Partial<TaskCompletedEvent> = {}): TaskCompletedEvent => {
    const node: PlanNode = {
      id: 'node-1',
      projectId: 'proj-1',
      title: 'Test Task',
      description: 'Test description',
      status: 'auto_verified',
      type: 'task',
      position: { x: 0, y: 0 },
      parentId: null,
      dependencies: [],
      verification: 'auto',
      autoPr: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result: TaskResult = {
      taskId: 'task-1',
      status: 'success',
      branchName: 'feature/test',
      metrics: { durationMs: 1000 },
    }

    return {
      type: 'task.completed',
      taskId: 'task-1',
      nodeId: 'node-1',
      projectId: 'proj-1',
      executionId: 'exec-1',
      result,
      node,
      project: { id: 'proj-1', name: 'Test Project', repository: 'owner/repo' },
      timestamp: new Date(),
      ...overrides,
    }
  }

  it('should skip if event is not task.completed', async () => {
    const event = { type: 'task.started' } as unknown as TaskCompletedEvent

    await prCreationHook(event)

    // No error thrown — hook exits early
  })

  it('should skip if task did not succeed', async () => {
    const event = createMockEvent({
      result: {
        taskId: 'task-1',
        status: 'failure',
        errorMessage: 'Task failed',
        metrics: { durationMs: 1000 },
      },
    })

    await prCreationHook(event)

    // No mutation — hook exits early
    expect(event.node.prUrl).toBeUndefined()
  })

  // ── Path 1: Agent already created PR ──────────────────────────────────

  it('should record agent-created PR (Path 1)', async () => {
    const event = createMockEvent({
      result: {
        taskId: 'task-1',
        status: 'success',
        branchName: 'feature/test',
        prUrl: 'https://github.com/owner/repo/pull/42',
        prNumber: 42,
        metrics: { durationMs: 1000 },
      },
    })

    await prCreationHook(event)

    // Should mutate node in-place
    expect(event.node.prUrl).toBe('https://github.com/owner/repo/pull/42')
    expect(event.node.prNumber).toBe(42)
    expect(event.node.branchName).toBe('feature/test')
  })

  // ── Path 2: Branch only → record branch ───────────────────────────────

  it('should record branchName when no PR from agent (Path 2)', async () => {
    const event = createMockEvent()

    await prCreationHook(event)

    // Should record branchName
    expect(event.node.branchName).toBe('feature/test')
    // No PR data
    expect(event.node.prUrl).toBeUndefined()
    expect(event.node.prNumber).toBeUndefined()
  })

  it('should record branchName when autoPr is false (Path 2)', async () => {
    const event = createMockEvent()
    event.node.autoPr = false

    await prCreationHook(event)

    // Should record branchName
    expect(event.node.branchName).toBe('feature/test')
  })

  it('should not record anything if no branchName and no PR from result', async () => {
    const event = createMockEvent({
      result: {
        taskId: 'task-1',
        status: 'success',
        metrics: { durationMs: 1000 },
      },
    })
    event.node.autoPr = false

    await prCreationHook(event)

    expect(event.node.branchName).toBeUndefined()
    expect(event.node.prUrl).toBeUndefined()
  })
})
