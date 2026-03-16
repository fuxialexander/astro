/**
 * json-render YAML spec parsing tests
 *
 * Verifies:
 *   1. parseYamlSpecFromText correctly extracts yaml-spec fences from message text
 *   2. Extracted specs have valid structure (root, elements, props, children)
 *   3. Text segments around specs are preserved
 *   4. Multiple specs in one message are all extracted
 *   5. Malformed/incomplete fences are handled gracefully
 *   6. isJsonRenderSpec type guard works correctly
 *   7. dataToSpec auto-conversion works for arrays and objects
 */

import { describe, it, expect } from 'vitest'
import { parseYamlSpecFromText } from '../src/lib/json-render/parse-yaml-spec'
import { isJsonRenderSpec } from '../src/lib/json-render/index'
import { dataToSpec } from '../src/lib/json-render/auto-spec'

// ============================================================================
// 1. parseYamlSpecFromText — basic extraction
// ============================================================================

describe('parseYamlSpecFromText', () => {
  it('extracts a simple yaml-spec fence', () => {
    const text = `Here is a table:

\`\`\`yaml-spec
root: t1
elements:
  t1:
    type: Table
    props:
      headers: [Name, Age]
      rows:
        - [Alice, "30"]
        - [Bob, "25"]
    children: []
\`\`\`

That's the data.`

    const segments = parseYamlSpecFromText(text)
    expect(segments.length).toBe(3) // text, spec, text
    expect(segments[0].type).toBe('text')
    expect(segments[1].type).toBe('spec')
    expect(segments[2].type).toBe('text')

    if (segments[1].type === 'spec') {
      expect(segments[1].spec.root).toBe('t1')
      expect(segments[1].spec.elements).toBeDefined()
      expect(segments[1].spec.elements.t1).toBeDefined()
      const el = segments[1].spec.elements.t1 as Record<string, unknown>
      expect(el.type).toBe('Table')
      expect(el.props).toBeDefined()
      const props = el.props as Record<string, unknown>
      expect(props.headers).toEqual(['Name', 'Age'])
    }
  })

  it('handles text with no yaml-spec fences', () => {
    const text = 'Just plain text with no fences.'
    const segments = parseYamlSpecFromText(text)
    expect(segments.length).toBe(1)
    expect(segments[0].type).toBe('text')
    if (segments[0].type === 'text') {
      expect(segments[0].content).toBe(text)
    }
  })

  it('handles multiple yaml-spec fences in one message', () => {
    const text = `First section:

\`\`\`yaml-spec
root: card1
elements:
  card1:
    type: Card
    props:
      title: Card One
    children: []
\`\`\`

Middle text.

\`\`\`yaml-spec
root: badge1
elements:
  badge1:
    type: Badge
    props:
      label: Success
      variant: success
    children: []
\`\`\`

End text.`

    const segments = parseYamlSpecFromText(text)
    const specs = segments.filter(s => s.type === 'spec')
    expect(specs.length).toBe(2)

    if (specs[0].type === 'spec') {
      expect(specs[0].spec.root).toBe('card1')
    }
    if (specs[1].type === 'spec') {
      expect(specs[1].spec.root).toBe('badge1')
    }
  })

  it('handles yaml-spec with nested elements and children references', () => {
    const text = `\`\`\`yaml-spec
root: stack1
elements:
  stack1:
    type: Stack
    props:
      direction: vertical
      gap: md
    children:
      - heading1
      - kv1
  heading1:
    type: Heading
    props:
      text: Summary
      level: "2"
    children: []
  kv1:
    type: KeyValue
    props:
      pairs:
        - key: Status
          value: Active
        - key: Version
          value: "1.0"
    children: []
\`\`\``

    const segments = parseYamlSpecFromText(text)
    expect(segments.length).toBe(1)
    expect(segments[0].type).toBe('spec')

    if (segments[0].type === 'spec') {
      const spec = segments[0].spec
      expect(spec.root).toBe('stack1')
      expect(Object.keys(spec.elements).length).toBe(3)

      const stack = spec.elements.stack1 as Record<string, unknown>
      expect(stack.type).toBe('Stack')
      expect(stack.children).toEqual(['heading1', 'kv1'])

      const kv = spec.elements.kv1 as Record<string, unknown>
      const kvProps = kv.props as Record<string, unknown>
      expect(kvProps.pairs).toEqual([
        { key: 'Status', value: 'Active' },
        { key: 'Version', value: '1.0' },
      ])
    }
  })

  it('handles CardCarousel spec with cards array', () => {
    const text = `\`\`\`yaml-spec
root: carousel
elements:
  carousel:
    type: CardCarousel
    props:
      cards:
        - title: Option A
          description: First option
          badge: Recommended
          badgeVariant: success
        - title: Option B
          description: Second option
        - title: Option C
          description: Third option
          badge: New
          badgeVariant: info
    children: []
\`\`\``

    const segments = parseYamlSpecFromText(text)
    expect(segments.length).toBe(1)
    expect(segments[0].type).toBe('spec')

    if (segments[0].type === 'spec') {
      const spec = segments[0].spec
      const carousel = spec.elements.carousel as Record<string, unknown>
      expect(carousel.type).toBe('CardCarousel')
      const props = carousel.props as Record<string, unknown>
      const cards = props.cards as Array<Record<string, unknown>>
      expect(cards.length).toBe(3)
      expect(cards[0].title).toBe('Option A')
      expect(cards[0].badge).toBe('Recommended')
      expect(cards[1].title).toBe('Option B')
      expect(cards[2].badge).toBe('New')
    }
  })

  it('handles unclosed yaml-spec fence gracefully', () => {
    const text = `Some text\n\`\`\`yaml-spec\nroot: x\nelements:\n  x:\n    type: Badge`
    const segments = parseYamlSpecFromText(text)
    // Should treat unclosed fence as text
    expect(segments.length).toBeGreaterThanOrEqual(1)
    // Should not crash
  })

  it('handles empty yaml-spec fence', () => {
    const text = `Before\n\`\`\`yaml-spec\n\`\`\`\nAfter`
    const segments = parseYamlSpecFromText(text)
    // Empty spec should not produce a spec segment
    const specs = segments.filter(s => s.type === 'spec')
    expect(specs.length).toBe(0)
  })

  it('handles spec with state', () => {
    const text = `\`\`\`yaml-spec
root: flow
state:
  step: 1
  selected: null
elements:
  flow:
    type: Stack
    props:
      direction: vertical
    children: []
\`\`\``

    const segments = parseYamlSpecFromText(text)
    expect(segments[0].type).toBe('spec')
    if (segments[0].type === 'spec') {
      expect(segments[0].spec.state).toBeDefined()
      expect(segments[0].spec.state?.step).toBe(1)
    }
  })

  it('handles OptionCard with on.press action', () => {
    const text = `\`\`\`yaml-spec
root: opts
elements:
  opts:
    type: Stack
    props:
      direction: vertical
      gap: sm
    children:
      - a
  a:
    type: OptionCard
    props:
      title: Choose me
      description: This is an option
    on:
      press:
        action: send_chat_message
        params:
          message: I chose this option
    children: []
\`\`\``

    const segments = parseYamlSpecFromText(text)
    expect(segments[0].type).toBe('spec')
    if (segments[0].type === 'spec') {
      const optCard = segments[0].spec.elements.a as Record<string, unknown>
      expect(optCard.type).toBe('OptionCard')
      const on = optCard.on as Record<string, Record<string, unknown>>
      expect(on.press.action).toBe('send_chat_message')
      expect((on.press.params as Record<string, unknown>).message).toBe('I chose this option')
    }
  })
})

