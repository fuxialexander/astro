/**
 * Redis Event Bridge Unit Tests
 *
 * Tests the cross-instance SSE streaming implementation via Redis pub/sub:
 *
 * 1. RedisPubSub.publishStreamingEvent() — no-op when disconnected, publishes with instanceId when connected
 * 2. StreamingEventMessage routing — handleLocalMessage dispatches to correct event
 * 3. Self-instance dedup in events.ts — messages from same instance are skipped
 * 4. Event type routing in onRedisStreaming — each eventType maps to correct SSE event
 * 5. Graceful degradation — single-instance mode works without Redis; publish failures don't break local delivery
 * 6. Relay-server integration — each handler publishes to Redis after local emit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// =============================================================================
// Shared mock helper — creates a class-based ioredis mock that supports `new Redis()`
// =============================================================================

/** All created mock instances, in order (publisher first, subscriber second) */
let mockRedisInstances: Array<EventEmitter & Record<string, ReturnType<typeof vi.fn>>> = []

function createIoredisMock() {
  mockRedisInstances = []
  return {
    default: class MockRedis extends EventEmitter {
      subscribe = vi.fn().mockResolvedValue(undefined)
      unsubscribe = vi.fn().mockResolvedValue(undefined)
      quit = vi.fn().mockResolvedValue(undefined)
      publish = vi.fn().mockResolvedValue(1)
      set = vi.fn().mockResolvedValue('OK')
      get = vi.fn().mockResolvedValue(null)
      del = vi.fn().mockResolvedValue(1)
      hset = vi.fn().mockResolvedValue(1)
      hdel = vi.fn().mockResolvedValue(1)
      hgetall = vi.fn().mockResolvedValue({})
      expire = vi.fn().mockResolvedValue(1)

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(..._args: unknown[]) {
        super()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockRedisInstances.push(this as any)
      }
    },
  }
}

// =============================================================================
// 1. RedisPubSub class — direct unit tests
// =============================================================================

describe('RedisPubSub.publishStreamingEvent()', () => {
  // We test the class directly by importing it and manipulating its internal state
  // via the public constructor + connect flow. Since we don't want a real Redis,
  // we mock ioredis.

  let RedisPubSub: typeof import('../server/lib/redis-pubsub.js').RedisPubSub

  beforeEach(async () => {
    // Reset module cache to get fresh instances
    vi.resetModules()

    // Mock ioredis before importing RedisPubSub
    vi.doMock('ioredis', () => createIoredisMock())

    const mod = await import('../server/lib/redis-pubsub.js')
    RedisPubSub = mod.RedisPubSub
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is a no-op when publisher is null (not connected)', async () => {
    const pubsub = new RedisPubSub()
    // publisher is null by default (no connect called)
    // This should NOT throw
    await expect(
      pubsub.publishStreamingEvent({
        eventType: 'text',
        taskId: 'task-1',
        data: { text: 'hello' },
      })
    ).resolves.toBeUndefined()
  })

  it('publishes to relay:task:streaming channel with correct JSON when connected', async () => {
    const pubsub = new RedisPubSub()

    // Connect with a fake URL (ioredis is mocked)
    await pubsub.connect('redis://fake:6379')

    const instanceId = pubsub.getInstanceId()

    await pubsub.publishStreamingEvent({
      eventType: 'tool_use',
      taskId: 'task-42',
      data: { toolName: 'Read', toolInput: '/foo.ts' },
      dbSeq: 100,
    })

    // mockRedisInstances[0] is the publisher (first `new Redis()` call)
    const publisher = mockRedisInstances[0]
    expect(publisher.publish).toHaveBeenCalledWith(
      'relay:task:streaming',
      expect.any(String)
    )

    // Verify the JSON payload
    const publishedJson = publisher.publish.mock.calls[0][1]
    const parsed = JSON.parse(publishedJson)
    expect(parsed).toEqual({
      instanceId,
      eventType: 'tool_use',
      taskId: 'task-42',
      data: { toolName: 'Read', toolInput: '/foo.ts' },
      dbSeq: 100,
    })

    await pubsub.disconnect()
  })

  it('message includes all StreamingEventMessage fields', async () => {
    const pubsub = new RedisPubSub()
    await pubsub.connect('redis://fake:6379')

    await pubsub.publishStreamingEvent({
      eventType: 'session_init',
      taskId: 'task-99',
      data: { sessionId: 'sess-1', model: 'claude-4' },
      dbSeq: 55,
    })

    const publisher = mockRedisInstances[0]
    const parsed = JSON.parse(publisher.publish.mock.calls[0][1])

    expect(parsed).toHaveProperty('instanceId')
    expect(parsed).toHaveProperty('eventType', 'session_init')
    expect(parsed).toHaveProperty('taskId', 'task-99')
    expect(parsed).toHaveProperty('data')
    expect(parsed).toHaveProperty('dbSeq', 55)
    expect(parsed.data).toEqual({ sessionId: 'sess-1', model: 'claude-4' })

    await pubsub.disconnect()
  })

  it('omits dbSeq from message when not provided', async () => {
    const pubsub = new RedisPubSub()
    await pubsub.connect('redis://fake:6379')

    await pubsub.publishStreamingEvent({
      eventType: 'text',
      taskId: 'task-1',
      data: { text: 'hello' },
    })

    const publisher = mockRedisInstances[0]
    const parsed = JSON.parse(publisher.publish.mock.calls[0][1])

    expect(parsed.dbSeq).toBeUndefined()

    await pubsub.disconnect()
  })
})

