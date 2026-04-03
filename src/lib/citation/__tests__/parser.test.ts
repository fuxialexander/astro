import { describe, it, expect } from 'vitest'
import { parseCitations, extractCiteKeys, hasCitations, replaceCitations } from '../parser'

describe('parseCitations', () => {
  it('parses single citation', () => {
    const markers = parseCitations('See [@smith2024] for details.')
    expect(markers).toHaveLength(1)
    expect(markers[0].key).toBe('smith2024')
    expect(markers[0].start).toBe(4)
    expect(markers[0].end).toBe(16)
  })

  it('parses multiple citations', () => {
    const markers = parseCitations('As shown in [@smith2024] and [@jones2023].')
    expect(markers).toHaveLength(2)
    expect(markers[0].key).toBe('smith2024')
    expect(markers[1].key).toBe('jones2023')
  })

  it('parses multi-cite markers', () => {
    const markers = parseCitations('See [@smith2024; @jones2023]')
    expect(markers).toHaveLength(2)
    expect(markers[0].key).toBe('smith2024')
    expect(markers[1].key).toBe('jones2023')
  })

  it('handles hyphenated and underscored keys', () => {
    const markers = parseCitations('[@van-der-berg_2024]')
    expect(markers).toHaveLength(1)
    expect(markers[0].key).toBe('van-der-berg_2024')
  })

  it('returns empty for no citations', () => {
    const markers = parseCitations('No citations here.')
    expect(markers).toHaveLength(0)
  })

  it('ignores incomplete markers', () => {
    expect(parseCitations('[@')).toHaveLength(0)
    expect(parseCitations('[@smith')).toHaveLength(0)
    expect(parseCitations('[smith]')).toHaveLength(0)
  })
})

describe('extractCiteKeys', () => {
  it('returns unique keys', () => {
    const keys = extractCiteKeys('[@smith2024] and again [@smith2024]')
    expect(keys).toEqual(['smith2024'])
  })

  it('preserves order of first appearance', () => {
    const keys = extractCiteKeys('[@b2024] then [@a2023] then [@b2024]')
    expect(keys).toEqual(['b2024', 'a2023'])
  })
})

describe('hasCitations', () => {
  it('returns true for text with citations', () => {
    expect(hasCitations('See [@smith2024].')).toBe(true)
  })

  it('returns false for text without citations', () => {
    expect(hasCitations('No citations here.')).toBe(false)
  })
})

describe('replaceCitations', () => {
  it('replaces citations with formatted text', () => {
    const result = replaceCitations('See [@smith2024] for details.', (key) => `(${key})`)
    expect(result).toBe('See (smith2024) for details.')
  })

  it('replaces multi-cite markers', () => {
    const result = replaceCitations('[@a; @b]', (key) => key.toUpperCase())
    expect(result).toBe('A; B')
  })
})