// ============================================================================
// 2. isJsonRenderSpec type guard
// ============================================================================

describe('isJsonRenderSpec', () => {
  it('returns true for valid spec shape', () => {
    expect(isJsonRenderSpec({ root: 'x', elements: { x: {} } })).toBe(true)
  })

  it('returns false for null/undefined', () => {
    expect(isJsonRenderSpec(null)).toBe(false)
    expect(isJsonRenderSpec(undefined)).toBe(false)
  })

  it('returns false for arrays', () => {
    expect(isJsonRenderSpec([1, 2, 3])).toBe(false)
  })

  it('returns false for objects without root', () => {
    expect(isJsonRenderSpec({ elements: {} })).toBe(false)
  })

  it('returns false for objects with array elements', () => {
    expect(isJsonRenderSpec({ root: 'x', elements: [1, 2] })).toBe(false)
  })

  it('returns false for empty root string', () => {
    expect(isJsonRenderSpec({ root: '', elements: {} })).toBe(false)
  })
})

// ============================================================================
// 3. dataToSpec auto-conversion
// ============================================================================

describe('dataToSpec', () => {
  it('converts array of objects to Table spec', () => {
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]
    const spec = dataToSpec(data)
    expect(spec).not.toBeNull()
    expect(spec!.root).toBe('table-1')
    const table = spec!.elements['table-1'] as Record<string, unknown>
    expect(table.type).toBe('Table')
    const props = table.props as Record<string, unknown>
    expect(props.headers).toEqual(['name', 'age'])
    expect((props.rows as string[][]).length).toBe(2)
  })

  it('converts flat object to KeyValue spec', () => {
    const data = { status: 'active', version: '1.0', count: 42 }
    const spec = dataToSpec(data)
    expect(spec).not.toBeNull()
    expect(spec!.root).toBe('kv-1')
    const kv = spec!.elements['kv-1'] as Record<string, unknown>
    expect(kv.type).toBe('KeyValue')
    const props = kv.props as Record<string, unknown>
    const pairs = props.pairs as Array<{ key: string; value: string }>
    expect(pairs.length).toBe(3)
    expect(pairs[0]).toEqual({ key: 'status', value: 'active' })
  })

  it('returns null for primitive values', () => {
    expect(dataToSpec('hello')).toBeNull()
    expect(dataToSpec(42)).toBeNull()
    expect(dataToSpec(null)).toBeNull()
  })

  it('returns null for empty arrays', () => {
    expect(dataToSpec([])).toBeNull()
  })

  it('returns null for nested objects', () => {
    const data = { a: { b: 'nested' } }
    expect(dataToSpec(data)).toBeNull()
  })

  it('caps rows at 50', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}` }))
    const spec = dataToSpec(data)
    expect(spec).not.toBeNull()
    const table = spec!.elements['table-1'] as Record<string, unknown>
    const props = table.props as Record<string, unknown>
    expect((props.rows as string[][]).length).toBe(50)
  })
})
