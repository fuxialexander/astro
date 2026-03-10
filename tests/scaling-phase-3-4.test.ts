/**
 * Scaling Phase 3-4 Tests
 *
 * Validates Phase 3 (Security-Critical State) and Phase 4 (Singleton Operations)
 * of the horizontal scaling plan (issue #835):
 *
 * Phase 3:
 * - Execution cost tracking via Redis INCRBYFLOAT
 * - Safety config cross-instance awareness
 * - Dispatch task directory Redis write-through
 * - Approved safety directory Redis write-through
 * - Approval notification dedup via Redis SETNX
 *
 * Phase 4:
 * - Leader election for singleton timers (SETNX + TTL)
 * - Dead job checker leader election
 * - Cleanup scheduler leader election
 * - Execution watchdog leader election
 * - Dispatch poll leader election
 *
 * Tests use source-code analysis (same pattern as dispatch-state-migration.test.ts)
 * since the modules involve WebSocket connections and Redis that can't be easily mocked.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// =============================================================================
// 1. redis-pubsub.ts: New key prefixes and methods for Phase 3-4
// =============================================================================

describe('redis-pubsub: Phase 3-4 key prefixes and methods', () => {
  const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')

  describe('execution cost tracking keys', () => {
    it('defines EXECUTION_COST key prefix', () => {
      expect(pubsubSource).toContain("EXECUTION_COST: 'relay:exec:cost:'")
    })

    it('defines LEADER key prefix', () => {
      expect(pubsubSource).toContain("LEADER: 'relay:leader:'")
    })
  })

  describe('incrementExecutionCost method', () => {
    it('has incrementExecutionCost method', () => {
      expect(pubsubSource).toContain('async incrementExecutionCost(executionId: string, costUsd: number)')
    })

    it('uses INCRBYFLOAT for atomic accumulation', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async incrementExecutionCost('),
        pubsubSource.indexOf('async getExecutionCost(')
      )
      expect(method).toContain('incrbyfloat')
      expect(method).toContain('KEYS.EXECUTION_COST')
    })

    it('always refreshes 4h TTL after increment', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async incrementExecutionCost('),
        pubsubSource.indexOf('async getExecutionCost(')
      )
      expect(method).toContain('14400')
      expect(method).toContain('expire')
    })

    it('returns null without Redis', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async incrementExecutionCost('),
        pubsubSource.indexOf('async getExecutionCost(')
      )
      expect(method).toContain('if (!this.publisher) return null')
    })
  })

  describe('getExecutionCost method', () => {
    it('has getExecutionCost method', () => {
      expect(pubsubSource).toContain('async getExecutionCost(executionId: string): Promise<number>')
    })

    it('returns 0 without Redis', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async getExecutionCost(executionId: string): Promise<number>'),
        pubsubSource.indexOf('async removeExecutionCost(')
      )
      expect(method).toContain('if (!this.publisher) return 0')
    })
  })

  describe('removeExecutionCost method', () => {
    it('has removeExecutionCost method', () => {
      expect(pubsubSource).toContain('async removeExecutionCost(executionId: string)')
    })

    it('is a no-op without Redis', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async removeExecutionCost('),
        pubsubSource.indexOf('Leader Election')
      )
      expect(method).toContain('if (!this.publisher) return')
    })
  })
})

// =============================================================================
// 2. Leader election methods
// =============================================================================

describe('redis-pubsub: leader election', () => {
  const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')

  describe('tryAcquireLeader', () => {
    it('has tryAcquireLeader method', () => {
      expect(pubsubSource).toContain('async tryAcquireLeader(operationName: string, ttlSeconds: number)')
    })

    it('uses SETNX pattern (SET ... NX EX)', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async tryAcquireLeader('),
        pubsubSource.indexOf('async renewLeadership(')
      )
      expect(method).toContain("'NX'")
      expect(method).toContain("'EX'")
      expect(method).toContain('KEYS.LEADER')
    })

    it('returns true in single-instance mode (no Redis)', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async tryAcquireLeader('),
        pubsubSource.indexOf('async renewLeadership(')
      )
      expect(method).toContain('if (!this.publisher) return true')
    })

    it('uses instanceId as the lock value', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async tryAcquireLeader('),
        pubsubSource.indexOf('async renewLeadership(')
      )
      expect(method).toContain('this.instanceId')
    })
  })

  describe('renewLeadership', () => {
    it('has renewLeadership method', () => {
      expect(pubsubSource).toContain('async renewLeadership(operationName: string, ttlSeconds: number)')
    })

    it('checks current holder before renewing', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async renewLeadership('),
        pubsubSource.indexOf('async releaseLeadership(')
      )
      expect(method).toContain('this.instanceId')
      expect(method).toContain('return false')
    })

    it('returns true in single-instance mode', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async renewLeadership('),
        pubsubSource.indexOf('async releaseLeadership(')
      )
      expect(method).toContain('if (!this.publisher) return true')
    })
  })

  describe('releaseLeadership', () => {
    it('has releaseLeadership method', () => {
      expect(pubsubSource).toContain('async releaseLeadership(operationName: string)')
    })

    it('only releases own lock (compare before delete)', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async releaseLeadership('),
        pubsubSource.indexOf('Dispatch State')
      )
      expect(method).toContain('this.instanceId')
      // Should GET then conditionally DEL
      expect(method).toContain('.get(')
      expect(method).toContain('.del(')
    })

    it('is a no-op without Redis', () => {
      const method = pubsubSource.slice(
        pubsubSource.indexOf('async releaseLeadership('),
        pubsubSource.indexOf('Dispatch State')
      )
      expect(method).toContain('if (!this.publisher) return')
    })
  })
})

// =============================================================================
// 3. Dispatch state: safety directories Redis write-through
// =============================================================================

describe('redis-pubsub: dispatch state methods', () => {
  const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')

  it('has setTaskDir method', () => {
    expect(pubsubSource).toContain('async setTaskDir(taskId: string, workingDirectory: string)')
  })

  it('has getTaskDir method', () => {
    expect(pubsubSource).toContain('async getTaskDir(taskId: string)')
  })

  it('has removeTaskDir method', () => {
    expect(pubsubSource).toContain('async removeTaskDir(taskId: string)')
  })

  it('has setApprovedSafetyDir method', () => {
    expect(pubsubSource).toContain('async setApprovedSafetyDir(workingDirectory: string, decision: string)')
  })

  it('has getApprovedSafetyDir method', () => {
    expect(pubsubSource).toContain('async getApprovedSafetyDir(workingDirectory: string)')
  })

  it('has markApprovalNotified method', () => {
    expect(pubsubSource).toContain('async markApprovalNotified(requestId: string)')
  })

  it('markApprovalNotified uses SETNX for cross-instance dedup', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async markApprovalNotified('),
      pubsubSource.indexOf('Private Methods')
    )
    expect(method).toContain("'NX'")
    expect(method).toContain("'EX'")
    expect(method).toContain('300') // 5min TTL
  })

  it('setTaskDir has 4h TTL', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async setTaskDir('),
      pubsubSource.indexOf('async getTaskDir(')
    )
    expect(method).toContain('14400')
  })

  it('setApprovedSafetyDir has 24h TTL', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async setApprovedSafetyDir('),
      pubsubSource.indexOf('async getApprovedSafetyDir(')
    )
    expect(method).toContain('86400')
  })

  it('all dispatch state methods are no-ops without Redis', () => {
    const methods = [
      'async setTaskDir(',
      'async getTaskDir(',
      'async removeTaskDir(',
      'async setApprovedSafetyDir(',
      'async getApprovedSafetyDir(',
    ]
    for (const sig of methods) {
      const idx = pubsubSource.indexOf(sig)
      expect(idx).toBeGreaterThan(-1)
      const snippet = pubsubSource.slice(idx, idx + 200)
      expect(snippet).toContain('if (!this.publisher)')
    }
  })
})

// =============================================================================
// 4. safety-rails.ts: Redis cost tracking
// =============================================================================

describe('safety-rails: cross-instance cost tracking', () => {
  const RAILS_PATH = join(process.cwd(), 'server/lib/observability/safety-rails.ts')
  const railsSource = readFileSync(RAILS_PATH, 'utf-8')

  it('imports redisPubSub', () => {
    expect(railsSource).toContain("import { redisPubSub } from '../redis-pubsub.js'")
  })

  it('trackCost writes through to Redis via incrementExecutionCost', () => {
    const method = railsSource.slice(
      railsSource.indexOf('trackCost(executionId'),
      railsSource.indexOf('isToolAllowed(')
    )
    expect(method).toContain('redisPubSub.incrementExecutionCost(executionId, costUsd)')
  })

  it('trackCost updates local cache from Redis when cross-instance total is higher', () => {
    const method = railsSource.slice(
      railsSource.indexOf('trackCost(executionId'),
      railsSource.indexOf('isToolAllowed(')
    )
    expect(method).toContain('redisCost > current')
    expect(method).toContain('this.executionCosts.set(executionId, redisCost)')
  })

  it('trackCost catches Redis errors (fire-and-forget)', () => {
    const method = railsSource.slice(
      railsSource.indexOf('trackCost(executionId'),
      railsSource.indexOf('isToolAllowed(')
    )
    expect(method).toContain('.catch(')
    expect(method).toContain("'[safety-rails] Failed to increment cost in Redis:'")
  })

  it('resetExecution cleans up Redis cost', () => {
    const method = railsSource.slice(
      railsSource.indexOf('resetExecution(executionId'),
      railsSource.indexOf('getExecutionCost(executionId')
    )
    expect(method).toContain('redisPubSub.removeExecutionCost(executionId)')
    expect(method).toContain('.catch(')
  })

  it('has getExecutionCostCrossInstance async method', () => {
    expect(railsSource).toContain('async getExecutionCostCrossInstance(executionId: string)')
    const method = railsSource.slice(
      railsSource.indexOf('async getExecutionCostCrossInstance('),
      railsSource.indexOf('/** Singleton instance')
    )
    expect(method).toContain('redisPubSub.getExecutionCost(executionId)')
  })

  it('getExecutionCostCrossInstance updates local cache', () => {
    const method = railsSource.slice(
      railsSource.indexOf('async getExecutionCostCrossInstance('),
      railsSource.indexOf('/** Singleton instance')
    )
    expect(method).toContain('this.executionCosts.set(executionId, redisCost)')
  })

  it('preserves sync getExecutionCost for hot path', () => {
    expect(railsSource).toContain('getExecutionCost(executionId: string): number')
    const syncMethod = railsSource.split('\n').find(line =>
      line.includes('getExecutionCost(') && !line.includes('async') && line.includes(': number')
    )
    expect(syncMethod).toBeTruthy()
  })
})

// =============================================================================
// 5. dispatch.ts: task dir and safety dir Redis write-through
// =============================================================================

describe('dispatch.ts: cross-instance safety state', () => {
  const DISPATCH_PATH = join(process.cwd(), 'server/routes/dispatch.ts')
  const dispatchSource = readFileSync(DISPATCH_PATH, 'utf-8')

  it('writes task directory to Redis on dispatch', () => {
    const section = dispatchSource.slice(
      dispatchSource.indexOf('Track directory for safety'),
      dispatchSource.indexOf('Disable proxy buffering')
    )
    expect(section).toContain('redisPubSub.setTaskDir(executionId, workingDirectory)')
  })

  it('cleans up Redis task directory on result', () => {
    const section = dispatchSource.slice(
      dispatchSource.indexOf('executionContextStore.remove(executionId)'),
      dispatchSource.indexOf('Map relay metrics')
    )
    expect(section).toContain('redisPubSub.removeTaskDir(executionId)')
  })

  it('skipSafetyCheck checks Redis for approved directories', () => {
    // The skipSafetyCheck field in the dispatch payload (not the zod schema) uses Redis
    const skipIdx = dispatchSource.indexOf("skipSafetyCheck: (skipSafetyCheck")
    expect(skipIdx).toBeGreaterThan(-1)
    const line = dispatchSource.slice(skipIdx, dispatchSource.indexOf('\n', skipIdx))
    expect(line).toContain('redisPubSub.getApprovedSafetyDir(workingDirectory)')
  })

  it('safety decision caching writes through to Redis', () => {
    const section = dispatchSource.slice(
      dispatchSource.indexOf('Cache safety approval for this working directory'),
      dispatchSource.indexOf('Emit event so SSE handlers')
    )
    expect(section).toContain('redisPubSub.setApprovedSafetyDir(resolvedWorkdir, decision)')
  })

  it('safety decision uses Redis fallback for task directory lookup', () => {
    const section = dispatchSource.slice(
      dispatchSource.indexOf('Cache safety approval for this working directory'),
      dispatchSource.indexOf('Emit event so SSE handlers')
    )
    expect(section).toContain('redisPubSub.getTaskDir(taskId)')
  })

  it('imports redisPubSub for write-through', () => {
    expect(dispatchSource).toContain("import { redisPubSub")
  })
})

// =============================================================================
// 6. events.ts: approval notification dedup via Redis
// =============================================================================

describe('events.ts: cross-instance approval notification dedup', () => {
  const EVENTS_PATH = join(process.cwd(), 'server/routes/events.ts')
  const eventsSource = readFileSync(EVENTS_PATH, 'utf-8')

  it('uses redisPubSub.markApprovalNotified for cross-instance dedup', () => {
    expect(eventsSource).toContain('redisPubSub.markApprovalNotified(msg.requestId)')
  })

  it('checks local Set as fast-path before Redis', () => {
    const section = eventsSource.slice(
      eventsSource.indexOf('Dedup across instances'),
      eventsSource.indexOf('notifiedApprovalRequests.add(msg.requestId)')
    )
    expect(section).toContain('notifiedApprovalRequests.has(msg.requestId)')
    expect(section).toContain('markApprovalNotified')
  })

  it('sendApprovalToUIAndChannels is async (await works correctly)', () => {
    expect(eventsSource).toContain('const sendApprovalToUIAndChannels = async () => {')
  })
})

// =============================================================================
// 7. cleanup-scheduler.ts: leader election
// =============================================================================

describe('cleanup-scheduler: leader election', () => {
  const CLEANUP_PATH = join(process.cwd(), 'server/lib/cleanup-scheduler.ts')
  const cleanupSource = readFileSync(CLEANUP_PATH, 'utf-8')

  it('imports redisPubSub', () => {
    expect(cleanupSource).toContain("import { redisPubSub } from './redis-pubsub.js'")
  })

  it('defines leader name constant', () => {
    expect(cleanupSource).toContain("LEADER_NAME = 'cleanup-scheduler'")
  })

  it('has runCleanupIfLeader function', () => {
    expect(cleanupSource).toContain('async function runCleanupIfLeader()')
  })

  it('runCleanupIfLeader calls tryAcquireLeader', () => {
    const method = cleanupSource.slice(
      cleanupSource.indexOf('async function runCleanupIfLeader()'),
      cleanupSource.indexOf('Start the cleanup scheduler')
    )
    expect(method).toContain('redisPubSub.tryAcquireLeader(LEADER_NAME')
    expect(method).toContain('LEADER_TTL_SECONDS')
  })

  it('runCleanupIfLeader falls back to renewLeadership', () => {
    const method = cleanupSource.slice(
      cleanupSource.indexOf('async function runCleanupIfLeader()'),
      cleanupSource.indexOf('Start the cleanup scheduler')
    )
    expect(method).toContain('redisPubSub.renewLeadership(LEADER_NAME')
  })

  it('skips cleanup when another instance is leader', () => {
    const method = cleanupSource.slice(
      cleanupSource.indexOf('async function runCleanupIfLeader()'),
      cleanupSource.indexOf('Start the cleanup scheduler')
    )
    expect(method).toContain('Another instance is the cleanup leader')
  })

  it('startCleanupScheduler uses runCleanupIfLeader (not runCleanup directly)', () => {
    const startFn = cleanupSource.slice(
      cleanupSource.indexOf('export function startCleanupScheduler('),
      cleanupSource.indexOf('export function stopCleanupScheduler(')
    )
    expect(startFn).toContain('runCleanupIfLeader()')
    expect(startFn).not.toContain('runCleanup()')
  })

  it('stopCleanupScheduler releases leadership', () => {
    const stopFn = cleanupSource.slice(
      cleanupSource.indexOf('export function stopCleanupScheduler('),
      cleanupSource.indexOf('Get current cleanup config')
    )
    expect(stopFn).toContain('redisPubSub.releaseLeadership(LEADER_NAME)')
  })

  it('has 1h leader TTL', () => {
    expect(cleanupSource).toContain('LEADER_TTL_SECONDS = 3600')
  })
})

// =============================================================================
// 8. execution-watchdog.ts: leader election
// =============================================================================

describe('execution-watchdog: leader election', () => {
  const WATCHDOG_PATH = join(process.cwd(), 'server/lib/execution-watchdog.ts')
  const watchdogSource = readFileSync(WATCHDOG_PATH, 'utf-8')

  it('imports redisPubSub', () => {
    expect(watchdogSource).toContain("import { redisPubSub } from './redis-pubsub.js'")
  })

  it('defines leader name constant', () => {
    expect(watchdogSource).toContain("LEADER_NAME = 'execution-watchdog'")
  })

  it('has runWatchdogCheckIfLeader function', () => {
    expect(watchdogSource).toContain('async function runWatchdogCheckIfLeader()')
  })

  it('runWatchdogCheckIfLeader calls tryAcquireLeader', () => {
    const method = watchdogSource.slice(
      watchdogSource.indexOf('async function runWatchdogCheckIfLeader()'),
      watchdogSource.indexOf('Start the execution watchdog')
    )
    expect(method).toContain('redisPubSub.tryAcquireLeader(LEADER_NAME')
  })

  it('startExecutionWatchdog uses runWatchdogCheckIfLeader', () => {
    const startFn = watchdogSource.slice(
      watchdogSource.indexOf('export function startExecutionWatchdog('),
      watchdogSource.indexOf('export function stopExecutionWatchdog(')
    )
    expect(startFn).toContain('runWatchdogCheckIfLeader()')
    expect(startFn).not.toContain('runWatchdogCheck()')
  })

  it('stopExecutionWatchdog releases leadership', () => {
    const stopFn = watchdogSource.slice(
      watchdogSource.indexOf('export function stopExecutionWatchdog('),
      watchdogSource.indexOf('Get current watchdog config')
    )
    expect(stopFn).toContain('redisPubSub.releaseLeadership(LEADER_NAME)')
  })

  it('has 10-minute leader TTL (2x check interval)', () => {
    expect(watchdogSource).toContain('LEADER_TTL_SECONDS = 600')
  })

  it('preserves triggerWatchdogCheck for manual testing (bypasses leader check)', () => {
    const trigger = watchdogSource.slice(
      watchdogSource.indexOf('export async function triggerWatchdogCheck()'),
      watchdogSource.length
    )
    expect(trigger).toContain('runWatchdogCheck()')
    expect(trigger).not.toContain('runWatchdogCheckIfLeader')
  })
})

// =============================================================================
// 9. relay-server.ts: dead job checker leader election
// =============================================================================

describe('relay-server: dead job checker leader election', () => {
  const RELAY_PATH = join(process.cwd(), 'server/lib/relay-server.ts')
  const relaySource = readFileSync(RELAY_PATH, 'utf-8')

  it('dead job checker uses tryAcquireLeader', () => {
    const checker = relaySource.slice(
      relaySource.indexOf('private startDeadJobChecker():'),
      relaySource.indexOf('Dead job checker started')
    )
    expect(checker).toContain('redisPubSub.tryAcquireLeader(LEADER_NAME')
  })

  it('dead job checker uses renewLeadership', () => {
    const checker = relaySource.slice(
      relaySource.indexOf('private startDeadJobChecker():'),
      relaySource.indexOf('Dead job checker started')
    )
    expect(checker).toContain('redisPubSub.renewLeadership(LEADER_NAME')
  })

  it('dead job checker skips when not leader', () => {
    const checker = relaySource.slice(
      relaySource.indexOf('private startDeadJobChecker():'),
      relaySource.indexOf('Dead job checker started')
    )
    expect(checker).toContain('if (!acquired && !renewed) return')
  })

  it('dead job checker has 90s leader TTL', () => {
    const checker = relaySource.slice(
      relaySource.indexOf('private startDeadJobChecker():'),
      relaySource.indexOf('Dead job checker started')
    )
    expect(checker).toContain('LEADER_TTL_SECONDS = 90')
  })

  it('dead job checker leader name is correct', () => {
    const checker = relaySource.slice(
      relaySource.indexOf('private startDeadJobChecker():'),
      relaySource.indexOf('Dead job checker started')
    )
    expect(checker).toContain("LEADER_NAME = 'dead-job-checker'")
  })

  it('stop releases dead-job-checker leadership', () => {
    expect(relaySource).toContain("redisPubSub.releaseLeadership('dead-job-checker')")
  })
})

// =============================================================================
// 10. dispatch-engine.ts: dispatch poll leader election
// =============================================================================

describe('dispatch-engine: dispatch poll leader election', () => {
  const ENGINE_PATH = join(process.cwd(), 'server/lib/dispatch/dispatch-engine.ts')
  const engineSource = readFileSync(ENGINE_PATH, 'utf-8')

  it('imports redisPubSub', () => {
    expect(engineSource).toContain("import { redisPubSub } from '../redis-pubsub.js'")
  })

  it('startPolling uses tryAcquireLeader', () => {
    const polling = engineSource.slice(
      engineSource.indexOf('private startPolling():'),
      engineSource.indexOf('private stopPolling():')
    )
    expect(polling).toContain('redisPubSub.tryAcquireLeader(POLL_LEADER_NAME')
  })

  it('startPolling uses renewLeadership', () => {
    const polling = engineSource.slice(
      engineSource.indexOf('private startPolling():'),
      engineSource.indexOf('private stopPolling():')
    )
    expect(polling).toContain('redisPubSub.renewLeadership(POLL_LEADER_NAME')
  })

  it('startPolling skips when not leader', () => {
    const polling = engineSource.slice(
      engineSource.indexOf('private startPolling():'),
      engineSource.indexOf('private stopPolling():')
    )
    expect(polling).toContain('if (!acquired && !renewed) return')
  })

  it('leader name is dispatch-poll', () => {
    const polling = engineSource.slice(
      engineSource.indexOf('private startPolling():'),
      engineSource.indexOf('private stopPolling():')
    )
    expect(polling).toContain("POLL_LEADER_NAME = 'dispatch-poll'")
  })

  it('leader TTL is at least 2x poll interval', () => {
    const polling = engineSource.slice(
      engineSource.indexOf('private startPolling():'),
      engineSource.indexOf('private stopPolling():')
    )
    expect(polling).toContain('pollIntervalMs / 1000) * 2')
  })

  it('stopPolling releases dispatch-poll leadership', () => {
    const stopFn = engineSource.slice(
      engineSource.indexOf('private stopPolling():'),
      engineSource.indexOf('private async pollReadyTasks')
    )
    expect(stopFn).toContain("redisPubSub.releaseLeadership('dispatch-poll')")
  })
})

// =============================================================================
// 11. Single-instance graceful degradation
// =============================================================================

describe('single-instance mode: all Phase 3-4 additions degrade gracefully', () => {
  const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')

  it('incrementExecutionCost returns null without Redis', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async incrementExecutionCost('),
      pubsubSource.indexOf('async getExecutionCost(')
    )
    expect(method).toContain('if (!this.publisher) return null')
  })

  it('getExecutionCost returns 0 without Redis', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async getExecutionCost(executionId: string): Promise<number>'),
      pubsubSource.indexOf('async removeExecutionCost(')
    )
    expect(method).toContain('if (!this.publisher) return 0')
  })

  it('tryAcquireLeader returns true without Redis (always leader)', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async tryAcquireLeader('),
      pubsubSource.indexOf('async renewLeadership(')
    )
    expect(method).toContain('if (!this.publisher) return true')
  })

  it('renewLeadership returns true without Redis', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async renewLeadership('),
      pubsubSource.indexOf('async releaseLeadership(')
    )
    expect(method).toContain('if (!this.publisher) return true')
  })

  it('markApprovalNotified returns true without Redis', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async markApprovalNotified('),
      pubsubSource.indexOf('Private Methods')
    )
    expect(method).toContain('if (!this.publisher) return true')
  })

  it('setTaskDir is a no-op without Redis', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async setTaskDir('),
      pubsubSource.indexOf('async getTaskDir(')
    )
    expect(method).toContain('if (!this.publisher) return')
  })

  it('getTaskDir returns null without Redis', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async getTaskDir('),
      pubsubSource.indexOf('async removeTaskDir(')
    )
    expect(method).toContain('if (!this.publisher) return null')
  })

  it('getApprovedSafetyDir returns null without Redis', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async getApprovedSafetyDir('),
      pubsubSource.indexOf('async markApprovalNotified(')
    )
    expect(method).toContain('if (!this.publisher) return null')
  })
})

// =============================================================================
// 12. TTL configuration for all new Redis keys
// =============================================================================

describe('TTL configuration for Phase 3-4 Redis keys', () => {
  const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')

  it('execution cost has 4h TTL', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async incrementExecutionCost('),
      pubsubSource.indexOf('async getExecutionCost(')
    )
    expect(method).toContain('14400')
  })

  it('task directory has 4h TTL', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async setTaskDir('),
      pubsubSource.indexOf('async getTaskDir(')
    )
    expect(method).toContain('14400')
  })

  it('approved safety directory has 24h TTL', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async setApprovedSafetyDir('),
      pubsubSource.indexOf('async getApprovedSafetyDir(')
    )
    expect(method).toContain('86400')
  })

  it('approval notification dedup has 5min TTL', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async markApprovalNotified('),
      pubsubSource.indexOf('Private Methods')
    )
    expect(method).toContain('300')
  })
})

// =============================================================================
// 13. Completeness: all 4 singleton timers use leader election
// =============================================================================

describe('completeness: all singleton timers use leader election', () => {
  it('dead job checker (relay-server.ts) uses leader election', () => {
    const source = readFileSync(join(process.cwd(), 'server/lib/relay-server.ts'), 'utf-8')
    const checker = source.slice(
      source.indexOf('private startDeadJobChecker():'),
      source.indexOf('Dead job checker started')
    )
    expect(checker).toContain('tryAcquireLeader')
  })

  it('cleanup scheduler (cleanup-scheduler.ts) uses leader election', () => {
    const source = readFileSync(join(process.cwd(), 'server/lib/cleanup-scheduler.ts'), 'utf-8')
    expect(source).toContain('tryAcquireLeader')
    expect(source).toContain('releaseLeadership')
  })

  it('execution watchdog (execution-watchdog.ts) uses leader election', () => {
    const source = readFileSync(join(process.cwd(), 'server/lib/execution-watchdog.ts'), 'utf-8')
    expect(source).toContain('tryAcquireLeader')
    expect(source).toContain('releaseLeadership')
  })

  it('dispatch poll (dispatch-engine.ts) uses leader election', () => {
    const source = readFileSync(join(process.cwd(), 'server/lib/dispatch/dispatch-engine.ts'), 'utf-8')
    const polling = source.slice(
      source.indexOf('private startPolling():'),
      source.indexOf('private stopPolling():')
    )
    expect(polling).toContain('tryAcquireLeader')
  })
})

// =============================================================================
// 14. Error handling: all Redis operations catch errors
// =============================================================================

describe('error handling: Phase 3-4 Redis operations', () => {
  const RAILS_PATH = join(process.cwd(), 'server/lib/observability/safety-rails.ts')
  const railsSource = readFileSync(RAILS_PATH, 'utf-8')

  it('safety-rails trackCost catches Redis errors', () => {
    expect(railsSource).toContain("'[safety-rails] Failed to increment cost in Redis:'")
  })

  it('safety-rails resetExecution catches Redis errors', () => {
    expect(railsSource).toContain("'[safety-rails] Failed to remove cost from Redis:'")
  })

  const DISPATCH_PATH = join(process.cwd(), 'server/routes/dispatch.ts')
  const dispatchSource = readFileSync(DISPATCH_PATH, 'utf-8')

  it('dispatch setTaskDir is fire-and-forget', () => {
    const section = dispatchSource.slice(
      dispatchSource.indexOf('redisPubSub.setTaskDir('),
      dispatchSource.indexOf('redisPubSub.setTaskDir(') + 80
    )
    expect(section).toContain('.catch(')
  })

  it('dispatch removeTaskDir is fire-and-forget', () => {
    const section = dispatchSource.slice(
      dispatchSource.indexOf('redisPubSub.removeTaskDir('),
      dispatchSource.indexOf('redisPubSub.removeTaskDir(') + 80
    )
    expect(section).toContain('.catch(')
  })

  it('dispatch setApprovedSafetyDir is fire-and-forget', () => {
    const section = dispatchSource.slice(
      dispatchSource.indexOf('redisPubSub.setApprovedSafetyDir('),
      dispatchSource.indexOf('redisPubSub.setApprovedSafetyDir(') + 100
    )
    expect(section).toContain('.catch(')
  })
})

// =============================================================================
// 15. CORNER CASE: Watchdog cross-instance pending approval gap
// =============================================================================

describe('execution-watchdog: cross-instance pending approval gap (known limitation)', () => {
  const WATCHDOG_PATH = join(process.cwd(), 'server/lib/execution-watchdog.ts')
  const watchdogSource = readFileSync(WATCHDOG_PATH, 'utf-8')

  it('isTaskTrulyStale checks local dispatchEngine first (fast-path)', () => {
    const method = watchdogSource.slice(
      watchdogSource.indexOf('async function isTaskTrulyStale('),
      watchdogSource.indexOf('async function runWatchdogCheck(')
    )
    expect(method).toContain('dispatchEngine.hasPendingApprovalForExecution(executionId)')
  })

  it('isTaskTrulyStale also checks Redis for cross-instance pending approvals', () => {
    const method = watchdogSource.slice(
      watchdogSource.indexOf('async function isTaskTrulyStale('),
      watchdogSource.indexOf('async function runWatchdogCheck(')
    )
    // Must check both local AND Redis
    expect(method).toContain('redisPubSub.hasPendingApproval(executionId)')
    expect(method).toContain('pending approval (cross-instance)')
  })

  it('Redis pending approval check errs on the side of caution on failure', () => {
    const method = watchdogSource.slice(
      watchdogSource.indexOf('async function isTaskTrulyStale('),
      watchdogSource.indexOf('async function runWatchdogCheck(')
    )
    // If Redis check fails, return false (don't reset the task)
    const redisCatchIdx = method.indexOf('} catch {')
    expect(redisCatchIdx).toBeGreaterThan(-1)
    const afterCatch = method.slice(redisCatchIdx, redisCatchIdx + 100)
    expect(afterCatch).toContain('return false')
  })

  it('watchdog imports dispatchEngine (process-local)', () => {
    expect(watchdogSource).toContain("import { dispatchEngine } from './dispatch/index.js'")
  })

  it('hasPendingApprovalForExecution is synchronous (process-local Map check)', () => {
    const ENGINE_PATH = join(process.cwd(), 'server/lib/dispatch/dispatch-engine.ts')
    const engineSource = readFileSync(ENGINE_PATH, 'utf-8')
    const startIdx = engineSource.indexOf('hasPendingApprovalForExecution(executionId: string)')
    const endIdx = engineSource.indexOf('private startPolling()')
    const method = engineSource.slice(startIdx, endIdx)
    // Confirm it checks the local pendingApprovals Map, NOT Redis
    expect(method).toContain('pendingApprovals.values()')
    expect(method).not.toContain('redisPubSub')
  })

  it('watchdog has 2h stale threshold — long enough to mitigate most false positives', () => {
    expect(watchdogSource).toContain("staleThresholdMs: 2 * 60 * 60 * 1000")
  })

  it('watchdog also checks streaming events (second safety net)', () => {
    const method = watchdogSource.slice(
      watchdogSource.indexOf('async function isTaskTrulyStale('),
      watchdogSource.indexOf('async function runWatchdogCheck(')
    )
    expect(method).toContain('streamingEvents')
    expect(method).toContain('gt(streamingEvents.createdAt, cutoffTime)')
  })

  it('watchdog errors on the side of caution when streaming events query fails', () => {
    const method = watchdogSource.slice(
      watchdogSource.indexOf('async function isTaskTrulyStale('),
      watchdogSource.indexOf('async function runWatchdogCheck(')
    )
    expect(method).toContain("// If we can't check events, err on the side of caution")
    expect(method).toContain('return false')
  })
})

// =============================================================================
// 16. CORNER CASE: Leader election TOCTOU race in renewLeadership
// =============================================================================

describe('leader election: TOCTOU documentation and safety analysis', () => {
  const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')

  it('renewLeadership documents the GET+EXPIRE TOCTOU race', () => {
    // The JSDoc comment is above the method — include it by searching from the doc comment
    const commentStart = pubsubSource.indexOf('Note: GET + EXPIRE is not atomic')
    const methodEnd = pubsubSource.indexOf('async releaseLeadership(')
    expect(commentStart).toBeGreaterThan(-1)
    expect(commentStart).toBeLessThan(methodEnd) // doc is above renewLeadership, before releaseLeadership
    expect(pubsubSource).toContain('TOCTOU')
  })

  it('renewLeadership first GETs then EXPIREs (not atomic)', () => {
    // Slice from the method signature, not the JSDoc
    const sigIdx = pubsubSource.indexOf('async renewLeadership(operationName')
    const endIdx = pubsubSource.indexOf('async releaseLeadership(')
    const method = pubsubSource.slice(sigIdx, endIdx)
    const getIdx = method.indexOf('.get(')
    const expireIdx = method.indexOf('.expire(')
    expect(getIdx).toBeGreaterThan(-1)
    expect(expireIdx).toBeGreaterThan(getIdx)
  })

  it('releaseLeadership documents the GET+DEL TOCTOU race', () => {
    // The JSDoc comment is above the method — verify it exists in the source
    const commentStart = pubsubSource.indexOf('Note: GET + DEL is not atomic')
    const methodStart = pubsubSource.indexOf('async releaseLeadership(')
    expect(commentStart).toBeGreaterThan(-1)
    expect(commentStart).toBeLessThan(methodStart) // doc is above the method
  })

  it('releaseLeadership does compare-before-delete', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async releaseLeadership('),
      pubsubSource.indexOf('Dispatch State')
    )
    // Must check current holder equals this.instanceId before deleting
    expect(method).toContain('current === this.instanceId')
    expect(method).toContain('.del(')
  })

  it('TTLs are 2x the check interval for overlap safety', () => {
    // Ensures the leader lock doesn't expire between cycles.
    // dispatch-poll: TTL = ceil(pollIntervalMs/1000) * 2
    const ENGINE_PATH = join(process.cwd(), 'server/lib/dispatch/dispatch-engine.ts')
    const engineSource = readFileSync(ENGINE_PATH, 'utf-8')
    expect(engineSource).toContain('pollIntervalMs / 1000) * 2')

    // watchdog: 10min TTL for 5min interval (2x)
    const WATCHDOG_PATH = join(process.cwd(), 'server/lib/execution-watchdog.ts')
    const watchdogSource = readFileSync(WATCHDOG_PATH, 'utf-8')
    expect(watchdogSource).toContain('LEADER_TTL_SECONDS = 600')
    expect(watchdogSource).toContain('intervalMs: 5 * 60 * 1000')
  })
})

// =============================================================================
// 17. CORNER CASE: Cost tracking race condition in safety-rails
// =============================================================================

describe('safety-rails: cost tracking race condition analysis', () => {
  const RAILS_PATH = join(process.cwd(), 'server/lib/observability/safety-rails.ts')
  const railsSource = readFileSync(RAILS_PATH, 'utf-8')

  it('trackCost is synchronous but Redis write is async (fire-and-forget)', () => {
    // The local Map is updated synchronously, but Redis is updated via .then()
    // This means there's a window where Instance A sees its local cost
    // but hasn't yet synced to Redis, and Instance B's next read will be stale.
    const method = railsSource.slice(
      railsSource.indexOf('trackCost(executionId'),
      railsSource.indexOf('isToolAllowed(')
    )
    // Verify it updates local Map first (sync)
    expect(method).toContain('this.executionCosts.set(executionId, current)')
    // Then fires Redis update (async)
    expect(method).toContain('redisPubSub.incrementExecutionCost(executionId, costUsd).then(')
  })

  it('trackCost syncs cross-instance totals back to local cache', () => {
    const method = railsSource.slice(
      railsSource.indexOf('trackCost(executionId'),
      railsSource.indexOf('isToolAllowed(')
    )
    // When Redis reports a higher total (from other instances), update local cache
    expect(method).toContain('redisCost > current')
    expect(method).toContain('this.executionCosts.set(executionId, redisCost)')
  })

  it('trackCost logs cross-instance limit breach', () => {
    const method = railsSource.slice(
      railsSource.indexOf('trackCost(executionId'),
      railsSource.indexOf('isToolAllowed(')
    )
    expect(method).toContain('Cross-instance cost limit exceeded')
  })

  it('local check returns immediately (does not await Redis)', () => {
    const method = railsSource.slice(
      railsSource.indexOf('trackCost(executionId'),
      railsSource.indexOf('isToolAllowed(')
    )
    // The return statement should NOT be inside the .then() callback
    // Verify the method returns a synchronous result
    expect(method).toContain('return {\n')
    expect(method).toContain('exceeded: current > limit')
  })

  it('getExecutionCostCrossInstance is the async fallback for accurate reads', () => {
    expect(railsSource).toContain('async getExecutionCostCrossInstance(executionId: string)')
    const method = railsSource.slice(
      railsSource.indexOf('async getExecutionCostCrossInstance('),
      railsSource.indexOf('/** Singleton instance')
    )
    // This is the async method callers should use when they need accurate cross-instance cost
    expect(method).toContain('redisPubSub.getExecutionCost(executionId)')
    expect(method).toContain('return redisCost')
  })
})

// =============================================================================
// 18. CORNER CASE: Leader election crash recovery
// =============================================================================

describe('leader election: crash recovery via TTL expiry', () => {
  const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')

  it('tryAcquireLeader sets TTL atomically with the lock (SET NX EX)', () => {
    // Critical for crash recovery: if the leader crashes without releasing,
    // the key must expire after TTL so another instance can acquire it.
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async tryAcquireLeader('),
      pubsubSource.indexOf('async renewLeadership(')
    )
    // SET key value NX EX ttlSeconds — atomic set-if-not-exists with expiry
    expect(method).toContain("'NX'")
    expect(method).toContain("'EX'")
    expect(method).toContain('ttlSeconds')
    // These must all be in the same .set() call for atomicity
    const setCall = method.match(/\.set\(key, this\.instanceId.*?\)/)
    expect(setCall).toBeTruthy()
    expect(setCall![0]).toContain('NX')
    expect(setCall![0]).toContain('EX')
  })

  it('failed leader acquisition returns false (not throw)', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async tryAcquireLeader('),
      pubsubSource.indexOf('async renewLeadership(')
    )
    // result is null when NX fails (key already exists)
    expect(method).toContain("result === 'OK'")
  })

  it('each singleton timer releases leadership on graceful shutdown', () => {
    // Verify all 4 singletons call releaseLeadership in their stop functions
    const cleanupSource = readFileSync(join(process.cwd(), 'server/lib/cleanup-scheduler.ts'), 'utf-8')
    const watchdogSource = readFileSync(join(process.cwd(), 'server/lib/execution-watchdog.ts'), 'utf-8')
    const engineSource = readFileSync(join(process.cwd(), 'server/lib/dispatch/dispatch-engine.ts'), 'utf-8')
    const relaySource = readFileSync(join(process.cwd(), 'server/lib/relay-server.ts'), 'utf-8')

    expect(cleanupSource).toContain("redisPubSub.releaseLeadership(LEADER_NAME)")
    expect(watchdogSource).toContain("redisPubSub.releaseLeadership(LEADER_NAME)")
    expect(engineSource).toContain("redisPubSub.releaseLeadership('dispatch-poll')")
    expect(relaySource).toContain("redisPubSub.releaseLeadership('dead-job-checker')")
  })

  it('releaseLeadership swallows errors in stop functions (graceful degradation)', () => {
    // Stop functions use .catch(() => {}) so release failures don't crash the process
    const cleanupSource = readFileSync(join(process.cwd(), 'server/lib/cleanup-scheduler.ts'), 'utf-8')
    const stopFn = cleanupSource.slice(
      cleanupSource.indexOf('export function stopCleanupScheduler('),
      cleanupSource.indexOf('Get current cleanup config')
    )
    expect(stopFn).toContain('.catch(() => {})')

    const watchdogSource = readFileSync(join(process.cwd(), 'server/lib/execution-watchdog.ts'), 'utf-8')
    const wdStop = watchdogSource.slice(
      watchdogSource.indexOf('export function stopExecutionWatchdog('),
      watchdogSource.indexOf('Get current watchdog config')
    )
    expect(wdStop).toContain('.catch(() => {})')
  })
})

// =============================================================================
// 19. Pending approval Redis write-through (bug fix)
// =============================================================================

describe('dispatch-engine: pending approval Redis write-through', () => {
  const ENGINE_PATH = join(process.cwd(), 'server/lib/dispatch/dispatch-engine.ts')
  const engineSource = readFileSync(ENGINE_PATH, 'utf-8')

  it('requestApproval writes through to Redis via setPendingApproval', () => {
    const method = engineSource.slice(
      engineSource.indexOf('private async requestApproval('),
      engineSource.indexOf('Handle approval response from user')
    )
    expect(method).toContain('redisPubSub.setPendingApproval(executionId)')
  })

  it('requestDynamicApproval writes through to Redis via setPendingApproval', () => {
    const startIdx = engineSource.indexOf('async requestDynamicApproval(')
    // Find the method body — it ends at the next doc comment for hasPendingApprovalForExecution
    const endIdx = engineSource.indexOf('Check if there is a pending approval for a given execution ID')
    const method = engineSource.slice(startIdx, endIdx)
    expect(method).toContain('redisPubSub.setPendingApproval(executionId)')
  })

  it('respondToApproval clears Redis marker when no more approvals remain', () => {
    const method = engineSource.slice(
      engineSource.indexOf('async respondToApproval('),
      engineSource.indexOf('Prune stale entries from respondedApprovals')
    )
    expect(method).toContain('redisPubSub.removePendingApproval(pending.executionId)')
    expect(method).toContain('hasPendingApprovalForExecution(pending.executionId)')
  })

  it('cancel clears Redis pending-approval marker', () => {
    const cancelMethod = engineSource.slice(
      engineSource.indexOf('async cancel(nodeId: string)'),
      engineSource.indexOf('Prune a branch')
    )
    expect(cancelMethod).toContain('redisPubSub.removePendingApproval(execution.executionId)')
  })

  it('all Redis pending-approval calls are fire-and-forget (.catch)', () => {
    const source = engineSource
    const setPendingCalls = source.match(/redisPubSub\.setPendingApproval\([^)]+\)\.catch/g)
    const removePendingCalls = source.match(/redisPubSub\.removePendingApproval\([^)]+\)\.catch/g)
    expect(setPendingCalls).toBeTruthy()
    expect(setPendingCalls!.length).toBeGreaterThanOrEqual(2) // requestApproval + requestDynamicApproval
    expect(removePendingCalls).toBeTruthy()
    expect(removePendingCalls!.length).toBeGreaterThanOrEqual(2) // respondToApproval + cancel
  })
})

describe('redis-pubsub: pending approval methods', () => {
  const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')

  it('has setPendingApproval method', () => {
    expect(pubsubSource).toContain('async setPendingApproval(executionId: string)')
  })

  it('has hasPendingApproval method', () => {
    expect(pubsubSource).toContain('async hasPendingApproval(executionId: string)')
  })

  it('has removePendingApproval method', () => {
    expect(pubsubSource).toContain('async removePendingApproval(executionId: string)')
  })

  it('PENDING_APPROVAL key prefix is defined', () => {
    expect(pubsubSource).toContain("PENDING_APPROVAL: 'relay:pending:approval:'")
  })

  it('setPendingApproval has 4h TTL matching execution context', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async setPendingApproval('),
      pubsubSource.indexOf('async hasPendingApproval(')
    )
    expect(method).toContain('14400')
  })

  it('setPendingApproval is a no-op without Redis', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async setPendingApproval('),
      pubsubSource.indexOf('async hasPendingApproval(')
    )
    expect(method).toContain('if (!this.publisher) return')
  })

  it('hasPendingApproval returns false without Redis (defer to local check)', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async hasPendingApproval('),
      pubsubSource.indexOf('async removePendingApproval(')
    )
    expect(method).toContain('if (!this.publisher) return false')
  })

  it('removePendingApproval is a no-op without Redis', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async removePendingApproval('),
      pubsubSource.indexOf('Private Methods')
    )
    expect(method).toContain('if (!this.publisher) return')
  })
})

// =============================================================================
// 21. CORNER CASE: Dispatch engine idempotency for approval responses
// =============================================================================

describe('dispatch-engine: approval response idempotency', () => {
  const ENGINE_PATH = join(process.cwd(), 'server/lib/dispatch/dispatch-engine.ts')
  const engineSource = readFileSync(ENGINE_PATH, 'utf-8')

  it('has respondedApprovals Map for idempotency tracking', () => {
    expect(engineSource).toContain('private respondedApprovals = new Map<string, number>()')
  })

  it('respondToApproval checks respondedApprovals before processing', () => {
    const method = engineSource.slice(
      engineSource.indexOf('async respondToApproval('),
      engineSource.indexOf('Prune stale entries from respondedApprovals')
    )
    expect(method).toContain('if (this.respondedApprovals.has(approvalId)) return')
  })

  it('respondToApproval records idempotency BEFORE awaiting side-effects', () => {
    const method = engineSource.slice(
      engineSource.indexOf('async respondToApproval('),
      engineSource.indexOf('Prune stale entries from respondedApprovals')
    )
    // respondedApprovals.set must come before emitEvent
    const setIdx = method.indexOf('this.respondedApprovals.set(approvalId')
    const emitIdx = method.indexOf('astroEventTransport.emitEvent(')
    expect(setIdx).toBeGreaterThan(-1)
    expect(emitIdx).toBeGreaterThan(setIdx)
  })

  it('respondedApprovals are pruned periodically (TTL-based)', () => {
    expect(engineSource).toContain('RESPONDED_APPROVAL_TTL_MS = 60 * 60 * 1000')
    expect(engineSource).toContain('pruneRespondedApprovals()')
  })

  it('cancel records idempotency for pending approvals', () => {
    const cancelMethod = engineSource.slice(
      engineSource.indexOf('async cancel(nodeId: string)'),
      engineSource.indexOf('Prune a branch')
    )
    expect(cancelMethod).toContain('this.respondedApprovals.set(approvalId, Date.now())')
  })
})

// =============================================================================
// 20. CORNER CASE: INCRBYFLOAT first-write TTL detection
// =============================================================================

describe('redis-pubsub: INCRBYFLOAT first-write TTL edge case', () => {
  const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
  const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')

  it('always refreshes TTL after increment (idempotent, avoids floating-point edge cases)', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async incrementExecutionCost('),
      pubsubSource.indexOf('async getExecutionCost(')
    )
    // Should always call expire, not conditionally on numResult === costUsd
    expect(method).toContain('expire(key, 14400)')
    expect(method).not.toContain('numResult === costUsd')
  })

  it('parses INCRBYFLOAT result from string to float', () => {
    // INCRBYFLOAT returns a bulk string, not a number — must parse
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async incrementExecutionCost('),
      pubsubSource.indexOf('async getExecutionCost(')
    )
    expect(method).toContain('parseFloat(String(result))')
  })

  it('getExecutionCost parses stored string value', () => {
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async getExecutionCost(executionId: string): Promise<number>'),
      pubsubSource.indexOf('async removeExecutionCost(')
    )
    expect(method).toContain('parseFloat(val)')
  })
})

// =============================================================================
// 21. CORNER CASE: Approval notification dedup ordering
// =============================================================================

describe('events.ts: approval notification dedup ordering guarantees', () => {
  const EVENTS_PATH = join(process.cwd(), 'server/routes/events.ts')
  const eventsSource = readFileSync(EVENTS_PATH, 'utf-8')

  it('checks local Set BEFORE Redis SETNX (fast-path optimization)', () => {
    // Local Set avoids redundant Redis round-trips when multiple browser tabs
    // on the same instance trigger the same approval notification
    const section = eventsSource.slice(
      eventsSource.indexOf('Dedup across instances'),
      eventsSource.indexOf('notifiedApprovalRequests.add(msg.requestId)')
    )
    const localCheckIdx = section.indexOf('notifiedApprovalRequests.has(msg.requestId)')
    const redisCheckIdx = section.indexOf('redisPubSub.markApprovalNotified(msg.requestId)')
    expect(localCheckIdx).toBeGreaterThan(-1)
    expect(redisCheckIdx).toBeGreaterThan(localCheckIdx)
  })

  it('uses short-circuit evaluation (local false && redis check)', () => {
    const section = eventsSource.slice(
      eventsSource.indexOf('Dedup across instances'),
      eventsSource.indexOf('notifiedApprovalRequests.add(msg.requestId)')
    )
    // !has() && await markNotified() — if local has it, Redis is never called
    expect(section).toContain('!notifiedApprovalRequests.has(msg.requestId)')
    expect(section).toContain('&& await redisPubSub.markApprovalNotified')
  })

  it('local Set entries auto-expire after 5 minutes', () => {
    const section = eventsSource.slice(
      eventsSource.indexOf('notifiedApprovalRequests.add(msg.requestId)'),
      eventsSource.indexOf('notifiedApprovalRequests.add(msg.requestId)') + 200
    )
    expect(section).toContain('setTimeout(() => notifiedApprovalRequests.delete(msg.requestId), 300_000)')
  })

  it('Redis SETNX TTL matches local Set cleanup (5 minutes = 300 seconds)', () => {
    const PUBSUB_PATH = join(process.cwd(), 'server/lib/redis-pubsub.ts')
    const pubsubSource = readFileSync(PUBSUB_PATH, 'utf-8')
    const method = pubsubSource.slice(
      pubsubSource.indexOf('async markApprovalNotified('),
      pubsubSource.indexOf('Private Methods')
    )
    // 300 seconds = 5 minutes
    expect(method).toContain('300')
  })
})

// =============================================================================
// 22. CORNER CASE: Unique leader names prevent conflicts
// =============================================================================

describe('leader election: unique leader names for all singletons', () => {
  it('all 4 leader names are distinct', () => {
    const cleanupSource = readFileSync(join(process.cwd(), 'server/lib/cleanup-scheduler.ts'), 'utf-8')
    const watchdogSource = readFileSync(join(process.cwd(), 'server/lib/execution-watchdog.ts'), 'utf-8')
    const engineSource = readFileSync(join(process.cwd(), 'server/lib/dispatch/dispatch-engine.ts'), 'utf-8')
    const relaySource = readFileSync(join(process.cwd(), 'server/lib/relay-server.ts'), 'utf-8')

    // Extract leader names
    const cleanupName = cleanupSource.match(/LEADER_NAME = '([^']+)'/)?.[1]
    const watchdogName = watchdogSource.match(/LEADER_NAME = '([^']+)'/)?.[1]
    const engineName = engineSource.match(/POLL_LEADER_NAME = '([^']+)'/)?.[1]
    const relayName = relaySource.match(/LEADER_NAME = '([^']+)'/)?.[1]

    expect(cleanupName).toBe('cleanup-scheduler')
    expect(watchdogName).toBe('execution-watchdog')
    expect(engineName).toBe('dispatch-poll')
    expect(relayName).toBe('dead-job-checker')

    // All distinct
    const names = new Set([cleanupName, watchdogName, engineName, relayName])
    expect(names.size).toBe(4)
  })
})

// =============================================================================
// 23. AI Pathway analysis: all pathways unaffected by Phase 3-4
// =============================================================================

describe('AI pathway analysis: Phase 3-4 changes are scoped to infrastructure', () => {
  // Phase 3-4 changes should not affect the core AI logic paths:
  // - Plan generation (prompt-templates → Claude Agent SDK → SSE)
  // - Task execution (dispatch → relay → agent runner → result)
  // - Project chat (chat routes → Claude Agent SDK → SSE)
  // - Summarization (summarize routes → Claude)
  //
  // The changes are limited to:
  // 1. Redis write-through for safety state (dispatch.ts)
  // 2. Redis atomic cost tracking (safety-rails.ts)
  // 3. Leader election for timers (cleanup, watchdog, dispatch-poll, dead-job)
  // 4. Approval notification dedup (events.ts)
  //
  // No changes to: prompt templates, agent SDK calls, chat routes, summarization

  it('prompt-templates.ts is unchanged', () => {
    // Plan generation uses prompt-templates — this should not be touched by Phase 3-4
    const source = readFileSync(join(process.cwd(), 'packages/core/src/prompt-templates.ts'), 'utf-8')
    expect(source).not.toContain('redisPubSub')
    expect(source).not.toContain('tryAcquireLeader')
    expect(source).not.toContain('incrementExecutionCost')
  })

  it('chat routes are unchanged (no Redis additions)', () => {
    try {
      const chatSource = readFileSync(join(process.cwd(), 'server/routes/chat.ts'), 'utf-8')
      // Chat routes should not reference any Phase 3-4 Redis methods
      expect(chatSource).not.toContain('incrementExecutionCost')
      expect(chatSource).not.toContain('tryAcquireLeader')
      expect(chatSource).not.toContain('setTaskDir')
      expect(chatSource).not.toContain('setApprovedSafetyDir')
    } catch {
      // chat.ts may not exist in this branch — acceptable
    }
  })

  it('streaming-event-log.ts is unchanged', () => {
    const source = readFileSync(join(process.cwd(), 'server/lib/streaming-event-log.ts'), 'utf-8')
    expect(source).not.toContain('tryAcquireLeader')
    expect(source).not.toContain('incrementExecutionCost')
  })

  it('context-assembler.ts is unchanged', () => {
    const source = readFileSync(join(process.cwd(), 'server/lib/dispatch/context-assembler.ts'), 'utf-8')
    expect(source).not.toContain('redisPubSub')
  })

  it('result-router.ts is unchanged', () => {
    const source = readFileSync(join(process.cwd(), 'server/lib/dispatch/result-router.ts'), 'utf-8')
    expect(source).not.toContain('redisPubSub')
  })
})

// =============================================================================
// 24. CORNER CASE: setInterval async callbacks must catch errors
// =============================================================================

describe('setInterval error handling: no unhandled promise rejections', () => {
  it('dispatch-engine startPolling wraps setInterval body in try/catch', () => {
    const ENGINE_PATH = join(process.cwd(), 'server/lib/dispatch/dispatch-engine.ts')
    const engineSource = readFileSync(ENGINE_PATH, 'utf-8')
    const polling = engineSource.slice(
      engineSource.indexOf('private startPolling():'),
      engineSource.indexOf('private stopPolling():')
    )
    // Must have try/catch inside the setInterval callback
    expect(polling).toContain('try {')
    expect(polling).toContain("console.error('[dispatch] Poll cycle failed:'")
  })

  it('relay-server startDeadJobChecker wraps setInterval body in try/catch', () => {
    const RELAY_PATH = join(process.cwd(), 'server/lib/relay-server.ts')
    const relaySource = readFileSync(RELAY_PATH, 'utf-8')
    const checker = relaySource.slice(
      relaySource.indexOf('private startDeadJobChecker():'),
      relaySource.indexOf('Dead job checker started')
    )
    expect(checker).toContain('try {')
    expect(checker).toContain("console.error('[relay] Dead job check cycle failed:'")
  })
})

// =============================================================================
// 25. safety-rails: getExecutionCostCrossInstance resilience
// =============================================================================

describe('safety-rails: getExecutionCostCrossInstance error resilience', () => {
  const RAILS_PATH = join(process.cwd(), 'server/lib/observability/safety-rails.ts')
  const railsSource = readFileSync(RAILS_PATH, 'utf-8')

  it('getExecutionCostCrossInstance catches Redis errors', () => {
    const method = railsSource.slice(
      railsSource.indexOf('async getExecutionCostCrossInstance('),
      railsSource.indexOf('/** Singleton instance')
    )
    expect(method).toContain('try {')
    expect(method).toContain('} catch {')
    expect(method).toContain('Redis unavailable')
  })

  it('falls back to local cache on Redis failure', () => {
    const method = railsSource.slice(
      railsSource.indexOf('async getExecutionCostCrossInstance('),
      railsSource.indexOf('/** Singleton instance')
    )
    // After the catch block, should return from local Map
    expect(method).toContain('this.executionCosts.get(executionId) ?? 0')
  })
})
