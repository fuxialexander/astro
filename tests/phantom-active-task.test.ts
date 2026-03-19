/**
 * Phantom Active Task — Regression Tests
 *
 * Verifies that deleting plan sessions properly cleans up the active task
 * count in the sidebar and active tasks page. Covers two root causes:
 *
 * 1. Direct Zustand Map mutation (bypasses reactivity) — the delete button
 *    called allExecutions.delete() directly instead of through set().
 *
 * 2. Orphaned plan/playground executions — after deleting a project, the
 *    execution store could retain entries whose project no longer exists.
 *    The sidebar counted these because plan-{id} keys have no matching
 *    plan node, so the stale-check was skipped.
 */
import { describe, it, expect } from 'vitest'

// ============================================================================
// Minimal types mirroring the sidebar and active-tasks logic
// ============================================================================

interface Execution {
  status: 'running' | 'pending' | 'success' | 'failure' | 'cancelled'
  projectId?: string
  executionId?: string
  startedAt?: Date
  machineId?: string
}

interface PlanNode {
  id: string
  projectId: string
  status: string
  type?: string
}

interface Session {
  id: string
  projectId: string
}

const TERMINAL_NODE_STATUSES = new Set([
  'completed', 'auto_verified', 'pruned', 'awaiting_judgment',
])

// ============================================================================
// Replicates sidebar.tsx activeCount logic (with the fix)
// ============================================================================

function computeSidebarActiveCount(
  executions: Map<string, Execution>,
  planNodes: PlanNode[],
  streamingSessions: Set<string>,
  allSessions: Map<string, Session>,
  projectIds: Set<string>,
): { activeCount: number; projectsWithRunning: Set<string> } {
  let count = 0
  const running = new Set<string>()
  const planNodesById = new Map(planNodes.map((n) => [n.id, n]))

  // Count running executions
  for (const [nodeId, exec] of executions) {
    if (exec.status === 'pending' || exec.status === 'running') {
      const node = planNodesById.get(nodeId)
      // Skip stale executions: node has terminal status
      if (node && TERMINAL_NODE_STATUSES.has(node.status)) continue
      // Skip orphaned plan/playground executions whose project was deleted
      const projectId = exec.projectId || node?.projectId
      if (!node && projectId && !projectIds.has(projectId)) continue
      count++
      if (node?.projectId) running.add(node.projectId)
      if (exec.projectId) running.add(exec.projectId)
    }
  }

  // Nodes with in_progress/dispatched not in execution store
  for (const node of planNodes) {
    if ((node.status === 'in_progress' || node.status === 'dispatched') && !executions.has(node.id)) {
      count++
      running.add(node.projectId)
    }
  }

  // Streaming sessions
  for (const sessionId of streamingSessions) {
    const session = allSessions.get(sessionId)
    if (session?.projectId) {
      count++
      running.add(session.projectId)
    }
  }

  return { activeCount: count, projectsWithRunning: running }
}

// ============================================================================
// Replicates the OLD buggy sidebar logic (without the orphan fix)
// ============================================================================

function computeSidebarActiveCountOld(
  executions: Map<string, Execution>,
  planNodes: PlanNode[],
  streamingSessions: Set<string>,
  allSessions: Map<string, Session>,
): { activeCount: number } {
  let count = 0
  const planNodesById = new Map(planNodes.map((n) => [n.id, n]))

  for (const [nodeId, exec] of executions) {
    if (exec.status === 'pending' || exec.status === 'running') {
      const node = planNodesById.get(nodeId)
      if (node && TERMINAL_NODE_STATUSES.has(node.status)) continue
      // OLD: no orphan check — always counts
      count++
    }
  }

  for (const node of planNodes) {
    if ((node.status === 'in_progress' || node.status === 'dispatched') && !executions.has(node.id)) {
      count++
    }
  }

  for (const sessionId of streamingSessions) {
    const session = allSessions.get(sessionId)
    if (session?.projectId) count++
  }

  return { activeCount: count }
}

// ============================================================================
// Simulates the delete handler logic
// ============================================================================

/** Old buggy delete: directly mutates the Map */
function deleteSessionOld(
  executions: Map<string, Execution>,
  projectId: string,
): Map<string, Execution> {
  // BUG: direct mutation — same object reference, Zustand won't detect change
  executions.delete(`plan-${projectId}`)
  return executions
}

/** Fixed delete: creates new Map via Zustand set() */
function deleteSessionFixed(
  executions: Map<string, Execution>,
  projectId: string,
): Map<string, Execution> {
  const next = new Map(executions)
  next.delete(`plan-${projectId}`)
  return next
}

