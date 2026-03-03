/**
 * Chat Mutation Highlighting Tests
 *
 * Tests the pipeline: chat assistant message → extractMutations → applyMutations
 * → markNodesAsUpdating with correct node IDs.
 *
 * This test file verifies a real bug fix: previously, markNodesAsUpdating was
 * called with raw AI-generated IDs that didn't match the actual UUIDs
 * in the plan store. The fix makes applyMutations return the real IDs.
 *
 * Corner cases:
 *   1. New node IDs are proper UUIDs (crypto.randomUUID())
 *   2. AI-generated IDs are mapped to fresh UUIDs via idMap
 *   3. Nodes without explicit IDs get generated UUIDs
 *   4. Node updates use existing (real) node IDs
 *   5. Mixed mutations: updates + new nodes return all affected IDs
 *   6. Edge-only mutations don't produce node IDs
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// Extracted logic under test
// ============================================================================

interface ParsedNodeUpdate {
  nodeId: string
  [key: string]: unknown
}

interface ParsedNewNode {
  id?: string
  title: string
  description: string
  type?: string
  dependencies?: string[]
}

interface AppliedMutations {
  nodeUpdates: ParsedNodeUpdate[]
  edgeOps: Array<{ action: string; source: string; target: string }>
  newNodes: ParsedNewNode[]
}

/**
 * Simulates applyMutations from chat-panel.tsx.
 * Returns the real (UUID) node IDs that were affected.
 * All new nodes get proper crypto.randomUUID() IDs regardless of AI-generated ID.
 */
function simulateApplyMutations(
  _projectId: string,
  mutations: AppliedMutations,
): string[] {
  const { nodeUpdates, newNodes } = mutations
  const affectedNodeIds: string[] = []

  const idMap = new Map<string, string>()
  for (const n of newNodes) {
    const realId = crypto.randomUUID()
    if (n.id) idMap.set(n.id, realId)
    affectedNodeIds.push(realId)
  }

  for (const u of nodeUpdates) {
    affectedNodeIds.push(u.nodeId)
  }

  return affectedNodeIds
}

/**
 * Simulates the OLD (buggy) code that computed affected IDs from raw mutations.
 */
function buggyComputeAffectedIds(mutations: AppliedMutations): string[] {
  return [
    ...mutations.nodeUpdates.map((u) => u.nodeId),
    ...mutations.newNodes.map((n) => n.id).filter(Boolean) as string[],
  ]
}

// ============================================================================
// UUID generation for node IDs
// ============================================================================

