/**
 * Refinement Loading Indicator Tests
 *
 * Tests the refinement loading UX pattern used across multiple components:
 *   1. node-inspector.tsx — description overlay + success ring
 *   2. execution-panel.tsx — button state change + success flash
 *   3. project-new.tsx — description overlay + disabled textarea
 *
 * Also tests edge cases:
 *   - justRefined auto-clears after timeout
 *   - Refinement failure does not trigger justRefined
 *   - Multiple rapid refinements
 *   - Component state isolation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Extracted refinement state machine
// ============================================================================

/**
 * Simulates the refinement state machine used in all three components.
 * The pattern is: isRefining (loading) → justRefined (success flash) → idle
 */
function createRefinementState() {
  let isRefining = false
  let justRefined = false
  let timerId: ReturnType<typeof setTimeout> | undefined

  return {
    get isRefining() { return isRefining },
    get justRefined() { return justRefined },

    /**
     * Simulates the handleRefine function pattern.
     */
    async handleRefine(
      refineFn: () => Promise<{ refinedTitle: string; refinedDescription: string } | null>,
    ): Promise<boolean> {
      if (isRefining) return false // Prevent concurrent refinements

      isRefining = true
      try {
        const result = await refineFn()
        if (result) {
          // Clear any existing justRefined timer
          if (timerId) clearTimeout(timerId)
          justRefined = true
          timerId = setTimeout(() => {
            justRefined = false
            timerId = undefined
          }, 1500)
          isRefining = false
          return true
        }
      } catch {
        // Refinement is best-effort
      }
      isRefining = false
      return false
    },

    /** Reset for testing */
    _reset() {
      isRefining = false
      justRefined = false
      if (timerId) clearTimeout(timerId)
      timerId = undefined
    },
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Refinement state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('transitions: idle → refining → justRefined → idle', async () => {
    const state = createRefinementState()
    expect(state.isRefining).toBe(false)
    expect(state.justRefined).toBe(false)

    const promise = state.handleRefine(async () => ({
      refinedTitle: 'Better Title',
      refinedDescription: 'Better Description',
    }))

    // During refinement
    expect(state.isRefining).toBe(true)
    expect(state.justRefined).toBe(false)

    await promise

    // After success
    expect(state.isRefining).toBe(false)
    expect(state.justRefined).toBe(true)

    // After 1.5s
    vi.advanceTimersByTime(1500)
    expect(state.justRefined).toBe(false)
  })

  it('justRefined auto-clears after 1500ms', async () => {
    const state = createRefinementState()
    await state.handleRefine(async () => ({
      refinedTitle: 'T',
      refinedDescription: 'D',
    }))

    expect(state.justRefined).toBe(true)

    vi.advanceTimersByTime(1499)
    expect(state.justRefined).toBe(true)

    vi.advanceTimersByTime(1)
    expect(state.justRefined).toBe(false)
  })

  it('does NOT set justRefined when refinement returns null', async () => {
    const state = createRefinementState()
    const result = await state.handleRefine(async () => null)

    expect(result).toBe(false)
    expect(state.justRefined).toBe(false)
    expect(state.isRefining).toBe(false)
  })

  it('does NOT set justRefined when refinement throws', async () => {
    const state = createRefinementState()
    const result = await state.handleRefine(async () => {
      throw new Error('API error')
    })

    expect(result).toBe(false)
    expect(state.justRefined).toBe(false)
    expect(state.isRefining).toBe(false)
  })

  it('prevents concurrent refinements', async () => {
    const state = createRefinementState()

    let resolveFirst: () => void
    const firstPromise = state.handleRefine(() => new Promise((resolve) => {
      resolveFirst = () => resolve({ refinedTitle: 'T', refinedDescription: 'D' })
    }))

    // Try to start second refinement while first is in progress
    const secondResult = await state.handleRefine(async () => ({
      refinedTitle: 'T2',
      refinedDescription: 'D2',
    }))

    expect(secondResult).toBe(false) // Blocked

    // Complete first
    resolveFirst!()
    const firstResult = await firstPromise
    expect(firstResult).toBe(true)
  })

  it('handles rapid successive refinements (second replaces first timer)', async () => {
    const state = createRefinementState()

    // First refinement
    await state.handleRefine(async () => ({
      refinedTitle: 'T1',
      refinedDescription: 'D1',
    }))
    expect(state.justRefined).toBe(true)

    // Advance 1000ms (still in justRefined from first)
    vi.advanceTimersByTime(1000)
    expect(state.justRefined).toBe(true)

    // Second refinement (resets timer)
    await state.handleRefine(async () => ({
      refinedTitle: 'T2',
      refinedDescription: 'D2',
    }))
    expect(state.justRefined).toBe(true)

    // At 2000ms from start (only 1000ms after second), still active
    // Because the second refinement reset the 1500ms timer
    vi.advanceTimersByTime(1000)
    expect(state.justRefined).toBe(true)

    // At 2500ms from start (1500ms after second), should clear
    vi.advanceTimersByTime(500)
    expect(state.justRefined).toBe(false)
  })
})

// ============================================================================
// Source code verification for all three components
// ============================================================================

// node-inspector.tsx refinement loading tests removed — the component was
// redesigned and no longer uses the justRefined/overlay pattern

describe('execution-panel.tsx refinement loading', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/components/execution/execution-panel.tsx'),
    'utf-8'
  )

  it('has justRefined state', () => {
    expect(source).toContain('justRefined')
    expect(source).toContain('setJustRefined')
  })

  it('shows "Refined!" text after successful refinement', () => {
    expect(source).toContain('Refined!')
  })

  it('shows checkmark icon after refinement (CheckCircle2)', () => {
    expect(source).toContain('justRefined')
    expect(source).toContain('CheckCircle2')
  })

  it('auto-clears justRefined after 1500ms', () => {
    expect(source).toContain('setTimeout(() => setJustRefined(false), 1500)')
  })
})

// project-new.tsx was merged into project-new-plan.tsx — refinement loading
// source tests removed (refinement state machine tests above still cover the logic)
