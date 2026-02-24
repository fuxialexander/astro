/**
 * Unit tests for device auth scope label formatting.
 *
 * Tests that machine token scopes are displayed with human-readable labels
 * instead of raw technical identifiers, and that duplicates are collapsed.
 */

import { describe, it, expect } from 'vitest'

/** Human-readable labels for machine token scopes (mirrors device-auth.tsx) */
const scopeLabels: Record<string, string> = {
  "machine:connect": "Server Connection",
  "machine:execute": "Task Execution",
  "machine:read": "Task Execution",
  "machine:*": "Full Access",
}

function formatScope(scope: string): string {
  return scopeLabels[scope] ?? scope.replace("machine:", "")
}

function uniqueScopeLabels(scopes: string[]): string[] {
  const seen = new Set<string>()
  return scopes.filter((s) => {
    const label = formatScope(s)
    if (seen.has(label)) return false
    seen.add(label)
    return true
  })
}

describe('formatScope', () => {
  it('maps machine:connect to "Server Connection"', () => {
    expect(formatScope('machine:connect')).toBe('Server Connection')
  })

  it('maps machine:execute to "Task Execution"', () => {
    expect(formatScope('machine:execute')).toBe('Task Execution')
  })

  it('maps machine:read to "Task Execution" (same as execute)', () => {
    expect(formatScope('machine:read')).toBe('Task Execution')
  })

  it('maps machine:* to "Full Access"', () => {
    expect(formatScope('machine:*')).toBe('Full Access')
  })

  it('falls back to stripping "machine:" prefix for unknown scopes', () => {
    expect(formatScope('machine:admin')).toBe('admin')
  })

  it('returns raw string for scopes without machine: prefix', () => {
    expect(formatScope('custom_scope')).toBe('custom_scope')
  })
})

describe('uniqueScopeLabels', () => {
  it('deduplicates default scopes to two badges', () => {
    const defaultScopes = ['machine:connect', 'machine:execute', 'machine:read']
    const unique = uniqueScopeLabels(defaultScopes)
    expect(unique).toHaveLength(2)
    expect(unique.map(formatScope)).toEqual(['Server Connection', 'Task Execution'])
  })

  it('keeps all scopes when labels are distinct', () => {
    const scopes = ['machine:connect', 'machine:execute']
    const unique = uniqueScopeLabels(scopes)
    expect(unique).toHaveLength(2)
  })

  it('handles single scope', () => {
    expect(uniqueScopeLabels(['machine:connect'])).toEqual(['machine:connect'])
  })

  it('handles empty list', () => {
    expect(uniqueScopeLabels([])).toEqual([])
  })

  it('deduplicates wildcard with other scopes that share a label', () => {
    const scopes = ['machine:connect', 'machine:*', 'machine:execute']
    const unique = uniqueScopeLabels(scopes)
    expect(unique.map(formatScope)).toEqual(['Server Connection', 'Full Access', 'Task Execution'])
  })
})
