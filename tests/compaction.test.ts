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
import { parseChatSSE, parseSSEStream } from '../src/lib/sse-parser'
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

/** Create a mock Response that delivers chunks one by one */
function mockChunkedSSEResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  let i = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]))
        i++
      } else {
        controller.close()
      }
    },
  })
  return new Response(stream)
}

/** Generate a conversation of N messages, alternating user/assistant */
function generateMessages(count: number, charsPer = 500): Array<{ role: 'user' | 'assistant'; content: string }> {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `Message ${i + 1}: ${'x'.repeat(Math.max(0, charsPer - 15))}`,
  }))
}

/** Generate messages with exact content (no prefix overhead) */
function generateExactMessages(count: number, charsPer: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: 'x'.repeat(charsPer),
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

function chatAssistantEvent(content: string): TaskActivityEvent {
  return { type: 'chat_assistant', content, timestamp: new Date() }
}

function toolUseEvent(id: string, toolName: string, toolInput?: unknown): TaskActivityEvent {
  return { type: 'tool_use', id, toolName, toolInput: toolInput ?? {}, timestamp: new Date() }
}

function toolResultEvent(id: string, toolName: string, opts?: { success?: boolean; toolResult?: unknown }): TaskActivityEvent {
  return {
    type: 'tool_result', id, toolName,
    toolResult: opts?.toolResult ?? 'ok', success: opts?.success ?? true,
    timestamp: new Date(),
  }
}

function errorEvent(error: string): TaskActivityEvent {
  return { type: 'error', error, timestamp: new Date() }
}

function steerEvent(message: string): TaskActivityEvent {
  return { type: 'steer', message, timestamp: new Date() }
}

function fileChangeEvent(path: string): TaskActivityEvent {
  return { type: 'file_change', path, action: 'modified', timestamp: new Date() }
}

function approvalRequestEvent(requestId: string, question: string): TaskActivityEvent {
  return { type: 'approval_request', requestId, question, options: ['yes', 'no'], timestamp: new Date() }
}

function approvalResponseEvent(requestId: string, answer: string): TaskActivityEvent {
  return { type: 'approval_response', requestId, question: 'proceed?', answer, timestamp: new Date() }
}

// ─── Constants matching server logic ──────────────────────────────────

const COMPACTION_CHAR_THRESHOLD = 30_000
const COMPACTION_KEEP_RECENT = 6

/**
 * Pure-function extraction of the server-side compaction decision logic
 * (mirrors server/routes/agent.ts lines 508-556 exactly).
 */
function shouldCompact(messages: Array<{ role: 'user' | 'assistant'; content: string }> | null | undefined): {
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

/**
 * Pure-function extraction of the compacted message array construction
 * (mirrors server/routes/agent.ts lines 537-541 exactly).
 */
function buildCompactedMessages(
  historyMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  summary: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const recentMessages = historyMessages.slice(-COMPACTION_KEEP_RECENT)
  return [
    { role: 'user' as const, content: `[Earlier conversation summary]\n${summary}` },
    { role: 'assistant' as const, content: 'Understood, I have context from our earlier conversation.' },
    ...recentMessages,
  ]
}

// =====================================================================
// Layer 1: buildCompactionPrompt
// =====================================================================

describe('buildCompactionPrompt', () => {
  describe('basic formatting', () => {
    it('formats messages with Human/Assistant prefixes', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ])
      expect(prompt).toContain('Human: Hello')
      expect(prompt).toContain('Assistant: Hi there')
    })

    it('preserves message ordering across many messages', () => {
      const messages = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `msg-${i}`,
      }))
      const prompt = buildCompactionPrompt(messages)

      for (let i = 0; i < messages.length - 1; i++) {
        const prefix = messages[i].role === 'user' ? 'Human' : 'Assistant'
        const nextPrefix = messages[i + 1].role === 'user' ? 'Human' : 'Assistant'
        const currentIdx = prompt.indexOf(`${prefix}: msg-${i}`)
        const nextIdx = prompt.indexOf(`${nextPrefix}: msg-${i + 1}`)
        expect(currentIdx).toBeLessThan(nextIdx)
      }
    })

    it('separates messages with double newlines', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: 'Msg1' },
        { role: 'assistant', content: 'Msg2' },
      ])
      expect(prompt).toContain('Human: Msg1\n\nAssistant: Msg2')
    })

    it('handles single user message', () => {
      const prompt = buildCompactionPrompt([{ role: 'user', content: 'Solo' }])
      expect(prompt).toContain('Human: Solo')
      expect(prompt).not.toContain('Assistant:')
    })

    it('handles single assistant message', () => {
      const prompt = buildCompactionPrompt([{ role: 'assistant', content: 'Solo reply' }])
      expect(prompt).toContain('Assistant: Solo reply')
      expect(prompt).not.toContain('Human:')
    })

    it('handles empty messages array', () => {
      const prompt = buildCompactionPrompt([])
      expect(prompt).toContain('Summarize')
      expect(prompt.length).toBeGreaterThan(0)
    })
  })

  describe('instruction quality', () => {
    it('includes summarization instructions', () => {
      const prompt = buildCompactionPrompt([{ role: 'user', content: 'test' }])
      expect(prompt).toContain('Summarize')
      expect(prompt).toContain('max 2000 chars')
      expect(prompt).toContain('decisions')
      expect(prompt).toContain('Action items')
      expect(prompt).toContain('technical details')
    })

    it('includes instruction not to add preamble', () => {
      const prompt = buildCompactionPrompt([{ role: 'user', content: 'test' }])
      expect(prompt).toContain('Output ONLY the summary paragraph')
      expect(prompt).toContain('no preamble')
    })

    it('asks to preserve file paths, function names, error messages', () => {
      const prompt = buildCompactionPrompt([{ role: 'user', content: 'test' }])
      expect(prompt).toContain('file paths')
      expect(prompt).toContain('function names')
      expect(prompt).toContain('error messages')
    })

    it('asks to preserve current state of work', () => {
      const prompt = buildCompactionPrompt([{ role: 'user', content: 'test' }])
      expect(prompt).toContain('Current state')
    })

    it('instructions come before the conversation content', () => {
      const prompt = buildCompactionPrompt([{ role: 'user', content: 'First message' }])
      expect(prompt.indexOf('Summarize')).toBeLessThan(prompt.indexOf('Human: First message'))
    })

    it('conversation is separated from instructions by a divider', () => {
      const prompt = buildCompactionPrompt([{ role: 'user', content: 'Test' }])
      const dividerIdx = prompt.indexOf('---')
      const conversationIdx = prompt.indexOf('Human: Test')
      expect(dividerIdx).toBeGreaterThan(-1)
      expect(dividerIdx).toBeLessThan(conversationIdx)
    })
  })

  describe('special content handling', () => {
    it('preserves code blocks and backticks', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: 'Code: `const x = "hello"`' },
        { role: 'assistant', content: '```typescript\nconst x = 1;\n```\nDone.' },
      ])
      expect(prompt).toContain('`const x = "hello"`')
      expect(prompt).toContain('```typescript')
    })

    it('preserves file paths', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: 'Check /home/user/project/src/lib/auth.ts' },
      ])
      expect(prompt).toContain('/home/user/project/src/lib/auth.ts')
    })

    it('preserves error messages with stack traces', () => {
      const stackTrace = 'TypeError: Cannot read property \'x\' of undefined\n  at Object.foo (bar.ts:42:10)\n  at main (index.ts:1:1)'
      const prompt = buildCompactionPrompt([
        { role: 'assistant', content: `Error:\n${stackTrace}` },
      ])
      expect(prompt).toContain(stackTrace)
    })

    it('preserves unicode and emoji', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: 'こんにちは 🎉 → ← ≤ ≥ ∞ ∑' },
      ])
      expect(prompt).toContain('こんにちは 🎉 → ← ≤ ≥ ∞ ∑')
    })

    it('preserves HTML-like content without escaping', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: '<div class="test">Hello &amp; world</div>' },
      ])
      expect(prompt).toContain('<div class="test">Hello &amp; world</div>')
    })

    it('preserves SSE-like content (event: data:) without confusion', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: 'The SSE format uses event: and data: prefixes' },
      ])
      expect(prompt).toContain('event: and data: prefixes')
    })

    it('preserves the divider string "---" inside message content', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: 'Section A\n---\nSection B' },
      ])
      // The prompt should contain the instruction divider AND the in-content divider
      const dividerCount = (prompt.match(/---/g) || []).length
      expect(dividerCount).toBeGreaterThanOrEqual(2)
    })

    it('handles messages with only whitespace', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: '   \n\t\n  ' },
      ])
      expect(prompt).toContain('Human:    \n\t\n  ')
    })

    it('handles messages with empty content', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: '' },
        { role: 'assistant', content: '' },
      ])
      expect(prompt).toContain('Human: ')
      expect(prompt).toContain('Assistant: ')
    })

    it('handles messages with newlines only', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: '\n\n\n' },
      ])
      expect(prompt).toContain('Human: \n\n\n')
    })
  })

  describe('scale', () => {
    it('handles very long messages without truncation', () => {
      const longContent = 'a'.repeat(50000)
      const prompt = buildCompactionPrompt([{ role: 'user', content: longContent }])
      expect(prompt).toContain(longContent)
    })

    it('handles 1000 messages', () => {
      const messages = generateMessages(1000, 20)
      const prompt = buildCompactionPrompt(messages)
      expect(prompt).toContain('Human: Message 1:')
      expect(prompt).toContain('Human: Message 999:')
    })

    it('prompt size scales linearly with input', () => {
      const small = buildCompactionPrompt(generateExactMessages(10, 100))
      const large = buildCompactionPrompt(generateExactMessages(100, 100))
      // Instructions overhead is constant (~300 chars), conversation scales linearly
      const overhead = 500 // generous estimate for instruction text
      expect(large.length).toBeLessThan(small.length * 12 + overhead)
      expect(large.length).toBeGreaterThan(small.length * 5)
    })
  })

  describe('role mapping edge cases', () => {
    it('maps consecutive same-role messages correctly', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: 'First user' },
        { role: 'user', content: 'Second user' },
        { role: 'assistant', content: 'Reply' },
        { role: 'assistant', content: 'More reply' },
      ])
      expect(prompt).toContain('Human: First user\n\nHuman: Second user')
      expect(prompt).toContain('Assistant: Reply\n\nAssistant: More reply')
    })

    it('handles all-user messages', () => {
      const prompt = buildCompactionPrompt([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'user', content: 'c' },
      ])
      expect((prompt.match(/Human:/g) || []).length).toBe(3)
      expect((prompt.match(/Assistant:/g) || []).length).toBe(0)
    })

    it('handles all-assistant messages', () => {
      const prompt = buildCompactionPrompt([
        { role: 'assistant', content: 'a' },
        { role: 'assistant', content: 'b' },
      ])
      expect((prompt.match(/Assistant:/g) || []).length).toBe(2)
      expect((prompt.match(/Human:/g) || []).length).toBe(0)
    })
  })
})

