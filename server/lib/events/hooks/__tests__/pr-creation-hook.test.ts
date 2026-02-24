/**
 * PR Creation Hook Tests
 *
 * Tests the three-path logic:
 * Path 1: Agent already created PR → record prUrl/prNumber/branchName
 * Path 2: No PR from agent, autoPr enabled, branchName exists → create via GitHub API
 * Path 3: Branch only, no PR, no autoPr → record branchName only
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

    expect(global.fetch).not.toHaveBeenCalled()
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

    expect(global.fetch).not.toHaveBeenCalled()
  })

  // ── Path 1: Agent already created PR ──────────────────────────────────

  it('should record agent-created PR without calling GitHub API (Path 1)', async () => {
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

    // Should NOT call GitHub API — agent already created the PR
    expect(global.fetch).not.toHaveBeenCalled()

    // Should mutate node in-place
    expect(event.node.prUrl).toBe('https://github.com/owner/repo/pull/42')
    expect(event.node.prNumber).toBe(42)
    expect(event.node.branchName).toBe('feature/test')
  })

  // ── Path 2: No PR from agent, autoPr enabled → create via GitHub API ─

  it('should create PR via GitHub API when autoPr enabled and branchName exists (Path 2)', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ html_url: 'https://github.com/owner/repo/pull/123', number: 123 }),
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

    const event = createMockEvent()

    await prCreationHook(event)

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-token',
        }),
      })
    )

    // Verify node was mutated in-place with PR data
    expect(event.node.prUrl).toBe('https://github.com/owner/repo/pull/123')
    expect(event.node.prNumber).toBe(123)
    expect(event.node.branchName).toBe('feature/test')
  })

  it('should use node title as PR title (Path 2)', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ html_url: 'https://github.com/owner/repo/pull/123', number: 123 }),
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

    const event = createMockEvent()

    await prCreationHook(event)

    const callBody = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(callBody.title).toBe('Test Task')
  })

  it('should include task output in PR body (Path 2)', async () => {
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
        branchName: 'feature/test',
        metrics: { durationMs: 1000 },
      },
    })

    await prCreationHook(event)

    const callBody = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(callBody.body).toContain('Automated PR for task: Test Task')
    expect(callBody.body).toContain('Task output')
  })

  it('should skip GitHub API if GITHUB_TOKEN not set (Path 2)', async () => {
    delete process.env.GITHUB_TOKEN

    const event = createMockEvent()

    await prCreationHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
    // Should still record branchName
    expect(event.node.branchName).toBe('feature/test')
  })

  it('should skip GitHub API if no repository on project (Path 2)', async () => {
    const event = createMockEvent({
      project: { id: 'proj-1', name: 'Test Project' },
    })

    await prCreationHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
    // Should still record branchName
    expect(event.node.branchName).toBe('feature/test')
  })

  it('should handle API errors gracefully (Path 2)', async () => {
    const mockResponse = {
      ok: false,
      text: async () => 'API Error',
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

    const event = createMockEvent()

    // Should not throw
    await expect(prCreationHook(event)).resolves.not.toThrow()

    // Node should still have branchName recorded
    expect(event.node.branchName).toBe('feature/test')
    // But no PR data on failure
    expect(event.node.prUrl).toBeUndefined()
    expect(event.node.prNumber).toBeUndefined()
  })

  it('should handle fetch errors gracefully (Path 2)', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'))

    const event = createMockEvent()

    // Should not throw
    await expect(prCreationHook(event)).resolves.not.toThrow()
    // Should still record branchName
    expect(event.node.branchName).toBe('feature/test')
  })

  it('should parse GitHub URL format for repository (Path 2)', async () => {
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

  // ── Path 3: Branch only, no autoPr → record branch ───────────────────

  it('should record branchName without creating PR when autoPr is false (Path 3)', async () => {
    const event = createMockEvent()
    event.node.autoPr = false

    await prCreationHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
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

    expect(global.fetch).not.toHaveBeenCalled()
    expect(event.node.branchName).toBeUndefined()
    expect(event.node.prUrl).toBeUndefined()
  })
})
