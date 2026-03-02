/**
 * PR Body Update Hook Integration Tests
 *
 * Tests the pr-body-update-hook for:
 * 1. Hook triggers on task.completed with prNumber
 * 2. Hook skips when no prNumber
 * 3. Hook formats PR body correctly with summary
 * 4. Hook handles GitHub API errors gracefully
 *
 * Auto-skips when GitHub token is not available.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prBodyUpdateHook } from '../server/lib/events/hooks/pr-body-update-hook.js'
import type { TaskCompletedEvent } from '../server/lib/events/types.js'
import type { PlanNode, Project } from '../src/types/index.js'
import type { TaskResult } from '../server/lib/dispatch/types.js'

// ── Mocks ────────────────────────────────────────────────────────────────

// Mock the database module
vi.mock('../server/lib/db/index.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{
            ownerId: 'owner-1',
            teamId: 'team-1',
            githubOwner: 'test-owner',
            githubRepo: 'test-repo',
            repository: 'test-owner/test-repo',
          }]),
        })),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
    })),
  },
}))

vi.mock('../server/lib/db/schema.js', () => ({
  projects: { id: 'id', ownerId: 'owner_id', teamId: 'team_id', githubOwner: 'github_owner', githubRepo: 'github_repo', repository: 'repository' },
  githubConnections: { accessToken: 'access_token', userId: 'user_id' },
  teamMembers: { userId: 'user_id', teamId: 'team_id' },
  planNodes: { clientId: 'client_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}))

// Mock the summary-utils module to avoid real API calls
vi.mock('../packages/core/src/dispatch/summary-utils.js', () => ({
  generateServerSideSummary: vi.fn().mockResolvedValue(null),
}))

describe('PR Body Update Hook', () => {
  let originalFetch: typeof global.fetch
  let originalGithubToken: string | undefined
  let originalAstroBaseUrl: string | undefined

  beforeEach(() => {
    originalFetch = global.fetch
    originalGithubToken = process.env.GITHUB_TOKEN
    originalAstroBaseUrl = process.env.ASTRO_BASE_URL

    // Mock fetch
    global.fetch = vi.fn()

    // Set mock GitHub token
    process.env.GITHUB_TOKEN = 'test-token'
    process.env.ASTRO_BASE_URL = 'https://test.astroanywhere.com'
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (originalGithubToken) {
      process.env.GITHUB_TOKEN = originalGithubToken
    } else {
      delete process.env.GITHUB_TOKEN
    }
    if (originalAstroBaseUrl) {
      process.env.ASTRO_BASE_URL = originalAstroBaseUrl
    } else {
      delete process.env.ASTRO_BASE_URL
    }
    vi.clearAllMocks()
  })

  // ── Helper: Create mock event ─────────────────────────────────────────

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
      branchName: 'feature/test',
      prNumber: 42,
      metrics: { durationMs: 1000 },
    }

    const project: Project = {
      id: 'proj-1',
      name: 'Test Project',
      repository: 'test-owner/test-repo',
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
    }

    return {
      type: 'task.completed',
      taskId: 'task-1',
      nodeId: 'node-1',
      projectId: 'proj-1',
      executionId: 'exec-1',
      result,
      node,
      project,
      timestamp: new Date(),
      ...overrides,
    }
  }

  // ── Test 1: Hook triggers on task.completed with prNumber ─────────────

  describe('trigger conditions', () => {
    it('should trigger on task.completed event with prNumber from node', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123, number: 42 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent()

      await prBodyUpdateHook(event)

      // Should have called the PR update endpoint
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-owner/test-repo/pulls/42',
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            'Authorization': 'token test-token',
          }),
          body: expect.any(String),
        })
      )
    })

    it('should trigger on task.completed event with prNumber from result', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123, number: 99 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent({
        result: {
          taskId: 'task-1',
          status: 'success',
          branchName: 'feature/test',
          prNumber: 99,
          metrics: { durationMs: 1000 },
        },
      })
      // Remove prNumber from node, so it falls back to result.prNumber
      event.node.prNumber = undefined

      await prBodyUpdateHook(event)

      // Should have called for PR #99
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-owner/test-repo/pulls/99',
        expect.any(Object)
      )
    })

    it('should skip if event is not task.completed', async () => {
      const event = { type: 'task.started' } as unknown as TaskCompletedEvent

      await prBodyUpdateHook(event)

      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  // ── Test 2: Hook skips when no prNumber ────────────────────────────────

  describe('skip conditions', () => {
    it('should skip if no prNumber on node or result', async () => {
      const event = createMockEvent({
        result: {
          taskId: 'task-1',
          status: 'success',
          branchName: 'feature/test',
          metrics: { durationMs: 1000 },
        },
      })
      event.node.prNumber = undefined

      await prBodyUpdateHook(event)

      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('should skip if prNumber is null', async () => {
      const event = createMockEvent()
      event.node.prNumber = undefined
      event.result.prNumber = undefined

      await prBodyUpdateHook(event)

      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  // ── Test 3: Hook formats PR body correctly with summary ────────────────

  describe('PR body formatting', () => {
    it('should format PR body with structured summary (Layer 1)', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent({
        result: {
          taskId: 'task-1',
          status: 'success',
          prNumber: 42,
          metrics: { durationMs: 1000 },
          summary: {
            status: 'success',
            workCompleted: 'Implemented feature X with full test coverage',
            keyFindings: ['Added 5 new components', 'All tests passing'],
            filesChanged: ['src/components/Feature.tsx', 'src/hooks/useFeature.ts'],
            followUps: ['Add more edge case tests'],
          },
        },
      })

      await prBodyUpdateHook(event)

      expect(global.fetch).toHaveBeenCalledTimes(1)

      // Verify the body was formatted correctly
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.body).toContain('## Summary')
      expect(body.body).toContain('Implemented feature X')
      expect(body.body).toContain('## Changes')
      expect(body.body).toContain('Added 5 new components')
      expect(body.body).toContain('## Files Changed')
      expect(body.body).toContain('src/components/Feature.tsx')
      expect(body.body).toContain('## Astro')
      expect(body.body).toContain('https://test.astroanywhere.com/project/proj-1/task/node-1')
    })

    it('should use executiveSummary if available in summary', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent({
        result: {
          taskId: 'task-1',
          status: 'success',
          prNumber: 42,
          metrics: { durationMs: 1000 },
          summary: {
            status: 'success',
            workCompleted: 'Short description',
            executiveSummary: 'This is a comprehensive executive summary that provides more detail about the work done.',
            keyFindings: [],
            filesChanged: [],
            followUps: [],
          } as TaskResult['summary'] & { executiveSummary: string },
        },
      })

      await prBodyUpdateHook(event)

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.body).toContain('comprehensive executive summary')
    })

    it('should format PR body with executive summary from stdout (Layer 2)', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent({
        result: {
          taskId: 'task-1',
          status: 'success',
          prNumber: 42,
          metrics: { durationMs: 1000 },
          stdout: `Some output here...
## Executive Summary
This is the executive summary extracted from stdout. It describes what was done in detail.
## Other Section
More content...`,
        },
      })

      await prBodyUpdateHook(event)

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.body).toContain('executive summary extracted from stdout')
    })

    it('should format PR body with file changes (Layer 4)', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent({
        result: {
          taskId: 'task-1',
          status: 'success',
          prNumber: 42,
          metrics: { durationMs: 1000 },
          filesChanged: [
            { path: 'src/index.ts', diff: '+ new code' },
            { path: 'src/utils.ts' },
          ],
        },
      })

      await prBodyUpdateHook(event)

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.body).toContain('## Summary')
      expect(body.body).toContain('Completed task: Test Task')
      expect(body.body).toContain('Modified 2 file(s)')
      expect(body.body).toContain('src/index.ts')
      expect(body.body).toContain('src/utils.ts')
    })

    it('should format PR body with task description fallback (Layer 5)', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent({
        result: {
          taskId: 'task-1',
          status: 'success',
          prNumber: 42,
          metrics: { durationMs: 1000 },
          // No summary, no stdout, no filesChanged
        },
      })
      event.node.description = 'This is the task description that should appear in the PR body'

      await prBodyUpdateHook(event)

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.body).toContain('task description that should appear')
    })

    it('should include test plan from follow-ups', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent({
        result: {
          taskId: 'task-1',
          status: 'success',
          prNumber: 42,
          metrics: { durationMs: 1000 },
          summary: {
            status: 'success',
            workCompleted: 'Added new feature',
            keyFindings: [],
            filesChanged: [],
            followUps: [
              'Verify the login flow works correctly',
              'Test edge cases for validation',
              'Consider adding more documentation',
            ],
          },
        },
      })

      await prBodyUpdateHook(event)

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.body).toContain('## Test Plan')
      expect(body.body).toContain('Verify the login flow')
      expect(body.body).toContain('Test edge cases')
      // Non-test follow-ups should be in Changes, not Test Plan
      expect(body.body).toContain('adding more documentation')
    })

    it('should include related issue reference', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent({
        result: {
          taskId: 'task-1',
          status: 'success',
          prNumber: 42,
          metrics: { durationMs: 1000 },
        },
      })
      event.node.githubIssueNumber = 123

      await prBodyUpdateHook(event)

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.body).toContain('## Related Issue')
      expect(body.body).toContain('Closes #123')
    })

    it('should include Astro footer', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent()

      await prBodyUpdateHook(event)

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.body).toContain('PR description generated by')
      expect(body.body).toContain('Astro')
    })
  })

  // ── Test 4: Hook handles GitHub API errors gracefully ──────────────────

  describe('error handling', () => {
    it('should handle GitHub API 404 error gracefully', async () => {
      const errorResponse = {
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(errorResponse)

      const event = createMockEvent()

      // Should not throw
      await expect(prBodyUpdateHook(event)).resolves.not.toThrow()

      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('should handle GitHub API 403 forbidden error gracefully', async () => {
      const errorResponse = {
        ok: false,
        status: 403,
        json: async () => ({ message: 'Forbidden - rate limit exceeded' }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(errorResponse)

      const event = createMockEvent()

      // Should not throw
      await expect(prBodyUpdateHook(event)).resolves.not.toThrow()
    })

    it('should handle network errors gracefully', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error')
      )

      const event = createMockEvent()

      // Should not throw
      await expect(prBodyUpdateHook(event)).resolves.not.toThrow()
    })

    it('should handle timeout errors gracefully', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Request timeout')
      )

      const event = createMockEvent()

      // Should not throw
      await expect(prBodyUpdateHook(event)).resolves.not.toThrow()
    })

    it('should skip if no GitHub token is available', async () => {
      delete process.env.GITHUB_TOKEN

      const event = createMockEvent()

      await prBodyUpdateHook(event)

      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  // ── Repository parsing tests ───────────────────────────────────────────

  describe('repository parsing', () => {
    it('should parse owner/repo format', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent({
        project: {
          id: 'proj-1',
          name: 'Test Project',
          repository: 'myorg/myrepo',
        },
      })

      await prBodyUpdateHook(event)

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/myorg/myrepo/pulls/42',
        expect.any(Object)
      )
    })

    it('should parse HTTPS GitHub URL format', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent({
        project: {
          id: 'proj-1',
          name: 'Test Project',
          repository: 'https://github.com/myorg/myrepo.git',
        },
      })

      await prBodyUpdateHook(event)

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/myorg/myrepo/pulls/42',
        expect.any(Object)
      )
    })

    // Note: SSH URL format (git@github.com:myorg/myrepo.git) is not currently
    // supported by parseRepository() in the hook. This is a known limitation.
    // The hook only reliably parses:
    // - owner/repo format
    // - https://github.com/owner/repo.git format
    // SSH URLs should use the githubOwner/githubRepo fields instead.

    it('should use githubOwner and githubRepo if available', async () => {
      const updateResponse = {
        ok: true,
        json: async () => ({ id: 123 }),
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateResponse)

      const event = createMockEvent({
        project: {
          id: 'proj-1',
          name: 'Test Project',
          repository: 'wrong/repo', // This should be ignored
          githubOwner: 'correct-owner',
          githubRepo: 'correct-repo',
        },
      })

      await prBodyUpdateHook(event)

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/correct-owner/correct-repo/pulls/42',
        expect.any(Object)
      )
    })
  })
})
