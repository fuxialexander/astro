import { describe, it, expect } from 'vitest'
import { hasFeature, GLOBAL_DEFAULTS } from '../server/lib/feature-flags.js'

describe('hasFeature', () => {
  it('returns false for unknown flags with no team override', () => {
    expect(hasFeature({}, 'nonexistent-flag')).toBe(false)
    expect(hasFeature(null, 'nonexistent-flag')).toBe(false)
    expect(hasFeature(undefined, 'nonexistent-flag')).toBe(false)
  })

  it('returns the global default when no team override exists', () => {
    // github-integration is GA (true); loop-nodes is gated (false)
    expect(hasFeature({}, 'github-integration')).toBe(true)
    expect(hasFeature({}, 'loop-nodes')).toBe(false)
  })

  it('returns the team override when present, ignoring global default', () => {
    // Team says true, global says false → true
    expect(hasFeature({ 'loop-nodes': true }, 'loop-nodes')).toBe(true)

    // Team says false explicitly → false (even if global is true)
    expect(hasFeature({ 'github-integration': false }, 'github-integration')).toBe(false)
  })

  it('handles team flags for features not in GLOBAL_DEFAULTS', () => {
    // A team can have flags that aren't in GLOBAL_DEFAULTS
    expect(hasFeature({ 'custom-experiment': true }, 'custom-experiment')).toBe(true)
    expect(hasFeature({ 'custom-experiment': false }, 'custom-experiment')).toBe(false)
  })

  it('handles null and undefined team flags gracefully', () => {
    expect(hasFeature(null, 'loop-nodes')).toBe(false)
    expect(hasFeature(undefined, 'loop-nodes')).toBe(false)
  })

  it('handles empty team flags (uses global defaults)', () => {
    expect(hasFeature({}, 'github-integration')).toBe(GLOBAL_DEFAULTS['github-integration'])
  })

  it('team override takes priority over global default', () => {
    // Global false, team override true wins
    expect(hasFeature({ 'loop-nodes': true }, 'loop-nodes')).toBe(true)

    // Global true, team override false wins
    expect(hasFeature({ 'github-integration': false }, 'github-integration')).toBe(false)
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
  it('contains expected flags', () => {
    expect('github-integration' in GLOBAL_DEFAULTS).toBe(true)
    expect('loop-nodes' in GLOBAL_DEFAULTS).toBe(true)
  })
})
