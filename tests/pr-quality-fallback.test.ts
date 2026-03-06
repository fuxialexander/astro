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
 * Part 3 — runPrSummaryFallbackChain Unit Tests:
 * 1. Returns structured summary when available (Layer 1)
 * 2. Falls back to parsed summary when structured missing (Layer 2)
 * 3. Falls back to server-generated when parsing fails (Layer 3)
 * 4. Falls back to git diff when server fails (Layer 4)
 * 5. Falls back to task description as last resort (Layer 5)
 * 6. Source field correctness for each layer
 * 7. Fallback chain priority and edge cases
 *
 * Auto-skips when GitHub token is not available (Part 1 only).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prBodyUpdateHook } from '../server/lib/events/hooks/pr-body-update-hook.js'
import { parseExecutiveSummaryFromOutput, runPrSummaryFallbackChain } from '../packages/core/src/dispatch/summary-utils.js'
import type { TaskCompletedEvent } from '../server/lib/events/types.js'
import type { PlanNode, Project } from '../src/types/index.js'
import type { TaskResult } from '../server/lib/dispatch/types.js'
import type { PrSummaryFallbackInput } from '../packages/core/src/dispatch/summary-utils.js'

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

// Mock the Anthropic SDK for runPrSummaryFallbackChain tests
// The fallback chain calls generateServerSideSummary internally (same module),
// so we mock the SDK to control Layer 3 behavior from within the real function
const mockAnthropicCreate = vi.fn().mockResolvedValue({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        workCompleted: 'SDK-generated summary',
        keyFindings: ['SDK finding 1'],
        filesChanged: ['file.ts'],
        status: 'success',
        followUps: [],
      }),
    },
  ],
})

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: mockAnthropicCreate,
    }
  },
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
**Status:** success
**What was done:** Implemented the executive summary feature extracted from stdout.
- Added parsing for structured summaries
- Updated test coverage
**Follow-ups:**
- Add edge case handling
## Other Section
More content...`,
        },
      })

      await prBodyUpdateHook(event)

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body as string)

      expect(body.body).toContain('executive summary feature extracted from stdout')
    })

    it('should format PR body with file changes when no summary or stdout', async () => {
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
      expect(body.body).toContain('Test Task')
      expect(body.body).toContain('## Files Changed')
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

// ============================================================================
// runPrSummaryFallbackChain — Unit Tests
//
// Tests the 5-layer fallback chain for generating PR body summaries.
// Each layer is tested in isolation, along with fallback precedence,
// source field correctness, and edge cases.
//
// The mock setup at the top of this file preserves real parseExecutiveSummaryFromOutput
// and runPrSummaryFallbackChain but mocks generateServerSideSummary (returns null by default).
// ============================================================================

describe('runPrSummaryFallbackChain', () => {
  const baseTaskResult: TaskResult = {
    taskId: 'task-fallback-1',
    status: 'success',
  }

  const baseInput: PrSummaryFallbackInput = {
    taskResult: baseTaskResult,
    taskTitle: 'Implement OAuth2 Login',
    taskDescription: 'Add Google and GitHub OAuth2 providers with session management',
  }

  let originalAnthropicKey: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    // Save and clear the ANTHROPIC_API_KEY to prevent accidental real API calls
    originalAnthropicKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    // Reset the SDK mock to return the default response
    mockAnthropicCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            workCompleted: 'SDK-generated summary',
            keyFindings: ['SDK finding 1'],
            filesChanged: ['file.ts'],
            status: 'success',
            followUps: [],
          }),
        },
      ],
    })
  })

  afterEach(() => {
    if (originalAnthropicKey) {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey
    } else {
      delete process.env.ANTHROPIC_API_KEY
    }
    vi.restoreAllMocks()
  })

  // ── Layer 1: Structured summary from TaskResult.summary ────────────────

  describe('Layer 1: Structured summary (TaskResult.summary)', () => {
    it('returns structured source when executiveSummary is present', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Implemented OAuth2 with Google and GitHub',
            executiveSummary: 'Full executive summary: added OAuth2 login flow with Google and GitHub providers, including session management and PKCE.',
            keyFindings: ['Added Google provider', 'Added GitHub provider'],
            filesChanged: ['src/auth/oauth.ts'],
            followUps: ['Add refresh token rotation'],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toBe('Full executive summary: added OAuth2 login flow with Google and GitHub providers, including session management and PKCE.')
    })

    it('builds summary from workCompleted + keyFindings when executiveSummary is absent', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Implemented OAuth2 login',
            keyFindings: ['Added Google provider', 'Added GitHub provider', 'Session management with PKCE'],
            filesChanged: ['src/auth/oauth.ts'],
            followUps: ['Add Microsoft provider'],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('Implemented OAuth2 login')
      expect(result.summary).toContain('**Key changes:**')
      expect(result.summary).toContain('- Added Google provider')
      expect(result.summary).toContain('- Added GitHub provider')
      expect(result.summary).toContain('- Session management with PKCE')
      expect(result.summary).toContain('**Follow-ups:**')
      expect(result.summary).toContain('- Add Microsoft provider')
    })

    it('includes non-success status in structured summary', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'failure',
            workCompleted: 'OAuth2 implementation failed due to missing credentials',
            keyFindings: ['Missing client_id configuration'],
            filesChanged: [],
            followUps: ['Configure OAuth credentials'],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('**Status:** failure')
      expect(result.summary).toContain('OAuth2 implementation failed')
    })

    it('includes partial status in structured summary', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'partial',
            workCompleted: 'Google OAuth completed, GitHub pending',
            keyFindings: ['Google provider working'],
            filesChanged: ['src/auth/google.ts'],
            followUps: ['Finish GitHub provider'],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('**Status:** partial')
    })

    it('does not include status line when status is success', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Everything works',
            keyFindings: ['All tests pass'],
            filesChanged: [],
            followUps: [],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).not.toContain('**Status:**')
    })

    it('skips whitespace-only executiveSummary and falls to workCompleted', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Fallback to workCompleted',
            executiveSummary: '   \n\t  ',
            keyFindings: [],
            filesChanged: [],
            followUps: [],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('Fallback to workCompleted')
    })

    it('skips empty workCompleted and falls through to next layer', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: '',
            keyFindings: [],
            filesChanged: [],
            followUps: [],
          },
        },
      })

      // Empty workCompleted should fall through all layers to task_description
      expect(result.source).toBe('task_description')
    })

    it('handles summary with keyFindings only (no followUps)', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Completed the task',
            keyFindings: ['Added feature X', 'Refactored module Y'],
            filesChanged: [],
            followUps: [],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('**Key changes:**')
      expect(result.summary).not.toContain('**Follow-ups:**')
    })

    it('handles summary with followUps only (no keyFindings)', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Completed the task',
            keyFindings: [],
            filesChanged: [],
            followUps: ['Deploy to staging', 'Run smoke tests'],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).not.toContain('**Key changes:**')
      expect(result.summary).toContain('**Follow-ups:**')
      expect(result.summary).toContain('- Deploy to staging')
    })
  })

  // ── Layer 2: Parsed in-stream executive summary ─────────────────────────

  describe('Layer 2: Parsed in-stream executive summary', () => {
    it('parses executive summary from execution output when no structured summary', async () => {
      const executionOutput = `
