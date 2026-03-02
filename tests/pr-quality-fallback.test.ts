/**
 * PR Quality Fallback Tests
 *
 * Tests the PR quality fallback chain:
 *
 * Part 1 — PR Body Update Hook Integration Tests:
 * 1. Hook triggers on task.completed with prNumber
 * 2. Hook skips when no prNumber
 * 3. Hook formats PR body correctly with summary
 * 4. Hook handles GitHub API errors gracefully
 *
 * Part 2 — parseExecutiveSummaryFromOutput Unit Tests:
 * 1. Standard format with all fields
 * 2. Missing status field
 * 3. No Executive Summary section
 * 4. Malformed markdown
 * 5. Edge cases (empty string, very long output)
 *
 * Auto-skips when GitHub token is not available (Part 1 only).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prBodyUpdateHook } from '../server/lib/events/hooks/pr-body-update-hook.js'
import { parseExecutiveSummaryFromOutput } from '../packages/core/src/dispatch/summary-utils.js'
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

// Mock only the server-side summary generation to avoid real API calls
// Preserve the real parseExecutiveSummaryFromOutput for unit testing
vi.mock('../packages/core/src/dispatch/summary-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../packages/core/src/dispatch/summary-utils.js')>()
  return {
    ...actual,
    generateServerSideSummary: vi.fn().mockResolvedValue(null),
  }
})

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

// ============================================================================
// parseExecutiveSummaryFromOutput — Unit Tests
//
// Tests the regex-based parser used as Layer 2 of the PR quality fallback chain.
// The parser extracts structured data from the "## Executive Summary" block
// that agents emit at the end of their output.
// ============================================================================

describe('parseExecutiveSummaryFromOutput', () => {
  // ── Test 1: Standard format with all fields ──────────────────────────

  describe('standard format with all fields', () => {
    it('parses a complete executive summary with all fields present', () => {
      const output = `
Some agent output here...
Tool calls and results...

## Executive Summary
**Status:** success
**What was done:** Implemented user authentication with OAuth2 support.
- Added Google and GitHub OAuth2 providers
- Created login/logout API endpoints
- Wrote 15 unit tests with full coverage
**Follow-ups:**
- Add refresh token rotation
- Consider adding SAML support for enterprise
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Implemented user authentication with OAuth2 support.')
      expect(result!.keyFindings).toHaveLength(3)
      expect(result!.keyFindings).toEqual([
        'Added Google and GitHub OAuth2 providers',
        'Created login/logout API endpoints',
        'Wrote 15 unit tests with full coverage',
      ])
      expect(result!.followUps).toHaveLength(2)
      expect(result!.followUps).toEqual([
        'Add refresh token rotation',
        'Consider adding SAML support for enterprise',
      ])
    })

    it('parses a summary with partial status', () => {
      const output = `
## Executive Summary
**Status:** partial
**What was done:** Completed backend implementation but frontend is pending.
- Backend API routes implemented
- Database migrations applied
**Follow-ups:**
- Implement frontend components
- Add integration tests
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('partial')
      expect(result!.workCompleted).toBe('Completed backend implementation but frontend is pending.')
      expect(result!.keyFindings).toEqual([
        'Backend API routes implemented',
        'Database migrations applied',
      ])
      expect(result!.followUps).toEqual([
        'Implement frontend components',
        'Add integration tests',
      ])
    })

    it('parses a summary with failure status', () => {
      const output = `
## Executive Summary
**Status:** failure
**What was done:** Build failed due to type errors in the new module.
- 3 TypeScript compilation errors found
- Missing dependency declaration
**Follow-ups:**
- Fix type errors in src/auth/index.ts
- Add missing @types/jsonwebtoken dependency
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('failure')
      expect(result!.workCompleted).toBe('Build failed due to type errors in the new module.')
      expect(result!.keyFindings).toHaveLength(2)
      expect(result!.followUps).toHaveLength(2)
    })

    it('parses a summary with many key findings and follow-ups', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Major refactoring of the state management layer.
- Migrated from Redux to Zustand
- Simplified 12 store files
- Removed 3000 lines of boilerplate
- Updated all component subscriptions
- Fixed 5 race conditions
**Follow-ups:**
- Monitor performance in production
- Update developer documentation
- Remove deprecated Redux utilities
- Train team on Zustand patterns
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.keyFindings).toHaveLength(5)
      expect(result!.followUps).toHaveLength(4)
    })
  })

  // ── Test 2: Missing status field ─────────────────────────────────────

  describe('missing status field', () => {
    it('defaults to success when status is missing but workCompleted is present', () => {
      const output = `
## Executive Summary
**What was done:** Task completed without explicit status.
- Implemented the feature
- Tests passing
**Follow-ups:**
- Deploy to staging
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Task completed without explicit status.')
      expect(result!.keyFindings).toEqual(['Implemented the feature', 'Tests passing'])
      expect(result!.followUps).toEqual(['Deploy to staging'])
    })

    it('returns null when both status and workCompleted are missing but bullets exist', () => {
      const output = `
## Executive Summary
- Just some findings without status or work description
- Another finding
`

      // This should return null because status cannot be inferred without workCompleted
      const result = parseExecutiveSummaryFromOutput(output)
      expect(result).toBeNull()
    })

    it('handles status with unrecognized value', () => {
      const output = `
## Executive Summary
**Status:** unknown_status
**What was done:** Task with invalid status.
- Finding one
`

      const result = parseExecutiveSummaryFromOutput(output)

      // Status regex only matches success|partial|failure, so unrecognized status
      // means status is missing. With workCompleted present, it should default to success.
      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Task with invalid status.')
    })
  })

  // ── Test 3: No Executive Summary section ─────────────────────────────

  describe('no Executive Summary section', () => {
    it('returns null for output with no executive summary block', () => {
      const output = `
This is just regular agent output.
It mentions tools and results but has no executive summary section.

The build was successful and all tests pass.
`

      expect(parseExecutiveSummaryFromOutput(output)).toBeNull()
    })

    it('returns null for output with a similar but non-matching heading', () => {
      const output = `
## Summary
**Status:** success
**What was done:** This is not an executive summary.
`

      expect(parseExecutiveSummaryFromOutput(output)).toBeNull()
    })

    it('returns null for output containing "Executive Summary" only in body text', () => {
      const output = `
The agent should produce an Executive Summary at the end, but this one didn't.
Here's some more text about the work that was done.
`

      // "Executive Summary" appears in body text, not as a section header
      expect(parseExecutiveSummaryFromOutput(output)).toBeNull()
    })

    it('returns null for completely unrelated content', () => {
      const output = `
Build output:
> tsc --noEmit
> vite build
Done in 3.45s
`

      expect(parseExecutiveSummaryFromOutput(output)).toBeNull()
    })

    it('returns null for output with only whitespace after the header', () => {
      const output = `
## Executive Summary


`

      expect(parseExecutiveSummaryFromOutput(output)).toBeNull()
    })
  })

  // ── Test 4: Malformed markdown ───────────────────────────────────────

  describe('malformed markdown', () => {
    it('handles missing bold markers on field names', () => {
      const output = `
## Executive Summary
Status: success
What was done: Completed without bold markers.
- Finding from plain format
Follow-ups:
- Follow-up from plain format
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Completed without bold markers.')
      expect(result!.keyFindings).toContain('Finding from plain format')
    })

    it('handles mixed bold formatting on field names', () => {
      const output = `
## Executive Summary
**Status:** success
What was done: Mixed formatting style.
- Finding one
**Follow-ups:**
- Follow-up one
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Mixed formatting style.')
    })

    it('handles extra blank lines between sections', () => {
      const output = `
## Executive Summary

**Status:** success


**What was done:** Output with excessive blank lines.


- Finding with extra spacing


**Follow-ups:**


- Follow-up with extra spacing
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Output with excessive blank lines.')
      expect(result!.keyFindings).toContain('Finding with extra spacing')
      expect(result!.followUps).toContain('Follow-up with extra spacing')
    })

    it('handles triple-hash header level', () => {
      const output = `
### Executive Summary
**Status:** success
**What was done:** Using h3 header.
- Finding
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
    })

    it('handles code fence terminated summary block', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Summary before code fence.
- Key finding
\`\`\`
some code block
\`\`\`
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Summary before code fence.')
    })

    it('handles bullet unicode character', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Using unicode bullets.
• Unicode bullet finding
**Follow-ups:**
• Unicode bullet follow-up
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.keyFindings).toContain('Unicode bullet finding')
      expect(result!.followUps).toContain('Unicode bullet follow-up')
    })

    it('handles asterisk bullet points', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Using asterisk bullets.
* Asterisk finding one
* Asterisk finding two
**Follow-ups:**
* Asterisk follow-up
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.keyFindings).toContain('Asterisk finding one')
      expect(result!.keyFindings).toContain('Asterisk finding two')
      expect(result!.followUps).toContain('Asterisk follow-up')
    })

    it('handles tabs as whitespace in field separators', () => {
      const output = `
## Executive Summary
**Status:**\tsuccess
**What was done:**\tCompleted with tabs.
-\tTab-prefixed key finding
**Follow-ups:**
-\tTab-prefixed follow-up
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
    })

    it('handles case-insensitive status values', () => {
      const output = `
## Executive Summary
**Status:** SUCCESS
**What was done:** Uppercase status test.
- Finding
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
    })

    it('handles mixed case "Partial" status', () => {
      const output = `
## Executive Summary
**Status:** Partial
**What was done:** Mixed case test.
- Partial work done
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('partial')
    })

    it('handles follow-ups with hyphenated name variations', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Testing follow-up header variants.
- Key finding
**Follow ups:**
- Follow-up item
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.followUps).toContain('Follow-up item')
    })
  })

  // ── Test 5: Edge cases ───────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(parseExecutiveSummaryFromOutput('')).toBeNull()
    })

    it('returns null for null input', () => {
      expect(parseExecutiveSummaryFromOutput(null as unknown as string)).toBeNull()
    })

    it('returns null for undefined input', () => {
      expect(parseExecutiveSummaryFromOutput(undefined as unknown as string)).toBeNull()
    })

    it('returns null for non-string input (number)', () => {
      expect(parseExecutiveSummaryFromOutput(42 as unknown as string)).toBeNull()
    })

    it('returns null for non-string input (object)', () => {
      expect(parseExecutiveSummaryFromOutput({} as unknown as string)).toBeNull()
    })

    it('handles very long output with summary at the end', () => {
      // Simulate a very long agent output (> 100KB)
      const longContent = 'x'.repeat(100_000)
      const output = `${longContent}

## Executive Summary
**Status:** success
**What was done:** Task completed after very long output.
- Processed 100,000 characters of output
**Follow-ups:**
- Optimize output buffering
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Task completed after very long output.')
      expect(result!.keyFindings).toEqual(['Processed 100,000 characters of output'])
      expect(result!.followUps).toEqual(['Optimize output buffering'])
    })

    it('handles very long output with summary in the middle', () => {
      const longPrefix = 'line of output\n'.repeat(5000)
      const longSuffix = 'more output\n'.repeat(5000)
      const output = `${longPrefix}
## Executive Summary
**Status:** success
**What was done:** Summary buried in long output.
- Found in the middle
${longSuffix}`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Summary buried in long output.')
    })

    it('handles output with only the summary block and nothing else', () => {
      const output = `## Executive Summary
**Status:** success
**What was done:** Minimal output with only summary.
- Single finding`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Minimal output with only summary.')
      expect(result!.keyFindings).toEqual(['Single finding'])
      expect(result!.followUps).toEqual([])
    })

    it('handles summary with empty bullet points (no content after dash)', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Summary with empty bullets.
- Valid finding
-
- Another valid finding
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      // Empty bullets should be filtered out
      expect(result!.keyFindings).toContain('Valid finding')
      expect(result!.keyFindings).toContain('Another valid finding')
    })

    it('handles summary with no bullets at all', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Summary with no bullet points.
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Summary with no bullet points.')
      expect(result!.keyFindings).toEqual([])
      expect(result!.followUps).toEqual([])
    })

    it('handles workCompleted with special characters', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Fixed the O(n^2) performance issue in \`parseTree()\` & updated docs.
- Refactored algorithm from O(n^2) to O(n log n)
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.workCompleted).toContain('O(n^2)')
      expect(result!.workCompleted).toContain('parseTree()')
    })

    it('handles summary at very end of output without trailing newline', () => {
      const output = `Some output\n\n## Executive Summary\n**Status:** success\n**What was done:** No trailing newline.\n- Finding`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
    })

    it('handles multiple executive summary sections (picks first)', () => {
      const output = `
## Executive Summary
**Status:** failure
**What was done:** First attempt failed.
- Build errors

## Executive Summary
**Status:** success
**What was done:** Second attempt succeeded.
- All tests pass
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      // Should pick the first executive summary
      expect(result!.status).toBe('failure')
      expect(result!.workCompleted).toBe('First attempt failed.')
    })
  })
})
