/**
 * Chat Mutation Highlighting Tests
 *
 * Tests the pipeline: chat assistant message → extractMutations → applyMutations
 * → markNodesAsUpdating with correct (prefixed) node IDs.
 *
 * This test file verifies a real bug fix: previously, markNodesAsUpdating was
 * called with raw AI-generated IDs that didn't match the actual prefixed IDs
 * in the plan store. The fix makes applyMutations return the real IDs.
 *
 * Corner cases:
 *   1. New node IDs are prefixed with project ID prefix
 *   2. IDs that already have the prefix are not double-prefixed
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
 * Returns the real (prefixed) node IDs that were affected.
 */
function simulateApplyMutations(
  projectId: string,
  mutations: AppliedMutations,
): string[] {
  const { nodeUpdates, newNodes } = mutations
  const affectedNodeIds: string[] = []

  const prefix = projectId.slice(0, 8)
  const safePrefixId = (id: string) =>
    id.startsWith(prefix) ? id : `${prefix}-${id}`

  const idMap = new Map<string, string>()
  for (const n of newNodes) {
    const realId = n.id
      ? safePrefixId(n.id)
      : `${prefix}-${crypto.randomUUID().slice(0, 8)}`
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
// ID prefixing logic (safePrefixId)
// ============================================================================

describe('safePrefixId', () => {
  const projectId = 'abcdef12-3456-7890-abcd-ef1234567890'
  const prefix = projectId.slice(0, 8) // 'abcdef12'

  const safePrefixId = (id: string) =>
    id.startsWith(prefix) ? id : `${prefix}-${id}`

  it('prefixes an ID that does not start with the project prefix', () => {
    expect(safePrefixId('setup-ci')).toBe('abcdef12-setup-ci')
  })

  it('does NOT double-prefix an ID that already starts with the prefix', () => {
    expect(safePrefixId('abcdef12-existing')).toBe('abcdef12-existing')
  })

  it('prefixes a UUID-style ID from AI', () => {
    expect(safePrefixId('task-123')).toBe('abcdef12-task-123')
  })

  it('handles empty string (edge case)', () => {
    expect(safePrefixId('')).toBe('abcdef12-')
  })

  it('handles ID that partially matches prefix', () => {
    expect(safePrefixId('abcdef1')).toBe('abcdef12-abcdef1')
  })

  it('handles ID that is exactly the prefix', () => {
    // Starts with prefix, so no double-prefix
    expect(safePrefixId('abcdef12')).toBe('abcdef12')
  })
})

// ============================================================================
// applyMutations → affected IDs
// ============================================================================

describe('applyMutations returns correct affected node IDs', () => {
  const projectId = 'abcdef12-3456-7890-abcd-ef1234567890'
  const prefix = projectId.slice(0, 8)

  it('returns prefixed IDs for new nodes', () => {
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
    expect(ids[0]).toBe(`${prefix}-setup-ci`)
    expect(ids[1]).toBe(`${prefix}-add-tests`)
  })

  it('returns existing node IDs for updates (already real)', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [
        { nodeId: `${prefix}-existing-1`, status: 'completed' },
        { nodeId: `${prefix}-existing-2`, title: 'Updated Title' },
      ],
      edgeOps: [],
      newNodes: [],
    }

    const ids = simulateApplyMutations(projectId, mutations)

    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(`${prefix}-existing-1`)
    expect(ids[1]).toBe(`${prefix}-existing-2`)
  })

  it('returns mixed IDs for combined mutations', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [
        { nodeId: `${prefix}-task-1`, status: 'in_progress' },
      ],
      edgeOps: [
        { action: 'add', source: `${prefix}-task-1`, target: `${prefix}-new-task` },
      ],
      newNodes: [
        { id: 'new-task', title: 'New Task', description: 'From decomposition' },
      ],
    }

    const ids = simulateApplyMutations(projectId, mutations)

    // Should have new-task (prefixed) + task-1 (update)
    expect(ids).toHaveLength(2)
    expect(ids).toContain(`${prefix}-new-task`)
    expect(ids).toContain(`${prefix}-task-1`)
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

  it('handles new nodes without explicit IDs (auto-generated)', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { title: 'No ID Node', description: 'AI did not provide an ID' },
      ],
    }

    const ids = simulateApplyMutations(projectId, mutations)

    expect(ids).toHaveLength(1)
    // Should start with prefix
    expect(ids[0].startsWith(prefix)).toBe(true)
  })

  it('does not double-prefix IDs that AI generates with project prefix', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { id: `${prefix}-already-prefixed`, title: 'Pre-prefixed', description: 'AI was smart' },
      ],
    }

    const ids = simulateApplyMutations(projectId, mutations)

    expect(ids).toHaveLength(1)
    expect(ids[0]).toBe(`${prefix}-already-prefixed`)
    // Should NOT be double-prefixed like "abcdef12-abcdef12-already-prefixed"
    expect(ids[0]).not.toContain(`${prefix}-${prefix}`)
  })
})

