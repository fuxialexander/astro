/**
 * Dispatch Engine Tests
 *
 * Standalone tests for the task execution dispatch framework.
 * Run with: npx tsx server/test/dispatch-engine.test.ts
 */

import type { PlanNode, PlanEdge } from '../../src/types/index.js'
import {
  createDispatchEngine,
  createDispatchQueue,
  createContextAssembler,
  createResultRouter,
  createBranchManager,
} from '../lib/dispatch/index.js'
import type { TaskResult } from '../lib/providers/types.js'

// ============================================================================
// Test Utilities
// ============================================================================

let testsPassed = 0
let testsFailed = 0

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`)
    testsPassed++
  } else {
    console.log(`  ❌ ${message}`)
    testsFailed++
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const pass = actual === expected
  if (pass) {
    console.log(`  ✅ ${message}`)
    testsPassed++
  } else {
    console.log(`  ❌ ${message}`)
    console.log(`     Expected: ${JSON.stringify(expected)}`)
    console.log(`     Actual:   ${JSON.stringify(actual)}`)
    testsFailed++
  }
}

function assertContains<T>(array: T[], item: T, message: string): void {
  const pass = array.includes(item)
  if (pass) {
    console.log(`  ✅ ${message}`)
    testsPassed++
  } else {
    console.log(`  ❌ ${message}`)
    console.log(`     Array does not contain: ${JSON.stringify(item)}`)
    testsFailed++
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n📦 ${name}`)
  fn()
}

function it(name: string, fn: () => void): void {
  console.log(`\n  🧪 ${name}`)
  try {
    fn()
  } catch (error) {
    console.log(`  ❌ ${name} - threw error`)
    console.log(`     ${error}`)
    testsFailed++
  }
}

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
// Context Assembler Tests
// ============================================================================

describe('ContextAssembler', () => {
  const assembler = createContextAssembler({ maxDependencyOutputSize: 1000 })
  const nodes = createTestNodes()
  const edges = createTestEdges()

  it('should resolve dependencies correctly', () => {
    const node = nodes.find((n) => n.id === 'n3')!
    const resolution = assembler.resolveDependencies(node, nodes)

    assertEqual(resolution.allMet, true, 'all dependencies met')
    assertContains(resolution.completed, 'n2', 'n2 in completed')
    assertEqual(resolution.pending.length, 0, 'no pending dependencies')
  })

  it('should detect pending dependencies', () => {
    const node = nodes.find((n) => n.id === 'n4')!
    const resolution = assembler.resolveDependencies(node, nodes)

    assertEqual(resolution.allMet, false, 'dependencies not met')
    assertContains(resolution.pending, 'n3', 'n3 is pending')
  })

  it('should gather dependency outputs', () => {
    const node = nodes.find((n) => n.id === 'n3')!
    const outputs = assembler.gatherDependencyOutputs(node, nodes)

    assertEqual(outputs.length, 1, 'one dependency output')
    assertEqual(outputs[0].nodeId, 'n2', 'correct dependency node')
    assertEqual(outputs[0].title, 'Authentication', 'correct title')
  })

  it('should calculate graph position', () => {
    const node = nodes.find((n) => n.id === 'n3')!
    const position = assembler.calculateGraphPosition(node, nodes, edges)

    assertEqual(position.depth, 2, 'depth is 2')
    assert(position.upstreamCount > 0, 'has upstream dependencies')
    assert(position.downstreamCount > 0, 'has downstream dependents')
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

    assert(prompt.includes('Project Vision'), 'includes vision section')
    assert(prompt.includes('Build a great product'), 'includes vision content')
    assert(prompt.includes('Previous Task Outputs'), 'includes dependency outputs')
    assert(prompt.includes('Database Schema'), 'includes task title')
  })
})

// ============================================================================
// Dispatch Queue Tests
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

    assertEqual(entry.nodeId, 'n1', 'correct nodeId')
    assertEqual(entry.status, 'ready', 'status is ready')
    assertEqual(queue.getStats().total, 1, 'queue has 1 entry')
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
    assertEqual(first?.nodeId, 'n2', 'high priority first')
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
    assertEqual(e3, null, 'blocked by concurrency limit')

    queue.markCompleted(e1.id)
    const e3Retry = queue.dequeue()
    assertEqual(e3Retry?.nodeId, 'n3', 'can dequeue after completion')
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

    assertEqual(failResult?.retry, true, 'should retry')
    assertEqual(failResult?.entry.retryCount, 1, 'retry count is 1')
    assertEqual(failResult?.entry.status, 'ready', 'status reset to ready')
  })
})

// ============================================================================
// Result Router Tests
// ============================================================================

