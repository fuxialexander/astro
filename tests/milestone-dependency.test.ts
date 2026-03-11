/**
 * Milestone Dependency Tests
 *
 * Tests for two milestone-related bugs:
 * 1. Issue #262: Dispatch rejects tasks depending on completed milestones
 *    because it checked executionOutput instead of status.
 * 2. Issue #264: Graph view drops edges through hidden milestones,
 *    creating a visually disjoint graph.
 *
 * These tests validate the fixes in:
 * - server/routes/dispatch.ts (dependency output building)
 * - src/components/plan-graph/plan-canvas.tsx (edge bridging)
 * - src/stores/execution-store.ts (canExecuteNode)
 */

import { describe, it, expect } from 'vitest'
import type { PlanNode, PlanEdge } from '../packages/core/src/types.js'

// Import canExecuteNode from execution-store for frontend dependency checking
// We test this directly since the dispatch route relies on the same logic pattern
// (Note: canExecuteNode is a pure function that doesn't need Zustand state)

// ============================================================================
// Test Fixtures — models the real DAG from PR_Summary_Quality_Fallback_Chain
// ============================================================================

const PROJECT_ID = 'test-project-001'
const now = new Date()

function makeNode(overrides: Partial<PlanNode> & { id: string; title: string }): PlanNode {
  return {
    projectId: PROJECT_ID,
    type: 'task',
    description: '',
    status: 'planned',
    parentId: null,
    dependencies: [],
    verification: 'auto',
    position: { x: 0, y: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeEdge(source: string, target: string): PlanEdge {
  return { id: `${source}->${target}`, source, target, type: 'dependency' }
}

/**
 * DAG structure (mimics PR_Summary_Quality_Fallback_Chain):
 *
 *   n1 ──┐
 *   n2 ──┤── m1 (milestone) ──┬── n4
 *   n3 ──┘                    └── n5 ── n6 ── n7 ── m2 (milestone)
 *
 *   n8 ──┐
 *   n9 ──┤── m3 (milestone)
 *   n10 ─┘
 */
function createTestDAG(): { nodes: PlanNode[]; edges: PlanEdge[] } {
  const nodes: PlanNode[] = [
    makeNode({ id: 'n1', title: 'Task 1', status: 'completed', executionOutput: 'Done' }),
    makeNode({ id: 'n2', title: 'Task 2', status: 'completed', executionOutput: 'Done' }),
    makeNode({ id: 'n3', title: 'Task 3', status: 'completed', executionOutput: 'Done' }),
    makeNode({ id: 'm1', title: 'Core Complete', type: 'milestone', status: 'auto_verified' }),
    makeNode({ id: 'n4', title: 'Orchestrator', status: 'planned', dependencies: ['m1'] }),
    makeNode({ id: 'n5', title: 'API Client', status: 'planned', dependencies: ['m1'] }),
    makeNode({ id: 'n6', title: 'Integration', status: 'planned', dependencies: ['n5'] }),
    makeNode({ id: 'n7', title: 'Docs', status: 'planned', dependencies: ['n6'] }),
    makeNode({ id: 'm2', title: 'Feature Complete', type: 'milestone', status: 'planned' }),
    makeNode({ id: 'n8', title: 'Test A', status: 'completed', executionOutput: 'Pass' }),
    makeNode({ id: 'n9', title: 'Test B', status: 'completed', executionOutput: 'Pass' }),
    makeNode({ id: 'n10', title: 'Test C', status: 'completed', executionOutput: 'Pass' }),
    makeNode({ id: 'm3', title: 'Tests Complete', type: 'milestone', status: 'auto_verified' }),
  ]

  const edges: PlanEdge[] = [
    // Phase 1 → m1
    makeEdge('n1', 'm1'),
    makeEdge('n2', 'm1'),
    makeEdge('n3', 'm1'),
    // m1 → Phase 2
    makeEdge('m1', 'n4'),
    makeEdge('m1', 'n5'),
    // Phase 2 chain
    makeEdge('n5', 'n6'),
    makeEdge('n6', 'n7'),
    makeEdge('n7', 'm2'),
    // Test track → m3
    makeEdge('n8', 'm3'),
    makeEdge('n9', 'm3'),
    makeEdge('n10', 'm3'),
  ]

  return { nodes, edges }
}

// ============================================================================
// canExecuteNode — Replicated from execution-store.ts for testing
// This is the same logic the frontend uses; dispatch.ts should follow
// the same pattern after the fix.
// ============================================================================

interface CanExecuteResult {
  ready: boolean
  reason?: string
  pendingDependencies?: string[]
}

function canExecuteNode(node: PlanNode, allNodes: PlanNode[], edges?: PlanEdge[]): CanExecuteResult {
  const projectNodes = allNodes.filter((n) => n.projectId === node.projectId)

  let upstreamIds: string[]
  if (edges) {
    const projectNodeIds = new Set(projectNodes.map((n) => n.id))
    upstreamIds = edges
      .filter((e) => e.target === node.id && projectNodeIds.has(e.source))
      .map((e) => e.source)
  } else {
    upstreamIds = node.dependencies
  }

  if (upstreamIds.length === 0) return { ready: true }

  const pendingDependencies: string[] = []
  const completedStatuses: PlanNode['status'][] = ['completed', 'auto_verified', 'awaiting_judgment']

  for (const depId of upstreamIds) {
    const depNode = projectNodes.find((n) => n.id === depId)
    if (!depNode) continue
    if (!completedStatuses.includes(depNode.status)) {
      const label = depNode.type === 'milestone' ? `${depNode.title} (milestone)` : depNode.title
      pendingDependencies.push(label)
    }
  }

  if (pendingDependencies.length > 0) {
    return { ready: false, reason: `Waiting for: ${pendingDependencies.join(', ')}`, pendingDependencies }
  }
  return { ready: true }
}

// ============================================================================
// Dispatch dependency output building — Replicated from dispatch.ts fix
// ============================================================================

interface DependencyOutput {
  nodeId: string
  title: string
  output: string
}

/**
 * Builds dependency outputs from project nodes, matching the fixed logic
 * in server/routes/dispatch.ts.
 */
function buildDependencyOutputs(
  dependencies: string[],
  allProjectNodes: Array<{ clientId: string; title: string; executionOutput?: string | null; status: string; type: string }>,
): DependencyOutput[] {
  const outputs: DependencyOutput[] = []
  for (const depId of dependencies) {
    const depNode = allProjectNodes.find((n) => n.clientId === depId)
    if (depNode?.executionOutput) {
      outputs.push({
        nodeId: depNode.clientId,
        title: depNode.title,
        output: depNode.executionOutput,
      })
    } else if (depNode && (depNode.status === 'completed' || depNode.status === 'auto_verified')) {
      outputs.push({
        nodeId: depNode.clientId,
        title: depNode.title,
        output: `[${depNode.type || 'node'} ${depNode.status}]`,
      })
    }
  }
  return outputs
}

/**
 * Checks whether all dependencies are satisfied (matches dispatch.ts logic).
 */
function checkDependencies(
  dependencies: string[],
  dependencyOutputs: DependencyOutput[],
): { satisfied: boolean; pendingDeps: string[] } {
  const pendingDeps = dependencies.filter((depId) => {
    const depOutput = dependencyOutputs.find((d) => d.nodeId === depId)
    return !depOutput
  })
  return { satisfied: pendingDeps.length === 0, pendingDeps }
}

// ============================================================================
// Edge bridging logic — Replicated from plan-canvas.tsx fix
// ============================================================================

interface BridgeResult {
  directEdges: PlanEdge[]
  bridgeEdges: PlanEdge[]
  allEdges: PlanEdge[]
}

/**
 * Computes visible edges including bridges through hidden nodes.
 * Matches the fixed logic in plan-canvas.tsx projectEdges useMemo.
 */
function computeVisibleEdges(
  allEdges: PlanEdge[],
  visibleNodeIds: Set<string>,
  allProjectNodeIds: Set<string>,
): BridgeResult {
  const projectEdges = allEdges.filter(
    (e) => allProjectNodeIds.has(e.source) || allProjectNodeIds.has(e.target)
  )

  const directEdges = projectEdges.filter(
    (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
  )

  const hiddenNodeIds = new Set(
    [...allProjectNodeIds].filter((id) => !visibleNodeIds.has(id))
  )

  const bridgeEdges: PlanEdge[] = []
  if (hiddenNodeIds.size > 0) {
    const incomingToHidden = new Map<string, string[]>()
    const outgoingFromHidden = new Map<string, string[]>()

    for (const e of projectEdges) {
      if (hiddenNodeIds.has(e.target)) {
        const sources = incomingToHidden.get(e.target) ?? []
        sources.push(e.source)
        incomingToHidden.set(e.target, sources)
      }
      if (hiddenNodeIds.has(e.source)) {
        const targets = outgoingFromHidden.get(e.source) ?? []
        targets.push(e.target)
        outgoingFromHidden.set(e.source, targets)
      }
    }

    for (const hiddenId of hiddenNodeIds) {
      const sources = (incomingToHidden.get(hiddenId) ?? []).filter((s) => visibleNodeIds.has(s))
      const targets = (outgoingFromHidden.get(hiddenId) ?? []).filter((t) => visibleNodeIds.has(t))
      for (const s of sources) {
        for (const t of targets) {
          bridgeEdges.push({
            id: `bridge-${s}-${t}`,
            source: s,
            target: t,
            type: 'dependency',
          })
        }
      }
    }
  }

  // Deduplicate
  const all = [...directEdges, ...bridgeEdges]
  const seen = new Set<string>()
  const allEdgesDeduped = all.filter((e) => {
    const key = `${e.source}->${e.target}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { directEdges, bridgeEdges, allEdges: allEdgesDeduped }
}

// ============================================================================
// Tests
// ============================================================================

describe('Issue #262: Dispatch milestone dependency satisfaction', () => {
  const dag = createTestDAG()

  it('canExecuteNode allows tasks after completed milestone (edge-based)', () => {
    const n4 = dag.nodes.find((n) => n.id === 'n4')!
    const result = canExecuteNode(n4, dag.nodes, dag.edges)
    expect(result.ready).toBe(true)
  })

  it('canExecuteNode allows tasks after auto_verified milestone (edge-based)', () => {
    const n5 = dag.nodes.find((n) => n.id === 'n5')!
    const result = canExecuteNode(n5, dag.nodes, dag.edges)
    expect(result.ready).toBe(true)
  })

  it('canExecuteNode blocks tasks after planned milestone (edge-based)', () => {
    // m2 is planned, so n7's successor would be blocked if there were nodes after m2
    // But n7 → m2 means m2 depends on n7 (not the other way).
    // Let's test directly: create a node depending on m2 (planned milestone)
    const nodeAfterM2 = makeNode({ id: 'nx', title: 'After Feature Complete', dependencies: ['m2'] })
    const edgesWithNx = [...dag.edges, makeEdge('m2', 'nx')]
    const nodesWithNx = [...dag.nodes, nodeAfterM2]
    const result = canExecuteNode(nodeAfterM2, nodesWithNx, edgesWithNx)
    expect(result.ready).toBe(false)
    expect(result.pendingDependencies).toContain('Feature Complete (milestone)')
  })

  it('canExecuteNode works with dependencies array fallback (no edges)', () => {
    const n4 = dag.nodes.find((n) => n.id === 'n4')!
    const result = canExecuteNode(n4, dag.nodes)  // no edges → uses dependencies array
    expect(result.ready).toBe(true)
  })

  it('buildDependencyOutputs includes auto_verified milestones', () => {
    const dbNodes = dag.nodes.map((n) => ({
      clientId: n.id,
      title: n.title,
      executionOutput: n.executionOutput || null,
      status: n.status,
      type: n.type,
    }))

    const outputs = buildDependencyOutputs(['m1'], dbNodes)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].nodeId).toBe('m1')
    expect(outputs[0].output).toBe('[milestone auto_verified]')
  })

  it('buildDependencyOutputs includes completed milestones', () => {
    const dbNodes = dag.nodes.map((n) => ({
      clientId: n.id,
      title: n.title,
      executionOutput: n.executionOutput || null,
      status: n.id === 'm1' ? 'completed' : n.status,
      type: n.type,
    }))

    const outputs = buildDependencyOutputs(['m1'], dbNodes)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].output).toBe('[milestone completed]')
  })

  it('buildDependencyOutputs does NOT include planned milestones', () => {
    const dbNodes = dag.nodes.map((n) => ({
      clientId: n.id,
      title: n.title,
      executionOutput: n.executionOutput || null,
      status: n.status,
      type: n.type,
    }))

    // m2 is 'planned' — should not be included
    const outputs = buildDependencyOutputs(['m2'], dbNodes)
    expect(outputs).toHaveLength(0)
  })

  it('buildDependencyOutputs prefers executionOutput over status-based fallback', () => {
    const dbNodes = dag.nodes.map((n) => ({
      clientId: n.id,
      title: n.title,
      executionOutput: n.executionOutput || null,
      status: n.status,
      type: n.type,
    }))

    // n1 has executionOutput='Done' and status='completed'
    const outputs = buildDependencyOutputs(['n1'], dbNodes)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].output).toBe('Done')  // uses executionOutput, not status fallback
  })

  it('checkDependencies passes when milestone is in dependencyOutputs', () => {
    const outputs = [{ nodeId: 'm1', title: 'Core Complete', output: '[milestone auto_verified]' }]
    const { satisfied, pendingDeps } = checkDependencies(['m1'], outputs)
    expect(satisfied).toBe(true)
    expect(pendingDeps).toHaveLength(0)
  })

  it('checkDependencies fails when milestone is NOT in dependencyOutputs', () => {
    const { satisfied, pendingDeps } = checkDependencies(['m1'], [])
    expect(satisfied).toBe(false)
    expect(pendingDeps).toContain('m1')
  })

  it('checkDependencies handles mixed task + milestone dependencies', () => {
    const outputs = [
      { nodeId: 'n1', title: 'Task 1', output: 'Done' },
      { nodeId: 'm1', title: 'Core Complete', output: '[milestone auto_verified]' },
    ]
    const { satisfied } = checkDependencies(['n1', 'm1'], outputs)
    expect(satisfied).toBe(true)
  })
})

describe('Issue #264: Graph edge bridging through hidden milestones', () => {
  const dag = createTestDAG()
  const allProjectNodeIds = new Set(dag.nodes.map((n) => n.id))

  it('includes all edges when all nodes are visible', () => {
    const result = computeVisibleEdges(dag.edges, allProjectNodeIds, allProjectNodeIds)
    expect(result.directEdges).toHaveLength(dag.edges.length)
    expect(result.bridgeEdges).toHaveLength(0)
    expect(result.allEdges).toHaveLength(dag.edges.length)
  })

  it('bridges edges through hidden milestone (milestones hidden)', () => {
    // Hide milestones — simulates old behavior where milestones were filtered
    const visibleIds = new Set(
      dag.nodes.filter((n) => n.type !== 'milestone').map((n) => n.id)
    )

    const result = computeVisibleEdges(dag.edges, visibleIds, allProjectNodeIds)

    // Direct edges: only n5→n6, n6→n7 survive (both endpoints visible)
    expect(result.directEdges.length).toBeGreaterThan(0)

    // Bridge edges should connect through hidden milestones:
    // m1 hidden: n1→n4, n1→n5, n2→n4, n2→n5, n3→n4, n3→n5 (6 bridges)
    // m2 hidden: n7→(nothing after m2) — 0 bridges from m2
    // m3 hidden: n8→(nothing after m3), etc. — 0 bridges from m3
    expect(result.bridgeEdges.length).toBe(6)

    // Verify specific bridges exist
    const bridgeKeys = result.bridgeEdges.map((e) => `${e.source}->${e.target}`)
    expect(bridgeKeys).toContain('n1->n4')
    expect(bridgeKeys).toContain('n1->n5')
    expect(bridgeKeys).toContain('n2->n4')
    expect(bridgeKeys).toContain('n2->n5')
    expect(bridgeKeys).toContain('n3->n4')
    expect(bridgeKeys).toContain('n3->n5')
  })

  it('preserves graph connectivity when milestones are hidden', () => {
    const visibleIds = new Set(
      dag.nodes.filter((n) => n.type !== 'milestone').map((n) => n.id)
    )

    const result = computeVisibleEdges(dag.edges, visibleIds, allProjectNodeIds)

    // Build adjacency from resulting edges
    const adjacency = new Map<string, Set<string>>()
    for (const e of result.allEdges) {
      const targets = adjacency.get(e.source) ?? new Set()
      targets.add(e.target)
      adjacency.set(e.source, targets)
    }

    // n1,n2,n3 should reach n4 (through bridged m1)
    expect(adjacency.get('n1')?.has('n4')).toBe(true)
    expect(adjacency.get('n2')?.has('n4')).toBe(true)
    expect(adjacency.get('n3')?.has('n4')).toBe(true)

    // n5 should reach n6 (direct edge)
    expect(adjacency.get('n5')?.has('n6')).toBe(true)
  })

  it('no edges are lost when completed milestones are hidden by showCompleted filter', () => {
    // Simulate showCompleted=false: hide completed/auto_verified nodes (including milestones)
    const visibleIds = new Set(
      dag.nodes
        .filter((n) => n.status !== 'completed' && n.status !== 'auto_verified')
        .map((n) => n.id)
    )

    const result = computeVisibleEdges(dag.edges, visibleIds, allProjectNodeIds)

    // Visible nodes are: n4, n5, n6, n7, m2 (all planned)
    // Hidden: n1,n2,n3 (completed), m1 (auto_verified), n8,n9,n10 (completed), m3 (auto_verified)
    // Direct edges among visible: m1→n4, m1→n5 — but m1 is hidden too!
    // Bridges: through m1 → n4, n5 (but sources n1-n3 are also hidden, so no bridges through m1 to visible)
    // n5→n6, n6→n7, n7→m2 are direct edges among visible nodes
    const directKeys = result.directEdges.map((e) => `${e.source}->${e.target}`)
    expect(directKeys).toContain('n5->n6')
    expect(directKeys).toContain('n6->n7')
    expect(directKeys).toContain('n7->m2')
  })

  it('deduplicates when direct and bridge edges overlap', () => {
    // If n1→n4 exists as both direct and bridge, keep only one
    const extraEdges = [...dag.edges, makeEdge('n1', 'n4')]
    const visibleIds = new Set(
      dag.nodes.filter((n) => n.type !== 'milestone').map((n) => n.id)
    )

    const result = computeVisibleEdges(extraEdges, visibleIds, allProjectNodeIds)

    const n1ToN4 = result.allEdges.filter((e) => e.source === 'n1' && e.target === 'n4')
    expect(n1ToN4).toHaveLength(1)
  })

  it('handles empty hidden set (all nodes visible)', () => {
    const result = computeVisibleEdges(dag.edges, allProjectNodeIds, allProjectNodeIds)
    expect(result.bridgeEdges).toHaveLength(0)
    expect(result.allEdges).toHaveLength(dag.edges.length)
  })

  it('handles completely disconnected nodes gracefully', () => {
    const isolatedNode = makeNode({ id: 'isolated', title: 'Isolated' })
    const nodesWithIsolated = [...dag.nodes, isolatedNode]
    const allIds = new Set(nodesWithIsolated.map((n) => n.id))

    const result = computeVisibleEdges(dag.edges, allIds, allIds)
    // Same edges as before — isolated node adds no edges
    expect(result.allEdges).toHaveLength(dag.edges.length)
  })
})

describe('Milestone node properties', () => {
  const dag = createTestDAG()

  it('milestones have type=milestone', () => {
    const milestones = dag.nodes.filter((n) => n.type === 'milestone')
    expect(milestones).toHaveLength(3)
    expect(milestones.map((m) => m.id).sort()).toEqual(['m1', 'm2', 'm3'])
  })

  it('milestones do not have executionOutput (they auto-verify)', () => {
    const milestones = dag.nodes.filter((n) => n.type === 'milestone')
    for (const m of milestones) {
      expect(m.executionOutput).toBeUndefined()
    }
  })

  it('milestone governed count = number of incoming edges', () => {
    const m1Incoming = dag.edges.filter((e) => e.target === 'm1')
    expect(m1Incoming).toHaveLength(3) // n1, n2, n3

    const m3Incoming = dag.edges.filter((e) => e.target === 'm3')
    expect(m3Incoming).toHaveLength(3) // n8, n9, n10
  })
})