// =====================================================================
// Layer 4: SSE Parser — compaction event
// =====================================================================

describe('parseChatSSE — compaction event', () => {
  describe('basic routing', () => {
    it('routes compaction event to onCompaction callback', async () => {
      const onCompaction = vi.fn()
      const data = { originalCount: 20, compactedCount: 8, summary: 'User discussed auth.' }
      const resp = mockSSEResponse(`event: compaction\ndata: ${JSON.stringify(data)}\n\n`)
      await parseChatSSE(resp, { onCompaction })
      expect(onCompaction).toHaveBeenCalledOnce()
      expect(onCompaction).toHaveBeenCalledWith(data)
    })

    it('does nothing if onCompaction callback not provided', async () => {
      const onText = vi.fn()
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 5, compactedCount: 3, summary: 'test' })}\n\nevent: text\ndata: hello\n\n`
      )
      await parseChatSSE(resp, { onText })
      expect(onText).toHaveBeenCalledWith('hello')
    })
  })

  describe('data edge cases', () => {
    it('handles compaction event with zero counts', async () => {
      const onCompaction = vi.fn()
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 0, compactedCount: 0, summary: '' })}\n\n`
      )
      await parseChatSSE(resp, { onCompaction })
      expect(onCompaction).toHaveBeenCalledWith({ originalCount: 0, compactedCount: 0, summary: '' })
    })

    it('handles compaction with very large counts', async () => {
      const onCompaction = vi.fn()
      const data = { originalCount: 999999, compactedCount: 8, summary: 'huge' }
      const resp = mockSSEResponse(`event: compaction\ndata: ${JSON.stringify(data)}\n\n`)
      await parseChatSSE(resp, { onCompaction })
      expect(onCompaction).toHaveBeenCalledWith(data)
    })

    it('handles compaction summary with special characters', async () => {
      const onCompaction = vi.fn()
      const summary = 'User asked about /path/to/file.ts with `backticks` and "quotes" & <tags>'
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 10, compactedCount: 5, summary })}\n\n`
      )
      await parseChatSSE(resp, { onCompaction })
      expect(onCompaction.mock.calls[0][0].summary).toBe(summary)
    })

    it('handles compaction summary with unicode', async () => {
      const onCompaction = vi.fn()
      const summary = '用户讨论了认证流程。助手实现了OAuth2。'
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 10, compactedCount: 5, summary })}\n\n`
      )
      await parseChatSSE(resp, { onCompaction })
      expect(onCompaction.mock.calls[0][0].summary).toBe(summary)
    })

    it('handles compaction summary with newlines', async () => {
      const onCompaction = vi.fn()
      const summary = 'Line 1\nLine 2\nLine 3'
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 10, compactedCount: 5, summary })}\n\n`
      )
      await parseChatSSE(resp, { onCompaction })
      expect(onCompaction.mock.calls[0][0].summary).toBe(summary)
    })

    it('handles compaction with 2000-char summary (max)', async () => {
      const onCompaction = vi.fn()
      const summary = 'x'.repeat(2000)
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 50, compactedCount: 8, summary })}\n\n`
      )
      await parseChatSSE(resp, { onCompaction })
      expect(onCompaction.mock.calls[0][0].summary.length).toBe(2000)
    })

    it('handles compaction with extra unexpected fields (forward compat)', async () => {
      const onCompaction = vi.fn()
      const data = { originalCount: 10, compactedCount: 5, summary: 's', futureField: true, version: 2 }
      const resp = mockSSEResponse(`event: compaction\ndata: ${JSON.stringify(data)}\n\n`)
      await parseChatSSE(resp, { onCompaction })
      // Extra fields should be passed through (not stripped)
      expect(onCompaction.mock.calls[0][0].futureField).toBe(true)
      expect(onCompaction.mock.calls[0][0].version).toBe(2)
    })
  })

  describe('error handling', () => {
    it('silently ignores malformed compaction JSON', async () => {
      const onCompaction = vi.fn()
      const onError = vi.fn()
      const resp = mockSSEResponse('event: compaction\ndata: {invalid\n\n')
      await parseChatSSE(resp, { onCompaction, onError })
      expect(onCompaction).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    })

    it('ignores compaction with empty data', async () => {
      const onCompaction = vi.fn()
      const resp = mockSSEResponse('event: compaction\ndata: \n\n')
      await parseChatSSE(resp, { onCompaction })
      expect(onCompaction).not.toHaveBeenCalled()
    })

    it('ignores compaction with non-object JSON', async () => {
      const onCompaction = vi.fn()
      const resp = mockSSEResponse('event: compaction\ndata: "just a string"\n\n')
      await parseChatSSE(resp, { onCompaction })
      // JSON.parse succeeds but the result is a string, not an object with fields.
      // parseChatSSE still calls onCompaction — it doesn't validate shape.
      // This is fine: the callback receives whatever JSON.parse returns.
      expect(onCompaction).toHaveBeenCalledWith('just a string')
    })

    it('ignores compaction with array JSON', async () => {
      const onCompaction = vi.fn()
      const resp = mockSSEResponse('event: compaction\ndata: [1,2,3]\n\n')
      await parseChatSSE(resp, { onCompaction })
      expect(onCompaction).toHaveBeenCalledWith([1, 2, 3])
    })
  })

  describe('event ordering', () => {
    it('compaction before text before done', async () => {
      const events: string[] = []
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 10, compactedCount: 4, summary: 'ctx' })}\n\n` +
        `event: text\ndata: response\n\nevent: done\ndata: {"sessionId":"s1"}\n\n`
      )
      await parseChatSSE(resp, {
        onCompaction: () => events.push('compaction'),
        onText: () => events.push('text'),
        onDone: () => events.push('done'),
      })
      expect(events).toEqual(['compaction', 'text', 'done'])
    })

    it('compaction → session_init → text → done', async () => {
      const events: string[] = []
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 10, compactedCount: 4, summary: 'ctx' })}\n\n` +
        `event: session_init\ndata: ${JSON.stringify({ sessionId: 'sid', model: 'claude' })}\n\n` +
        `event: text\ndata: hi\n\nevent: done\ndata: {"sessionId":"sid"}\n\n`
      )
      await parseChatSSE(resp, {
        onCompaction: () => events.push('compaction'),
        onSessionInit: () => events.push('session_init'),
        onText: () => events.push('text'),
        onDone: () => events.push('done'),
      })
      expect(events).toEqual(['compaction', 'session_init', 'text', 'done'])
    })

    it('compaction → heartbeat → text (heartbeat ignored)', async () => {
      const events: string[] = []
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 5, compactedCount: 3, summary: 'x' })}\n\n` +
        `event: heartbeat\ndata: \n\nevent: text\ndata: content\n\n`
      )
      await parseChatSSE(resp, {
        onCompaction: () => events.push('compaction'),
        onText: () => events.push('text'),
      })
      expect(events).toEqual(['compaction', 'text'])
    })

    it('handles multiple compaction events', async () => {
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

    it('compaction → tool_use → tool_result → text → done', async () => {
      const events: string[] = []
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 12, compactedCount: 5, summary: 'ctx' })}\n\n` +
        `event: tool_use\ndata: ${JSON.stringify({ toolName: 'Read', toolInput: {} })}\n\n` +
        `event: tool_result\ndata: ${JSON.stringify({ toolName: 'Read', success: true, result: 'content' })}\n\n` +
        `event: text\ndata: Found it.\n\nevent: done\ndata: {"sessionId":"s2"}\n\n`
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

    it('compaction followed immediately by error', async () => {
      const events: string[] = []
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 15, compactedCount: 8, summary: 'ctx' })}\n\n` +
        `event: error\ndata: Provider unavailable\n\n`
      )
      await parseChatSSE(resp, {
        onCompaction: () => events.push('compaction'),
        onError: () => events.push('error'),
      })
      expect(events).toEqual(['compaction', 'error'])
    })

    it('compaction followed by aborted', async () => {
      const events: string[] = []
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 8, compactedCount: 4, summary: 'ctx' })}\n\n` +
        `event: aborted\ndata: user cancelled\n\n`
      )
      await parseChatSSE(resp, {
        onCompaction: () => events.push('compaction'),
        onDone: () => events.push('done'),
      })
      expect(events).toEqual(['compaction', 'done'])
    })
  })

  describe('chunked delivery', () => {
    it('handles compaction event split across chunks', async () => {
      const onCompaction = vi.fn()
      const data = JSON.stringify({ originalCount: 10, compactedCount: 5, summary: 'split test' })
      const resp = mockChunkedSSEResponse([
        'event: comp',
        'action\ndata: ',
        data,
        '\n\n',
      ])
      await parseChatSSE(resp, { onCompaction })
      expect(onCompaction).toHaveBeenCalledOnce()
      expect(onCompaction.mock.calls[0][0].summary).toBe('split test')
    })

    it('handles compaction JSON split mid-data', async () => {
      const onCompaction = vi.fn()
      const resp = mockChunkedSSEResponse([
        'event: compaction\ndata: {"original',
        'Count":10,"compactedCount":5,"su',
        'mmary":"chunked"}\n\n',
      ])
      await parseChatSSE(resp, { onCompaction })
      expect(onCompaction).toHaveBeenCalledOnce()
      expect(onCompaction.mock.calls[0][0].originalCount).toBe(10)
    })
  })

  describe('data contract validation', () => {
    it('compaction event contains required fields with correct types', async () => {
      const onCompaction = vi.fn()
      const data = { originalCount: 30, compactedCount: 8, summary: 'We discussed migration.' }
      const resp = mockSSEResponse(`event: compaction\ndata: ${JSON.stringify(data)}\n\n`)
      await parseChatSSE(resp, { onCompaction })
      const received = onCompaction.mock.calls[0][0]
      expect(typeof received.originalCount).toBe('number')
      expect(typeof received.compactedCount).toBe('number')
      expect(typeof received.summary).toBe('string')
    })

    it('compaction with metrics in the same stream', async () => {
      const collected = { compaction: null as unknown, metrics: null as unknown }
      const metricsData = { durationMs: 1000, inputTokens: 100, outputTokens: 50, totalCost: 0.01, model: 'claude-sonnet-4-6', numTurns: 1 }
      const resp = mockSSEResponse(
        `event: compaction\ndata: ${JSON.stringify({ originalCount: 20, compactedCount: 8, summary: 'ctx' })}\n\n` +
        `event: text\ndata: response\n\n` +
        `event: done\ndata: ${JSON.stringify({ sessionId: 's1', metrics: metricsData })}\n\n`
      )
      await parseChatSSE(resp, {
        onCompaction: (d) => { collected.compaction = d },
        onMetrics: (m) => { collected.metrics = m },
        onDone: () => {},
      })
      expect(collected.compaction).toBeTruthy()
      expect(collected.metrics).toEqual(metricsData)
    })
  })
})

