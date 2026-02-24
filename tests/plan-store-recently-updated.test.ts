/**
 * Plan Store — markNodesAsUpdating Tests
 *
 * Tests the recentlyUpdatedNodeIds mechanism used to briefly highlight
 * graph nodes after chat mutations are applied.
 *
 * Corner cases tested:
 *   1. Basic set and auto-clear
 *   2. Empty array is a no-op
 *   3. Race condition: rapid successive calls should not prematurely clear
 *   4. Timer cleanup on overwrite
 *   5. Source code verification for timer management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Extracted logic under test (mirrors plan-store.ts markNodesAsUpdating)
// ============================================================================

/**
 * Simulates the markNodesAsUpdating action.
 * The real implementation uses Zustand set(), here we use a plain object.
 */
function createMarkNodesStore() {
  let state = { recentlyUpdatedNodeIds: new Set<string>() }
  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    getState: () => state,
    markNodesAsUpdating: (nodeIds: string[]) => {
      if (nodeIds.length === 0) return
      if (timer !== undefined) clearTimeout(timer)
      state = { recentlyUpdatedNodeIds: new Set(nodeIds) }
      timer = setTimeout(() => {
        timer = undefined
        state = { recentlyUpdatedNodeIds: new Set() }
      }, 2000)
    },
    /** Force-flush for testing */
    _getTimer: () => timer,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('markNodesAsUpdating', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets recentlyUpdatedNodeIds with the provided IDs', () => {
    const store = createMarkNodesStore()
    store.markNodesAsUpdating(['node-1', 'node-2'])

    const ids = store.getState().recentlyUpdatedNodeIds
    expect(ids.size).toBe(2)
    expect(ids.has('node-1')).toBe(true)
    expect(ids.has('node-2')).toBe(true)
  })

  it('auto-clears after 2 seconds', () => {
    const store = createMarkNodesStore()
    store.markNodesAsUpdating(['node-1'])

    expect(store.getState().recentlyUpdatedNodeIds.size).toBe(1)

    vi.advanceTimersByTime(1999)
    expect(store.getState().recentlyUpdatedNodeIds.size).toBe(1)

    vi.advanceTimersByTime(1)
    expect(store.getState().recentlyUpdatedNodeIds.size).toBe(0)
  })

  it('is a no-op for empty array', () => {
    const store = createMarkNodesStore()
    store.markNodesAsUpdating(['node-1'])
    store.markNodesAsUpdating([])

    // Should still have node-1, not cleared
    expect(store.getState().recentlyUpdatedNodeIds.has('node-1')).toBe(true)
  })

  it('replaces previous IDs on successive call', () => {
    const store = createMarkNodesStore()
    store.markNodesAsUpdating(['node-1', 'node-2'])
    store.markNodesAsUpdating(['node-3'])

    const ids = store.getState().recentlyUpdatedNodeIds
    expect(ids.size).toBe(1)
    expect(ids.has('node-3')).toBe(true)
    expect(ids.has('node-1')).toBe(false)
  })

  it('handles race condition: rapid calls get full 2s for latest batch', () => {
    const store = createMarkNodesStore()

    // Call 1: set A,B
    store.markNodesAsUpdating(['A', 'B'])

    // 500ms later: call 2 replaces with C,D
    vi.advanceTimersByTime(500)
    store.markNodesAsUpdating(['C', 'D'])

    // At 1500ms from start (1000ms after call 2), IDs should still be present
    vi.advanceTimersByTime(1000)
    expect(store.getState().recentlyUpdatedNodeIds.size).toBe(2)
    expect(store.getState().recentlyUpdatedNodeIds.has('C')).toBe(true)
    expect(store.getState().recentlyUpdatedNodeIds.has('D')).toBe(true)

    // At 2500ms from start (2000ms after call 2), should be cleared
    vi.advanceTimersByTime(1000)
    expect(store.getState().recentlyUpdatedNodeIds.size).toBe(0)
  })

  it('old timer does not prematurely clear new batch', () => {
    const store = createMarkNodesStore()

    // Call 1 at t=0
    store.markNodesAsUpdating(['old'])

    // Call 2 at t=1900ms (just before the first timer would fire)
    vi.advanceTimersByTime(1900)
    store.markNodesAsUpdating(['new'])

    // At t=2000ms, the OLD timer would fire — but it should have been cleared
    vi.advanceTimersByTime(100)
    expect(store.getState().recentlyUpdatedNodeIds.has('new')).toBe(true)

    // At t=3900ms, the NEW timer fires
    vi.advanceTimersByTime(1900)
    expect(store.getState().recentlyUpdatedNodeIds.size).toBe(0)
  })

  it('handles single node ID', () => {
    const store = createMarkNodesStore()
    store.markNodesAsUpdating(['solo-node'])

    expect(store.getState().recentlyUpdatedNodeIds.size).toBe(1)
    expect(store.getState().recentlyUpdatedNodeIds.has('solo-node')).toBe(true)
  })

  it('handles many node IDs', () => {
    const store = createMarkNodesStore()
    const ids = Array.from({ length: 50 }, (_, i) => `node-${i}`)
    store.markNodesAsUpdating(ids)

    expect(store.getState().recentlyUpdatedNodeIds.size).toBe(50)
  })

  it('deduplicates via Set construction', () => {
    const store = createMarkNodesStore()
    store.markNodesAsUpdating(['dup', 'dup', 'dup', 'unique'])

    expect(store.getState().recentlyUpdatedNodeIds.size).toBe(2)
  })
})

// ============================================================================
// Source code verification
// ============================================================================

describe('plan-store.ts markNodesAsUpdating source', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/stores/plan-store.ts'),
    'utf-8'
  )

  it('has a markNodesAsUpdating action', () => {
    expect(source).toContain('markNodesAsUpdating')
  })

  it('clears the previous timer to prevent race conditions', () => {
    expect(source).toContain('clearTimeout(markNodesTimer)')
  })

  it('stores timer externally (not in Zustand state)', () => {
    expect(source).toContain('let markNodesTimer')
  })

  it('has recentlyUpdatedNodeIds in the store interface', () => {
    expect(source).toContain('recentlyUpdatedNodeIds: Set<string>')
  })

  it('initializes recentlyUpdatedNodeIds as empty Set', () => {
    expect(source).toContain('recentlyUpdatedNodeIds: new Set<string>()')
  })
})
