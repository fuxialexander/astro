/**
 * SSE Parser Unit Tests
 *
 * Tests the SSE stream parser used for chat and execution endpoints.
 * Creates mock Response objects to simulate server-sent events.
 */
import { describe, it, expect } from 'vitest'
import { parseSSEStream } from '../src/lib/sse-parser'

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

// parseChatSSE and parseExecutionSSE tests removed — functions deleted in Phase 3.4
// (POST + subscribe: all events now flow through the global SSE bus)