// ============================================================================
// Bug demonstration: old code vs new code
// ============================================================================

describe('Bug fix: raw AI IDs vs prefixed IDs', () => {
  const projectId = 'abcdef12-3456-7890-abcd-ef1234567890'
  const prefix = projectId.slice(0, 8)

  it('OLD CODE: returned raw AI IDs that did not match store IDs', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { id: 'setup-ci', title: 'Setup CI', description: 'Configure CI' },
      ],
    }

    const buggyIds = buggyComputeAffectedIds(mutations)
    // Old code returned 'setup-ci', but the node in the store has 'abcdef12-setup-ci'
    expect(buggyIds).toEqual(['setup-ci'])
    expect(buggyIds[0]).not.toBe(`${prefix}-setup-ci`)
  })

  it('NEW CODE: returns prefixed IDs that match store IDs', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { id: 'setup-ci', title: 'Setup CI', description: 'Configure CI' },
      ],
    }

    const fixedIds = simulateApplyMutations(projectId, mutations)
    expect(fixedIds).toEqual([`${prefix}-setup-ci`])
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

  it('NEW CODE: generates and returns a real ID for nodes without explicit IDs', () => {
    const mutations: AppliedMutations = {
      nodeUpdates: [],
      edgeOps: [],
      newNodes: [
        { title: 'No ID', description: 'Missing ID field' },
      ],
    }

    const fixedIds = simulateApplyMutations(projectId, mutations)
    expect(fixedIds).toHaveLength(1)
    expect(fixedIds[0].startsWith(prefix)).toBe(true)
  })
})

// ============================================================================
// Source code verification
// ============================================================================

describe('chat-panel.tsx source code verification', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/components/agent/chat-panel.tsx'),
    'utf-8'
  )

  it('applyMutations returns string[] (affected node IDs)', () => {
    expect(source).toContain('const applyMutations = useCallback((mutations: AppliedMutations): string[]')
  })

  it('collects new node realIds via affectedNodeIds.push(realId)', () => {
    expect(source).toContain('affectedNodeIds.push(realId)')
  })

  it('collects update nodeIds via affectedNodeIds.push(u.nodeId)', () => {
    expect(source).toContain('affectedNodeIds.push(u.nodeId)')
  })

  it('returns affectedNodeIds at the end of applyMutations', () => {
    expect(source).toContain('return affectedNodeIds')
  })

  it('uses the returned IDs (not raw mutation IDs) for markNodesAsUpdating', () => {
    // The fix: `const affectedNodeIds = applyMutations(mutations)`
    expect(source).toContain('const affectedNodeIds = applyMutations(mutations)')
    // The old buggy code had: `mutations.newNodes.map((n) => n.id)` — should be gone
    expect(source).not.toContain('mutations.newNodes.map((n) => n.id).filter(Boolean)')
  })

  it('calls markNodesAsUpdating with the returned IDs', () => {
    expect(source).toContain('markNodesAsUpdating(affectedNodeIds)')
  })
})
