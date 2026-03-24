import { describe, it, expect } from 'vitest'
import { computeEdgeHandles, NODE_WIDTH, NODE_HEIGHT } from '../graph-utils'

/**
 * Edge handle routing tests.
 *
 * Simulates different graph layouts to verify that edges pick the correct
 * source/target handles (left/right/top/bottom) based on relative node positions.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  BEFORE (LR handles only — old plans with TB layout produce tangled edges)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Old TB layout with LR-only handles:
 *
 *      ┌─────────┐
 *      │  Task A  ●─── right handle
 *      └─────────┘
 *           ╲  bezier curves RIGHT, then loops back LEFT and DOWN
 *            ╲   creating an S-shaped tangle
 *             ╲
 *    left ───●┌─────────┐
 *      handle │  Task B  │
 *             └─────────┘
 *
 *  The edge leaves A's RIGHT side, but B is BELOW A — so the bezier
 *  has to curve right → down → left to reach B's LEFT side.
 *  Result: tangled, unreadable S-curves.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  AFTER (4-direction handles — edges follow natural flow direction)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Same TB layout, now with dynamic handle selection:
 *
 *      ┌─────────┐
 *      │  Task A  │
 *      └────●────┘  ← bottom handle selected
 *           │
 *           │  clean vertical bezier
 *           │
 *      ┌────●────┐  ← top handle selected
 *      │  Task B  │
 *      └─────────┘
 *
 *  computeEdgeHandles detects |dy| >> |dx|, picks bottom→top.
 *  Edge flows naturally downward. No tangles.
 *
 *  LR layout still works as before:
 *
 *    ┌─────────┐           ┌─────────┐
 *    │  Task A  ●──────────●  Task B  │
 *    └─────────┘ right  left └─────────┘
 *
 */

