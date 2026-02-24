/**
 * Unit tests for SSE event buffer and stdout throttle.
 *
 * Tests the server-side SSE infrastructure that supports reconnection
 * replay (EventBuffer) and output batching (StdoutThrottle), covering
 * edge cases that surface as ERR_TIMED_OUT and dropped events in prod.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBuffer } from '../event-buffer'
import { StdoutThrottle } from '../stdout-throttle'

describe('EventBuffer', () => {
  it('assigns sequential IDs starting from 1', () => {
    const buf = new EventBuffer()
    expect(buf.push('test', 'data1')).toBe('1')
    expect(buf.push('test', 'data2')).toBe('2')
    expect(buf.push('test', 'data3')).toBe('3')
  })

  it('evicts oldest events when capacity exceeded', () => {
    const buf = new EventBuffer(3)
    buf.push('a', 'd1')
    buf.push('b', 'd2')
    buf.push('c', 'd3')
    buf.push('d', 'd4') // evicts event 1

    const events = buf.getAfter('0')
    expect(events).toHaveLength(3)
    expect(events[0].id).toBe('2') // event 1 was evicted
    expect(events[2].id).toBe('4')
  })

  it('replays events after a given Last-Event-ID', () => {
    const buf = new EventBuffer()
    buf.push('heartbeat', '')
    buf.push('task:result', '{"taskId":"t1"}')
    buf.push('task:stdout', '{"taskId":"t1","data":"hello"}')

    const missed = buf.getAfter('1')
    expect(missed).toHaveLength(2)
    expect(missed[0].event).toBe('task:result')
    expect(missed[1].event).toBe('task:stdout')
  })

  it('returns empty array for invalid Last-Event-ID', () => {
    const buf = new EventBuffer()
    buf.push('test', 'data')
    expect(buf.getAfter('garbage')).toEqual([])
    expect(buf.getAfter('')).toEqual([])
  })

  it('returns empty array when Last-Event-ID is beyond current', () => {
    const buf = new EventBuffer()
    buf.push('test', 'data')
    expect(buf.getAfter('999')).toEqual([])
  })

  it('expires events older than TTL', () => {
    const buf = new EventBuffer(100, 1000) // 1s TTL
    buf.push('old', 'data')

    // Manually age the event
    const events = buf.getAfter('0')
    expect(events).toHaveLength(1)

    // Simulate passage of time by directly manipulating the internal buffer
    // (In production, events naturally expire after TTL)
    vi.useFakeTimers()
    const buf2 = new EventBuffer(100, 100) // 100ms TTL
    buf2.push('old', 'data')
    vi.advanceTimersByTime(200)
    expect(buf2.getAfter('0')).toEqual([])
    vi.useRealTimers()
  })

  it('prune removes expired events', () => {
    vi.useFakeTimers()
    const buf = new EventBuffer(100, 100)
    buf.push('a', 'd1')
    buf.push('b', 'd2')
    expect(buf.size).toBe(2)

    vi.advanceTimersByTime(200)
    buf.prune()
    expect(buf.size).toBe(0)
    vi.useRealTimers()
  })

  it('handles high-volume pushes without losing recent events', () => {
    const buf = new EventBuffer(10)
    for (let i = 0; i < 100; i++) {
      buf.push('test', `data-${i}`)
    }
    expect(buf.size).toBe(10)
    // Last 10 events should be IDs 91-100
    const events = buf.getAfter('90')
    expect(events).toHaveLength(10)
    expect(events[0].data).toBe('data-90')
    expect(events[9].data).toBe('data-99')
  })
})

describe('StdoutThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('batches rapid writes into a single flush', () => {
    const onFlush = vi.fn()
    const throttle = new StdoutThrottle(onFlush, 100)

    throttle.write('task-1', 'hello ')
    throttle.write('task-1', 'world')

    // Not flushed yet
    expect(onFlush).not.toHaveBeenCalled()

    // After flush interval
    vi.advanceTimersByTime(100)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('task-1', 'hello world')
  })

  it('handles multiple tasks independently', () => {
    const onFlush = vi.fn()
    const throttle = new StdoutThrottle(onFlush, 100)

    throttle.write('task-1', 'data1')
    throttle.write('task-2', 'data2')

    vi.advanceTimersByTime(100)
    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(onFlush).toHaveBeenCalledWith('task-1', 'data1')
    expect(onFlush).toHaveBeenCalledWith('task-2', 'data2')
  })

  it('flushAll sends all pending data immediately', () => {
    const onFlush = vi.fn()
    const throttle = new StdoutThrottle(onFlush, 100)

    throttle.write('task-1', 'a')
    throttle.write('task-2', 'b')
    throttle.flushAll()

    expect(onFlush).toHaveBeenCalledTimes(2)
  })

  it('shutdown clears all timers and flushes', () => {
    const onFlush = vi.fn()
    const throttle = new StdoutThrottle(onFlush, 100)

    throttle.write('task-1', 'data')
    throttle.shutdown()

    expect(onFlush).toHaveBeenCalledTimes(1)

    // No duplicate flush after interval
    vi.advanceTimersByTime(200)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('remove flushes and cleans up a specific task', () => {
    const onFlush = vi.fn()
    const throttle = new StdoutThrottle(onFlush, 100)

    throttle.write('task-1', 'data1')
    throttle.write('task-2', 'data2')
    throttle.remove('task-1')

    // task-1 flushed immediately, task-2 still pending
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('task-1', 'data1')

    vi.advanceTimersByTime(100)
    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(onFlush).toHaveBeenCalledWith('task-2', 'data2')
  })

  it('does not flush empty buffer', () => {
    const onFlush = vi.fn()
    const throttle = new StdoutThrottle(onFlush, 100)

    throttle.flush('nonexistent')
    expect(onFlush).not.toHaveBeenCalled()
  })
})

/**
 * Simulates the SSE alive-flag pattern used in server/routes/events.ts.
 *
 * The production SSE handler uses an `alive` flag that:
 * - Starts as true
 * - Is set to false when writeSSE() throws (connection dropped)
 * - Guards all event writes and heartbeat intervals
 * - Triggers cleanup (clearInterval, unsubscribe listeners)
 *
 * These tests verify the pattern handles connection drops correctly.
 */
