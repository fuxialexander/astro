/**
 * Plan Mutation Pipeline — End-to-End Simulation Tests
 *
 * Simulates the full mutation pipeline: AI response text → extractMutations()
 * → applyMutationsToStore() → verify resulting graph state.
 *
 * Uses a real Zustand plan-store with seed data to verify that mutations
 * produce the correct graph topology, field values, and edge wiring.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { usePlanStore } from '@/stores/plan-store'
import { extractMutations, applyMutationsToStore } from '@/lib/plan-mutations'
import type { PlanNode, PlanEdge } from '@/types'

// ─── Test Fixtures ───────────────────────────────────────────────────

const PROJECT_ID = 'test-project-001'

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

/**
 * Seed the plan store with a known graph and return helper functions.
 *
 * Default graph:
 *   m1 (milestone: "MVP")
 *   t1 (task: "Set up API") → t2 (task: "Write tests") → m1
 *   t3 (task: "Build UI") → m1
 */
function seedStore() {
  const store = usePlanStore.getState()

  const m1 = makeNode({ id: 'm1', title: 'MVP', type: 'milestone', description: 'First milestone' })
  const t1 = makeNode({ id: 't1', title: 'Set up API', description: 'Create REST endpoints', priority: 'high', estimate: 'M', milestoneId: 'm1' })
  const t2 = makeNode({ id: 't2', title: 'Write tests', description: 'Integration tests', dependencies: ['t1'], milestoneId: 'm1' })
  const t3 = makeNode({ id: 't3', title: 'Build UI', description: 'React frontend', milestoneId: 'm1' })

  const edges: PlanEdge[] = [
    makeEdge('t1', 't2'),
    makeEdge('t2', 'm1'),
    makeEdge('t3', 'm1'),
  ]

  store.setProjectPlan(PROJECT_ID, [m1, t1, t2, t3], edges)

  return {
    getNodes: () => usePlanStore.getState().nodes.filter(n => n.projectId === PROJECT_ID),
    getEdges: () => usePlanStore.getState().edges,
    getNode: (id: string) => usePlanStore.getState().nodes.find(n => n.id === id),
    getEdge: (source: string, target: string) =>
      usePlanStore.getState().edges.find(e => e.source === source && e.target === target),
  }
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Plan Mutation Pipeline (end-to-end)', () => {
  beforeEach(() => {
    // Reset store between tests
    usePlanStore.setState({ nodes: [], edges: [], loaded: true, recentlyUpdatedNodeIds: new Set() })
  })

  describe('updateNodes — modify existing nodes', () => {
    it('updates priority and estimate by nodeId', () => {
      const { getNode } = seedStore()

      const aiResponse = `I've reprioritized the API task.

\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t1", "priority": "urgent", "estimate": "L" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      expect(affectedNodeIds).toEqual(['t1'])
      const node = getNode('t1')!
      expect(node.priority).toBe('urgent')
      expect(node.estimate).toBe('L')
      // Unchanged fields preserved
      expect(node.title).toBe('Set up API')
      expect(node.description).toBe('Create REST endpoints')
      expect(node.milestoneId).toBe('m1')
    })

    it('updates by nodeTitle (case-insensitive)', () => {
      const { getNode } = seedStore()

      const aiResponse = `\`\`\`json
{
  "updateNodes": [
    { "nodeTitle": "write tests", "priority": "high", "estimate": "S" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      const node = getNode('t2')!
      expect(node.priority).toBe('high')
      expect(node.estimate).toBe('S')
    })

    it('updates node status to pruned', () => {
      const { getNode } = seedStore()

      const aiResponse = `\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t3", "status": "pruned" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      expect(getNode('t3')!.status).toBe('pruned')
    })

    it('updates node type (task → milestone)', () => {
      const { getNode } = seedStore()

      const aiResponse = `\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t3", "type": "milestone" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      expect(getNode('t3')!.type).toBe('milestone')
    })

    it('updates description and auto-generates HTML content', () => {
      const { getNode } = seedStore()

      const aiResponse = `\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t1", "description": "Build REST & GraphQL endpoints" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      const node = getNode('t1')!
      expect(node.description).toBe('Build REST & GraphQL endpoints')
      expect(node.content).toBe('<p>Build REST &amp; GraphQL endpoints</p>')
    })

    it('rejects internal fields (id, projectId, executionId)', () => {
      const { getNode } = seedStore()

      const aiResponse = `\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t1", "id": "hacked", "projectId": "evil", "executionId": "fake", "priority": "low" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      const node = getNode('t1')!
      expect(node.id).toBe('t1') // not "hacked"
      expect(node.projectId).toBe(PROJECT_ID) // not "evil"
      expect(node.executionId).toBeUndefined() // not "fake"
      expect(node.priority).toBe('low') // non-internal field DID update
    })
  })

  describe('addNodes — create new nodes', () => {
    it('adds a new task node with dependencies', () => {
      const { getNodes, getNode, getEdge } = seedStore()
      const initialCount = getNodes().length

      const aiResponse = `\`\`\`json
{
  "addNodes": [
    {
      "id": "new1",
      "title": "Add caching",
      "description": "Redis cache for API responses",
      "milestoneId": "m1",
      "dependencies": ["t1"],
      "priority": "high",
      "estimate": "M"
    }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      // One new node created
      expect(getNodes().length).toBe(initialCount + 1)
      expect(affectedNodeIds).toHaveLength(1)

      // Find the newly created node (has a real UUID, not "new1")
      const newId = affectedNodeIds[0]
      const newNode = getNode(newId)!
      expect(newNode.title).toBe('Add caching')
      expect(newNode.description).toBe('Redis cache for API responses')
      expect(newNode.content).toBe('<p>Redis cache for API responses</p>')
      expect(newNode.status).toBe('planned')
      expect(newNode.type).toBe('task')
      expect(newNode.priority).toBe('high')
      expect(newNode.estimate).toBe('M')
      expect(newNode.milestoneId).toBe('m1')
      expect(newNode.projectId).toBe(PROJECT_ID)

      // Dependency edge was created (t1 → newNode)
      expect(newNode.dependencies).toContain('t1')
      const edge = getEdge('t1', newId)
      expect(edge).toBeDefined()
      expect(edge!.type).toBe('dependency')
    })

    it('resolves temp IDs between addNodes entries', () => {
      const { getNodes, getEdge } = seedStore()
      const initialCount = getNodes().length

      const aiResponse = `\`\`\`json
{
  "addNodes": [
    { "id": "a", "title": "Step 1", "description": "First step" },
    { "id": "b", "title": "Step 2", "description": "Second step", "dependencies": ["a"] }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      expect(getNodes().length).toBe(initialCount + 2)
      const [idA, idB] = affectedNodeIds

      // b depends on a via resolved real IDs
      const nodeB = usePlanStore.getState().nodes.find(n => n.id === idB)!
      expect(nodeB.dependencies).toContain(idA)

      // Edge exists with real IDs
      expect(getEdge(idA, idB)).toBeDefined()
    })
  })

  describe('updateEdges — add and remove edges', () => {
    it('adds a new dependency edge', () => {
      const { getEdge, getNode } = seedStore()

      // t1 and t3 are initially independent
      expect(getEdge('t1', 't3')).toBeUndefined()

      const aiResponse = `\`\`\`json
{
  "updateEdges": [
    { "action": "add", "source": "t1", "target": "t3", "type": "dependency" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      // Edge now exists
      expect(getEdge('t1', 't3')).toBeDefined()
      // Target node's dependencies updated
      expect(getNode('t3')!.dependencies).toContain('t1')
    })

    it('removes an existing edge', () => {
      const { getEdge, getNode } = seedStore()

      // t1 → t2 edge exists initially
      expect(getEdge('t1', 't2')).toBeDefined()
      expect(getNode('t2')!.dependencies).toContain('t1')

      const aiResponse = `\`\`\`json
{
  "updateEdges": [
    { "action": "remove", "source": "t1", "target": "t2" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      // Edge removed
      expect(getEdge('t1', 't2')).toBeUndefined()
      // Target node's dependencies updated
      expect(getNode('t2')!.dependencies).not.toContain('t1')
    })
  })

  describe('combined mutations — addNodes + updateEdges with temp IDs', () => {
    it('resolves temp IDs from addNodes in updateEdges', () => {
      const { getEdge } = seedStore()

      const aiResponse = `I'll add a caching layer between the API and deployment.

\`\`\`json
{
  "addNodes": [
    {
      "id": "cache1",
      "title": "Add Redis caching",
      "description": "Cache API responses"
    }
  ],
  "updateEdges": [
    { "action": "add", "source": "cache1", "target": "m1", "type": "dependency" },
    { "action": "add", "source": "t1", "target": "cache1", "type": "dependency" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      // cache1 was mapped to a real UUID
      const cacheId = affectedNodeIds[0]
      expect(cacheId).not.toBe('cache1')

      // Edge from t1 → cache node (using resolved ID)
      expect(getEdge('t1', cacheId)).toBeDefined()
      // Edge from cache node → m1 (using resolved ID)
      expect(getEdge(cacheId, 'm1')).toBeDefined()
    })

    it('handles task decomposition: prune parent + add subtasks + wire edges', () => {
      const { getNode, getNodes, getEdge } = seedStore()
      const initialCount = getNodes().length

      const aiResponse = `Breaking down "Set up API" into smaller tasks.

\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t1", "status": "pruned" }
  ],
  "addNodes": [
    { "id": "sub1", "title": "Design API schema", "description": "OpenAPI spec", "milestoneId": "m1", "estimate": "S" },
    { "id": "sub2", "title": "Implement endpoints", "description": "Express routes", "milestoneId": "m1", "dependencies": ["sub1"], "estimate": "M" },
    { "id": "sub3", "title": "Add auth middleware", "description": "JWT auth", "milestoneId": "m1", "dependencies": ["sub1"], "estimate": "S" }
  ],
  "updateEdges": [
    { "action": "add", "source": "sub2", "target": "t2", "type": "dependency" },
    { "action": "add", "source": "sub3", "target": "t2", "type": "dependency" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      // t1 is pruned
      expect(getNode('t1')!.status).toBe('pruned')

      // 3 new nodes + 1 updated = 4 affected
      // Order: addNodes first (sub1, sub2, sub3), then updateNodes (t1)
      expect(affectedNodeIds).toHaveLength(4)
      const [sub1Id, sub2Id, sub3Id] = affectedNodeIds

      // sub1 exists
      const sub1 = getNode(sub1Id)!
      expect(sub1.title).toBe('Design API schema')
      expect(sub1.milestoneId).toBe('m1')

      // sub2 depends on sub1
      const sub2 = getNode(sub2Id)!
      expect(sub2.dependencies).toContain(sub1Id)
      expect(getEdge(sub1Id, sub2Id)).toBeDefined()

      // sub3 depends on sub1
      const sub3 = getNode(sub3Id)!
      expect(sub3.dependencies).toContain(sub1Id)
      expect(getEdge(sub1Id, sub3Id)).toBeDefined()

      // sub2 and sub3 feed into t2 (edge from temp IDs resolved)
      expect(getEdge(sub2Id, 't2')).toBeDefined()
      expect(getEdge(sub3Id, 't2')).toBeDefined()

      // Total nodes: original 4 + 3 new = 7
      expect(getNodes().length).toBe(initialCount + 3)
    })
  })

  describe('dependency reconciliation', () => {
    it('rewires edges when dependencies array changes', () => {
      const { getEdge, getNode } = seedStore()

      // Initially t2 depends on t1
      expect(getNode('t2')!.dependencies).toEqual(['t1'])
      expect(getEdge('t1', 't2')).toBeDefined()

      // Change t2 to depend on t3 instead of t1
      const aiResponse = `\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t2", "dependencies": ["t3"] }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      // Old edge removed
      expect(getEdge('t1', 't2')).toBeUndefined()
      // New edge added
      expect(getEdge('t3', 't2')).toBeDefined()
    })

    it('resolves temp IDs in updateNodes dependencies', () => {
      const { getEdge, getNode } = seedStore()

      const aiResponse = `\`\`\`json
{
  "addNodes": [
    { "id": "prereq", "title": "Prerequisites", "description": "Install deps" }
  ],
  "updateNodes": [
    { "nodeId": "t1", "dependencies": ["prereq"] }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      // addNodes runs first, so new node is at index 0; t1 update is at index 1
      const prereqId = affectedNodeIds[0]
      // The edge should use the resolved real UUID, not "prereq"
      expect(getEdge(prereqId, 't1')).toBeDefined()
      expect(getNode('t1')!.dependencies).toContain(prereqId)
    })
  })

  describe('clean content — non-mutation JSON preserved', () => {
    it('strips mutation JSON but preserves other code blocks', () => {
      const aiResponse = `Here's the config you asked about:

\`\`\`json
{ "name": "my-app", "version": "1.0.0" }
\`\`\`

And here are the plan changes:

\`\`\`json
{
  "updateNodes": [{ "nodeId": "t1", "priority": "urgent" }]
}
\`\`\`

\`\`\`typescript
const api = new Express()
\`\`\`

All done!`

      const { cleanContent, mutations } = extractMutations(aiResponse)

      // Mutation extracted
      expect(mutations.nodeUpdates).toHaveLength(1)

      // Non-mutation JSON preserved
      expect(cleanContent).toContain('"name": "my-app"')
      // TypeScript block preserved
      expect(cleanContent).toContain('const api = new Express()')
      // Mutation block stripped
      expect(cleanContent).not.toContain('updateNodes')
      // Surrounding text preserved
      expect(cleanContent).toContain("Here's the config you asked about:")
      expect(cleanContent).toContain('All done!')
    })
  })

  describe('edge cases', () => {
    it('handles empty graph gracefully', () => {
      // Don't seed — empty store
      const aiResponse = `\`\`\`json
{
  "addNodes": [
    { "title": "First task", "description": "The beginning" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      expect(affectedNodeIds).toHaveLength(1)
      const node = usePlanStore.getState().nodes.find(n => n.id === affectedNodeIds[0])!
      expect(node.title).toBe('First task')
      expect(node.status).toBe('planned')
    })

    it('handles updateNodes for nonexistent nodeId gracefully', () => {
      const { getNode } = seedStore()

      const aiResponse = `\`\`\`json
{
  "updateNodes": [
    { "nodeId": "nonexistent", "priority": "urgent" },
    { "nodeId": "t1", "priority": "low" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      // Both IDs are in affectedNodeIds (nodeId was provided, just doesn't match a real node)
      // but the nonexistent one has no effect on the store
      expect(affectedNodeIds).toContain('t1')
      // t1 was updated successfully
      expect(getNode('t1')!.priority).toBe('low')
    })

    it('handles multiple updateNodes on the same node', () => {
      const { getNode } = seedStore()

      const aiResponse = `\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t1", "priority": "urgent" },
    { "nodeId": "t1", "estimate": "XL" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      const node = getNode('t1')!
      expect(node.priority).toBe('urgent')
      expect(node.estimate).toBe('XL')
    })

    it('legacy astro-plan-change format still works end-to-end', () => {
      const { getNode } = seedStore()

      const aiResponse = `\`\`\`astro-plan-change
{
  "updateNodes": [{ "nodeId": "t1", "priority": "low" }]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      expect(getNode('t1')!.priority).toBe('low')
    })
  })

  // ─── Additional Edge Cases (deployment-realistic) ──────────────────

  describe('realistic AI output patterns', () => {
    it('handles AI that outputs mutation block in the middle of text', () => {
      const { getNode } = seedStore()

      const aiResponse = `Let me reprioritize that for you.

\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t1", "priority": "urgent" }
  ]
}
\`\`\`

I've set "Set up API" to urgent priority. Let me know if you want any other changes.`

      const { cleanContent, mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      expect(getNode('t1')!.priority).toBe('urgent')
      expect(cleanContent).toContain('Let me reprioritize')
      expect(cleanContent).toContain('Let me know if you want')
      expect(cleanContent).not.toContain('updateNodes')
    })

    it('handles AI that outputs extra whitespace in JSON', () => {
      const { getNode } = seedStore()

      const aiResponse = `\`\`\`json

{
  "updateNodes":   [
    {   "nodeId" :  "t1" ,  "priority" :  "low"   }
  ]
}

\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      expect(getNode('t1')!.priority).toBe('low')
    })

    it('handles full plan JSON without treating it as mutation (projectName/nodes/edges)', () => {
      seedStore()
      const initialNodes = usePlanStore.getState().nodes.length

      // AI accidentally outputs a full plan JSON — should NOT be treated as mutation
      const aiResponse = `Here's what the plan looks like:

\`\`\`json
{
  "projectName": "My Plan",
  "nodes": [
    { "id": "n1", "title": "Task", "type": "task", "status": "planned" }
  ],
  "edges": []
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const hasMutations = mutations.nodeUpdates.length > 0 || mutations.edgeOps.length > 0 || mutations.newNodes.length > 0
      expect(hasMutations).toBe(false)

      // No nodes should be added
      expect(usePlanStore.getState().nodes.length).toBe(initialNodes)
    })

    it('handles description with HTML special chars (XSS prevention)', () => {
      const { getNode } = seedStore()

      // Use JSON.stringify to properly escape the description inside the JSON block
      const desc = `<script>alert('xss')</script> & "quotes"`
      const jsonBlock = JSON.stringify({
        updateNodes: [{ nodeId: 't1', description: desc }]
      }, null, 2)

      const aiResponse = `\`\`\`json\n${jsonBlock}\n\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      const node = getNode('t1')!
      expect(node.description).toBe(desc)
      // HTML content should be escaped
      expect(node.content).toContain('&lt;script&gt;')
      expect(node.content).toContain('&amp;')
      expect(node.content).not.toContain('<script>')
    })

    it('handles addNodes with description containing HTML special chars', () => {
      seedStore()

      const aiResponse = `\`\`\`json
{
  "addNodes": [
    { "title": "Fix <bug>", "description": "Handle <div> & 'special' chars" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      const node = usePlanStore.getState().nodes.find(n => n.id === affectedNodeIds[0])!
      expect(node.title).toBe('Fix <bug>')
      expect(node.content).toContain('&lt;div&gt;')
      expect(node.content).toContain('&amp;')
    })
  })

  describe('complex graph operations', () => {
    it('adds node with dependency on another new node in same block', () => {
      const { getNodes, getEdge } = seedStore()
      const initialCount = getNodes().length

      const aiResponse = `\`\`\`json
{
  "addNodes": [
    { "id": "a", "title": "Design", "description": "Design phase" },
    { "id": "b", "title": "Implement", "description": "Build it", "dependencies": ["a"] },
    { "id": "c", "title": "Test", "description": "Test it", "dependencies": ["b"] }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)

      expect(getNodes().length).toBe(initialCount + 3)
      const [idA, idB, idC] = affectedNodeIds

      // Chain: a → b → c
      expect(getEdge(idA, idB)).toBeDefined()
      expect(getEdge(idB, idC)).toBeDefined()

      // Verify dependencies are resolved UUIDs, not temp IDs
      const nodeB = usePlanStore.getState().nodes.find(n => n.id === idB)!
      expect(nodeB.dependencies).toContain(idA)
      expect(nodeB.dependencies).not.toContain('a')

      const nodeC = usePlanStore.getState().nodes.find(n => n.id === idC)!
      expect(nodeC.dependencies).toContain(idB)
      expect(nodeC.dependencies).not.toContain('b')
    })

    it('removes all dependencies from a node', () => {
      const { getNode, getEdge } = seedStore()

      // t2 initially depends on t1
      expect(getNode('t2')!.dependencies).toEqual(['t1'])
      expect(getEdge('t1', 't2')).toBeDefined()

      const aiResponse = `\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t2", "dependencies": [] }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      expect(getNode('t2')!.dependencies).toEqual([])
      expect(getEdge('t1', 't2')).toBeUndefined()
    })

    it('adds multiple edges in one block', () => {
      const { getEdge, getNode } = seedStore()

      const aiResponse = `\`\`\`json
{
  "updateEdges": [
    { "action": "add", "source": "t1", "target": "t3", "type": "dependency" },
    { "action": "add", "source": "t3", "target": "t2", "type": "branch" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      const edge1 = getEdge('t1', 't3')
      expect(edge1).toBeDefined()
      expect(edge1!.type).toBe('dependency')
      expect(getNode('t3')!.dependencies).toContain('t1')

      const edge2 = getEdge('t3', 't2')
      expect(edge2).toBeDefined()
      expect(edge2!.type).toBe('branch')
    })

    it('handles updateEdges remove for nonexistent edge gracefully', () => {
      seedStore()

      // Try to remove an edge that doesn't exist — should not crash
      const aiResponse = `\`\`\`json
{
  "updateEdges": [
    { "action": "remove", "source": "t1", "target": "t3" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      // Should not throw
      expect(() => applyMutationsToStore(PROJECT_ID, mutations)).not.toThrow()
    })

    it('cross-references new node in updateEdges using temp ID as target', () => {
      const { getEdge } = seedStore()

      const aiResponse = `\`\`\`json
{
  "addNodes": [
    { "id": "review", "title": "Code Review", "description": "Review all code" }
  ],
  "updateEdges": [
    { "action": "add", "source": "t2", "target": "review", "type": "dependency" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      const { affectedNodeIds } = applyMutationsToStore(PROJECT_ID, mutations)
      const reviewId = affectedNodeIds[0]

      // Edge should use resolved UUID, not "review"
      expect(getEdge('t2', reviewId)).toBeDefined()
    })
  })

  describe('extraction edge cases', () => {
    it('ignores mutation-shaped JSON inside non-json fences', () => {
      const aiResponse = `\`\`\`typescript
const mutation = {
  "updateNodes": [{ "nodeId": "t1", "priority": "high" }]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      expect(mutations.nodeUpdates).toHaveLength(0)
    })

    it('handles JSON with trailing comma gracefully (invalid JSON)', () => {
      const aiResponse = `\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t1", "priority": "high", }
  ],
}
\`\`\``

      // JSON.parse will fail — no mutations extracted, no crash
      const { mutations } = extractMutations(aiResponse)
      expect(mutations.nodeUpdates).toHaveLength(0)
    })

    it('handles empty json fence', () => {
      const aiResponse = `\`\`\`json
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      expect(mutations.nodeUpdates).toHaveLength(0)
    })

    it('handles json fence with only whitespace', () => {
      const aiResponse = `\`\`\`json

\`\`\``

      const { mutations } = extractMutations(aiResponse)
      expect(mutations.nodeUpdates).toHaveLength(0)
    })

    it('handles multiple json fences where only one is a mutation', () => {
      seedStore()

      const aiResponse = `Here's the package config:

\`\`\`json
{ "name": "my-package", "version": "2.0.0" }
\`\`\`

And the type definition:

\`\`\`json
{ "type": "module", "exports": { ".": "./dist/index.js" } }
\`\`\`

And here are the plan changes:

\`\`\`json
{
  "updateNodes": [{ "nodeId": "t1", "priority": "urgent" }]
}
\`\`\``

      const { cleanContent, mutations } = extractMutations(aiResponse)

      // Only the mutation block extracted
      expect(mutations.nodeUpdates).toHaveLength(1)
      expect(mutations.nodeUpdates[0].nodeId).toBe('t1')

      // Other JSON blocks preserved
      expect(cleanContent).toContain('"name": "my-package"')
      expect(cleanContent).toContain('"type": "module"')
      // Mutation block stripped
      expect(cleanContent).not.toContain('"priority": "urgent"')
    })

    it('prefers json fence over legacy when both present', () => {
      seedStore()

      const aiResponse = `\`\`\`json
{
  "updateNodes": [{ "nodeId": "t1", "priority": "urgent" }]
}
\`\`\`

\`\`\`astro-plan-change
{
  "updateNodes": [{ "nodeId": "t1", "priority": "low" }]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)

      // json fence found mutations → legacy skipped
      expect(mutations.nodeUpdates).toHaveLength(1)
      expect(mutations.nodeUpdates[0].priority).toBe('urgent')
    })
  })

  describe('internal field protection', () => {
    it('blocks all INTERNAL_FIELDS from updateNodes', () => {
      const { getNode } = seedStore()

      const aiResponse = `\`\`\`json
{
  "updateNodes": [{
    "nodeId": "t1",
    "id": "hacked",
    "projectId": "evil",
    "createdAt": "2020-01-01",
    "updatedAt": "2020-01-01",
    "position": { "x": 999, "y": 999 },
    "boardOrder": 99,
    "executionId": "fake-exec",
    "executionOutput": "fake output",
    "executionError": "fake error",
    "executionStartedAt": "2020-01-01",
    "executionCompletedAt": "2020-01-01",
    "branchName": "evil-branch",
    "prUrl": "https://evil.com",
    "prNumber": 666,
    "title": "Allowed change"
  }]
}
\`\`\``

      const { mutations } = extractMutations(aiResponse)
      applyMutationsToStore(PROJECT_ID, mutations)

      const node = getNode('t1')!
      // Internal fields unchanged
      expect(node.id).toBe('t1')
      expect(node.projectId).toBe(PROJECT_ID)
      expect(node.position).toEqual({ x: 40, y: 40 })
      expect(node.executionId).toBeUndefined()
      expect(node.branchName).toBeUndefined()
      expect(node.prUrl).toBeUndefined()
      expect(node.prNumber).toBeUndefined()
      // Non-internal field DID update
      expect(node.title).toBe('Allowed change')
    })
  })
})
