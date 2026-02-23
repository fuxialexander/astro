/**
 * Smoke Test: Trace Viewer Pipeline (unit-level integration)
 *
 * Tests the full observation collector → buildTraceTree pipeline
 * WITHOUT requiring a running server or database.
 *
 * The collector flushes its buffer to DB on task.completed (which drains
 * state.buffer via splice(0)), so we intercept the mocked db.insert to
 * capture flushed observations. This mirrors the real flow: observations
 * get written to Postgres, then the API returns them, and the frontend
 * calls buildTraceTree() on the result.
 *
 * Run with: npx vitest run tests/smoke-trace-viewer.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildTraceTree } from '../src/stores/observation-store'
import type { RawObservation } from '../src/types/observations'

// Capture all rows that get flushed to DB
const flushedRows: Array<Record<string, unknown>>[] = []

vi.mock('../server/lib/db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((rows: Array<Record<string, unknown>>) => {
        flushedRows.push(rows)
        return Promise.resolve(undefined)
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}))

vi.mock('../server/lib/observability/safety-rails.js', () => ({
  safetyRails: {
    isToolAllowed: vi.fn().mockReturnValue(true),
    trackCost: vi.fn(),
    resetExecution: vi.fn(),
  },
}))

import { ObservationCollector } from '../server/lib/observability/observation-collector.js'
import { executionEventBus } from '../server/lib/execution-event-bus.js'
import type { TaskStartedEvent, TaskCompletedEvent } from '../server/lib/events/types.js'
import type { PlanNode } from '../src/types/index.js'
import type { TaskResult } from '../server/lib/providers/types.js'

const makeMockNode = (overrides?: Partial<PlanNode>): PlanNode => ({
  id: 'node-smoke',
  title: 'Smoke Test Task',
  description: 'List files and read one',
  status: 'in_progress',
  type: 'task',
  position: { x: 0, y: 0 },
  ...overrides,
})

function createTaskStartedEvent(execId: string, overrides?: Partial<TaskStartedEvent>): TaskStartedEvent {
  return {
    type: 'task.started',
    taskId: execId,
    nodeId: 'node-smoke',
    projectId: 'proj-smoke',
    executionId: execId,
    timestamp: new Date(),
    node: makeMockNode(),
    ...overrides,
  }
}

function createTaskCompletedEvent(execId: string): TaskCompletedEvent {
  const result: TaskResult = {
    taskId: execId,
    status: 'success',
    metrics: {
      durationMs: 12000,
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 8500,
      outputTokens: 1200,
      estimatedCostUsd: 0.025,
    },
    providerId: 'claude-code',
    completedAt: new Date(),
  }
  return {
    type: 'task.completed',
    taskId: execId,
    nodeId: 'node-smoke',
    projectId: 'proj-smoke',
    executionId: execId,
    result,
    node: makeMockNode(),
    timestamp: new Date(),
  }
}

/** Convert a flushed DB row to a RawObservation (API response shape) */
function toRawObservation(row: Record<string, unknown>): RawObservation {
  return {
    id: row.id as string,
    traceId: row.traceId as string,
    parentObservationId: (row.parentObservationId as string) || null,
    type: row.type as RawObservation['type'],
    name: row.name as string,
    startTime: row.startTime instanceof Date
      ? (row.startTime as Date).toISOString()
      : row.startTime as string,
    endTime: row.endTime instanceof Date
      ? (row.endTime as Date).toISOString()
      : (row.endTime as string) || null,
    input: row.input as unknown,
    output: row.output as unknown,
    model: (row.model as string) || null,
    inputTokens: (row.inputTokens as number) || null,
    outputTokens: (row.outputTokens as number) || null,
    estimatedCostUsd: (row.estimatedCostUsd as number) || null,
    level: (row.level as RawObservation['level']) || 'default',
    metadata: (row.metadata as Record<string, unknown>) || null,
    projectId: (row.projectId as string) || 'proj-smoke',
    nodeId: (row.nodeId as string) || null,
    statusMessage: (row.statusMessage as string) || null,
  }
}

/** Wait for the async finishTrace to complete */
async function tick(ms = 50): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/** Collect all flushed rows for a given traceId */
function collectFlushedObservations(traceId: string): RawObservation[] {
  const all = flushedRows.flat().filter((r) => r.traceId === traceId)
  return all.map(toRawObservation)
}

