/**
 * Pruned Node Handling — Comprehensive Tests
 *
 * Verifies that pruned (abandoned) nodes are handled correctly across all views:
 * - List view: excluded from active groups, shown in separate "Deprecated" group
 * - Graph view: always excluded
 * - Timeline view: always excluded
 * - Export: always excluded (nodes + orphaned edges)
 *
 * Tests both the filtering logic and the deprecated group construction
 * across all grouping modes (milestone, status, priority, project, label, none).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { usePlanStore } from '@/stores/plan-store'
import type { PlanNode, PlanEdge } from '@/types'

// ─── Test Fixtures ───────────────────────────────────────────────────

const PROJECT_ID = 'proj-pruned-test'
const PROJECT_ID_2 = 'proj-other'

function makeNode(overrides: Partial<PlanNode> & { id: string; title: string }): PlanNode {
  return {
    projectId: PROJECT_ID,
    type: 'task',
    description: 'Test description',
    content: '<p>Test description</p>',
    status: 'planned',
    parentId: null,
    dependencies: [],
    verification: 'auto',
    position: { x: 40, y: 40 },
    priority: 'medium',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeEdge(source: string, target: string, type: 'dependency' | 'branch' = 'dependency'): PlanEdge {
  return { id: `e-${source}-${target}`, source, target, type }
}

/**
 * Seed store with a graph containing active and pruned nodes.
 *
 * Graph:
 *   m1 (milestone: "Phase 1")
 *   t1 (task: "API setup", planned) -> m1
 *   t2 (task: "Write tests", in_progress) -> t1
 *   t3 (task: "Build UI", completed) -> m1
 *   t4 (task: "Old approach", pruned) -> m1
 *   t5 (task: "Dead end", pruned) -> t4
 *   t6 (task: "Auto verified task", auto_verified) -> m1
 */
function seedStore() {
  const store = usePlanStore.getState()

  const m1 = makeNode({ id: 'm1', title: 'Phase 1', type: 'milestone', description: 'First phase' })
  const t1 = makeNode({ id: 't1', title: 'API setup', status: 'planned', priority: 'high', estimate: 'M', milestoneId: 'm1', labelIds: ['l2'] })
  const t2 = makeNode({ id: 't2', title: 'Write tests', status: 'in_progress', dependencies: ['t1'], milestoneId: 'm1', labelIds: ['l3'] })
  const t3 = makeNode({ id: 't3', title: 'Build UI', status: 'completed', milestoneId: 'm1', labelIds: ['l1'] })
  const t4 = makeNode({ id: 't4', title: 'Old approach', status: 'pruned', milestoneId: 'm1', priority: 'low', labelIds: ['l2'] })
  const t5 = makeNode({ id: 't5', title: 'Dead end', status: 'pruned', dependencies: ['t4'], milestoneId: 'm1' })
  const t6 = makeNode({ id: 't6', title: 'Auto verified task', status: 'auto_verified', milestoneId: 'm1', labelIds: ['l3'] })

  const edges: PlanEdge[] = [
    makeEdge('t1', 'm1'),
    makeEdge('t2', 't1'),
    makeEdge('t3', 'm1'),
    makeEdge('t4', 'm1'),
    makeEdge('t5', 't4'),
    makeEdge('t6', 'm1'),
  ]

  store.setProjectPlan(PROJECT_ID, [m1, t1, t2, t3, t4, t5, t6], edges)

  return {
    allNodes: () => usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID),
    allEdges: () => usePlanStore.getState().edges,
    getNode: (id: string) => usePlanStore.getState().nodes.find(n => n.id === id),
  }
}

// ─── Filtering Logic (replicated from components) ─────────────────

/** Graph view filter: always exclude pruned, conditionally exclude completed */
function graphFilter(nodes: PlanNode[], showCompleted: boolean): PlanNode[] {
  let filtered = nodes.filter(n => n.status !== 'pruned')
  if (!showCompleted) {
    filtered = filtered.filter(n => n.status !== 'completed' && n.status !== 'auto_verified')
  }
  return filtered.filter(n => n.type !== 'milestone')
}