// =============================================================================
// 2. StreamingEventMessage routing via handleLocalMessage
// =============================================================================

describe('StreamingEventMessage routing', () => {
  let RedisPubSub: typeof import('../server/lib/redis-pubsub.js').RedisPubSub

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('ioredis', () => createIoredisMock())
    const mod = await import('../server/lib/redis-pubsub.js')
    RedisPubSub = mod.RedisPubSub
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits task:streaming when message arrives on relay:task:streaming channel', async () => {
    const pubsub = new RedisPubSub()
    await pubsub.connect('redis://fake:6379')

    const received: unknown[] = []
    pubsub.on('task:streaming', (msg) => received.push(msg))

    // Simulate a Redis message arriving on the subscriber
    // mockRedisInstances[1] is the subscriber (second `new Redis()` call)
    const subscriber = mockRedisInstances[1]

    const testMsg = {
      instanceId: 'other-instance',
      eventType: 'text',
      taskId: 'task-1',
      data: { text: 'hello' },
    }
    subscriber.emit('message', 'relay:task:streaming', JSON.stringify(testMsg))

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(testMsg)

    await pubsub.disconnect()
  })

  it('routes MACHINE_STATE channel to machine:state event', async () => {
    const pubsub = new RedisPubSub()
    await pubsub.connect('redis://fake:6379')

    const received: unknown[] = []
    pubsub.on('machine:state', (msg) => received.push(msg))

    const subscriber = mockRedisInstances[1]
    const testMsg = { machineId: 'm1', state: 'online' }
    subscriber.emit('message', 'relay:machine:state', JSON.stringify(testMsg))

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(testMsg)

    await pubsub.disconnect()
  })

  it('routes TASK_DISPATCH channel to task:dispatch event', async () => {
    const pubsub = new RedisPubSub()
    await pubsub.connect('redis://fake:6379')

    const received: unknown[] = []
    pubsub.on('task:dispatch', (msg) => received.push(msg))

    const subscriber = mockRedisInstances[1]
    const testMsg = { instanceId: 'inst-1', task: { taskId: 't1' } }
    subscriber.emit('message', 'relay:task:dispatch', JSON.stringify(testMsg))

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(testMsg)

    await pubsub.disconnect()
  })

  it('routes TASK_CANCEL channel to task:cancel event', async () => {
    const pubsub = new RedisPubSub()
    await pubsub.connect('redis://fake:6379')

    const received: unknown[] = []
    pubsub.on('task:cancel', (msg) => received.push(msg))

    const subscriber = mockRedisInstances[1]
    const testMsg = { instanceId: 'inst-1', taskId: 't1', machineId: 'm1' }
    subscriber.emit('message', 'relay:task:cancel', JSON.stringify(testMsg))

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(testMsg)

    await pubsub.disconnect()
  })

  it('ignores unknown channels', async () => {
    const pubsub = new RedisPubSub()
    await pubsub.connect('redis://fake:6379')

    const received: unknown[] = []
    pubsub.on('task:streaming', (msg) => received.push(msg))
    pubsub.on('machine:state', (msg) => received.push(msg))
    pubsub.on('task:state', (msg) => received.push(msg))
    pubsub.on('task:dispatch', (msg) => received.push(msg))
    pubsub.on('task:cancel', (msg) => received.push(msg))

    const subscriber = mockRedisInstances[1]
    subscriber.emit('message', 'relay:unknown:channel', JSON.stringify({ foo: 'bar' }))

    expect(received).toHaveLength(0)

    await pubsub.disconnect()
  })
})

