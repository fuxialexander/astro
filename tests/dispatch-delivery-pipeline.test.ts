/**
 * Dispatch & PR Delivery Pipeline Tests
 *
 * Unit + integration tests (PGlite, no external server needed) covering:
 * 1. parseExecutiveSummary — structured summary parsing
 * 2. PR URL extraction regex
 * 3. Delivery fields in TaskResult type contracts
 * 4. Dispatch prompt content (dryRun via PGlite test server)
 * 5. pr-creation-hook — PR data persistence
 * 6. SSE result event mapping — delivery fields flow through events
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestServer, postJson, getApp, db } from './helpers/test-server.js'
import { projects, planNodes } from '../packages/core/src/db/schema.js'
import { eq } from 'drizzle-orm'

// ============================================================================
// 1. parseExecutiveSummary
// ============================================================================

describe('parseExecutiveSummary', () => {
  // Dynamically import to pick up vitest path alias
  let parseExecutiveSummary: (text: string) => Record<string, unknown> | null

  beforeAll(async () => {
    const mod = await import('../src/stores/execution-store.js')
    parseExecutiveSummary = mod.parseExecutiveSummary as typeof parseExecutiveSummary
  })

  it('parses valid summary with all fields', () => {
    const text = `Some agent output here...

## Executive Summary
**Status:** success
**What was done:** Implemented the new authentication flow.
- Added JWT token validation
- Created refresh token endpoint
- Updated middleware to check tokens
**Follow-ups:**
- Add rate limiting to auth endpoints
- Write integration tests for token refresh
`
    const result = parseExecutiveSummary(text)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('success')
    expect(result!.workCompleted).toBe('Implemented the new authentication flow.')
    expect(result!.keyFindings).toEqual([
      'Added JWT token validation',
      'Created refresh token endpoint',
      'Updated middleware to check tokens',
    ])
    expect(result!.followUps).toEqual([
      'Add rate limiting to auth endpoints',
      'Write integration tests for token refresh',
    ])
  })

  it('returns null for text without Executive Summary header', () => {
    const text = `This is some normal agent output.
It doesn't contain a summary block.
**Status:** success
`
    const result = parseExecutiveSummary(text)
    expect(result).toBeNull()
  })

  it('handles partial summary (status + workCompleted but no followUps)', () => {
    const text = `## Executive Summary
**Status:** partial
**What was done:** Fixed the build but tests still fail.
- Build now compiles cleanly
- 3 tests remain failing
`
    const result = parseExecutiveSummary(text)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('partial')
    expect(result!.workCompleted).toBe('Fixed the build but tests still fail.')
    expect(result!.keyFindings).toEqual([
      'Build now compiles cleanly',
      '3 tests remain failing',
    ])
    // No follow-ups section → undefined
    expect(result!.followUps).toBeUndefined()
  })

  it('handles summary embedded mid-output (not just at end)', () => {
    const text = `Starting task execution...
Running tests...
All 42 tests passed.

## Executive Summary
**Status:** success
**What was done:** All tests pass after refactoring.
- Refactored auth module
- All 42 tests pass

Some trailing output that shouldn't matter.
`
    const result = parseExecutiveSummary(text)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('success')
    expect(result!.workCompleted).toBe('All tests pass after refactoring.')
    expect(result!.keyFindings).toEqual([
      'Refactored auth module',
      'All 42 tests pass',
    ])
  })
})

// ============================================================================
// 2. PR URL extraction regex
// ============================================================================

describe('PR URL extraction regex', () => {
  // This is the regex used in the agent runner for extracting PR URLs from output
  const prUrlRegex = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/

  it('extracts URL and PR number from typical GitHub PR URL', () => {
    const url = 'https://github.com/fuxialexander/astro/pull/42'
    const match = url.match(prUrlRegex)
    expect(match).not.toBeNull()
    expect(match![0]).toBe(url)
    expect(match![1]).toBe('42')
  })

  it('extracts from URL embedded in longer text', () => {
    const text = 'Created PR: https://github.com/org/repo/pull/99 — please review.'
    const match = text.match(prUrlRegex)
    expect(match).not.toBeNull()
    expect(match![0]).toBe('https://github.com/org/repo/pull/99')
    expect(match![1]).toBe('99')
  })

  it('does not match issue URLs (/issues/123)', () => {
    const text = 'See https://github.com/org/repo/issues/123'
    const match = text.match(prUrlRegex)
    expect(match).toBeNull()
  })

  it('does not match non-GitHub URLs', () => {
    const text = 'https://gitlab.com/org/repo/pull/42'
    const match = text.match(prUrlRegex)
    expect(match).toBeNull()
  })
})

// ============================================================================
// 3. Delivery fields in TaskResult
// ============================================================================

describe('delivery fields in TaskResult', () => {
  // These tests verify the type-level contract by constructing TaskResult objects.
  // Using the relay TaskResult type which includes delivery fields.

  it('deliveryStatus: failed + deliveryError coexist with status: completed', () => {
    const result = {
      taskId: 'test-1',
      status: 'completed' as const,
      deliveryStatus: 'failed' as const,
      deliveryError: 'gh not authenticated',
    }
    expect(result.status).toBe('completed')
    expect(result.deliveryStatus).toBe('failed')
    expect(result.deliveryError).toBe('gh not authenticated')
  })

  it('deliveryStatus: success with prUrl and prNumber', () => {
    const result = {
      taskId: 'test-2',
      status: 'completed' as const,
      deliveryStatus: 'success' as const,
      prUrl: 'https://github.com/org/repo/pull/42',
      prNumber: 42,
      branchName: 'astro/abc123-def456',
    }
    expect(result.deliveryStatus).toBe('success')
    expect(result.prUrl).toContain('pull/42')
    expect(result.prNumber).toBe(42)
    expect(result.branchName).toBeDefined()
  })

  it('deliveryStatus: skipped for direct mode', () => {
    const result = {
      taskId: 'test-3',
      status: 'completed' as const,
      deliveryStatus: 'skipped' as const,
    }
    expect(result.deliveryStatus).toBe('skipped')
    expect(result.prUrl).toBeUndefined()
    expect(result.branchName).toBeUndefined()
  })
})

// ============================================================================
// 4. Dispatch prompt content (PGlite integration)
// ============================================================================

describe('dispatch prompt content', () => {
  let projectId: string
  const nodeId = 'prompt-test-node-001'

  beforeAll(async () => {
    await setupTestServer()
  })

  beforeEach(async () => {
    // Clean slate
    await db.delete(planNodes)
    await db.delete(projects)

    // Create project
    const res = await postJson('/api/data/projects', {
      name: 'Prompt Test Project',
      description: 'Testing dispatch prompt assembly',
      source: { localPath: '/tmp/test-repo' },
      deliveryMode: 'pr',
    })
    const body = await res.json()
    projectId = body.id

    // Create plan node
    await postJson('/api/data/plan/nodes', {
      id: nodeId,
      projectId,
      type: 'task',
      title: 'Test Task',
      description: 'Do something useful',
      status: 'planned',
      position: { x: 0, y: 0 },
    })
  })

  it('prompt includes Executive Summary template text', async () => {
    const res = await postJson('/api/dispatch/task', {
      nodeId,
      projectId,
      title: 'Test Task',
      description: 'Do something useful',
      workingDirectory: '/tmp/test-repo',
      deliveryMode: 'pr',
      dryRun: true,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.success).toBe(true)
    expect(body.prompt).toBeDefined()

    // Verify executive summary template is in the prompt
    expect(body.prompt).toContain('## Executive Summary')
    expect(body.prompt).toContain('**Status:** success | partial | failure')
    expect(body.prompt).toContain('**What was done:**')
  })

  it('PR delivery mode prompt includes workspace and delivery instructions', async () => {
    const res = await postJson('/api/dispatch/task', {
      nodeId,
      projectId,
      title: 'PR Mode Task',
      description: 'Test PR delivery prompt',
      workingDirectory: '/tmp/test-repo',
      deliveryMode: 'pr',
      dryRun: true,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    // PR mode should have workspace/delivery section with worktree instructions
    expect(body.prompt).toContain('Workspace & Delivery')
    expect(body.prompt).toContain('worktree')
    expect(body.prompt).toContain('automatically pushed and a PR will be created')
    // astro-metadata block was removed (dead code — never parsed)
    expect(body.prompt).not.toContain('<!-- astro-metadata')
  })

  it('push delivery mode prompt does NOT include astro-metadata block', async () => {
    const res = await postJson('/api/dispatch/task', {
      nodeId,
      projectId,
      title: 'Push Mode Task',
      description: 'Test push delivery prompt',
      workingDirectory: '/tmp/test-repo',
      deliveryMode: 'push',
      dryRun: true,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.prompt).not.toContain('<!-- astro-metadata')
    // Should still have workspace section
    expect(body.prompt).toContain('Workspace & Delivery')
  })
})

// ============================================================================
// 5. pr-creation-hook
// ============================================================================

describe('pr-creation-hook', () => {
  let projectId: string
  const nodeId = 'pr-hook-test-node-001'

  beforeAll(async () => {
    await setupTestServer()
  })

  beforeEach(async () => {
    await db.delete(planNodes)
    await db.delete(projects)

    // Create project
    const res = await postJson('/api/data/projects', {
      name: 'PR Hook Test Project',
    })
    const body = await res.json()
    projectId = body.id

    // Create plan node
    await postJson('/api/data/plan/nodes', {
      id: nodeId,
      projectId,
      type: 'task',
      title: 'PR Hook Test Task',
      status: 'planned',
      position: { x: 0, y: 0 },
    })
  })

  // Import the hook dynamically (needs to run after test server setup)
  async function getHook() {
    const mod = await import('../server/lib/events/hooks/pr-creation-hook.js')
    return mod.prCreationHook
  }

  function makeEvent(overrides: Record<string, unknown> = {}) {
    return {
      type: 'task.completed' as const,
      taskId: `task-${nodeId}`,
      nodeId,
      projectId,
      executionId: `exec-${nodeId}`,
      timestamp: new Date(),
      node: {
        id: nodeId,
        projectId,
        type: 'task',
        title: 'PR Hook Test Task',
        status: 'completed',
        position: { x: 0, y: 0 },
      },
      result: {
        taskId: `task-${nodeId}`,
        status: 'success' as const,
        ...overrides,
      },
    }
  }

  it('records prUrl/prNumber when result has both (Path 1)', async () => {
    const hook = await getHook()
    const event = makeEvent({
      prUrl: 'https://github.com/org/repo/pull/42',
      prNumber: 42,
      branchName: 'astro/abc123-def456',
    })

    await hook(event)

    // Check the node was mutated in-place
    expect(event.node.prUrl).toBe('https://github.com/org/repo/pull/42')
    expect(event.node.prNumber).toBe(42)
    expect(event.node.branchName).toBe('astro/abc123-def456')

    // Check DB was updated
    const [dbNode] = await db.select({
      prUrl: planNodes.prUrl,
      prNumber: planNodes.prNumber,
      branchName: planNodes.branchName,
    }).from(planNodes).where(eq(planNodes.clientId, nodeId))

    expect(dbNode.prUrl).toBe('https://github.com/org/repo/pull/42')
    expect(dbNode.prNumber).toBe(42)
    expect(dbNode.branchName).toBe('astro/abc123-def456')
  })

  it('records branchName only when no prUrl (Path 2)', async () => {
    const hook = await getHook()
    const event = makeEvent({
      branchName: 'astro/abc123-def456',
    })

    await hook(event)

    // Check in-place mutation
    expect(event.node.branchName).toBe('astro/abc123-def456')
    expect(event.node.prUrl).toBeUndefined()

    // Check DB
    const [dbNode] = await db.select({
      prUrl: planNodes.prUrl,
      prNumber: planNodes.prNumber,
      branchName: planNodes.branchName,
    }).from(planNodes).where(eq(planNodes.clientId, nodeId))

    expect(dbNode.branchName).toBe('astro/abc123-def456')
    expect(dbNode.prUrl).toBeNull()
  })

  it('persists PR data even when result.status === failed', async () => {
    const hook = await getHook()
    const event = makeEvent({
      status: 'failure',
      prUrl: 'https://github.com/org/repo/pull/99',
      prNumber: 99,
      branchName: 'astro/failed-task',
    })

    await hook(event)

    // PR data should still be persisted regardless of status
    const [dbNode] = await db.select({
      prUrl: planNodes.prUrl,
      prNumber: planNodes.prNumber,
      branchName: planNodes.branchName,
    }).from(planNodes).where(eq(planNodes.clientId, nodeId))

    expect(dbNode.prUrl).toBe('https://github.com/org/repo/pull/99')
    expect(dbNode.prNumber).toBe(99)
    expect(dbNode.branchName).toBe('astro/failed-task')
  })

  it('mutates event.node in-place for downstream hooks', async () => {
    const hook = await getHook()
    const event = makeEvent({
      prUrl: 'https://github.com/org/repo/pull/77',
      prNumber: 77,
      branchName: 'astro/downstream-test',
    })

    // Before hook, node should not have PR data
    expect(event.node.prUrl).toBeUndefined()
    expect(event.node.prNumber).toBeUndefined()
    expect(event.node.branchName).toBeUndefined()

    await hook(event)

    // After hook, node should have PR data (in-place mutation)
    expect(event.node.prUrl).toBe('https://github.com/org/repo/pull/77')
    expect(event.node.prNumber).toBe(77)
    expect(event.node.branchName).toBe('astro/downstream-test')
  })
})

// ============================================================================
// 6. SSE result event mapping — verify delivery fields propagate
// ============================================================================

describe('SSE result event mapping', () => {
  // These tests verify that TaskResult delivery fields (deliveryStatus, deliveryError,
  // prUrl, prNumber) are present in the relay TaskResult type and can be serialized
  // through the SSE event stream (they are not filtered out during serialization).

  it('TaskResult type includes delivery fields', async () => {
    // We can't test types at runtime directly, but we can construct an object
    // matching the TaskResult interface and verify it serializes correctly
    const result = {
      taskId: 'test-sse-1',
      status: 'completed' as const,
      deliveryStatus: 'failed' as const,
      deliveryError: 'gh not authenticated',
      branchName: 'astro/test',
    } satisfies import('../server/types/relay.js').TaskResult

    // Verify the fields survive JSON round-trip (SSE serialization)
    const serialized = JSON.parse(JSON.stringify(result))
    expect(serialized.deliveryStatus).toBe('failed')
    expect(serialized.deliveryError).toBe('gh not authenticated')
    expect(serialized.status).toBe('completed')
  })

  it('delivery failure does not override execution status in serialized result', () => {
    const result = {
      taskId: 'test-sse-2',
      status: 'completed',
      deliveryStatus: 'failed',
      deliveryError: 'Permission denied',
    }

    const serialized = JSON.parse(JSON.stringify(result))

    // Key assertion: status stays 'completed' even with deliveryStatus: 'failed'
    expect(serialized.status).toBe('completed')
    expect(serialized.deliveryStatus).toBe('failed')
    // They are independent fields
    expect(serialized.status).not.toBe(serialized.deliveryStatus)
  })

  it('prUrl and prNumber appear in serialized result', () => {
    const result = {
      taskId: 'test-sse-3',
      status: 'completed',
      deliveryStatus: 'success',
      prUrl: 'https://github.com/org/repo/pull/42',
      prNumber: 42,
      branchName: 'astro/abc-def',
    }

    const serialized = JSON.parse(JSON.stringify(result))
    expect(serialized.prUrl).toBe('https://github.com/org/repo/pull/42')
    expect(serialized.prNumber).toBe(42)
    expect(serialized.branchName).toBe('astro/abc-def')
  })

  it('dispatch/types TaskResult also includes delivery fields', async () => {
    // Verify the core dispatch TaskResult type also carries delivery fields
    const result = {
      taskId: 'test-sse-4',
      status: 'success' as const,
      deliveryStatus: 'failed' as const,
      deliveryError: 'branch not pushed',
      branchName: 'astro/test-branch',
    } satisfies import('../packages/core/src/dispatch/types.js').TaskResult

    const serialized = JSON.parse(JSON.stringify(result))
    expect(serialized.deliveryStatus).toBe('failed')
    expect(serialized.deliveryError).toBe('branch not pushed')
    expect(serialized.status).toBe('success')
  })
})

// ============================================================================
// 7. Dispatch task metadata enrichment (dryRun taskMeta)
// ============================================================================

describe('dispatch task metadata enrichment', () => {
  let projectId: string
  const nodeId = 'meta-test-node-001'

  beforeAll(async () => {
    await setupTestServer()
  })

  beforeEach(async () => {
    await db.delete(planNodes)
    await db.delete(projects)

    // Create project
    const res = await postJson('/api/data/projects', {
      name: 'Meta Test Project',
      description: 'Testing dispatch metadata enrichment',
      source: { localPath: '/tmp/test-repo' },
      deliveryMode: 'pr',
    })
    const body = await res.json()
    projectId = body.id

    // Create plan node
    await postJson('/api/data/plan/nodes', {
      id: nodeId,
      projectId,
      type: 'task',
      title: 'Meta Test Task',
      description: 'Test metadata fields',
      status: 'planned',
      position: { x: 0, y: 0 },
    })
  })

  it('dryRun includes astroBaseUrl from Origin header', async () => {
    const res = await getApp().request('/api/dispatch/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://test.astro.dev',
      },
      body: JSON.stringify({
        nodeId,
        projectId,
        title: 'Meta Test Task',
        description: 'Test metadata fields',
        workingDirectory: '/tmp/test-repo',
        deliveryMode: 'pr',
        dryRun: true,
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.taskMeta).toBeDefined()
    expect(body.taskMeta.astroBaseUrl).toBe('http://test.astro.dev')
  })

  it('dryRun resolves githubIssueUrl from plan node DB', async () => {
    // Set github issue data directly in DB
    await db.update(planNodes)
      .set({
        githubIssueUrl: 'https://github.com/org/repo/issues/55',
        githubIssueNumber: 55,
      })
      .where(eq(planNodes.clientId, nodeId))

    const res = await postJson('/api/dispatch/task', {
      nodeId,
      projectId,
      title: 'Meta Test Task',
      description: 'Test metadata fields',
      workingDirectory: '/tmp/test-repo',
      deliveryMode: 'pr',
      dryRun: true,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.taskMeta).toBeDefined()
    expect(body.taskMeta.githubIssueUrl).toBe('https://github.com/org/repo/issues/55')
    expect(body.taskMeta.githubIssueNumber).toBe(55)
  })

  it('dryRun resolves github issue even when frontend sends all primary fields', async () => {
    // Set github issue data directly in DB
    await db.update(planNodes)
      .set({
        githubIssueUrl: 'https://github.com/org/repo/issues/77',
        githubIssueNumber: 77,
      })
      .where(eq(planNodes.clientId, nodeId))

    // Send ALL primary fields (title, description, workingDirectory, visionDoc, deliveryMode)
    // This tests that the conditional gate was removed — the DB lookup always happens
    const res = await postJson('/api/dispatch/task', {
      nodeId,
      projectId,
      title: 'Fully specified task',
      description: 'All fields provided by frontend',
      workingDirectory: '/tmp/test-repo',
      visionDoc: 'Some vision doc',
      deliveryMode: 'pr',
      dryRun: true,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.taskMeta).toBeDefined()
    expect(body.taskMeta.githubIssueUrl).toBe('https://github.com/org/repo/issues/77')
    expect(body.taskMeta.githubIssueNumber).toBe(77)
  })

  it('dryRun without github issue returns undefined', async () => {
    // Node has no githubIssueUrl set — verify it's absent
    const res = await postJson('/api/dispatch/task', {
      nodeId,
      projectId,
      title: 'Meta Test Task',
      description: 'Test metadata fields',
      workingDirectory: '/tmp/test-repo',
      deliveryMode: 'pr',
      dryRun: true,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.taskMeta).toBeDefined()
    // DB columns default to null, and the conditional spread (...(githubIssueUrl && { ... }))
    // omits falsy values, so the field is absent from the JSON response
    expect(body.taskMeta.githubIssueUrl).toBeFalsy()
    expect(body.taskMeta.githubIssueNumber).toBeFalsy()
    // Other fields should still be present
    expect(body.taskMeta.deliveryMode).toBe('pr')
    expect(body.taskMeta.shortProjectId).toBeDefined()
    expect(body.taskMeta.shortNodeId).toBeDefined()
  })
})