describe('computeEdgeHandles', () => {
  // ── Horizontal (LR) flow ──────────────────────────────────────

  it('returns right→left for target to the right of source', () => {
    const src = { x: 100, y: 100 }
    const tgt = { x: 100 + NODE_WIDTH + 40, y: 100 }
    expect(computeEdgeHandles(src, tgt)).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
  })

  it('returns right→left for target diagonally right and slightly down', () => {
    const src = { x: 100, y: 100 }
    const tgt = { x: 300, y: 130 } // dx=200, dy=30 → horizontal dominant
    expect(computeEdgeHandles(src, tgt)).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
  })

  it('returns right→left for target to the left (back-edge)', () => {
    // Back-edges still use right→left — the bezier naturally curves backward
    const src = { x: 300, y: 100 }
    const tgt = { x: 100, y: 100 }
    expect(computeEdgeHandles(src, tgt)).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
  })

  // ── Vertical (TB) flow ────────────────────────────────────────

  it('returns bottom→top for target directly below source', () => {
    const src = { x: 100, y: 100 }
    const tgt = { x: 100, y: 100 + NODE_HEIGHT + 60 }
    expect(computeEdgeHandles(src, tgt)).toEqual({
      sourceHandle: 'bottom',
      targetHandle: 'top',
    })
  })

  it('returns bottom→top for target mostly below and slightly right', () => {
    const src = { x: 100, y: 100 }
    const tgt = { x: 120, y: 300 } // dx=20, dy=200 → vertical dominant
    expect(computeEdgeHandles(src, tgt)).toEqual({
      sourceHandle: 'bottom',
      targetHandle: 'top',
    })
  })

  it('returns bottom→top for target below in old TB layout positions', () => {
    // Simulates a real old TB plan: nodes stacked vertically at same x
    const src = { x: 40, y: 40 }
    const tgt = { x: 40, y: 40 + NODE_HEIGHT + 60 } // typical TB gap
    expect(computeEdgeHandles(src, tgt)).toEqual({
      sourceHandle: 'bottom',
      targetHandle: 'top',
    })
  })

  // ── Edge cases ────────────────────────────────────────────────

  it('returns right→left when positions are missing (fallback)', () => {
    expect(computeEdgeHandles(undefined, { x: 100, y: 100 })).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
    expect(computeEdgeHandles({ x: 100, y: 100 }, undefined)).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
    expect(computeEdgeHandles(undefined, undefined)).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
  })

  it('returns right→left when dy is large but does not exceed 1.5x threshold', () => {
    // dx=100, dy=140 → |dy|/|dx| = 1.4 < 1.5 threshold
    const src = { x: 100, y: 100 }
    const tgt = { x: 200, y: 240 }
    expect(computeEdgeHandles(src, tgt)).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
  })

  it('returns right→left when dy is small even if purely vertical', () => {
    // dy=25 < 30px minimum threshold (nodes are too close for vertical routing)
    const src = { x: 100, y: 100 }
    const tgt = { x: 100, y: 125 }
    expect(computeEdgeHandles(src, tgt)).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
  })

  it('uses right→left for target above source (upward back-edge)', () => {
    // Target is above — vertical but dy < 0. We use right→left for back-edges.
    const src = { x: 100, y: 300 }
    const tgt = { x: 100, y: 100 } // dx=0, dy=-200
    expect(computeEdgeHandles(src, tgt)).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
  })

  // ── Full graph simulation ─────────────────────────────────────

  it('correctly routes a 4-node pipeline in LR layout', () => {
    //  A(40,100) → B(244,100) → C(448,100) → D(652,100)
    //  All horizontal — every edge should be right→left
    const gap = NODE_WIDTH + 40
    const nodes = [
      { id: 'A', pos: { x: 40, y: 100 } },
      { id: 'B', pos: { x: 40 + gap, y: 100 } },
      { id: 'C', pos: { x: 40 + gap * 2, y: 100 } },
      { id: 'D', pos: { x: 40 + gap * 3, y: 100 } },
    ]
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
    ]

    for (const e of edges) {
      const src = nodes.find(n => n.id === e.source)!.pos
      const tgt = nodes.find(n => n.id === e.target)!.pos
      const result = computeEdgeHandles(src, tgt)
      expect(result).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
    }
  })

  it('correctly routes a 4-node pipeline in old TB layout', () => {
    //  A(100,40) → B(100,156) → C(100,272) → D(100,388)
    //  All vertical — every edge should be bottom→top
    const gap = NODE_HEIGHT + 60
    const nodes = [
      { id: 'A', pos: { x: 100, y: 40 } },
      { id: 'B', pos: { x: 100, y: 40 + gap } },
      { id: 'C', pos: { x: 100, y: 40 + gap * 2 } },
      { id: 'D', pos: { x: 100, y: 40 + gap * 3 } },
    ]
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
    ]

    for (const e of edges) {
      const src = nodes.find(n => n.id === e.source)!.pos
      const tgt = nodes.find(n => n.id === e.target)!.pos
      const result = computeEdgeHandles(src, tgt)
      expect(result).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' })
    }
  })

  it('correctly routes a fan-out pattern (1 parent, 3 children in LR)', () => {
    //        ┌── B (304, 40)
    //  A ────┼── C (304, 156)
    //        └── D (304, 272)
    //
    // A→B: dx=204, dy=-116 → horizontal dominant → right→left
    // A→C: dx=204, dy=0    → horizontal → right→left
    // A→D: dx=204, dy=116  → horizontal dominant → right→left
    const A = { x: 100, y: 156 }
    const B = { x: 304, y: 40 }
    const C = { x: 304, y: 156 }
    const D = { x: 304, y: 272 }

    expect(computeEdgeHandles(A, B)).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
    expect(computeEdgeHandles(A, C)).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
    expect(computeEdgeHandles(A, D)).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
  })

  it('correctly routes a fan-out pattern (1 parent, 3 children in old TB)', () => {
    //         A (200, 40)
    //       / | \
    //      B  C  D    (at y=156, spread horizontally)
    //
    // A→B: dx=-200, dy=116 → |dy|=116, |dx|=200 → horizontal → right→left
    // A→C: dx=0, dy=116    → purely vertical → bottom→top
    // A→D: dx=200, dy=116  → horizontal dominant → right→left
    const A = { x: 200, y: 40 }
    const B = { x: 0, y: 156 }
    const C = { x: 200, y: 156 }
    const D = { x: 400, y: 156 }

    expect(computeEdgeHandles(A, B)).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
    expect(computeEdgeHandles(A, C)).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' })
    expect(computeEdgeHandles(A, D)).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
  })

  // ── Intermediate node avoidance ──────────────────────────────

  it('routes above when intermediate nodes would be crossed', () => {
    // 3 columns: A at col0, B at col1, C at col2
    // Edge A→C should avoid crossing through B's column
    const colStride = 280
    const positions = new Map([
      ['A', { x: 40, y: 100 }],
      ['B', { x: 40 + colStride, y: 100 }],
      ['C', { x: 40 + colStride * 2, y: 100 }],
    ])

    // A→C with B in between — should route above
    expect(computeEdgeHandles(positions.get('A'), positions.get('C'), positions, 'A', 'C')).toEqual({
      sourceHandle: 'right',
      targetHandle: 'top',
    })

    // A→B with no intermediate — normal right→left
    expect(computeEdgeHandles(positions.get('A'), positions.get('B'), positions, 'A', 'B')).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
  })

  it('does not route above when no intermediate nodes exist', () => {
    // 2 columns, no nodes between them
    const positions = new Map([
      ['A', { x: 40, y: 100 }],
      ['C', { x: 600, y: 100 }],
    ])

    expect(computeEdgeHandles(positions.get('A'), positions.get('C'), positions, 'A', 'C')).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
  })

  it('does not route above when intermediate nodes are far from edge y-band', () => {
    // B is horizontally between A and C but far below the edge band
    const positions = new Map([
      ['A', { x: 40, y: 40 }],
      ['B', { x: 300, y: 500 }],  // way below
      ['C', { x: 600, y: 40 }],
    ])

    expect(computeEdgeHandles(positions.get('A'), positions.get('C'), positions, 'A', 'C')).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
  })
})
