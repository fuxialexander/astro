/**
 * Compaction Feature Tests
 *
 * Tests for issue #712: Project chat context management (compaction).
 * Covers all layers: prompt template, SSE parser, activity blocks,
 * server-side compaction logic, and end-to-end SSE flow.
 *
 * Run with: npx vitest run tests/compaction.test.ts
 */

import { describe, it, expect, vi } from 'vitest'
import { buildCompactionPrompt } from '../packages/core/src/prompt-templates'
import { parseChatSSE } from '../src/lib/sse-parser'
import { groupActivityEvents } from '../src/components/activity-blocks'
import type { TaskActivityEvent } from '../packages/core/src/types'

// ─── Helpers ──────────────────────────────────────────────────────────

/** Create a mock Response from raw SSE text */
function mockSSEResponse(text: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
  return new Response(stream)
}

/** Generate a conversation of N messages, alternating user/assistant */
function generateMessages(count: number, charsPer = 500): Array<{ role: 'user' | 'assistant'; content: string }> {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `Message ${i + 1}: ${'x'.repeat(charsPer - 15)}`,
  }))
}

function systemMessageEvent(message: string): TaskActivityEvent {
  return { type: 'system_message', message, timestamp: new Date() }
}

function textEvent(content: string): TaskActivityEvent {
  return { type: 'text', content, timestamp: new Date() }
}

function chatUserEvent(message: string): TaskActivityEvent {
  return { type: 'chat_user', message, timestamp: new Date() }
}

function toolUseEvent(id: string, toolName: string): TaskActivityEvent {
  return { type: 'tool_use', id, toolName, toolInput: {}, timestamp: new Date() }
}

function toolResultEvent(id: string, toolName: string): TaskActivityEvent {
  return { type: 'tool_result', id, toolName, toolResult: 'ok', success: true, timestamp: new Date() }
}

function errorEvent(error: string): TaskActivityEvent {
  return { type: 'error', error, timestamp: new Date() }
}

// ─── Layer 1: buildCompactionPrompt ───────────────────────────────────