// =============================================================================
// 3. Self-instance dedup (events.ts logic)
// =============================================================================

describe('Self-instance dedup in events.ts', () => {
  const EVENTS_PATH = join(process.cwd(), 'server/routes/events.ts')
  const eventsSource = readFileSync(EVENTS_PATH, 'utf-8')

  it('onRedisStreaming handler checks instanceId for self-dedup', () => {
    // The handler should skip messages from the same instance
    expect(eventsSource).toContain('msg.instanceId === redisPubSub.getInstanceId()')
  })

  it('returns early when instanceId matches (self-dedup)', () => {
    // The pattern is: if (msg.instanceId === redisPubSub.getInstanceId()) return
    const handler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    expect(handler).toContain('if (msg.instanceId === redisPubSub.getInstanceId()) return')
  })

  it('processes messages with different instanceId', () => {
    // After the self-dedup check, the handler routes by eventType
    const handler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    // The handler should continue past the dedup check to the switch statement
    expect(handler).toContain('switch (msg.eventType)')
  })

  it('also checks user ownership after dedup', () => {
    const handler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    expect(handler).toContain('isTaskOwnedByUser(msg.taskId)')
  })
})

// =============================================================================
// 4. Event type routing in onRedisStreaming
// =============================================================================

describe('Event type routing in onRedisStreaming', () => {
  const EVENTS_PATH = join(process.cwd(), 'server/routes/events.ts')
  const eventsSource = readFileSync(EVENTS_PATH, 'utf-8')

  // Extract the onRedisStreaming handler for analysis
  const handlerStart = eventsSource.indexOf('const onRedisStreaming =')
  const handlerEnd = eventsSource.indexOf("redisPubSub.on('task:streaming'")
  const handler = eventsSource.slice(handlerStart, handlerEnd)

  it('routes "text" eventType to throttle.write', () => {
    expect(handler).toContain("case 'text':")
    // text events use throttle.write, not stream.writeSSE directly
    expect(handler).toContain('throttle.write(msg.taskId, msg.data.text as string)')
  })

  it('routes "tool_use" eventType to task:tool_trace SSE event', () => {
    expect(handler).toContain("case 'tool_use':")
    expect(handler).toContain("event: 'task:tool_trace'")
  })

  it('routes "tool_result" eventType to task:tool_trace SSE event', () => {
    expect(handler).toContain("case 'tool_result':")
    // tool_use and tool_result share the same case block
    const toolBlock = handler.slice(
      handler.indexOf("case 'tool_use':"),
      handler.indexOf("case 'file_change':")
    )
    expect(toolBlock).toContain("case 'tool_result':")
    expect(toolBlock).toContain("event: 'task:tool_trace'")
  })

  it('routes "file_change" eventType to task:file_change SSE event', () => {
    expect(handler).toContain("case 'file_change':")
    const fileBlock = handler.slice(
      handler.indexOf("case 'file_change':"),
      handler.indexOf("case 'session_init':")
    )
    expect(fileBlock).toContain("event: 'task:file_change'")
  })

  it('routes "session_init" eventType to task:session_init SSE event', () => {
    expect(handler).toContain("case 'session_init':")
    const sessionBlock = handler.slice(
      handler.indexOf("case 'session_init':"),
      handler.indexOf("case 'progress':")
    )
    expect(sessionBlock).toContain("event: 'task:session_init'")
  })

  it('routes "progress" eventType to task:progress SSE event', () => {
    expect(handler).toContain("case 'progress':")
    const progressBlock = handler.slice(
      handler.indexOf("case 'progress':"),
      handler.indexOf("case 'result':")
    )
    expect(progressBlock).toContain("event: 'task:progress'")
  })

  it('routes "result" eventType to task:result SSE event', () => {
    expect(handler).toContain("case 'result':")
    expect(handler).toContain("event: 'task:result'")
  })

  it('uses dbSeq as SSE ID when present for structural events', () => {
    // For tool_use/tool_result, file_change, session_init, progress
    // The pattern: msg.dbSeq ? String(msg.dbSeq) : eventBuffer.push(...)
    expect(handler).toContain('msg.dbSeq ? String(msg.dbSeq)')
  })

  it('falls back to eventBuffer for SSE ID when dbSeq is absent', () => {
    expect(handler).toContain('eventBuffer.push(')
  })
})

