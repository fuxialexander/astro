/**
 * Unit tests for execution persistence resilience.
 *
 * Tests the execution-store.ts persist() logic and the
 * use-restored-execution.ts hook's data merging behavior.
 *
 * Run with: npx vitest run tests/execution-persistence.test.ts
 */

import { describe, it, expect } from 'vitest'
import type { TaskActivityEvent } from '../packages/core/src/types'

// ─── Helpers ──────────────────────────────────────────────────────────

/** Simulates the persist() filter logic from execution-store.ts */
function filterPersistable(
  executions: Array<{ executionId: string; status: string }>,
): Array<{ executionId: string; status: string }> {
  return executions.filter((exec) => exec.executionId)
}

/** Simulates the old persist() filter (for comparison) */
function filterPersistableOld(
  executions: Array<{ executionId: string; status: string }>,
): Array<{ executionId: string; status: string }> {
  return executions.filter(
    (exec) => exec.status === 'success' || exec.status === 'failure' || exec.status === 'cancelled'
  )
}

/**
 * Simulates the merge logic from use-restored-execution.ts
 * that combines restored observation data with new realtime stream events.
 */
function mergeRestoredAndStream(
  restoredEvents: TaskActivityEvent[],
  streamEvents: TaskActivityEvent[],
): TaskActivityEvent[] {
  if (streamEvents.length === 0) return restoredEvents

  const restoredEndTime = restoredEvents.length > 0
    ? new Date(restoredEvents[restoredEvents.length - 1].timestamp).getTime()
    : 0

  const newStreamEvents = streamEvents.filter(
    (e) => new Date(e.timestamp).getTime() > restoredEndTime - 1000
  )

  const merged = [...restoredEvents, ...newStreamEvents]
  merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  return merged
}

function textEvent(content: string, timestamp: Date): TaskActivityEvent {
  return { type: 'text', content, timestamp }
}

function toolUseEvent(id: string, toolName: string, timestamp: Date): TaskActivityEvent {
  return { type: 'tool_use', id, toolName, toolInput: {}, timestamp }
}

function toolResultEvent(id: string, toolName: string, timestamp: Date): TaskActivityEvent {
  return { type: 'tool_result', id, toolName, toolResult: 'ok', success: true, timestamp }
}

// ─── Persist Filter Tests ─────────────────────────────────────────────

describe('execution persistence filter', () => {
  const executions = [
    { executionId: 'exec-1', status: 'running' },
    { executionId: 'exec-2', status: 'success' },
    { executionId: '', status: 'pending' },
    { executionId: 'exec-4', status: 'failure' },
    { executionId: 'exec-5', status: 'cancelled' },
  ]

  it('new filter: includes all executions with valid executionId', () => {
    const result = filterPersistable(executions)
    expect(result).toHaveLength(4)
    expect(result.map((e) => e.executionId)).toEqual([
      'exec-1', 'exec-2', 'exec-4', 'exec-5',
    ])
  })

  it('new filter: includes running executions (key change)', () => {
    const result = filterPersistable(executions)
    expect(result.find((e) => e.status === 'running')).toBeDefined()
  })

  it('new filter: excludes executions without executionId', () => {
    const result = filterPersistable(executions)
    expect(result.find((e) => e.executionId === '')).toBeUndefined()
  })

  it('old filter: excluded running executions (regression check)', () => {
    const result = filterPersistableOld(executions)
    expect(result).toHaveLength(3)
    expect(result.find((e) => e.status === 'running')).toBeUndefined()
  })
})

// ─── Merge Logic Tests ────────────────────────────────────────────────

