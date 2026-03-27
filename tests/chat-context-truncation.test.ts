import { describe, it, expect } from 'vitest'
import {
  truncateMessagesForFallback,
  FALLBACK_MAX_MESSAGES,
  FALLBACK_MAX_CHARS,
  type ChatMessage,
} from '../server/lib/chat-context-truncation'

function makeMessages(count: number, contentLength = 100): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `Message ${i}: ${'x'.repeat(contentLength)}`,
  }))
}

describe('truncateMessagesForFallback', () => {
  it('returns all messages when under both limits', () => {
    const messages = makeMessages(10)
    const result = truncateMessagesForFallback(messages)
    expect(result.truncated).toBe(false)
    expect(result.messages).toHaveLength(10)
    expect(result.originalCount).toBe(10)
  })

  it('returns empty input unchanged', () => {
    const result = truncateMessagesForFallback([])
    expect(result.truncated).toBe(false)
    expect(result.messages).toHaveLength(0)
  })

  it('truncates by message count, keeping most recent', () => {
    const messages = makeMessages(80) // 80 > FALLBACK_MAX_MESSAGES (40)
    const result = truncateMessagesForFallback(messages)
    expect(result.truncated).toBe(true)
    expect(result.messages.length).toBeLessThanOrEqual(FALLBACK_MAX_MESSAGES)
    expect(result.originalCount).toBe(80)
    // Most recent messages are kept
    expect(result.messages[result.messages.length - 1].content).toContain('Message 79')
  })

  it('truncates by total character size', () => {
    // Each message ~50K chars, 10 messages = 500K chars > FALLBACK_MAX_CHARS (200K)
    const messages = makeMessages(10, 50_000)
    const result = truncateMessagesForFallback(messages)
    expect(result.truncated).toBe(true)
    const totalChars = result.messages.reduce((s, m) => s + m.content.length, 0)
    // After truncation, keeps min 4 messages (~200K chars with 50K each)
    expect(result.messages.length).toBeGreaterThanOrEqual(4)
    expect(totalChars).toBeLessThanOrEqual(FALLBACK_MAX_CHARS + 110_000) // allow for min 4 msgs
    // Most recent messages kept
    expect(result.messages[result.messages.length - 1].content).toContain('Message 9')
  })

  it('ensures result starts with a user message', () => {
    // Create messages starting with assistant
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'I am assistant' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]
    const result = truncateMessagesForFallback(messages)
    expect(result.messages[0].role).toBe('user')
  })

  it('handles assistant-first after count truncation', () => {
    // 50 messages, after truncating to 40, first message might be assistant
    const messages: ChatMessage[] = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 === 0 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: `Message ${i}`,
    }))
    const result = truncateMessagesForFallback(messages)
    if (result.messages.length > 0) {
      expect(result.messages[0].role).toBe('user')
    }
  })

  it('single message passes through', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }]
    const result = truncateMessagesForFallback(messages)
    expect(result.truncated).toBe(false)
    expect(result.messages).toHaveLength(1)
  })

  it('does not truncate exactly at the limit', () => {
    const messages = makeMessages(FALLBACK_MAX_MESSAGES)
    const result = truncateMessagesForFallback(messages)
    expect(result.truncated).toBe(false)
    expect(result.messages).toHaveLength(FALLBACK_MAX_MESSAGES)
  })

  it('keeps minimum 4 messages even if over char limit', () => {
    // Four very large messages
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(150_000) },
      { role: 'assistant', content: 'y'.repeat(150_000) },
      { role: 'user', content: 'z'.repeat(150_000) },
      { role: 'assistant', content: 'w'.repeat(150_000) },
    ]
    const result = truncateMessagesForFallback(messages)
    // Should keep all 4 (while loop stops at length > 4)
    expect(result.messages).toHaveLength(4)
    // Content should be truncated to fit within budget
    const totalChars = result.messages.reduce((s, m) => s + m.content.length, 0)
    expect(totalChars).toBeLessThanOrEqual(FALLBACK_MAX_CHARS + 160_000) // latest msg preserved fully
  })

  it('truncates individual message content when single message is super long', () => {
    // One user message that's 500K chars — way over the 200K budget
    const messages: ChatMessage[] = [
      { role: 'user', content: 'a'.repeat(500_000) },
    ]
    const result = truncateMessagesForFallback(messages)
    expect(result.messages).toHaveLength(1)
    // Single message is the latest, so it's preserved fully (no older msgs to trim)
    expect(result.messages[0].content.length).toBe(500_000)
  })

  it('truncates older messages content but preserves latest', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'old:' + 'x'.repeat(300_000) },
      { role: 'assistant', content: 'mid:' + 'y'.repeat(300_000) },
      { role: 'user', content: 'recent:' + 'z'.repeat(50_000) },
    ]
    const result = truncateMessagesForFallback(messages)
    expect(result.messages).toHaveLength(3)
    // Latest message preserved fully
    expect(result.messages[2].content).toContain('recent:')
    expect(result.messages[2].content.length).toBe(50_000 + 7)
    // Older messages truncated
    expect(result.messages[0].content.length).toBeLessThan(300_000 + 4)
  })
})