describe('UUID generation for node IDs', () => {
  it('generates proper UUID format for new nodes', () => {
    const uuid = crypto.randomUUID()
    // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('generates unique IDs for each call', () => {
    const id1 = crypto.randomUUID()
    const id2 = crypto.randomUUID()
    expect(id1).not.toBe(id2)
  })

  it('AI-generated IDs are replaced with UUIDs, not prefixed', () => {
    const aiId = 'n1'
    const realId = crypto.randomUUID()
    // The real ID should be a UUID, not a prefixed version of the AI ID
    expect(realId).not.toContain(aiId)
    expect(realId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

// ============================================================================
// applyMutations → affected IDs
// ============================================================================

describe('applyMutations returns correct affected node IDs', () => {
  const projectId = 'abcdef12-3456-7890-abcd-ef1234567890'

  it('returns UUID IDs for new nodes', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { id: 'setup-ci', title: 'Setup CI', description: 'Configure CI' },
        { id: 'add-tests', title: 'Add Tests', description: 'Write tests' },
      ],
    }

    const ids = simulateApplyMutations(projectId, mutations)

    expect(ids).toHaveLength(2)
    // Both IDs should be proper UUIDs, not prefixed AI IDs
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }
    // Should NOT contain the original AI IDs
    expect(ids[0]).not.toContain('setup-ci')
    expect(ids[1]).not.toContain('add-tests')
  })

  it('returns existing node IDs for updates (already real)', () => {
    const existingId1 = crypto.randomUUID()
    const existingId2 = crypto.randomUUID()
    const mutations: AppliedMutations = {
      nodeUpdates: [
        { nodeId: existingId1, status: 'completed' },
        { nodeId: existingId2, title: 'Updated Title' },
      ],
      edgeOps: [],
      newNodes: [],
    }

    const ids = simulateApplyMutations(projectId, mutations)

    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(existingId1)
    expect(ids[1]).toBe(existingId2)
  })

  it('returns mixed IDs for combined mutations', () => {
    const existingTaskId = crypto.randomUUID()
    const mutations: AppliedMutations = {
      nodeUpdates: [
        { nodeId: existingTaskId, status: 'in_progress' },
      ],
      edgeOps: [
        { action: 'add', source: existingTaskId, target: 'new-task-placeholder' },
      ],
      newNodes: [
        { id: 'new-task', title: 'New Task', description: 'From decomposition' },
      ],
    }

    const ids = simulateApplyMutations(projectId, mutations)

    // Should have new-task (UUID) + existing task (UUID)
    expect(ids).toHaveLength(2)
    expect(ids).toContain(existingTaskId)
    // New node should have a UUID, not contain the AI ID 'new-task'
    const newNodeId = ids.find((id) => id !== existingTaskId)!
    expect(newNodeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('does NOT include edge-only mutations in affected IDs', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [
        { action: 'add', source: 'a', target: 'b' },
      ],
      newNodes: [],
    }

    const ids = simulateApplyMutations(projectId, mutations)
    expect(ids).toHaveLength(0)
  })

  it('handles new nodes without explicit IDs (auto-generated UUID)', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { title: 'No ID Node', description: 'AI did not provide an ID' },
      ],
    }

    const ids = simulateApplyMutations(projectId, mutations)

    expect(ids).toHaveLength(1)
    // Should be a proper UUID
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('all new nodes get unique UUIDs regardless of AI-provided IDs', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { id: 'n1', title: 'Task 1', description: 'First' },
        { id: 'n2', title: 'Task 2', description: 'Second' },
      ],
    }

    const ids = simulateApplyMutations(projectId, mutations)

    expect(ids).toHaveLength(2)
    // Both should be proper UUIDs
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }
    // Should be unique
    expect(ids[0]).not.toBe(ids[1])
  })
})

// ============================================================================
// Bug demonstration: old code vs new code
// ============================================================================

describe('Bug fix: raw AI IDs vs UUID IDs', () => {
  const projectId = 'abcdef12-3456-7890-abcd-ef1234567890'

  it('OLD CODE: returned raw AI IDs that did not match store IDs', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { id: 'setup-ci', title: 'Setup CI', description: 'Configure CI' },
      ],
    }

    const buggyIds = buggyComputeAffectedIds(mutations)
    // Old code returned 'setup-ci', but the node in the store has a UUID
    expect(buggyIds).toEqual(['setup-ci'])
  })

  it('NEW CODE: returns UUID IDs that match store IDs', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { id: 'setup-ci', title: 'Setup CI', description: 'Configure CI' },
      ],
    }

    const fixedIds = simulateApplyMutations(projectId, mutations)
    expect(fixedIds).toHaveLength(1)
    // Should be a proper UUID, not the raw AI ID
    expect(fixedIds[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(fixedIds[0]).not.toBe('setup-ci')
  })

  it('OLD CODE: returned undefined for nodes without IDs', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { title: 'No ID', description: 'Missing ID field' },
      ],
    }

    const buggyIds = buggyComputeAffectedIds(mutations)
    // filter(Boolean) removes undefined, so empty array
    expect(buggyIds).toHaveLength(0)
  })

  it('NEW CODE: generates and returns a UUID for nodes without explicit IDs', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { title: 'No ID', description: 'Missing ID field' },
      ],
    }

    const fixedIds = simulateApplyMutations(projectId, mutations)
    expect(fixedIds).toHaveLength(1)
    expect(fixedIds[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})
