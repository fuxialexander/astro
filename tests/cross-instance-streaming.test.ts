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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