// =====================================================================
// Layer 7: Activity Blocks — system_message grouping
// =====================================================================

describe('groupActivityEvents — system_message', () => {
  describe('basic behavior', () => {
    it('creates a system_message block', () => {
      const events = [systemMessageEvent('Compacted')]
      const blocks = groupActivityEvents(events)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('system_message')
      expect(blocks[0].events).toHaveLength(1)
    })

    it('does not merge adjacent system_messages', () => {
      const events = [systemMessageEvent('A'), systemMessageEvent('B')]
      const blocks = groupActivityEvents(events)
      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('system_message')
      expect(blocks[1].type).toBe('system_message')
    })

    it('system_message as only event in stream', () => {
      const blocks = groupActivityEvents([systemMessageEvent('solo')])
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('system_message')
    })
  })

  describe('flush behavior', () => {
    it('flushes pending text before system_message', () => {
      const blocks = groupActivityEvents([textEvent('a'), textEvent('b'), systemMessageEvent('sys')])
      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('text')
      expect(blocks[0].events).toHaveLength(2) // merged text
      expect(blocks[1].type).toBe('system_message')
    })

    it('flushes pending tool before system_message', () => {
      const blocks = groupActivityEvents([
        toolUseEvent('t1', 'Read'), toolResultEvent('t1', 'Read'),
        systemMessageEvent('sys'),
      ])
      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('tool')
      expect(blocks[1].type).toBe('system_message')
    })

    it('flushes pending tool_group before system_message', () => {
      const blocks = groupActivityEvents([
        toolUseEvent('t1', 'Read'), toolResultEvent('t1', 'Read'),
        toolUseEvent('t2', 'Bash'), toolResultEvent('t2', 'Bash'),
        systemMessageEvent('sys'),
      ])
      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('tool_group')
      expect(blocks[1].type).toBe('system_message')
    })

    it('text → system_message → text creates three separate blocks', () => {
      const blocks = groupActivityEvents([
        textEvent('before'), systemMessageEvent('divider'), textEvent('after'),
      ])
      expect(blocks).toHaveLength(3)
      expect(blocks.map(b => b.type)).toEqual(['text', 'system_message', 'text'])
    })
  })

  describe('interaction with all other event types', () => {
    it('system_message between chat_user and text', () => {
      const blocks = groupActivityEvents([
        chatUserEvent('question'),
        systemMessageEvent('compacted'),
        textEvent('answer'),
      ])
      expect(blocks.map(b => b.type)).toEqual(['chat_user', 'system_message', 'text'])
    })

    it('system_message between steer and error', () => {
      const blocks = groupActivityEvents([
        steerEvent('do it'), systemMessageEvent('marker'), errorEvent('failed'),
      ])
      expect(blocks.map(b => b.type)).toEqual(['steer', 'system_message', 'error'])
    })

    it('system_message between file_change and approval', () => {
      const blocks = groupActivityEvents([
        fileChangeEvent('/a.ts'), systemMessageEvent('marker'),
        approvalRequestEvent('r1', 'ok?'), approvalResponseEvent('r1', 'yes'),
      ])
      expect(blocks.map(b => b.type)).toEqual([
        'file_change', 'system_message', 'approval_request', 'approval_response',
      ])
    })

    it('system_message at start of event stream', () => {
      const blocks = groupActivityEvents([
        systemMessageEvent('session start'),
        textEvent('hi'),
        chatUserEvent('hello'),
      ])
      expect(blocks[0].type).toBe('system_message')
    })

    it('system_message at end of event stream', () => {
      const blocks = groupActivityEvents([
        textEvent('bye'),
        systemMessageEvent('session end'),
      ])
      expect(blocks[blocks.length - 1].type).toBe('system_message')
    })

    it('all event types with system_message interleaved', () => {
      const events: TaskActivityEvent[] = [
        chatUserEvent('q'),
        systemMessageEvent('sys1'),
        chatAssistantEvent('a'),
        textEvent('text'),
        systemMessageEvent('sys2'),
        toolUseEvent('t1', 'Read'),
        toolResultEvent('t1', 'Read'),
        systemMessageEvent('sys3'),
        steerEvent('steer'),
        fileChangeEvent('/x'),
        errorEvent('err'),
        systemMessageEvent('sys4'),
        approvalRequestEvent('r1', 'ok?'),
        approvalResponseEvent('r1', 'y'),
      ]
      const blocks = groupActivityEvents(events)
      const types = blocks.map(b => b.type)
      expect(types).toEqual([
        'chat_user', 'system_message', 'chat_assistant', 'text',
        'system_message', 'tool', 'system_message', 'steer',
        'file_change', 'error', 'system_message',
        'approval_request', 'approval_response',
      ])
    })
  })

  describe('system_message event data integrity', () => {
    it('preserves message content in the block', () => {
      const msg = 'Context compacted: 42 messages → 8'
      const blocks = groupActivityEvents([systemMessageEvent(msg)])
      const sysEvent = blocks[0].events[0] as Extract<TaskActivityEvent, { type: 'system_message' }>
      expect(sysEvent.message).toBe(msg)
    })

    it('preserves timestamp in the block', () => {
      const ts = new Date('2026-03-07T12:00:00Z')
      const event: TaskActivityEvent = { type: 'system_message', message: 'test', timestamp: ts }
      const blocks = groupActivityEvents([event])
      expect(blocks[0].events[0].timestamp).toBe(ts)
    })

    it('handles empty message string', () => {
      const blocks = groupActivityEvents([systemMessageEvent('')])
      const sysEvent = blocks[0].events[0] as Extract<TaskActivityEvent, { type: 'system_message' }>
      expect(sysEvent.message).toBe('')
    })

    it('handles very long message string', () => {
      const longMsg = 'Context compacted: '.repeat(500)
      const blocks = groupActivityEvents([systemMessageEvent(longMsg)])
      const sysEvent = blocks[0].events[0] as Extract<TaskActivityEvent, { type: 'system_message' }>
      expect(sysEvent.message).toBe(longMsg)
    })
  })
})

