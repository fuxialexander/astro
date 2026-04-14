/**
 * Tests for telegram replyToMode policy.
 *
 * Mirrors hermes-agent tests/gateway/test_telegram_reply_mode.py
 * (TestShouldThreadReply class).
 */

import { describe, it, expect } from 'vitest'
import { shouldThreadReply, type ReplyToMode } from '../telegram-chat.js'

describe('shouldThreadReply', () => {
  it('returns false when there is no original message id', () => {
    expect(shouldThreadReply(undefined, 0, 'first')).toBe(false)
    expect(shouldThreadReply(null, 0, 'first')).toBe(false)
    expect(shouldThreadReply(undefined, 0, 'all')).toBe(false)
  })

  it("'off' never threads", () => {
    expect(shouldThreadReply(123, 0, 'off')).toBe(false)
    expect(shouldThreadReply(123, 1, 'off')).toBe(false)
    expect(shouldThreadReply(123, 5, 'off')).toBe(false)
  })

  it("'first' only threads the first chunk", () => {
    expect(shouldThreadReply(123, 0, 'first')).toBe(true)
    expect(shouldThreadReply(123, 1, 'first')).toBe(false)
    expect(shouldThreadReply(123, 2, 'first')).toBe(false)
    expect(shouldThreadReply(123, 10, 'first')).toBe(false)
  })

  it("'all' threads every chunk", () => {
    expect(shouldThreadReply(123, 0, 'all')).toBe(true)
    expect(shouldThreadReply(123, 1, 'all')).toBe(true)
    expect(shouldThreadReply(123, 2, 'all')).toBe(true)
    expect(shouldThreadReply(123, 10, 'all')).toBe(true)
  })

  it('invalid mode falls back to first-chunk-only behaviour', () => {
    const bad = 'invalid' as unknown as ReplyToMode
    expect(shouldThreadReply(123, 0, bad)).toBe(true)
    expect(shouldThreadReply(123, 1, bad)).toBe(false)
  })

  it('single chunk: respects mode (first chunk = chunkIndex 0)', () => {
    expect(shouldThreadReply(999, 0, 'first')).toBe(true)
    expect(shouldThreadReply(999, 0, 'off')).toBe(false)
    expect(shouldThreadReply(999, 0, 'all')).toBe(true)
  })
})