/** List view active tasks filter: exclude milestones and pruned */
function listActiveFilter(nodes: PlanNode[], showCompleted: boolean): PlanNode[] {
  let filtered = nodes.filter(n => n.type !== 'milestone' && n.status !== 'pruned')
  if (!showCompleted) {
    filtered = filtered.filter(n => n.status !== 'completed' && n.status !== 'auto_verified')
  }
  return filtered
}

/** List view pruned tasks (for deprecated group) */
function listPrunedFilter(nodes: PlanNode[]): PlanNode[] {
  return nodes.filter(n => n.type !== 'milestone' && n.status === 'pruned')
}

/** Timeline view filter: always exclude pruned, conditionally exclude completed */
function timelineFilter(nodes: PlanNode[], showCompleted: boolean): PlanNode[] {
  let filtered = nodes.filter(n => n.type !== 'milestone' && n.status !== 'pruned')
  if (!showCompleted) {
    filtered = filtered.filter(n => n.status !== 'completed' && n.status !== 'auto_verified')
  }
  return filtered
}

/** Export filter: exclude pruned nodes, then exclude edges referencing missing nodes */
function exportFilter(nodes: PlanNode[], edges: PlanEdge[]): { nodes: PlanNode[]; edges: PlanEdge[] } {
  const activeNodes = nodes.filter(n => n.status !== 'pruned')
  const nodeIds = new Set(activeNodes.map(n => n.id))
  const activeEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
  return { nodes: activeNodes, edges: activeEdges }
}

// ─── Grouping Logic (replicated from plan-view) ──────────────────

interface ListGroup {
  key: string
  label: string
  items: PlanNode[]
  defaultCollapsed?: boolean
  headerClassName?: string
  itemClassName?: string
}

const statusLabels: Record<string, string> = {
  planned: 'Planned',
  dispatched: 'Dispatched',
  in_progress: 'In Progress',
  auto_verified: 'Auto Verified',
  awaiting_judgment: 'Needs Review',
  awaiting_approval: 'Awaiting Approval',
  completed: 'Completed',
  pruned: 'Pruned',
}

