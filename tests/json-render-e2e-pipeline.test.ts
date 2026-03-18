/**
 * End-to-end json-render pipeline tests
 *
 * Simulates the full flow: raw assistant text with yaml-spec fences
 * → groupActivityEvents → display blocks → verify spec structure
 * matches what the Renderer expects.
 *
 * Tests real-world agent output patterns to ensure rendering works.
 */

import { describe, it, expect } from 'vitest'
import { groupActivityEvents } from '../src/components/activity-blocks'
import type { TaskActivityEvent } from '../src/types'

// Helper: simulate SSE text chunks arriving and build activity events
function simulateStreamedResponse(text: string): TaskActivityEvent[] {
  // Split into ~50 char chunks to simulate SSE streaming
  const events: TaskActivityEvent[] = []
  const chunkSize = 50
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push({
      type: 'text',
      content: text.slice(i, i + chunkSize),
      timestamp: new Date(),
    })
  }
  return events
}

// ============================================================================
// 1. Full pipeline: streamed text → groupActivityEvents → display blocks
// ============================================================================

describe('Full pipeline: text → groupActivityEvents → display blocks', () => {
  it('extracts CardCarousel spec from streamed text', () => {
    const text = `Here are 3 options to compare:

\`\`\`yaml-spec
root: carousel
elements:
  carousel:
    type: CardCarousel
    props:
      cards:
        - title: Option A
          description: First approach
          badge: Recommended
          badgeVariant: success
        - title: Option B
          description: Second approach
        - title: Option C
          description: Third approach
    children: []
\`\`\`

Let me know which one you prefer!`

    const events = simulateStreamedResponse(text)
    const blocks = groupActivityEvents(events)

    // Should have: text block, spec block, text block
    const textBlocks = blocks.filter(b => b.type === 'text')
    const specBlocks = blocks.filter(b => b.type === 'json_render_spec')

    expect(specBlocks.length).toBe(1)
    expect(textBlocks.length).toBeGreaterThanOrEqual(1)

    // Verify spec structure
    const specEvent = specBlocks[0].events[0] as Extract<TaskActivityEvent, { type: 'json_render_spec' }>
    expect(specEvent.spec.root).toBe('carousel')
    expect(specEvent.spec.elements.carousel).toBeDefined()
    const carousel = specEvent.spec.elements.carousel as Record<string, unknown>
    expect(carousel.type).toBe('CardCarousel')
    const props = carousel.props as Record<string, unknown>
    expect(props.cards).toBeDefined()
    expect((props.cards as unknown[]).length).toBe(3)
  })

  it('extracts Table spec correctly', () => {
    const text = `\`\`\`yaml-spec
root: t1
elements:
  t1:
    type: Table
    props:
      headers: [Name, Role, Status]
      rows:
        - [Alice, Engineer, Active]
        - [Bob, Designer, On Leave]
        - [Carol, PM, Active]
    children: []
\`\`\``

    const events = simulateStreamedResponse(text)
    const blocks = groupActivityEvents(events)
    const specBlocks = blocks.filter(b => b.type === 'json_render_spec')

    expect(specBlocks.length).toBe(1)
    const spec = (specBlocks[0].events[0] as Extract<TaskActivityEvent, { type: 'json_render_spec' }>).spec
    const table = spec.elements.t1 as Record<string, unknown>
    const props = table.props as Record<string, unknown>
    expect((props.headers as string[]).length).toBe(3)
    expect((props.rows as string[][]).length).toBe(3)
  })

  it('extracts OptionCard with send_chat_message action', () => {
    const text = `Choose an option:

\`\`\`yaml-spec
root: opts
elements:
  opts:
    type: Stack
    props:
      direction: vertical
      gap: sm
    children:
      - a
      - b
  a:
    type: OptionCard
    props:
      title: Path A
      description: The safe approach
    on:
      press:
        action: send_chat_message
        params:
          message: "I choose Path A — the safe approach"
    children: []
  b:
    type: OptionCard
    props:
      title: Path B
      description: The bold approach
    on:
      press:
        action: send_chat_message
        params:
          message: "I choose Path B — the bold approach"
    children: []
\`\`\``

    const events = simulateStreamedResponse(text)
    const blocks = groupActivityEvents(events)
    const specBlocks = blocks.filter(b => b.type === 'json_render_spec')

    expect(specBlocks.length).toBe(1)
    const spec = (specBlocks[0].events[0] as Extract<TaskActivityEvent, { type: 'json_render_spec' }>).spec
    expect(spec.root).toBe('opts')
    expect(Object.keys(spec.elements).length).toBe(3)

    // Verify action binding
    const optA = spec.elements.a as Record<string, unknown>
    expect(optA.type).toBe('OptionCard')
    const on = optA.on as Record<string, Record<string, unknown>>
    expect(on.press.action).toBe('send_chat_message')
    expect((on.press.params as Record<string, unknown>).message).toContain('Path A')
  })

  it('extracts Timeline spec', () => {
    const text = `\`\`\`yaml-spec
root: tl
elements:
  tl:
    type: Timeline
    props:
      entries:
        - label: "Week 1"
          title: Setup
          description: Initialize project and dependencies
        - label: "Week 2"
          title: Core Features
          description: Build authentication and data layer
        - label: "Week 3"
          title: Polish
          description: Testing, docs, and deployment
    children: []
\`\`\``

    const events = simulateStreamedResponse(text)
    const blocks = groupActivityEvents(events)
    const specBlocks = blocks.filter(b => b.type === 'json_render_spec')

    expect(specBlocks.length).toBe(1)
    const spec = (specBlocks[0].events[0] as Extract<TaskActivityEvent, { type: 'json_render_spec' }>).spec
    const tl = spec.elements.tl as Record<string, unknown>
    const entries = (tl.props as Record<string, unknown>).entries as unknown[]
    expect(entries.length).toBe(3)
  })

  it('extracts TodoList spec', () => {
    const text = `\`\`\`yaml-spec
root: todos
elements:
  todos:
    type: TodoList
    props:
      title: Sprint Tasks
      items:
        - id: t1
          content: Set up CI/CD pipeline
          priority: high
        - id: t2
          content: Write unit tests
          priority: medium
          status: completed
        - id: t3
          content: Deploy to staging
          priority: low
    children: []
\`\`\``

    const events = simulateStreamedResponse(text)
    const blocks = groupActivityEvents(events)
    const specBlocks = blocks.filter(b => b.type === 'json_render_spec')

    expect(specBlocks.length).toBe(1)
    const spec = (specBlocks[0].events[0] as Extract<TaskActivityEvent, { type: 'json_render_spec' }>).spec
    const todos = spec.elements.todos as Record<string, unknown>
    const items = (todos.props as Record<string, unknown>).items as unknown[]
    expect(items.length).toBe(3)
  })

  it('handles mixed text and multiple specs', () => {
    const text = `Here's an overview:

\`\`\`yaml-spec
root: metrics
elements:
  metrics:
    type: Stack
    props:
      direction: horizontal
      gap: lg
    children:
      - m1
      - m2
  m1:
    type: Metric
    props:
      value: "142"
      label: Tests Passed
      trend: up
    children: []
  m2:
    type: Metric
    props:
      value: "$0.47"
      label: Cost
      trend: stable
    children: []
\`\`\`

And here's the detailed breakdown:

\`\`\`yaml-spec
root: details
elements:
  details:
    type: Accordion
    props:
      items:
        - title: Test Results
          content: "All 142 tests passed in 4.2 seconds."
        - title: Cost Breakdown
          content: "Input: $0.32, Output: $0.15"
    children: []
\`\`\`

Let me know if you need more detail.`

    const events = simulateStreamedResponse(text)
    const blocks = groupActivityEvents(events)

    const textBlocks = blocks.filter(b => b.type === 'text')
    const specBlocks = blocks.filter(b => b.type === 'json_render_spec')

    expect(specBlocks.length).toBe(2)
    expect(textBlocks.length).toBeGreaterThanOrEqual(2)

    // First spec: metrics
    const spec1 = (specBlocks[0].events[0] as Extract<TaskActivityEvent, { type: 'json_render_spec' }>).spec
    expect(spec1.root).toBe('metrics')

    // Second spec: accordion
    const spec2 = (specBlocks[1].events[0] as Extract<TaskActivityEvent, { type: 'json_render_spec' }>).spec
    expect(spec2.root).toBe('details')
  })

  it('passes through text without yaml-spec fences unchanged', () => {
    const text = 'Just a normal response with no specs. Here is some code:\n```python\nprint("hello")\n```\nDone.'
    const events = simulateStreamedResponse(text)
    const blocks = groupActivityEvents(events)

    expect(blocks.length).toBe(1)
    expect(blocks[0].type).toBe('text')
    // No spec blocks
    expect(blocks.filter(b => b.type === 'json_render_spec').length).toBe(0)
  })

  it('handles spec with state and visibility conditions', () => {
    const text = `\`\`\`yaml-spec
root: flow
state:
  step: 1
elements:
  flow:
    type: Stack
    props:
      direction: vertical
      gap: md
    children:
      - step1
      - step2
  step1:
    type: OptionCard
    props:
      title: Choose this
    on:
      press:
        action: setState
        params:
          statePath: "/step"
          value: 2
    children: []
  step2:
    type: Badge
    props:
      label: Step 2 unlocked
      variant: success
    visible:
      $state: "/step"
      gte: 2
    children: []
\`\`\``

    const events = simulateStreamedResponse(text)
    const blocks = groupActivityEvents(events)
    const specBlocks = blocks.filter(b => b.type === 'json_render_spec')

    expect(specBlocks.length).toBe(1)
    const spec = (specBlocks[0].events[0] as Extract<TaskActivityEvent, { type: 'json_render_spec' }>).spec
    expect(spec.root).toBe('flow')
    expect(spec.state).toBeDefined()
    expect(spec.state?.step).toBe(1)

    // Verify visibility condition
    const step2 = spec.elements.step2 as Record<string, unknown>
    expect(step2.visible).toBeDefined()
  })

  it('handles spec interleaved with tool events', () => {
    const events: TaskActivityEvent[] = [
      { type: 'text', content: 'Let me check the files first.\n', timestamp: new Date() },
      { type: 'tool_use', id: 't1', toolName: 'Read', toolInput: { path: 'src/index.ts' }, timestamp: new Date() },
      { type: 'tool_result', id: 't1', toolName: 'Read', toolResult: 'file contents...', timestamp: new Date() },
      { type: 'text', content: 'Here is the summary:\n\n```yaml-spec\nroot: kv\nelements:\n  kv:\n    type: KeyValue\n    props:\n      pairs:\n        - key: Lines\n          value: "142"\n        - key: Functions\n          value: "28"\n    children: []\n```\n\nLooks good!', timestamp: new Date() },
    ]

    const blocks = groupActivityEvents(events)

    // Should have: text, tool, spec (from the yaml-spec in the last text), text
    const specBlocks = blocks.filter(b => b.type === 'json_render_spec')
    expect(specBlocks.length).toBe(1)

    const spec = (specBlocks[0].events[0] as Extract<TaskActivityEvent, { type: 'json_render_spec' }>).spec
    expect(spec.root).toBe('kv')
    const kv = spec.elements.kv as Record<string, unknown>
    expect(kv.type).toBe('KeyValue')
  })

  it('handles real-world complex nested spec (Card with Stack, Badge, Table)', () => {
    const text = `\`\`\`yaml-spec
root: card
elements:
  card:
    type: Card
    props:
      title: Build Results
      description: Latest CI run
    children:
      - badges
      - sep
      - table
  badges:
    type: Stack
    props:
      direction: horizontal
      gap: sm
    children:
      - b1
      - b2
  b1:
    type: Badge
    props:
      label: "138 passed"
      variant: success
    children: []
  b2:
    type: Badge
    props:
      label: "4 failed"
      variant: error
    children: []
  sep:
    type: Separator
    props: {}
    children: []
  table:
    type: Table
    props:
      headers: [Test, Error, File]
      rows:
        - [auth.login, "timeout after 5s", tests/auth.test.ts]
        - [api.rate-limit, "expected 429 got 200", tests/api.test.ts]
      caption: Failed tests
    children: []
\`\`\``

    const events = simulateStreamedResponse(text)
    const blocks = groupActivityEvents(events)
    const specBlocks = blocks.filter(b => b.type === 'json_render_spec')

    expect(specBlocks.length).toBe(1)
    const spec = (specBlocks[0].events[0] as Extract<TaskActivityEvent, { type: 'json_render_spec' }>).spec

    // Verify full tree structure
    expect(spec.root).toBe('card')
    expect(Object.keys(spec.elements).length).toBe(6)

    const card = spec.elements.card as Record<string, unknown>
    expect(card.type).toBe('Card')
    expect(card.children).toEqual(['badges', 'sep', 'table'])

    const badges = spec.elements.badges as Record<string, unknown>
    expect(badges.type).toBe('Stack')
    expect(badges.children).toEqual(['b1', 'b2'])

    const table = spec.elements.table as Record<string, unknown>
    expect(table.type).toBe('Table')
    const tableProps = table.props as Record<string, unknown>
    expect((tableProps.rows as string[][]).length).toBe(2)
  })
})
