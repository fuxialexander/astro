/**
 * Observation Store Tests
 *
 * Tests for buildTraceTree() which transforms flat API observations
 * into the hierarchical TraceTree structure used by the Trace Viewer UI.
 */

import { describe, it, expect } from 'vitest'
import { buildTraceTree } from '../observation-store'
import type { RawObservation } from '@/types/observations'

// Helper to create a minimal RawObservation
function makeObs(overrides: Partial<RawObservation> & { id: string; type: RawObservation['type']; name: string }): RawObservation {
  return {
    traceId: 'trace-1',
    parentObservationId: null,
    startTime: '2026-02-19T10:00:00.000Z',
    endTime: null,
    input: null,
    output: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    level: 'default',
    metadata: null,
    projectId: 'proj-1',
    nodeId: null,
    statusMessage: null,
    ...overrides,
  }
}

describe('buildTraceTree', () => {
  it('should handle empty observations', () => {
    const tree = buildTraceTree('trace-empty', [])

    expect(tree.traceId).toBe('trace-empty')
    expect(tree.contextSpan).toBeNull()
    expect(tree.turns).toHaveLength(0)
    expect(tree.events).toHaveLength(0)
    expect(tree.stats.totalTurns).toBe(0)
    expect(tree.stats.totalToolCalls).toBe(0)
    expect(tree.stats.totalTokens).toBe(0)
    expect(tree.stats.totalCost).toBe(0)
    expect(tree.stats.model).toBeNull()
    expect(tree.stats.durationMs).toBeNull()
  })

  it('should find context span', () => {
    const obs: RawObservation[] = [
      makeObs({ id: 'span-1', type: 'span', name: 'context', input: { task: 'test' } }),
      makeObs({ id: 'span-2', type: 'span', name: 'other-span' }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.contextSpan).not.toBeNull()
    expect(tree.contextSpan!.id).toBe('span-1')
    expect(tree.contextSpan!.name).toBe('context')
  })

  it('should return null contextSpan when none matches', () => {
    const obs: RawObservation[] = [
      makeObs({ id: 'span-1', type: 'span', name: 'execution' }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.contextSpan).toBeNull()
  })

  it('should create turns from generations sorted by startTime', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-2', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:01:00.000Z',
        output: { text: 'Second turn' },
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 200,
        outputTokens: 50,
      }),
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:00.000Z',
        output: { text: 'First turn' },
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 100,
        outputTokens: 30,
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)

    expect(tree.turns).toHaveLength(2)
    expect(tree.turns[0].turnIndex).toBe(0)
    expect(tree.turns[0].text).toBe('First turn')
    expect(tree.turns[0].generation.id).toBe('gen-1')
    expect(tree.turns[1].turnIndex).toBe(1)
    expect(tree.turns[1].text).toBe('Second turn')
    expect(tree.turns[1].generation.id).toBe('gen-2')
  })

  it('should parse text from string output', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        output: 'Plain string output',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].text).toBe('Plain string output')
  })

  it('should parse text from { content: string } output', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        output: { content: 'Content field output' },
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].text).toBe('Content field output')
  })

  it('should handle null/undefined output gracefully', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        output: null,
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].text).toBe('')
  })

  it('should handle numeric/boolean output gracefully', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        output: 42,
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].text).toBe('')
  })

  it('should associate tools with their parent generation', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:00.000Z',
        output: { text: 'Let me read the file' },
      }),
      makeObs({
        id: 'tool-1', type: 'tool', name: 'Read',
        parentObservationId: 'gen-1',
        startTime: '2026-02-19T10:00:01.000Z',
        endTime: '2026-02-19T10:00:01.200Z',
        input: { path: '/src/main.ts' },
        output: 'file contents here',
      }),
      makeObs({
        id: 'tool-2', type: 'tool', name: 'Edit',
        parentObservationId: 'gen-1',
        startTime: '2026-02-19T10:00:02.000Z',
        endTime: '2026-02-19T10:00:02.500Z',
        input: { path: '/src/main.ts', old: 'a', new: 'b' },
        output: 'edited',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)

    expect(tree.turns).toHaveLength(1)
    expect(tree.turns[0].toolCalls).toHaveLength(2)
    expect(tree.turns[0].toolCalls[0].name).toBe('Read')
    expect(tree.turns[0].toolCalls[0].input).toEqual({ path: '/src/main.ts' })
    expect(tree.turns[0].toolCalls[0].output).toBe('file contents here')
    expect(tree.turns[0].toolCalls[1].name).toBe('Edit')
  })

  it('should not associate tools with wrong parent', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:00.000Z',
        output: { text: 'Turn 1' },
      }),
      makeObs({
        id: 'gen-2', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:01:00.000Z',
        output: { text: 'Turn 2' },
      }),
      makeObs({
        id: 'tool-1', type: 'tool', name: 'Bash',
        parentObservationId: 'gen-2', // belongs to gen-2
        startTime: '2026-02-19T10:01:01.000Z',
        endTime: '2026-02-19T10:01:02.000Z',
        input: { command: 'ls' },
        output: 'file.txt',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)

    expect(tree.turns[0].toolCalls).toHaveLength(0) // gen-1 has no tools
    expect(tree.turns[1].toolCalls).toHaveLength(1) // gen-2 has the tool
    expect(tree.turns[1].toolCalls[0].name).toBe('Bash')
  })

  it('should compute tool durationMs from start/end times', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        output: { text: 'test' },
      }),
      makeObs({
        id: 'tool-1', type: 'tool', name: 'Bash',
        parentObservationId: 'gen-1',
        startTime: '2026-02-19T10:00:00.000Z',
        endTime: '2026-02-19T10:00:03.456Z',
        input: { command: 'npm test' },
        output: 'pass',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].toolCalls[0].durationMs).toBe(3456)
  })

  it('should return null durationMs when endTime is missing', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        output: { text: 'test' },
      }),
      makeObs({
        id: 'tool-1', type: 'tool', name: 'Bash',
        parentObservationId: 'gen-1',
        startTime: '2026-02-19T10:00:00.000Z',
        endTime: null, // still running
        input: { command: 'npm test' },
        output: null,
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].toolCalls[0].durationMs).toBeNull()
  })

  it('should mark tools with error level as not successful', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        output: { text: 'test' },
      }),
      makeObs({
        id: 'tool-1', type: 'tool', name: 'Bash',
        parentObservationId: 'gen-1',
        level: 'error',
        input: { command: 'bad-cmd' },
        output: 'command not found',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].toolCalls[0].success).toBe(false)
  })

  it('should mark tools with metadata.success=false as not successful', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        output: { text: 'test' },
      }),
      makeObs({
        id: 'tool-1', type: 'tool', name: 'Bash',
        parentObservationId: 'gen-1',
        level: 'default',
        metadata: { success: false, toolUseId: 'tu-1' },
        input: { command: 'exit 1' },
        output: 'error',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].toolCalls[0].success).toBe(false)
  })

  it('should separate event observations', () => {
    const obs: RawObservation[] = [
      makeObs({ id: 'ev-1', type: 'event', name: 'task:started' }),
      makeObs({ id: 'ev-2', type: 'event', name: 'task:completed' }),
      makeObs({ id: 'gen-1', type: 'generation', name: 'generation', output: 'hi' }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.events).toHaveLength(2)
    expect(tree.events[0].name).toBe('task:started')
    expect(tree.events[1].name).toBe('task:completed')
    expect(tree.turns).toHaveLength(1)
  })

  it('should compute aggregate stats correctly', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:00.000Z',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 1000,
        outputTokens: 200,
        estimatedCostUsd: 0.005,
        output: { text: 'Turn 1' },
      }),
      makeObs({
        id: 'tool-1', type: 'tool', name: 'Bash',
        parentObservationId: 'gen-1',
        startTime: '2026-02-19T10:00:01.000Z',
        endTime: '2026-02-19T10:00:02.000Z',
        estimatedCostUsd: null,
        input: { command: 'ls' },
        output: 'ok',
      }),
      makeObs({
        id: 'gen-2', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:03.000Z',
        endTime: '2026-02-19T10:00:05.000Z',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 1500,
        outputTokens: 300,
        estimatedCostUsd: 0.008,
        output: { text: 'Turn 2' },
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)

    expect(tree.stats.totalTurns).toBe(2)
    expect(tree.stats.totalToolCalls).toBe(1)
    expect(tree.stats.totalTokens).toBe(1000 + 200 + 1500 + 300) // 3000
    expect(tree.stats.totalCost).toBeCloseTo(0.013, 4)
    expect(tree.stats.model).toBe('claude-sonnet-4-5-20250929')
  })

  it('should compute durationMs from first to last observation', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:00.000Z',
        output: 'first',
      }),
      makeObs({
        id: 'gen-2', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:10.000Z',
        endTime: '2026-02-19T10:00:15.000Z',
        output: 'last',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    // Duration: from first start (10:00:00) to last end (10:00:15) = 15000ms
    expect(tree.stats.durationMs).toBe(15000)
  })

  it('should use startTime of last observation when endTime is null', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:00.000Z',
        endTime: null,
        output: 'first',
      }),
      makeObs({
        id: 'gen-2', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:05.000Z',
        endTime: null,
        output: 'last',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.stats.durationMs).toBe(5000)
  })

  it('should handle a realistic multi-turn conversation trace', () => {
    const obs: RawObservation[] = [
      // Context span
      makeObs({
        id: 'span-ctx', type: 'span', name: 'context',
        startTime: '2026-02-19T10:00:00.000Z',
        input: { nodeTitle: 'Implement feature X', visionDoc: 'Build a fast app' },
      }),
      // Lifecycle event
      makeObs({
        id: 'ev-start', type: 'event', name: 'task:started',
        startTime: '2026-02-19T10:00:00.100Z',
      }),
      // Turn 1: text + read
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:01.000Z',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 2000,
        outputTokens: 150,
        estimatedCostUsd: 0.003,
        output: { text: 'Let me read the codebase first.' },
      }),
      makeObs({
        id: 'tool-read', type: 'tool', name: 'Read',
        parentObservationId: 'gen-1',
        startTime: '2026-02-19T10:00:02.000Z',
        endTime: '2026-02-19T10:00:02.050Z',
        input: { path: '/src/main.ts' },
        output: 'export function main() { ... }',
      }),
      makeObs({
        id: 'tool-glob', type: 'tool', name: 'Glob',
        parentObservationId: 'gen-1',
        startTime: '2026-02-19T10:00:02.100Z',
        endTime: '2026-02-19T10:00:02.150Z',
        input: { pattern: '**/*.ts' },
        output: ['src/main.ts', 'src/utils.ts'],
      }),
      // Turn 2: text + edit + bash
      makeObs({
        id: 'gen-2', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:03.000Z',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 3000,
        outputTokens: 400,
        estimatedCostUsd: 0.007,
        output: { text: 'I\'ll implement the feature now.' },
      }),
      makeObs({
        id: 'tool-edit', type: 'tool', name: 'Edit',
        parentObservationId: 'gen-2',
        startTime: '2026-02-19T10:00:04.000Z',
        endTime: '2026-02-19T10:00:04.100Z',
        input: { path: '/src/main.ts', old: 'a', new: 'b' },
        output: 'edited',
      }),
      makeObs({
        id: 'tool-bash', type: 'tool', name: 'Bash',
        parentObservationId: 'gen-2',
        startTime: '2026-02-19T10:00:05.000Z',
        endTime: '2026-02-19T10:00:08.000Z',
        input: { command: 'npm test' },
        output: 'All tests passed',
      }),
      // Turn 3: summary
      makeObs({
        id: 'gen-3', type: 'generation', name: 'generation',
        startTime: '2026-02-19T10:00:09.000Z',
        endTime: '2026-02-19T10:00:10.000Z',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 3500,
        outputTokens: 200,
        estimatedCostUsd: 0.005,
        output: { text: 'Feature implemented and all tests pass.' },
      }),
      // Lifecycle end event
      makeObs({
        id: 'ev-done', type: 'event', name: 'task:completed',
        startTime: '2026-02-19T10:00:10.500Z',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)

    // Context
    expect(tree.contextSpan).not.toBeNull()
    expect(tree.contextSpan!.id).toBe('span-ctx')

    // Events
    expect(tree.events).toHaveLength(2)
    expect(tree.events.map(e => e.name)).toEqual(['task:started', 'task:completed'])

    // Turns
    expect(tree.turns).toHaveLength(3)

    // Turn 1
    expect(tree.turns[0].text).toBe('Let me read the codebase first.')
    expect(tree.turns[0].toolCalls).toHaveLength(2)
    expect(tree.turns[0].toolCalls[0].name).toBe('Read')
    expect(tree.turns[0].toolCalls[0].durationMs).toBe(50)
    expect(tree.turns[0].toolCalls[1].name).toBe('Glob')
    expect(tree.turns[0].toolCalls[1].durationMs).toBe(50)
    expect(tree.turns[0].inputTokens).toBe(2000)
    expect(tree.turns[0].outputTokens).toBe(150)

    // Turn 2
    expect(tree.turns[1].text).toBe("I'll implement the feature now.")
    expect(tree.turns[1].toolCalls).toHaveLength(2)
    expect(tree.turns[1].toolCalls[0].name).toBe('Edit')
    expect(tree.turns[1].toolCalls[1].name).toBe('Bash')
    expect(tree.turns[1].toolCalls[1].durationMs).toBe(3000)

    // Turn 3
    expect(tree.turns[2].text).toBe('Feature implemented and all tests pass.')
    expect(tree.turns[2].toolCalls).toHaveLength(0)

    // Stats
    expect(tree.stats.totalTurns).toBe(3)
    expect(tree.stats.totalToolCalls).toBe(4) // Read + Glob + Edit + Bash
    expect(tree.stats.totalTokens).toBe(2000 + 150 + 3000 + 400 + 3500 + 200) // 9250
    expect(tree.stats.totalCost).toBeCloseTo(0.015, 4)
    expect(tree.stats.model).toBe('claude-sonnet-4-5-20250929')
    // Duration: from first obs (10:00:00) to last obs endTime (10:00:10.5 start of ev-done)
    expect(tree.stats.durationMs).toBe(10500)
  })

  it('should handle orphaned tools (no parent) gracefully', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        output: { text: 'test' },
      }),
      makeObs({
        id: 'tool-orphan', type: 'tool', name: 'Bash',
        parentObservationId: 'gen-nonexistent', // parent doesn't exist
        input: { command: 'ls' },
        output: 'ok',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].toolCalls).toHaveLength(0) // orphan not associated
    expect(tree.stats.totalToolCalls).toBe(0)
  })

  it('should handle tools with null parentObservationId', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        output: { text: 'test' },
      }),
      makeObs({
        id: 'tool-1', type: 'tool', name: 'Bash',
        parentObservationId: null,
        input: { command: 'ls' },
        output: 'ok',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].toolCalls).toHaveLength(0)
  })

  it('should propagate model and token info per turn', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        model: 'claude-opus-4-6',
        inputTokens: 5000,
        outputTokens: 1000,
        output: 'test',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].model).toBe('claude-opus-4-6')
    expect(tree.turns[0].inputTokens).toBe(5000)
    expect(tree.turns[0].outputTokens).toBe(1000)
  })

  it('should handle generations with null tokens', () => {
    const obs: RawObservation[] = [
      makeObs({
        id: 'gen-1', type: 'generation', name: 'generation',
        model: null,
        inputTokens: null,
        outputTokens: null,
        output: 'test',
      }),
    ]

    const tree = buildTraceTree('trace-1', obs)
    expect(tree.turns[0].model).toBeNull()
    expect(tree.turns[0].inputTokens).toBeNull()
    expect(tree.turns[0].outputTokens).toBeNull()
    expect(tree.stats.totalTokens).toBe(0)
  })
})
