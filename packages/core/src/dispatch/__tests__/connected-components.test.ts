/**
 * Tests for connected component analysis and delivery branch reconciliation.
 */

import { describe, it, expect } from 'vitest'
import type { PlanNode, PlanEdge } from '../../types.js'
import {
  UnionFind,
  computeConnectedComponents,
  detectStructuralChanges,
  requiresRestart,
  type DeliveryBranchRecord,
} from '../connected-components.js'

// ============================================================================
// Test Helpers
// ============================================================================

function makeNode(overrides: Partial<PlanNode> & { id: string }): PlanNode {
  return {
    projectId: 'proj-1',
    type: 'task',
    title: `Task ${overrides.id}`,
    description: '',
    status: 'planned',
    parentId: null,
    dependencies: [],
    verification: 'auto',
    position: { x: 0, y: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeEdge(source: string, target: string, type: 'dependency' | 'branch' = 'dependency'): PlanEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    type,
  }
}

function makeBranch(
  id: string,
  nodeIds: string[],
  overrides: Partial<DeliveryBranchRecord> = {},
): DeliveryBranchRecord {
  return {
    id,
    branchName: `astro/proj-${id}`,
    nodeIds,
    isSingleton: nodeIds.length === 1,
    status: 'active',
    ...overrides,
  }
}

// ============================================================================
// Union-Find Tests
// ============================================================================

describe('UnionFind', () => {
  it('initializes each element as its own component', () => {
    const uf = new UnionFind(['a', 'b', 'c'])
    expect(uf.find('a')).toBe('a')
    expect(uf.find('b')).toBe('b')
    expect(uf.connected('a', 'b')).toBe(false)
  })

  it('unions two elements', () => {
    const uf = new UnionFind(['a', 'b', 'c'])
    expect(uf.union('a', 'b')).toBe(true)
    expect(uf.connected('a', 'b')).toBe(true)
    expect(uf.connected('a', 'c')).toBe(false)
  })

  it('returns false when unioning elements already in same set', () => {
    const uf = new UnionFind(['a', 'b'])
    uf.union('a', 'b')
    expect(uf.union('a', 'b')).toBe(false)
  })

  it('handles transitive unions', () => {
    const uf = new UnionFind(['a', 'b', 'c'])
    uf.union('a', 'b')
    uf.union('b', 'c')
    expect(uf.connected('a', 'c')).toBe(true)
  })

  it('getComponents returns grouped results', () => {
    const uf = new UnionFind(['a', 'b', 'c', 'd'])
    uf.union('a', 'b')
    uf.union('c', 'd')
    const components = uf.getComponents()
    expect(components.size).toBe(2)

    const sets = Array.from(components.values()).map((s) => s.sort())
    expect(sets).toContainEqual(['a', 'b'])
    expect(sets).toContainEqual(['c', 'd'])
  })

  it('has() reports known elements', () => {
    const uf = new UnionFind(['a', 'b'])
    expect(uf.has('a')).toBe(true)
    expect(uf.has('z')).toBe(false)
  })

  it('handles large number of elements', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `n${i}`)
    const uf = new UnionFind(ids)
    // Chain them all together
    for (let i = 1; i < ids.length; i++) {
      uf.union(ids[i - 1], ids[i])
    }
    expect(uf.connected(ids[0], ids[999])).toBe(true)
    expect(uf.getComponents().size).toBe(1)
  })
})

// ============================================================================
// computeConnectedComponents Tests
// ============================================================================

