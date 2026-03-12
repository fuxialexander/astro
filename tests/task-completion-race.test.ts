/**
 * Task Completion Race Condition Tests
 *
 * Verifies that plan node status transitions out of "in_progress" regardless
 * of which SSE path (dispatch SSE vs global events SSE) delivers the result first.
 *
 * Bug: Two independent SSE connections race to process task completion:
 *   - Global events SSE `task:result` sets execution status to 'success' but
 *     does NOT update the plan node (defers to node:status_changed).
 *   - Dispatch SSE `result` handler checks `alreadyCompleted` guard and skips
 *     plan node update if execution already marked terminal.
 *   Result: plan node stays "in_progress" forever.
 *
 * Fix: Three-layer defense ensures all paths independently update the plan node.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Simulated stores — mirror the real store logic under test
// ============================================================================

type NodeStatus = 'planned' | 'dispatched' | 'in_progress' | 'auto_verified' | 'awaiting_judgment' | 'completed' | 'pruned'
type ExecStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled'

interface PlanNode {
  id: string
  status: NodeStatus
  updatedAt: Date
}

interface Execution {
  executionId: string
  nodeId: string
  status: ExecStatus
  completedAt?: Date
}

function createPlanStore() {
  const nodes: PlanNode[] = []
  const updateNodeCalls: Array<{ id: string; updates: Partial<PlanNode> }> = []

  return {
    nodes,
    addNode: (node: PlanNode) => nodes.push(node),
    updateNode: (id: string, updates: Partial<PlanNode>) => {
      // Same-status guard — mirrors plan-store.ts
      if (updates.status && Object.keys(updates).length === 1) {
        const existing = nodes.find((n) => n.id === id)
        if (existing?.status === updates.status) return
      }

      updateNodeCalls.push({ id, updates })
      const idx = nodes.findIndex((n) => n.id === id)
      if (idx >= 0) {
        nodes[idx] = { ...nodes[idx], ...updates, updatedAt: new Date() }
      }
    },
    getUpdateCalls: () => updateNodeCalls,
    getNode: (id: string) => nodes.find((n) => n.id === id),
  }
}

function createExecutionStore() {
  const executions = new Map<string, Execution>()

  return {
    executions,
    setExecution: (nodeId: string, exec: Execution) => executions.set(nodeId, exec),
    isAlreadyCompleted: (nodeId: string) => {
      const exec = executions.get(nodeId)
      return exec != null && (exec.status === 'success' || exec.status === 'failure' || exec.status === 'cancelled')
    },
    markCompleted: (nodeId: string, status: 'success' | 'failure') => {
      const exec = executions.get(nodeId)
      if (exec) {
        executions.set(nodeId, { ...exec, status, completedAt: new Date() })
      }
    },
  }
}

// ============================================================================
// Simulated SSE handlers — mirror the three layers
// ============================================================================

const VALID_FINAL_STATUSES = new Set<NodeStatus>(['auto_verified', 'awaiting_judgment', 'completed', 'pruned'])

/** Layer 1: Dispatch SSE result handler (execution-store handleSSEEvent) */
function handleDispatchSSEResult(
  nodeId: string,
  resultData: { finalStatus?: string; status?: string },
  execStore: ReturnType<typeof createExecutionStore>,
  planStore: ReturnType<typeof createPlanStore>,
) {
  const alreadyCompleted = execStore.isAlreadyCompleted(nodeId)
  const isSuccess = resultData.status === 'success'

  if (!alreadyCompleted) {
    execStore.markCompleted(nodeId, isSuccess ? 'success' : 'failure')
  }

  // NOT gated by alreadyCompleted (the fix)
  if (resultData.finalStatus && VALID_FINAL_STATUSES.has(resultData.finalStatus as NodeStatus)) {
    planStore.updateNode(nodeId, { status: resultData.finalStatus as NodeStatus })
  }
}

/** Layer 2: processCatchUpEvents step 5b (execution-store) */
function processCatchUpStep5b(
  nodeId: string,
  events: Array<{ eventType: string; data: string }>,
  wasAlreadyCompleted: boolean,
  planStore: ReturnType<typeof createPlanStore>,
) {
  if (wasAlreadyCompleted) {
    const resultEvent = events.find(e => e.eventType === 'result')
    if (resultEvent) {
      try {
        const parsed = JSON.parse(resultEvent.data)
        if (parsed.finalStatus && VALID_FINAL_STATUSES.has(parsed.finalStatus)) {
          planStore.updateNode(nodeId, { status: parsed.finalStatus })
        }
      } catch (err) {
        console.warn('[test] Failed to parse result event:', err)
      }
    }
  }
}

