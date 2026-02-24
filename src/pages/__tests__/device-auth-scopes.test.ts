/**
 * Unit tests for device auth scope label formatting.
 *
 * Tests that machine token scopes are displayed with human-readable labels
 * instead of raw technical identifiers.
 */

import { describe, it, expect } from 'vitest'

/** Human-readable labels for machine token scopes (mirrors device-auth.tsx) */
const scopeLabels: Record<string, string> = {
  "machine:connect": "Relay Connection",
  "machine:execute": "Task Execution",
  "machine:read": "Read Results",
  "machine:*": "Full Access",
}

function formatScope(scope: string): string {
  return scopeLabels[scope] ?? scope.replace("machine:", "")
}

describe('formatScope', () => {
  it('maps machine:connect to "Relay Connection"', () => {
    expect(formatScope('machine:connect')).toBe('Relay Connection')
  })

  it('maps machine:execute to "Task Execution"', () => {
    expect(formatScope('machine:execute')).toBe('Task Execution')
  })

  it('maps machine:read to "Read Results"', () => {
    expect(formatScope('machine:read')).toBe('Read Results')
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

  it('formats all default scopes correctly', () => {
    const defaultScopes = ['machine:connect', 'machine:execute', 'machine:read']
    const labels = defaultScopes.map(formatScope)
    expect(labels).toEqual(['Relay Connection', 'Task Execution', 'Read Results'])
  })
})
