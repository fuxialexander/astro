/**
 * Simulation tests for observation collector buffer resilience.
 *
 * Tests the buffer cap, batch flush, and error recovery mechanisms that prevent
 * unbounded buffer growth from transient DB errors (the root cause of the
 * Mar 16 production incident where event loop starvation made the server
 * unresponsive).
 *
 * These tests mock the DB layer and simulate various failure scenarios to
 * verify the three defense layers:
 *   1. Buffer cap (MAX_BUFFER_SIZE) — hard ceiling on per-trace buffer growth
 *   2. Batch flush (MAX_FLUSH_BATCH) — splits large INSERTs to prevent timeout
 *   3. Remaining-event recovery — re-buffers failed + un-attempted batches
 *
 * Run with: npx vitest run tests/observation-buffer-resilience.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Constants (mirrored from observation-collector.ts) ──────────────
// These MUST match the production values. If they drift, the test
// is no longer validating the real behavior.

const MAX_BUFFER_SIZE = 500
const MAX_FLUSH_BATCH = 200
const BATCH_SIZE = 50

// ─── Minimal types (avoid importing server code with DB deps) ────────

interface ObservationEvent {
  id: string
  traceId: string
  parentObservationId?: string
  type: 'span' | 'generation' | 'tool' | 'event'
  name: string
  startTime: Date
  endTime?: Date
  input?: unknown
  output?: unknown
  model?: string
  inputTokens?: number
  outputTokens?: number
  estimatedCostUsd?: number
  level: 'debug' | 'default' | 'warning' | 'error'
  metadata?: Record<string, unknown>
  projectId: string | null
  nodeId?: string
  statusMessage?: string
}

// ─── Extracted buffer logic (pure functions, no DB dependency) ───────
// We extract the core algorithms from ObservationCollector into testable
// pure functions. This avoids mocking DB, EventBus, setInterval, etc.
// The logic must exactly match what's in observation-collector.ts.

interface BufferState {
  buffer: ObservationEvent[]
  pendingFlush: boolean
}

function makeEvent(id: string, traceId: string): ObservationEvent {
  return {
    id,
    traceId,
    type: 'event',
    name: `event-${id}`,
    startTime: new Date(),
    level: 'default',
    projectId: 'proj-1',
  }
}

/**
 * Simulates addObservation() buffer cap logic.
 * Returns the number of events dropped (0 if none).
 */
function addToBuffer(state: BufferState, obs: ObservationEvent): number {
  let dropped = 0
  if (state.buffer.length >= MAX_BUFFER_SIZE) {
    dropped = state.buffer.length - MAX_BUFFER_SIZE + 1
    state.buffer.splice(0, dropped)
  }
  state.buffer.push(obs)
  return dropped
}

/** Error types for simulating DB responses */
type FlushResult =
  | { ok: true; count: number }
  | { ok: false; retryable: true; error: string }
  | { ok: false; retryable: false; pgCode: string }

/**
 * Simulates flush() batch logic with a configurable DB mock.
 * Returns { committed, dropped, rebuffered } counts.
 *
 * `dbMock` is called once per batch with the batch of events.
 * It returns a FlushResult indicating success, retryable error, or non-retryable error.
 */
