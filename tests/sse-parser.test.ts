/**
 * SSE Parser Unit Tests
 *
 * Tests the SSE stream parser used for chat and execution endpoints.
 * Creates mock Response objects to simulate server-sent events.
 */
import { describe, it, expect, vi } from 'vitest'
import { parseSSEStream, parseChatSSE, parseExecutionSSE } from '../src/lib/sse-parser'

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

describe('parseSSEStream', () => {
  it('parses a single event', async () => {
    const events: Array<{ event: string; data: string }> = []
    const resp = mockSSEResponse('event: text\ndata: hello world\n\n')

    await parseSSEStream(resp, {
      onEvent: (e) => events.push(e),
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ event: 'text', data: 'hello world' })
  })

  it('parses multiple events', async () => {
    const events: Array<{ event: string; data: string }> = []
    const resp = mockSSEResponse(
      'event: text\ndata: chunk1\n\nevent: text\ndata: chunk2\n\nevent: done\ndata: {"sessionId":"s1"}\n\n'
    )

    await parseSSEStream(resp, {
      onEvent: (e) => events.push(e),
    })

    expect(events).toHaveLength(3)
    expect(events[0]).toEqual({ event: 'text', data: 'chunk1' })
    expect(events[1]).toEqual({ event: 'text', data: 'chunk2' })
    expect(events[2]).toEqual({ event: 'done', data: '{"sessionId":"s1"}' })
  })

  it('handles chunked delivery (data split across reads)', async () => {
    const events: Array<{ event: string; data: string }> = []
    const resp = mockChunkedSSEResponse([
      'event: te',
      'xt\ndata: hel',
      'lo\n\nevent: done\ndata: ok\n\n',
    ])

    await parseSSEStream(resp, {
      onEvent: (e) => events.push(e),
    })

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ event: 'text', data: 'hello' })
    expect(events[1]).toEqual({ event: 'done', data: 'ok' })
  })

  it('handles multi-line data fields', async () => {
    const events: Array<{ event: string; data: string }> = []
    const resp = mockSSEResponse('event: text\ndata: line1\ndata: line2\n\n')

    await parseSSEStream(resp, {
      onEvent: (e) => events.push(e),
    })

    expect(events).toHaveLength(1)
    // Per SSE spec: strip exactly one leading space after "data:", preserve rest
    expect(events[0].data).toBe('line1\nline2')
  })

  it('strips exactly one leading space from data values per SSE spec', async () => {
    const events: Array<{ event: string; data: string }> = []
    // "data:no-space" → "no-space", "data: one-space" → "one-space", "data:  two-spaces" → " two-spaces"
    const resp = mockSSEResponse('event: a\ndata:no-space\n\nevent: b\ndata: one-space\n\nevent: c\ndata:  two-spaces\n\n')

    await parseSSEStream(resp, {
      onEvent: (e) => events.push(e),
    })

    expect(events).toHaveLength(3)
    expect(events[0].data).toBe('no-space')
    expect(events[1].data).toBe('one-space')
    expect(events[2].data).toBe(' two-spaces') // Only one space stripped
  })

  it('flushes remaining event at end of stream', async () => {
    const events: Array<{ event: string; data: string }> = []
    // No trailing empty line
    const resp = mockSSEResponse('event: text\ndata: final')

    await parseSSEStream(resp, {
      onEvent: (e) => events.push(e),
    })

    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('final')
  })

  it('emits events with no data (spec compliant)', async () => {
    const events: Array<{ event: string; data: string }> = []
    const resp = mockSSEResponse('event: heartbeat\n\nevent: text\ndata: real\n\n')

    await parseSSEStream(resp, {
      onEvent: (e) => events.push(e),
    })

    // Per SSE spec, events with no data lines are valid and emitted with empty string data
    expect(events).toHaveLength(2)
    expect(events[0].event).toBe('heartbeat')
    expect(events[0].data).toBe('')
    expect(events[1].event).toBe('text')
    expect(events[1].data).toBe('real')
  })

  it('handles new event: line before previous is flushed (missing empty line)', async () => {
    const events: Array<{ event: string; data: string }> = []
    // Missing empty line between events — the parser should flush on seeing the next `event:` line
    const resp = mockSSEResponse('event: text\ndata: first\nevent: text\ndata: second\n\n')

    await parseSSEStream(resp, {
      onEvent: (e) => events.push(e),
    })

    expect(events).toHaveLength(2)
    expect(events[0].data).toBe('first')
    expect(events[1].data).toBe('second')
  })
})

