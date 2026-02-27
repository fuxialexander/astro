/**
 * Unit tests for observation-activity-bridge.ts
 *
 * Tests the reconstructActivityFromTrace() function that converts
 * observation TraceTree data into TaskActivityEvent[], ToolTrace[],
 * and FileChange[] arrays for the activity view after page refresh.
 *
 * Run with: npx vitest run tests/observation-activity-bridge.test.ts
 */

import { describe, it, expect } from 'vitest'
import { reconstructActivityFromTrace } from '../src/lib/observation-activity-bridge'
import type { TraceTree, RawObservation, GenerationTurn, ToolCallWithResult } from '../src/types/observations'

// ─── Helpers ──────────────────────────────────────────────────────────

function makeObs(overrides: Partial<RawObservation> = {}): RawObservation {
  return {
    id: overrides.id || `obs-${Math.random().toString(36).slice(2)}`,
    traceId: 'trace-1',
    parentObservationId: null,
    type: 'span',
    name: 'test',
    startTime: overrides.startTime || '2025-01-01T00:00:00Z',
    endTime: overrides.endTime || '2025-01-01T00:00:01Z',
    input: overrides.input ?? null,
    output: overrides.output ?? null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    level: 'default',
    metadata: overrides.metadata || null,
    projectId: 'proj-1',
    nodeId: null,
    statusMessage: null,
    ...overrides,
  }
}

function makeToolCall(name: string, input: unknown, output: unknown, opts?: {
  success?: boolean
  durationMs?: number | null
  startTime?: string
  endTime?: string
}): ToolCallWithResult {
  return {
    toolObs: makeObs({
      id: `tool-${name}-${Math.random().toString(36).slice(2)}`,
      type: 'tool',
      name,
      startTime: opts?.startTime || '2025-01-01T00:00:02Z',
      endTime: opts?.endTime || '2025-01-01T00:00:03Z',
    }),
    name,
    input,
    output,
    success: opts?.success ?? true,
    durationMs: opts?.durationMs ?? 1000,
  }
}

function makeTurn(opts: {
  text?: string
  toolCalls?: ToolCallWithResult[]
  turnIndex?: number
  startTime?: string
}): GenerationTurn {
  return {
    generation: makeObs({
      type: 'generation',
      name: 'generation',
      startTime: opts.startTime || '2025-01-01T00:00:00Z',
    }),
    turnIndex: opts.turnIndex || 0,
    text: opts.text || '',
    toolCalls: opts.toolCalls || [],
    model: 'claude-3-opus',
    inputTokens: 100,
    outputTokens: 50,
  }
}