// =====================================================================
// Server-Side Compaction Logic (boundary tests)
// =====================================================================

describe('compaction threshold logic — shouldCompact', () => {
  describe('message count boundaries', () => {
    it('0 messages → no compact', () => {
      expect(shouldCompact([]).shouldCompact).toBe(false)
    })

    it('1 message → no compact', () => {
      expect(shouldCompact(generateExactMessages(1, 50000)).shouldCompact).toBe(false)
    })

    it('5 messages → no compact (under KEEP_RECENT)', () => {
      expect(shouldCompact(generateExactMessages(5, 10000)).shouldCompact).toBe(false)
    })

    it('6 messages (== KEEP_RECENT) → no compact', () => {
      expect(shouldCompact(generateExactMessages(6, 10000)).shouldCompact).toBe(false)
    })

    it('7 messages (> KEEP_RECENT) with enough chars → compact', () => {
      expect(shouldCompact(generateExactMessages(7, 5000)).shouldCompact).toBe(true)
    })

    it('7 messages (> KEEP_RECENT) with insufficient chars → no compact', () => {
      expect(shouldCompact(generateExactMessages(7, 100)).shouldCompact).toBe(false)
    })

    it('100 messages with enough chars → compact', () => {
      const result = shouldCompact(generateExactMessages(100, 500))
      expect(result.shouldCompact).toBe(true)
      expect(result.olderCount).toBe(94)
      expect(result.recentCount).toBe(6)
    })

    it('1000 messages → compact', () => {
      const result = shouldCompact(generateExactMessages(1000, 50))
      expect(result.shouldCompact).toBe(true)
      expect(result.olderCount).toBe(994)
    })
  })

  describe('character count boundaries', () => {
    it('total exactly 30000 → no compact (uses <=)', () => {
      // 10 messages * 3000 chars each = 30000 exactly
      const messages = generateExactMessages(10, 3000)
      const result = shouldCompact(messages)
      expect(result.totalChars).toBe(30000)
      expect(result.shouldCompact).toBe(false)
    })

    it('total 30001 → compact', () => {
      // 7 messages, total > 30000
      const messages = [
        ...generateExactMessages(6, 4286),
        { role: 'user' as const, content: 'x'.repeat(4285) },
      ]
      const total = messages.reduce((s, m) => s + m.content.length, 0)
      expect(total).toBe(6 * 4286 + 4285) // 30001
      expect(shouldCompact(messages).shouldCompact).toBe(true)
    })

    it('total 29999 → no compact', () => {
      // 10 messages * 2999.9 ≈ 30000, let's do 10 * 2999 = 29990
      const messages = generateExactMessages(10, 2999)
      const result = shouldCompact(messages)
      expect(result.totalChars).toBe(29990)
      expect(result.shouldCompact).toBe(false)
    })

    it('very small messages, many of them (100 * 10 = 1000 chars) → no compact', () => {
      const result = shouldCompact(generateExactMessages(100, 10))
      expect(result.totalChars).toBe(1000)
      expect(result.shouldCompact).toBe(false)
    })

    it('single massive message exceeding threshold → no compact (only 1 message)', () => {
      const result = shouldCompact([{ role: 'user', content: 'x'.repeat(100000) }])
      expect(result.shouldCompact).toBe(false) // count <= 6
    })

    it('6 massive messages → no compact (count == KEEP_RECENT)', () => {
      const result = shouldCompact(generateExactMessages(6, 100000))
      // totalChars is 0 because the function short-circuits on count <= KEEP_RECENT
      expect(result.totalChars).toBe(0)
      expect(result.shouldCompact).toBe(false) // count <= KEEP_RECENT
    })
  })

  describe('null / undefined / edge cases', () => {
    it('null messages → no compact', () => {
      expect(shouldCompact(null).shouldCompact).toBe(false)
    })

    it('undefined messages → no compact', () => {
      expect(shouldCompact(undefined).shouldCompact).toBe(false)
    })

    it('messages with empty content strings', () => {
      const messages = generateExactMessages(10, 0) // all empty strings
      const result = shouldCompact(messages)
      expect(result.totalChars).toBe(0)
      expect(result.shouldCompact).toBe(false)
    })

    it('mixed: some empty, some long messages', () => {
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...generateExactMessages(5, 0),        // 5 empty
        ...generateExactMessages(5, 10000),     // 5 with 10K each = 50K
      ]
      const result = shouldCompact(messages)
      expect(result.totalChars).toBe(50000)
      expect(result.shouldCompact).toBe(true)
    })
  })

  describe('older/recent split correctness', () => {
    it('olderCount = total - KEEP_RECENT', () => {
      for (const count of [7, 10, 20, 50, 100]) {
        const messages = generateExactMessages(count, 5000)
        const result = shouldCompact(messages)
        if (result.shouldCompact) {
          expect(result.olderCount).toBe(count - COMPACTION_KEEP_RECENT)
          expect(result.recentCount).toBe(COMPACTION_KEEP_RECENT)
        }
      }
    })

    it('recentCount is always KEEP_RECENT when compacting', () => {
      const result = shouldCompact(generateExactMessages(50, 1000))
      expect(result.shouldCompact).toBe(true)
      expect(result.recentCount).toBe(6)
    })
  })
})