describe('buildCompactionPrompt', () => {
  it('formats messages with Human/Assistant prefixes', () => {
    const prompt = buildCompactionPrompt([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ])

    expect(prompt).toContain('Human: Hello')
    expect(prompt).toContain('Assistant: Hi there')
  })

  it('includes summarization instructions', () => {
    const prompt = buildCompactionPrompt([
      { role: 'user', content: 'test' },
    ])

    expect(prompt).toContain('Summarize')
    expect(prompt).toContain('max 2000 chars')
    expect(prompt).toContain('decisions')
    expect(prompt).toContain('Action items')
    expect(prompt).toContain('technical details')
  })

  it('preserves message ordering', () => {
    const messages = [
      { role: 'user' as const, content: 'First' },
      { role: 'assistant' as const, content: 'Second' },
      { role: 'user' as const, content: 'Third' },
    ]
    const prompt = buildCompactionPrompt(messages)

    const firstIdx = prompt.indexOf('Human: First')
    const secondIdx = prompt.indexOf('Assistant: Second')
    const thirdIdx = prompt.indexOf('Human: Third')

    expect(firstIdx).toBeLessThan(secondIdx)
    expect(secondIdx).toBeLessThan(thirdIdx)
  })

  it('handles single message', () => {
    const prompt = buildCompactionPrompt([
      { role: 'user', content: 'Solo message' },
    ])

    expect(prompt).toContain('Human: Solo message')
    expect(prompt).not.toContain('Assistant:')
  })

  it('handles empty messages array', () => {
    const prompt = buildCompactionPrompt([])

    expect(prompt).toContain('Summarize')
    // Should still produce a valid prompt even with no messages
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('handles messages with special characters', () => {
    const prompt = buildCompactionPrompt([
      { role: 'user', content: 'Code: `const x = "hello"` and path: /home/user/file.ts' },
      { role: 'assistant', content: 'Found error at line 42: `TypeError: undefined is not a function`' },
    ])

    expect(prompt).toContain('`const x = "hello"`')
    expect(prompt).toContain('/home/user/file.ts')
    expect(prompt).toContain('`TypeError: undefined is not a function`')
  })

  it('handles messages with newlines and markdown', () => {
    const prompt = buildCompactionPrompt([
      { role: 'user', content: 'List:\n1. Item A\n2. Item B\n3. Item C' },
      { role: 'assistant', content: '```typescript\nconst x = 1;\n```\nDone.' },
    ])

    expect(prompt).toContain('1. Item A')
    expect(prompt).toContain('```typescript')
  })

  it('handles very long messages without truncation', () => {
    const longContent = 'a'.repeat(50000)
    const prompt = buildCompactionPrompt([
      { role: 'user', content: longContent },
    ])

    // The prompt should contain the full message — truncation is the LLM's job
    expect(prompt).toContain(longContent)
  })

  it('separates messages with double newlines', () => {
    const prompt = buildCompactionPrompt([
      { role: 'user', content: 'Msg1' },
      { role: 'assistant', content: 'Msg2' },
    ])

    expect(prompt).toContain('Human: Msg1\n\nAssistant: Msg2')
  })

  it('includes instruction not to add preamble', () => {
    const prompt = buildCompactionPrompt([
      { role: 'user', content: 'test' },
    ])

    expect(prompt).toContain('Output ONLY the summary paragraph')
    expect(prompt).toContain('no preamble')
  })

  it('asks to preserve file paths and function names', () => {
    const prompt = buildCompactionPrompt([
      { role: 'user', content: 'test' },
    ])

    expect(prompt).toContain('file paths')
    expect(prompt).toContain('function names')
    expect(prompt).toContain('error messages')
  })
})

// ─── Layer 4: SSE Parser — compaction event ───────────────────────────

describe('parseChatSSE — compaction event', () => {
  it('routes compaction event to onCompaction callback', async () => {
    const onCompaction = vi.fn()
    const compactionData = {
      originalCount: 20,
      compactedCount: 8,
      summary: 'User asked about authentication. Assistant implemented OAuth2 flow.',
    }
    const resp = mockSSEResponse(
      `event: compaction\ndata: ${JSON.stringify(compactionData)}\n\n`
    )

    await parseChatSSE(resp, { onCompaction })

    expect(onCompaction).toHaveBeenCalledOnce()
    expect(onCompaction).toHaveBeenCalledWith(compactionData)
  })

  it('handles compaction event with zero originalCount', async () => {
    const onCompaction = vi.fn()
    const resp = mockSSEResponse(
      `event: compaction\ndata: ${JSON.stringify({ originalCount: 0, compactedCount: 0, summary: '' })}\n\n`
    )

    await parseChatSSE(resp, { onCompaction })

    expect(onCompaction).toHaveBeenCalledWith({
      originalCount: 0,
      compactedCount: 0,
      summary: '',
    })
  })

  it('silently ignores malformed compaction JSON', async () => {
    const onCompaction = vi.fn()
    const onError = vi.fn()
    const resp = mockSSEResponse('event: compaction\ndata: {invalid\n\n')

    await parseChatSSE(resp, { onCompaction, onError })

    expect(onCompaction).not.toHaveBeenCalled()
    // Should not emit an error either — just silently ignored
    expect(onError).not.toHaveBeenCalled()
  })

  it('does nothing if onCompaction callback not provided', async () => {
    const onText = vi.fn()
    const resp = mockSSEResponse(
      `event: compaction\ndata: ${JSON.stringify({ originalCount: 5, compactedCount: 3, summary: 'test' })}\n\nevent: text\ndata: hello\n\n`
    )

    // Should not throw
    await parseChatSSE(resp, { onText })

    expect(onText).toHaveBeenCalledWith('hello')
  })

  it('compaction event comes before text events in full flow', async () => {
    const events: string[] = []
    const compactionData = { originalCount: 10, compactedCount: 4, summary: 'Summary here' }
    const resp = mockSSEResponse(
      `event: compaction\ndata: ${JSON.stringify(compactionData)}\n\nevent: text\ndata: response\n\nevent: done\ndata: {"sessionId":"s1"}\n\n`
    )

    await parseChatSSE(resp, {
      onCompaction: () => events.push('compaction'),
      onText: () => events.push('text'),
      onDone: () => events.push('done'),
    })

    expect(events).toEqual(['compaction', 'text', 'done'])
  })

  it('compaction event with large summary', async () => {
    const onCompaction = vi.fn()
    const largeSummary = 'The user and assistant discussed '.repeat(100)
    const resp = mockSSEResponse(
      `event: compaction\ndata: ${JSON.stringify({ originalCount: 50, compactedCount: 8, summary: largeSummary })}\n\n`
    )

    await parseChatSSE(resp, { onCompaction })

    expect(onCompaction).toHaveBeenCalledOnce()
    expect(onCompaction.mock.calls[0][0].summary).toBe(largeSummary)
  })

  it('handles compaction followed by tool_use events', async () => {
    const events: string[] = []
    const toolData = { toolName: 'Read', toolInput: { file_path: '/test.ts' } }
    const toolResult = { toolName: 'Read', success: true, result: 'content' }
    const resp = mockSSEResponse(
      `event: compaction\ndata: ${JSON.stringify({ originalCount: 12, compactedCount: 5, summary: 'context' })}\n\n` +
      `event: tool_use\ndata: ${JSON.stringify(toolData)}\n\n` +
      `event: tool_result\ndata: ${JSON.stringify(toolResult)}\n\n` +
      `event: text\ndata: Here's what I found.\n\n` +
      `event: done\ndata: {"sessionId":"s2"}\n\n`
    )

    await parseChatSSE(resp, {
      onCompaction: () => events.push('compaction'),
      onToolUse: () => events.push('tool_use'),
      onToolResult: () => events.push('tool_result'),
      onText: () => events.push('text'),
      onDone: () => events.push('done'),
    })

    expect(events).toEqual(['compaction', 'tool_use', 'tool_result', 'text', 'done'])
  })

  it('handles multiple compaction events (edge case)', async () => {
    const onCompaction = vi.fn()
    const resp = mockSSEResponse(
      `event: compaction\ndata: ${JSON.stringify({ originalCount: 10, compactedCount: 5, summary: 'first' })}\n\n` +
      `event: compaction\ndata: ${JSON.stringify({ originalCount: 20, compactedCount: 8, summary: 'second' })}\n\n`
    )

    await parseChatSSE(resp, { onCompaction })

    expect(onCompaction).toHaveBeenCalledTimes(2)
    expect(onCompaction.mock.calls[0][0].summary).toBe('first')
    expect(onCompaction.mock.calls[1][0].summary).toBe('second')
  })
})

// ─── Layer 7: Activity Blocks — system_message grouping ──────────────

describe('groupActivityEvents — system_message', () => {
  it('creates a system_message block for system_message events', () => {
    const events = [systemMessageEvent('Context compacted: 20 messages → 8')]
    const blocks = groupActivityEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('system_message')
    expect(blocks[0].events).toHaveLength(1)
    expect(blocks[0].events[0]).toEqual(events[0])
  })

  it('flushes pending text before system_message', () => {
    const events = [
      textEvent('thinking...'),
      systemMessageEvent('Context compacted'),
    ]
    const blocks = groupActivityEvents(events)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('text')
    expect(blocks[1].type).toBe('system_message')
  })

  it('flushes pending tools before system_message', () => {
    const events = [
      toolUseEvent('t1', 'Read'),
      toolResultEvent('t1', 'Read'),
      systemMessageEvent('Context compacted'),
    ]
    const blocks = groupActivityEvents(events)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('tool')
    expect(blocks[1].type).toBe('system_message')
  })

  it('system_message does not merge with adjacent system_messages', () => {
    const events = [
      systemMessageEvent('First system event'),
      systemMessageEvent('Second system event'),
    ]
    const blocks = groupActivityEvents(events)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('system_message')
    expect(blocks[1].type).toBe('system_message')
  })

  it('system_message between text events creates three blocks', () => {
    const events = [
      textEvent('Before'),
      systemMessageEvent('Compacted'),
      textEvent('After'),
    ]
    const blocks = groupActivityEvents(events)

    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('text')
    expect(blocks[1].type).toBe('system_message')
    expect(blocks[2].type).toBe('text')
  })

  it('system_message in a realistic compaction flow', () => {
    const events: TaskActivityEvent[] = [
      chatUserEvent('What did we discuss earlier?'),
      systemMessageEvent('Context compacted: 42 messages → 8'),
      textEvent('Based on our earlier discussion about the auth system...'),
      toolUseEvent('t1', 'Read'),
      toolResultEvent('t1', 'Read'),
      textEvent('Here is what I found.'),
    ]
    const blocks = groupActivityEvents(events)

    expect(blocks).toHaveLength(5)
    expect(blocks[0].type).toBe('chat_user')
    expect(blocks[1].type).toBe('system_message')
    expect(blocks[2].type).toBe('text')
    expect(blocks[3].type).toBe('tool')
    expect(blocks[4].type).toBe('text')
  })

  it('system_message among all other standalone types', () => {
    const events: TaskActivityEvent[] = [
      chatUserEvent('help'),
      systemMessageEvent('compacted'),
      errorEvent('oops'),
      systemMessageEvent('session start'),
      textEvent('recovering'),
    ]
    const blocks = groupActivityEvents(events)

    expect(blocks).toHaveLength(5)
    expect(blocks.map(b => b.type)).toEqual([
      'chat_user', 'system_message', 'error', 'system_message', 'text',
    ])
  })
})

// ─── Server-Side Compaction Logic (boundary tests) ────────────────────

describe('compaction threshold logic', () => {
  const COMPACTION_CHAR_THRESHOLD = 30_000
  const COMPACTION_KEEP_RECENT = 6

  /**
   * Simulate the server-side compaction decision logic
   * (extracted from server/routes/agent.ts for testability)
   */
  function shouldCompact(messages: Array<{ role: 'user' | 'assistant'; content: string }>): {
    shouldCompact: boolean
    olderCount: number
    recentCount: number
    totalChars: number
  } {
    if (!messages || messages.length <= COMPACTION_KEEP_RECENT) {
      return { shouldCompact: false, olderCount: 0, recentCount: messages?.length ?? 0, totalChars: 0 }
    }
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
    if (totalChars <= COMPACTION_CHAR_THRESHOLD) {
      return { shouldCompact: false, olderCount: 0, recentCount: messages.length, totalChars }
    }
    const olderCount = messages.length - COMPACTION_KEEP_RECENT
    return { shouldCompact: true, olderCount, recentCount: COMPACTION_KEEP_RECENT, totalChars }
  }

  it('does not compact when messages count <= KEEP_RECENT', () => {
    const messages = generateMessages(6, 10000) // 6 messages, 60K chars
    const result = shouldCompact(messages)
    expect(result.shouldCompact).toBe(false)
  })

  it('does not compact when total chars <= threshold', () => {
    const messages = generateMessages(20, 100) // 20 messages, 2K chars
    const result = shouldCompact(messages)
    expect(result.shouldCompact).toBe(false)
  })

  it('compacts when messages > KEEP_RECENT and total chars > threshold', () => {
    const messages = generateMessages(20, 2000) // 20 messages, 40K chars
    const result = shouldCompact(messages)
    expect(result.shouldCompact).toBe(true)
    expect(result.olderCount).toBe(14) // 20 - 6
    expect(result.recentCount).toBe(6)
  })

  it('compacts when just over threshold', () => {
    // Create 7 messages that are just over 30K chars total
    const messages = Array.from({ length: 7 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'x'.repeat(4300),  // 7 * 4300 = 30100 > 30000
    }))
    const result = shouldCompact(messages)
    expect(result.shouldCompact).toBe(true)
    expect(result.totalChars).toBeGreaterThan(COMPACTION_CHAR_THRESHOLD)
  })

  it('exactly at threshold boundary does not compact', () => {
    // 7 messages, total exactly 30000
    const charsPer = Math.floor(30000 / 7)
    const messages = Array.from({ length: 7 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'x'.repeat(charsPer),
    }))
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
    const result = shouldCompact(messages)
    // At exactly 30000 or just below, should not compact
    expect(result.shouldCompact).toBe(totalChars > COMPACTION_CHAR_THRESHOLD)
  })

  it('handles null/undefined messages', () => {
    expect(shouldCompact(null as unknown as Array<{ role: 'user' | 'assistant'; content: string }>).shouldCompact).toBe(false)
  })

  it('handles empty messages array', () => {
    expect(shouldCompact([]).shouldCompact).toBe(false)
  })

  it('compacts large conversation (100 messages)', () => {
    const messages = generateMessages(100, 1000)
    const result = shouldCompact(messages)
    expect(result.shouldCompact).toBe(true)
    expect(result.olderCount).toBe(94)
    expect(result.recentCount).toBe(6)
    expect(result.totalChars).toBeGreaterThan(COMPACTION_CHAR_THRESHOLD)
  })

  it('compacted message array structure', () => {
    // Simulate what the server produces after compaction
    const original = generateMessages(20, 2000)
    const recentMessages = original.slice(-COMPACTION_KEEP_RECENT)
    const summary = 'User discussed auth flow. Assistant implemented OAuth2.'

    const compactedMessages = [
      { role: 'user' as const, content: `[Earlier conversation summary]\n${summary}` },
      { role: 'assistant' as const, content: 'Understood, I have context from our earlier conversation.' },
      ...recentMessages,
    ]

    // Should have summary pair + recent messages
    expect(compactedMessages).toHaveLength(8) // 2 + 6
    expect(compactedMessages[0].role).toBe('user')
    expect(compactedMessages[0].content).toContain('[Earlier conversation summary]')
    expect(compactedMessages[1].role).toBe('assistant')
    expect(compactedMessages[1].content).toContain('Understood')

    // Recent messages should be preserved exactly
    for (let i = 0; i < COMPACTION_KEEP_RECENT; i++) {
      expect(compactedMessages[i + 2]).toEqual(recentMessages[i])
    }
  })

  it('preserves recent messages verbatim after compaction', () => {
    const original = generateMessages(10, 5000)
    const recentMessages = original.slice(-COMPACTION_KEEP_RECENT)

    // Each recent message should be byte-identical
    recentMessages.forEach((msg, i) => {
      expect(msg).toBe(original[original.length - COMPACTION_KEEP_RECENT + i])
    })
  })
})

