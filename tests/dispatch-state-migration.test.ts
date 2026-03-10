/**
 * Dispatch State Migration Tests
 *
 * Validates Phase 2 of the horizontal scaling plan (issue #835):
 * - taskToMachine write-through to Redis
 * - Cross-instance approval/steer/cancel routing
 * - Execution context store Redis fallback
 * - Active dispatch stream Redis tracking
 *
 * Tests use source-code analysis (same pattern as redis-event-bridge.test.ts)
 * since the modules involve WebSocket connections that can't be easily mocked.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// =============================================================================
// 1. redis-pubsub.ts: New channels and methods
// =============================================================================

describe('redis-pubsub: new channels for dispatch state', () => {
  const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')

  it('defines APPROVAL_RESPONSE channel', () => {
    expect(pubsubSource).toContain("APPROVAL_RESPONSE: 'relay:approval:response'")
  })

  it('defines TASK_STEER channel', () => {
    expect(pubsubSource).toContain("TASK_STEER: 'relay:task:steer'")
  })

  it('subscribes to APPROVAL_RESPONSE channel', () => {
    expect(pubsubSource).toContain('CHANNELS.APPROVAL_RESPONSE')
  })

  it('subscribes to TASK_STEER channel', () => {
    expect(pubsubSource).toContain('CHANNELS.TASK_STEER')
  })

  it('defines ApprovalResponseEvent interface', () => {
    expect(pubsubSource).toContain('export interface ApprovalResponseEvent')
    expect(pubsubSource).toContain('requestId: string')
    expect(pubsubSource).toContain('answered: boolean')
  })

  it('defines TaskSteerEvent interface', () => {
    expect(pubsubSource).toContain('export interface TaskSteerEvent')
    expect(pubsubSource).toContain('interrupt?: boolean')
  })

  it('defines RedisExecutionContext interface', () => {
    expect(pubsubSource).toContain('export interface RedisExecutionContext')
  })

  it('has routeApprovalResponse method', () => {
    expect(pubsubSource).toContain('async routeApprovalResponse(')
    expect(pubsubSource).toContain('CHANNELS.APPROVAL_RESPONSE')
  })

  it('has routeTaskSteer method', () => {
    expect(pubsubSource).toContain('async routeTaskSteer(')
    expect(pubsubSource).toContain('CHANNELS.TASK_STEER')
  })

  it('emits approval:response and task:steer events in handleLocalMessage', () => {
    expect(pubsubSource).toContain("this.emit('approval:response'")
    expect(pubsubSource).toContain("this.emit('task:steer'")
  })

  it('has EXEC_CONTEXT key prefix for execution context', () => {
    expect(pubsubSource).toContain("EXEC_CONTEXT: 'relay:exec:context:'")
  })

  it('has ACTIVE_DISPATCH_STREAMS key prefix', () => {
    expect(pubsubSource).toContain("ACTIVE_DISPATCH_STREAMS: 'relay:dispatch:active:'")
  })

  it('has registerExecutionContext method with 4h TTL', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async registerExecutionContext('),
      pubsubSource.indexOf('async getExecutionContext(')
    )
    expect(method).toContain('14400') // 4 hours in seconds
    expect(method).toContain('KEYS.EXEC_CONTEXT')
  })

  it('has getExecutionContext method', () => {
    expect(pubsubSource).toContain('async getExecutionContext(executionId: string)')
  })

  it('has removeExecutionContext method', () => {
    expect(pubsubSource).toContain('async removeExecutionContext(executionId: string)')
  })

  it('has registerActiveDispatchStream method', () => {
    expect(pubsubSource).toContain('async registerActiveDispatchStream(executionId: string)')
  })

  it('has removeActiveDispatchStream method', () => {
    expect(pubsubSource).toContain('async removeActiveDispatchStream(executionId: string)')
  })

  it('has isDispatchStreamActive method', () => {
    expect(pubsubSource).toContain('async isDispatchStreamActive(executionId: string)')
  })

  it('RedisPubSubEvents includes approval:response and task:steer', () => {
    expect(pubsubSource).toContain("'approval:response': (event: ApprovalResponseEvent)")
    expect(pubsubSource).toContain("'task:steer': (event: TaskSteerEvent)")
  })
})

// =============================================================================
// 2. execution-context-store.ts: Redis write-through and fallback
// =============================================================================

describe('execution-context-store: Redis write-through', () => {
  const STORE_PATH = join(process.cwd(), 'server/lib/execution-context-store.ts')
  const storeSource = readFileSync(STORE_PATH, 'utf-8')

  it('imports redisPubSub', () => {
    expect(storeSource).toContain("import { redisPubSub } from './redis-pubsub.js'")
  })

  it('register() writes through to Redis', () => {
    const registerMethod = storeSource.slice(
      storeSource.indexOf('register(ctx:'),
      storeSource.indexOf('get(executionId:')
    )
    expect(registerMethod).toContain('redisPubSub.registerExecutionContext')
  })

  it('remove() cleans up Redis', () => {
    const removeMethod = storeSource.slice(
      storeSource.indexOf('remove(executionId:'),
      storeSource.indexOf('getUserIdForTask(')
    )
    expect(removeMethod).toContain('redisPubSub.removeExecutionContext')
  })

  it('has getWithFallback() for cross-instance lookups', () => {
    expect(storeSource).toContain('async getWithFallback(executionId: string)')
    const method = storeSource.slice(
      storeSource.indexOf('async getWithFallback('),
      storeSource.indexOf('remove(executionId:')
    )
    expect(method).toContain('redisPubSub.getExecutionContext')
    expect(method).toContain('store.set(remote.executionId') // caches locally
  })

  it('has getUserIdForTaskWithFallback() for cross-instance userId', () => {
    expect(storeSource).toContain('async getUserIdForTaskWithFallback(executionId: string)')
    const method = storeSource.slice(
      storeSource.indexOf('async getUserIdForTaskWithFallback('),
      storeSource.indexOf('/** Number of tracked')
    )
    expect(method).toContain('redisPubSub.getExecutionContext')
  })

  it('register write-through catches errors', () => {
    expect(storeSource).toContain("console.error('[exec-context] Failed to write context to Redis:'")
  })

  it('remove cleanup catches errors', () => {
    expect(storeSource).toContain("console.error('[exec-context] Failed to remove context from Redis:'")
  })
})

// =============================================================================
// 3. relay-server.ts: Cross-instance command routing
// =============================================================================

describe('relay-server: cross-instance routing', () => {
  const RELAY_PATH = join(process.cwd(), 'server/lib/relay-server.ts')
  const relaySource = readFileSync(RELAY_PATH, 'utf-8')

  describe('taskToMachine write-through to Redis', () => {
    it('writes to Redis on task dispatch', () => {
      const dispatchMethod = relaySource.slice(
        relaySource.indexOf('socket.send(JSON.stringify(agentRunnerMsg));'),
        relaySource.indexOf("console.log(`[relay] Task ${task.taskId} dispatched")
      )
      expect(dispatchMethod).toContain('redisPubSub.mapTaskToMachine')
    })

    it('cleans up Redis on task result', () => {
      const resultMethod = relaySource.slice(
        relaySource.indexOf('private handleTaskResult('),
        relaySource.indexOf('private handleTaskStdout(')
      )
      expect(resultMethod).toContain('redisPubSub.removeTaskMapping')
    })

    it('cleans up Redis on dead job detection', () => {
      const deadJobSection = relaySource.slice(
        relaySource.indexOf('Dead job detected:'),
        relaySource.indexOf('Emit event for dispatch layer')
      )
      expect(deadJobSection).toContain('redisPubSub.removeTaskMapping')
    })

    it('cleans up Redis on machine disconnect', () => {
      const disconnectSection = relaySource.slice(
        relaySource.indexOf('Clean up task tracking for disconnected'),
        relaySource.indexOf('machineRegistry.disconnect(machineId, reason)')
      )
      expect(disconnectSection).toContain('redisPubSub.removeTaskMapping')
    })

    it('cleans up Redis in legacy result handler', () => {
      const legacyResult = relaySource.slice(
        relaySource.indexOf('private handleAgentRunnerTaskResult('),
        relaySource.indexOf('// Convert to standard result message')
      )
      expect(legacyResult).toContain('redisPubSub.removeTaskMapping')
    })
  })

  describe('cancel routing', () => {
    it('cancelTask routes via Redis when machine is not local', () => {
      const cancelMethod = relaySource.slice(
        relaySource.indexOf('cancelTask(taskId: string, machineId: string, reason?: string)'),
        relaySource.indexOf('private async cancelTaskWithRedisFallback')
      )
      expect(cancelMethod).toContain('redisPubSub.requestTaskCancel')
      expect(cancelMethod).toContain('cancel routed via Redis')
    })

    it('cancelTask uses async Redis fallback when machineId is unknown', () => {
      expect(relaySource).toContain('cancelTaskWithRedisFallback(taskId, reason)')
    })

    it('cancelTaskWithRedisFallback looks up machine from Redis', () => {
      const fallback = relaySource.slice(
        relaySource.indexOf('private async cancelTaskWithRedisFallback'),
        relaySource.indexOf('/**\n   * Get all task IDs')
      )
      expect(fallback).toContain('redisPubSub.getTaskMachine(taskId)')
      expect(fallback).toContain('redisPubSub.requestTaskCancel')
    })
  })

  describe('approval routing', () => {
    it('sendApprovalResponse routes via Redis when machine is not local', () => {
      const approvalMethod = relaySource.slice(
        relaySource.indexOf('sendApprovalResponse('),
        relaySource.indexOf('private sendApprovalResponseLocal(')
      )
      expect(approvalMethod).toContain('redisPubSub.routeApprovalResponse')
      expect(approvalMethod).toContain('Approval response routed via Redis')
    })

    it('has sendApprovalResponseLocal for direct WebSocket sends', () => {
      expect(relaySource).toContain('private sendApprovalResponseLocal(')
    })
  })

  describe('steer routing', () => {
    it('steerTask routes via Redis when machine is not local', () => {
      const steerMethod = relaySource.slice(
        relaySource.indexOf('steerTask(taskId: string, machineId: string, message: string'),
        relaySource.indexOf('private steerTaskLocal(')
      )
      expect(steerMethod).toContain('redisPubSub.routeTaskSteer')
      expect(steerMethod).toContain('Steer routed via Redis')
    })

    it('has steerTaskLocal for direct WebSocket sends', () => {
      expect(relaySource).toContain('private steerTaskLocal(')
    })
  })

  describe('Redis routing listeners', () => {
    it('registers Redis routing on server start', () => {
      expect(relaySource).toContain('this.registerRedisRouting()')
    })

    it('registerRedisRouting listens for cross-instance cancel', () => {
      const routing = relaySource.slice(
        relaySource.indexOf('private registerRedisRouting():'),
        relaySource.indexOf('/**\n   * Get all task IDs')
      )
      expect(routing).toContain("redisPubSub.on('task:cancel'")
      expect(routing).toContain('Executing cross-instance cancel')
    })

    it('registerRedisRouting listens for cross-instance approval', () => {
      const routing = relaySource.slice(
        relaySource.indexOf('private registerRedisRouting():'),
        relaySource.indexOf('/**\n   * Get all task IDs')
      )
      expect(routing).toContain("redisPubSub.on('approval:response'")
      expect(routing).toContain('Executing cross-instance approval')
    })

    it('registerRedisRouting listens for cross-instance steer', () => {
      const routing = relaySource.slice(
        relaySource.indexOf('private registerRedisRouting():'),
        relaySource.indexOf('/**\n   * Get all task IDs')
      )
      expect(routing).toContain("redisPubSub.on('task:steer'")
      expect(routing).toContain('Executing cross-instance steer')
    })

    it('all Redis routing listeners skip own-instance events', () => {
      const routing = relaySource.slice(
        relaySource.indexOf('private registerRedisRouting():'),
        relaySource.indexOf('/**\n   * Get all task IDs')
      )
      // Each listener should check instanceId to skip own events
      const selfChecks = routing.split('redisPubSub.getInstanceId()').length - 1
      expect(selfChecks).toBeGreaterThanOrEqual(3) // cancel, approval, steer
    })

    it('all Redis routing listeners check local machine connection', () => {
      const routing = relaySource.slice(
        relaySource.indexOf('private registerRedisRouting():'),
        relaySource.indexOf('/**\n   * Get all task IDs')
      )
      // Each listener should check if machine is on this instance
      const connectionChecks = routing.split('machineRegistry.getConnection').length - 1
      expect(connectionChecks).toBeGreaterThanOrEqual(3)
    })
  })
})

// =============================================================================
// 4. dispatch.ts: Active dispatch stream Redis tracking
// =============================================================================

describe('dispatch.ts: active dispatch stream Redis tracking', () => {
  const DISPATCH_PATH = join(process.cwd(), 'server/routes/dispatch.ts')
  const dispatchSource = readFileSync(DISPATCH_PATH, 'utf-8')

  it('imports redisPubSub', () => {
    expect(dispatchSource).toContain("import { redisPubSub } from '../lib/redis-pubsub.js'")
  })

  it('registers active dispatch stream in Redis on add', () => {
    const addSection = dispatchSource.slice(
      dispatchSource.indexOf('activeDispatchStreams.add(executionId)'),
      dispatchSource.indexOf('relayServer.on(')
    )
    expect(addSection).toContain('redisPubSub.registerActiveDispatchStream')
  })

  it('removes active dispatch stream from Redis on cleanup', () => {
    const cleanupSection = dispatchSource.slice(
      dispatchSource.indexOf('activeDispatchStreams.delete(executionId)'),
      dispatchSource.indexOf("relayServer.off('task:result'")
    )
    expect(cleanupSection).toContain('redisPubSub.removeActiveDispatchStream')
  })
})

// =============================================================================
// 5. Integration: cross-instance flow patterns
// =============================================================================

describe('cross-instance flow: approval response routing', () => {
  const RELAY_PATH = join(process.cwd(), 'server/lib/relay-server.ts')
  const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const relaySource = readFileSync(RELAY_PATH, 'utf-8')
  const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')

  it('approval response event has all required fields', () => {
    const iface = pubsubSource.slice(
      pubsubSource.indexOf('export interface ApprovalResponseEvent'),
      pubsubSource.indexOf('/** Message published for cross-instance steer')
    )
    expect(iface).toContain('instanceId: string')
    expect(iface).toContain('taskId: string')
    expect(iface).toContain('machineId: string')
    expect(iface).toContain('requestId: string')
    expect(iface).toContain('answered: boolean')
    expect(iface).toContain('answer?: string')
    expect(iface).toContain('message?: string')
  })

  it('sendApprovalResponse passes all fields to routeApprovalResponse', () => {
    const method = relaySource.slice(
      relaySource.indexOf('sendApprovalResponse('),
      relaySource.indexOf('private sendApprovalResponseLocal(')
    )
    expect(method).toContain('taskId, machineId, requestId, answered, answer, message')
  })

  it('cross-instance listener calls sendApprovalResponseLocal with all fields', () => {
    const routing = relaySource.slice(
      relaySource.indexOf("redisPubSub.on('approval:response'"),
      relaySource.indexOf("redisPubSub.on('task:steer'")
    )
    expect(routing).toContain('this.sendApprovalResponseLocal(')
    expect(routing).toContain('event.taskId')
    expect(routing).toContain('event.machineId')
    expect(routing).toContain('event.requestId')
    expect(routing).toContain('event.answered')
    expect(routing).toContain('event.answer')
    expect(routing).toContain('event.message')
  })
})

describe('cross-instance flow: execution context store', () => {
  const STORE_PATH = join(process.cwd(), 'server/lib/execution-context-store.ts')
  const storeSource = readFileSync(STORE_PATH, 'utf-8')

  it('getWithFallback caches remote results locally', () => {
    const method = storeSource.slice(
      storeSource.indexOf('async getWithFallback('),
      storeSource.indexOf('remove(executionId:')
    )
    // When remote context is found, it should be cached in local store
    expect(method).toContain('store.set(remote.executionId, remote)')
  })

  it('preserves backward compatibility (sync get still works)', () => {
    // The sync get method should exist and return from local store
    expect(storeSource).toContain('get(executionId: string): ExecutionContext | undefined')
    // Sync version returns directly from Map (no Promise)
    const syncGetLine = storeSource.split('\n').find(line =>
      line.includes('get(executionId') && !line.includes('async') && line.includes('ExecutionContext | undefined')
    )
    expect(syncGetLine).toBeTruthy()
  })

  it('sync getUserIdForTask still works for hot path', () => {
    // The sync version should exist separately from the async fallback
    expect(storeSource).toContain('getUserIdForTask(executionId: string): string | undefined')
    expect(storeSource).toContain("return store.get(executionId)?.userId")
  })
})