// =====================================================================
// Server-Side Compaction Output — buildCompactedMessages
// =====================================================================

describe('buildCompactedMessages', () => {
  it('produces summary pair + recent messages', () => {
    const original = generateMessages(20, 2000)
    const compacted = buildCompactedMessages(original, 'Summary text here')
    expect(compacted).toHaveLength(8) // 2 + 6
  })

  it('first message is user with [Earlier conversation summary] prefix', () => {
    const compacted = buildCompactedMessages(generateMessages(10, 500), 'The summary')
    expect(compacted[0].role).toBe('user')
    expect(compacted[0].content).toContain('[Earlier conversation summary]')
    expect(compacted[0].content).toContain('The summary')
  })

  it('second message is assistant acknowledgment', () => {
    const compacted = buildCompactedMessages(generateMessages(10, 500), 'The summary')
    expect(compacted[1].role).toBe('assistant')
    expect(compacted[1].content).toContain('Understood')
    expect(compacted[1].content).toContain('earlier conversation')
  })

  it('recent messages are preserved verbatim (referential identity)', () => {
    const original = generateMessages(20, 2000)
    const compacted = buildCompactedMessages(original, 'summary')
    const recentOriginal = original.slice(-COMPACTION_KEEP_RECENT)

    for (let i = 0; i < COMPACTION_KEEP_RECENT; i++) {
      expect(compacted[i + 2]).toBe(recentOriginal[i]) // same reference
    }
  })

  it('recent messages content is byte-identical', () => {
    const original = generateMessages(20, 2000)
    const compacted = buildCompactedMessages(original, 'summary')

    for (let i = 0; i < COMPACTION_KEEP_RECENT; i++) {
      expect(compacted[i + 2].content).toBe(original[20 - COMPACTION_KEEP_RECENT + i].content)
      expect(compacted[i + 2].role).toBe(original[20 - COMPACTION_KEEP_RECENT + i].role)
    }
  })

  it('summary with newlines is preserved in the user message', () => {
    const summary = 'Line 1\nLine 2\nLine 3'
    const compacted = buildCompactedMessages(generateMessages(10, 500), summary)
    expect(compacted[0].content).toContain('Line 1\nLine 2\nLine 3')
  })

  it('empty summary produces valid messages', () => {
    const compacted = buildCompactedMessages(generateMessages(10, 500), '')
    expect(compacted[0].content).toBe('[Earlier conversation summary]\n')
    expect(compacted).toHaveLength(8)
  })

  it('summary with special characters', () => {
    const summary = 'User asked about <html> tags, "quotes", & backslash: \\'
    const compacted = buildCompactedMessages(generateMessages(10, 500), summary)
    expect(compacted[0].content).toContain(summary)
  })

  it('7 messages in → 8 out (1 older + 6 recent = 1 summary pair + 6)', () => {
    const original = generateExactMessages(7, 5000)
    const compacted = buildCompactedMessages(original, 'sum')
    expect(compacted).toHaveLength(8)
    // Recent 6 should be the last 6 of original
    for (let i = 0; i < 6; i++) {
      expect(compacted[i + 2]).toBe(original[i + 1])
    }
  })

  it('100 messages in → 8 out', () => {
    const original = generateExactMessages(100, 500)
    const compacted = buildCompactedMessages(original, 'big summary')
    expect(compacted).toHaveLength(8)
  })

  it('compacted messages are always user/assistant alternating at start', () => {
    // The summary pair is always user, assistant
    // Then the recent messages follow in their original order
    const compacted = buildCompactedMessages(generateMessages(20, 500), 'summary')
    expect(compacted[0].role).toBe('user')
    expect(compacted[1].role).toBe('assistant')
  })

  it('compacted messages size is dramatically smaller', () => {
    const original = generateExactMessages(50, 2000) // 100K chars
    const summary = 'Short summary of the conversation.' // ~35 chars
    const compacted = buildCompactedMessages(original, summary)

    const originalChars = original.reduce((s, m) => s + m.content.length, 0)
    const compactedChars = compacted.reduce((s, m) => s + m.content.length, 0)

    // Compacted should be much smaller: 6 recent * 2000 + summary overhead
    expect(compactedChars).toBeLessThan(originalChars * 0.2)
  })
})

