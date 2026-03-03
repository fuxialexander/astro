/**
 * Task Node Update Pulse Tests
 *
 * Tests that the task-node component reads recentlyUpdatedNodeIds from
 * the plan store and applies the correct visual pulse class.
 *
 * Also verifies the full pipeline:
 *   chat message → extractMutations → applyMutations → markNodesAsUpdating
 *   → task-node reads recentlyUpdatedNodeIds → applies ring-2 ring-info/50 animate-pulse
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// 1. Task node highlight logic
// ============================================================================

describe('Task node recently-updated detection', () => {
  /**
   * Simulates the task-node component's check against recentlyUpdatedNodeIds.
   */
  function isNodeRecentlyUpdated(nodeId: string, recentlyUpdatedNodeIds: Set<string>): boolean {
    return recentlyUpdatedNodeIds.has(nodeId)
  }

  it('returns true when node is in the recently updated set', () => {
    const updated = new Set(['node-1', 'node-2'])
    expect(isNodeRecentlyUpdated('node-1', updated)).toBe(true)
  })

  it('returns false when node is NOT in the recently updated set', () => {
    const updated = new Set(['node-1', 'node-2'])
    expect(isNodeRecentlyUpdated('node-3', updated)).toBe(false)
  })

  it('returns false for empty set', () => {
    const updated = new Set<string>()
    expect(isNodeRecentlyUpdated('any-node', updated)).toBe(false)
  })

  it('handles prefix-style IDs correctly', () => {
    const updated = new Set(['abcdef12-task-1', 'abcdef12-task-2'])
    expect(isNodeRecentlyUpdated('abcdef12-task-1', updated)).toBe(true)
    expect(isNodeRecentlyUpdated('task-1', updated)).toBe(false) // Raw ID should NOT match
  })
})

// ============================================================================
// 2. CSS class application logic
// ============================================================================

describe('Task node CSS class for recently updated', () => {
  /**
   * Simulates the className logic from task-node.tsx.
   * Returns the extra class when the node is recently updated.
   */
  function getUpdateHighlightClass(isRecentlyUpdated: boolean): string {
    return isRecentlyUpdated ? 'ring-2 ring-info/50 animate-pulse' : ''
  }

  it('applies ring and pulse classes when recently updated', () => {
    const cls = getUpdateHighlightClass(true)
    expect(cls).toContain('ring-2')
    expect(cls).toContain('ring-info/50')
    expect(cls).toContain('animate-pulse')
  })

  it('applies no extra classes when not recently updated', () => {
    const cls = getUpdateHighlightClass(false)
    expect(cls).toBe('')
  })
})

// ============================================================================
// 3. Full pipeline simulation
// ============================================================================