function simulateFlush(
  state: BufferState,
  dbMock: (batch: ObservationEvent[], batchIndex: number) => FlushResult,
): { committed: number; dropped: number; rebuffered: number } {
  if (state.buffer.length === 0) {
    return { committed: 0, dropped: 0, rebuffered: 0 }
  }

  const events = state.buffer.splice(0)
  let committed = 0
  let dropped = 0
  let rebuffered = 0

  for (let i = 0, batchIdx = 0; i < events.length; i += MAX_FLUSH_BATCH, batchIdx++) {
    const batch = events.slice(i, i + MAX_FLUSH_BATCH)
    const result = dbMock(batch, batchIdx)

    if (result.ok) {
      committed += batch.length
    } else if (!result.retryable) {
      // Non-retryable: drop this batch, continue to next
      dropped += batch.length
    } else {
      // Transient error: re-buffer this batch + all remaining
      const remaining = events.slice(i)
      state.buffer.unshift(...remaining)
      rebuffered += remaining.length
      break
    }
  }

  return { committed, dropped, rebuffered }
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Observation Buffer Cap', () => {
  it('allows buffer to grow up to MAX_BUFFER_SIZE without dropping', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < MAX_BUFFER_SIZE; i++) {
      const dropped = addToBuffer(state, makeEvent(`e${i}`, 'trace-1'))
      expect(dropped).toBe(0)
    }
    expect(state.buffer.length).toBe(MAX_BUFFER_SIZE)
  })

  it('drops oldest events when buffer exceeds MAX_BUFFER_SIZE', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    // Fill to capacity
    for (let i = 0; i < MAX_BUFFER_SIZE; i++) {
      addToBuffer(state, makeEvent(`e${i}`, 'trace-1'))
    }
    expect(state.buffer.length).toBe(MAX_BUFFER_SIZE)

    // Add one more — should drop the oldest
    const dropped = addToBuffer(state, makeEvent('overflow-1', 'trace-1'))
    expect(dropped).toBe(1)
    expect(state.buffer.length).toBe(MAX_BUFFER_SIZE)
    // Oldest event (e0) should be gone, newest (overflow-1) should be last
    expect(state.buffer[0].id).toBe('e1')
    expect(state.buffer[state.buffer.length - 1].id).toBe('overflow-1')
  })

  it('drops multiple events when buffer is well over cap (simulates re-buffer after flush failure)', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    // Simulate a buffer that grew to 700 (e.g., 500 cap + 200 re-buffered from failed flush)
    // This can happen because flush re-buffers events via unshift, which bypasses the cap check
    for (let i = 0; i < 700; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }
    expect(state.buffer.length).toBe(700)

    // Next addObservation should trim back to MAX_BUFFER_SIZE
    const dropped = addToBuffer(state, makeEvent('trim', 'trace-1'))
    expect(dropped).toBe(201) // 700 - 500 + 1 = 201
    expect(state.buffer.length).toBe(MAX_BUFFER_SIZE)
    expect(state.buffer[state.buffer.length - 1].id).toBe('trim')
  })

  it('preserves newest events and drops oldest on overflow', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < MAX_BUFFER_SIZE + 10; i++) {
      addToBuffer(state, makeEvent(`e${i}`, 'trace-1'))
    }
    // Buffer should be exactly at cap
    expect(state.buffer.length).toBe(MAX_BUFFER_SIZE)
    // First 10 events should have been dropped, event e10 should be oldest
    expect(state.buffer[0].id).toBe('e10')
    // Last event should be the most recent
    expect(state.buffer[state.buffer.length - 1].id).toBe(`e${MAX_BUFFER_SIZE + 9}`)
  })
})

describe('Flush Batching', () => {
  it('commits all events in a single batch when count <= MAX_FLUSH_BATCH', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < 100; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }

    const batchCalls: number[] = []
    const result = simulateFlush(state, (batch, idx) => {
      batchCalls.push(batch.length)
      return { ok: true, count: batch.length }
    })

    expect(result.committed).toBe(100)
    expect(result.dropped).toBe(0)
    expect(result.rebuffered).toBe(0)
    expect(batchCalls).toEqual([100]) // single batch
    expect(state.buffer.length).toBe(0)
  })

  it('splits into multiple batches of MAX_FLUSH_BATCH', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < 450; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }

    const batchSizes: number[] = []
    const result = simulateFlush(state, (batch) => {
      batchSizes.push(batch.length)
      return { ok: true, count: batch.length }
    })

    expect(result.committed).toBe(450)
    expect(batchSizes).toEqual([200, 200, 50]) // 3 batches
    expect(state.buffer.length).toBe(0)
  })

  it('splits exactly at MAX_FLUSH_BATCH boundary', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < MAX_FLUSH_BATCH * 3; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }

    const batchSizes: number[] = []
    simulateFlush(state, (batch) => {
      batchSizes.push(batch.length)
      return { ok: true, count: batch.length }
    })

    expect(batchSizes).toEqual([200, 200, 200])
  })
})