// ============================================================================
// Tests
// ============================================================================

describe('Phantom Active Task: sidebar count', () => {
  const projectId = 'proj-abc123'
  const nodeId = `plan-${projectId}`

  it('counts a running plan execution as active', () => {
    const executions = new Map<string, Execution>([
      [nodeId, { status: 'running', projectId, executionId: 'exec-1' }],
    ])
    const projectIds = new Set([projectId])

    const result = computeSidebarActiveCount(
      executions, [], new Set(), new Map(), projectIds,
    )
    expect(result.activeCount).toBe(1)
    expect(result.projectsWithRunning.has(projectId)).toBe(true)
  })

  it('does not count a cancelled plan execution', () => {
    const executions = new Map<string, Execution>([
      [nodeId, { status: 'cancelled', projectId, executionId: 'exec-1' }],
    ])
    const projectIds = new Set([projectId])

    const result = computeSidebarActiveCount(
      executions, [], new Set(), new Map(), projectIds,
    )
    expect(result.activeCount).toBe(0)
  })

  it('does not count an orphaned plan execution whose project was deleted', () => {
    // Execution exists but project was deleted
    const executions = new Map<string, Execution>([
      [nodeId, { status: 'running', projectId, executionId: 'exec-1' }],
    ])
    const projectIds = new Set<string>() // empty — project deleted

    const result = computeSidebarActiveCount(
      executions, [], new Set(), new Map(), projectIds,
    )
    expect(result.activeCount).toBe(0)
  })

  it('OLD BUG: orphaned plan execution was incorrectly counted', () => {
    // Demonstrates the old behavior: no orphan check, so deleted project's
    // execution still counts as active
    const executions = new Map<string, Execution>([
      [nodeId, { status: 'running', projectId, executionId: 'exec-1' }],
    ])

    const result = computeSidebarActiveCountOld(
      executions, [], new Set(), new Map(),
    )
    // Old code incorrectly counts this as 1
    expect(result.activeCount).toBe(1)
  })

  it('still counts regular task executions with matching plan nodes', () => {
    const taskNodeId = 'task-uuid-123'
    const executions = new Map<string, Execution>([
      [taskNodeId, { status: 'running', projectId, executionId: 'exec-2' }],
    ])
    const planNodes: PlanNode[] = [
      { id: taskNodeId, projectId, status: 'in_progress' },
    ]
    const projectIds = new Set([projectId])

    const result = computeSidebarActiveCount(
      executions, planNodes, new Set(), new Map(), projectIds,
    )
    expect(result.activeCount).toBe(1)
  })

  it('skips stale executions where node has terminal status', () => {
    const taskNodeId = 'task-uuid-456'
    const executions = new Map<string, Execution>([
      [taskNodeId, { status: 'running', projectId, executionId: 'exec-3' }],
    ])
    const planNodes: PlanNode[] = [
      { id: taskNodeId, projectId, status: 'completed' },
    ]
    const projectIds = new Set([projectId])

    const result = computeSidebarActiveCount(
      executions, planNodes, new Set(), new Map(), projectIds,
    )
    expect(result.activeCount).toBe(0)
  })

  it('counts nodes with in_progress status even without execution entries', () => {
    const executions = new Map<string, Execution>()
    const planNodes: PlanNode[] = [
      { id: 'task-uuid-789', projectId, status: 'in_progress' },
    ]
    const projectIds = new Set([projectId])

    const result = computeSidebarActiveCount(
      executions, planNodes, new Set(), new Map(), projectIds,
    )
    expect(result.activeCount).toBe(1)
  })

  it('counts streaming sessions as active', () => {
    const sessionId = 'session-abc'
    const executions = new Map<string, Execution>()
    const streamingSessions = new Set([sessionId])
    const allSessions = new Map<string, Session>([
      [sessionId, { id: sessionId, projectId }],
    ])
    const projectIds = new Set([projectId])

    const result = computeSidebarActiveCount(
      executions, [], streamingSessions, allSessions, projectIds,
    )
    expect(result.activeCount).toBe(1)
  })

  it('does not count orphaned playground executions', () => {
    const playgroundNodeId = `playground-${projectId}`
    const executions = new Map<string, Execution>([
      [playgroundNodeId, { status: 'running', projectId, executionId: 'exec-pg' }],
    ])
    // Project deleted
    const projectIds = new Set<string>()

    const result = computeSidebarActiveCount(
      executions, [], new Set(), new Map(), projectIds,
    )
    expect(result.activeCount).toBe(0)
  })
})