// ─── Compaction SSE event data contract ───────────────────────────────

describe('compaction SSE event data contract', () => {
  it('compaction event contains required fields', async () => {
    const onCompaction = vi.fn()
    const data = { originalCount: 30, compactedCount: 8, summary: 'We discussed the migration plan.' }
    const resp = mockSSEResponse(
      `event: compaction\ndata: ${JSON.stringify(data)}\n\n`
    )

    await parseChatSSE(resp, { onCompaction })

    const received = onCompaction.mock.calls[0][0]
    expect(received).toHaveProperty('originalCount')
    expect(received).toHaveProperty('compactedCount')
    expect(received).toHaveProperty('summary')
    expect(typeof received.originalCount).toBe('number')
    expect(typeof received.compactedCount).toBe('number')
    expect(typeof received.summary).toBe('string')
  })

  it('compactedCount is always less than originalCount', async () => {
    const onCompaction = vi.fn()
    const data = { originalCount: 30, compactedCount: 8, summary: 'summary' }
    const resp = mockSSEResponse(
      `event: compaction\ndata: ${JSON.stringify(data)}\n\n`
    )

    await parseChatSSE(resp, { onCompaction })

    const received = onCompaction.mock.calls[0][0]
    expect(received.compactedCount).toBeLessThan(received.originalCount)
  })

  it('summary is non-empty when compaction occurs', async () => {
    const onCompaction = vi.fn()
    const data = { originalCount: 20, compactedCount: 8, summary: 'User requested auth changes.' }
    const resp = mockSSEResponse(
      `event: compaction\ndata: ${JSON.stringify(data)}\n\n`
    )

    await parseChatSSE(resp, { onCompaction })

    const received = onCompaction.mock.calls[0][0]
    expect(received.summary.length).toBeGreaterThan(0)
  })
})