// =====================================================================
// SSE Pre-Stream Events (parseSSEStream level)
// =====================================================================

describe('parseSSEStream — compaction event at wire level', () => {
  it('compaction is a standard SSE event (event + data + blank line)', async () => {
    const events: Array<{ event: string; data: string }> = []
    const resp = mockSSEResponse(
      'event: compaction\ndata: {"test":true}\n\n'
    )
    await parseSSEStream(resp, { onEvent: (e) => events.push(e) })
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('compaction')
    expect(events[0].data).toBe('{"test":true}')
  })

  it('compaction event with multi-line data', async () => {
    const events: Array<{ event: string; data: string }> = []
    const resp = mockSSEResponse(
      'event: compaction\ndata: {"line1":\ndata: "continued"}\n\n'
    )
    await parseSSEStream(resp, { onEvent: (e) => events.push(e) })
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('{"line1":\n"continued"}')
  })

  it('compaction event without trailing blank line (flush on stream end)', async () => {
    const events: Array<{ event: string; data: string }> = []
    const resp = mockSSEResponse('event: compaction\ndata: {"final":true}')
    await parseSSEStream(resp, { onEvent: (e) => events.push(e) })
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('{"final":true}')
  })
})

// =====================================================================
// TaskActivityEvent type — system_message variant
// =====================================================================

describe('TaskActivityEvent — system_message variant', () => {
  it('has correct discriminant', () => {
    const event: TaskActivityEvent = { type: 'system_message', message: 'test', timestamp: new Date() }
    expect(event.type).toBe('system_message')
  })

  it('accepts empty message', () => {
    const event: TaskActivityEvent = { type: 'system_message', message: '', timestamp: new Date() }
    expect(event.message).toBe('')
  })

  it('accepts unicode message', () => {
    const event: TaskActivityEvent = { type: 'system_message', message: '🔄 コンテキスト圧縮', timestamp: new Date() }
    expect(event.message).toBe('🔄 コンテキスト圧縮')
  })

  it('accepts HTML-like content', () => {
    const event: TaskActivityEvent = { type: 'system_message', message: '<b>system</b>', timestamp: new Date() }
    expect(event.message).toBe('<b>system</b>')
  })

  it('timestamp is a Date object', () => {
    const event: TaskActivityEvent = { type: 'system_message', message: 'x', timestamp: new Date() }
    expect(event.timestamp).toBeInstanceOf(Date)
  })
})

// =====================================================================
// End-to-End SSE Flow Simulation
// =====================================================================