function makeTrace(opts: {
  turns?: GenerationTurn[]
  events?: RawObservation[]
}): TraceTree {
  return {
    traceId: 'trace-1',
    contextSpan: null,
    turns: opts.turns || [],
    events: opts.events || [],
    stats: {
      totalTurns: opts.turns?.length || 0,
      totalToolCalls: 0,
      totalTokens: 0,
      totalCost: 0,
      model: null,
      durationMs: null,
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('reconstructActivityFromTrace', () => {
  it('returns empty arrays for empty trace', () => {
    const result = reconstructActivityFromTrace(makeTrace({}))
    expect(result.activityEvents).toEqual([])
    expect(result.toolTraces).toEqual([])
    expect(result.fileChanges).toEqual([])
  })

  it('converts text output from generation turns', () => {
    const trace = makeTrace({
      turns: [
        makeTurn({ text: 'Hello, I will help you.' }),
        makeTurn({ text: 'Here is the plan.', startTime: '2025-01-01T00:01:00Z' }),
      ],
    })

    const result = reconstructActivityFromTrace(trace)
    const textEvents = result.activityEvents.filter(e => e.type === 'text')
    expect(textEvents).toHaveLength(2)
    expect(textEvents[0].content).toBe('Hello, I will help you.')
    expect(textEvents[1].content).toBe('Here is the plan.')
  })

  it('skips empty text in turns', () => {
    const trace = makeTrace({
      turns: [
        makeTurn({ text: '' }),
        makeTurn({ text: 'Some output' }),
      ],
    })

    const result = reconstructActivityFromTrace(trace)
    const textEvents = result.activityEvents.filter(e => e.type === 'text')
    expect(textEvents).toHaveLength(1)
    expect(textEvents[0].content).toBe('Some output')
  })

  it('converts tool calls to tool_use + tool_result events', () => {
    const tc = makeToolCall('Bash', { command: 'ls' }, 'file1\nfile2', {
      success: true,
      durationMs: 500,
    })
    const trace = makeTrace({
      turns: [makeTurn({ toolCalls: [tc] })],
    })

    const result = reconstructActivityFromTrace(trace)

    // Should have tool_use and tool_result events
    const toolUseEvents = result.activityEvents.filter(e => e.type === 'tool_use')
    const toolResultEvents = result.activityEvents.filter(e => e.type === 'tool_result')
    expect(toolUseEvents).toHaveLength(1)
    expect(toolResultEvents).toHaveLength(1)

    expect(toolUseEvents[0].toolName).toBe('Bash')
    expect(toolUseEvents[0].toolInput).toEqual({ command: 'ls' })
    expect(toolResultEvents[0].toolName).toBe('Bash')
    expect(toolResultEvents[0].toolResult).toBe('file1\nfile2')
    expect(toolResultEvents[0].success).toBe(true)
    expect(toolResultEvents[0].duration).toBe(500)

    // IDs should match (paired)
    expect(toolUseEvents[0].id).toBe(toolResultEvents[0].id)
  })

  it('generates ToolTrace entries', () => {
    const tc = makeToolCall('Read', { file_path: '/foo.ts' }, 'contents', {
      success: true,
      durationMs: 200,
    })
    const trace = makeTrace({
      turns: [makeTurn({ toolCalls: [tc] })],
    })

    const result = reconstructActivityFromTrace(trace)
    expect(result.toolTraces).toHaveLength(1)
    expect(result.toolTraces[0].toolName).toBe('Read')
    expect(result.toolTraces[0].toolInput).toEqual({ file_path: '/foo.ts' })
    expect(result.toolTraces[0].success).toBe(true)
  })

  it('extracts file changes from events', () => {
    const trace = makeTrace({
      events: [
        makeObs({
          type: 'event',
          name: 'file:change',
          metadata: {
            path: '/src/app.tsx',
            action: 'modify',
            linesAdded: 5,
            linesRemoved: 2,
          },
          startTime: '2025-01-01T00:00:10Z',
        }),
      ],
    })

    const result = reconstructActivityFromTrace(trace)
    expect(result.fileChanges).toHaveLength(1)
    expect(result.fileChanges[0].path).toBe('/src/app.tsx')
    expect(result.fileChanges[0].action).toBe('modify')
    expect(result.fileChanges[0].linesAdded).toBe(5)
    expect(result.fileChanges[0].linesRemoved).toBe(2)

    // Should also have a file_change activity event
    const fcEvents = result.activityEvents.filter(e => e.type === 'file_change')
    expect(fcEvents).toHaveLength(1)
    expect(fcEvents[0].path).toBe('/src/app.tsx')
  })

  it('extracts file changes from tool calls (Write/Edit fallback)', () => {
    const writeCall = makeToolCall('Write', { file_path: '/new-file.ts' }, 'ok')
    const editCall = makeToolCall('Edit', { file_path: '/existing.ts' }, 'ok')
    const trace = makeTrace({
      turns: [makeTurn({ toolCalls: [writeCall, editCall] })],
    })

    const result = reconstructActivityFromTrace(trace)
    expect(result.fileChanges).toHaveLength(2)
    expect(result.fileChanges[0].path).toBe('/new-file.ts')
    expect(result.fileChanges[0].action).toBe('create')
    expect(result.fileChanges[1].path).toBe('/existing.ts')
    expect(result.fileChanges[1].action).toBe('modify')
  })

  it('deduplicates file changes (explicit event + Write/Edit tool)', () => {
    const writeCall = makeToolCall('Write', { file_path: '/src/app.tsx' }, 'ok')
    const trace = makeTrace({
      turns: [makeTurn({ toolCalls: [writeCall] })],
      events: [
        makeObs({
          type: 'event',
          name: 'file:change',
          metadata: { path: '/src/app.tsx', action: 'create' },
        }),
      ],
    })

    const result = reconstructActivityFromTrace(trace)
    // Should only have 1 file change (event takes priority, Write fallback dedupes)
    expect(result.fileChanges).toHaveLength(1)
    expect(result.fileChanges[0].path).toBe('/src/app.tsx')
  })

  it('sorts all events chronologically', () => {
    const earlyTool = makeToolCall('Bash', { command: 'echo hi' }, 'hi', {
      startTime: '2025-01-01T00:00:01Z',
      endTime: '2025-01-01T00:00:02Z',
    })
    const lateTool = makeToolCall('Read', { file_path: '/a' }, 'x', {
      startTime: '2025-01-01T00:00:05Z',
      endTime: '2025-01-01T00:00:06Z',
    })
    const trace = makeTrace({
      turns: [
        makeTurn({ text: 'First', startTime: '2025-01-01T00:00:00Z', toolCalls: [earlyTool] }),
        makeTurn({ text: 'Second', startTime: '2025-01-01T00:00:04Z', toolCalls: [lateTool] }),
      ],
    })

    const result = reconstructActivityFromTrace(trace)
    // Verify chronological order
    for (let i = 1; i < result.activityEvents.length; i++) {
      const prev = new Date(result.activityEvents[i - 1].timestamp).getTime()
      const curr = new Date(result.activityEvents[i].timestamp).getTime()
      expect(curr).toBeGreaterThanOrEqual(prev)
    }
  })

  it('handles multiple tool calls in a single turn', () => {
    const tc1 = makeToolCall('Bash', { command: 'ls' }, 'files')
    const tc2 = makeToolCall('Read', { file_path: '/a.ts' }, 'content')
    const tc3 = makeToolCall('Edit', { file_path: '/a.ts' }, 'ok')
    const trace = makeTrace({
      turns: [makeTurn({ toolCalls: [tc1, tc2, tc3] })],
    })

    const result = reconstructActivityFromTrace(trace)
    expect(result.toolTraces).toHaveLength(3)
    // 3 tool_use + 3 tool_result + file_change from Edit
    const toolUseEvents = result.activityEvents.filter(e => e.type === 'tool_use')
    const toolResultEvents = result.activityEvents.filter(e => e.type === 'tool_result')
    expect(toolUseEvents).toHaveLength(3)
    expect(toolResultEvents).toHaveLength(3)
  })

  it('handles failed tool calls', () => {
    const tc = makeToolCall('Bash', { command: 'bad' }, 'error: command not found', {
      success: false,
      durationMs: 100,
    })
    const trace = makeTrace({
      turns: [makeTurn({ toolCalls: [tc] })],
    })

    const result = reconstructActivityFromTrace(trace)
    const toolResult = result.activityEvents.find(e => e.type === 'tool_result')
    expect(toolResult).toBeDefined()
    expect(toolResult!.success).toBe(false)
    expect(result.toolTraces[0].success).toBe(false)
  })
})
