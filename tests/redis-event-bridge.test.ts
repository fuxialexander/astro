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

      constructor(..._args: unknown[]) {
        super()
         
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

  it('uses project/task ownership checks for cross-instance user isolation', () => {
    const handler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    // Project-scoped events use isProjectOwnedByUser (team-scoped DB check)
    expect(handler).toContain('isProjectOwnedByUser(')
    // Task-scoped events (error) use isTaskOwnedByUser
    expect(handler).toContain('isTaskOwnedByUser(msg.taskId)')
  })

  it('all Redis-delivered events deny by default (fail closed via ownership check)', () => {
    const handler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    // Every case that delivers an SSE event must pass an ownership check.
    // The default case has no delivery — unknown events are silently ignored.
    expect(handler).toContain('default:')
    expect(handler).toContain('break')
    // All delivered events are gated behind isProjectOwnedByUser or isTaskOwnedByUser
    expect(handler).toContain('isProjectOwnedByUser(')
    expect(handler).toContain('isTaskOwnedByUser(')
  })

  it('project-scoped events use switch cases with isProjectOwnedByUser', () => {
    const handler = eventsSource.slice(
      eventsSource.indexOf('const onRedisStreaming ='),
      eventsSource.indexOf("redisPubSub.on('task:streaming'")
    )
    expect(handler).toContain("case 'node_status_changed':")
    expect(handler).toContain("case 'task_init':")
    expect(handler).toContain("case 'task_ready':")
  })
})

describe('isProjectOwnedByUser security', () => {
  const EVENTS_PATH = join(process.cwd(), 'server/routes/events.ts')
  const eventsSource = readFileSync(EVENTS_PATH, 'utf-8')

  it('uses isProjectAccessibleToUser as the authoritative DB ownership check', () => {
    const helper = eventsSource.slice(
      eventsSource.indexOf('const isProjectOwnedByUser'),
      eventsSource.indexOf('const canAccessTaskContext')
    )
    // Delegates to the shared helper that performs the team-scoped DB query
    expect(helper).toContain('isProjectAccessibleToUser(')
  })

  it('caches ownership promises to avoid redundant DB queries per SSE connection', () => {
    const helper = eventsSource.slice(
      eventsSource.indexOf('const isProjectOwnedByUser'),
      eventsSource.indexOf('const canAccessTaskContext')
    )
    expect(helper).toContain('projectAccessCache')
  })
})

// =============================================================================
// 4. Event type routing in onRedisStreaming
// =============================================================================