describe('Trace Viewer Pipeline Smoke Test', () => {
  let collector: ObservationCollector

  beforeEach(() => {
    flushedRows.length = 0
    collector = new ObservationCollector()
    collector.start()
  })

  afterEach(async () => {
    await collector.stop()
  })

  it('should produce a correct TraceTree from a realistic Claude Code execution', async () => {
    const execId = 'exec-smoke-' + Date.now()

    // 1. Lifecycle: task.started
    collector.handleLifecycleEvent(createTaskStartedEvent(execId, {
      node: makeMockNode({ title: 'Smoke Test', description: 'List files and read one' }),
      visionDoc: 'Build a fast and reliable system',
    }))

    // 2. session_init
    executionEventBus.emit('task:session_init', {
      taskId: execId, sessionId: 'sess-smoke-1', model: 'claude-sonnet-4-5-20250929',
    })

    // 3. Turn 1: text → Bash → Read
    executionEventBus.emit('task:stdout', {
      output: { taskId: execId, data: 'Let me list the files and read the main entry point.', stream: 'stdout', timestamp: new Date() },
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Bash',
      toolInput: { command: 'ls -la' }, toolUseId: 'toolu_bash_001',
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Bash',
      toolResult: 'total 42\n-rw-r--r-- main.ts\n-rw-r--r-- utils.ts',
      success: true, toolUseId: 'toolu_bash_001',
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Read',
      toolInput: { path: '/src/main.ts' }, toolUseId: 'toolu_read_001',
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Read',
      toolResult: 'export function main() { console.log("hello") }',
      success: true, toolUseId: 'toolu_read_001',
    })

    // 4. Turn 2: text → Edit → Bash (error)
    executionEventBus.emit('task:stdout', {
      output: { taskId: execId, data: "I'll add a feature flag and run tests.", stream: 'stdout', timestamp: new Date() },
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Edit',
      toolInput: { path: '/src/main.ts', old: '"hello"', new: '"hello world"' },
      toolUseId: 'toolu_edit_001',
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Edit',
      toolResult: 'File edited successfully', success: true, toolUseId: 'toolu_edit_001',
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Bash',
      toolInput: { command: 'npm test' }, toolUseId: 'toolu_bash_002',
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Bash',
      toolResult: 'Error: test "greeting" failed', success: false, toolUseId: 'toolu_bash_002',
    })

    // 5. Turn 3: summary text (no tools)
    executionEventBus.emit('task:stdout', {
      output: { taskId: execId, data: 'The edit was applied but tests failed.', stream: 'stdout', timestamp: new Date() },
    })

    // 6. Complete (triggers async finishTrace → flush → delete)
    collector.handleLifecycleEvent(createTaskCompletedEvent(execId))
    await tick(100) // wait for finishTrace async

    // ── Collect flushed observations ──────────────────────────────
    const rawObs = collectFlushedObservations(execId)
    expect(rawObs.length).toBeGreaterThan(0)

    // ── Build TraceTree (what the frontend does) ──────────────────
    const tree = buildTraceTree(execId, rawObs)

    // Context span
    expect(tree.contextSpan).not.toBeNull()
    expect(tree.contextSpan!.name).toBe('context')

    // Events (task:started, task:completed)
    expect(tree.events.length).toBeGreaterThanOrEqual(2)

    // Turns
    expect(tree.turns.length).toBeGreaterThanOrEqual(2)

    // Tool correlation: names must be real, not toolu_ IDs
    const allToolCalls = tree.turns.flatMap((t) => t.toolCalls)
    const toolNames = allToolCalls.map((tc) => tc.name)
    const uniqueNames = [...new Set(toolNames)]

    for (const name of toolNames) {
      expect(name).not.toMatch(/^toolu_/)
    }
    for (const name of uniqueNames) {
      expect(['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'unknown']).toContain(name)
    }

    // At least one failed tool
    const failedTools = allToolCalls.filter((tc) => !tc.success)
    expect(failedTools.length).toBeGreaterThanOrEqual(1)

    // Stats
    expect(tree.stats.totalTurns).toBeGreaterThanOrEqual(2)
    expect(tree.stats.totalToolCalls).toBeGreaterThanOrEqual(2)
    expect(tree.stats.model).toBe('claude-sonnet-4-5-20250929')

    console.log('\n  Pipeline smoke test results:')
    console.log(`    Total observations flushed: ${rawObs.length}`)
    console.log(`    Turns: ${tree.stats.totalTurns}`)
    console.log(`    Tool calls: ${tree.stats.totalToolCalls}`)
    console.log(`    Tool names: ${uniqueNames.join(', ')}`)
    console.log(`    Failed tools: ${failedTools.length}`)
    console.log(`    Model: ${tree.stats.model}`)
    console.log(`    Events: ${tree.events.length}`)
  })

  it('should correctly correlate tools by toolUseId across same-name tools', async () => {
    const execId = 'exec-correlate-' + Date.now()

    collector.handleLifecycleEvent(createTaskStartedEvent(execId))
    executionEventBus.emit('task:session_init', {
      taskId: execId, sessionId: 'sess-c1', model: 'claude-sonnet-4-5-20250929',
    })

    executionEventBus.emit('task:stdout', {
      output: { taskId: execId, data: 'Reading multiple files.', stream: 'stdout', timestamp: new Date() },
    })

    // Three Read calls with different toolUseIds
    const readIds = ['toolu_read_a', 'toolu_read_b', 'toolu_read_c']
    const readPaths = ['/a.ts', '/b.ts', '/c.ts']
    const readResults = ['contents-a', 'contents-b', 'contents-c']

    for (let i = 0; i < 3; i++) {
      executionEventBus.emit('task:tool_trace', {
        taskId: execId, toolName: 'Read',
        toolInput: { path: readPaths[i] }, toolUseId: readIds[i],
      })
    }

    // Results in REVERSE order (tests out-of-order correlation)
    for (let i = 2; i >= 0; i--) {
      executionEventBus.emit('task:tool_trace', {
        taskId: execId, toolName: 'Read',
        toolResult: readResults[i], success: true, toolUseId: readIds[i],
      })
    }

    collector.handleLifecycleEvent(createTaskCompletedEvent(execId))
    await tick(100)

    const rawObs = collectFlushedObservations(execId)
    const toolObs = rawObs.filter((o) => o.type === 'tool')
    expect(toolObs.length).toBe(3)

    // All names should be 'tool:Read' (collector prefixes with 'tool:'), not toolu_ IDs
    for (const obs of toolObs) {
      expect(obs.name).toBe('tool:Read')
    }

    // Each should have unique toolUseId in metadata
    const toolUseIdsInMeta = toolObs.map((o) => o.metadata?.toolUseId)
    expect(new Set(toolUseIdsInMeta).size).toBe(3)

    // Each should have both input and output (correlation worked)
    for (const obs of toolObs) {
      expect(obs.input).toBeDefined()
      expect(obs.output).toBeDefined()
    }

    // Verify specific correlations
    for (let i = 0; i < 3; i++) {
      const matched = toolObs.find((o) => o.metadata?.toolUseId === readIds[i])
      expect(matched).toBeDefined()
      expect((matched!.input as Record<string, unknown>)?.path).toBe(readPaths[i])
      expect(matched!.output).toBe(readResults[i])
    }

    console.log('\n  Correlation test results:')
    console.log('    3 same-name tools (Read) with different toolUseIds correlated correctly')
    console.log('    Out-of-order tool_result delivery handled correctly')
  })

  it('should not have toolu_ IDs as tool names (bug fix verification)', async () => {
    const execId = 'exec-bugfix-' + Date.now()

    collector.handleLifecycleEvent(createTaskStartedEvent(execId))
    executionEventBus.emit('task:session_init', {
      taskId: execId, sessionId: 'sess-bf', model: 'claude-sonnet-4-5-20250929',
    })

    executionEventBus.emit('task:stdout', {
      output: { taskId: execId, data: 'Testing.', stream: 'stdout', timestamp: new Date() },
    })

    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Bash',
      toolInput: { command: 'echo hello' }, toolUseId: 'toolu_01H5Kx7mRYpJV4n8K3Z6bQ',
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Bash',
      toolResult: 'hello', success: true, toolUseId: 'toolu_01H5Kx7mRYpJV4n8K3Z6bQ',
    })

    collector.handleLifecycleEvent(createTaskCompletedEvent(execId))
    await tick(100)

    const rawObs = collectFlushedObservations(execId)
    const toolObs = rawObs.filter((o) => o.type === 'tool')

    expect(toolObs.length).toBe(1)
    // Collector stores as 'tool:Bash', buildTraceTree strips to 'Bash'
    expect(toolObs[0].name).toBe('tool:Bash')
    expect(toolObs[0].name).not.toMatch(/^toolu_/)

    // Build tree and verify the full pipeline
    const tree = buildTraceTree(execId, rawObs)
    const allToolNames = tree.turns.flatMap((t) => t.toolCalls.map((tc) => tc.name))
    for (const name of allToolNames) {
      expect(name).not.toMatch(/^toolu_/)
    }

    console.log('\n  Bug fix verification:')
    console.log(`    Raw obs name is "${toolObs[0].name}", tree strips to "Bash" (not a toolu_ ID)`)
  })

  it('should produce a TraceTree that satisfies all UI component contracts', async () => {
    const execId = 'exec-ui-' + Date.now()

    collector.handleLifecycleEvent(createTaskStartedEvent(execId, {
      visionDoc: 'Test vision doc',
    }))
    executionEventBus.emit('task:session_init', {
      taskId: execId, sessionId: 'sess-ui', model: 'claude-sonnet-4-5-20250929',
    })

    executionEventBus.emit('task:stdout', {
      output: { taskId: execId, data: 'Here are the files in the directory.', stream: 'stdout', timestamp: new Date() },
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Bash',
      toolInput: { command: 'ls' }, toolUseId: 'toolu_ls1',
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Bash',
      toolResult: 'main.ts  utils.ts  package.json', success: true, toolUseId: 'toolu_ls1',
    })

    collector.handleLifecycleEvent(createTaskCompletedEvent(execId))
    await tick(100)

    const rawObs = collectFlushedObservations(execId)
    const tree = buildTraceTree(execId, rawObs)

    // TraceSummaryCard contract
    expect(tree.stats).toBeDefined()
    expect(typeof tree.stats.totalTurns).toBe('number')
    expect(typeof tree.stats.totalToolCalls).toBe('number')
    expect(typeof tree.stats.totalTokens).toBe('number')
    expect(typeof tree.stats.totalCost).toBe('number')

    // TurnList contract
    expect(tree.turns.length).toBeGreaterThanOrEqual(1)
    const turn = tree.turns[0]
    expect(typeof turn.turnIndex).toBe('number')
    expect(typeof turn.text).toBe('string')
    expect(Array.isArray(turn.toolCalls)).toBe(true)

    // TurnDetail contract
    expect(turn.generation).toBeDefined()
    expect(turn.generation.id).toBeDefined()

    // ToolCallItem contract
    if (turn.toolCalls.length > 0) {
      const tc = turn.toolCalls[0]
      expect(typeof tc.name).toBe('string')
      expect(tc.toolObs).toBeDefined()
      expect(typeof tc.success).toBe('boolean')
      expect(tc.durationMs === null || typeof tc.durationMs === 'number').toBe(true)
    }

    // FlatEventItem fallback
    expect(Array.isArray(tree.events)).toBe(true)

    console.log('\n  UI contract verification:')
    console.log(`    TraceTree structure valid for all 6 UI components`)
    console.log(`    ${tree.turns.length} turns, ${tree.stats.totalToolCalls} tools, ${tree.events.length} events`)
  })

  it('should aggregate token counts and cost from task:completed event observations', async () => {
    const execId = 'exec-tokens-' + Date.now()

    collector.handleLifecycleEvent(createTaskStartedEvent(execId))
    executionEventBus.emit('task:session_init', {
      taskId: execId, sessionId: 'sess-tok', model: 'claude-sonnet-4-5-20250929',
    })

    // One turn with text + tool
    executionEventBus.emit('task:stdout', {
      output: { taskId: execId, data: 'Working on it.', stream: 'stdout', timestamp: new Date() },
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Bash',
      toolInput: { command: 'echo hi' }, toolUseId: 'toolu_tok_1',
    })
    executionEventBus.emit('task:tool_trace', {
      taskId: execId, toolName: 'Bash',
      toolResult: 'hi', success: true, toolUseId: 'toolu_tok_1',
    })

    // Complete with metrics containing token data
    collector.handleLifecycleEvent(createTaskCompletedEvent(execId))
    await tick(100)

    const rawObs = collectFlushedObservations(execId)
    const tree = buildTraceTree(execId, rawObs)

    // Token counts should come from the task:completed event observation,
    // NOT from individual generation observations (which don't have token data).
    // createTaskCompletedEvent sets inputTokens=8500, outputTokens=1200, estimatedCostUsd=0.025
    expect(tree.stats.totalTokens).toBe(8500 + 1200)
    expect(tree.stats.totalCost).toBeCloseTo(0.025)

    console.log('\n  Token aggregation test:')
    console.log(`    totalTokens: ${tree.stats.totalTokens} (expected ${8500 + 1200})`)
    console.log(`    totalCost: ${tree.stats.totalCost} (expected 0.025)`)
  })
})