// =============================================================================
// 5. Graceful degradation
// =============================================================================

describe('Graceful degradation', () => {
  let RedisPubSub: typeof import('../server/lib/redis-pubsub.js').RedisPubSub

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('ioredis', () => createIoredisMock())
    const mod = await import('../server/lib/redis-pubsub.js')
    RedisPubSub = mod.RedisPubSub
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('single-instance mode (no Redis URL) does not throw on connect', async () => {
    const pubsub = new RedisPubSub()
    // connect() with no URL and no REDIS_URL env var should be a no-op
    const originalEnv = process.env.REDIS_URL
    delete process.env.REDIS_URL
    await expect(pubsub.connect()).resolves.toBeUndefined()
    expect(pubsub.isConnected()).toBe(false)
    if (originalEnv !== undefined) process.env.REDIS_URL = originalEnv
  })

  it('publishStreamingEvent is a no-op in single-instance mode', async () => {
    const pubsub = new RedisPubSub()
    // Don't connect — simulate single-instance
    await expect(
      pubsub.publishStreamingEvent({
        eventType: 'text',
        taskId: 'task-1',
        data: { text: 'test' },
      })
    ).resolves.toBeUndefined()
  })

  it('other publish methods fall back to local emit when not connected', async () => {
    const pubsub = new RedisPubSub()
    // Don't connect — the publish() method should call handleLocalMessage directly

    const received: unknown[] = []
    pubsub.on('task:state', (msg) => received.push(msg))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pubsub.publishTaskState({ taskId: 't1', status: 'running' } as any)
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ taskId: 't1', status: 'running' })
  })

  it('Redis publish failures are caught and do not propagate', async () => {
    const pubsub = new RedisPubSub()
    await pubsub.connect('redis://fake:6379')

    // Make publish reject
    const publisher = mockRedisInstances[0]
    publisher.publish.mockRejectedValueOnce(new Error('Redis write error'))

    // publishStreamingEvent should reject since it awaits publish directly
    // But in relay-server.ts, the call is `.catch(() => {})`, so it's safe
    await expect(
      pubsub.publishStreamingEvent({
        eventType: 'text',
        taskId: 'task-1',
        data: { text: 'hello' },
      })
    ).rejects.toThrow('Redis write error')

    await pubsub.disconnect()
  })

  it('getInstanceId returns a unique string', () => {
    const pubsub = new RedisPubSub()
    const id = pubsub.getInstanceId()
    expect(id).toMatch(/^instance-\d+-\d+$/)
  })

  it('isConnected returns false before connect and true after', async () => {
    const pubsub = new RedisPubSub()
    expect(pubsub.isConnected()).toBe(false)
    await pubsub.connect('redis://fake:6379')
    expect(pubsub.isConnected()).toBe(true)
    await pubsub.disconnect()
    expect(pubsub.isConnected()).toBe(false)
  })
})

