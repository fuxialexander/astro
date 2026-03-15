import { describe, it, expect } from 'vitest'
import { hasFeature, GLOBAL_DEFAULTS } from '../server/lib/feature-flags.js'

describe('hasFeature', () => {
  it('returns false for unknown flags with no team override', () => {
    expect(hasFeature({}, 'nonexistent-flag')).toBe(false)
    expect(hasFeature(null, 'nonexistent-flag')).toBe(false)
    expect(hasFeature(undefined, 'nonexistent-flag')).toBe(false)
  })

  it('returns the global default when no team override exists', () => {
    // Both flags default to false in GLOBAL_DEFAULTS
    expect(hasFeature({}, 'github-integration')).toBe(false)
    expect(hasFeature({}, 'webhook-automation')).toBe(false)
  })

  it('returns the team override when present, ignoring global default', () => {
    // Team says true, global says false → true
    expect(hasFeature({ 'github-integration': true }, 'github-integration')).toBe(true)

    // Team says false explicitly → false (even if global were true)
    expect(hasFeature({ 'github-integration': false }, 'github-integration')).toBe(false)
  })

  it('handles team flags for features not in GLOBAL_DEFAULTS', () => {
    // A team can have flags that aren't in GLOBAL_DEFAULTS
    expect(hasFeature({ 'custom-experiment': true }, 'custom-experiment')).toBe(true)
    expect(hasFeature({ 'custom-experiment': false }, 'custom-experiment')).toBe(false)
  })

  it('handles null and undefined team flags gracefully', () => {
    expect(hasFeature(null, 'github-integration')).toBe(false)
    expect(hasFeature(undefined, 'github-integration')).toBe(false)
  })

  it('handles empty team flags (uses global defaults)', () => {
    expect(hasFeature({}, 'github-integration')).toBe(GLOBAL_DEFAULTS['github-integration'])
  })

  it('team override takes priority over global default', () => {
    // Even if global is false, team override true wins
    const teamFlags = { 'github-integration': true }
    expect(hasFeature(teamFlags, 'github-integration')).toBe(true)

    // Even if we had a global true, team override false wins
    const teamFlagsOff = { 'github-integration': false }
    expect(hasFeature(teamFlagsOff, 'github-integration')).toBe(false)
  })

  it('is idempotent — calling multiple times returns same result', () => {
    const flags = { 'github-integration': true }
    const result1 = hasFeature(flags, 'github-integration')
    const result2 = hasFeature(flags, 'github-integration')
    const result3 = hasFeature(flags, 'github-integration')
    expect(result1).toBe(result2)
    expect(result2).toBe(result3)
  })

  it('does not mutate the input flags object', () => {
    const flags = { 'github-integration': true }
    const copy = { ...flags }
    hasFeature(flags, 'github-integration')
    hasFeature(flags, 'nonexistent')
    expect(flags).toEqual(copy)
  })
})

describe('GLOBAL_DEFAULTS', () => {
  it('contains expected initial flags', () => {
    expect('github-integration' in GLOBAL_DEFAULTS).toBe(true)
    expect('webhook-automation' in GLOBAL_DEFAULTS).toBe(true)
  })

  it('all initial flags default to false (gated, not released)', () => {
    for (const [, value] of Object.entries(GLOBAL_DEFAULTS)) {
      expect(value).toBe(false)
    }
  })
})
