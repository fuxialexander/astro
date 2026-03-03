/**
 * Merge Queue Hook Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mergeQueueHook } from '../merge-queue-hook.js'
import type { TaskCompletedEvent } from '../../types.js'
import type { PlanNode } from '../../../../../src/types/index.js'
import type { TaskResult } from '../../../dispatch/types.js'

// Mock the DB module to avoid needing a running database
vi.mock('../../../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ ownerId: 'owner-1', teamId: 'team-1' }]),
        }),
      }),
    }),
  },
}))

// Mock the github-client to control token resolution without hitting real APIs
vi.mock('../../../github-client.js', () => ({
  resolveGitHubToken: vi.fn(),
}))

// Import the mock after vi.mock calls so we can control it
import { resolveGitHubToken } from '../../../github-client.js'

describe('Merge Queue Hook', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch

    // Mock fetch
    global.fetch = vi.fn()

    // Default: resolveGitHubToken returns a test token (simulates GITHUB_TOKEN or installation token)
    vi.mocked(resolveGitHubToken).mockResolvedValue({
      token: 'test-token',
      type: 'env',
      source: 'GITHUB_TOKEN env var',
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
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
      prNumber: 42,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result: TaskResult = {
      taskId: 'task-1',
      status: 'success',
      metrics: { durationMs: 1000 },
      providerId: 'test',
      completedAt: new Date(),
    }

    return {
      type: 'task.completed',
      taskId: 'task-1',
      nodeId: 'node-1',
      projectId: 'proj-1',
      executionId: 'exec-1',
      result,
      node,
      project: {
        id: 'proj-1',
        name: 'Test Project',
        repository: 'owner/repo',
        mergeQueueEnabled: true,
        mergeQueueMergeMethod: 'squash',
      },
      timestamp: new Date(),
      ...overrides,
    }
  }

  it('should skip if event is not task.completed', async () => {
    const event = { type: 'task.started' } as unknown as TaskCompletedEvent

    await mergeQueueHook(event)

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

    await mergeQueueHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should skip if merge queue is not enabled on project', async () => {
    const event = createMockEvent({
      project: {
        id: 'proj-1',
        name: 'Test Project',
        repository: 'owner/repo',
        mergeQueueEnabled: false,
      },
    })

    await mergeQueueHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should skip if project has no mergeQueueEnabled', async () => {
    const event = createMockEvent({
      project: {
        id: 'proj-1',
        name: 'Test Project',
        repository: 'owner/repo',
      },
    })

    await mergeQueueHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should skip if no prNumber on node or metadata', async () => {
    const event = createMockEvent()
    event.node.prNumber = undefined

    await mergeQueueHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should skip if no GitHub token is available', async () => {
    // Simulate resolveGitHubToken returning null (no token of any kind)
    vi.mocked(resolveGitHubToken).mockResolvedValue(null)

    const event = createMockEvent()

    await mergeQueueHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should skip if no repository on project', async () => {
    const event = createMockEvent({
      project: {
        id: 'proj-1',
        name: 'Test Project',
        mergeQueueEnabled: true,
      },
    })

    await mergeQueueHook(event)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should label PR and enable auto-merge', async () => {
    // Mock label API response
    const labelResponse = {
      ok: true,
      json: async () => ([{ name: 'astro-managed' }]),
    }

    // Mock getPullRequest response (for enableAutoMerge)
    const prResponse = {
      ok: true,
      json: async () => ({ node_id: 'PR_abc123', number: 42 }),
    }

    // Mock GraphQL enableAutoMerge response
    const graphqlResponse = {
      ok: true,
      json: async () => ({
        data: {
          enablePullRequestAutoMerge: {
            pullRequest: {
              autoMergeRequest: { enabledAt: '2026-01-01', mergeMethod: 'SQUASH' },
            },
          },
        },
      }),
    }

    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(labelResponse)    // addLabelsToIssue
      .mockResolvedValueOnce(prResponse)        // getPullRequest (called by enableAutoMerge)
      .mockResolvedValueOnce(graphqlResponse)   // GraphQL mutation

    const event = createMockEvent()

    await mergeQueueHook(event)

    // Should have called fetch 3 times: labels, PR details, GraphQL
    expect(global.fetch).toHaveBeenCalledTimes(3)

    // Verify label API call
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/issues/42/labels',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('astro-managed'),
      })
    )

    // Verify GraphQL call
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/graphql',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('enablePullRequestAutoMerge'),
      })
    )
  })

  it('should use installation token when available (higher priority than env)', async () => {
    // Simulate resolveGitHubToken returning an installation token
    vi.mocked(resolveGitHubToken).mockResolvedValue({
      token: 'ghs_installation_token',
      type: 'installation',
      source: 'GitHub App installation for owner',
    })

    const labelResponse = { ok: true, json: async () => ([]) }
    const prResponse = { ok: true, json: async () => ({ node_id: 'PR_abc123', number: 42 }) }
    const graphqlResponse = { ok: true, json: async () => ({ data: { enablePullRequestAutoMerge: {} } }) }

    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(labelResponse)
      .mockResolvedValueOnce(prResponse)
      .mockResolvedValueOnce(graphqlResponse)

    const event = createMockEvent()
    await mergeQueueHook(event)

    // Verify the installation token was used in the API call
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/issues/42/labels',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'token ghs_installation_token',
        }),
      })
    )
  })

  it('should get prNumber from result metadata if not on node', async () => {
    const labelResponse = {
      ok: true,
      json: async () => ([{ name: 'astro-managed' }]),
    }
    const prResponse = {
      ok: true,
      json: async () => ({ node_id: 'PR_abc123', number: 99 }),
    }
    const graphqlResponse = {
      ok: true,
      json: async () => ({ data: { enablePullRequestAutoMerge: {} } }),
    }

    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(labelResponse)
      .mockResolvedValueOnce(prResponse)
      .mockResolvedValueOnce(graphqlResponse)

    const event = createMockEvent({
      result: {
        taskId: 'task-1',
        status: 'success',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
        metadata: { prNumber: 99 },
      },
    })
    event.node.prNumber = undefined

    await mergeQueueHook(event)

    // Should have called for PR #99
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/issues/99/labels',
      expect.any(Object)
    )
  })

  it('should parse GitHub URL format for repository', async () => {
    const labelResponse = {
      ok: true,
      json: async () => ([{ name: 'astro-managed' }]),
    }
    const prResponse = {
      ok: true,
      json: async () => ({ node_id: 'PR_abc123', number: 42 }),
    }
    const graphqlResponse = {
      ok: true,
      json: async () => ({ data: { enablePullRequestAutoMerge: {} } }),
    }

    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(labelResponse)
      .mockResolvedValueOnce(prResponse)
      .mockResolvedValueOnce(graphqlResponse)

    const event = createMockEvent({
      project: {
        id: 'proj-1',
        name: 'Test Project',
        repository: 'https://github.com/myorg/myrepo.git',
        mergeQueueEnabled: true,
      },
    })

    await mergeQueueHook(event)

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/myorg/myrepo/issues/42/labels',
      expect.any(Object)
    )
  })

  it('should handle API errors gracefully', async () => {
    const labelResponse = {
      ok: false,
      json: async () => ({ message: 'Not Found' }),
    }

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(labelResponse)

    const event = createMockEvent()

    // Should not throw despite label failure — continues to enableAutoMerge
    await expect(mergeQueueHook(event)).resolves.not.toThrow()
  })

  it('should handle fetch errors gracefully', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'))

    const event = createMockEvent()

    // Should not throw
    await expect(mergeQueueHook(event)).resolves.not.toThrow()
  })

  it('should use merge method from project settings', async () => {
    const labelResponse = {
      ok: true,
      json: async () => ([]),
    }
    const prResponse = {
      ok: true,
      json: async () => ({ node_id: 'PR_abc123' }),
    }
    const graphqlResponse = {
      ok: true,
      json: async () => ({ data: { enablePullRequestAutoMerge: {} } }),
    }

    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(labelResponse)
      .mockResolvedValueOnce(prResponse)
      .mockResolvedValueOnce(graphqlResponse)

    const event = createMockEvent({
      project: {
        id: 'proj-1',
        name: 'Test Project',
        repository: 'owner/repo',
        mergeQueueEnabled: true,
        mergeQueueMergeMethod: 'rebase',
      },
    })

    await mergeQueueHook(event)

    // Verify the GraphQL call used REBASE merge method
    const graphqlCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[2]
    const body = JSON.parse(graphqlCall[1].body as string)
    expect(body.variables.mergeMethod).toBe('REBASE')
  })
})