describe('Transient Error Recovery', () => {
  it('re-buffers failed batch + all remaining on transient error', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    // 450 events → 3 batches (200, 200, 50)
    for (let i = 0; i < 450; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }

    // Batch 0 succeeds, batch 1 fails with transient error
    const result = simulateFlush(state, (_batch, idx) => {
      if (idx === 0) return { ok: true, count: 200 }
      return { ok: false, retryable: true, error: 'timeout' }
    })

    expect(result.committed).toBe(200)   // batch 0
    expect(result.rebuffered).toBe(250)   // batch 1 (200) + batch 2 (50)
    expect(result.dropped).toBe(0)
    expect(state.buffer.length).toBe(250) // re-buffered for retry
    // Verify the re-buffered events are the right ones (events 200-449)
    expect(state.buffer[0].id).toBe('e200')
    expect(state.buffer[state.buffer.length - 1].id).toBe('e449')
  })

  it('re-buffers everything when first batch fails', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < 300; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }

    const result = simulateFlush(state, () => {
      return { ok: false, retryable: true, error: 'connection reset' }
    })

    expect(result.committed).toBe(0)
    expect(result.rebuffered).toBe(300)
    expect(state.buffer.length).toBe(300)
  })

  it('preserves event ordering after re-buffer', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < 50; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }

    // Fail the flush
    simulateFlush(state, () => {
      return { ok: false, retryable: true, error: 'timeout' }
    })

    // Add new events after the failed flush
    state.buffer.push(makeEvent('new-1', 'trace-1'))
    state.buffer.push(makeEvent('new-2', 'trace-1'))

    // Verify ordering: old events first (re-buffered), then new events
    expect(state.buffer[0].id).toBe('e0')
    expect(state.buffer[49].id).toBe('e49')
    expect(state.buffer[50].id).toBe('new-1')
    expect(state.buffer[51].id).toBe('new-2')
  })
})

describe('Non-Retryable Error Handling', () => {
  it('drops batch on non-retryable error and continues to next batch', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < 450; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }

    // Batch 0 succeeds, batch 1 hits unique violation, batch 2 succeeds
    const result = simulateFlush(state, (_batch, idx) => {
      if (idx === 1) return { ok: false, retryable: false, pgCode: '23505' }
      return { ok: true, count: _batch.length }
    })

    expect(result.committed).toBe(250)  // batch 0 (200) + batch 2 (50)
    expect(result.dropped).toBe(200)    // batch 1
    expect(result.rebuffered).toBe(0)
    expect(state.buffer.length).toBe(0) // nothing re-buffered
  })

  it('drops batch on index size exceeded and continues', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < 400; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }

    // Both batches hit 54000 (index too large)
    const result = simulateFlush(state, () => {
      return { ok: false, retryable: false, pgCode: '54000' }
    })

    expect(result.committed).toBe(0)
    expect(result.dropped).toBe(400)
    expect(result.rebuffered).toBe(0)
    expect(state.buffer.length).toBe(0)
  })
})