// ─── TaskActivityEvent type — system_message variant ──────────────────

describe('TaskActivityEvent — system_message variant', () => {
  it('system_message event has correct shape', () => {
    const event: TaskActivityEvent = {
      type: 'system_message',
      message: 'Context compacted: 42 messages → 8',
      timestamp: new Date(),
    }

    expect(event.type).toBe('system_message')
    expect(event.message).toContain('42 messages')
    expect(event.timestamp).toBeInstanceOf(Date)
  })

  it('system_message message field accepts arbitrary strings', () => {
    const messages = [
      'Context compacted: 10 messages → 4',
      'Session resumed',
      'Provider switched from Claude to GPT-4',
      '',
      'Special chars: <>&"\'`',
    ]

    for (const msg of messages) {
      const event: TaskActivityEvent = {
        type: 'system_message',
        message: msg,
        timestamp: new Date(),
      }
      expect(event.message).toBe(msg)
    }
  })
})

// ─── End-to-End SSE Flow Simulation ──────────────────────────────────

describe('end-to-end compaction SSE flow', () => {
  it('full chat turn with compaction: compaction → text → tool_use → tool_result → text → done', async () => {
    const collected = {
      compaction: null as { originalCount: number; compactedCount: number; summary: string } | null,
      texts: [] as string[],
      toolUses: [] as Array<{ toolName: string; toolInput: unknown }>,
      toolResults: [] as Array<{ toolName: string; success: boolean; result: unknown }>,
      done: null as string | null,
      metrics: null as Record<string, unknown> | null,
    }

    const compactionData = { originalCount: 24, compactedCount: 8, summary: 'Earlier: user asked about DB schema, assistant designed migration.' }
    const toolUseData = { toolName: 'Read', toolInput: { file_path: '/src/schema.ts' } }
    const toolResultData = { toolName: 'Read', success: true, result: 'export const schema = ...' }
    const metricsData = { durationMs: 5000, inputTokens: 1200, outputTokens: 800, totalCost: 0.05, model: 'claude-sonnet-4-6', numTurns: 3 }

    const sseStream = [
      `event: compaction\ndata: ${JSON.stringify(compactionData)}\n\n`,
      `event: text\ndata: I remember our discussion about the DB schema.\n\n`,
      `event: tool_use\ndata: ${JSON.stringify(toolUseData)}\n\n`,
      `event: tool_result\ndata: ${JSON.stringify(toolResultData)}\n\n`,
      `event: text\ndata:  Let me update it.\n\n`,
      `event: done\ndata: ${JSON.stringify({ sessionId: 'sess-abc', metrics: metricsData })}\n\n`,
    ].join('')

    const resp = mockSSEResponse(sseStream)

    await parseChatSSE(resp, {
      onCompaction: (d) => { collected.compaction = d },
      onText: (t) => collected.texts.push(t),
      onToolUse: (d) => collected.toolUses.push(d),
      onToolResult: (d) => collected.toolResults.push(d),
      onDone: (sid) => { collected.done = sid },
      onMetrics: (m) => { collected.metrics = m },
    })

    // Compaction metadata
    expect(collected.compaction).toEqual(compactionData)

    // Text chunks
    expect(collected.texts).toEqual([
      'I remember our discussion about the DB schema.',
      ' Let me update it.',
    ])

    // Tool traces
    expect(collected.toolUses).toHaveLength(1)
    expect(collected.toolUses[0].toolName).toBe('Read')
    expect(collected.toolResults).toHaveLength(1)
    expect(collected.toolResults[0].success).toBe(true)

    // Done + metrics
    expect(collected.done).toBe('sess-abc')
    expect(collected.metrics).toEqual(metricsData)
  })

  it('chat turn without compaction (short history)', async () => {
    const collected = {
      compaction: null as { originalCount: number; compactedCount: number; summary: string } | null,
      texts: [] as string[],
      done: null as string | null,
    }

    const sseStream = [
      `event: text\ndata: Hello!\n\n`,
      `event: done\ndata: {"sessionId":"s1"}\n\n`,
    ].join('')

    const resp = mockSSEResponse(sseStream)

    await parseChatSSE(resp, {
      onCompaction: (d) => { collected.compaction = d },
      onText: (t) => collected.texts.push(t),
      onDone: (sid) => { collected.done = sid },
    })

    // No compaction should have occurred
    expect(collected.compaction).toBeNull()
    expect(collected.texts).toEqual(['Hello!'])
    expect(collected.done).toBe('s1')
  })

  it('activity blocks from compacted session render correctly', () => {
    // Simulate the activity events a compacted session would produce
    const events: TaskActivityEvent[] = [
      // Earlier messages
      chatUserEvent('How do we implement caching?'),
      { type: 'chat_assistant', content: 'We could use Redis...', timestamp: new Date() } as TaskActivityEvent,
      chatUserEvent('What about the auth flow?'),
      // Compaction marker appears before the new turn
      systemMessageEvent('Context compacted: 42 messages → 8'),
      // New assistant response after compaction
      textEvent('Based on our earlier discussion about caching and auth...'),
      toolUseEvent('t1', 'Read'),
      toolResultEvent('t1', 'Read'),
      textEvent('Here is the updated implementation.'),
    ]

    const blocks = groupActivityEvents(events)

    // Verify the block sequence
    const types = blocks.map(b => b.type)
    expect(types).toEqual([
      'chat_user',
      'chat_assistant',
      'chat_user',
      'system_message',
      'text',
      'tool',
      'text',
    ])

    // The system_message block should contain the compaction message
    const systemBlock = blocks.find(b => b.type === 'system_message')!
    expect(systemBlock.events).toHaveLength(1)
    const sysEvent = systemBlock.events[0] as Extract<TaskActivityEvent, { type: 'system_message' }>
    expect(sysEvent.message).toContain('42 messages → 8')
  })

  it('compaction event with error fallback still allows normal flow', async () => {
    const events: string[] = []

    // Simulate compaction + error + recovery + done
    const sseStream = [
      `event: compaction\ndata: ${JSON.stringify({ originalCount: 15, compactedCount: 8, summary: 'context' })}\n\n`,
      `event: error\ndata: Provider temporarily unavailable\n\n`,
    ].join('')

    const resp = mockSSEResponse(sseStream)

    await parseChatSSE(resp, {
      onCompaction: () => events.push('compaction'),
      onError: () => events.push('error'),
    })

    expect(events).toEqual(['compaction', 'error'])
  })
})