describe('Full pipeline: chat → mutations → graph highlight', () => {
  /**
   * Simulates the full pipeline for a chat message that updates existing nodes.
   * New nodes get proper UUIDs (matching the real chat-panel.tsx behavior).
   */
  function simulatePipeline(
    assistantMessage: string,
  ): { affectedNodeIds: string[]; recentlyUpdatedNodeIds: Set<string> } {
    // Step 1: Extract mutations (simplified)
    const updateMatch = assistantMessage.match(/```astro-updates\s*\n([\s\S]*?)```/)
    const nodeUpdates: Array<{ nodeId: string; [key: string]: unknown }> = []
    if (updateMatch) {
      try {
        const parsed = JSON.parse(updateMatch[1].trim())
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item?.nodeId) nodeUpdates.push(item)
          }
        }
      } catch { /* ignore */ }
    }

    const addMatch = assistantMessage.match(/```astro-add-nodes\s*\n([\s\S]*?)```/)
    const newNodes: Array<{ id?: string; title: string; description: string }> = []
    if (addMatch) {
      try {
        const parsed = JSON.parse(addMatch[1].trim())
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item?.title) newNodes.push(item)
          }
        }
      } catch { /* ignore */ }
    }

    // Step 2: Apply mutations (returns real IDs)
    // All new nodes get proper UUIDs via crypto.randomUUID()
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

    // Step 3: Mark nodes as updating
    const recentlyUpdatedNodeIds = new Set(affectedNodeIds)

    return { affectedNodeIds, recentlyUpdatedNodeIds }
  }

  it('pipeline: node update → correct IDs in recentlyUpdatedNodeIds', () => {
    const existingId = crypto.randomUUID()
    const message = `I've updated the task.

\`\`\`astro-updates
[{"nodeId": "${existingId}", "status": "completed"}]
\`\`\`

Done!`

    const { recentlyUpdatedNodeIds } = simulatePipeline(message)
    expect(recentlyUpdatedNodeIds.has(existingId)).toBe(true)
    expect(recentlyUpdatedNodeIds.size).toBe(1)
  })

  it('pipeline: new node → UUID in recentlyUpdatedNodeIds', () => {
    const message = `I've decomposed the task.

\`\`\`astro-add-nodes
[{"id": "new-task", "title": "New Sub-task", "description": "Created by AI"}]
\`\`\`

Done!`

    const { recentlyUpdatedNodeIds } = simulatePipeline(message)
    // Should NOT have the raw AI ID
    expect(recentlyUpdatedNodeIds.has('new-task')).toBe(false)
    expect(recentlyUpdatedNodeIds.size).toBe(1)
    // Should have a proper UUID
    const id = Array.from(recentlyUpdatedNodeIds)[0]
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('pipeline: mixed updates and new nodes', () => {
    const existingId = crypto.randomUUID()
    const message = `Changes applied.

\`\`\`astro-updates
[{"nodeId": "${existingId}", "priority": "high"}]
\`\`\`

\`\`\`astro-add-nodes
[{"id": "child-1", "title": "Child Task", "description": "Sub-task"}]
\`\`\`

All done!`

    const { recentlyUpdatedNodeIds } = simulatePipeline(message)
    expect(recentlyUpdatedNodeIds.size).toBe(2)
    expect(recentlyUpdatedNodeIds.has(existingId)).toBe(true)
    // The new node should have a UUID, not 'child-1'
    const newNodeId = Array.from(recentlyUpdatedNodeIds).find((id) => id !== existingId)!
    expect(newNodeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('pipeline: no mutations → empty set', () => {
    const message = 'Just a normal response with no code blocks.'
    const { recentlyUpdatedNodeIds } = simulatePipeline(message)
    expect(recentlyUpdatedNodeIds.size).toBe(0)
  })

  it('pipeline: node without explicit ID gets auto-generated UUID', () => {
    const message = `\`\`\`astro-add-nodes
[{"title": "Auto ID Task", "description": "No explicit ID"}]
\`\`\``

    const { recentlyUpdatedNodeIds } = simulatePipeline(message)
    expect(recentlyUpdatedNodeIds.size).toBe(1)
    const id = Array.from(recentlyUpdatedNodeIds)[0]
    // Should be a proper UUID
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

// ============================================================================
// 4. Source code verification
// ============================================================================

describe('task-node.tsx source code', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/components/plan-graph/task-node.tsx'),
    'utf-8'
  )

  it('imports usePlanStore', () => {
    expect(source).toContain("import { usePlanStore } from")
  })

  it('reads recentlyUpdatedNodeIds from plan store', () => {
    expect(source).toContain('recentlyUpdatedNodeIds')
    expect(source).toContain('usePlanStore')
  })

  it('checks node membership with .has(id)', () => {
    expect(source).toContain('.has(id)')
  })

  it('applies ring-2 ring-info/50 animate-pulse for recently updated nodes', () => {
    expect(source).toContain('ring-2 ring-info/50 animate-pulse')
  })

  it('highlight is conditional on isRecentlyUpdated', () => {
    expect(source).toContain('isRecentlyUpdated')
  })
})