Agent working on OAuth2 implementation...
Tool calls completed.

## Executive Summary
**Status:** success
**What was done:** Implemented OAuth2 login with Google and GitHub providers.
- Added OAuth2 callback handlers
- Created session token management
- Wrote integration tests
**Follow-ups:**
- Add PKCE support
- Implement token refresh
`

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput,
      })

      expect(result.source).toBe('parsed')
      expect(result.summary).toContain('Implemented OAuth2 login with Google and GitHub providers.')
      expect(result.summary).toContain('- Added OAuth2 callback handlers')
      expect(result.summary).toContain('- Created session token management')
      expect(result.summary).toContain('- Wrote integration tests')
      expect(result.summary).toContain('**Follow-ups:**')
      expect(result.summary).toContain('- Add PKCE support')
    })

    it('includes status in parsed summary when not success', async () => {
      const executionOutput = `
## Executive Summary
**Status:** partial
**What was done:** Partially implemented the feature.
- Backend complete
**Follow-ups:**
- Finish frontend
`

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput,
      })

      expect(result.source).toBe('parsed')
      expect(result.summary).toContain('**Status:** partial')
    })

    it('parses summary with no follow-ups section', async () => {
      const executionOutput = `
## Executive Summary
**Status:** success
**What was done:** Quick fix applied.
- Fixed typo in config
`

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput,
      })

      expect(result.source).toBe('parsed')
      expect(result.summary).toContain('Quick fix applied.')
      expect(result.summary).toContain('- Fixed typo in config')
      expect(result.summary).not.toContain('**Follow-ups:**')
    })

    it('falls through when output has no parseable executive summary', async () => {
      const executionOutput = 'Regular output with no executive summary section whatsoever.'

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput,
        // No API key → server generation skipped
      })

      // No structured, no parsed, no server, no git diff → task_description
      expect(result.source).toBe('task_description')
    })

    it('falls through when executionOutput is empty string', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: '',
      })

      expect(result.source).toBe('task_description')
    })
  })

  // ── Layer 3: Server-side summary generation ─────────────────────────────
  // Note: runPrSummaryFallbackChain calls generateServerSideSummary internally
  // (same module), so we control it via the mocked @anthropic-ai/sdk.

  // Layer 3 tests are skipped here because vi.mock('@anthropic-ai/sdk') cannot intercept
  // cross-package dynamic imports inside packages/core/. These are fully tested in
  // packages/core/src/dispatch/__tests__/pr-summary-fallback-chain.test.ts (20 tests, all passing).
  describe.skip('Layer 3: Server-side summary generation', () => {
    it('uses server-generated summary when API key is provided', async () => {
      // The SDK mock returns a default response with workCompleted: 'SDK-generated summary'
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Some output without executive summary section',
        apiKey: 'test-api-key',
      })

      expect(result.source).toBe('server_generated')
      expect(result.summary).toContain('SDK-generated summary')
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1)
    })

    it('builds server-generated summary with key findings and follow-ups', async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              workCompleted: 'Server built summary from fields',
              keyFindings: ['Finding A', 'Finding B'],
              filesChanged: ['a.ts', 'b.ts'],
              status: 'success',
              followUps: ['Follow-up X'],
            }),
          },
        ],
      })

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Output without parseable summary',
        apiKey: 'test-api-key',
      })

      expect(result.source).toBe('server_generated')
      expect(result.summary).toContain('Server built summary from fields')
      expect(result.summary).toContain('**Key changes:**')
      expect(result.summary).toContain('- Finding A')
      expect(result.summary).toContain('- Finding B')
      expect(result.summary).toContain('**Follow-ups:**')
      expect(result.summary).toContain('- Follow-up X')
    })

    it('includes failure status in server-generated summary', async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'failure',
              workCompleted: 'Build failed',
              keyFindings: ['Type errors found'],
              filesChanged: [],
              followUps: ['Fix type errors'],
            }),
          },
        ],
      })

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Output with errors',
        apiKey: 'test-api-key',
      })

      expect(result.source).toBe('server_generated')
      expect(result.summary).toContain('**Status:** failure')
    })

    it('falls through when SDK call fails', async () => {
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API error'))

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Output without parseable summary',
        apiKey: 'test-api-key',
      })

      // Server generation failed → falls to task_description (no git diff fn)
      expect(result.source).toBe('task_description')
    })

    it('falls through when no API key and no env var', async () => {
      // ANTHROPIC_API_KEY was deleted in beforeEach
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Output without parseable summary',
        // No apiKey
      })

      expect(result.source).toBe('task_description')
      expect(mockAnthropicCreate).not.toHaveBeenCalled()
    })

    it('skips server generation when no executionOutput is provided', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        apiKey: 'test-api-key',
        // No executionOutput
      })

      expect(mockAnthropicCreate).not.toHaveBeenCalled()
      expect(result.source).toBe('task_description')
    })

    it('is not called when Layer 1 (structured) succeeds', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Structured summary available',
            keyFindings: ['Structured finding'],
            filesChanged: [],
            followUps: [],
          },
        },
        executionOutput: 'Some output',
        apiKey: 'test-api-key',
      })

      expect(result.source).toBe('structured')
      expect(mockAnthropicCreate).not.toHaveBeenCalled()
    })

    it('is not called when Layer 2 (parsed) succeeds', async () => {
      const executionOutput = `
