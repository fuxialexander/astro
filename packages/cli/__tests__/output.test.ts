/**
 * Unit tests for CLI output formatting utilities.
 * These tests do NOT require a running server.
 */
import { describe, it, expect } from 'vitest'
import { formatTable, formatJson, formatRelativeTime, formatStatus, parseDateFilter, formatDuration } from '../src/output.js'

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

  describe('parseDateFilter', () => {
    it('parses relative minutes', () => {
      const before = Date.now()
      const result = parseDateFilter('30m')
      const after = Date.now()
      // Should be ~30 minutes ago
      const diffMs = before - result.getTime()
      expect(diffMs).toBeGreaterThanOrEqual(30 * 60 * 1000 - 100)
      expect(diffMs).toBeLessThanOrEqual(30 * 60 * 1000 + (after - before) + 100)
    })

    it('parses relative hours', () => {
      const result = parseDateFilter('2h')
      const diff = Date.now() - result.getTime()
      expect(diff).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000 - 100)
      expect(diff).toBeLessThanOrEqual(2 * 60 * 60 * 1000 + 100)
    })

    it('parses relative days', () => {
      const result = parseDateFilter('3d')
      const diff = Date.now() - result.getTime()
      expect(diff).toBeGreaterThanOrEqual(3 * 24 * 60 * 60 * 1000 - 100)
      expect(diff).toBeLessThanOrEqual(3 * 24 * 60 * 60 * 1000 + 100)
    })

    it('parses relative weeks', () => {
      const result = parseDateFilter('1w')
      const diff = Date.now() - result.getTime()
      expect(diff).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 100)
      expect(diff).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 100)
    })

    it('parses "today"', () => {
      const result = parseDateFilter('today')
      const now = new Date()
      expect(result.getFullYear()).toBe(now.getFullYear())
      expect(result.getMonth()).toBe(now.getMonth())
      expect(result.getDate()).toBe(now.getDate())
      expect(result.getHours()).toBe(0)
      expect(result.getMinutes()).toBe(0)
    })

    it('parses "yesterday"', () => {
      const result = parseDateFilter('yesterday')
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      expect(result.getFullYear()).toBe(yesterday.getFullYear())
      expect(result.getMonth()).toBe(yesterday.getMonth())
      expect(result.getDate()).toBe(yesterday.getDate())
      expect(result.getHours()).toBe(0)
    })

    it('parses ISO date strings', () => {
      const result = parseDateFilter('2024-06-15T00:00:00Z')
      expect(result.getUTCFullYear()).toBe(2024)
      expect(result.getUTCMonth()).toBe(5) // 0-indexed
      expect(result.getUTCDate()).toBe(15)
    })

    it('parses full ISO datetime strings', () => {
      const result = parseDateFilter('2024-06-15T10:30:00Z')
      expect(result.getFullYear()).toBe(2024)
    })

    it('throws on invalid input', () => {
      expect(() => parseDateFilter('not-a-date')).toThrow('Invalid date filter')
    })

    it('throws on empty string', () => {
      expect(() => parseDateFilter('')).toThrow('Invalid date filter')
    })
  })

  describe('formatDuration', () => {
    it('formats milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms')
      expect(formatDuration(0)).toBe('0ms')
    })

    it('formats seconds', () => {
      expect(formatDuration(5200)).toBe('5.2s')
      expect(formatDuration(1000)).toBe('1.0s')
      expect(formatDuration(59999)).toBe('60.0s')
    })

    it('formats minutes and seconds', () => {
      expect(formatDuration(150000)).toBe('2m 30s')
      expect(formatDuration(60000)).toBe('1m')
      expect(formatDuration(90000)).toBe('1m 30s')
    })

    it('formats hours and minutes', () => {
      expect(formatDuration(4500000)).toBe('1h 15m')
      expect(formatDuration(3600000)).toBe('1h')
      expect(formatDuration(7200000)).toBe('2h')
    })
  })
})