describe('parseChatSSE', () => {
  it('routes text events to onText', async () => {
    const texts: string[] = []
    // "data: hello" → "hello", "data:  world" → " world" (one space stripped, one preserved)
    const resp = mockSSEResponse('event: text\ndata: hello\n\nevent: text\ndata:  world\n\n')

    await parseChatSSE(resp, {
      onText: (t) => texts.push(t),
    })

    expect(texts).toEqual(['hello', ' world'])
  })

  it('routes done event with sessionId', async () => {
    const onDone = vi.fn()
    const resp = mockSSEResponse(
      'event: done\ndata: {"sessionId":"abc-123","providerId":"claude-code"}\n\n'
    )

    await parseChatSSE(resp, { onDone })

    expect(onDone).toHaveBeenCalledWith('abc-123')
  })

  it('routes error events', async () => {
    const onError = vi.fn()
    const resp = mockSSEResponse('event: error\ndata: Something went wrong\n\n')

    await parseChatSSE(resp, { onError })

    expect(onError).toHaveBeenCalledWith('Something went wrong')
  })

  it('treats aborted as done with empty sessionId', async () => {
    const onDone = vi.fn()
    const resp = mockSSEResponse('event: aborted\ndata: user cancelled\n\n')

    await parseChatSSE(resp, { onDone })

    expect(onDone).toHaveBeenCalledWith('')
  })

  it('routes plan_result events', async () => {
    const onPlanResult = vi.fn()
    const planData = { nodes: [{ id: 'n1' }], edges: [] }
    const resp = mockSSEResponse(
      `event: plan_result\ndata: ${JSON.stringify(planData)}\n\n`
    )

    await parseChatSSE(resp, { onPlanResult })

    expect(onPlanResult).toHaveBeenCalledWith(planData)
  })

  it('handles malformed plan_result JSON', async () => {
    const onError = vi.fn()
    const onPlanResult = vi.fn()
    const resp = mockSSEResponse('event: plan_result\ndata: {invalid json\n\n')

    await parseChatSSE(resp, { onPlanResult, onError })

    expect(onPlanResult).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('Failed to parse plan result')
  })

  it('handles full chat flow (text + done)', async () => {
    const texts: string[] = []
    const onDone = vi.fn()
    // "data:  with that." has two spaces → one stripped, one preserved → " with that."
    const resp = mockSSEResponse(
      'event: text\ndata: I can help\n\nevent: text\ndata:  with that.\n\nevent: done\ndata: {"sessionId":"s-123"}\n\n'
    )

    await parseChatSSE(resp, {
      onText: (t) => texts.push(t),
      onDone,
    })

    expect(texts).toEqual(['I can help', ' with that.'])
    expect(onDone).toHaveBeenCalledWith('s-123')
  })

  it('handles done event with malformed JSON', async () => {
    const onDone = vi.fn()
    const resp = mockSSEResponse('event: done\ndata: not-json\n\n')

    await parseChatSSE(resp, { onDone })

    // Falls back to empty string
    expect(onDone).toHaveBeenCalledWith('')
  })
})

describe('parseExecutionSSE', () => {
  it('routes init event', async () => {
    const onInit = vi.fn()
    const initData = {
      executionId: 'exec-1',
      nodeId: 'node-1',
      providerId: 'claude-code',
      providerName: 'Claude Code',
    }
    const resp = mockSSEResponse(
      `event: init\ndata: ${JSON.stringify(initData)}\n\n`
    )

    await parseExecutionSSE(resp, { onInit })

    expect(onInit).toHaveBeenCalledWith(initData)
  })

  it('routes text events', async () => {
    const texts: string[] = []
    const resp = mockSSEResponse('event: text\ndata: executing...\n\n')

    await parseExecutionSSE(resp, {
      onText: (t) => texts.push(t),
    })

    expect(texts).toEqual(['executing...'])
  })

  it('routes tool_use and tool_result events', async () => {
    const onToolUse = vi.fn()
    const onToolResult = vi.fn()
    const resp = mockSSEResponse(
      `event: tool_use\ndata: ${JSON.stringify({ toolName: 'read', toolInput: { path: '/test' } })}\n\nevent: tool_result\ndata: ${JSON.stringify({ toolName: 'read', success: true, result: 'content' })}\n\n`
    )

    await parseExecutionSSE(resp, { onToolUse, onToolResult })

    expect(onToolUse).toHaveBeenCalledWith({ toolName: 'read', toolInput: { path: '/test' } })
    expect(onToolResult).toHaveBeenCalledWith({ toolName: 'read', success: true, result: 'content' })
  })

  it('routes error events with JSON format', async () => {
    const onError = vi.fn()
    const resp = mockSSEResponse(
      `event: error\ndata: ${JSON.stringify({ error: 'Provider not available' })}\n\n`
    )

    await parseExecutionSSE(resp, { onError })

    expect(onError).toHaveBeenCalledWith('Provider not available')
  })

  it('routes error events with plain text', async () => {
    const onError = vi.fn()
    const resp = mockSSEResponse('event: error\ndata: plain error message\n\n')

    await parseExecutionSSE(resp, { onError })

    expect(onError).toHaveBeenCalledWith('plain error message')
  })

  it('routes aborted as done with empty IDs', async () => {
    const onDone = vi.fn()
    const resp = mockSSEResponse('event: aborted\ndata: user cancelled\n\n')

    await parseExecutionSSE(resp, { onDone })

    expect(onDone).toHaveBeenCalledWith({ executionId: '', nodeId: '' })
  })

  it('ignores heartbeat events', async () => {
    const events: string[] = []
    const resp = mockSSEResponse(
      'event: heartbeat\ndata: \n\nevent: text\ndata: real\n\n'
    )

    await parseExecutionSSE(resp, {
      onText: (t) => events.push(t),
    })

    expect(events).toEqual(['real'])
  })
})
