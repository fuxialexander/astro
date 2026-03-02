/**
 * PR Body Update Hook — Integration Tests
 *
 * Tests the pr-body-update-hook which updates PR descriptions with rich summaries
 * after task completion. Covers:
 *
 * 1. Hook triggers on task.completed with prNumber
 * 2. Hook skips when no prNumber
 * 3. Hook formats PR body correctly with structured summary (Layer 1)
 * 4. Hook formats PR body from executive summary in stdout (Layer 2)
 * 5. Hook falls back to file changes summary (Layer 4)
 * 6. Hook falls back to task description (Layer 5)
 * 7. Hook handles GitHub API errors gracefully
 * 8. Hook handles missing GitHub token gracefully
 * 9. Hook resolves repository from various formats
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TaskCompletedEvent } from '../server/lib/events/types.js'
import type { PlanNode } from '../packages/core/src/types.js'
import type { TaskResult } from '../packages/core/src/dispatch/types.js'

// ── Mocks ─────────────────────────────────────────────────────────────────

// Mock the database module — resolveGitHubToken + project lookup queries use db
// Each DB chain call (select→from→where→limit or select→from→innerJoin→where→limit)
// ultimately resolves to whatever mockDbLimit returns.
const mockDbLimit = vi.fn()

vi.mock('../server/lib/db/index.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockDbLimit(...args),
        }),
        innerJoin: () => ({
          where: () => ({
            limit: (...args: unknown[]) => mockDbLimit(...args),
          }),
        }),
      }),
    }),
  },
}))

vi.mock('../server/lib/db/schema.js', () => ({
  projects: { id: 'id', ownerId: 'owner_id', teamId: 'team_id', githubOwner: 'github_owner', githubRepo: 'github_repo', repository: 'repository' },
  githubConnections: { userId: 'user_id', accessToken: 'access_token' },
  teamMembers: { userId: 'user_id', teamId: 'team_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}))

// Mock updatePullRequestBody from github-api
const mockUpdatePullRequestBody = vi.fn()
vi.mock('../server/plugins/channel-github/github-api.js', () => ({
  updatePullRequestBody: (...args: unknown[]) => mockUpdatePullRequestBody(...args),
}))

// Mock generateServerSideSummary (Layer 3 — Anthropic API)
const mockGenerateServerSideSummary = vi.fn()
vi.mock('../packages/core/src/dispatch/summary-utils.js', () => ({
  generateServerSideSummary: (...args: unknown[]) => mockGenerateServerSideSummary(...args),
}))

// ── Helpers ───────────────────────────────────────────────────────────────

function createMockNode(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    id: 'node-1',
    projectId: 'proj-1',
    title: 'Implement authentication',
    description: 'Add JWT-based authentication to the API',
    status: 'auto_verified',
    type: 'task',
    position: { x: 0, y: 0 },
    parentId: null,
    dependencies: [],
    verification: 'auto',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function createMockResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    taskId: 'task-1',
    status: 'success',
    metrics: { durationMs: 5000 },
    ...overrides,
  }
}

function createMockEvent(overrides: Partial<TaskCompletedEvent> = {}): TaskCompletedEvent {
  return {
    type: 'task.completed',
    taskId: 'task-1',
    nodeId: 'node-1',
    projectId: 'proj-1',
    executionId: 'exec-1',
    result: createMockResult(),
    node: createMockNode(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      description: '',
      visionDoc: '',
      status: 'active',
      repository: 'myowner/myrepo',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    timestamp: new Date(),
    ...overrides,
  }
}

/**
 * Set up the standard DB mock chain:
 * 1st mockDbLimit call → project lookup (returns project row)
 * Subsequent calls → token resolution queries (return empty by default)
 *
 * When GITHUB_TOKEN env is set, token resolution DB calls are skipped.
 */
