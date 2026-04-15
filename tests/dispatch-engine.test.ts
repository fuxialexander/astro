/**
 * Dispatch Engine Tests
 *
 * Tests for the task execution dispatch framework:
 * - ContextAssembler: dependency resolution, output gathering, prompt building
 * - DispatchQueue: enqueue, dequeue, priority, concurrency, retries
 * - ResultRouter: auto-close, human verification, failure routing
 * - BranchManager: branch detection, downstream nodes, pruning
 * - DispatchEngine: start/stop, stats
 */

// Must be set BEFORE any server/ imports so PGlite is used instead of Supabase
process.env.ASTRO_LOCAL_MODE = 'true'

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runMigrations } from '../server/lib/db/migrate.js'
import { db } from '../server/lib/db/index.js'
import { dispatchQueueEntries, connectedAccounts } from '../server/lib/db/schema.js'
import { eq } from 'drizzle-orm'
import type { PlanNode, PlanEdge } from '../src/types/index.js'
import {
  createDispatchEngine,
  createDispatchQueue,
  createContextAssembler,
  createResultRouter,
  createBranchManager,
} from '../server/lib/dispatch/index.js'
import type { TaskResult } from '../server/lib/providers/types.js'

beforeAll(async () => {
  await runMigrations()
})

// ============================================================================
// Test Fixtures
// ============================================================================

// Valid UUID for use as projectId in DB-backed dispatch queue tests
const TEST_PROJECT_UUID = '00000000-0000-4000-8000-000000000001'

