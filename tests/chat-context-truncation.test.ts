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
    // After truncation, total should be within limit (or close — 2 messages minimum)
    expect(totalChars).toBeLessThanOrEqual(FALLBACK_MAX_CHARS + 60_000) // allow for min 2 msgs
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

  it('keeps minimum 2 messages even if over char limit', () => {
    // Two very large messages
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(300_000) },
      { role: 'assistant', content: 'y'.repeat(300_000) },
    ]
    const result = truncateMessagesForFallback(messages)
    // Should keep both (while loop stops at length > 2)
    expect(result.messages).toHaveLength(2)
  })
})