function setupDbMocks(project: {
  ownerId: string
  teamId: string | null
  githubOwner?: string | null
  githubRepo?: string | null
  repository?: string | null
}) {
  // First call: project lookup
  mockDbLimit.mockResolvedValueOnce([project])
  // Second call: owner's GitHub connection (if env token not set)
  mockDbLimit.mockResolvedValueOnce([])
  // Third call: team member's GitHub connection (if env token not set and teamId present)
  mockDbLimit.mockResolvedValueOnce([])
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('PR Body Update Hook', () => {
  let prBodyUpdateHook: (event: TaskCompletedEvent) => Promise<void>
  let originalGithubToken: string | undefined
  let originalAstroBaseUrl: string | undefined

  beforeEach(async () => {
    // Save environment
    originalGithubToken = process.env.GITHUB_TOKEN
    originalAstroBaseUrl = process.env.ASTRO_BASE_URL
    delete process.env.GITHUB_TOKEN
    delete process.env.ASTRO_BASE_URL

    // Reset all mocks — including "once" implementation queues
    vi.resetAllMocks()
    mockUpdatePullRequestBody.mockResolvedValue({ success: true })
    mockGenerateServerSideSummary.mockResolvedValue(null)
    // Default: DB returns empty for any unscheduled calls
    mockDbLimit.mockResolvedValue([])

    // Dynamic import to pick up mocks
    const mod = await import('../server/lib/events/hooks/pr-body-update-hook.js')
    prBodyUpdateHook = mod.prBodyUpdateHook as (event: TaskCompletedEvent) => Promise<void>
  })

  afterEach(() => {
    // Restore environment
    if (originalGithubToken !== undefined) {
      process.env.GITHUB_TOKEN = originalGithubToken
    } else {
      delete process.env.GITHUB_TOKEN
    }
    if (originalAstroBaseUrl !== undefined) {
      process.env.ASTRO_BASE_URL = originalAstroBaseUrl
    } else {
      delete process.env.ASTRO_BASE_URL
    }
  })

  // ── 1. Event type filtering ──────────────────────────────────────────

  it('should skip if event is not task.completed', async () => {
    const event = { type: 'task.started' } as unknown as TaskCompletedEvent

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).not.toHaveBeenCalled()
  })

  // ── 2. prNumber presence ─────────────────────────────────────────────

  it('should skip when no prNumber on node or result', async () => {
    const event = createMockEvent({
      node: createMockNode({ prNumber: undefined }),
      result: createMockResult({ prNumber: undefined }),
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).not.toHaveBeenCalled()
  })

  it('should trigger when prNumber is on node (set by pr-creation-hook)', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      result: createMockResult({ prNumber: undefined }),
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).toHaveBeenCalledWith(
      'test-gh-token',
      'myowner',
      'myrepo',
      42,
      expect.any(String),
    )
  })

  it('should trigger when prNumber is on result (fallback)', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    const event = createMockEvent({
      node: createMockNode({ prNumber: undefined }),
      result: createMockResult({ prNumber: 99 }),
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).toHaveBeenCalledWith(
      'test-gh-token',
      'myowner',
      'myrepo',
      99,
      expect.any(String),
    )
  })

  // ── 3. PR body with structured summary (Layer 1) ─────────────────────

  it('should format PR body correctly with structured summary', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    const event = createMockEvent({
      node: createMockNode({
        prNumber: 42,
        githubIssueNumber: 15,
      }),
      result: createMockResult({
        prNumber: 42,
        summary: {
          status: 'success',
          workCompleted: 'Added JWT authentication with refresh tokens',
          keyFindings: [
            'Implemented access/refresh token pair',
            'Added middleware for route protection',
          ],
          filesChanged: ['src/auth.ts', 'src/middleware.ts', 'tests/auth.test.ts'],
          followUps: [
            'Run integration tests to verify token flow',
            'Consider adding rate limiting',
          ],
        },
      }),
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).toHaveBeenCalledTimes(1)
    const prBody = mockUpdatePullRequestBody.mock.calls[0][4] as string

    // Verify structured sections
    expect(prBody).toContain('## Summary')
    expect(prBody).toContain('Added JWT authentication with refresh tokens')

    // Key findings appear as changes
    expect(prBody).toContain('## Changes')
    expect(prBody).toContain('- Implemented access/refresh token pair')
    expect(prBody).toContain('- Added middleware for route protection')

    // Files changed section
    expect(prBody).toContain('## Files Changed')
    expect(prBody).toContain('`src/auth.ts`')
    expect(prBody).toContain('`src/middleware.ts`')

    // Test plan extracted from follow-ups matching test/verify/check patterns
    expect(prBody).toContain('## Test Plan')
    expect(prBody).toContain('Run integration tests to verify token flow')

    // Non-test follow-ups appear in changes section
    expect(prBody).toContain('Consider adding rate limiting')

    // Related issue
    expect(prBody).toContain('## Related Issue')
    expect(prBody).toContain('Closes #15')

    // Footer
    expect(prBody).toContain('Astro')
  })

  it('should use executiveSummary from structured summary when available', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    const summary = {
      status: 'success' as const,
      workCompleted: 'Short description',
      keyFindings: [],
      filesChanged: [],
      followUps: [],
      executiveSummary: 'This is a detailed executive summary spanning multiple sentences.',
    }

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      result: createMockResult({ summary }),
    })

    await prBodyUpdateHook(event)

    const prBody = mockUpdatePullRequestBody.mock.calls[0][4] as string
    // executiveSummary should be preferred over workCompleted
    expect(prBody).toContain('This is a detailed executive summary spanning multiple sentences.')
  })

  // ── 4. PR body from executive summary in stdout (Layer 2) ────────────

  it('should parse executive summary from stdout output', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    const stdout = `
Some build output here...

## Executive Summary
**Status:** success
**What was done:** Refactored the authentication module to use JWT tokens.
- Added access token generation
- Added refresh token rotation
**Follow-ups:**
- Run full test suite

## Other Section
More content here
`

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      result: createMockResult({
        stdout,
        // No structured summary
        summary: undefined,
      }),
    })

    await prBodyUpdateHook(event)

    const prBody = mockUpdatePullRequestBody.mock.calls[0][4] as string
    expect(prBody).toContain('## Summary')
    // Should contain the executive summary content
    expect(prBody).toContain('Refactored the authentication module to use JWT tokens')
  })

  // ── 5. File changes fallback (Layer 4) ───────────────────────────────

  it('should fall back to file changes summary when no summary or stdout', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    // Mock Layer 3 to return null (no API key / failure)
    mockGenerateServerSideSummary.mockResolvedValue(null)

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      result: createMockResult({
        filesChanged: [
          { path: 'src/auth.ts', diff: '+export function login()' },
          { path: 'src/utils.ts' },
        ],
        // No summary, no stdout
        summary: undefined,
        stdout: undefined,
      }),
    })

    await prBodyUpdateHook(event)

    const prBody = mockUpdatePullRequestBody.mock.calls[0][4] as string
    expect(prBody).toContain('Completed task: Implement authentication')
    expect(prBody).toContain('Modified 2 file(s)')
    expect(prBody).toContain('`src/auth.ts`')
    expect(prBody).toContain('`src/utils.ts`')
  })

  // ── 6. Task description fallback (Layer 5) ───────────────────────────

  it('should fall back to task description when no other data available', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })
    mockGenerateServerSideSummary.mockResolvedValue(null)

    const event = createMockEvent({
      node: createMockNode({
        prNumber: 42,
        title: 'Implement auth',
        description: 'Add JWT-based authentication to the API',
      }),
      result: createMockResult({
        // No summary, no stdout, no filesChanged
        summary: undefined,
        stdout: undefined,
        filesChanged: undefined,
      }),
    })

    await prBodyUpdateHook(event)

    const prBody = mockUpdatePullRequestBody.mock.calls[0][4] as string
    expect(prBody).toContain('Add JWT-based authentication to the API')
  })

  // ── 7. GitHub API error handling ─────────────────────────────────────

  it('should handle GitHub API update failure gracefully (returns error)', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    mockUpdatePullRequestBody.mockResolvedValue({
      success: false,
      error: 'Not Found',
    })

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      result: createMockResult({ prNumber: 42 }),
    })

    // Should not throw — error result is logged but hook completes
    await expect(prBodyUpdateHook(event)).resolves.not.toThrow()

    expect(mockUpdatePullRequestBody).toHaveBeenCalled()
  })

  it('should propagate thrown error from GitHub API (transport catches it)', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    mockUpdatePullRequestBody.mockRejectedValue(new Error('Network timeout'))

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      result: createMockResult({ prNumber: 42 }),
    })

    // The hook itself does NOT have a try-catch around updatePullRequestBody.
    // The event transport catches thrown errors from hooks (defense-in-depth).
    // So calling the hook directly will reject:
    await expect(prBodyUpdateHook(event)).rejects.toThrow('Network timeout')
  })

  // ── 8. Missing GitHub token ──────────────────────────────────────────

  it('should skip when no GitHub token is available', async () => {
    // No GITHUB_TOKEN env var
    delete process.env.GITHUB_TOKEN

    // DB returns project but no token in any resolution path
    setupDbMocks({ ownerId: 'user-1', teamId: 'team-1', repository: 'myowner/myrepo' })

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).not.toHaveBeenCalled()
  })

  // ── 9. Repository resolution ─────────────────────────────────────────

  it('should resolve repository from project.githubOwner/githubRepo', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({
      ownerId: 'user-1',
      teamId: null,
      githubOwner: 'gh-owner',
      githubRepo: 'gh-repo',
    })

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      project: {
        id: 'proj-1',
        name: 'Test',
        description: '',
        visionDoc: '',
        status: 'active',
        githubOwner: 'gh-owner',
        githubRepo: 'gh-repo',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).toHaveBeenCalledWith(
      'test-gh-token',
      'gh-owner',
      'gh-repo',
      42,
      expect.any(String),
    )
  })

  it('should resolve repository from git URL format', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({
      ownerId: 'user-1',
      teamId: null,
      repository: 'https://github.com/org-name/cool-repo.git',
    })

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      project: {
        id: 'proj-1',
        name: 'Test',
        description: '',
        visionDoc: '',
        status: 'active',
        repository: 'https://github.com/org-name/cool-repo.git',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).toHaveBeenCalledWith(
      'test-gh-token',
      'org-name',
      'cool-repo',
      42,
      expect.any(String),
    )
  })

  it('should skip when repository cannot be determined', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    // DB project has no repo info at all
    setupDbMocks({
      ownerId: 'user-1',
      teamId: null,
      githubOwner: null,
      githubRepo: null,
      repository: null,
    })

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      // Event project has no repo info either
      project: {
        id: 'proj-1',
        name: 'Test',
        description: '',
        visionDoc: '',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).not.toHaveBeenCalled()
  })

  // ── 10. DB project lookup failure ────────────────────────────────────

  it('should handle project not found in database', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    // First call: project lookup returns empty (no project found)
    mockDbLimit.mockResolvedValueOnce([])

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).not.toHaveBeenCalled()
  })

  it('should handle database query error gracefully', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    // First call: project lookup throws
    mockDbLimit.mockRejectedValueOnce(new Error('Connection refused'))

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
    })

    // Should not throw — DB error is caught in the try-catch block
    await expect(prBodyUpdateHook(event)).resolves.not.toThrow()
    expect(mockUpdatePullRequestBody).not.toHaveBeenCalled()
  })

  // ── 11. Astro URL in PR body ─────────────────────────────────────────

  it('should include Astro task link in PR body', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    process.env.ASTRO_BASE_URL = 'https://app.astroanywhere.com'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      result: createMockResult({ prNumber: 42 }),
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).toHaveBeenCalled()
    const prBody = mockUpdatePullRequestBody.mock.calls[0][4] as string
    expect(prBody).toContain('https://app.astroanywhere.com/project/proj-1/task/node-1')
    expect(prBody).toContain('View task in Astro')
  })

  // ── 12. GitHub issue URL reference ───────────────────────────────────

  it('should include githubIssueUrl as related issue', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    const event = createMockEvent({
      node: createMockNode({
        prNumber: 42,
        githubIssueUrl: 'https://github.com/myowner/myrepo/issues/10',
      }),
      result: createMockResult({ prNumber: 42 }),
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).toHaveBeenCalled()
    const prBody = mockUpdatePullRequestBody.mock.calls[0][4] as string
    expect(prBody).toContain('## Related Issue')
    expect(prBody).toContain('Closes https://github.com/myowner/myrepo/issues/10')
  })

  // ── 13. Files changed capping ────────────────────────────────────────

  it('should cap files changed at 30 entries', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })
    mockGenerateServerSideSummary.mockResolvedValue(null)

    const filesChanged = Array.from({ length: 35 }, (_, i) => ({
      path: `src/file-${i}.ts`,
    }))

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      result: createMockResult({
        filesChanged,
        summary: undefined,
        stdout: undefined,
      }),
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).toHaveBeenCalled()
    const prBody = mockUpdatePullRequestBody.mock.calls[0][4] as string
    // First 30 files should be present
    expect(prBody).toContain('`src/file-0.ts`')
    expect(prBody).toContain('`src/file-29.ts`')
    // "...and X more" message
    expect(prBody).toContain('...and 5 more files')
  })

  // ── 14. Layer 3 — Server-generated summary ──────────────────────────

  it('should use server-generated summary when stdout has no exec summary', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    mockGenerateServerSideSummary.mockResolvedValue({
      workCompleted: 'Server-generated work description',
      keyFindings: ['Finding 1', 'Finding 2'],
      filesChanged: ['src/main.ts'],
      status: 'success',
      followUps: [],
    })

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      result: createMockResult({
        stdout: 'Some output without executive summary heading',
        summary: undefined,
      }),
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).toHaveBeenCalled()
    const prBody = mockUpdatePullRequestBody.mock.calls[0][4] as string
    expect(prBody).toContain('Server-generated work description')
    expect(prBody).toContain('Finding 1')
  })

  it('should handle server-generated summary failure gracefully', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    // Layer 3 throws
    mockGenerateServerSideSummary.mockRejectedValue(new Error('API timeout'))

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      result: createMockResult({
        stdout: 'Some output without executive summary',
        summary: undefined,
        filesChanged: [{ path: 'src/main.ts' }],
      }),
    })

    await prBodyUpdateHook(event)

    // Should fall through to Layer 4 (file changes)
    expect(mockUpdatePullRequestBody).toHaveBeenCalled()
    const prBody = mockUpdatePullRequestBody.mock.calls[0][4] as string
    expect(prBody).toContain('`src/main.ts`')
  })

  // ── 15. PR body footer ──────────────────────────────────────────────

  it('should include Astro branding footer', async () => {
    process.env.GITHUB_TOKEN = 'test-gh-token'
    setupDbMocks({ ownerId: 'user-1', teamId: null, repository: 'myowner/myrepo' })

    const event = createMockEvent({
      node: createMockNode({ prNumber: 42 }),
      result: createMockResult({ prNumber: 42 }),
    })

    await prBodyUpdateHook(event)

    expect(mockUpdatePullRequestBody).toHaveBeenCalled()
    const prBody = mockUpdatePullRequestBody.mock.calls[0][4] as string
    expect(prBody).toContain('PR description generated by')
    expect(prBody).toContain('astroanywhere.com')
  })
})