describe('Mixed Error Scenarios', () => {
  it('handles success → non-retryable → transient correctly', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    // 600 events → 3 batches (200, 200, 200)
    for (let i = 0; i < MAX_FLUSH_BATCH * 3; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }

    const result = simulateFlush(state, (_batch, idx) => {
      if (idx === 0) return { ok: true, count: 200 }
      if (idx === 1) return { ok: false, retryable: false, pgCode: '23505' }
      // idx === 2: this batch should still be attempted since non-retryable doesn't break
      return { ok: false, retryable: true, error: 'timeout' }
    })

    expect(result.committed).toBe(200)  // batch 0
    expect(result.dropped).toBe(200)    // batch 1 (non-retryable)
    expect(result.rebuffered).toBe(200) // batch 2 (transient)
    expect(state.buffer.length).toBe(200)
    // Re-buffered events should be from the third batch (events 400-599)
    expect(state.buffer[0].id).toBe('e400')
  })

  it('handles non-retryable → success correctly', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < 400; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }

    const result = simulateFlush(state, (_batch, idx) => {
      if (idx === 0) return { ok: false, retryable: false, pgCode: '23505' }
      return { ok: true, count: _batch.length }
    })

    expect(result.committed).toBe(200) // batch 1
    expect(result.dropped).toBe(200)   // batch 0
    expect(state.buffer.length).toBe(0)
  })
})

describe('Snowball Prevention (Stress Simulation)', () => {
  /**
   * Simulates the original bug: without buffer cap, transient DB failures
   * cause unbounded growth. With the cap, growth is bounded.
   */
  it('WITHOUT cap: buffer grows unbounded under sustained transient failures', () => {
    // Simulate the OLD behavior (no cap in addObservation)
    const buffer: ObservationEvent[] = []
    const eventsPerSecond = 10
    const flushIntervalSec = 5
    const totalSeconds = 60 // simulate 1 minute

    for (let sec = 0; sec < totalSeconds; sec++) {
      // Add events (simulates streaming tool_use, text, etc.)
      for (let j = 0; j < eventsPerSecond; j++) {
        buffer.push(makeEvent(`s${sec}-e${j}`, 'trace-1'))
      }

      // Periodic flush every 5 seconds — always fails with transient error
      if (sec > 0 && sec % flushIntervalSec === 0) {
        const events = buffer.splice(0)
        // Simulate transient DB failure: all events go back
        buffer.unshift(...events)
      }
    }

    // Without cap: buffer has accumulated ALL events from 60 seconds
    expect(buffer.length).toBe(eventsPerSecond * totalSeconds) // 600
    // In the real incident, this grew to thousands over minutes
  })

  it('WITH cap: buffer stays bounded under sustained transient failures', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    const eventsPerSecond = 10
    const flushIntervalSec = 5
    const totalSeconds = 60

    let totalDropped = 0

    for (let sec = 0; sec < totalSeconds; sec++) {
      for (let j = 0; j < eventsPerSecond; j++) {
        totalDropped += addToBuffer(state, makeEvent(`s${sec}-e${j}`, 'trace-1'))
      }

      // Periodic flush every 5 seconds — always fails
      if (sec > 0 && sec % flushIntervalSec === 0) {
        simulateFlush(state, () => {
          return { ok: false, retryable: true, error: 'timeout' }
        })
      }
    }

    // WITH cap: buffer never exceeds MAX_BUFFER_SIZE
    expect(state.buffer.length).toBeLessThanOrEqual(MAX_BUFFER_SIZE)
    // Some events were dropped (oldest ones)
    expect(totalDropped).toBeGreaterThan(0)
  })

  it('sustained failures followed by recovery flushes accumulated events', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }

    // Phase 1: 30 seconds of failures, 10 events/sec
    for (let sec = 0; sec < 30; sec++) {
      for (let j = 0; j < 10; j++) {
        addToBuffer(state, makeEvent(`fail-s${sec}-e${j}`, 'trace-1'))
      }
      if (sec > 0 && sec % 5 === 0) {
        simulateFlush(state, () => ({ ok: false, retryable: true, error: 'timeout' }))
      }
    }

    const bufferBeforeRecovery = state.buffer.length
    expect(bufferBeforeRecovery).toBeLessThanOrEqual(MAX_BUFFER_SIZE)

    // Phase 2: DB recovers — flush succeeds
    const result = simulateFlush(state, (batch) => ({ ok: true, count: batch.length }))

    expect(result.committed).toBe(bufferBeforeRecovery)
    expect(state.buffer.length).toBe(0) // fully drained
  })

  it('high-frequency events with intermittent failures stay bounded', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    const eventsPerSecond = 50 // high-frequency trace (many tool calls)
    const totalSeconds = 120
    let maxBufferSeen = 0

    for (let sec = 0; sec < totalSeconds; sec++) {
      for (let j = 0; j < eventsPerSecond; j++) {
        addToBuffer(state, makeEvent(`s${sec}-e${j}`, 'trace-1'))
      }
      maxBufferSeen = Math.max(maxBufferSeen, state.buffer.length)

      // Flush every 5 seconds: 70% success, 30% transient failure
      if (sec > 0 && sec % 5 === 0) {
        const shouldFail = sec % 15 === 0 // every 3rd flush fails
        simulateFlush(state, (batch) => {
          if (shouldFail) return { ok: false, retryable: true, error: 'timeout' }
          return { ok: true, count: batch.length }
        })
      }
    }

    // Buffer must NEVER exceed MAX_BUFFER_SIZE + MAX_FLUSH_BATCH
    // (temporary overshoot from re-buffer is trimmed on next addObservation)
    expect(maxBufferSeen).toBeLessThanOrEqual(MAX_BUFFER_SIZE + MAX_FLUSH_BATCH)
    // After final state, buffer should be at most MAX_BUFFER_SIZE
    expect(state.buffer.length).toBeLessThanOrEqual(MAX_BUFFER_SIZE)
  })
})