describe('Event type routing in onRedisStreaming', () => {
  // NOTE: text/tool_use/tool_result/file_change/session_init/progress events
  // are NOT routed through Redis pub/sub. They travel via the in-process
  // relayServer EventEmitter (onRelayText, onRelayToolTrace, etc.) registered
  // in events.ts. Redis pub/sub only carries cross-instance coordination events.
  const EVENTS_PATH = join(process.cwd(), 'server/routes/events.ts')
  const eventsSource = readFileSync(EVENTS_PATH, 'utf-8')

  // Extract the onRedisStreaming handler for analysis
  const handlerStart = eventsSource.indexOf('const onRedisStreaming =')
  const handlerEnd = eventsSource.indexOf("redisPubSub.on('task:streaming'")
  const handler = eventsSource.slice(handlerStart, handlerEnd)

  it('routes "node_status_changed" eventType to node:status_changed SSE event', () => {
    expect(handler).toContain("case 'node_status_changed':")
    expect(handler).toContain("event: 'node:status_changed'")
  })

  it('routes "task_init" eventType to task:init SSE event', () => {
    expect(handler).toContain("case 'task_init':")
    expect(handler).toContain("event: 'task:init'")
  })

  it('routes "task_ready" eventType to task:ready SSE event', () => {
    expect(handler).toContain("case 'task_ready':")
    expect(handler).toContain("event: 'task:ready'")
  })

  it('routes "plan_result" eventType to task:plan_result SSE event', () => {
    expect(handler).toContain("case 'plan_result':")
    expect(handler).toContain("event: 'task:plan_result'")
  })

  it('routes "error" eventType to task:error SSE event', () => {
    expect(handler).toContain("case 'error':")
    expect(handler).toContain("event: 'task:error'")
  })

  it('has a default case that silently ignores unknown event types', () => {
    expect(handler).toContain('default:')
  })

  it('uses dbSeq as SSE ID when present (plan_result)', () => {
    expect(handler).toContain('msg.dbSeq ? String(msg.dbSeq)')
  })

  it('falls back to eventBuffer for SSE ID when dbSeq is absent', () => {
    expect(handler).toContain('eventBuffer.push(')
  })

  it('text/tool_use/tool_result/file_change/session_init NOT in Redis handler (they use relayServer EventEmitter)', () => {
    // These events travel via in-process emitters — no Redis hop needed on the same instance.
    // Cross-instance delivery is via DB catch-up (streaming_events table), not Redis.
    expect(handler).not.toContain("case 'text':")
    expect(handler).not.toContain("case 'tool_use':")
    expect(handler).not.toContain("case 'tool_result':")
    expect(handler).not.toContain("case 'file_change':")
    expect(handler).not.toContain("case 'session_init':")
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
    // Find the wrapper method (declared async to support getUserIdForTaskWithFallback)
    const wrapperStart = relaySource.indexOf('private async publishToRedis(')
    expect(wrapperStart).toBeGreaterThan(-1)
    // Extract a generous chunk after the method signature
    const wrapperChunk = relaySource.slice(wrapperStart, wrapperStart + 2000)
    // Uses async fallback — first checks local cache, then queries Redis for cross-instance tasks
    expect(wrapperChunk).toContain('getUserIdForTaskWithFallback(event.taskId)')
    expect(wrapperChunk).toContain('publishStreamingEvent')
    expect(wrapperChunk).toContain('userId')
    // Uses try/catch for error handling (not .catch())
    expect(wrapperChunk).toContain('try {')
    expect(wrapperChunk).toContain('console.error')
  })

  it('publishes text events via publishToRedis', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskText('),
      relaySource.indexOf('private async handleAgentRunnerTaskToolUse(')
    )
    expect(handler).toContain('this.publishToRedis({')
    expect(handler).toContain("eventType: 'text'")
  })

  it('does not persist empty text heartbeats as durable streaming text', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskText('),
      relaySource.indexOf('private async handleAgentRunnerTaskToolUse(')
    )
    expect(handler).toContain('if (payload.text.length > 0)')
    expect(handler).toContain('streamingEventLog.appendText(payload.taskId, payload.text)')
  })

  it('routes text via wake-up only and sends empty text as activity', () => {
    const wrapperStart = relaySource.indexOf('private async publishToRedis(')
    const wrapperChunk = relaySource.slice(wrapperStart, wrapperStart + 2000)
    // Empty text → compact 'activity' ping (no DB row).
    expect(wrapperChunk).toContain("eventType: 'activity'")
    expect(wrapperChunk).toContain("source: 'task_text_heartbeat'")
    // Non-empty text → schedule a periodic streamingEventLog flush; the
    // 'text-flushed' subscriber publishes a tiny {taskId, dbSeq} wake-up.
    expect(wrapperChunk).toContain('this.scheduleTextFlush(event.taskId)')
    expect(relaySource).toContain('private scheduleTextFlush(taskId: string)')
    // Wake-up subscriber publishes only seq, not text payload.
    expect(relaySource).toContain("streamingEventLog.on('text-flushed'")
    expect(relaySource).toContain("eventType: 'text'")
    expect(relaySource).toContain('dbSeq: seq,')
    // Receiver fetches the durable row from Postgres on wake-up.
    expect(relaySource).toContain('private fetchAndEmitText(taskId: string, seq: number)')
    expect(relaySource).toContain('streamingEventLog.getOne(taskId, seq)')
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
      relaySource.indexOf('private async handleTaskResult('),
      relaySource.indexOf('private handleTaskStdout(')
    )
    expect(handler).toContain("eventType: 'result', taskId: message.result.taskId,")
    // userId is snapshotted via async fallback before this.emit
    const userIdIdx = handler.indexOf('getUserIdForTaskWithFallback(message.result.taskId)')
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

  it('all handlers use publishToRedis except handleTaskResult and emitSyntheticTaskError', () => {
    // handleTaskResult uses redisPubSub.publishStreamingEvent directly (userId snapshot before emit).
    // emitSyntheticTaskError also calls it directly. The publishToRedis wrapper itself is a third call.
    const directCalls = relaySource.split('redisPubSub.publishStreamingEvent(').length - 1
    expect(directCalls).toBeGreaterThanOrEqual(3) // wrapper + handleTaskResult + emitSyntheticTaskError (+ any future additions)

    // Count publishToRedis calls — should cover all event types except result
    const wrapperCalls = relaySource.split('this.publishToRedis({').length - 1
    expect(wrapperCalls).toBeGreaterThanOrEqual(9) // text, tool_use, tool_result, file_change, session_init, progress + others
  })
})