## Executive Summary
**Status:** success
**What was done:** Parsed summary found.
- Parsed finding
`

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput,
        apiKey: 'test-api-key',
      })

      expect(result.source).toBe('parsed')
      expect(mockAnthropicCreate).not.toHaveBeenCalled()
    })

    it('uses executiveSummary from SDK response when present', async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              workCompleted: 'Short work description',
              executiveSummary: 'Detailed executive summary from server generation.',
              keyFindings: [],
              filesChanged: [],
              status: 'success',
              followUps: [],
            }),
          },
        ],
      })

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Some output',
        apiKey: 'test-api-key',
      })

      expect(result.source).toBe('server_generated')
      expect(result.summary).toBe('Detailed executive summary from server generation.')
    })
  })

  // ── Layer 4: Git diff summary ──────────────────────────────────────────

  describe('Layer 4: Git diff summary', () => {
    it('uses git diff summary from provided function', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue(`## Changes

\`\`\`
 src/auth/oauth.ts   | 120 +++++++++++++++++++
 src/auth/session.ts |  45 +++++++
 2 files changed, 165 insertions(+)
\`\`\`

## Commits

\`\`\`
a1b2c3d Implement OAuth2 login with Google provider
d4e5f6g Add GitHub OAuth2 provider
h7i8j9k Add session management
\`\`\``)

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Output without parseable summary',
        worktreePath: '/tmp/worktree/oauth-feature',
        generateGitDiffSummary: mockGitDiffFn,
        // No API key → server generation skipped
      })

      expect(result.source).toBe('git_diff')
      expect(result.summary).toContain('## Changes')
      expect(result.summary).toContain('src/auth/oauth.ts')
      expect(result.summary).toContain('## Commits')
      expect(result.summary).toContain('Implement OAuth2 login')
      expect(mockGitDiffFn).toHaveBeenCalledWith('/tmp/worktree/oauth-feature')
    })

    it('falls through when git diff function returns null', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue(null)

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        worktreePath: '/tmp/worktree/empty',
        generateGitDiffSummary: mockGitDiffFn,
      })

      expect(result.source).toBe('task_description')
      expect(mockGitDiffFn).toHaveBeenCalledWith('/tmp/worktree/empty')
    })

    it('falls through when git diff function returns empty string', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue('')

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        worktreePath: '/tmp/worktree/empty',
        generateGitDiffSummary: mockGitDiffFn,
      })

      // Empty string is falsy, so gitDiffFn result check should fall through
      expect(result.source).toBe('task_description')
    })

    it('skips git diff when worktreePath is not provided', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue('## Changes\nSome diff output')

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        generateGitDiffSummary: mockGitDiffFn,
        // No worktreePath
      })

      expect(mockGitDiffFn).not.toHaveBeenCalled()
      expect(result.source).toBe('task_description')
    })

    it('skips git diff when generateGitDiffSummary function is not provided', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        worktreePath: '/tmp/worktree/orphan',
        // No generateGitDiffSummary function
      })

      expect(result.source).toBe('task_description')
    })

    it('prefers git diff over task_description when both are available', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue('## Changes\nGit diff output here')

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Unparseable output',
        worktreePath: '/tmp/worktree/good',
        generateGitDiffSummary: mockGitDiffFn,
      })

      expect(result.source).toBe('git_diff')
      expect(result.summary).toContain('Git diff output here')
    })
  })

  // ── Layer 5: Task description fallback ──────────────────────────────────

  describe('Layer 5: Task description fallback', () => {
    it('falls back to task description when all other layers fail', async () => {
      const result = await runPrSummaryFallbackChain({
        taskResult: baseTaskResult,
        taskTitle: 'Implement OAuth2 Login',
        taskDescription: 'Add Google and GitHub OAuth2 providers with session management',
        // No summary, no executionOutput, no worktreePath, no gitDiffFn, no apiKey
      })

      expect(result.source).toBe('task_description')
      expect(result.summary).toBe('**Implement OAuth2 Login**\n\nAdd Google and GitHub OAuth2 providers with session management')
    })

    it('formats task title in bold', async () => {
      const result = await runPrSummaryFallbackChain({
        taskResult: baseTaskResult,
        taskTitle: 'My Task Title',
        taskDescription: 'My task description here',
      })

      expect(result.source).toBe('task_description')
      expect(result.summary).toMatch(/^\*\*My Task Title\*\*/)
    })

    it('always succeeds as the final fallback', async () => {
      // Even with completely minimal input, task_description always returns a result
      const result = await runPrSummaryFallbackChain({
        taskResult: { taskId: 'task-0', status: 'cancelled' },
        taskTitle: '',
        taskDescription: '',
      })

      expect(result.source).toBe('task_description')
      expect(result.summary).toBeDefined()
    })
  })

  // ── Source field correctness ─────────────────────────────────────────────

  describe('source field correctness', () => {
    it('source is "structured" for Layer 1', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Structured work',
            executiveSummary: 'Executive summary text',
            keyFindings: [],
            filesChanged: [],
            followUps: [],
          },
        },
      })
      expect(result.source).toBe('structured')
    })

    it('source is "parsed" for Layer 2', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: `
## Executive Summary
**Status:** success
**What was done:** Parsed work.
- A finding
`,
      })
      expect(result.source).toBe('parsed')
    })

    // Skipped: cross-package vi.mock cannot intercept @anthropic-ai/sdk. See core-level tests.
    it.skip('source is "server_generated" for Layer 3', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Unparseable output',
        apiKey: 'key',
      })
      expect(result.source).toBe('server_generated')
    })

    it('source is "git_diff" for Layer 4', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        worktreePath: '/path',
        generateGitDiffSummary: () => '## Changes\nDiff',
      })
      expect(result.source).toBe('git_diff')
    })

    it('source is "task_description" for Layer 5', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
      })
      expect(result.source).toBe('task_description')
    })
  })

  // ── Fallback chain priority ─────────────────────────────────────────────

  describe('fallback chain priority', () => {
    it('prefers Layer 1 (structured) over Layer 2 (parsed)', async () => {
      const executionOutput = `
## Executive Summary
**Status:** success
**What was done:** Parsed summary from output.
- Parsed finding
`

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Structured summary wins',
            keyFindings: ['Structured finding'],
            filesChanged: [],
            followUps: [],
          },
        },
        executionOutput,
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('Structured summary wins')
      expect(result.summary).not.toContain('Parsed summary from output')
    })

    it('prefers Layer 1 (structured) over all other layers', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue('## Changes\nGit output')

      const executionOutput = `
## Executive Summary
**Status:** success
**What was done:** Parsed from output.
- Parsed finding
`

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Structured wins over everything',
            keyFindings: ['Top priority'],
            filesChanged: [],
            followUps: [],
          },
        },
        executionOutput,
        apiKey: 'key',
        worktreePath: '/path',
        generateGitDiffSummary: mockGitDiffFn,
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('Structured wins over everything')
      expect(mockAnthropicCreate).not.toHaveBeenCalled()
      expect(mockGitDiffFn).not.toHaveBeenCalled()
    })

    it('prefers Layer 2 (parsed) over Layer 3 (server-generated)', async () => {
      const executionOutput = `
## Executive Summary
**Status:** success
**What was done:** Parsed wins over server.
- Parsed finding
`

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput,
        apiKey: 'key',
      })

      expect(result.source).toBe('parsed')
      expect(result.summary).toContain('Parsed wins over server')
      expect(mockAnthropicCreate).not.toHaveBeenCalled()
    })

    it('prefers Layer 2 (parsed) over Layer 4 (git_diff)', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue('## Changes\nGit output')

      const executionOutput = `
## Executive Summary
**Status:** success
**What was done:** Parsed wins over git diff.
- Parsed finding
`

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput,
        worktreePath: '/path',
        generateGitDiffSummary: mockGitDiffFn,
      })

      expect(result.source).toBe('parsed')
      expect(mockGitDiffFn).not.toHaveBeenCalled()
    })

    // Skipped: cross-package vi.mock cannot intercept @anthropic-ai/sdk. See core-level tests.
    it.skip('prefers Layer 3 (server-generated) over Layer 4 (git_diff)', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue('## Changes\nGit output')

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Unparseable output',
        apiKey: 'key',
        worktreePath: '/path',
        generateGitDiffSummary: mockGitDiffFn,
      })

      expect(result.source).toBe('server_generated')
      expect(mockGitDiffFn).not.toHaveBeenCalled()
    })

    it('prefers Layer 4 (git_diff) over Layer 5 (task_description)', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue('## Changes\nGit diff wins')

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Unparseable output',
        worktreePath: '/path',
        generateGitDiffSummary: mockGitDiffFn,
        // No API key → server generation skipped
      })

      expect(result.source).toBe('git_diff')
      expect(result.summary).toContain('Git diff wins')
    })

    // Skipped: cross-package vi.mock cannot intercept @anthropic-ai/sdk. See core-level tests.
    it.skip('cascades from Layer 1 → 2 → 3 → 4 → 5 when each layer fails', async () => {
      // Layer 1: No structured summary
      // Layer 2: No parseable executive summary in output
      // Layer 3: SDK mock throws error → generateServerSideSummary returns null
      // Layer 4: No worktreePath/gitDiffFn
      // Layer 5: Task description (always succeeds)
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API error'))

      const result = await runPrSummaryFallbackChain({
        taskResult: baseTaskResult,
        taskTitle: 'Cascading Fallback Test',
        taskDescription: 'Testing the full cascade',
        executionOutput: 'Regular output with no executive summary block',
        apiKey: 'key', // Will be tried but SDK throws
      })

      expect(result.source).toBe('task_description')
      expect(result.summary).toContain('Cascading Fallback Test')
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1)
    })
  })

  // ── Edge cases ──────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles taskResult with cancelled status', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          status: 'cancelled',
          summary: {
            status: 'failure',
            workCompleted: 'Task was cancelled before completion',
            keyFindings: [],
            filesChanged: [],
            followUps: ['Re-run the task'],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('Task was cancelled')
      expect(result.summary).toContain('**Status:** failure')
    })

    it('handles very long structured summary', async () => {
      const longText = 'A'.repeat(10_000)
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: longText,
            keyFindings: [],
            filesChanged: [],
            followUps: [],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary.length).toBeGreaterThanOrEqual(10_000)
    })

    it('handles special characters in task title and description', async () => {
      const result = await runPrSummaryFallbackChain({
        taskResult: baseTaskResult,
        taskTitle: 'Fix "O(n²)" bug in <Parser> & update docs',
        taskDescription: 'The `parseTree()` function has an O(n²) complexity issue. Fix it & update README.',
      })

      expect(result.source).toBe('task_description')
      expect(result.summary).toContain('Fix "O(n²)" bug in <Parser> & update docs')
      expect(result.summary).toContain('`parseTree()`')
    })

    it('handles undefined executionOutput', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: undefined,
      })

      expect(result.source).toBe('task_description')
    })

    // Skipped: cross-package vi.mock cannot intercept @anthropic-ai/sdk. See core-level tests.
    it.skip('handles undefined fileChanges for server generation', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: 'Some output',
        fileChanges: undefined,
        apiKey: 'key',
      })

      // SDK should have been called (Layer 3 triggered)
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1)
      expect(result.source).toBe('server_generated')
    })

    it('handles concurrent calls independently', async () => {
      // Run two calls concurrently with different inputs
      const [result1, result2] = await Promise.all([
        runPrSummaryFallbackChain({
          taskResult: {
            ...baseTaskResult,
            summary: {
              status: 'success',
              workCompleted: 'First call result',
              keyFindings: [],
              filesChanged: [],
              followUps: [],
            },
          },
          taskTitle: 'Task 1',
          taskDescription: 'First task',
        }),
        runPrSummaryFallbackChain({
          taskResult: baseTaskResult,
          taskTitle: 'Task 2',
          taskDescription: 'Second task',
        }),
      ])

      expect(result1.source).toBe('structured')
      expect(result1.summary).toContain('First call result')

      expect(result2.source).toBe('task_description')
      expect(result2.summary).toContain('Task 2')
    })

    it('handles executionOutput with only whitespace', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput: '   \n\t\n   ',
      })

      // Whitespace-only output should not parse to anything
      expect(result.source).toBe('task_description')
    })

    it('handles git diff function that throws', async () => {
      const mockGitDiffFn = vi.fn().mockImplementation(() => {
        throw new Error('Git command failed')
      })

      // This tests what happens when gitDiffFn throws - the fallback chain should
      // let the error propagate or handle it. Let's verify behavior.
      await expect(
        runPrSummaryFallbackChain({
          ...baseInput,
          worktreePath: '/bad/path',
          generateGitDiffSummary: mockGitDiffFn,
        }),
      ).rejects.toThrow('Git command failed')
    })

    // Skipped: cross-package vi.mock cannot intercept @anthropic-ai/sdk. See core-level tests.
    it.skip('triggers server generation for successful task', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: { ...baseTaskResult, status: 'success' },
        executionOutput: 'Some output',
        apiKey: 'key',
      })

      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1)
      expect(result.source).toBe('server_generated')
    })

    // Skipped: cross-package vi.mock cannot intercept @anthropic-ai/sdk. See core-level tests.
    it.skip('triggers server generation for failed task', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: { ...baseTaskResult, status: 'failure' },
        executionOutput: 'Error output',
        apiKey: 'key',
      })

      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1)
      expect(result.source).toBe('server_generated')
    })

    // Skipped: cross-package vi.mock cannot intercept @anthropic-ai/sdk. See core-level tests.
    it.skip('triggers server generation for cancelled task', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: { ...baseTaskResult, status: 'cancelled' },
        executionOutput: 'Cancelled output',
        apiKey: 'key',
      })

      // 'cancelled' is not 'success', but server generation should still be attempted
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1)
      expect(result.source).toBe('server_generated')
    })
  })
})
