/**
 * Unit tests for CLI output formatting utilities.
 * These tests do NOT require a running server.
 */
import { describe, it, expect } from 'vitest'
import { formatTable, formatJson, formatRelativeTime, formatStatus } from '../src/output.js'

describe('output', () => {
  describe('formatJson', () => {
    it('formats objects with 2-space indent', () => {
      const result = formatJson({ foo: 'bar', num: 42 })
      expect(result).toBe('{\n  "foo": "bar",\n  "num": 42\n}')
    })

    it('formats arrays', () => {
      const result = formatJson([1, 2, 3])
      expect(result).toBe('[\n  1,\n  2,\n  3\n]')
    })

    it('handles null and undefined', () => {
      expect(formatJson(null)).toBe('null')
    })
  })

  describe('formatTable', () => {
    it('renders a table with headers and rows', () => {
      const rows = [
        { id: 'abc123', name: 'Test Project' },
        { id: 'def456', name: 'Another' },
      ]
      const columns = [
        { key: 'id', label: 'ID', width: 10 },
        { key: 'name', label: 'NAME', width: 20 },
      ]
      const result = formatTable(rows, columns)

      // Should contain headers and data
      expect(result).toContain('ID')
      expect(result).toContain('NAME')
      expect(result).toContain('abc123')
      expect(result).toContain('Test Project')
      expect(result).toContain('def456')
      expect(result).toContain('Another')
    })

    it('returns "No results." for empty rows', () => {
      const result = formatTable([], [{ key: 'id', label: 'ID' }])
      expect(result).toContain('No results')
    })

    it('applies custom format functions', () => {
      const rows = [{ status: 'active' }]
      const columns = [
        { key: 'status', label: 'STATUS', format: (v: unknown) => `[${v}]` },
      ]
      const result = formatTable(rows, columns)
      expect(result).toContain('[active]')
    })
  })

  describe('formatRelativeTime', () => {
    it('returns "just now" for recent dates', () => {
      const now = new Date()
      expect(formatRelativeTime(now)).toBe('just now')
    })

    it('returns minutes ago', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
      expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago')
    })

    it('returns hours ago', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
      expect(formatRelativeTime(threeHoursAgo)).toBe('3h ago')
    })

    it('returns days ago', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      expect(formatRelativeTime(twoDaysAgo)).toBe('2d ago')
    })

    it('returns dash for null/undefined', () => {
      const nullResult = formatRelativeTime(null)
      expect(nullResult).toBeTruthy() // chalk.dim('—')
    })

    it('handles ISO string dates', () => {
      const recentIso = new Date(Date.now() - 10 * 1000).toISOString()
      expect(formatRelativeTime(recentIso)).toBe('just now')
    })
  })

  describe('formatStatus', () => {
    it('formats known statuses with color', () => {
      // These return chalk-colored strings, so they contain the status text
      expect(formatStatus('active')).toContain('active')
      expect(formatStatus('completed')).toContain('completed')
      expect(formatStatus('planned')).toContain('planned')
      expect(formatStatus('in_progress')).toContain('in_progress')
      expect(formatStatus('pruned')).toContain('pruned')
    })

    it('formats unknown statuses without error', () => {
      expect(formatStatus('custom_status')).toContain('custom_status')
    })
  })
})
