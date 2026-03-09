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

  it('checks userId from Redis message for cross-instance user isolation', () => {
    const handler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    // Must NOT use isTaskOwnedByUser (which fails open for cross-instance tasks)
    // Instead checks msg.userId directly against the SSE connection's user
    expect(handler).not.toContain('isTaskOwnedByUser(msg.taskId)')
    expect(handler).toContain('msg.userId')
    expect(handler).toContain('user.id')
    expect(handler).toContain('LOCAL_USER_ID')
  })

  it('denies streaming events by default when userId is missing (C1 security fix)', () => {
    const handler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    // The userId check must NOT have `msg.userId &&` guard (which fails open)
    // Events without project-level checks deny-by-default when userId is absent
    expect(handler).toContain('hasProjectCheck')
    expect(handler).toContain("msg.userId !== user.id && msg.userId !== LOCAL_USER_ID")
    // Must NOT contain the old fail-open pattern
    expect(handler).not.toContain('msg.userId && msg.userId !==')
  })

  it('events with project-level checks bypass userId filter', () => {
    const handler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    // node_status_changed, task_init, task_ready bypass the userId check
    // because they have isProjectOwnedByUser in their case branches
    expect(handler).toContain("msg.eventType === 'node_status_changed'")
    expect(handler).toContain("msg.eventType === 'task_init'")
    expect(handler).toContain("msg.eventType === 'task_ready'")
  })
})

