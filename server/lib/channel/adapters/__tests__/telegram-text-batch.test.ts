/**
 * Tests for Telegram text-message batching.
 *
 * Mirrors hermes-agent tests/gateway/test_telegram_text_batching.py:
 *   - Single message dispatched after debounce window.
 *   - Rapid successive messages from the same key are merged with "\n\n".
 *   - Different chats / users / threads are NEVER merged.
 *   - Commands ("/foo") are not batched and force-flush pending state.
 *   - State is cleaned up after flush.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  enqueueText,
  forceFlushPending,
  isTelegramCommand,
  _resetForTests,
} from '../telegram-text-batch.js'

const FAST_MS = 50

beforeEach(() => {
  _resetForTests()
  vi.useRealTimers()
})

describe('isTelegramCommand', () => {
  it('detects /foo as command', () => {
    expect(isTelegramCommand('/foo')).toBe(true)
    expect(isTelegramCommand('/start arg')).toBe(true)
  })
  it('rejects bare slash and plain text', () => {
    expect(isTelegramCommand('/')).toBe(false)
    expect(isTelegramCommand('hello')).toBe(false)
    expect(isTelegramCommand('')).toBe(false)
    expect(isTelegramCommand(' /foo')).toBe(false)
  })
})

describe('enqueueText — debounce + merge', () => {
  it('dispatches a single message after the debounce window', async () => {
    const start = Date.now()
    const result = await enqueueText(
      { chatId: '1', userId: 'u1' },
      { text: 'hello world' },
      { debounceMs: FAST_MS },
    )
    expect(Date.now() - start).toBeGreaterThanOrEqual(FAST_MS - 5)
    expect(result.text).toBe('hello world')
    expect(result.items).toHaveLength(1)
  })

  it('merges two rapid messages from the same key into one batch', async () => {
    const key = { chatId: '1', userId: 'u1' }
    const p1 = enqueueText(key, { text: 'This is part one of a long' }, { debounceMs: FAST_MS })
    // Small gap, well within window.
    await new Promise((r) => setTimeout(r, 10))
    const p2 = enqueueText(key, { text: 'message that was split.' }, { debounceMs: FAST_MS })

    const [r1, r2] = await Promise.all([p1, p2])
    // Both callers see the SAME merged batch.
    expect(r1).toBe(r2)
    expect(r1.text).toBe('This is part one of a long\n\nmessage that was split.')
    expect(r1.items.map((i) => i.text)).toEqual([
      'This is part one of a long',
      'message that was split.',
    ])
  })

  it('merges three rapid messages', async () => {
    const key = { chatId: '1', userId: 'u1' }
    const p1 = enqueueText(key, { text: 'chunk 1' }, { debounceMs: FAST_MS })
    await new Promise((r) => setTimeout(r, 5))
    const p2 = enqueueText(key, { text: 'chunk 2' }, { debounceMs: FAST_MS })
    await new Promise((r) => setTimeout(r, 5))
    const p3 = enqueueText(key, { text: 'chunk 3' }, { debounceMs: FAST_MS })

    const results = await Promise.all([p1, p2, p3])
    for (const r of results) {
      expect(r.text).toBe('chunk 1\n\nchunk 2\n\nchunk 3')
    }
  })

  it('does NOT merge messages from different chats', async () => {
    const r1 = enqueueText({ chatId: '111', userId: 'u1' }, { text: 'from A' }, { debounceMs: FAST_MS })
    const r2 = enqueueText({ chatId: '222', userId: 'u2' }, { text: 'from B' }, { debounceMs: FAST_MS })
    const [a, b] = await Promise.all([r1, r2])
    expect(a.text).toBe('from A')
    expect(b.text).toBe('from B')
    expect(a).not.toBe(b)
  })

  it('does NOT merge messages from different users in the same chat', async () => {
    const r1 = enqueueText({ chatId: '1', userId: 'u1' }, { text: 'mine' }, { debounceMs: FAST_MS })
    const r2 = enqueueText({ chatId: '1', userId: 'u2' }, { text: 'yours' }, { debounceMs: FAST_MS })
    const [a, b] = await Promise.all([r1, r2])
    expect(a.text).toBe('mine')
    expect(b.text).toBe('yours')
  })

  it('does NOT merge across forum-topic threads', async () => {
    const r1 = enqueueText(
      { chatId: '1', threadId: 't1', userId: 'u1' },
      { text: 'in topic 1' },
      { debounceMs: FAST_MS },
    )
    const r2 = enqueueText(
      { chatId: '1', threadId: 't2', userId: 'u1' },
      { text: 'in topic 2' },
      { debounceMs: FAST_MS },
    )
    const [a, b] = await Promise.all([r1, r2])
    expect(a.text).toBe('in topic 1')
    expect(b.text).toBe('in topic 2')
  })

  it('cleans up internal state after flush', async () => {
    const key = { chatId: '1', userId: 'u1' }
    await enqueueText(key, { text: 'hi' }, { debounceMs: FAST_MS })
    // After flush, a fresh enqueue starts a new batch (not appending to old one).
    const r2 = await enqueueText(key, { text: 'second' }, { debounceMs: FAST_MS })
    expect(r2.text).toBe('second')
    expect(r2.items).toHaveLength(1)
  })
})

describe('forceFlushPending', () => {
  it('returns null when nothing is pending', () => {
    const result = forceFlushPending({ chatId: '1', userId: 'u1' })
    expect(result).toBeNull()
  })

  it('synchronously flushes pending batch and resolves the awaiters', async () => {
    const key = { chatId: '1', userId: 'u1' }
    const p1 = enqueueText(key, { text: 'first' }, { debounceMs: 5000 })
    const p2 = enqueueText(key, { text: 'second' }, { debounceMs: 5000 })

    const flushed = forceFlushPending(key)
    expect(flushed).not.toBeNull()
    expect(flushed!.text).toBe('first\n\nsecond')

    const [a, b] = await Promise.all([p1, p2])
    expect(a.text).toBe('first\n\nsecond')
    expect(b.text).toBe('first\n\nsecond')
  })

  it('only flushes the targeted key, leaving others pending', async () => {
    const k1 = { chatId: '1', userId: 'u1' }
    const k2 = { chatId: '2', userId: 'u2' }
    const p1 = enqueueText(k1, { text: 'a' }, { debounceMs: 5000 })
    const p2 = enqueueText(k2, { text: 'b' }, { debounceMs: FAST_MS })

    const flushed = forceFlushPending(k1)
    expect(flushed!.text).toBe('a')

    const r1 = await p1
    expect(r1.text).toBe('a')

    // k2 still drains naturally via its own debounce.
    const r2 = await p2
    expect(r2.text).toBe('b')
  })
})
