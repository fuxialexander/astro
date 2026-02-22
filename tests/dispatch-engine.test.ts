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

import { describe, it, expect } from 'vitest'
import type { PlanNode, PlanEdge } from '../src/types/index.js'
import {
  createDispatchEngine,
  createDispatchQueue,
  createContextAssembler,
  createResultRouter,
  createBranchManager,
} from '../server/lib/dispatch/index.js'
import type { TaskResult } from '../server/lib/providers/types.js'

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestNodes(): PlanNode[] {
  const now = new Date()
  return [
    {
      id: 'n1',
      projectId: 'proj-1',
      type: 'task',
      title: 'Project Setup',
      description: 'Initialize repo',
      status: 'completed',
      parentId: null,
      dependencies: [],
      environment: 'local',
      verification: 'auto',
      position: { x: 40, y: 40 },
      createdAt: now,
      updatedAt: now,
      executionOutput: 'Setup completed successfully.',
    },
    {
      id: 'n2',
      projectId: 'proj-1',
      type: 'task',
      title: 'Authentication',
      description: 'Implement JWT auth',
      status: 'completed',
      parentId: null,
      dependencies: ['n1'],
      environment: 'local',
      verification: 'auto',
      position: { x: 40, y: 140 },
      createdAt: now,
      updatedAt: now,
      executionOutput: 'Auth implemented.',
    },
    {
      id: 'n3',
      projectId: 'proj-1',
      type: 'task',
      title: 'Database Schema',
      description: 'Design database',
      status: 'planned',
      parentId: null,
      dependencies: ['n2'],
      environment: 'local',
      verification: 'auto',
      position: { x: 40, y: 240 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'n4',
      projectId: 'proj-1',
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
      projectId: 'proj-1',
      type: 'task',
      title: 'REST API',
      description: 'RESTful endpoints',
      status: 'planned',
      parentId: null,
      dependencies: ['n4'],
      environment: 'local',
      verification: 'auto',
      position: { x: 300, y: 400 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'n6',
      projectId: 'proj-1',
      type: 'task',
      title: 'GraphQL API',
      description: 'GraphQL schema',
      status: 'planned',
      parentId: null,
      dependencies: ['n4'],
      environment: 'local',
      verification: 'auto',
      position: { x: 300, y: 470 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'n7',
      projectId: 'proj-1',
      type: 'task',
      title: 'Downstream Task',
      description: 'Depends on both APIs',
      status: 'planned',
      parentId: null,
      dependencies: ['n5', 'n6'],
      environment: 'local',
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
      id: 'proj-1',
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
  it('should enqueue tasks', () => {
    const queue = createDispatchQueue({
      maxConcurrentPerProject: 2,
      maxConcurrentTotal: 5,
      defaultPriority: 'normal',
    })

    const entry = queue.enqueue({
      nodeId: 'n1',
      projectId: 'proj-1',
    })

    expect(entry.nodeId).toBe('n1')
    expect(entry.status).toBe('ready')
    expect(queue.getStats().total).toBe(1)
  })

  it('should dequeue in priority order', () => {
    const queue = createDispatchQueue({
      maxConcurrentPerProject: 5,
      maxConcurrentTotal: 10,
    })

    queue.enqueue({ nodeId: 'n1', projectId: 'proj-1', priority: 'low' })
    queue.enqueue({ nodeId: 'n2', projectId: 'proj-1', priority: 'high' })
    queue.enqueue({ nodeId: 'n3', projectId: 'proj-1', priority: 'normal' })

    const first = queue.dequeue()
    expect(first?.nodeId).toBe('n2')
  })

  it('should respect project concurrency limits', () => {
    const queue = createDispatchQueue({
      maxConcurrentPerProject: 2,
      maxConcurrentTotal: 10,
    })

    queue.enqueue({ nodeId: 'n1', projectId: 'proj-1' })
    queue.enqueue({ nodeId: 'n2', projectId: 'proj-1' })
    queue.enqueue({ nodeId: 'n3', projectId: 'proj-1' })

    const e1 = queue.dequeue()!
    queue.markDispatched(e1.id, 'exec-1')

    const e2 = queue.dequeue()!
    queue.markDispatched(e2.id, 'exec-2')

    const e3 = queue.dequeue()
    expect(e3).toBeNull()

    queue.markCompleted(e1.id)
    const e3Retry = queue.dequeue()
    expect(e3Retry?.nodeId).toBe('n3')
  })

  it('should handle retries', () => {
    const queue = createDispatchQueue({ defaultMaxRetries: 2 })

    const entry = queue.enqueue({
      nodeId: 'n1',
      projectId: 'proj-1',
      maxRetries: 2,
    })

    queue.markDispatched(entry.id, 'exec-1')
    const failResult = queue.markFailed(entry.id, 'Network error')

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
      { branchNodeId: 'n4', projectId: 'proj-1' },
      nodes,
      edges
    )
    expect(valid.valid).toBe(true)

    const invalid = manager.validatePruneRequest(
      { branchNodeId: 'n1', projectId: 'proj-1' },
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
  it('should get queue stats', () => {
    const engine = createDispatchEngine({
      autoDispatch: false,
      dryRunMode: true,
    })

    const stats = engine.getStats()

    expect(stats.running).toBe(false)
    expect(stats.total).toBe(0)
    expect(stats.activeExecutions).toBe(0)
  })

  it('should start and stop', () => {
    const engine = createDispatchEngine({
      autoDispatch: false,
    })

    engine.start()
    expect(engine.getStats().running).toBe(true)

    engine.stop()
    expect(engine.getStats().running).toBe(false)
  })
})
