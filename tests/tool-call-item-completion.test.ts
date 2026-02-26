/**
 * Unit tests for ToolCallItem completion logic (Fix 4).
 *
 * Verifies that `isComplete` is correctly derived based on:
 * - tool output presence
 * - tool durationMs presence
 * - isTaskComplete prop (defaults to true for trace viewer)
 *
 * The trace viewer only shows completed tasks, so all tools should
 * display as complete (check/X icon) rather than spinning.
 *
 * Run with: npx vitest run tests/tool-call-item-completion.test.ts
 */

import { describe, it, expect } from 'vitest'

// We test the isComplete derivation logic directly (same as in tool-call-item.tsx)
// to avoid needing a full React render setup.

interface ToolCallLike {
  output: unknown
  durationMs: number | null
}

function deriveIsComplete(tool: ToolCallLike, isTaskComplete = true): boolean {
  const hasOutput = tool.output != null
  return hasOutput || tool.durationMs != null || isTaskComplete
}

describe('ToolCallItem isComplete logic', () => {
  describe('when isTaskComplete=true (default, trace viewer)', () => {
    it('returns true even with no output and no durationMs', () => {
      expect(deriveIsComplete({ output: null, durationMs: null }, true)).toBe(true)
    })

    it('returns true with output present', () => {
      expect(deriveIsComplete({ output: 'some result', durationMs: null }, true)).toBe(true)
    })

    it('returns true with durationMs present', () => {
      expect(deriveIsComplete({ output: null, durationMs: 1234 }, true)).toBe(true)
    })

    it('returns true with both output and durationMs present', () => {
      expect(deriveIsComplete({ output: 'result', durationMs: 500 }, true)).toBe(true)
    })
  })

  describe('when isTaskComplete=false (live/streaming view)', () => {
    it('returns false with no output and no durationMs (tool still running)', () => {
      expect(deriveIsComplete({ output: null, durationMs: null }, false)).toBe(false)
    })

    it('returns true with output present', () => {
      expect(deriveIsComplete({ output: 'some result', durationMs: null }, false)).toBe(true)
    })

    it('returns true with durationMs present', () => {
      expect(deriveIsComplete({ output: null, durationMs: 1234 }, false)).toBe(true)
    })

    it('returns true with both output and durationMs', () => {
      expect(deriveIsComplete({ output: 'result', durationMs: 500 }, false)).toBe(true)
    })
  })

  describe('default parameter behavior', () => {
    it('defaults isTaskComplete to true', () => {
      // No second argument = default true
      expect(deriveIsComplete({ output: null, durationMs: null })).toBe(true)
    })
  })

  describe('edge cases for output detection', () => {
    it('treats undefined output as no output', () => {
      expect(deriveIsComplete({ output: undefined, durationMs: null }, false)).toBe(false)
    })

    it('treats empty string output as having output', () => {
      expect(deriveIsComplete({ output: '', durationMs: null }, false)).toBe(true)
    })

    it('treats zero durationMs as having duration', () => {
      expect(deriveIsComplete({ output: null, durationMs: 0 }, false)).toBe(true)
    })

    it('treats object output as having output', () => {
      expect(deriveIsComplete({ output: { key: 'value' }, durationMs: null }, false)).toBe(true)
    })
  })
})