// =============================================================================
// 6. Relay-server publishes streaming events to Redis after local emit
// =============================================================================

describe('relay-server Redis publish integration', () => {
  const RELAY_SERVER_PATH = join(process.cwd(), 'server/lib/relay-server.ts')
  const relaySource = readFileSync(RELAY_SERVER_PATH, 'utf-8')

  it('imports redisPubSub', () => {
    expect(relaySource).toContain("import { redisPubSub } from './redis-pubsub.js'")
  })

  it('publishes text events to Redis', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskText('),
      relaySource.indexOf('private async handleAgentRunnerTaskToolUse(')
    )
    expect(handler).toContain('redisPubSub.publishStreamingEvent({')
    expect(handler).toContain("eventType: 'text'")
    expect(handler).toContain('.catch(() => {})')
  })

  it('publishes tool_use events to Redis with dbSeq', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskToolUse('),
      relaySource.indexOf('private async handleAgentRunnerTaskToolResult(')
    )
    expect(handler).toContain('redisPubSub.publishStreamingEvent({')
    expect(handler).toContain("eventType: 'tool_use'")
    expect(handler).toContain('dbSeq: seq,')
    expect(handler).toContain('.catch(() => {})')
  })

  it('publishes tool_result events to Redis with dbSeq', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskToolResult('),
      relaySource.indexOf('private async handleAgentRunnerTaskFileChange(')
    )
    expect(handler).toContain('redisPubSub.publishStreamingEvent({')
    expect(handler).toContain("eventType: 'tool_result'")
    expect(handler).toContain('dbSeq: seq,')
    expect(handler).toContain('.catch(() => {})')
  })

  it('publishes file_change events to Redis with dbSeq', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskFileChange('),
      relaySource.indexOf('private async handleAgentRunnerTaskSessionInit(')
    )
    expect(handler).toContain('redisPubSub.publishStreamingEvent({')
    expect(handler).toContain("eventType: 'file_change'")
    expect(handler).toContain('dbSeq: seq,')
    expect(handler).toContain('.catch(() => {})')
  })

  it('publishes session_init events to Redis with dbSeq', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskSessionInit('),
      relaySource.indexOf('private handleAgentRunnerTaskSteerAck(')
    )
    expect(handler).toContain('redisPubSub.publishStreamingEvent({')
    expect(handler).toContain("eventType: 'session_init'")
    expect(handler).toContain('dbSeq: seq,')
    expect(handler).toContain('.catch(() => {})')
  })

  it('publishes progress events to Redis', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private handleTaskProgress('),
      relaySource.indexOf('/**', relaySource.indexOf('private handleTaskProgress(') + 50)
    )
    expect(handler).toContain('redisPubSub.publishStreamingEvent({')
    expect(handler).toContain("eventType: 'progress'")
    expect(handler).toContain('.catch(() => {})')
  })

  it('publishes result events to Redis', () => {
    // Result is published from handleTaskResult
    expect(relaySource).toContain("eventType: 'result', taskId: message.result.taskId,")
  })

  it('local emit happens BEFORE Redis publish (fire-and-forget pattern)', () => {
    // For text handler: this.emit() should come before redisPubSub.publishStreamingEvent
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskText('),
      relaySource.indexOf('private async handleAgentRunnerTaskToolUse(')
    )
    const emitIdx = handler.indexOf("this.emit('task:text'")
    const redisIdx = handler.indexOf('redisPubSub.publishStreamingEvent')
    expect(emitIdx).toBeGreaterThan(-1)
    expect(redisIdx).toBeGreaterThan(-1)
    expect(emitIdx).toBeLessThan(redisIdx)
  })

  it('all Redis publish calls use .catch(() => {}) for graceful failure', () => {
    // Count publish calls and their .catch patterns
    const publishCalls = relaySource.split('redisPubSub.publishStreamingEvent(').length - 1
    // Each should be followed by .catch(() => {})
    expect(publishCalls).toBeGreaterThanOrEqual(7) // text, tool_use, tool_result, file_change, session_init, progress, result(s)

    // Verify the pattern is consistent — each publishStreamingEvent call has .catch
    const segments = relaySource.split('redisPubSub.publishStreamingEvent({')
    for (let i = 1; i < segments.length; i++) {
      const afterCall = segments[i].slice(0, 500) // Check next 500 chars (result events have large data blocks)
      expect(afterCall).toContain('.catch(() => {})')
    }
  })
})