function createTestNodes(): PlanNode[] {
  const now = new Date()
  return [
    {
      id: 'n1',
      projectId: TEST_PROJECT_UUID,
      type: 'task',
      title: 'Project Setup',
      description: 'Initialize repo',
      status: 'completed',
      parentId: null,
      dependencies: [],
      verification: 'auto',
      position: { x: 40, y: 40 },
      createdAt: now,
      updatedAt: now,
      executionOutput: 'Setup completed successfully.',
    },
    {
      id: 'n2',
      projectId: TEST_PROJECT_UUID,
      type: 'task',
      title: 'Authentication',
      description: 'Implement JWT auth',
      status: 'completed',
      parentId: null,
      dependencies: ['n1'],
      verification: 'auto',
      position: { x: 40, y: 140 },
      createdAt: now,
      updatedAt: now,
      executionOutput: 'Auth implemented.',
    },
    {
      id: 'n3',
      projectId: TEST_PROJECT_UUID,
      type: 'task',
      title: 'Database Schema',
      description: 'Design database',
      status: 'planned',
      parentId: null,
      dependencies: ['n2'],
      verification: 'auto',
      position: { x: 40, y: 240 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'n4',
      projectId: TEST_PROJECT_UUID,
      type: 'milestone',
      title: 'Core Infrastructure',
      description: 'All core services ready',
      status: 'planned',
      parentId: null,
      dependencies: ['n3'],
      verification: 'human',
      position: { x: 40, y: 340 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'n5',
      projectId: TEST_PROJECT_UUID,
      type: 'task',
      title: 'REST API',
      description: 'RESTful endpoints',
      status: 'planned',
      parentId: null,
      dependencies: ['n4'],
      verification: 'auto',
      position: { x: 300, y: 400 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'n6',
      projectId: TEST_PROJECT_UUID,
      type: 'task',
      title: 'GraphQL API',
      description: 'GraphQL schema',
      status: 'planned',
      parentId: null,
      dependencies: ['n4'],
      verification: 'auto',
      position: { x: 300, y: 470 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'n7',
      projectId: TEST_PROJECT_UUID,
      type: 'task',
      title: 'Downstream Task',
      description: 'Depends on both APIs',
      status: 'planned',
      parentId: null,
      dependencies: ['n5', 'n6'],
      verification: 'human',
      position: { x: 300, y: 540 },
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function createTestEdges(): PlanEdge[] {
  return [
    { id: 'e1', source: 'n1', target: 'n2', type: 'dependency' },
    { id: 'e2', source: 'n2', target: 'n3', type: 'dependency' },
    { id: 'e3', source: 'n3', target: 'n4', type: 'dependency' },
    { id: 'e4', source: 'n4', target: 'n5', type: 'branch' },
    { id: 'e5', source: 'n4', target: 'n6', type: 'branch' },
    { id: 'e6', source: 'n5', target: 'n7', type: 'dependency' },
    { id: 'e7', source: 'n6', target: 'n7', type: 'dependency' },
  ]
}

function createSuccessResult(taskId: string): TaskResult {
  return {
    taskId,
    status: 'success',
    metrics: { durationMs: 1000 },
    providerId: 'claude-code',
    completedAt: new Date(),
    verification: {
      testsRun: true,
      testsPassed: 5,
      testsFailed: 0,
      buildSucceeded: true,
    },
  }
}

function createFailureResult(taskId: string, error: string): TaskResult {
  return {
    taskId,
    status: 'failure',
    errorMessage: error,
    metrics: { durationMs: 500 },
    providerId: 'claude-code',
    completedAt: new Date(),
  }
}

// ============================================================================
// ContextAssembler Tests
// ============================================================================

describe('ContextAssembler', () => {
  const assembler = createContextAssembler({ maxDependencyOutputSize: 1000 })
  const nodes = createTestNodes()
  const edges = createTestEdges()

  it('should resolve dependencies correctly', () => {
    const node = nodes.find((n) => n.id === 'n3')!
    const resolution = assembler.resolveDependencies(node, nodes)

    expect(resolution.allMet).toBe(true)
    expect(resolution.completed).toContain('n2')
    expect(resolution.pending).toHaveLength(0)
  })

  it('should detect pending dependencies', () => {
    const node = nodes.find((n) => n.id === 'n4')!
    const resolution = assembler.resolveDependencies(node, nodes)

    expect(resolution.allMet).toBe(false)
    expect(resolution.pending).toContain('n3')
  })

  it('should gather dependency outputs', () => {
    const node = nodes.find((n) => n.id === 'n3')!
    const outputs = assembler.gatherDependencyOutputs(node, nodes)

    expect(outputs).toHaveLength(1)
    expect(outputs[0].nodeId).toBe('n2')
    expect(outputs[0].title).toBe('Authentication')
  })

  it('should calculate graph position', () => {
    const node = nodes.find((n) => n.id === 'n3')!
    const position = assembler.calculateGraphPosition(node, nodes, edges)

    expect(position.depth).toBe(2)
    expect(position.upstreamCount).toBeGreaterThan(0)
    expect(position.downstreamCount).toBeGreaterThan(0)
  })

  it('should build execution prompt', () => {
    const node = nodes.find((n) => n.id === 'n3')!
    const context = assembler.assembleContext(node, nodes, edges, {
      id: TEST_PROJECT_UUID,
      name: 'Test Project',
      description: 'Test',
      visionDoc: 'Build a great product.',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const prompt = assembler.buildExecutionPrompt(context)

    expect(prompt).toContain('Project Vision')
    expect(prompt).toContain('Build a great product')
    expect(prompt).toContain('Previous Task Outputs')
    expect(prompt).toContain('Database Schema')
  })
})

// ============================================================================
// DispatchQueue Tests
// ============================================================================

describe('DispatchQueue', () => {
  beforeEach(async () => {
    await db.delete(dispatchQueueEntries)
  })

  it('should enqueue tasks', async () => {
    const queue = createDispatchQueue({
      maxConcurrentPerProject: 2,
      maxConcurrentTotal: 5,
      defaultPriority: 'normal',
    })

    const entry = await queue.enqueue({
      nodeId: 'n1',
      projectId: TEST_PROJECT_UUID,
    })

    expect(entry.nodeId).toBe('n1')
    expect(entry.status).toBe('ready')
    expect((await queue.getStats()).total).toBe(1)
  })

  it('should dequeue in priority order', async () => {
    const queue = createDispatchQueue({
      maxConcurrentPerProject: 5,
      maxConcurrentTotal: 10,
    })

    await queue.enqueue({ nodeId: 'n1', projectId: TEST_PROJECT_UUID, priority: 'low' })
    await queue.enqueue({ nodeId: 'n2', projectId: TEST_PROJECT_UUID, priority: 'high' })
    await queue.enqueue({ nodeId: 'n3', projectId: TEST_PROJECT_UUID, priority: 'normal' })

    const first = await queue.dequeue()
    expect(first?.nodeId).toBe('n2')
  })

  it('should respect project concurrency limits', async () => {
    const queue = createDispatchQueue({
      maxConcurrentPerProject: 2,
      maxConcurrentTotal: 10,
    })

    await queue.enqueue({ nodeId: 'n1', projectId: TEST_PROJECT_UUID })
    await queue.enqueue({ nodeId: 'n2', projectId: TEST_PROJECT_UUID })
    await queue.enqueue({ nodeId: 'n3', projectId: TEST_PROJECT_UUID })

    const e1 = (await queue.dequeue())!
    await queue.markDispatched(e1.id, 'exec-1')

    const e2 = (await queue.dequeue())!
    await queue.markDispatched(e2.id, 'exec-2')

    const e3 = await queue.dequeue()
    expect(e3).toBeNull()

    await queue.markCompleted(e1.id)
    const e3Retry = await queue.dequeue()
    expect(e3Retry?.nodeId).toBe('n3')
  })

  it('should handle retries', async () => {
    const queue = createDispatchQueue({ defaultMaxRetries: 2 })

    const entry = await queue.enqueue({
      nodeId: 'n1',
      projectId: TEST_PROJECT_UUID,
      maxRetries: 2,
    })

    await queue.markDispatched(entry.id, 'exec-1')
    const failResult = await queue.markFailed(entry.id, 'Network error')

    expect(failResult?.retry).toBe(true)
    expect(failResult?.entry.retryCount).toBe(1)
    expect(failResult?.entry.status).toBe('ready')
  })
})

// ============================================================================
// ResultRouter Tests
// ============================================================================

describe('ResultRouter', () => {
  const router = createResultRouter()
  const nodes = createTestNodes()

  it('should route successful auto-verifiable task', () => {
    const node = nodes.find((n) => n.id === 'n3')! // verification: 'auto'
    const result = createSuccessResult('exec-1')

    const decision = router.route(node, result, ['n4'])

    expect(decision.autoClose).toBe(true)
    expect(decision.targetStatus).toBe('auto_verified')
    expect(decision.triggerDownstream).toBe(true)
    expect(decision.downstreamNodes).toContain('n4')
  })

  it('should route successful human-verification task', () => {
    const node = nodes.find((n) => n.id === 'n4')! // verification: 'human'
    const result = createSuccessResult('exec-1')

    const decision = router.route(node, result)

    expect(decision.autoClose).toBe(false)
    expect(decision.targetStatus).toBe('awaiting_judgment')
    expect(decision.surfaceToJudgment).toBe(true)
  })

  it('should route failed task to judgment', () => {
    const node = nodes.find((n) => n.id === 'n3')!
    const result = createFailureResult('exec-1', 'Build failed')

    const decision = router.route(node, result)

    expect(decision.autoClose).toBe(false)
    expect(decision.targetStatus).toBe('awaiting_judgment')
    expect(decision.surfaceToJudgment).toBe(true)
  })

  it('should detect test failures in verification hints', () => {
    const node = nodes.find((n) => n.id === 'n3')! // verification: 'auto'
    const result: TaskResult = {
      ...createSuccessResult('exec-1'),
      verification: {
        testsRun: true,
        testsPassed: 3,
        testsFailed: 2,
      },
    }

    const decision = router.route(node, result)

    expect(decision.targetStatus).toBe('awaiting_judgment')
    expect(decision.surfaceToJudgment).toBe(true)
  })
})

// ============================================================================
// BranchManager Tests
// ============================================================================

describe('BranchManager', () => {
  const manager = createBranchManager()
  const nodes = createTestNodes()
  const edges = createTestEdges()

  it('should find branches in graph', () => {
    const branches = manager.findBranches(nodes, edges)

    expect(branches.size).toBe(1)
    expect(branches.has('n4')).toBe(true)

    const branchInfo = branches.get('n4')!
    expect(branchInfo.directChildren).toContain('n5')
    expect(branchInfo.directChildren).toContain('n6')
  })

  it('should find downstream nodes', () => {
    const downstream = manager.findDownstreamNodes('n4', edges)

    expect(downstream).toContain('n5')
    expect(downstream).toContain('n6')
    expect(downstream).toContain('n7')
  })

  it('should find nodes to cancel', () => {
    const updatedNodes = nodes.map((n) =>
      n.id === 'n5' ? { ...n, status: 'in_progress' as const } : n
    )

    const toCancel = manager.findNodesToCancel(['n5', 'n6', 'n7'], updatedNodes)

    expect(toCancel).toContain('n5')
    expect(toCancel).not.toContain('n6')
  })

  it('should validate prune requests', () => {
    const valid = manager.validatePruneRequest(
      { branchNodeId: 'n4', projectId: TEST_PROJECT_UUID },
      nodes,
      edges
    )
    expect(valid.valid).toBe(true)

    const invalid = manager.validatePruneRequest(
      { branchNodeId: 'n1', projectId: TEST_PROJECT_UUID },
      nodes,
      edges
    )
    expect(invalid.valid).toBe(false)
  })
})

// ============================================================================
// DispatchEngine Tests
// ============================================================================

describe('DispatchEngine', () => {
  beforeEach(async () => {
    await db.delete(dispatchQueueEntries)
  })

  it('should get queue stats', async () => {
    const engine = createDispatchEngine({
      autoDispatch: false,
      dryRunMode: true,
    })

    const stats = await engine.getStats()

    expect(stats.running).toBe(false)
    expect(stats.total).toBe(0)
    expect(stats.activeExecutions).toBe(0)
  })

  it('should start and stop', async () => {
    const engine = createDispatchEngine({
      autoDispatch: false,
    })

    engine.start()
    expect((await engine.getStats()).running).toBe(true)

    engine.stop()
    expect((await engine.getStats()).running).toBe(false)
  })
})

// ============================================================================
// Fix C: Session / Always auto-approval grants
// ============================================================================

describe('DispatchEngine — auto-approval grants (Fix C)', () => {
  const USER_A = '11111111-1111-4000-8000-000000000001'
  const USER_B = '22222222-2222-4000-8000-000000000002'
  const EXEC_ID = 'exec-test-node-42'
  const SESSION_ID = 'sess-abc-42'
  const NODE: PlanNode = {
    id: 'n-approval',
    projectId: TEST_PROJECT_UUID,
    type: 'task',
    title: 'Subroutine task',
    description: 'Needs approval',
    status: 'in_progress',
    parentId: null,
    dependencies: [],
    verification: 'human',
    position: { x: 0, y: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const SUBROUTINE = { name: 'deploy-prod', approvalMessage: 'Deploy to production?' }

  beforeEach(async () => {
    // Reset connected_accounts rows we'll touch
    await db.delete(connectedAccounts).where(eq(connectedAccounts.userId, USER_A))
    await db.delete(connectedAccounts).where(eq(connectedAccounts.userId, USER_B))
  })

  /**
   * Helper: create an engine, seed activeExecutions, and install a stub
   * nodeUpdateCallback so requestApproval doesn't blow up.
   */
  function makeEngine() {
    const engine = createDispatchEngine({ autoDispatch: false }) as unknown as {
      activeExecutions: Map<string, { executionId: string; abortController: AbortController; projectId: string; dispatcherUserId?: string; resumeSessionId?: string }>
      pendingApprovals: Map<string, unknown>
      sessionGrants: Map<string, Set<string>>
      nodeUpdateCallback?: (...args: unknown[]) => Promise<void>
      requestApproval: (node: PlanNode, subroutine: { name: string; approvalMessage?: string }) => Promise<boolean | string>
      respondToApproval: (id: string, approved: boolean, opts?: { choice?: 'once' | 'session' | 'always' | 'deny' }, callerUserId?: string) => Promise<void>
      isAutoApproved: (name: string | undefined, userId: string | undefined, sessionKey: string | undefined) => Promise<boolean>
    }
    engine.nodeUpdateCallback = async () => undefined
    return engine
  }

  function seedExecution(engine: ReturnType<typeof makeEngine>, dispatcherUserId: string, opts?: { sessionId?: string }) {
    engine.activeExecutions.set(NODE.id, {
      executionId: EXEC_ID,
      abortController: new AbortController(),
      projectId: NODE.projectId,
      dispatcherUserId,
      resumeSessionId: opts?.sessionId,
    })
  }

  it('once: does not grant anything for future approvals', async () => {
    const engine = makeEngine()
    seedExecution(engine, USER_A, { sessionId: SESSION_ID })

    // First approval — drive asynchronously and respond.
    const p1 = engine.requestApproval(NODE, SUBROUTINE)
    // requestApproval awaits event emission + node update before populating
    // pendingApprovals — flush microtasks until the entry appears.
    for (let i = 0; i < 20 && engine.pendingApprovals.size === 0; i++) {
      await new Promise((r) => setImmediate(r))
    }
    const firstId = Array.from(engine.pendingApprovals.keys())[0] as string
    await engine.respondToApproval(firstId, true, { choice: 'once' }, USER_A)
    expect(await p1).toBe(true)

    // Second approval should NOT be auto-approved.
    const auto = await engine.isAutoApproved(SUBROUTINE.name, USER_A, SESSION_ID)
    expect(auto).toBe(false)
    expect(engine.sessionGrants.size).toBe(0)
  })

  it('session: grants auto-approval for same subroutine within the session', async () => {
    const engine = makeEngine()
    seedExecution(engine, USER_A, { sessionId: SESSION_ID })

    const p1 = engine.requestApproval(NODE, SUBROUTINE)
    // requestApproval awaits event emission + node update before populating
    // pendingApprovals — flush microtasks until the entry appears.
    for (let i = 0; i < 20 && engine.pendingApprovals.size === 0; i++) {
      await new Promise((r) => setImmediate(r))
    }
    const firstId = Array.from(engine.pendingApprovals.keys())[0] as string
    await engine.respondToApproval(firstId, true, { choice: 'session' }, USER_A)
    expect(await p1).toBe(true)

    // Grant should be recorded under `${USER_A}:${SESSION_ID}`.
    expect(engine.sessionGrants.get(`${USER_A}:${SESSION_ID}`)?.has(SUBROUTINE.name)).toBe(true)

    // A follow-up requestApproval should short-circuit — no new pendingApprovals entry.
    const pendingSizeBefore = engine.pendingApprovals.size
    const p2 = await engine.requestApproval(NODE, SUBROUTINE)
    expect(p2).toBe(true)
    expect(engine.pendingApprovals.size).toBe(pendingSizeBefore)
  })

  it('session: different subroutine name still requires a fresh approval', async () => {
    const engine = makeEngine()
    seedExecution(engine, USER_A, { sessionId: SESSION_ID })

    const p1 = engine.requestApproval(NODE, SUBROUTINE)
    // requestApproval awaits event emission + node update before populating
    // pendingApprovals — flush microtasks until the entry appears.
    for (let i = 0; i < 20 && engine.pendingApprovals.size === 0; i++) {
      await new Promise((r) => setImmediate(r))
    }
    const firstId = Array.from(engine.pendingApprovals.keys())[0] as string
    await engine.respondToApproval(firstId, true, { choice: 'session' }, USER_A)
    await p1

    // Different subroutine name — should NOT auto-approve.
    const auto = await engine.isAutoApproved('other-subroutine', USER_A, SESSION_ID)
    expect(auto).toBe(false)
  })

  it('session: does not bleed across dispatcher user ids', async () => {
    const engine = makeEngine()
    seedExecution(engine, USER_A, { sessionId: SESSION_ID })

    const p1 = engine.requestApproval(NODE, SUBROUTINE)
    // requestApproval awaits event emission + node update before populating
    // pendingApprovals — flush microtasks until the entry appears.
    for (let i = 0; i < 20 && engine.pendingApprovals.size === 0; i++) {
      await new Promise((r) => setImmediate(r))
    }
    const firstId = Array.from(engine.pendingApprovals.keys())[0] as string
    await engine.respondToApproval(firstId, true, { choice: 'session' }, USER_A)
    await p1

    // USER_B with the same session key must not inherit USER_A's grant.
    const autoForB = await engine.isAutoApproved(SUBROUTINE.name, USER_B, SESSION_ID)
    expect(autoForB).toBe(false)
  })

  it('always: persists to connected_accounts.settings and survives a fresh engine', async () => {
    // Seed a Telegram connected_account for USER_A.
    await db.insert(connectedAccounts).values({
      userId: USER_A,
      channel: 'telegram',
      label: 'test',
      credentials: { chatId: 1 },
      mappings: {},
      settings: {},
    })

    const engine = makeEngine()
    seedExecution(engine, USER_A, { sessionId: SESSION_ID })

    const p1 = engine.requestApproval(NODE, SUBROUTINE)
    // requestApproval awaits event emission + node update before populating
    // pendingApprovals — flush microtasks until the entry appears.
    for (let i = 0; i < 20 && engine.pendingApprovals.size === 0; i++) {
      await new Promise((r) => setImmediate(r))
    }
    const firstId = Array.from(engine.pendingApprovals.keys())[0] as string
    await engine.respondToApproval(firstId, true, { choice: 'always' }, USER_A)
    await p1

    // Settings row should now include the subroutine.
    const rows = await db.select().from(connectedAccounts).where(eq(connectedAccounts.userId, USER_A))
    const settings = (rows[0]?.settings ?? {}) as { autoApprovedSubroutines?: string[] }
    expect(settings.autoApprovedSubroutines).toContain(SUBROUTINE.name)

    // A FRESH engine (no in-memory sessionGrants) should still auto-approve.
    const engine2 = makeEngine()
    const auto = await engine2.isAutoApproved(SUBROUTINE.name, USER_A, 'any-new-session')
    expect(auto).toBe(true)

    // And USER_B still does not inherit it.
    const autoForB = await engine2.isAutoApproved(SUBROUTINE.name, USER_B, 'any-new-session')
    expect(autoForB).toBe(false)
  })
})