describe('Redis cost controls', () => {
  const RELAY_SERVER_PATH = join(process.cwd(), 'server/lib/relay-server.ts')
  const relaySource = readFileSync(RELAY_SERVER_PATH, 'utf-8')
  const SERVER_INDEX_PATH = join(process.cwd(), 'server/index.ts')
  const indexSource = readFileSync(SERVER_INDEX_PATH, 'utf-8')

  it('throttles machine heartbeat writes to Redis until routing state changes', () => {
    expect(relaySource).toContain('private shouldPublishMachineHeartbeat(machineId: string, activeTasks: string[])')
    expect(relaySource).toContain("parseEnvMs('REDIS_MACHINE_UPDATE_INTERVAL_MS', 300_000, 60_000)")
    expect(relaySource).toContain('previous.activeTaskSignature !== activeTaskSignature')
    expect(relaySource).toContain('now - previous.publishedAt >= this.redisMachineUpdateIntervalMs')
    const heartbeat = relaySource.slice(
      relaySource.indexOf('private handleAgentRunnerHeartbeat('),
      relaySource.indexOf('/**', relaySource.indexOf('private handleAgentRunnerHeartbeat(') + 50)
    )
    expect(heartbeat).toContain('this.shouldPublishMachineHeartbeat(machine.machineId, activeTasks)')
    expect(heartbeat).toContain('redisPubSub.updateMachine(machine.machineId, updatedEntry)')
  })

  it('targets WebSocket proxy responses instead of broadcasting every response', () => {
    expect(indexSource).toContain('const proxyResponseTargets = new Map')
    expect(indexSource).toContain('rememberProxyResponseTarget(correlationId, event.instanceId)')
    expect(indexSource).toContain('if (event.targetInstanceId && event.targetInstanceId !== redisPubSub.getInstanceId()) return')
    expect(indexSource).toContain('const targetInstanceId = consumeProxyResponseTarget(correlationId)')
    expect(indexSource).toContain('if (!targetInstanceId) return // local request/response; Redis is not needed')
    expect(indexSource).toContain('targetInstanceId,')
  })

  it('uses cached leadership in schedulers to skip Redis on most ticks', () => {
    const REDIS_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
    const redisSource = readFileSync(REDIS_PATH, 'utf-8')
    expect(redisSource).toContain('async checkLeadership(')
    expect(redisSource).toContain('this.leadershipCache')
    expect(redisSource).toContain('now - cached.checkedAt < checkIntervalMs')

    // All four schedulers route through the cached helper rather than
    // calling tryAcquireLeader + renewLeadership on every tick.
    const dispatchSource = readFileSync(join(process.cwd(), 'server/lib/dispatch/dispatch-engine.ts'), 'utf-8')
    expect(dispatchSource).toContain('redisPubSub.checkLeadership(')
    const cronSource = readFileSync(join(process.cwd(), 'server/lib/cron-scheduler.ts'), 'utf-8')
    expect(cronSource).toContain('redisPubSub.checkLeadership(LEADER_NAME')
    const watchdogSource = readFileSync(join(process.cwd(), 'server/lib/execution-watchdog.ts'), 'utf-8')
    expect(watchdogSource).toContain('redisPubSub.checkLeadership(LEADER_NAME')
    const cleanupSource = readFileSync(join(process.cwd(), 'server/lib/cleanup-scheduler.ts'), 'utf-8')
    expect(cleanupSource).toContain('redisPubSub.checkLeadership(LEADER_NAME')
    expect(cleanupSource).toContain('redisPubSub.checkLeadership(STREAMING_LEADER_NAME')
  })

  it('exposes per-method Redis command metrics', () => {
    const REDIS_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
    const redisSource = readFileSync(REDIS_PATH, 'utf-8')
    expect(redisSource).toContain('getCommandMetrics()')
    expect(redisSource).toContain('private trackCommand(method: string')
    // Hot publish paths are instrumented.
    expect(redisSource).toContain("this.trackCommand(`publish:streaming:${event.eventType}`)")
    expect(redisSource).toContain("this.trackCommand(`publish:ws_proxy_response:${event.responseType}`)")
    expect(redisSource).toContain("this.trackCommand('tryAcquireLeader')")

    const HEALTH_PATH = join(process.cwd(), 'server/routes/health.ts')
    const healthSource = readFileSync(HEALTH_PATH, 'utf-8')
    expect(healthSource).toContain("healthRoute.get('/redis-metrics'")
    expect(healthSource).toContain('redisPubSub.getCommandMetrics()')
  })

  it('publishes text via Postgres-backed wake-up instead of Redis payload', () => {
    expect(relaySource).toContain("streamingEventLog.on('text-flushed'")
    expect(relaySource).toContain('private fetchAndEmitText(taskId: string, seq: number)')
    expect(relaySource).toContain('streamingEventLog.getOne(taskId, seq)')
    // The wake-up payload omits text — it carries only dbSeq for receivers to fetch.
    const wakeupPublish = relaySource.slice(
      relaySource.indexOf('this.textFlushedListener'),
      relaySource.indexOf('this.textFlushedListener') + 800,
    )
    expect(wakeupPublish).toContain("eventType: 'text'")
    expect(wakeupPublish).toContain('dbSeq: seq,')
    expect(wakeupPublish).toContain('data: {},')

    const STREAMING_LOG_PATH = join(process.cwd(), 'server/lib/streaming-event-log.ts')
    const logSource = readFileSync(STREAMING_LOG_PATH, 'utf-8')
    expect(logSource).toContain("this.emit('text-flushed'")
    expect(logSource).toContain('async getOne(executionId: string, seq: number)')
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
    expect(source).toContain("'activity'")
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
    const wrapperStart = relaySource.indexOf('private async publishToRedis(')
    const wrapperChunk = relaySource.slice(wrapperStart, wrapperStart + 2000)
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
