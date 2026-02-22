/**
 * PR Creation Hook Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  let originalFetch: typeof global.fetch
  let originalGithubToken: string | undefined

  beforeEach(() => {
    originalFetch = global.fetch
    originalGithubToken = process.env.GITHUB_TOKEN

    // Mock fetch
    global.fetch = vi.fn()

    // Set mock GitHub token
    process.env.GITHUB_TOKEN = 'test-token'
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (originalGithubToken) {
      process.env.GITHUB_TOKEN = originalGithubToken
    } else {
      delete process.env.GITHUB_TOKEN
    }
  })

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
      metrics: { durationMs: 1000 },
      providerId: 'test',
      completedAt: new Date(),
      metadata: {
        prBranch: 'feature/test',
        prTitle: 'Test PR',
        prBody: 'Test PR body',
        prBaseBranch: 'main',
      },
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

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should skip if task did not succeed', async () => {
    const event = createMockEvent({
      result: {
        taskId: 'task-1',
        status: 'error',
        errorMessage: 'Task failed',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
      },
    })

    await prCreationHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should skip if node does not have autoPr enabled', async () => {
    const event = createMockEvent()
    event.node.autoPr = false

    await prCreationHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should skip if GITHUB_TOKEN is not set', async () => {
    delete process.env.GITHUB_TOKEN

    const event = createMockEvent()

    await prCreationHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should skip if no repository is found', async () => {
    const event = createMockEvent({
      project: { id: 'proj-1', name: 'Test Project' },
    })

    await prCreationHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should skip if prBranch is not in metadata', async () => {
    const event = createMockEvent()
    delete (event.result.metadata as Record<string, unknown>).prBranch

    await prCreationHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should create PR via GitHub API and update node in-place', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ html_url: 'https://github.com/owner/repo/pull/123', number: 123 }),
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

    const event = createMockEvent()

    await prCreationHook(event)

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test PR',
          body: 'Test PR body',
          head: 'feature/test',
          base: 'main',
        }),
      }
    )

    // Verify node was mutated in-place with PR data
    expect(event.node.prUrl).toBe('https://github.com/owner/repo/pull/123')
    expect(event.node.prNumber).toBe(123)
  })

  it('should use node title if prTitle not provided', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ html_url: 'https://github.com/owner/repo/pull/123', number: 123 }),
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

    const event = createMockEvent()
    delete (event.result.metadata as Record<string, unknown>).prTitle

    await prCreationHook(event)

    const callBody = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(callBody.title).toBe('Test Task')
  })

  it('should use task output if prBody not provided', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ html_url: 'https://github.com/owner/repo/pull/123', number: 123 }),
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

    const event = createMockEvent({
      result: {
        taskId: 'task-1',
        status: 'success',
        stdout: 'Task output',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
        metadata: {
          prBranch: 'feature/test',
        },
      },
    })

    await prCreationHook(event)

    const callBody = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(callBody.body).toContain('Automated PR for task: Test Task')
    expect(callBody.body).toContain('Task output')
  })

  it('should handle API errors gracefully', async () => {
    const mockResponse = {
      ok: false,
      text: async () => 'API Error',
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

    const event = createMockEvent()

    // Should not throw
    await expect(prCreationHook(event)).resolves.not.toThrow()

    // Node should NOT be updated on failure
    expect(event.node.prUrl).toBeUndefined()
    expect(event.node.prNumber).toBeUndefined()
  })

  it('should handle fetch errors gracefully', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'))

    const event = createMockEvent()

    // Should not throw
    await expect(prCreationHook(event)).resolves.not.toThrow()
  })

  it('should get repository from result metadata if not in project', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ html_url: 'https://github.com/owner/repo/pull/123', number: 123 }),
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

    const event = createMockEvent({
      project: { id: 'proj-1', name: 'Test Project' },
      result: {
        taskId: 'task-1',
        status: 'success',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
        metadata: {
          prBranch: 'feature/test',
          repository: 'owner/repo',
        },
      },
    })

    await prCreationHook(event)

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls',
      expect.any(Object)
    )
  })

  it('should parse GitHub URL format for repository', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ html_url: 'https://github.com/myorg/myrepo/pull/1', number: 1 }),
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

    const event = createMockEvent({
      project: { id: 'proj-1', name: 'Test Project', repository: 'https://github.com/myorg/myrepo.git' },
    })

    await prCreationHook(event)

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/myorg/myrepo/pulls',
      expect.any(Object)
    )
  })
})