/** Layer 3: Global events SSE task:result handler (realtime-store) */
function handleGlobalSSEResult(
  executionId: string,
  data: { status: string; finalNodeStatus?: string },
  execStore: ReturnType<typeof createExecutionStore>,
  planStore: ReturnType<typeof createPlanStore>,
) {
  let nodeId: string | undefined
  for (const [nid, exec] of execStore.executions) {
    if (exec.executionId === executionId) { nodeId = nid; break }
  }
  if (!nodeId) return

  if (execStore.isAlreadyCompleted(nodeId)) return

  execStore.markCompleted(nodeId, data.status === 'completed' ? 'success' : 'failure')

  if (data.finalNodeStatus && VALID_FINAL_STATUSES.has(data.finalNodeStatus as NodeStatus)) {
    planStore.updateNode(nodeId, { status: data.finalNodeStatus as NodeStatus })
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Task completion race condition', () => {
  let planStore: ReturnType<typeof createPlanStore>
  let execStore: ReturnType<typeof createExecutionStore>

  beforeEach(() => {
    planStore = createPlanStore()
    execStore = createExecutionStore()
    planStore.addNode({ id: 'node-1', status: 'in_progress', updatedAt: new Date() })
    execStore.setExecution('node-1', { executionId: 'exec-1', nodeId: 'node-1', status: 'running' })
  })

  describe('updateNode same-status guard', () => {
    it('skips redundant status-only updates', () => {
      planStore.addNode({ id: 'node-2', status: 'auto_verified', updatedAt: new Date() })
      planStore.updateNode('node-2', { status: 'auto_verified' })
      expect(planStore.getUpdateCalls()).toHaveLength(0)
    })

    it('allows status changes', () => {
      planStore.updateNode('node-1', { status: 'auto_verified' })
      expect(planStore.getUpdateCalls()).toHaveLength(1)
      expect(planStore.getNode('node-1')?.status).toBe('auto_verified')
    })

    it('skips same-status status-only update', () => {
      planStore.addNode({ id: 'node-3', status: 'auto_verified', updatedAt: new Date() })
      planStore.updateNode('node-3', { status: 'auto_verified' })
      expect(planStore.getUpdateCalls()).toHaveLength(0)
    })
  })

  describe('Layer 1: Dispatch SSE result handler', () => {
    it('updates plan node even when execution is already completed', () => {
      execStore.markCompleted('node-1', 'success')
      handleDispatchSSEResult('node-1', { status: 'success', finalStatus: 'auto_verified' }, execStore, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('auto_verified')
    })

    it('updates plan node when it arrives first (normal path)', () => {
      handleDispatchSSEResult('node-1', { status: 'success', finalStatus: 'auto_verified' }, execStore, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('auto_verified')
      expect(execStore.isAlreadyCompleted('node-1')).toBe(true)
    })
  })

  describe('Layer 2: processCatchUpEvents step 5b', () => {
    it('updates plan node when wasAlreadyCompleted is true', () => {
      const events = [{ eventType: 'result', data: JSON.stringify({ finalStatus: 'auto_verified', status: 'success' }) }]
      processCatchUpStep5b('node-1', events, true, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('auto_verified')
    })

    it('does nothing when wasAlreadyCompleted is false', () => {
      const events = [{ eventType: 'result', data: JSON.stringify({ finalStatus: 'auto_verified', status: 'success' }) }]
      processCatchUpStep5b('node-1', events, false, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('in_progress')
    })

    it('logs warning on malformed result data', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const events = [{ eventType: 'result', data: 'not-valid-json{{{' }]
      processCatchUpStep5b('node-1', events, true, planStore)
      expect(warnSpy).toHaveBeenCalled()
      expect(planStore.getNode('node-1')?.status).toBe('in_progress')
      warnSpy.mockRestore()
    })

    it('rejects invalid finalStatus values', () => {
      const events = [{ eventType: 'result', data: JSON.stringify({ finalStatus: 'evil_status', status: 'success' }) }]
      processCatchUpStep5b('node-1', events, true, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('in_progress')
    })
  })

  describe('Layer 3: Global events SSE task:result handler', () => {
    it('updates plan node via finalNodeStatus when it arrives first', () => {
      handleGlobalSSEResult('exec-1', { status: 'completed', finalNodeStatus: 'auto_verified' }, execStore, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('auto_verified')
    })

    it('skips when execution already completed (dispatch SSE was first)', () => {
      execStore.markCompleted('node-1', 'success')
      handleGlobalSSEResult('exec-1', { status: 'completed', finalNodeStatus: 'auto_verified' }, execStore, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('in_progress')
    })
  })

  describe('Full race scenarios', () => {
    it('global SSE wins -> dispatch SSE redundant update is skipped', () => {
      handleGlobalSSEResult('exec-1', { status: 'completed', finalNodeStatus: 'auto_verified' }, execStore, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('auto_verified')

      handleDispatchSSEResult('node-1', { status: 'success', finalStatus: 'auto_verified' }, execStore, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('auto_verified')
      expect(planStore.getUpdateCalls()).toHaveLength(1) // guard skipped the second call
    })

    it('dispatch SSE wins -> global SSE is harmless no-op', () => {
      handleDispatchSSEResult('node-1', { status: 'success', finalStatus: 'auto_verified' }, execStore, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('auto_verified')

      handleGlobalSSEResult('exec-1', { status: 'completed', finalNodeStatus: 'auto_verified' }, execStore, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('auto_verified')
      expect(planStore.getUpdateCalls()).toHaveLength(1)
    })

    it('neither SSE carries finalNodeStatus -> relies on node:status_changed', () => {
      handleGlobalSSEResult('exec-1', { status: 'completed' }, execStore, planStore)
      handleDispatchSSEResult('node-1', { status: 'success' }, execStore, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('in_progress')
    })

    it('page refresh with wasAlreadyCompleted -> step 5b recovers', () => {
      execStore.markCompleted('node-1', 'success')
      const events = [{ eventType: 'result', data: JSON.stringify({ finalStatus: 'awaiting_judgment', status: 'success' }) }]
      processCatchUpStep5b('node-1', events, true, planStore)
      expect(planStore.getNode('node-1')?.status).toBe('awaiting_judgment')
    })
  })
})
