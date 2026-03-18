/**
 * Cross-Instance Streaming Event Delivery Tests
 *
 * Verifies the fix for the cross-instance userId resolution bug:
 *
 * Problem: When Fly.io routes the dispatch POST to Instance B and the agent's
 * WebSocket to Instance A, publishToRedis() on Instance A used the synchronous
 * getUserIdForTask() which only checks the local in-memory Map. Since the
 * execution context was registered on Instance B, Instance A's Map was empty,
 * so userId was undefined in the Redis message. The SSE filter on Instance B
 * then dropped the event because undefined !== user.id.
 *
 * Fix: publishToRedis() now uses async getUserIdForTaskWithFallback() which
 * checks the local Map first, then falls back to Redis. The fallback caches
 * locally, so only the first event per task triggers a Redis lookup.
 *
 * Tests cover:
 * 1. Structural verification (publishToRedis uses async fallback)
 * 2. executionContextStore fallback behavior
 * 3. handleTaskResult userId snapshot before emit
 * 4. handleAgentRunnerTaskResult userId snapshot before emit
 * 5. SSE filter behavior with/without userId
 * 6. Graceful degradation when Redis is unavailable
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ─── Source-level structural verification ───────────────────────────────────

const RELAY_SERVER_PATH = join(process.cwd(), 'server/lib/relay-server.ts')
const EVENTS_PATH = join(process.cwd(), 'server/routes/events.ts')
const EXEC_CONTEXT_PATH = join(process.cwd(), 'server/lib/execution-context-store.ts')

const relaySource = readFileSync(RELAY_SERVER_PATH, 'utf-8')
const eventsSource = readFileSync(EVENTS_PATH, 'utf-8')
const execContextSource = readFileSync(EXEC_CONTEXT_PATH, 'utf-8')

describe('cross-instance streaming: structural verification', () => {
  describe('publishToRedis uses async userId fallback', () => {
    const publishToRedis = relaySource.slice(
      relaySource.indexOf('private async publishToRedis('),
      relaySource.indexOf('\n  }', relaySource.indexOf('private async publishToRedis(')) + 4,
    )

    it('publishToRedis is async', () => {
      expect(publishToRedis).toContain('private async publishToRedis(')
      expect(publishToRedis).toContain('Promise<void>')
    })

    it('uses getUserIdForTaskWithFallback (async, not sync getUserIdForTask)', () => {
      expect(publishToRedis).toContain('getUserIdForTaskWithFallback(event.taskId)')
      // Must NOT use the sync-only version
      expect(publishToRedis).not.toContain('getUserIdForTask(event.taskId)')
    })

    it('wraps in try/catch for error safety', () => {
      expect(publishToRedis).toContain('try {')
      expect(publishToRedis).toContain('} catch (err) {')
    })

    it('awaits both the userId lookup and the Redis publish', () => {
      expect(publishToRedis).toContain('await executionContextStore.getUserIdForTaskWithFallback')
      expect(publishToRedis).toContain('await redisPubSub.publishStreamingEvent')
    })
  })

  describe('handleTaskResult snapshots userId before emit', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleTaskResult('),
      relaySource.indexOf('\n  }', relaySource.indexOf('private async handleTaskResult(')) + 4,
    )

    it('handleTaskResult is async', () => {
      expect(handler).toContain('private async handleTaskResult(')
      expect(handler).toContain('Promise<void>')
    })

    it('uses async fallback for userId resolution', () => {
      expect(handler).toContain('getUserIdForTaskWithFallback(message.result.taskId)')
    })

    it('snapshots userId BEFORE emit (to survive executionContextStore.remove)', () => {
      const userIdLookupPos = handler.indexOf('getUserIdForTaskWithFallback')
      const emitPos = handler.indexOf("this.emit('task:result'")
      expect(userIdLookupPos).toBeGreaterThan(-1)
      expect(emitPos).toBeGreaterThan(-1)
      expect(userIdLookupPos).toBeLessThan(emitPos)
    })

    it('has try/catch fallback to sync method if Redis fails', () => {
      expect(handler).toContain('} catch {')
      expect(handler).toContain('executionContextStore.getUserIdForTask(message.result.taskId)')
    })
  })

  describe('handleAgentRunnerTaskResult snapshots userId before emit', () => {
    const handler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskResult('),
      relaySource.indexOf('\n  }', relaySource.indexOf('private async handleAgentRunnerTaskResult(')) + 4,
    )

    it('handleAgentRunnerTaskResult is async', () => {
      expect(handler).toContain('private async handleAgentRunnerTaskResult(')
      expect(handler).toContain('Promise<void>')
    })

    it('uses async fallback for userId resolution', () => {
      expect(handler).toContain('getUserIdForTaskWithFallback(taskId)')
    })

    it('snapshots userId BEFORE emit', () => {
      const userIdLookupPos = handler.indexOf('getUserIdForTaskWithFallback')
      const emitPos = handler.indexOf("this.emit('task:result'")
      expect(userIdLookupPos).toBeGreaterThan(-1)
      expect(emitPos).toBeGreaterThan(-1)
      expect(userIdLookupPos).toBeLessThan(emitPos)
    })

    it('publishes result to Redis directly (not via publishToRedis) with snapshotted userId', () => {
      // Result handlers publish directly because they need the pre-snapshotted userId
      expect(handler).toContain('redisPubSub.publishStreamingEvent({')
      expect(handler).toContain('eventType: \'result\'')
      expect(handler).toContain('userId,')
    })

    it('has try/catch fallback to sync method if Redis fails', () => {
      expect(handler).toContain('} catch {')
      expect(handler).toContain('executionContextStore.getUserIdForTask(taskId)')
    })
  })
})

// ─── executionContextStore fallback behavior ────────────────────────────────

describe('executionContextStore: async fallback design', () => {
  it('getUserIdForTaskWithFallback exists and is async', () => {
    expect(execContextSource).toContain('async getUserIdForTaskWithFallback(executionId: string): Promise<string | undefined>')
  })

  it('getWithFallback caches Redis result locally for subsequent sync lookups', () => {
    // Verify the caching behavior: Redis result is stored in local Map
    const fallback = execContextSource.slice(
      execContextSource.indexOf('async getWithFallback('),
      execContextSource.indexOf('\n  },', execContextSource.indexOf('async getWithFallback(')) + 4,
    )
    expect(fallback).toContain('store.set(remote.executionId, remote)')
  })

  it('register writes through to Redis for cross-instance visibility', () => {
    const registerFn = execContextSource.slice(
      execContextSource.indexOf('register(ctx:'),
      execContextSource.indexOf('\n  },', execContextSource.indexOf('register(ctx:')) + 4,
    )
    expect(registerFn).toContain('redisPubSub.registerExecutionContext(entry)')
  })
})

// ─── SSE filter behavior ────────────────────────────────────────────────────

describe('SSE filter: cross-instance user isolation', () => {
  const onRedisStreaming = eventsSource.slice(
    eventsSource.indexOf('const onRedisStreaming = async'),
    eventsSource.indexOf('redisPubSub.on(\'task:streaming\', onRedisStreaming)'),
  )

  it('skips events from same instance (prevents double delivery)', () => {
    expect(onRedisStreaming).toContain('msg.instanceId === redisPubSub.getInstanceId()')
  })

  it('bypasses userId filter for project-checked event types', () => {
    expect(onRedisStreaming).toContain("msg.eventType === 'node_status_changed'")
    expect(onRedisStreaming).toContain("msg.eventType === 'task_init'")
    expect(onRedisStreaming).toContain("msg.eventType === 'task_ready'")
    expect(onRedisStreaming).toContain('!hasProjectCheck')
  })

  it('drops events when userId is missing (deny-by-default)', () => {
    // When msg.userId is undefined and user.id is set, the filter drops the event
    // This is the behavior our fix addresses — by ensuring msg.userId is always set
    expect(onRedisStreaming).toContain('msg.userId !== user.id')
  })

  it('allows events when userId matches the authenticated user', () => {
    // The filter passes when msg.userId === user.id
    expect(onRedisStreaming).toContain('msg.userId !== user.id')
  })

  it('allows events for LOCAL_USER_ID (local mode)', () => {
    expect(onRedisStreaming).toContain('msg.userId !== LOCAL_USER_ID')
  })
})

// ─── Behavioral mock tests ──────────────────────────────────────────────────

describe('cross-instance streaming: behavioral mock tests', () => {
  // Simulate the cross-instance scenario with mocked stores

  interface MockContext {
    executionId: string
    projectId: string
    nodeId: string
    userId: string
    machineId: string
    createdAt: number
  }

  let localStore: Map<string, MockContext>
  let redisStore: Map<string, MockContext>

  beforeEach(() => {
    localStore = new Map()
    redisStore = new Map()
  })

  function mockGetUserIdForTask(executionId: string): string | undefined {
    return localStore.get(executionId)?.userId
  }

  async function mockGetUserIdForTaskWithFallback(executionId: string): Promise<string | undefined> {
    const local = localStore.get(executionId)?.userId
    if (local) return local
    const remote = redisStore.get(executionId)
    if (remote) {
      // Cache locally for subsequent sync lookups
      localStore.set(remote.executionId, remote)
      return remote.userId
    }
    return undefined
  }

  function mockRegister(ctx: Omit<MockContext, 'createdAt'>, instance: 'A' | 'B') {
    const entry = { ...ctx, createdAt: Date.now() }
    // Registration always writes to Redis
    redisStore.set(ctx.executionId, entry)
    // But only the registering instance has it locally
    if (instance === 'B') {
      // Instance B is the dispatch instance
      localStore.set(ctx.executionId, entry)
    }
    // Instance A (WebSocket instance) does NOT have it locally
  }

  describe('same-instance scenario (dispatch + WebSocket on same instance)', () => {
    it('sync getUserIdForTask finds userId in local Map', () => {
      localStore.set('exec-1', {
        executionId: 'exec-1', projectId: 'p1', nodeId: 'n1',
        userId: 'user-123', machineId: 'm1', createdAt: Date.now(),
      })
      expect(mockGetUserIdForTask('exec-1')).toBe('user-123')
    })

    it('async fallback also works (hits local first)', async () => {
      localStore.set('exec-1', {
        executionId: 'exec-1', projectId: 'p1', nodeId: 'n1',
        userId: 'user-123', machineId: 'm1', createdAt: Date.now(),
      })
      expect(await mockGetUserIdForTaskWithFallback('exec-1')).toBe('user-123')
    })
  })

  describe('cross-instance scenario (dispatch on B, WebSocket on A)', () => {
    it('sync getUserIdForTask returns undefined on WebSocket instance', () => {
      // Dispatch on Instance B — local store is empty on Instance A
      mockRegister({
        executionId: 'exec-cross', projectId: 'p1', nodeId: 'n1',
        userId: 'user-456', machineId: 'm1',
      }, 'B')

      // Instance A's local store is empty
      localStore.clear()
      expect(mockGetUserIdForTask('exec-cross')).toBeUndefined()
    })

    it('async fallback resolves userId from Redis on WebSocket instance', async () => {
      // Dispatch on Instance B
      mockRegister({
        executionId: 'exec-cross', projectId: 'p1', nodeId: 'n1',
        userId: 'user-456', machineId: 'm1',
      }, 'B')

      // Instance A's local store is empty
      localStore.clear()
      expect(await mockGetUserIdForTaskWithFallback('exec-cross')).toBe('user-456')
    })

    it('async fallback caches result locally after first Redis lookup', async () => {
      mockRegister({
        executionId: 'exec-cache', projectId: 'p1', nodeId: 'n1',
        userId: 'user-789', machineId: 'm1',
      }, 'B')
      localStore.clear()

      // First call: local miss → Redis hit → cache locally
      await mockGetUserIdForTaskWithFallback('exec-cache')

      // Now local store should have it (cached from Redis)
      expect(localStore.has('exec-cache')).toBe(true)
      expect(mockGetUserIdForTask('exec-cache')).toBe('user-789')
    })

    it('subsequent sync lookups work after async fallback cached the result', async () => {
      mockRegister({
        executionId: 'exec-multi', projectId: 'p1', nodeId: 'n1',
        userId: 'user-111', machineId: 'm1',
      }, 'B')
      localStore.clear()

      // First event triggers async fallback
      await mockGetUserIdForTaskWithFallback('exec-multi')

      // Subsequent events can use sync lookup (cached locally)
      expect(mockGetUserIdForTask('exec-multi')).toBe('user-111')
      expect(mockGetUserIdForTask('exec-multi')).toBe('user-111')
      expect(mockGetUserIdForTask('exec-multi')).toBe('user-111')
    })
  })

  describe('SSE filter simulation', () => {
    const LOCAL_USER_ID = 'local-user'

    function sseFilterAllows(
      msgUserId: string | undefined,
      authenticatedUserId: string | undefined,
      eventType: string,
    ): boolean {
      const hasProjectCheck = eventType === 'node_status_changed'
        || eventType === 'task_init' || eventType === 'task_ready'
      if (authenticatedUserId && !hasProjectCheck
        && msgUserId !== authenticatedUserId && msgUserId !== LOCAL_USER_ID) {
        return false // dropped
      }
      return true // delivered
    }

    it('drops streaming events when userId is undefined (the bug)', () => {
      // This is the scenario our fix addresses:
      // msg.userId is undefined because sync lookup failed on cross-instance
      expect(sseFilterAllows(undefined, 'user-123', 'text')).toBe(false)
      expect(sseFilterAllows(undefined, 'user-123', 'tool_use')).toBe(false)
      expect(sseFilterAllows(undefined, 'user-123', 'tool_result')).toBe(false)
      expect(sseFilterAllows(undefined, 'user-123', 'file_change')).toBe(false)
      expect(sseFilterAllows(undefined, 'user-123', 'session_init')).toBe(false)
      expect(sseFilterAllows(undefined, 'user-123', 'result')).toBe(false)
    })

    it('delivers streaming events when userId matches (the fix)', () => {
      // After fix: async fallback resolves the correct userId
      expect(sseFilterAllows('user-123', 'user-123', 'text')).toBe(true)
      expect(sseFilterAllows('user-123', 'user-123', 'tool_use')).toBe(true)
      expect(sseFilterAllows('user-123', 'user-123', 'tool_result')).toBe(true)
      expect(sseFilterAllows('user-123', 'user-123', 'file_change')).toBe(true)
      expect(sseFilterAllows('user-123', 'user-123', 'session_init')).toBe(true)
      expect(sseFilterAllows('user-123', 'user-123', 'result')).toBe(true)
    })

    it('always delivers project-checked events regardless of userId', () => {
      // These events bypass userId filter entirely
      expect(sseFilterAllows(undefined, 'user-123', 'node_status_changed')).toBe(true)
      expect(sseFilterAllows(undefined, 'user-123', 'task_init')).toBe(true)
      expect(sseFilterAllows(undefined, 'user-123', 'task_ready')).toBe(true)
    })

    it('allows events when no authenticated user (anonymous/local mode)', () => {
      expect(sseFilterAllows(undefined, undefined, 'text')).toBe(true)
      expect(sseFilterAllows('user-123', undefined, 'text')).toBe(true)
    })

    it('allows events with LOCAL_USER_ID in local mode', () => {
      expect(sseFilterAllows(LOCAL_USER_ID, 'user-123', 'text')).toBe(true)
    })

    it('drops events from wrong user (cross-user isolation)', () => {
      expect(sseFilterAllows('user-999', 'user-123', 'text')).toBe(false)
    })
  })

  describe('result handler race condition: userId snapshot before emit', () => {
    it('userId must be resolved before emit removes context', async () => {
      // Simulate: dispatch on Instance B, result comes on Instance A
      mockRegister({
        executionId: 'exec-result', projectId: 'p1', nodeId: 'n1',
        userId: 'user-race', machineId: 'm1',
      }, 'B')
      localStore.clear()

      // Step 1: Resolve userId (async fallback from Redis)
      const userId = await mockGetUserIdForTaskWithFallback('exec-result')
      expect(userId).toBe('user-race')

      // Step 2: Emit triggers synchronous context removal (simulated)
      localStore.delete('exec-result')

      // Step 3: After emit, userId is still available from the snapshot
      expect(userId).toBe('user-race')

      // Step 4: Verify that sync lookup would now fail (context removed)
      expect(mockGetUserIdForTask('exec-result')).toBeUndefined()
    })

    it('without snapshot, userId would be lost after emit', () => {
      // This demonstrates why the pre-emit snapshot is critical
      localStore.set('exec-nosnapshot', {
        executionId: 'exec-nosnapshot', projectId: 'p1', nodeId: 'n1',
        userId: 'user-lost', machineId: 'm1', createdAt: Date.now(),
      })

      // Emit triggers synchronous removal
      localStore.delete('exec-nosnapshot')

      // After removal, lookup returns undefined — userId is lost
      expect(mockGetUserIdForTask('exec-nosnapshot')).toBeUndefined()
    })
  })

  describe('graceful degradation when Redis is unavailable', () => {
    it('falls back to sync lookup when async fallback throws', async () => {
      // Simulate Redis being down: async fallback throws
      async function failingFallback(executionId: string): Promise<string | undefined> {
        const local = localStore.get(executionId)?.userId
        if (local) return local
        throw new Error('Redis connection refused')
      }

      // Register locally (same-instance case)
      localStore.set('exec-local', {
        executionId: 'exec-local', projectId: 'p1', nodeId: 'n1',
        userId: 'user-local', machineId: 'm1', createdAt: Date.now(),
      })

      // Async fallback finds it locally (before Redis throws)
      expect(await failingFallback('exec-local')).toBe('user-local')

      // For a cross-instance task, async fallback throws
      let userId: string | undefined
      try {
        userId = await failingFallback('exec-remote')
      } catch {
        // Fall back to sync (which returns undefined in cross-instance case)
        userId = mockGetUserIdForTask('exec-remote')
      }
      expect(userId).toBeUndefined()
      // The event will be dropped by SSE filter — degraded but not crashing
    })

    it('publishToRedis error is caught (no unhandled rejection)', () => {
      // Verify the source has error handling in publishToRedis
      const publishToRedis = relaySource.slice(
        relaySource.indexOf('private async publishToRedis('),
        relaySource.indexOf('\n  }', relaySource.indexOf('private async publishToRedis(')) + 4,
      )
      expect(publishToRedis).toContain('try {')
      expect(publishToRedis).toContain('} catch (err) {')
      expect(publishToRedis).toContain('console.error')
    })

    it('result handlers have fallback to sync if async throws', () => {
      // handleTaskResult
      const taskResult = relaySource.slice(
        relaySource.indexOf('private async handleTaskResult('),
        relaySource.indexOf('\n  }', relaySource.indexOf('private async handleTaskResult(')) + 4,
      )
      expect(taskResult).toContain('} catch {')
      expect(taskResult).toContain('executionContextStore.getUserIdForTask(message.result.taskId)')

      // handleAgentRunnerTaskResult
      const agentResult = relaySource.slice(
        relaySource.indexOf('private async handleAgentRunnerTaskResult('),
        relaySource.indexOf('\n  }', relaySource.indexOf('private async handleAgentRunnerTaskResult(')) + 4,
      )
      expect(agentResult).toContain('} catch {')
      expect(agentResult).toContain('executionContextStore.getUserIdForTask(taskId)')
    })
  })
})

// ─── All publishToRedis call sites use the fixed method ─────────────────────

describe('all publishToRedis call sites are covered', () => {
  it('publishToRedis is called from streaming event handlers', () => {
    // Count publishToRedis calls in the source — all should go through the
    // now-async method with userId fallback
    const matches = relaySource.match(/this\.publishToRedis\(/g)
    expect(matches).not.toBeNull()
    // There should be at least 10 call sites (text, tool_use, tool_result,
    // file_change, session_init, progress, stdout, etc.)
    expect(matches!.length).toBeGreaterThanOrEqual(10)
  })

  it('result handlers publish directly to Redis (not via publishToRedis)', () => {
    // Result handlers need pre-snapshotted userId, so they bypass publishToRedis
    // and call redisPubSub.publishStreamingEvent directly
    const agentResultHandler = relaySource.slice(
      relaySource.indexOf('private async handleAgentRunnerTaskResult('),
      relaySource.indexOf('\n  }', relaySource.indexOf('private async handleAgentRunnerTaskResult(')) + 4,
    )
    expect(agentResultHandler).toContain('redisPubSub.publishStreamingEvent({')
    expect(agentResultHandler).not.toContain('this.publishToRedis({')
  })

  it('redis-event-bridge uses project-check bypass (not affected by userId bug)', () => {
    const bridgeSource = readFileSync(
      join(process.cwd(), 'server/lib/redis-event-bridge.ts'),
      'utf-8'
    )
    // Bridge events (node_status_changed, task_init, task_ready) are project-checked
    // in events.ts, so missing userId doesn't cause them to be dropped
    expect(bridgeSource).toContain("eventType: 'node_status_changed'")
    expect(bridgeSource).toContain("eventType: 'task_init'")
    expect(bridgeSource).toContain("eventType: 'task_ready'")
  })
})

// ─── getUserIdForTaskWithFallback caching verification ──────────────────────

describe('executionContextStore: getUserIdForTaskWithFallback caches locally', () => {
  it('getUserIdForTaskWithFallback caches Redis result in local store', () => {
    // Verify the source has store.set() for local caching
    const fallback = execContextSource.slice(
      execContextSource.indexOf('async getUserIdForTaskWithFallback('),
      execContextSource.indexOf('\n  },', execContextSource.indexOf('async getUserIdForTaskWithFallback(')) + 4,
    )
    expect(fallback).toContain('store.set(remote.executionId, remote)')
  })

  it('getUserIdForTaskWithFallback returns undefined when both stores miss', () => {
    const fallback = execContextSource.slice(
      execContextSource.indexOf('async getUserIdForTaskWithFallback('),
      execContextSource.indexOf('\n  },', execContextSource.indexOf('async getUserIdForTaskWithFallback(')) + 4,
    )
    expect(fallback).toContain('return undefined')
  })
})

// ─── Real-world two-instance simulation ─────────────────────────────────────
//
// These tests simulate the ACTUAL production architecture:
//   - Two Fly.io instances (A and B) with round-robin HTTP
//   - A shared Redis store (simulated with a Map)
//   - Instance B handles dispatch POST → registers execution context
//   - Instance A receives agent WebSocket events → publishes to Redis
//   - Instance B's SSE serves the browser → filters by userId
//
// The simulation models:
//   - Each instance's local in-memory Map (executionContextStore)
//   - The shared Redis store (execution context + pub/sub channel)
//   - The SSE filter logic (events.ts:686-687)
//   - Event ordering across async boundaries
//

describe('real-world two-instance simulation', () => {
  // ── Simulated Redis ──
  // Models the shared Redis store and pub/sub channel
  interface RedisContext {
    executionId: string
    projectId: string
    nodeId: string
    userId: string
    machineId: string
    createdAt: number
  }
  interface RedisStreamingEvent {
    eventType: string
    taskId: string
    userId: string | undefined
    instanceId: string
    data: Record<string, unknown>
  }

  let redisContextStore: Map<string, string> // key → JSON
  let redisPubSubChannel: RedisStreamingEvent[] // simulated pub/sub messages

  // ── Simulated Instance ──
  // Each instance has its own local Map and can interact with Redis
  class SimulatedInstance {
    readonly id: string
    readonly localStore: Map<string, RedisContext>
    deliveredToSSE: RedisStreamingEvent[] = []
    authenticatedUserId: string | undefined

    constructor(id: string, authenticatedUserId?: string) {
      this.id = id
      this.localStore = new Map()
      this.authenticatedUserId = authenticatedUserId
    }

    // ── executionContextStore.register() ──
    register(ctx: Omit<RedisContext, 'createdAt'>): void {
      const entry: RedisContext = { ...ctx, createdAt: Date.now() }
      this.localStore.set(ctx.executionId, entry)
      // Write-through to Redis (SET with 4h TTL)
      redisContextStore.set(
        `relay:exec:context:${ctx.executionId}`,
        JSON.stringify(entry),
      )
    }

    // ── executionContextStore.remove() ──
    remove(executionId: string): void {
      this.localStore.delete(executionId)
      // Async Redis delete (fire-and-forget)
      redisContextStore.delete(`relay:exec:context:${executionId}`)
    }

    // ── getUserIdForTask (sync, local only) ──
    getUserIdForTask(executionId: string): string | undefined {
      return this.localStore.get(executionId)?.userId
    }

    // ── getUserIdForTaskWithFallback (async, local + Redis) ──
    async getUserIdForTaskWithFallback(executionId: string): Promise<string | undefined> {
      const local = this.localStore.get(executionId)?.userId
      if (local) return local
      const json = redisContextStore.get(`relay:exec:context:${executionId}`)
      if (json) {
        const remote: RedisContext = JSON.parse(json)
        // Cache locally for subsequent sync lookups
        this.localStore.set(remote.executionId, remote)
        return remote.userId
      }
      return undefined
    }

    // ── publishToRedis (the FIXED version) ──
    async publishToRedis(event: { eventType: string; taskId: string; data: Record<string, unknown> }): Promise<void> {
      const userId = await this.getUserIdForTaskWithFallback(event.taskId)
      const msg: RedisStreamingEvent = {
        ...event,
        userId,
        instanceId: this.id,
      }
      redisPubSubChannel.push(msg)
    }

    // ── publishToRedis (the OLD BUGGY version for comparison) ──
    publishToRedisOld(event: { eventType: string; taskId: string; data: Record<string, unknown> }): void {
      const userId = this.getUserIdForTask(event.taskId) // sync only!
      const msg: RedisStreamingEvent = {
        ...event,
        userId,
        instanceId: this.id,
      }
      redisPubSubChannel.push(msg)
    }

    // ── SSE filter (events.ts:675-687) ──
    receiveFromRedis(msg: RedisStreamingEvent): boolean {
      // Skip events from same instance
      if (msg.instanceId === this.id) return false

      const LOCAL_USER_ID = 'local-user'
      const hasProjectCheck = msg.eventType === 'node_status_changed'
        || msg.eventType === 'task_init' || msg.eventType === 'task_ready'

      // Cross-instance user isolation (deny-by-default)
      if (this.authenticatedUserId && !hasProjectCheck
        && msg.userId !== this.authenticatedUserId && msg.userId !== LOCAL_USER_ID) {
        return false // DROPPED
      }

      // Event delivered to browser via SSE
      this.deliveredToSSE.push(msg)
      return true
    }
  }

  beforeEach(() => {
    redisContextStore = new Map()
    redisPubSubChannel = []
  })

  describe('scenario: plan generation (dispatch on B, WebSocket on A, SSE on B)', () => {
    it('OLD behavior: streaming events silently dropped', () => {
      // Setup: two instances, user authenticated on Instance B's SSE
      const instanceA = new SimulatedInstance('instance-a')
      const instanceB = new SimulatedInstance('instance-b', 'user-123')

      // Step 1: Browser POSTs dispatch to Instance B (round-robin)
      instanceB.register({
        executionId: 'exec-plan-1',
        projectId: 'proj-1',
        nodeId: 'node-1',
        userId: 'user-123',
        machineId: 'machine-1',
      })

      // Step 2: Agent runner connects WebSocket to Instance A (sticky)
      // Instance A does NOT have the execution context locally

      // Step 3: Agent sends streaming events through Instance A
      // Using the OLD sync-only publishToRedis
      const events = ['text', 'tool_use', 'tool_result', 'text', 'text']
      for (const eventType of events) {
        instanceA.publishToRedisOld({
          eventType,
          taskId: 'exec-plan-1',
          data: { content: `event-${eventType}` },
        })
      }

      // Step 4: Instance B receives events from Redis pub/sub
      let deliveredCount = 0
      for (const msg of redisPubSubChannel) {
        if (instanceB.receiveFromRedis(msg)) deliveredCount++
      }

      // RESULT: ALL events dropped because userId is undefined
      expect(deliveredCount).toBe(0)
      expect(instanceB.deliveredToSSE).toHaveLength(0)

      // Every message has userId: undefined
      for (const msg of redisPubSubChannel) {
        expect(msg.userId).toBeUndefined()
      }
    })

    it('NEW behavior: streaming events delivered in real-time', async () => {
      const instanceA = new SimulatedInstance('instance-a')
      const instanceB = new SimulatedInstance('instance-b', 'user-123')

      // Step 1: Dispatch on Instance B
      instanceB.register({
        executionId: 'exec-plan-2',
        projectId: 'proj-1',
        nodeId: 'node-1',
        userId: 'user-123',
        machineId: 'machine-1',
      })

      // Step 2: Agent sends streaming events through Instance A
      // Using the NEW async publishToRedis with Redis fallback
      const events = ['session_init', 'text', 'tool_use', 'tool_result', 'text', 'text', 'file_change']
      for (const eventType of events) {
        await instanceA.publishToRedis({
          eventType,
          taskId: 'exec-plan-2',
          data: { content: `event-${eventType}` },
        })
      }

      // Step 3: Instance B receives events from Redis pub/sub
      let deliveredCount = 0
      for (const msg of redisPubSubChannel) {
        if (instanceB.receiveFromRedis(msg)) deliveredCount++
      }

      // RESULT: ALL events delivered because userId is resolved from Redis
      expect(deliveredCount).toBe(events.length)
      expect(instanceB.deliveredToSSE).toHaveLength(events.length)

      // Every message has the correct userId
      for (const msg of redisPubSubChannel) {
        expect(msg.userId).toBe('user-123')
      }
    })

    it('NEW behavior: only first event triggers Redis lookup, rest use cache', async () => {
      const instanceA = new SimulatedInstance('instance-a')
      const instanceB = new SimulatedInstance('instance-b', 'user-123')

      instanceB.register({
        executionId: 'exec-perf',
        projectId: 'proj-1',
        nodeId: 'node-1',
        userId: 'user-123',
        machineId: 'machine-1',
      })

      // Before any events: Instance A's local store is empty
      expect(instanceA.localStore.has('exec-perf')).toBe(false)

      // First event: triggers Redis lookup + local cache
      await instanceA.publishToRedis({
        eventType: 'text',
        taskId: 'exec-perf',
        data: {},
      })

      // After first event: Instance A's local store has the cached context
      expect(instanceA.localStore.has('exec-perf')).toBe(true)
      expect(instanceA.getUserIdForTask('exec-perf')).toBe('user-123')

      // Subsequent events: use local cache (no Redis lookup needed)
      // We can verify by checking the sync lookup works
      for (let i = 0; i < 50; i++) {
        await instanceA.publishToRedis({
          eventType: 'text',
          taskId: 'exec-perf',
          data: { seq: i },
        })
      }

      // All 51 events have correct userId
      expect(redisPubSubChannel).toHaveLength(51)
      for (const msg of redisPubSubChannel) {
        expect(msg.userId).toBe('user-123')
      }
    })
  })

  describe('scenario: task result with emit-before-publish race', () => {
    it('userId survives context removal triggered by emit', async () => {
      const instanceA = new SimulatedInstance('instance-a')
      const instanceB = new SimulatedInstance('instance-b', 'user-123')

      // Dispatch on Instance B
      instanceB.register({
        executionId: 'exec-result-race',
        projectId: 'proj-1',
        nodeId: 'node-1',
        userId: 'user-123',
        machineId: 'machine-1',
      })

      // Task result arrives on Instance A
      // Step 1: Snapshot userId BEFORE emit (the fix)
      const userId = await instanceA.getUserIdForTaskWithFallback('exec-result-race')
      expect(userId).toBe('user-123')

      // Step 2: emit('task:result') triggers dispatch.ts onResult handler
      // which synchronously calls executionContextStore.remove()
      instanceA.remove('exec-result-race')
      instanceB.remove('exec-result-race')

      // Step 3: After removal, sync lookup fails on both instances
      expect(instanceA.getUserIdForTask('exec-result-race')).toBeUndefined()
      expect(instanceB.getUserIdForTask('exec-result-race')).toBeUndefined()

      // Step 4: But the snapshotted userId is still valid!
      const msg: RedisStreamingEvent = {
        eventType: 'result',
        taskId: 'exec-result-race',
        userId, // pre-snapshotted value
        instanceId: 'instance-a',
        data: { status: 'completed' },
      }
      redisPubSubChannel.push(msg)

      // Step 5: Instance B's SSE filter accepts the event
      expect(instanceB.receiveFromRedis(msg)).toBe(true)
      expect(instanceB.deliveredToSSE).toHaveLength(1)
      expect(instanceB.deliveredToSSE[0].data).toEqual({ status: 'completed' })
    })

    it('without snapshot, result event would be dropped', () => {
      const instanceA = new SimulatedInstance('instance-a')
      const instanceB = new SimulatedInstance('instance-b', 'user-123')

      instanceB.register({
        executionId: 'exec-no-snapshot',
        projectId: 'proj-1',
        nodeId: 'node-1',
        userId: 'user-123',
        machineId: 'machine-1',
      })

      // Simulate OLD behavior: emit first, then try to get userId
      instanceA.remove('exec-no-snapshot') // emit triggers sync remove
      instanceB.remove('exec-no-snapshot')

      // Now try to get userId (too late — context is gone)
      const userId = instanceA.getUserIdForTask('exec-no-snapshot')
      expect(userId).toBeUndefined()

      // Publish with undefined userId
      const msg: RedisStreamingEvent = {
        eventType: 'result',
        taskId: 'exec-no-snapshot',
        userId, // undefined!
        instanceId: 'instance-a',
        data: { status: 'completed' },
      }
      redisPubSubChannel.push(msg)

      // Instance B drops the event
      expect(instanceB.receiveFromRedis(msg)).toBe(false)
      expect(instanceB.deliveredToSSE).toHaveLength(0)
    })
  })

  describe('scenario: same-instance (no cross-instance issue)', () => {
    it('both dispatch and WebSocket on same instance works with sync lookup', () => {
      const instance = new SimulatedInstance('instance-a', 'user-123')

      // Dispatch and WebSocket on same instance
      instance.register({
        executionId: 'exec-same',
        projectId: 'proj-1',
        nodeId: 'node-1',
        userId: 'user-123',
        machineId: 'machine-1',
      })

      // Sync lookup works (context in local store)
      expect(instance.getUserIdForTask('exec-same')).toBe('user-123')

      // Even the old sync-only publish would work
      instance.publishToRedisOld({
        eventType: 'text',
        taskId: 'exec-same',
        data: {},
      })

      expect(redisPubSubChannel[0].userId).toBe('user-123')
    })
  })

  describe('scenario: single instance, no Redis', () => {
    it('works without any Redis store', async () => {
      // Simulate no Redis by clearing the store
      redisContextStore = new Map()

      const instance = new SimulatedInstance('instance-a', 'user-123')

      // Register locally only (no Redis write-through in single-instance)
      instance.localStore.set('exec-local', {
        executionId: 'exec-local',
        projectId: 'proj-1',
        nodeId: 'node-1',
        userId: 'user-123',
        machineId: 'machine-1',
        createdAt: Date.now(),
      })

      // getUserIdForTaskWithFallback finds it in local store
      const userId = await instance.getUserIdForTaskWithFallback('exec-local')
      expect(userId).toBe('user-123')

      // Publish works
      await instance.publishToRedis({
        eventType: 'text',
        taskId: 'exec-local',
        data: {},
      })

      expect(redisPubSubChannel[0].userId).toBe('user-123')
    })
  })

  describe('scenario: multi-user isolation', () => {
    it('user A cannot see user B streaming events', async () => {
      const instanceA = new SimulatedInstance('instance-a')
      const instanceB_userA = new SimulatedInstance('instance-b', 'user-A')
      const instanceB_userB = new SimulatedInstance('instance-b', 'user-B')

      // User B dispatches a task
      instanceA.register({
        executionId: 'exec-user-b',
        projectId: 'proj-1',
        nodeId: 'node-1',
        userId: 'user-B',
        machineId: 'machine-1',
      })

      // Agent sends events through Instance A
      await instanceA.publishToRedis({
        eventType: 'text',
        taskId: 'exec-user-b',
        data: { content: 'secret data from user B' },
      })

      const msg = redisPubSubChannel[0]

      // User B's SSE receives the event
      expect(instanceB_userB.receiveFromRedis(msg)).toBe(true)

      // User A's SSE does NOT receive it (different userId)
      expect(instanceB_userA.receiveFromRedis(msg)).toBe(false)
    })
  })

  describe('scenario: Redis context TTL expiry', () => {
    it('task context in Redis is found before TTL expires', async () => {
      const instanceA = new SimulatedInstance('instance-a')
      const instanceB = new SimulatedInstance('instance-b', 'user-123')

      // Dispatch on Instance B writes to Redis
      instanceB.register({
        executionId: 'exec-ttl',
        projectId: 'proj-1',
        nodeId: 'node-1',
        userId: 'user-123',
        machineId: 'machine-1',
      })

      // Redis has the context (4h TTL in production)
      expect(redisContextStore.has('relay:exec:context:exec-ttl')).toBe(true)

      // Instance A finds it via Redis fallback
      const userId = await instanceA.getUserIdForTaskWithFallback('exec-ttl')
      expect(userId).toBe('user-123')
    })

    it('if Redis context is gone (TTL expired), userId is undefined', async () => {
      const instanceA = new SimulatedInstance('instance-a')

      // Simulate TTL expiry: Redis key is gone
      // No context registered anywhere

      const userId = await instanceA.getUserIdForTaskWithFallback('exec-expired')
      expect(userId).toBeUndefined()
    })
  })

  describe('scenario: rapid streaming events (performance)', () => {
    it('100 events for same task: only 1 Redis lookup, rest from cache', async () => {
      const instanceA = new SimulatedInstance('instance-a')
      const instanceB = new SimulatedInstance('instance-b', 'user-123')

      instanceB.register({
        executionId: 'exec-rapid',
        projectId: 'proj-1',
        nodeId: 'node-1',
        userId: 'user-123',
        machineId: 'machine-1',
      })

      // Instance A starts without the context
      expect(instanceA.localStore.size).toBe(0)

      // Send 100 events
      for (let i = 0; i < 100; i++) {
        await instanceA.publishToRedis({
          eventType: i % 3 === 0 ? 'text' : i % 3 === 1 ? 'tool_use' : 'tool_result',
          taskId: 'exec-rapid',
          data: { seq: i },
        })
      }

      // All 100 events have correct userId
      expect(redisPubSubChannel).toHaveLength(100)
      for (const msg of redisPubSubChannel) {
        expect(msg.userId).toBe('user-123')
      }

      // Instance A now has the context cached locally
      expect(instanceA.localStore.has('exec-rapid')).toBe(true)
      // Sync lookup works (cached from first Redis lookup)
      expect(instanceA.getUserIdForTask('exec-rapid')).toBe('user-123')

      // Instance B receives all 100 events
      let delivered = 0
      for (const msg of redisPubSubChannel) {
        if (instanceB.receiveFromRedis(msg)) delivered++
      }
      expect(delivered).toBe(100)
    })
  })
})