describe('Concurrent Events During Flush', () => {
  it('events added during flush are preserved after re-buffer', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < 100; i++) {
      state.buffer.push(makeEvent(`pre-${i}`, 'trace-1'))
    }

    // Simulate: flush splices buffer, then events arrive, then flush fails
    const events = state.buffer.splice(0)
    expect(state.buffer.length).toBe(0)

    // New events arrive while flush is "awaiting" DB
    state.buffer.push(makeEvent('during-1', 'trace-1'))
    state.buffer.push(makeEvent('during-2', 'trace-1'))
    expect(state.buffer.length).toBe(2)

    // Flush fails — re-buffer the original events
    state.buffer.unshift(...events)
    expect(state.buffer.length).toBe(102)

    // Old events first, then new events — correct ordering
    expect(state.buffer[0].id).toBe('pre-0')
    expect(state.buffer[99].id).toBe('pre-99')
    expect(state.buffer[100].id).toBe('during-1')
    expect(state.buffer[101].id).toBe('during-2')
  })

  it('buffer cap trims correctly after re-buffer pushes over MAX_BUFFER_SIZE', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }

    // Simulate: flush re-buffered 400 events, plus 200 arrived during flush
    for (let i = 0; i < 400; i++) {
      state.buffer.push(makeEvent(`rebuf-${i}`, 'trace-1'))
    }
    for (let i = 0; i < 200; i++) {
      state.buffer.push(makeEvent(`during-${i}`, 'trace-1'))
    }
    expect(state.buffer.length).toBe(600)

    // Next addObservation triggers the cap
    const dropped = addToBuffer(state, makeEvent('trigger', 'trace-1'))
    expect(dropped).toBe(101) // 600 - 500 + 1
    expect(state.buffer.length).toBe(MAX_BUFFER_SIZE)
    // Newest events should be preserved
    expect(state.buffer[state.buffer.length - 1].id).toBe('trigger')
  })
})