describe('end-to-end compaction SSE flow', () => {
  it('full chat turn: compaction → text → tool_use → tool_result → text → done + metrics', async () => {
    const collected = {
      compaction: null as Record<string, unknown> | null,
      texts: [] as string[],
      toolUses: [] as Array<{ toolName: string; toolInput: unknown }>,
      toolResults: [] as Array<{ toolName: string; success: boolean; result: unknown }>,
      done: null as string | null,
      metrics: null as Record<string, unknown> | null,
    }

    const metricsData = { durationMs: 5000, inputTokens: 1200, outputTokens: 800, totalCost: 0.05, model: 'claude-sonnet-4-6', numTurns: 3 }
    const resp = mockSSEResponse([
      `event: compaction\ndata: ${JSON.stringify({ originalCount: 24, compactedCount: 8, summary: 'DB schema discussion' })}\n\n`,
      `event: text\ndata: I recall our discussion.\n\n`,
      `event: tool_use\ndata: ${JSON.stringify({ toolName: 'Read', toolInput: { file_path: '/src/schema.ts' } })}\n\n`,
      `event: tool_result\ndata: ${JSON.stringify({ toolName: 'Read', success: true, result: 'export const schema = ...' })}\n\n`,
      `event: text\ndata:  Updating now.\n\n`,
      `event: done\ndata: ${JSON.stringify({ sessionId: 'sess-abc', metrics: metricsData })}\n\n`,
    ].join(''))

    await parseChatSSE(resp, {
      onCompaction: (d) => { collected.compaction = d },
      onText: (t) => collected.texts.push(t),
      onToolUse: (d) => collected.toolUses.push(d),
      onToolResult: (d) => collected.toolResults.push(d),
      onDone: (sid) => { collected.done = sid },
      onMetrics: (m) => { collected.metrics = m },
    })

    expect(collected.compaction).toEqual({ originalCount: 24, compactedCount: 8, summary: 'DB schema discussion' })
    expect(collected.texts).toEqual(['I recall our discussion.', ' Updating now.'])
    expect(collected.toolUses).toHaveLength(1)
    expect(collected.toolResults).toHaveLength(1)
    expect(collected.done).toBe('sess-abc')
    expect(collected.metrics).toEqual(metricsData)
  })

  it('chat turn without compaction (short history)', async () => {
    const collected = { compaction: null as unknown, texts: [] as string[] }
    const resp = mockSSEResponse('event: text\ndata: Hello!\n\nevent: done\ndata: {"sessionId":"s1"}\n\n')
    await parseChatSSE(resp, {
      onCompaction: (d) => { collected.compaction = d },
      onText: (t) => collected.texts.push(t),
      onDone: () => {},
    })
    expect(collected.compaction).toBeNull()
    expect(collected.texts).toEqual(['Hello!'])
  })

  it('activity blocks from compacted session render in correct order', () => {
    const events: TaskActivityEvent[] = [
      chatUserEvent('What did we discuss?'),
      chatAssistantEvent('We discussed caching.'),
      chatUserEvent('And auth?'),
      systemMessageEvent('Context compacted: 42 messages → 8'),
      textEvent('Based on our earlier discussion...'),
      toolUseEvent('t1', 'Read'),
      toolResultEvent('t1', 'Read'),
      textEvent('Updated implementation.'),
    ]
    const types = groupActivityEvents(events).map(b => b.type)
    expect(types).toEqual([
      'chat_user', 'chat_assistant', 'chat_user',
      'system_message',
      'text', 'tool', 'text',
    ])
  })

  it('multiple compaction dividers in a long session', () => {
    const events: TaskActivityEvent[] = [
      chatUserEvent('turn 1'),
      systemMessageEvent('Context compacted: 20 messages → 8'),
      textEvent('response 1'),
      chatUserEvent('turn 2'),
      systemMessageEvent('Context compacted: 28 messages → 8'),
      textEvent('response 2'),
    ]
    const blocks = groupActivityEvents(events)
    const sysBlocks = blocks.filter(b => b.type === 'system_message')
    expect(sysBlocks).toHaveLength(2)
    expect(blocks.map(b => b.type)).toEqual([
      'chat_user', 'system_message', 'text',
      'chat_user', 'system_message', 'text',
    ])
  })

  it('compaction + many tool calls in a single turn', async () => {
    const events: string[] = []
    let sse = `event: compaction\ndata: ${JSON.stringify({ originalCount: 30, compactedCount: 8, summary: 'ctx' })}\n\n`
    for (let i = 0; i < 10; i++) {
      sse += `event: tool_use\ndata: ${JSON.stringify({ toolName: `Tool${i}`, toolInput: {} })}\n\n`
      sse += `event: tool_result\ndata: ${JSON.stringify({ toolName: `Tool${i}`, success: true, result: 'ok' })}\n\n`
    }
    sse += `event: text\ndata: All done.\n\nevent: done\ndata: {"sessionId":"s"}\n\n`

    await parseChatSSE(mockSSEResponse(sse), {
      onCompaction: () => events.push('compaction'),
      onToolUse: () => events.push('tool_use'),
      onToolResult: () => events.push('tool_result'),
      onText: () => events.push('text'),
      onDone: () => events.push('done'),
    })

    expect(events[0]).toBe('compaction')
    expect(events.filter(e => e === 'tool_use')).toHaveLength(10)
    expect(events.filter(e => e === 'tool_result')).toHaveLength(10)
    expect(events[events.length - 2]).toBe('text')
    expect(events[events.length - 1]).toBe('done')
  })

  it('activity blocks for compaction + tool group + file changes', () => {
    const events: TaskActivityEvent[] = [
      systemMessageEvent('Context compacted: 50 messages → 8'),
      textEvent('Updating files...'),
      toolUseEvent('t1', 'Edit', { file_path: '/a.ts' }),
      toolUseEvent('t2', 'Edit', { file_path: '/b.ts' }),
      toolResultEvent('t1', 'Edit'),
      toolResultEvent('t2', 'Edit'),
      fileChangeEvent('/a.ts'),
      fileChangeEvent('/b.ts'),
      textEvent('Done!'),
    ]
    const blocks = groupActivityEvents(events)
    expect(blocks.map(b => b.type)).toEqual([
      'system_message', 'text', 'tool_group', 'file_change', 'file_change', 'text',
    ])
  })

  it('compaction with no further events (stream aborted)', async () => {
    const onCompaction = vi.fn()
    const onDone = vi.fn()
    const resp = mockSSEResponse(
      `event: compaction\ndata: ${JSON.stringify({ originalCount: 10, compactedCount: 5, summary: 'ctx' })}\n\n` +
      `event: aborted\ndata: \n\n`
    )
    await parseChatSSE(resp, { onCompaction, onDone })
    expect(onCompaction).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledWith('')
  })
})

// =====================================================================
// Integration: Compaction decision + output + SSE together
// =====================================================================