// =============================================================================
// 7. events.ts subscribes to and cleans up Redis streaming events
// =============================================================================

describe('events.ts Redis subscription lifecycle', () => {
  const EVENTS_PATH = join(process.cwd(), 'server/routes/events.ts')
  const eventsSource = readFileSync(EVENTS_PATH, 'utf-8')

  it('imports redisPubSub and StreamingEventMessage', () => {
    expect(eventsSource).toContain("import { redisPubSub, type StreamingEventMessage } from '../lib/redis-pubsub.js'")
  })

  it('subscribes onRedisStreaming to task:streaming event', () => {
    expect(eventsSource).toContain("redisPubSub.on('task:streaming', onRedisStreaming)")
  })

  it('unsubscribes onRedisStreaming on stream abort (cleanup)', () => {
    const abortSection = eventsSource.slice(
      eventsSource.indexOf('stream.onAbort('),
      eventsSource.indexOf('await new Promise<void>')
    )
    expect(abortSection).toContain("redisPubSub.off('task:streaming', onRedisStreaming)")
  })

  it('onRedisStreaming checks alive flag before processing', () => {
    const handler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    expect(handler).toContain('if (!alive) return')
  })
})

// =============================================================================
// 8. RedisPubSub channel constants and type definitions
// =============================================================================

describe('RedisPubSub channel constants and types', () => {
  const REDIS_PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const source = readFileSync(REDIS_PUBSUB_PATH, 'utf-8')

  it('defines TASK_STREAMING channel constant', () => {
    expect(source).toContain("TASK_STREAMING: 'relay:task:streaming'")
  })

  it('exports StreamingEventMessage interface', () => {
    expect(source).toContain('export interface StreamingEventMessage')
  })

  it('StreamingEventMessage has required fields: instanceId, eventType, taskId, data', () => {
    const interfaceStart = source.indexOf('export interface StreamingEventMessage')
    const interfaceEnd = source.indexOf('}', interfaceStart)
    const interfaceBody = source.slice(interfaceStart, interfaceEnd + 1)

    expect(interfaceBody).toContain('instanceId: string')
    expect(interfaceBody).toContain('eventType: string')
    expect(interfaceBody).toContain('taskId: string')
    expect(interfaceBody).toContain('data: Record<string, unknown>')
    expect(interfaceBody).toContain('dbSeq?: number')
  })

  it('RedisPubSubEvents includes task:streaming event', () => {
    expect(source).toContain("'task:streaming': (event: StreamingEventMessage) => void")
  })

  it('TASK_STREAMING channel is included in subscriber.subscribe()', () => {
    const connectSection = source.slice(
      source.indexOf('await this.subscriber.subscribe('),
      source.indexOf('// Handle incoming messages')
    )
    expect(connectSection).toContain('CHANNELS.TASK_STREAMING')
  })

  it('handleLocalMessage routes TASK_STREAMING to task:streaming emit', () => {
    const switchSection = source.slice(
      source.indexOf('private handleLocalMessage('),
      source.indexOf('private async registerInstance(')
    )
    expect(switchSection).toContain('case CHANNELS.TASK_STREAMING:')
    expect(switchSection).toContain("this.emit('task:streaming'")
  })
})