describe('Edge Cases', () => {
  it('empty buffer flush is a no-op', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    const dbCalled = vi.fn()
    const result = simulateFlush(state, (batch) => {
      dbCalled()
      return { ok: true, count: batch.length }
    })

    expect(result.committed).toBe(0)
    expect(dbCalled).not.toHaveBeenCalled()
  })

  it('single event flushes in one batch', () => {
    const state: BufferState = { buffer: [makeEvent('solo', 'trace-1')], pendingFlush: false }
    const result = simulateFlush(state, (batch) => ({ ok: true, count: batch.length }))
    expect(result.committed).toBe(1)
  })

  it('exactly MAX_FLUSH_BATCH events flush in one batch', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < MAX_FLUSH_BATCH; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }
    const batchCounts: number[] = []
    simulateFlush(state, (batch) => {
      batchCounts.push(batch.length)
      return { ok: true, count: batch.length }
    })
    expect(batchCounts).toEqual([MAX_FLUSH_BATCH])
  })

  it('MAX_FLUSH_BATCH + 1 events flush in two batches', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < MAX_FLUSH_BATCH + 1; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }
    const batchCounts: number[] = []
    simulateFlush(state, (batch) => {
      batchCounts.push(batch.length)
      return { ok: true, count: batch.length }
    })
    expect(batchCounts).toEqual([MAX_FLUSH_BATCH, 1])
  })

  it('buffer cap with exactly MAX_BUFFER_SIZE elements does not drop on next add', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    // Fill to exactly MAX_BUFFER_SIZE - 1 (so the next add hits exactly MAX_BUFFER_SIZE)
    for (let i = 0; i < MAX_BUFFER_SIZE - 1; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }
    // This add should NOT drop anything (buffer goes from 499 → 500)
    const dropped = addToBuffer(state, makeEvent('last', 'trace-1'))
    expect(dropped).toBe(0)
    expect(state.buffer.length).toBe(MAX_BUFFER_SIZE)
  })

  it('all batches fail with non-retryable error — entire buffer is dropped', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }
    for (let i = 0; i < MAX_BUFFER_SIZE; i++) {
      state.buffer.push(makeEvent(`e${i}`, 'trace-1'))
    }
    const result = simulateFlush(state, () => ({
      ok: false, retryable: false, pgCode: '54000',
    }))
    expect(result.committed).toBe(0)
    expect(result.dropped).toBe(MAX_BUFFER_SIZE)
    expect(state.buffer.length).toBe(0) // clean slate
  })
})

describe('Invariant: Buffer Never Exceeds Theoretical Maximum', () => {
  /**
   * The theoretical maximum buffer size at any point is:
   *   MAX_BUFFER_SIZE + MAX_FLUSH_BATCH
   *
   * This happens when:
   * 1. Buffer is at MAX_BUFFER_SIZE (cap held by addObservation)
   * 2. flush() splices all 500 out → buffer = 0
   * 3. 500 new events arrive (via addObservation, each capped) → buffer = 500
   * 4. flush() fails, re-buffers 200 (one batch) → buffer = 700
   *
   * But the NEXT addObservation call trims back to 500.
   * So the sustained maximum is MAX_BUFFER_SIZE.
   */
  it('worst-case temporary overshoot is MAX_BUFFER_SIZE + MAX_FLUSH_BATCH', () => {
    const state: BufferState = { buffer: [], pendingFlush: false }

    // Fill to cap
    for (let i = 0; i < MAX_BUFFER_SIZE; i++) {
      addToBuffer(state, makeEvent(`e${i}`, 'trace-1'))
    }

    // Flush splices all events out
    const events = state.buffer.splice(0)
    expect(events.length).toBe(MAX_BUFFER_SIZE)

    // While flush is "awaiting", fill buffer back to cap
    for (let i = 0; i < MAX_BUFFER_SIZE; i++) {
      addToBuffer(state, makeEvent(`new-${i}`, 'trace-1'))
    }
    expect(state.buffer.length).toBe(MAX_BUFFER_SIZE)

    // Flush fails, re-buffers one batch (worst case: first batch of MAX_FLUSH_BATCH)
    const batch = events.slice(0, MAX_FLUSH_BATCH)
    state.buffer.unshift(...batch)

    // Temporary overshoot
    expect(state.buffer.length).toBe(MAX_BUFFER_SIZE + MAX_FLUSH_BATCH) // 700

    // But next addObservation trims back
    addToBuffer(state, makeEvent('trim-trigger', 'trace-1'))
    expect(state.buffer.length).toBe(MAX_BUFFER_SIZE)
  })
})