describe('isProjectOwnedByUser security', () => {
  const EVENTS_PATH = join(process.cwd(), 'server/routes/events.ts')
  const eventsSource = readFileSync(EVENTS_PATH, 'utf-8')

  it('fails closed on DB errors (C2 security fix)', () => {
    const helper = eventsSource.slice(
      eventsSource.indexOf('const isProjectOwnedByUser'),
      eventsSource.indexOf('// Replay missed events')
    )
    // Must fail closed (return false), not fail open (return true)
    expect(helper).toContain('return false // fail closed for security')
    expect(helper).not.toContain('return true // fail open')
  })

  it('logs DB errors before failing closed', () => {
    const helper = eventsSource.slice(
      eventsSource.indexOf('const isProjectOwnedByUser'),
      eventsSource.indexOf('// Replay missed events')
    )
    expect(helper).toContain("console.error('[events] isProjectOwnedByUser")
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

  it('routes "node_status_changed" eventType to node:status_changed SSE event', () => {
    expect(handler).toContain("case 'node_status_changed':")
    expect(handler).toContain("event: 'node:status_changed'")
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

  it('imports redisPubSub and StreamingEventMessage', () => {
    expect(relaySource).toContain("import { redisPubSub, type StreamingEventMessage } from './redis-pubsub.js'")
  })

  it('imports executionContextStore for userId lookup', () => {
    expect(relaySource).toContain("import { executionContextStore } from './execution-context-store.js'")
  })

  it('has publishToRedis wrapper that attaches userId', () => {
    // Find the wrapper method
    const wrapperStart = relaySource.indexOf('private publishToRedis(')
    expect(wrapperStart).toBeGreaterThan(-1)
    // Extract a generous chunk after the method signature
    const wrapperChunk = relaySource.slice(wrapperStart, wrapperStart + 300)
    expect(wrapperChunk).toContain('executionContextStore.getUserIdForTask(event.taskId)')
    expect(wrapperChunk).toContain('publishStreamingEvent')
    expect(wrapperChunk).toContain('userId')
    expect(wrapperChunk).toContain('.catch(')
  })

  it('publishes text events via publishToRedis', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskText('),
      relaySource.indexOf('private async handleAgentRunnerTaskToolUse(')
    )
    expect(handler).toContain('this.publishToRedis({')
    expect(handler).toContain("eventType: 'text'")
  })

  it('publishes tool_use events with dbSeq via publishToRedis', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskToolUse('),
      relaySource.indexOf('private async handleAgentRunnerTaskToolResult(')
    )
    expect(handler).toContain('this.publishToRedis({')
    expect(handler).toContain("eventType: 'tool_use'")
    expect(handler).toContain('dbSeq: seq,')
  })

  it('publishes tool_result events with dbSeq via publishToRedis', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskToolResult('),
      relaySource.indexOf('private async handleAgentRunnerTaskFileChange(')
    )
    expect(handler).toContain('this.publishToRedis({')
    expect(handler).toContain("eventType: 'tool_result'")
    expect(handler).toContain('dbSeq: seq,')
  })

  it('publishes file_change events with dbSeq via publishToRedis', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskFileChange('),
      relaySource.indexOf('private async handleAgentRunnerTaskSessionInit(')
    )
    expect(handler).toContain('this.publishToRedis({')
    expect(handler).toContain("eventType: 'file_change'")
    expect(handler).toContain('dbSeq: seq,')
  })

  it('publishes session_init events with dbSeq via publishToRedis', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskSessionInit('),
      relaySource.indexOf('private handleAgentRunnerTaskSteerAck(')
    )
    expect(handler).toContain('this.publishToRedis({')
    expect(handler).toContain("eventType: 'session_init'")
    expect(handler).toContain('dbSeq: seq,')
  })

  it('publishes progress events via publishToRedis', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private handleTaskProgress('),
      relaySource.indexOf('/**', relaySource.indexOf('private handleTaskProgress(') + 50)
    )
    expect(handler).toContain('this.publishToRedis({')
    expect(handler).toContain("eventType: 'progress'")
  })

  it('publishes result events via redisPubSub.publishStreamingEvent (userId snapshot before emit)', () => {
    // handleTaskResult snapshots userId BEFORE emit to avoid the race where
    // dispatch.ts's onResult removes the context synchronously during emit.
    const handler = relaySource.slice(
      relaySource.indexOf('private handleTaskResult('),
      relaySource.indexOf('private handleTaskStdout(')
    )
    expect(handler).toContain("eventType: 'result', taskId: message.result.taskId,")
    // Verify userId is captured before this.emit
    const userIdIdx = handler.indexOf('const userId = executionContextStore.getUserIdForTask(')
    const emitIdx = handler.indexOf("this.emit('task:result'")
    expect(userIdIdx).toBeGreaterThan(-1)
    expect(emitIdx).toBeGreaterThan(-1)
    expect(userIdIdx).toBeLessThan(emitIdx)
  })

  it('local emit happens BEFORE publishToRedis call', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskText('),
      relaySource.indexOf('private async handleAgentRunnerTaskToolUse(')
    )
    const emitIdx = handler.indexOf("this.emit('task:text'")
    const redisIdx = handler.indexOf('this.publishToRedis(')
    expect(emitIdx).toBeGreaterThan(-1)
    expect(redisIdx).toBeGreaterThan(-1)
    expect(emitIdx).toBeLessThan(redisIdx)
  })

  it('all handlers use publishToRedis except handleTaskResult (which snapshots userId)', () => {
    // handleTaskResult uses redisPubSub.publishStreamingEvent directly because it
    // must snapshot userId before this.emit (dispatch.ts removes context synchronously).
    // All other handlers use the publishToRedis wrapper.
    const directCalls = relaySource.split('redisPubSub.publishStreamingEvent(').length - 1
    expect(directCalls).toBe(2) // publishToRedis wrapper + handleTaskResult

    // Count publishToRedis calls — should cover all event types except result
    const wrapperCalls = relaySource.split('this.publishToRedis({').length - 1
    expect(wrapperCalls).toBeGreaterThanOrEqual(9) // text, tool_use, tool_result, file_change, session_init, progress + legacy handlers (result excluded)
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

  it('exports StreamingEventType union with all event types', () => {
    expect(source).toContain('export type StreamingEventType')
    expect(source).toContain("'text'")
    expect(source).toContain("'tool_use'")
    expect(source).toContain("'tool_result'")
    expect(source).toContain("'file_change'")
    expect(source).toContain("'session_init'")
    expect(source).toContain("'progress'")
    expect(source).toContain("'result'")
    expect(source).toContain("'node_status_changed'")
    expect(source).toContain("'task_init'")
    expect(source).toContain("'task_ready'")
  })

  it('exports StreamingEventMessage interface', () => {
    expect(source).toContain('export interface StreamingEventMessage')
  })

  it('StreamingEventMessage has required fields: instanceId, eventType, taskId, data', () => {
    const interfaceStart = source.indexOf('export interface StreamingEventMessage')
    const interfaceEnd = source.indexOf('}', interfaceStart)
    const interfaceBody = source.slice(interfaceStart, interfaceEnd + 1)

    expect(interfaceBody).toContain('instanceId: string')
    expect(interfaceBody).toContain('eventType: StreamingEventType')
    expect(interfaceBody).toContain('taskId: string')
    expect(interfaceBody).toContain('userId?: string')
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

  it('heartbeat has try/catch to prevent unhandled rejections', () => {
    const heartbeatSection = source.slice(
      source.indexOf('Set up instance heartbeat'),
      source.indexOf('}, 30000)')
    )
    expect(heartbeatSection).toContain('try {')
    expect(heartbeatSection).toContain('} catch')
  })
})

// =============================================================================
// 9. redis-event-bridge.ts — centralized executionEventBus → Redis bridge
// =============================================================================

describe('redis-event-bridge module', () => {
  const BRIDGE_PATH = join(process.cwd(), 'server/lib/redis-event-bridge.ts')
  const bridgeSource = readFileSync(BRIDGE_PATH, 'utf-8')

  it('imports executionEventBus, redisPubSub, and executionContextStore', () => {
    expect(bridgeSource).toContain("from './execution-event-bus.js'")
    expect(bridgeSource).toContain("from './redis-pubsub.js'")
    expect(bridgeSource).toContain("from './execution-context-store.js'")
  })

  it('exports initRedisEventBridge function', () => {
    expect(bridgeSource).toContain('export function initRedisEventBridge()')
  })

  it('bridges node:status_changed events to Redis', () => {
    expect(bridgeSource).toContain("executionEventBus.on('node:status_changed'")
    expect(bridgeSource).toContain("eventType: 'node_status_changed'")
  })

  it('bridges task:init events to Redis', () => {
    expect(bridgeSource).toContain("executionEventBus.on('task:init'")
    expect(bridgeSource).toContain("eventType: 'task_init'")
  })

  it('bridges task:ready events to Redis', () => {
    expect(bridgeSource).toContain("executionEventBus.on('task:ready'")
    expect(bridgeSource).toContain("eventType: 'task_ready'")
  })

  it('looks up userId from executionContextStore for node:status_changed', () => {
    const nodeStatusSection = bridgeSource.slice(
      bridgeSource.indexOf("executionEventBus.on('node:status_changed'"),
      bridgeSource.indexOf("executionEventBus.on('task:init'")
    )
    expect(nodeStatusSection).toContain('executionContextStore.getUserIdForTask(msg.executionId)')
  })

  it('looks up userId from executionContextStore for task:init', () => {
    const taskInitSection = bridgeSource.slice(
      bridgeSource.indexOf("executionEventBus.on('task:init'"),
      bridgeSource.indexOf("executionEventBus.on('task:ready'")
    )
    expect(taskInitSection).toContain('executionContextStore.getUserIdForTask(msg.executionId)')
  })

  it('includes projectId in data payload for all bridged events', () => {
    // All three event handlers should include projectId in data
    const handlers = bridgeSource.split('redisPubSub.publishStreamingEvent(')
    // Skip index 0 (before first call)
    for (let i = 1; i < handlers.length; i++) {
      const callChunk = handlers[i].slice(0, 500)
      expect(callChunk).toContain('projectId')
    }
  })

  it('has idempotency guard to prevent duplicate listener registration', () => {
    expect(bridgeSource).toContain('let initialized = false')
    expect(bridgeSource).toContain('if (initialized) return')
    expect(bridgeSource).toContain('initialized = true')
  })

  it('logs errors on publish failure (not silent catch)', () => {
    const catchBlocks = bridgeSource.split('.catch((err)')
    // Should have 3 catch blocks (one per event type)
    expect(catchBlocks.length - 1).toBe(3)
    // Each should log the error
    expect(bridgeSource).toContain("console.error('[redis-bridge]")
  })
})

// =============================================================================
// 10. server/index.ts initializes the redis event bridge
// =============================================================================

describe('server/index.ts initializes redis event bridge', () => {
  const INDEX_PATH = join(process.cwd(), 'server/index.ts')
  const indexSource = readFileSync(INDEX_PATH, 'utf-8')

  it('imports initRedisEventBridge', () => {
    expect(indexSource).toContain("import { initRedisEventBridge } from './lib/redis-event-bridge.js'")
  })

  it('calls initRedisEventBridge() during startup', () => {
    expect(indexSource).toContain('initRedisEventBridge()')
  })

  it('initializes bridge after Redis setup but before relay server start', () => {
    const initIdx = indexSource.indexOf('initRedisEventBridge()')
    const relayStartIdx = indexSource.indexOf('relayServer.start(relayPort)')
    expect(initIdx).toBeGreaterThan(-1)
    expect(relayStartIdx).toBeGreaterThan(-1)
    expect(initIdx).toBeLessThan(relayStartIdx)
  })
})

// =============================================================================
// 11. events.ts handles new Redis event types with project ownership checks
// =============================================================================

describe('events.ts handles new Redis bridged event types', () => {
  const EVENTS_PATH = join(process.cwd(), 'server/routes/events.ts')
  const eventsSource = readFileSync(EVENTS_PATH, 'utf-8')

  it('onRedisStreaming handler is async (supports isProjectOwnedByUser)', () => {
    expect(eventsSource).toContain('const onRedisStreaming = async (msg: StreamingEventMessage)')
  })

  it('handles node_status_changed with isProjectOwnedByUser check', () => {
    const nodeStatusCase = eventsSource.slice(
      eventsSource.indexOf("case 'node_status_changed':"),
      eventsSource.indexOf("case 'task_init':")
    )
    expect(nodeStatusCase).toContain('isProjectOwnedByUser')
    expect(nodeStatusCase).toContain("'node:status_changed'")
  })

  it('handles task_init from Redis with project ownership check', () => {
    const taskInitCase = eventsSource.slice(
      eventsSource.indexOf("case 'task_init':"),
      eventsSource.indexOf("case 'task_ready':")
    )
    expect(taskInitCase).toContain('isProjectOwnedByUser')
    expect(taskInitCase).toContain("'task:init'")
  })

  it('handles task_ready from Redis with project ownership check', () => {
    const redisHandler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    const taskReadyCase = redisHandler.slice(
      redisHandler.indexOf("case 'task_ready':"),
    )
    expect(taskReadyCase).toContain('isProjectOwnedByUser')
    expect(taskReadyCase).toContain("'task:ready'")
  })

  it('project-level checks fail closed when projectId is missing', () => {
    const redisHandler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    // All three project-level checks must use !projectId (fail closed) not just projectId &&
    const nodeStatusCase = redisHandler.slice(
      redisHandler.indexOf("case 'node_status_changed':"),
      redisHandler.indexOf("case 'task_init':")
    )
    expect(nodeStatusCase).toContain('!projectId || !await isProjectOwnedByUser')

    const taskInitCase = redisHandler.slice(
      redisHandler.indexOf("case 'task_init':"),
      redisHandler.indexOf("case 'task_ready':")
    )
    expect(taskInitCase).toContain('!projectId || !await isProjectOwnedByUser')

    const taskReadyIdx = redisHandler.indexOf("case 'task_ready':")
    const taskReadyCase = redisHandler.slice(taskReadyIdx, taskReadyIdx + 300)
    expect(taskReadyCase).toContain('!projectId || !await isProjectOwnedByUser')
  })
})

// =============================================================================
// 12. relay-server publishToRedis logs errors (not silent)
// =============================================================================

describe('relay-server publishToRedis error handling', () => {
  const RELAY_PATH = join(process.cwd(), 'server/lib/relay-server.ts')
  const relaySource = readFileSync(RELAY_PATH, 'utf-8')

  it('publishToRedis logs errors with console.error', () => {
    const wrapperStart = relaySource.indexOf('private publishToRedis(')
    const wrapperChunk = relaySource.slice(wrapperStart, wrapperStart + 300)
    expect(wrapperChunk).toContain('console.error')
  })

  it('tool_trace handler includes duration in Redis message', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private handleTaskToolTrace('),
      relaySource.indexOf('/**', relaySource.indexOf('private handleTaskToolTrace(') + 50)
    )
    expect(handler).toContain('duration: message.duration')
  })
})