describe('ResultRouter', () => {
  const router = createResultRouter()
  const nodes = createTestNodes()

  it('should route successful auto-verifiable task', () => {
    const node = nodes.find((n) => n.id === 'n3')! // verification: 'auto'
    const result = createSuccessResult('exec-1')

    const decision = router.route(node, result, ['n4'])

    assertEqual(decision.autoClose, true, 'auto close')
    assertEqual(decision.targetStatus, 'auto_verified', 'status is auto_verified')
    assertEqual(decision.triggerDownstream, true, 'triggers downstream')
    assertContains(decision.downstreamNodes || [], 'n4', 'n4 in downstream')
  })

  it('should route successful human-verification task', () => {
    const node = nodes.find((n) => n.id === 'n4')! // verification: 'human'
    const result = createSuccessResult('exec-1')

    const decision = router.route(node, result)

    assertEqual(decision.autoClose, false, 'no auto close')
    assertEqual(decision.targetStatus, 'awaiting_judgment', 'status is awaiting_judgment')
    assertEqual(decision.surfaceToJudgment, true, 'surfaces to judgment')
  })

  it('should route failed task to judgment', () => {
    const node = nodes.find((n) => n.id === 'n3')!
    const result = createFailureResult('exec-1', 'Build failed')

    const decision = router.route(node, result)

    assertEqual(decision.autoClose, false, 'no auto close')
    assertEqual(decision.targetStatus, 'awaiting_judgment', 'status is awaiting_judgment')
    assertEqual(decision.surfaceToJudgment, true, 'surfaces to judgment')
  })

  it('should detect test failures in verification hints', () => {
    const node = nodes.find((n) => n.id === 'n3')! // verification: 'auto'
    const result: TaskResult = {
      ...createSuccessResult('exec-1'),
      verification: {
        testsRun: true,
        testsPassed: 3,
        testsFailed: 2, // Some tests failed
      },
    }

    const decision = router.route(node, result)

    assertEqual(decision.targetStatus, 'awaiting_judgment', 'requires human review')
    assertEqual(decision.surfaceToJudgment, true, 'surfaces to judgment')
  })
})

// ============================================================================
// Branch Manager Tests
// ============================================================================

describe('BranchManager', () => {
  const manager = createBranchManager()
  const nodes = createTestNodes()
  const edges = createTestEdges()

  it('should find branches in graph', () => {
    const branches = manager.findBranches(nodes, edges)

    assertEqual(branches.size, 1, 'one branch point')
    assert(branches.has('n4'), 'n4 is branch point')

    const branchInfo = branches.get('n4')!
    assertContains(branchInfo.directChildren, 'n5', 'n5 is direct child')
    assertContains(branchInfo.directChildren, 'n6', 'n6 is direct child')
  })

  it('should find downstream nodes', () => {
    const downstream = manager.findDownstreamNodes('n4', edges)

    assertContains(downstream, 'n5', 'n5 is downstream')
    assertContains(downstream, 'n6', 'n6 is downstream')
    assertContains(downstream, 'n7', 'n7 is downstream')
  })

  it('should find nodes to cancel', () => {
    const updatedNodes = nodes.map((n) =>
      n.id === 'n5' ? { ...n, status: 'in_progress' as const } : n
    )

    const toCancel = manager.findNodesToCancel(['n5', 'n6', 'n7'], updatedNodes)

    assertContains(toCancel, 'n5', 'n5 should be cancelled')
    assert(!toCancel.includes('n6'), 'n6 should not be cancelled')
  })

  it('should validate prune requests', () => {
    const valid = manager.validatePruneRequest(
      { branchNodeId: 'n4', projectId: 'proj-1' },
      nodes,
      edges
    )
    assertEqual(valid.valid, true, 'valid prune request')

    const invalid = manager.validatePruneRequest(
      { branchNodeId: 'n1', projectId: 'proj-1' },
      nodes,
      edges
    )
    assertEqual(invalid.valid, false, 'invalid prune request (not branch point)')
  })
})

// ============================================================================
// Dispatch Engine Tests
// ============================================================================

describe('DispatchEngine', () => {
  it('should get queue stats', () => {
    const engine = createDispatchEngine({
      autoDispatch: false,
      dryRunMode: true,
    })

    const stats = engine.getStats()

    assertEqual(stats.running, false, 'engine not running')
    assertEqual(stats.total, 0, 'queue is empty')
    assertEqual(stats.activeExecutions, 0, 'no active executions')
  })

  it('should start and stop', () => {
    const engine = createDispatchEngine({
      autoDispatch: false,
    })

    engine.start()
    assertEqual(engine.getStats().running, true, 'engine is running')

    engine.stop()
    assertEqual(engine.getStats().running, false, 'engine stopped')
  })
})

// ============================================================================
// Run Tests
// ============================================================================

console.log('\n🧪 Dispatch Engine Tests\n')
console.log('=' .repeat(60))

// Run all test suites
describe('ContextAssembler', () => {
  const assembler = createContextAssembler({ maxDependencyOutputSize: 1000 })
  const nodes = createTestNodes()
  // Note: edges are created by createTestEdges() but not directly used in these tests
  void createTestEdges()

  it('should resolve dependencies correctly', () => {
    const node = nodes.find((n) => n.id === 'n3')!
    const resolution = assembler.resolveDependencies(node, nodes)
    assertEqual(resolution.allMet, true, 'all dependencies met')
  })
})

// Print summary
console.log('\n' + '=' .repeat(60))
console.log(`\n📊 Test Summary: ${testsPassed} passed, ${testsFailed} failed`)

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed!')
  process.exit(1)
} else {
  console.log('\n✅ All tests passed!')
}