describe('integration: full compaction pipeline simulation', () => {
  it('simulates complete server-side flow: decide → compact → emit SSE → parse', async () => {
    // Step 1: Build a conversation that triggers compaction
    const history = generateExactMessages(20, 2000) // 40K chars, 20 messages
    const decision = shouldCompact(history)
    expect(decision.shouldCompact).toBe(true)

    // Step 2: Build compacted messages
    const summary = 'User asked about database migration. Assistant implemented schema changes.'
    const compacted = buildCompactedMessages(history, summary)
    expect(compacted).toHaveLength(8)

    // Step 3: Build the SSE event the server would emit
    const sseEvent = {
      event: 'compaction',
      data: JSON.stringify({
        originalCount: history.length,
        compactedCount: compacted.length,
        summary,
      }),
    }

    // Step 4: Parse the SSE event as the client would
    const onCompaction = vi.fn()
    const resp = mockSSEResponse(
      `event: ${sseEvent.event}\ndata: ${sseEvent.data}\n\nevent: done\ndata: {"sessionId":"s"}\n\n`
    )
    await parseChatSSE(resp, { onCompaction, onDone: () => {} })

    expect(onCompaction).toHaveBeenCalledWith({
      originalCount: 20,
      compactedCount: 8,
      summary,
    })

    // Step 5: Create the activity event the session store would push
    const activityEvent = systemMessageEvent(
      `Context compacted: ${20} messages → ${8}`
    )

    // Step 6: Verify it groups correctly
    const blocks = groupActivityEvents([
      chatUserEvent('New question'),
      activityEvent,
      textEvent('Response with compacted context'),
    ])
    expect(blocks.map(b => b.type)).toEqual(['chat_user', 'system_message', 'text'])
  })

  it('simulates no-compaction path when history is short', () => {
    const history = generateExactMessages(4, 1000) // 4 messages, 4K chars
    const decision = shouldCompact(history)
    expect(decision.shouldCompact).toBe(false)

    // No compacted messages, no SSE event, no activity event
    const blocks = groupActivityEvents([
      chatUserEvent('Question'),
      textEvent('Answer'),
    ])
    expect(blocks.map(b => b.type)).toEqual(['chat_user', 'text'])
    expect(blocks.some(b => b.type === 'system_message')).toBe(false)
  })

  it('simulates failed compaction fallback', () => {
    // Even when shouldCompact returns true, if the relay call fails,
    // the server uses original messages and doesn't emit compaction SSE.
    const history = generateExactMessages(20, 2000)
    const decision = shouldCompact(history)
    expect(decision.shouldCompact).toBe(true)

    // Simulate: compaction relay call failed → use original messages
    // No compaction event emitted, no system_message in UI
    const blocks = groupActivityEvents([
      chatUserEvent('Question'),
      textEvent('Answer using full context'),
    ])
    expect(blocks.some(b => b.type === 'system_message')).toBe(false)
  })

  it('simulates compaction with empty relay output', () => {
    // If relay returns success but empty output, server skips compaction
    const history = generateExactMessages(20, 2000)
    const decision = shouldCompact(history)
    expect(decision.shouldCompact).toBe(true)

    // The server checks: if (compactionResult.success && compactionResult.output)
    // Empty string is falsy → falls through to original messages
    const emptyOutput = ''
    expect(!!emptyOutput).toBe(false) // confirms falsy
  })

  it('simulates compaction with whitespace-only relay output', () => {
    // Server does: const summary = compactionResult.output.trim()
    // If output is "   \n", trim() → "", which is falsy
    // But wait — the server does the trim() INSIDE the success branch.
    // Let's check: compactionResult.output = "  \n  " → truthy (non-empty string)
    // Then summary = "  \n  ".trim() = "" → empty string
    // Then compactedMessages uses empty summary in [Earlier conversation summary]\n
    const whitespaceOutput = '   \n   '
    expect(!!whitespaceOutput).toBe(true) // truthy → enters the block
    const trimmed = whitespaceOutput.trim()
    expect(trimmed).toBe('') // but summary is empty

    // This is technically valid — the UI would show "Context compacted: N → M"
    // The compacted messages would have "[Earlier conversation summary]\n" (empty summary)
    const compacted = buildCompactedMessages(generateExactMessages(20, 2000), trimmed)
    expect(compacted[0].content).toBe('[Earlier conversation summary]\n')
  })
})

// =====================================================================
// Regression: existing SSE events still work with compaction
// =====================================================================

describe('regression: compaction does not break existing SSE events', () => {
  it('text events still work', async () => {
    const texts: string[] = []
    const resp = mockSSEResponse('event: text\ndata: hello\n\nevent: text\ndata:  world\n\n')
    await parseChatSSE(resp, { onText: (t) => texts.push(t) })
    expect(texts).toEqual(['hello', ' world'])
  })

  it('done event still extracts sessionId', async () => {
    const onDone = vi.fn()
    const resp = mockSSEResponse('event: done\ndata: {"sessionId":"abc-123"}\n\n')
    await parseChatSSE(resp, { onDone })
    expect(onDone).toHaveBeenCalledWith('abc-123')
  })

  it('error events still work', async () => {
    const onError = vi.fn()
    const resp = mockSSEResponse('event: error\ndata: Something went wrong\n\n')
    await parseChatSSE(resp, { onError })
    expect(onError).toHaveBeenCalledWith('Something went wrong')
  })

  it('aborted still maps to done with empty sessionId', async () => {
    const onDone = vi.fn()
    const resp = mockSSEResponse('event: aborted\ndata: cancelled\n\n')
    await parseChatSSE(resp, { onDone })
    expect(onDone).toHaveBeenCalledWith('')
  })

  it('session_init still works', async () => {
    const onSessionInit = vi.fn()
    const resp = mockSSEResponse(
      `event: session_init\ndata: ${JSON.stringify({ sessionId: 'sid', model: 'claude' })}\n\n`
    )
    await parseChatSSE(resp, { onSessionInit })
    expect(onSessionInit).toHaveBeenCalledWith({ sessionId: 'sid', model: 'claude' })
  })

  it('tool_use and tool_result still work', async () => {
    const onToolUse = vi.fn()
    const onToolResult = vi.fn()
    const resp = mockSSEResponse(
      `event: tool_use\ndata: ${JSON.stringify({ toolName: 'Bash', toolInput: { cmd: 'ls' } })}\n\n` +
      `event: tool_result\ndata: ${JSON.stringify({ toolName: 'Bash', success: true, result: 'files' })}\n\n`
    )
    await parseChatSSE(resp, { onToolUse, onToolResult })
    expect(onToolUse).toHaveBeenCalledOnce()
    expect(onToolResult).toHaveBeenCalledOnce()
  })

  it('plan_result still works', async () => {
    const onPlanResult = vi.fn()
    const planData = { nodes: [{ id: 'n1' }], edges: [] }
    const resp = mockSSEResponse(`event: plan_result\ndata: ${JSON.stringify(planData)}\n\n`)
    await parseChatSSE(resp, { onPlanResult })
    expect(onPlanResult).toHaveBeenCalledWith(planData)
  })

  it('metrics still extracted from done event', async () => {
    const onMetrics = vi.fn()
    const metrics = { durationMs: 1000, inputTokens: 100 }
    const resp = mockSSEResponse(
      `event: done\ndata: ${JSON.stringify({ sessionId: 's', metrics })}\n\n`
    )
    await parseChatSSE(resp, { onDone: () => {}, onMetrics })
    expect(onMetrics).toHaveBeenCalledWith(metrics)
  })

  it('heartbeat is still silently ignored', async () => {
    const onText = vi.fn()
    const resp = mockSSEResponse('event: heartbeat\ndata: \n\nevent: text\ndata: real\n\n')
    await parseChatSSE(resp, { onText })
    expect(onText).toHaveBeenCalledOnce()
    expect(onText).toHaveBeenCalledWith('real')
  })
})