describe('computeConnectedComponents', () => {
  it('returns empty array for empty graph', () => {
    expect(computeConnectedComponents([], [])).toEqual([])
  })

  it('returns empty array when all nodes are pruned', () => {
    const nodes = [
      makeNode({ id: 'a', status: 'pruned' }),
      makeNode({ id: 'b', status: 'pruned' }),
    ]
    expect(computeConnectedComponents(nodes, [])).toEqual([])
  })

  it('returns empty array when only milestones exist (no executable tasks)', () => {
    const nodes = [
      makeNode({ id: 'm1', type: 'milestone' }),
      makeNode({ id: 'm2', type: 'milestone' }),
    ]
    expect(computeConnectedComponents(nodes, [])).toEqual([])
  })

  it('identifies independent tasks as separate singleton components', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1 }),
      makeNode({ id: 't2', number: 2 }),
      makeNode({ id: 't3', number: 3 }),
    ]
    const components = computeConnectedComponents(nodes, [])
    expect(components).toHaveLength(3)
    expect(components.every((c) => c.isSingleton)).toBe(true)
    expect(components.map((c) => c.taskIds)).toEqual([['t1'], ['t2'], ['t3']])
  })

  it('groups tasks connected by dependency edges', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1 }),
      makeNode({ id: 't2', number: 2 }),
      makeNode({ id: 't3', number: 3 }),
    ]
    const edges = [makeEdge('t1', 't2'), makeEdge('t2', 't3')]
    const components = computeConnectedComponents(nodes, edges)
    expect(components).toHaveLength(1)
    expect(components[0].taskIds.sort()).toEqual(['t1', 't2', 't3'])
    expect(components[0].isSingleton).toBe(false)
  })

  it('groups tasks connected by branch edges', () => {
    const nodes = [
      makeNode({ id: 'decision', type: 'branch' }),
      makeNode({ id: 't1', number: 1 }),
      makeNode({ id: 't2', number: 2 }),
    ]
    const edges = [
      makeEdge('decision', 't1', 'branch'),
      makeEdge('decision', 't2', 'branch'),
    ]
    const components = computeConnectedComponents(nodes, edges)
    expect(components).toHaveLength(1)
    expect(components[0].taskIds.sort()).toEqual(['t1', 't2'])
  })

  it('connects tasks to milestones via milestoneId', () => {
    const nodes = [
      makeNode({ id: 'm1', type: 'milestone', number: 1 }),
      makeNode({ id: 't1', number: 2, milestoneId: 'm1' }),
      makeNode({ id: 't2', number: 3, milestoneId: 'm1' }),
      makeNode({ id: 't3', number: 4 }), // independent
    ]
    const components = computeConnectedComponents(nodes, [])
    expect(components).toHaveLength(2)
    // Component with milestone tasks
    const milestoneComp = components.find((c) => c.taskIds.includes('t1'))!
    expect(milestoneComp.taskIds.sort()).toEqual(['t1', 't2'])
    expect(milestoneComp.nodeIds).toContain('m1')
    // Independent task
    const singleComp = components.find((c) => c.taskIds.includes('t3'))!
    expect(singleComp.isSingleton).toBe(true)
  })

  it('connects milestone-dependent tasks with milestone-contained tasks', () => {
    // Milestone M contains T1, T2. Task T3 depends on M.
    // All should be in one component.
    const nodes = [
      makeNode({ id: 'm1', type: 'milestone', number: 1 }),
      makeNode({ id: 't1', number: 2, milestoneId: 'm1' }),
      makeNode({ id: 't2', number: 3, milestoneId: 'm1' }),
      makeNode({ id: 't3', number: 4, dependencies: ['m1'] }),
    ]
    const edges = [makeEdge('m1', 't3')]
    const components = computeConnectedComponents(nodes, edges)
    expect(components).toHaveLength(1)
    expect(components[0].taskIds.sort()).toEqual(['t1', 't2', 't3'])
  })

  it('handles node.dependencies[] as connectivity source', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1 }),
      makeNode({ id: 't2', number: 2, dependencies: ['t1'] }),
    ]
    // No edges — only node.dependencies
    const components = computeConnectedComponents(nodes, [])
    expect(components).toHaveLength(1)
    expect(components[0].taskIds.sort()).toEqual(['t1', 't2'])
  })

  it('ignores deleted edges', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1 }),
      makeNode({ id: 't2', number: 2 }),
    ]
    const edges: PlanEdge[] = [{
      id: 'e1',
      source: 't1',
      target: 't2',
      type: 'dependency',
      deletedAt: new Date(),
    }]
    const components = computeConnectedComponents(nodes, edges)
    expect(components).toHaveLength(2)
  })

  it('ignores soft-deleted nodes', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1 }),
      makeNode({ id: 't2', number: 2, deletedAt: new Date() }),
    ]
    const edges = [makeEdge('t1', 't2')]
    const components = computeConnectedComponents(nodes, edges)
    expect(components).toHaveLength(1)
    expect(components[0].taskIds).toEqual(['t1'])
  })

  it('ignores edges referencing non-existent nodes', () => {
    const nodes = [makeNode({ id: 't1', number: 1 })]
    const edges = [makeEdge('t1', 'nonexistent')]
    const components = computeConnectedComponents(nodes, edges)
    expect(components).toHaveLength(1)
    expect(components[0].taskIds).toEqual(['t1'])
  })

  it('handles multiple disconnected subgraphs', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1 }),
      makeNode({ id: 't2', number: 2 }),
      makeNode({ id: 't3', number: 3 }),
      makeNode({ id: 't4', number: 4 }),
    ]
    const edges = [
      makeEdge('t1', 't2'), // Group A
      makeEdge('t3', 't4'), // Group B
    ]
    const components = computeConnectedComponents(nodes, edges)
    expect(components).toHaveLength(2)
    const groups = components.map((c) => c.taskIds.sort())
    expect(groups).toContainEqual(['t1', 't2'])
    expect(groups).toContainEqual(['t3', 't4'])
  })

  it('sorts components by lowest task number', () => {
    const nodes = [
      makeNode({ id: 'z', number: 10 }),
      makeNode({ id: 'a', number: 1 }),
      makeNode({ id: 'm', number: 5 }),
    ]
    const components = computeConnectedComponents(nodes, [])
    expect(components.map((c) => c.taskIds[0])).toEqual(['a', 'm', 'z'])
  })

  it('handles complex graph with milestones, dependencies, and independent tasks', () => {
    // Scenario B from design doc:
    // Milestone A → T1, T2 (T2 depends on T1)
    // Milestone B → T3
    // T4 depends on Milestone A
    // T5 independent
    const nodes = [
      makeNode({ id: 'mA', type: 'milestone', number: 1 }),
      makeNode({ id: 't1', number: 2, milestoneId: 'mA' }),
      makeNode({ id: 't2', number: 3, milestoneId: 'mA', dependencies: ['t1'] }),
      makeNode({ id: 'mB', type: 'milestone', number: 4 }),
      makeNode({ id: 't3', number: 5, milestoneId: 'mB' }),
      makeNode({ id: 't4', number: 6, dependencies: ['mA'] }),
      makeNode({ id: 't5', number: 7 }),
    ]
    const edges = [
      makeEdge('t1', 't2'),
      makeEdge('mA', 't4'),
    ]

    const components = computeConnectedComponents(nodes, edges)
    expect(components).toHaveLength(3)

    // CC1: mA + T1, T2, T4 (connected via containment + dependency)
    const cc1 = components.find((c) => c.taskIds.includes('t1'))!
    expect(cc1.taskIds.sort()).toEqual(['t1', 't2', 't4'])
    expect(cc1.nodeIds).toContain('mA')
    expect(cc1.isSingleton).toBe(false)

    // CC2: mB + T3 (connected via containment)
    const cc2 = components.find((c) => c.taskIds.includes('t3'))!
    expect(cc2.taskIds).toEqual(['t3'])
    expect(cc2.nodeIds).toContain('mB')
    expect(cc2.isSingleton).toBe(true)

    // CC3: T5 (independent)
    const cc3 = components.find((c) => c.taskIds.includes('t5'))!
    expect(cc3.taskIds).toEqual(['t5'])
    expect(cc3.isSingleton).toBe(true)
  })
})