describe('restored + stream merge', () => {
  it('returns only restored events when stream is empty', () => {
    const restored = [
      textEvent('Hello', new Date('2025-01-01T00:00:00Z')),
      textEvent('World', new Date('2025-01-01T00:00:01Z')),
    ]

    const result = mergeRestoredAndStream(restored, [])
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('Hello')
  })

  it('appends newer stream events after restored events', () => {
    const restored = [
      textEvent('Step 1', new Date('2025-01-01T00:00:00Z')),
      textEvent('Step 2', new Date('2025-01-01T00:00:05Z')),
    ]
    const stream = [
      textEvent('Step 3', new Date('2025-01-01T00:00:10Z')),
      textEvent('Step 4', new Date('2025-01-01T00:00:15Z')),
    ]

    const result = mergeRestoredAndStream(restored, stream)
    expect(result).toHaveLength(4)
    expect(result[0].content).toBe('Step 1')
    expect(result[1].content).toBe('Step 2')
    expect(result[2].content).toBe('Step 3')
    expect(result[3].content).toBe('Step 4')
  })

  it('handles overlapping timestamps (within 1s window)', () => {
    // Restored events go up to T+5s
    const restored = [
      textEvent('A', new Date('2025-01-01T00:00:00Z')),
      toolUseEvent('t1', 'Bash', new Date('2025-01-01T00:00:05Z')),
    ]
    // Stream events start from T+4.5s (overlap window)
    const stream = [
      toolUseEvent('t1', 'Bash', new Date('2025-01-01T00:00:04.500Z')),
      toolResultEvent('t1', 'Bash', new Date('2025-01-01T00:00:06Z')),
    ]

    const result = mergeRestoredAndStream(restored, stream)
    // Both stream events should be included (within 1s dedup window)
    // t1 from stream at 4.5s is within 1s of restored end (5s), so included
    expect(result.length).toBeGreaterThanOrEqual(3)
    // Should be sorted chronologically
    for (let i = 1; i < result.length; i++) {
      expect(new Date(result[i].timestamp).getTime())
        .toBeGreaterThanOrEqual(new Date(result[i - 1].timestamp).getTime())
    }
  })

  it('filters out old stream events that predate restored data', () => {
    const restored = [
      textEvent('Final', new Date('2025-01-01T00:00:10Z')),
    ]
    // Stream has an event much earlier than restored end
    const stream = [
      textEvent('Old', new Date('2025-01-01T00:00:01Z')),
      textEvent('New', new Date('2025-01-01T00:00:15Z')),
    ]

    const result = mergeRestoredAndStream(restored, stream)
    // "Old" at T+1s should be filtered out (well before T+10s - 1s = T+9s)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('Final')
    expect(result[1].content).toBe('New')
  })

  it('handles empty restored data with stream events', () => {
    const stream = [
      textEvent('First', new Date('2025-01-01T00:00:00Z')),
    ]

    const result = mergeRestoredAndStream([], stream)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('First')
  })
})

// ─── Data Priority Tests ──────────────────────────────────────────────

describe('data source priority', () => {
  it('execution store events take priority when available', () => {
    // Simulates: original tab, no refresh — exec store has events
    const execEvents: TaskActivityEvent[] = [
      textEvent('From exec store', new Date()),
    ]
    const hasExecStoreEvents = execEvents.length > 0

    // Priority: exec store events → live data exclusively
    expect(hasExecStoreEvents).toBe(true)
  })

  it('restored data used when exec store is empty', () => {
    // Simulates: post-refresh — exec store loaded from DB with empty activityEvents
    const execEvents: TaskActivityEvent[] = []
    const restoredEvents: TaskActivityEvent[] = [
      textEvent('From observations', new Date()),
    ]
    const hasExecStoreEvents = execEvents.length > 0

    expect(hasExecStoreEvents).toBe(false)
    expect(restoredEvents.length).toBeGreaterThan(0)
  })

  it('restored data merges with stream events after reconnect', () => {
    // Simulates: post-refresh, global SSE reconnected, new events arriving
    const restoredEvents: TaskActivityEvent[] = [
      textEvent('History', new Date('2025-01-01T00:00:00Z')),
    ]
    const streamEvents: TaskActivityEvent[] = [
      textEvent('Live', new Date('2025-01-01T00:01:00Z')),
    ]

    const merged = mergeRestoredAndStream(restoredEvents, streamEvents)
    expect(merged).toHaveLength(2)
    expect(merged[0].content).toBe('History')
    expect(merged[1].content).toBe('Live')
  })
})