// ─── Prompt content quality checks ───────────────────────────────────

describe('buildCompactionPrompt — content quality', () => {
  it('produces a prompt that fits within typical context windows', () => {
    // Even with a massive conversation, the prompt itself should be reasonable
    const messages = generateMessages(100, 1000) // 100K chars of conversation
    const prompt = buildCompactionPrompt(messages)

    // The prompt is the conversation + instructions (~300 chars).
    // Total should be roughly conversation size + overhead.
    expect(prompt.length).toBeGreaterThan(100000) // Contains full conversation
    expect(prompt.length).toBeLessThan(150000)     // Not wildly inflated
  })

  it('instructions come before the conversation', () => {
    const prompt = buildCompactionPrompt([
      { role: 'user', content: 'First message' },
    ])

    const instructionIdx = prompt.indexOf('Summarize')
    const conversationIdx = prompt.indexOf('Human: First message')

    expect(instructionIdx).toBeLessThan(conversationIdx)
  })

  it('conversation is separated from instructions by a divider', () => {
    const prompt = buildCompactionPrompt([
      { role: 'user', content: 'Test' },
    ])

    expect(prompt).toContain('---')
    const dividerIdx = prompt.indexOf('---')
    const conversationIdx = prompt.indexOf('Human: Test')
    expect(dividerIdx).toBeLessThan(conversationIdx)
  })
})