describe('SSE alive-flag pattern', () => {
  it('stops writing events after connection drops', () => {
    let alive = true
    const writes: string[] = []

    const writeSSE = (data: string) => {
      if (!alive) return
      if (data === 'FAIL') {
        alive = false
        throw new Error('connection closed')
      }
      writes.push(data)
    }

    writeSSE('event1')
    writeSSE('event2')
    try { writeSSE('FAIL') } catch { /* expected */ }
    // After connection drops, alive is false
    expect(alive).toBe(false)
    writeSSE('event3') // should be silently dropped
    expect(writes).toEqual(['event1', 'event2'])
  })

  it('heartbeat interval is cleared on connection drop', () => {
    let alive = true
    let heartbeatCount = 0
    const clearIntervalSpy = vi.fn()

    // Simulate heartbeat interval
    const heartbeatFn = () => {
      if (!alive) {
        clearIntervalSpy()
        return
      }
      heartbeatCount++
    }

    heartbeatFn() // tick 1
    heartbeatFn() // tick 2
    alive = false  // connection drops
    heartbeatFn() // should call clearInterval
    heartbeatFn() // should call clearInterval again

    expect(heartbeatCount).toBe(2)
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2)
  })

  it('onAbort cleanup unsubscribes all listeners', () => {
    const listeners = new Map<string, Set<() => void>>()

    function on(event: string, handler: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
    }

    function off(event: string, handler: () => void) {
      listeners.get(event)?.delete(handler)
    }

    const handler1 = () => {}
    const handler2 = () => {}

    on('task:result', handler1)
    on('task:stdout', handler2)
    expect(listeners.get('task:result')?.size).toBe(1)
    expect(listeners.get('task:stdout')?.size).toBe(1)

    // Simulate onAbort cleanup
    off('task:result', handler1)
    off('task:stdout', handler2)
    expect(listeners.get('task:result')?.size).toBe(0)
    expect(listeners.get('task:stdout')?.size).toBe(0)
  })
})