// ============================================================================
// detectStructuralChanges Tests
// ============================================================================

describe('detectStructuralChanges', () => {
  it('returns all-create when no existing branches', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1 }),
      makeNode({ id: 't2', number: 2 }),
    ]
    const result = detectStructuralChanges(nodes, [], [])
    expect(result.create).toHaveLength(2)
    expect(result.keep).toHaveLength(0)
    expect(result.restart).toHaveLength(0)
  })

  it('keeps branch when component structure unchanged', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1, status: 'completed' }),
      makeNode({ id: 't2', number: 2, status: 'planned' }),
    ]
    const edges = [makeEdge('t1', 't2')]
    const branches = [makeBranch('d1', ['t1', 't2'])]

    const result = detectStructuralChanges(nodes, edges, branches)
    expect(result.keep).toHaveLength(1)
    expect(result.keep[0].branch.id).toBe('d1')
    expect(result.restart).toHaveLength(0)
  })

  it('creates new branch for new independent task', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1, status: 'completed' }),
      makeNode({ id: 't2', number: 2 }), // new, independent
    ]
    const branches = [makeBranch('d1', ['t1'])]

    const result = detectStructuralChanges(nodes, [], branches)
    expect(result.keep).toHaveLength(1)
    expect(result.create).toHaveLength(1)
    expect(result.create[0].component.taskIds).toEqual(['t2'])
    expect(result.restart).toHaveLength(0)
  })

  it('allows unexecuted task to split off without restart', () => {
    // CC1 had {t1, t2, t3} on d1. t1 and t2 executed, t3 not.
    // Re-plan removes edge t2→t3.
    const nodes = [
      makeNode({ id: 't1', number: 1, status: 'completed' }),
      makeNode({ id: 't2', number: 2, status: 'completed' }),
      makeNode({ id: 't3', number: 3, status: 'planned' }),
    ]
    const edges = [makeEdge('t1', 't2')] // t2→t3 edge removed
    const branches = [makeBranch('d1', ['t1', 't2', 't3'])]

    const result = detectStructuralChanges(nodes, edges, branches)
    // t1+t2 stay on d1, t3 gets a new branch
    expect(result.restart).toHaveLength(0)
    expect(result.keep).toHaveLength(1)
    expect(result.create).toHaveLength(1)
    expect(result.create[0].component.taskIds).toEqual(['t3'])
  })

  it('requires restart when splitting executed tasks from same branch', () => {
    // Scenario G from design doc: {t1, t2, t3} all executed on d1.
    // Re-plan removes edge t1→t2, splitting into {t1, t3} and {t2}.
    const nodes = [
      makeNode({ id: 't1', number: 1, status: 'completed' }),
      makeNode({ id: 't2', number: 2, status: 'completed' }),
      makeNode({ id: 't3', number: 3, status: 'completed', dependencies: ['t1'] }),
    ]
    const edges = [makeEdge('t1', 't3')] // t1→t2 removed
    const branches = [makeBranch('d1', ['t1', 't2', 't3'])]

    const result = detectStructuralChanges(nodes, edges, branches)
    expect(result.restart).toHaveLength(1)
    expect(result.restart[0].affectedBranches[0].id).toBe('d1')
    expect(result.restart[0].reason).toBe('split')
  })

  it('requires restart when merging components with executed tasks', () => {
    // Scenario E: CC1={t1,t2} on d1 (t1 executed), CC2={t3} on d2 (t3 executed)
    // Re-plan adds edge t2→t3.
    const nodes = [
      makeNode({ id: 't1', number: 1, status: 'completed' }),
      makeNode({ id: 't2', number: 2, status: 'planned' }),
      makeNode({ id: 't3', number: 3, status: 'completed' }),
    ]
    const edges = [makeEdge('t1', 't2'), makeEdge('t2', 't3')]
    const branches = [
      makeBranch('d1', ['t1', 't2']),
      makeBranch('d2', ['t3']),
    ]

    const result = detectStructuralChanges(nodes, edges, branches)
    expect(result.restart).toHaveLength(1)
    expect(result.restart[0].affectedBranches.map((b) => b.id).sort()).toEqual(['d1', 'd2'])
    expect(result.restart[0].reason).toBe('merge')
  })

  it('does not require restart when merging components with only unexecuted tasks', () => {
    // CC1={t1,t2} on d1 (neither executed), CC2={t3} on d2 (not executed)
    // Re-plan adds edge t2→t3 → merge. But no executed work, so just reassign.
    const nodes = [
      makeNode({ id: 't1', number: 1, status: 'planned' }),
      makeNode({ id: 't2', number: 2, status: 'planned' }),
      makeNode({ id: 't3', number: 3, status: 'planned' }),
    ]
    const edges = [makeEdge('t1', 't2'), makeEdge('t2', 't3')]
    const branches = [
      makeBranch('d1', ['t1', 't2']),
      makeBranch('d2', ['t3']),
    ]

    const result = detectStructuralChanges(nodes, edges, branches)
    expect(result.restart).toHaveLength(0)
    // One component gets kept, the other's nodes move
    expect(result.keep.length + result.create.length).toBeGreaterThanOrEqual(1)
  })

  it('ignores obsolete delivery branches', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1, status: 'completed' }),
      makeNode({ id: 't2', number: 2, status: 'planned' }),
    ]
    const edges = [makeEdge('t1', 't2')]
    const branches = [
      makeBranch('d1', ['t1', 't2'], { status: 'obsolete' }),
    ]

    const result = detectStructuralChanges(nodes, edges, branches)
    // Obsolete branch is ignored, so everything is "create"
    expect(result.create).toHaveLength(1)
    expect(result.restart).toHaveLength(0)
  })
})

// ============================================================================
// requiresRestart Tests
// ============================================================================

describe('requiresRestart', () => {
  it('returns false for fresh graph with no branches', () => {
    const nodes = [makeNode({ id: 't1', number: 1 })]
    expect(requiresRestart(nodes, [], [])).toBe(false)
  })

  it('returns false when structure is unchanged', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1, status: 'completed' }),
      makeNode({ id: 't2', number: 2 }),
    ]
    const edges = [makeEdge('t1', 't2')]
    const branches = [makeBranch('d1', ['t1', 't2'])]
    expect(requiresRestart(nodes, edges, branches)).toBe(false)
  })

  it('returns true when executed tasks are split', () => {
    const nodes = [
      makeNode({ id: 't1', number: 1, status: 'completed' }),
      makeNode({ id: 't2', number: 2, status: 'completed' }),
    ]
    // No edges — t1 and t2 are now separate components
    const branches = [makeBranch('d1', ['t1', 't2'])]
    expect(requiresRestart(nodes, [], branches)).toBe(true)
  })
})