describe('Phantom Active Task: delete handler reactivity', () => {
  const projectId = 'proj-xyz789'
  const nodeId = `plan-${projectId}`

  it('OLD BUG: direct Map mutation returns same reference', () => {
    const executions = new Map<string, Execution>([
      [nodeId, { status: 'running', projectId }],
    ])
    const original = executions

    const result = deleteSessionOld(executions, projectId)

    // Same reference — Zustand would NOT detect a state change
    expect(result).toBe(original)
    // Entry was removed (mutation worked)
    expect(result.has(nodeId)).toBe(false)
  })

  it('fixed delete returns a new Map reference', () => {
    const executions = new Map<string, Execution>([
      [nodeId, { status: 'running', projectId }],
    ])
    const original = executions

    const result = deleteSessionFixed(executions, projectId)

    // Different reference — Zustand WILL detect the state change
    expect(result).not.toBe(original)
    // Entry was removed
    expect(result.has(nodeId)).toBe(false)
    // Original is NOT mutated
    expect(original.has(nodeId)).toBe(true)
  })

  it('fixed delete preserves other executions', () => {
    const otherNodeId = 'plan-other-project'
    const executions = new Map<string, Execution>([
      [nodeId, { status: 'running', projectId }],
      [otherNodeId, { status: 'running', projectId: 'other-project' }],
    ])

    const result = deleteSessionFixed(executions, projectId)

    expect(result.has(nodeId)).toBe(false)
    expect(result.has(otherNodeId)).toBe(true)
    expect(result.size).toBe(1)
  })
})

describe('Phantom Active Task: end-to-end delete scenario', () => {
  it('after deleting a plan session, active count drops to zero', () => {
    const projectId = 'proj-plan-1'
    const nodeId = `plan-${projectId}`

    // Initial state: one running plan session
    let executions = new Map<string, Execution>([
      [nodeId, { status: 'running', projectId, executionId: 'exec-plan-1' }],
    ])
    let projectIds = new Set([projectId])

    // Verify it's counted
    let count = computeSidebarActiveCount(
      executions, [], new Set(), new Map(), projectIds,
    )
    expect(count.activeCount).toBe(1)

    // Simulate delete: remove execution via new Map (Zustand set)
    executions = deleteSessionFixed(executions, projectId)
    // Simulate deleteProject: remove from project list
    projectIds = new Set<string>()

    // Verify count is zero
    count = computeSidebarActiveCount(
      executions, [], new Set(), new Map(), projectIds,
    )
    expect(count.activeCount).toBe(0)
  })

  it('after deleting last of multiple plan sessions, count is correct', () => {
    const proj1 = 'proj-1'
    const proj2 = 'proj-2'

    let executions = new Map<string, Execution>([
      [`plan-${proj1}`, { status: 'success', projectId: proj1 }],
      [`plan-${proj2}`, { status: 'running', projectId: proj2 }],
    ])
    let projectIds = new Set([proj1, proj2])

    // Only proj2 is active (proj1 is success)
    let count = computeSidebarActiveCount(
      executions, [], new Set(), new Map(), projectIds,
    )
    expect(count.activeCount).toBe(1)

    // Delete proj2
    executions = deleteSessionFixed(executions, proj2)
    projectIds = new Set([proj1])

    count = computeSidebarActiveCount(
      executions, [], new Set(), new Map(), projectIds,
    )
    expect(count.activeCount).toBe(0)
  })

  it('orphaned execution after page refresh is not counted', () => {
    // Simulates: user deletes project, refreshes page, execution loaded from DB
    // but project is gone
    const projectId = 'proj-orphan'
    const executions = new Map<string, Execution>([
      [`plan-${projectId}`, { status: 'running', projectId, executionId: 'exec-orphan' }],
    ])
    // Project was deleted — not in the project list
    const projectIds = new Set<string>()

    const count = computeSidebarActiveCount(
      executions, [], new Set(), new Map(), projectIds,
    )
    expect(count.activeCount).toBe(0)
  })

  it('idle-timed-out execution with deleted project is not counted', () => {
    // Simulates: agent runner times out a task, but SSE dropped so execution
    // still shows "running". Then user deletes the project.
    const projectId = 'proj-timeout'
    const executions = new Map<string, Execution>([
      [`plan-${projectId}`, { status: 'running', projectId, executionId: 'exec-timeout' }],
    ])
    // Project deleted
    const projectIds = new Set<string>()

    const count = computeSidebarActiveCount(
      executions, [], new Set(), new Map(), projectIds,
    )
    expect(count.activeCount).toBe(0)
  })
})