function buildGroups(
  tasks: PlanNode[],
  prunedTasks: PlanNode[],
  groupBy: 'milestone' | 'status' | 'priority' | 'label' | 'project' | 'none',
  milestones: PlanNode[],
  labels: { id: string; name: string; color: string }[] = [],
): ListGroup[] {
  let result: ListGroup[]

  if (groupBy === 'milestone') {
    result = []
    for (const m of milestones) {
      const grouped = tasks.filter(n => n.milestoneId === m.id)
      result.push({ key: `milestone-${m.id}`, label: m.title, items: grouped })
    }
    const unassigned = tasks.filter(n => !n.milestoneId)
    if (unassigned.length > 0) {
      result.push({ key: 'unassigned', label: 'Unassigned', items: unassigned })
    }
  } else if (groupBy === 'status') {
    const grouped: Record<string, PlanNode[]> = {}
    for (const node of tasks) {
      const key = statusLabels[node.status] ?? node.status
      ;(grouped[key] ??= []).push(node)
    }
    result = Object.entries(grouped).map(([label, items]) => ({ key: label, label, items }))
  } else if (groupBy === 'priority') {
    const grouped: Record<string, PlanNode[]> = {}
    for (const node of tasks) {
      const key = node.priority ? (node.priority.charAt(0).toUpperCase() + node.priority.slice(1)) : 'No priority'
      ;(grouped[key] ??= []).push(node)
    }
    result = Object.entries(grouped).map(([label, items]) => ({ key: label, label, items }))
  } else if (groupBy === 'label') {
    const labelMap = new Map(labels.map(l => [l.id, l]))
    result = []
    for (const l of labels) {
      const grouped = tasks.filter(n => n.labelIds?.includes(l.id))
      result.push({ key: `label-${l.id}`, label: l.name, items: grouped })
    }
    const noLabel = tasks.filter(n => !n.labelIds?.length || !n.labelIds.some(lid => labelMap.has(lid)))
    if (noLabel.length > 0) {
      result.push({ key: 'no-label', label: 'No label', items: noLabel })
    }
  } else {
    result = [{ key: 'all', label: 'All Tasks', items: tasks }]
  }

  // Append deprecated group
  if (prunedTasks.length > 0) {
    result.push({
      key: 'deprecated',
      label: 'Deprecated',
      items: prunedTasks,
      defaultCollapsed: true,
      headerClassName: 'bg-muted/50 border-t border-dashed border-border',
      itemClassName: 'opacity-60',
    })
  }

  return result
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Pruned Node Handling', () => {
  beforeEach(() => {
    usePlanStore.setState({ nodes: [], edges: [], loaded: true, recentlyUpdatedNodeIds: new Set() })
  })

  // ─── Graph View ─────────────────────────────────────────────────

  describe('Graph view filtering', () => {
    it('always excludes pruned nodes regardless of showCompleted', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()

      const withCompleted = graphFilter(nodes, true)
      const withoutCompleted = graphFilter(nodes, false)

      // With showCompleted=true: all non-pruned, non-milestone nodes
      expect(withCompleted.map(n => n.id).sort()).toEqual(['t1', 't2', 't3', 't6'])
      expect(withCompleted.find(n => n.status === 'pruned')).toBeUndefined()

      // With showCompleted=false: exclude completed + auto_verified too
      expect(withoutCompleted.map(n => n.id).sort()).toEqual(['t1', 't2'])
      expect(withoutCompleted.find(n => n.status === 'pruned')).toBeUndefined()
    })

    it('excludes pruned even when showCompleted is true', () => {
      const { allNodes } = seedStore()
      const result = graphFilter(allNodes(), true)
      const prunedInResult = result.filter(n => n.status === 'pruned')
      expect(prunedInResult).toHaveLength(0)
    })

    it('excludes milestones', () => {
      const { allNodes } = seedStore()
      const result = graphFilter(allNodes(), true)
      expect(result.find(n => n.type === 'milestone')).toBeUndefined()
    })

    it('handles all-pruned graph', () => {
      const store = usePlanStore.getState()
      store.setProjectPlan(PROJECT_ID, [
        makeNode({ id: 'p1', title: 'Pruned 1', status: 'pruned' }),
        makeNode({ id: 'p2', title: 'Pruned 2', status: 'pruned' }),
      ], [])
      const nodes = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID)
      expect(graphFilter(nodes, true)).toHaveLength(0)
      expect(graphFilter(nodes, false)).toHaveLength(0)
    })

    it('handles empty graph', () => {
      expect(graphFilter([], true)).toHaveLength(0)
      expect(graphFilter([], false)).toHaveLength(0)
    })
  })

  // ─── List View Filtering ────────────────────────────────────────

  describe('List view filtering', () => {
    it('separates active tasks from pruned tasks', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()

      const active = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      // Active should have all non-pruned, non-milestone tasks
      expect(active.map(n => n.id).sort()).toEqual(['t1', 't2', 't3', 't6'])
      expect(active.find(n => n.status === 'pruned')).toBeUndefined()

      // Pruned should only have pruned tasks
      expect(pruned.map(n => n.id).sort()).toEqual(['t4', 't5'])
      expect(pruned.every(n => n.status === 'pruned')).toBe(true)
    })

    it('active filter excludes completed when showCompleted=false', () => {
      const { allNodes } = seedStore()
      const active = listActiveFilter(allNodes(), false)
      expect(active.map(n => n.id).sort()).toEqual(['t1', 't2'])
      // No completed, no auto_verified, no pruned
      expect(active.find(n => n.status === 'completed')).toBeUndefined()
      expect(active.find(n => n.status === 'auto_verified')).toBeUndefined()
      expect(active.find(n => n.status === 'pruned')).toBeUndefined()
    })

    it('pruned filter is independent of showCompleted', () => {
      const { allNodes } = seedStore()
      const pruned = listPrunedFilter(allNodes())
      // Always returns pruned tasks regardless of any toggle
      expect(pruned).toHaveLength(2)
      expect(pruned.every(n => n.status === 'pruned')).toBe(true)
    })

    it('active + pruned = all non-milestone tasks', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()
      const active = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)
      const nonMilestoneCount = nodes.filter(n => n.type !== 'milestone').length
      expect(active.length + pruned.length).toBe(nonMilestoneCount)
    })

    it('no overlap between active and pruned', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()
      const activeIds = new Set(listActiveFilter(nodes, true).map(n => n.id))
      const prunedIds = new Set(listPrunedFilter(nodes).map(n => n.id))
      for (const id of prunedIds) {
        expect(activeIds.has(id)).toBe(false)
      }
    })

    it('excludes milestone from pruned list', () => {
      const store = usePlanStore.getState()
      // Edge case: milestone with pruned status (unusual but possible)
      store.setProjectPlan(PROJECT_ID, [
        makeNode({ id: 'm-pruned', title: 'Pruned milestone', type: 'milestone', status: 'pruned' as PlanNode['status'] }),
        makeNode({ id: 't-pruned', title: 'Pruned task', status: 'pruned' }),
      ], [])
      const nodes = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID)
      const pruned = listPrunedFilter(nodes)
      expect(pruned).toHaveLength(1)
      expect(pruned[0].id).toBe('t-pruned')
    })
  })

  // ─── Timeline View ──────────────────────────────────────────────

  describe('Timeline view filtering', () => {
    it('always excludes pruned nodes', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()

      const withCompleted = timelineFilter(nodes, true)
      const withoutCompleted = timelineFilter(nodes, false)

      expect(withCompleted.find(n => n.status === 'pruned')).toBeUndefined()
      expect(withoutCompleted.find(n => n.status === 'pruned')).toBeUndefined()
    })

    it('matches graph view behavior for pruned exclusion', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()

      // Both views should agree on pruned exclusion
      const graphNodes = graphFilter(nodes, true)
      const timelineNodes = timelineFilter(nodes, true)

      // Same set of tasks (graph also excludes milestones, timeline also excludes milestones)
      expect(new Set(graphNodes.map(n => n.id))).toEqual(new Set(timelineNodes.map(n => n.id)))
    })
  })

  // ─── Export ─────────────────────────────────────────────────────

  describe('Export filtering', () => {
    it('excludes pruned nodes from export', () => {
      const { allNodes, allEdges } = seedStore()
      const { nodes } = exportFilter(allNodes(), allEdges())

      expect(nodes.find(n => n.status === 'pruned')).toBeUndefined()
      expect(nodes.find(n => n.id === 't4')).toBeUndefined()
      expect(nodes.find(n => n.id === 't5')).toBeUndefined()
    })

    it('preserves non-pruned nodes including milestones', () => {
      const { allNodes, allEdges } = seedStore()
      const { nodes } = exportFilter(allNodes(), allEdges())

      // Milestone is kept (only pruned status is excluded)
      expect(nodes.find(n => n.id === 'm1')).toBeDefined()
      expect(nodes.find(n => n.id === 't1')).toBeDefined()
      expect(nodes.find(n => n.id === 't3')).toBeDefined()
    })

    it('removes edges that reference pruned nodes', () => {
      const { allNodes, allEdges } = seedStore()
      const { edges } = exportFilter(allNodes(), allEdges())

      // Edge t4->m1 should be gone (t4 is pruned)
      expect(edges.find(e => e.source === 't4')).toBeUndefined()
      // Edge t5->t4 should be gone (both pruned)
      expect(edges.find(e => e.source === 't5')).toBeUndefined()
      expect(edges.find(e => e.target === 't4')).toBeUndefined()
    })

    it('preserves edges between active nodes', () => {
      const { allNodes, allEdges } = seedStore()
      const { edges } = exportFilter(allNodes(), allEdges())

      // These edges should survive
      expect(edges.find(e => e.source === 't1' && e.target === 'm1')).toBeDefined()
      expect(edges.find(e => e.source === 't2' && e.target === 't1')).toBeDefined()
      expect(edges.find(e => e.source === 't3' && e.target === 'm1')).toBeDefined()
      expect(edges.find(e => e.source === 't6' && e.target === 'm1')).toBeDefined()
    })

    it('handles edge where only source is pruned', () => {
      const store = usePlanStore.getState()
      const nodes = [
        makeNode({ id: 'a', title: 'Active', status: 'planned' }),
        makeNode({ id: 'p', title: 'Pruned', status: 'pruned' }),
      ]
      const edges = [makeEdge('p', 'a')]
      store.setProjectPlan(PROJECT_ID, nodes, edges)

      const result = exportFilter(
        usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID),
        usePlanStore.getState().edges,
      )
      expect(result.nodes).toHaveLength(1)
      expect(result.edges).toHaveLength(0) // edge dropped since source is pruned
    })

    it('handles edge where only target is pruned', () => {
      const store = usePlanStore.getState()
      const nodes = [
        makeNode({ id: 'a', title: 'Active', status: 'planned' }),
        makeNode({ id: 'p', title: 'Pruned', status: 'pruned' }),
      ]
      const edges = [makeEdge('a', 'p')]
      store.setProjectPlan(PROJECT_ID, nodes, edges)

      const result = exportFilter(
        usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID),
        usePlanStore.getState().edges,
      )
      expect(result.nodes).toHaveLength(1)
      expect(result.edges).toHaveLength(0) // edge dropped since target is pruned
    })

    it('handles all-pruned project', () => {
      const store = usePlanStore.getState()
      store.setProjectPlan(PROJECT_ID, [
        makeNode({ id: 'p1', title: 'Pruned 1', status: 'pruned' }),
        makeNode({ id: 'p2', title: 'Pruned 2', status: 'pruned' }),
      ], [makeEdge('p1', 'p2')])

      const result = exportFilter(
        usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID),
        usePlanStore.getState().edges,
      )
      expect(result.nodes).toHaveLength(0)
      expect(result.edges).toHaveLength(0)
    })

    it('handles project with no pruned nodes', () => {
      const store = usePlanStore.getState()
      store.setProjectPlan(PROJECT_ID, [
        makeNode({ id: 'a1', title: 'Task 1', status: 'planned' }),
        makeNode({ id: 'a2', title: 'Task 2', status: 'completed' }),
      ], [makeEdge('a1', 'a2')])

      const result = exportFilter(
        usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID),
        usePlanStore.getState().edges,
      )
      expect(result.nodes).toHaveLength(2)
      expect(result.edges).toHaveLength(1)
    })
  })

  // ─── Deprecated Group Construction ──────────────────────────────

  describe('Deprecated group in list view', () => {
    it('appears at the bottom of groups when pruned tasks exist', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()
      const milestones = nodes.filter(n => n.type === 'milestone')
      const tasks = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      const groups = buildGroups(tasks, pruned, 'milestone', milestones)
      const lastGroup = groups[groups.length - 1]
      expect(lastGroup.key).toBe('deprecated')
      expect(lastGroup.label).toBe('Deprecated')
    })

    it('is collapsed by default', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()
      const milestones = nodes.filter(n => n.type === 'milestone')
      const tasks = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      const groups = buildGroups(tasks, pruned, 'milestone', milestones)
      const deprecated = groups.find(g => g.key === 'deprecated')!
      expect(deprecated.defaultCollapsed).toBe(true)
    })

    it('has special styling props', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()
      const tasks = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      const groups = buildGroups(tasks, pruned, 'none', [])
      const deprecated = groups.find(g => g.key === 'deprecated')!
      expect(deprecated.headerClassName).toContain('border-dashed')
      expect(deprecated.itemClassName).toContain('opacity-60')
    })

    it('contains exactly the pruned tasks', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()
      const tasks = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      const groups = buildGroups(tasks, pruned, 'none', [])
      const deprecated = groups.find(g => g.key === 'deprecated')!
      expect(deprecated.items.map(n => n.id).sort()).toEqual(['t4', 't5'])
      expect(deprecated.items.every(n => n.status === 'pruned')).toBe(true)
    })

    it('does not appear when there are no pruned tasks', () => {
      const store = usePlanStore.getState()
      store.setProjectPlan(PROJECT_ID, [
        makeNode({ id: 'a1', title: 'Active task', status: 'planned' }),
      ], [])

      const nodes = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID)
      const tasks = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      const groups = buildGroups(tasks, pruned, 'none', [])
      expect(groups.find(g => g.key === 'deprecated')).toBeUndefined()
    })

    it('pruned tasks not in active milestone groups', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()
      const milestones = nodes.filter(n => n.type === 'milestone')
      const tasks = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      const groups = buildGroups(tasks, pruned, 'milestone', milestones)
      // Milestone groups should NOT contain pruned tasks
      const milestoneGroup = groups.find(g => g.key === 'milestone-m1')!
      expect(milestoneGroup.items.find(n => n.status === 'pruned')).toBeUndefined()
    })

    it('pruned tasks not in status groups', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()
      const tasks = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      const groups = buildGroups(tasks, pruned, 'status', [])
      // No "Pruned" status group among the active groups
      const nonDeprecatedGroups = groups.filter(g => g.key !== 'deprecated')
      for (const g of nonDeprecatedGroups) {
        expect(g.items.find(n => n.status === 'pruned')).toBeUndefined()
      }
    })

    it('pruned tasks not in priority groups', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()
      const tasks = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      const groups = buildGroups(tasks, pruned, 'priority', [])
      const nonDeprecatedGroups = groups.filter(g => g.key !== 'deprecated')
      for (const g of nonDeprecatedGroups) {
        expect(g.items.find(n => n.status === 'pruned')).toBeUndefined()
      }
    })

    it('pruned tasks not in label groups', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()
      const tasks = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      const labels = [
        { id: 'l1', name: 'Frontend', color: '#ff0' },
        { id: 'l2', name: 'Backend', color: '#0ff' },
        { id: 'l3', name: 'Testing', color: '#f0f' },
      ]
      const groups = buildGroups(tasks, pruned, 'label', [], labels)
      const nonDeprecatedGroups = groups.filter(g => g.key !== 'deprecated')
      for (const g of nonDeprecatedGroups) {
        expect(g.items.find(n => n.status === 'pruned')).toBeUndefined()
      }
    })
  })

  // ─── Grouping Mode Parity ───────────────────────────────────────

  describe('Deprecated group appended in every grouping mode', () => {
    const groupModes: Array<'milestone' | 'status' | 'priority' | 'label' | 'none'> = [
      'milestone', 'status', 'priority', 'label', 'none',
    ]

    for (const mode of groupModes) {
      it(`appended as last group in "${mode}" grouping`, () => {
        const { allNodes } = seedStore()
        const nodes = allNodes()
        const milestones = nodes.filter(n => n.type === 'milestone')
        const tasks = listActiveFilter(nodes, true)
        const pruned = listPrunedFilter(nodes)
        const labels = [
          { id: 'l1', name: 'Frontend', color: '#ff0' },
          { id: 'l2', name: 'Backend', color: '#0ff' },
          { id: 'l3', name: 'Testing', color: '#f0f' },
        ]

        const groups = buildGroups(tasks, pruned, mode, milestones, labels)
        expect(groups.length).toBeGreaterThan(1) // at least one active group + deprecated
        const lastGroup = groups[groups.length - 1]
        expect(lastGroup.key).toBe('deprecated')
        expect(lastGroup.items).toHaveLength(2)
      })
    }

    for (const mode of groupModes) {
      it(`no deprecated group in "${mode}" when no pruned nodes`, () => {
        const store = usePlanStore.getState()
        store.setProjectPlan(PROJECT_ID, [
          makeNode({ id: 'm1', title: 'Phase 1', type: 'milestone' }),
          makeNode({ id: 'a1', title: 'Active 1', status: 'planned', milestoneId: 'm1', labelIds: ['l1'], priority: 'high' }),
        ], [])

        const nodes = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID)
        const milestones = nodes.filter(n => n.type === 'milestone')
        const tasks = listActiveFilter(nodes, true)
        const pruned = listPrunedFilter(nodes)
        const labels = [{ id: 'l1', name: 'Frontend', color: '#ff0' }]

        const groups = buildGroups(tasks, pruned, mode, milestones, labels)
        expect(groups.find(g => g.key === 'deprecated')).toBeUndefined()
      })
    }
  })

  // ─── Edge Cases ─────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('all tasks pruned — only deprecated group, no active groups with items', () => {
      const store = usePlanStore.getState()
      store.setProjectPlan(PROJECT_ID, [
        makeNode({ id: 'm1', title: 'Phase 1', type: 'milestone' }),
        makeNode({ id: 'p1', title: 'Dead 1', status: 'pruned', milestoneId: 'm1' }),
        makeNode({ id: 'p2', title: 'Dead 2', status: 'pruned', milestoneId: 'm1' }),
      ], [])

      const nodes = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID)
      const milestones = nodes.filter(n => n.type === 'milestone')
      const tasks = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      expect(tasks).toHaveLength(0)
      expect(pruned).toHaveLength(2)

      const groups = buildGroups(tasks, pruned, 'milestone', milestones)
      // Milestone group exists but empty, plus deprecated
      const deprecated = groups.find(g => g.key === 'deprecated')!
      expect(deprecated.items).toHaveLength(2)
    })

    it('single pruned task among many active', () => {
      const store = usePlanStore.getState()
      const nodes = Array.from({ length: 10 }, (_, i) =>
        makeNode({ id: `t${i}`, title: `Task ${i}`, status: i === 5 ? 'pruned' : 'planned' })
      )
      store.setProjectPlan(PROJECT_ID, nodes, [])

      const allNodes = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID)
      const tasks = listActiveFilter(allNodes, true)
      const pruned = listPrunedFilter(allNodes)

      expect(tasks).toHaveLength(9)
      expect(pruned).toHaveLength(1)
      expect(pruned[0].id).toBe('t5')
    })

    it('pruned node with dependencies to active nodes — edges cleaned in export', () => {
      const store = usePlanStore.getState()
      store.setProjectPlan(PROJECT_ID, [
        makeNode({ id: 'a1', title: 'Active 1', status: 'planned' }),
        makeNode({ id: 'a2', title: 'Active 2', status: 'planned', dependencies: ['a1'] }),
        makeNode({ id: 'p1', title: 'Pruned', status: 'pruned', dependencies: ['a1'] }),
      ], [
        makeEdge('a1', 'a2'),
        makeEdge('a1', 'p1'),
      ])

      const allNodes = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID)
      const allEdges = usePlanStore.getState().edges

      const result = exportFilter(allNodes, allEdges)
      expect(result.nodes).toHaveLength(2) // a1, a2
      expect(result.edges).toHaveLength(1) // a1->a2 only
      expect(result.edges[0].target).toBe('a2')
    })

    it('deprecated group items preserve all node fields', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()
      const pruned = listPrunedFilter(nodes)
      const groups = buildGroups(listActiveFilter(nodes, true), pruned, 'none', [])
      const deprecated = groups.find(g => g.key === 'deprecated')!

      for (const node of deprecated.items) {
        expect(node.id).toBeDefined()
        expect(node.title).toBeDefined()
        expect(node.projectId).toBe(PROJECT_ID)
        expect(node.status).toBe('pruned')
        // Fields are preserved — not stripped or modified
        expect(node.description).toBeDefined()
        expect(node.position).toBeDefined()
      }
    })

    it('changing a node from pruned to planned moves it out of deprecated', () => {
      const { allNodes } = seedStore()
      let nodes = allNodes()

      // Initially t4 and t5 are pruned
      let pruned = listPrunedFilter(nodes)
      expect(pruned.map(n => n.id).sort()).toEqual(['t4', 't5'])

      // Simulate recovering t4 by changing its status
      usePlanStore.getState().updateNode('t4', { status: 'planned' })

      nodes = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID)
      const active = listActiveFilter(nodes, true)
      pruned = listPrunedFilter(nodes)

      expect(active.find(n => n.id === 't4')).toBeDefined()
      expect(pruned.map(n => n.id)).toEqual(['t5'])
    })

    it('changing a node from planned to pruned moves it into deprecated', () => {
      const { allNodes } = seedStore()

      // Initially t1 is planned
      let nodes = allNodes()
      let active = listActiveFilter(nodes, true)
      expect(active.find(n => n.id === 't1')).toBeDefined()

      // Prune t1
      usePlanStore.getState().updateNode('t1', { status: 'pruned' })

      nodes = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID)
      active = listActiveFilter(nodes, true)
      const pruned = listPrunedFilter(nodes)

      expect(active.find(n => n.id === 't1')).toBeUndefined()
      expect(pruned.find(n => n.id === 't1')).toBeDefined()
    })

    it('cross-project isolation: pruned from project A not in project B groups', () => {
      const store = usePlanStore.getState()

      // Project A has a pruned task
      store.setProjectPlan(PROJECT_ID, [
        makeNode({ id: 'a-active', title: 'Active A', status: 'planned' }),
        makeNode({ id: 'a-pruned', title: 'Pruned A', status: 'pruned' }),
      ], [])

      // Project B has no pruned tasks
      store.setProjectPlan(PROJECT_ID_2, [
        makeNode({ id: 'b-active', title: 'Active B', status: 'planned', projectId: PROJECT_ID_2 }),
      ], [])

      const nodesA = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID)
      const nodesB = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID_2)

      const prunedA = listPrunedFilter(nodesA)
      const prunedB = listPrunedFilter(nodesB)

      expect(prunedA).toHaveLength(1)
      expect(prunedB).toHaveLength(0)

      // Project B groups should have no deprecated section
      const groupsB = buildGroups(listActiveFilter(nodesB, true), prunedB, 'none', [])
      expect(groupsB.find(g => g.key === 'deprecated')).toBeUndefined()
    })
  })

  // ─── Consistency ────────────────────────────────────────────────

  describe('Cross-view consistency', () => {
    it('same pruned nodes excluded across graph, timeline, and export', () => {
      const { allNodes, allEdges } = seedStore()
      const nodes = allNodes()

      const graphPrunedCount = graphFilter(nodes, true).filter(n => n.status === 'pruned').length
      const timelinePrunedCount = timelineFilter(nodes, true).filter(n => n.status === 'pruned').length
      const exportPrunedCount = exportFilter(nodes, allEdges()).nodes.filter(n => n.status === 'pruned').length

      expect(graphPrunedCount).toBe(0)
      expect(timelinePrunedCount).toBe(0)
      expect(exportPrunedCount).toBe(0)
    })

    it('list view keeps pruned available in deprecated group while others fully exclude', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()

      // Other views: 0 pruned
      expect(graphFilter(nodes, true).filter(n => n.status === 'pruned')).toHaveLength(0)
      expect(timelineFilter(nodes, true).filter(n => n.status === 'pruned')).toHaveLength(0)

      // List view: pruned are in the deprecated group, not deleted
      const pruned = listPrunedFilter(nodes)
      expect(pruned).toHaveLength(2)
      const groups = buildGroups(listActiveFilter(nodes, true), pruned, 'none', [])
      const deprecated = groups.find(g => g.key === 'deprecated')!
      expect(deprecated.items).toHaveLength(2)
    })

    it('showCompleted toggle does NOT affect pruned visibility', () => {
      const { allNodes } = seedStore()
      const nodes = allNodes()

      // Pruned count is the same regardless of showCompleted
      const prunedWithCompleted = listPrunedFilter(nodes)
      // listPrunedFilter doesn't take showCompleted — it's always the same
      expect(prunedWithCompleted).toHaveLength(2)

      // Graph: pruned excluded regardless of toggle
      const graphShow = graphFilter(nodes, true).filter(n => n.status === 'pruned')
      const graphHide = graphFilter(nodes, false).filter(n => n.status === 'pruned')
      expect(graphShow).toHaveLength(0)
      expect(graphHide).toHaveLength(0)

      // Timeline: same
      const tlShow = timelineFilter(nodes, true).filter(n => n.status === 'pruned')
      const tlHide = timelineFilter(nodes, false).filter(n => n.status === 'pruned')
      expect(tlShow).toHaveLength(0)
      expect(tlHide).toHaveLength(0)
    })
  })
})
