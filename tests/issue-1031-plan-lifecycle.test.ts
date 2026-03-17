/**
 * Issue #1031 — Plan Chat Mutations, Regenerate Safety, YOLO Auto-Execution
 *
 * Tests the three phases:
 * 1. Chat mutations: fuzzy title matching and mutation application
 * 2. Regenerate safety: archive/restore lifecycle, status reset
 * 3. YOLO protection: chatMutationProjectIds flag management
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { extractMutations, applyMutationsToStore } from '@/lib/plan-mutations'
import { usePlanStore, isLive } from '@/stores/plan-store'
import { useExecutionStore } from '@/stores/execution-store'
import type { PlanNode, PlanEdge } from '@/types'

// ─── Test Fixtures ───────────────────────────────────────────────────

const PROJECT_ID = 'test-project-1031'

function makeNode(overrides: Partial<PlanNode> & { id: string; title: string }): PlanNode {
  return {
    projectId: PROJECT_ID,
    type: 'task',
    description: '',
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

function seedStore() {
  const store = usePlanStore.getState()
  const nodes: PlanNode[] = [
    makeNode({ id: 'm1', title: 'MVP Release', type: 'milestone', description: 'First milestone' }),
    makeNode({ id: 't1', title: 'Set up API endpoints', description: 'REST API', priority: 'high', estimate: 'M' }),
    makeNode({ id: 't2', title: 'Write integration tests', description: 'Test coverage', dependencies: ['t1'] }),
    makeNode({ id: 't3', title: 'Build React frontend', description: 'React + Tailwind' }),
  ]
  const edges: PlanEdge[] = [
    makeEdge('t1', 't2'),
    makeEdge('t2', 'm1'),
    makeEdge('t3', 'm1'),
  ]
  store.setProjectPlan(PROJECT_ID, nodes, edges)
  return {
    getNodes: () => usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID && isLive(n)),
    getAllNodes: () => usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID),
    getEdges: () => usePlanStore.getState().edges.filter(isLive),
    getNode: (id: string) => usePlanStore.getState().nodes.find(n => n.id === id),
  }
}

// ─── Phase 1: Chat Mutations ────────────────────────────────────────

describe('Phase 1: Chat Mutation Reliability', () => {
  beforeEach(() => {
    usePlanStore.setState({ nodes: [], edges: [], loaded: true, recentlyUpdatedNodeIds: new Set() })
  })

  describe('Fuzzy title matching', () => {
    it('matches exact title (case-insensitive)', () => {
      const { getNode } = seedStore()
      const content = `\`\`\`json
{
  "updateNodes": [
    { "nodeTitle": "set up api endpoints", "priority": "urgent" }
  ]
}
\`\`\``
      const { mutations } = extractMutations(content)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      expect(affectedNodeIds).toHaveLength(1)
      expect(getNode('t1')?.priority).toBe('urgent')
    })

    it('matches via substring includes when exact match fails', () => {
      const { getNode } = seedStore()
      // AI abbreviates "Set up API endpoints" to "API endpoints"
      const content = `\`\`\`json
{
  "updateNodes": [
    { "nodeTitle": "API endpoints", "priority": "low" }
  ]
}
\`\`\``
      const { mutations } = extractMutations(content)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      expect(affectedNodeIds).toHaveLength(1)
      expect(getNode('t1')?.priority).toBe('low')
    })

    it('matches when AI adds extra words (AI title contains node title)', () => {
      const { getNode } = seedStore()
      // AI expands "Build React frontend" to "Build React frontend with Tailwind"
      const content = `\`\`\`json
{
  "updateNodes": [
    { "nodeTitle": "Build React frontend with Tailwind CSS", "estimate": "L" }
  ]
}
\`\`\``
      const { mutations } = extractMutations(content)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      expect(affectedNodeIds).toHaveLength(1)
      expect(getNode('t3')?.estimate).toBe('L')
    })

    it('warns and skips when no match found at all', () => {
      seedStore()
      const content = `\`\`\`json
{
  "updateNodes": [
    { "nodeTitle": "Completely nonexistent task", "priority": "urgent" }
  ]
}
\`\`\``
      const { mutations } = extractMutations(content)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      expect(affectedNodeIds).toHaveLength(0)
    })
  })

  describe('Temp ID cross-reference between addNodes and updateNodes', () => {
    it('resolves temp IDs from addNodes when used as nodeId in updateNodes', () => {
      seedStore()
      // AI adds a milestone with temp ID, then updates an existing node to depend on it
      const content = `\`\`\`json
{
  "addNodes": [
    {
      "id": "new-milestone",
      "title": "Manifest Generation Complete",
      "description": "Gate milestone",
      "type": "milestone",
      "priority": "high"
    }
  ],
  "updateNodes": [
    { "nodeId": "new-milestone", "status": "completed" }
  ]
}
\`\`\``
      const { mutations } = extractMutations(content)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      // Both the addNode and the updateNode should have been applied
      expect(affectedNodeIds).toHaveLength(2)

      // The newly added node should have the updated status
      const realId = affectedNodeIds[0] // first is the addNode
      const node = usePlanStore.getState().nodes.find(n => n.id === realId)!
      expect(node.title).toBe('Manifest Generation Complete')
      expect(node.status).toBe('completed')
    })

    it('resolves temp IDs in updateNodes.dependencies referencing addNodes', () => {
      seedStore()
      const content = `\`\`\`json
{
  "addNodes": [
    {
      "id": "cache-layer",
      "title": "Add caching",
      "description": "Redis cache"
    }
  ],
  "updateEdges": [
    { "action": "add", "source": "cache-layer", "target": "t2", "type": "dependency" }
  ]
}
\`\`\``
      const { mutations } = extractMutations(content)
      applyMutationsToStore(PROJECT_ID, mutations)

      // The edge should use the real UUID, not the temp ID
      const edges = usePlanStore.getState().edges
      const cacheNode = usePlanStore.getState().nodes.find(n => n.title === 'Add caching')!
      const edge = edges.find(e => e.source === cacheNode.id && e.target === 't2')
      expect(edge).toBeTruthy()
    })

    it('resolves temp IDs in updateNodes when looking up newly added nodes by title', () => {
      seedStore()
      const content = `\`\`\`json
{
  "addNodes": [
    {
      "id": "tmp-gate",
      "title": "Quality Gate",
      "description": "Verification step"
    }
  ],
  "updateNodes": [
    { "nodeTitle": "Quality Gate", "priority": "urgent" }
  ]
}
\`\`\``
      const { mutations } = extractMutations(content)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      expect(affectedNodeIds).toHaveLength(2) // addNode + updateNode
      const gateNode = usePlanStore.getState().nodes.find(n => n.title === 'Quality Gate')!
      expect(gateNode.priority).toBe('urgent')
    })
  })

})

// ─── Phase 2: Regenerate Safety ─────────────────────────────────────

describe('Phase 2: Regenerate Safety', () => {
  beforeEach(() => {
    usePlanStore.setState({ nodes: [], edges: [], loaded: true, recentlyUpdatedNodeIds: new Set() })
  })

  describe('archiveProjectForReplan', () => {
    it('soft-deletes all live nodes with a shared deletionActionId', () => {
      const { getAllNodes } = seedStore()
      const archivedIds = usePlanStore.getState().archiveProjectForReplan(PROJECT_ID)

      expect(archivedIds).toHaveLength(4) // m1, t1, t2, t3
      const archived = getAllNodes().filter(n => n.deletedAt)
      expect(archived).toHaveLength(4)

      // All share the same deletionActionId
      const actionIds = new Set(archived.map(n => n.deletionActionId))
      expect(actionIds.size).toBe(1)
    })

    it('returns empty array when no live nodes exist', () => {
      const archivedIds = usePlanStore.getState().archiveProjectForReplan(PROJECT_ID)
      expect(archivedIds).toHaveLength(0)
    })
  })

  describe('getArchivedPlanGroups', () => {
    it('returns multiple groups with correct node counts', () => {
      seedStore()
      // Archive first plan (4 nodes)
      usePlanStore.getState().archiveProjectForReplan(PROJECT_ID)

      // Add new nodes directly (not setProjectPlan, which replaces all nodes for the project).
      // In production, archived nodes persist in DB and survive setProjectPlan via store.load().
      const store = usePlanStore.getState()
      store.addNode(makeNode({ id: 't10', title: 'New task A' }))
      store.addNode(makeNode({ id: 't11', title: 'New task B' }))
      usePlanStore.getState().archiveProjectForReplan(PROJECT_ID)

      const groups = usePlanStore.getState().getArchivedPlanGroups(PROJECT_ID)
      expect(groups).toHaveLength(2)
      // Each group has a distinct deletionActionId
      expect(groups[0].deletionActionId).not.toBe(groups[1].deletionActionId)
      // Total nodes across groups: 4 + 2 = 6
      const counts = groups.map(g => g.nodeCount).sort()
      expect(counts).toEqual([2, 4])
    })

    it('returns empty array when no archived plans exist', () => {
      seedStore()
      const groups = usePlanStore.getState().getArchivedPlanGroups(PROJECT_ID)
      expect(groups).toHaveLength(0)
    })

    it('includes up to 3 task titles in each group', () => {
      seedStore()
      usePlanStore.getState().archiveProjectForReplan(PROJECT_ID)

      const groups = usePlanStore.getState().getArchivedPlanGroups(PROJECT_ID)
      expect(groups[0].titles.length).toBeLessThanOrEqual(3)
      expect(groups[0].titles.length).toBeGreaterThan(0)
    })
  })

  describe('restoreArchivedPlan', () => {
    it('restores archived nodes with status reset to planned', () => {
      seedStore()
      // Simulate some execution state
      usePlanStore.getState().updateNode('t1', {
        status: 'completed',
        executionId: 'exec-123',
        executionOutput: 'Done',
        executionStartedAt: new Date(),
        executionCompletedAt: new Date(),
      })

      const archivedIds = usePlanStore.getState().archiveProjectForReplan(PROJECT_ID)
      expect(archivedIds).toHaveLength(4)

      const groups = usePlanStore.getState().getArchivedPlanGroups(PROJECT_ID)
      expect(groups).toHaveLength(1)

      // Restore
      usePlanStore.getState().restoreArchivedPlan(PROJECT_ID, groups[0].deletionActionId)

      const liveNodes = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID && isLive(n))
      expect(liveNodes).toHaveLength(4)

      // Verify status was reset
      const restoredT1 = liveNodes.find(n => n.id === 't1')!
      expect(restoredT1.status).toBe('planned')
      expect(restoredT1.executionId).toBeUndefined()
      expect(restoredT1.executionOutput).toBeUndefined()
      expect(restoredT1.executionStartedAt).toBeUndefined()
      expect(restoredT1.executionCompletedAt).toBeUndefined()
    })

    it('archives current live plan before restoring', () => {
      seedStore()
      // Archive original plan
      usePlanStore.getState().archiveProjectForReplan(PROJECT_ID)

      // Add a new node directly (simulates a new plan being generated after archive)
      usePlanStore.getState().addNode(makeNode({ id: 'new1', title: 'New plan task' }))

      // Verify new node is live
      const liveBefore = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID && isLive(n))
      expect(liveBefore).toHaveLength(1)
      expect(liveBefore[0].id).toBe('new1')

      // Restore original plan — this should archive 'new1' first
      const groups = usePlanStore.getState().getArchivedPlanGroups(PROJECT_ID)
      expect(groups).toHaveLength(1)
      usePlanStore.getState().restoreArchivedPlan(PROJECT_ID, groups[0].deletionActionId)

      // Original plan should be live, 'new1' should be archived
      const liveAfter = usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID && isLive(n))
      expect(liveAfter).toHaveLength(4) // original plan: m1, t1, t2, t3
      expect(liveAfter.find(n => n.id === 'new1')).toBeUndefined()
    })

    it('restores edges along with nodes', () => {
      seedStore()
      usePlanStore.getState().archiveProjectForReplan(PROJECT_ID)

      const groups = usePlanStore.getState().getArchivedPlanGroups(PROJECT_ID)
      usePlanStore.getState().restoreArchivedPlan(PROJECT_ID, groups[0].deletionActionId)

      const liveEdges = usePlanStore.getState().edges.filter(isLive)
      expect(liveEdges.length).toBeGreaterThan(0)
      // t1 → t2 edge should be restored
      expect(liveEdges.find(e => e.source === 't1' && e.target === 't2')).toBeTruthy()
    })
  })
})

// ─── Phase 3: YOLO Protection ───────────────────────────────────────

describe('Phase 3: YOLO Auto-Execution Protection', () => {
  beforeEach(() => {
    // Reset execution store state relevant to batch/chat mutation
    useExecutionStore.setState({
      chatMutationProjectIds: new Set(),
      batchExecutions: new Map(),
    })
  })

  describe('setChatMutationActive', () => {
    it('adds project to chatMutationProjectIds when active=true', () => {
      useExecutionStore.getState().setChatMutationActive(PROJECT_ID, true)
      expect(useExecutionStore.getState().chatMutationProjectIds.has(PROJECT_ID)).toBe(true)
    })

    it('removes project from chatMutationProjectIds when active=false', () => {
      useExecutionStore.getState().setChatMutationActive(PROJECT_ID, true)
      useExecutionStore.getState().setChatMutationActive(PROJECT_ID, false)
      expect(useExecutionStore.getState().chatMutationProjectIds.has(PROJECT_ID)).toBe(false)
    })

    it('is idempotent — setting false on already-false is safe', () => {
      useExecutionStore.getState().setChatMutationActive(PROJECT_ID, false)
      expect(useExecutionStore.getState().chatMutationProjectIds.has(PROJECT_ID)).toBe(false)
    })

    it('handles multiple projects independently', () => {
      const projectA = 'proj-a'
      const projectB = 'proj-b'
      useExecutionStore.getState().setChatMutationActive(projectA, true)
      useExecutionStore.getState().setChatMutationActive(projectB, true)

      useExecutionStore.getState().setChatMutationActive(projectA, false)
      expect(useExecutionStore.getState().chatMutationProjectIds.has(projectA)).toBe(false)
      expect(useExecutionStore.getState().chatMutationProjectIds.has(projectB)).toBe(true)
    })
  })

})
