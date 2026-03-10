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

    it('sets 4h TTL on first write', () => {
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
