import { redisPubSub } from './redis-pubsub.js'
import { syncAllGitHubRepoCaches } from './github-repo-cache.js'
import { isRateLimitLow } from './github-rate-limit.js'

export interface GitHubRepoCacheSchedulerConfig {
  enabled: boolean
  intervalMs: number
}

const DEFAULT_CONFIG: GitHubRepoCacheSchedulerConfig = {
  enabled: true,
  intervalMs: 5 * 60 * 1000,
}

const LEADER_NAME = 'github-repo-cache-scheduler'
const LEADER_TTL_SECONDS = 10 * 60

let timer: ReturnType<typeof setInterval> | null = null
let config: GitHubRepoCacheSchedulerConfig = DEFAULT_CONFIG
let consecutiveFailures = 0
const MAX_BACKOFF_MULTIPLIER = 6 // 5min * 6 = 30min max

async function runOnce(): Promise<void> {
  const acquired = await redisPubSub.tryAcquireLeader(LEADER_NAME, LEADER_TTL_SECONDS)
  const renewed = !acquired && await redisPubSub.renewLeadership(LEADER_NAME, LEADER_TTL_SECONDS)
  if (!acquired && !renewed) {
    console.log('[github-cache] Another instance is the leader, skipping this cycle')
    return
  }

  // Skip this cycle if rate limit is known to be low
  if (isRateLimitLow()) {
    console.log('[github-cache] Skipping sync cycle — GitHub API rate limit is low')
    return
  }

  // Exponential backoff: skip cycles after consecutive rate limit failures
  if (consecutiveFailures > 0) {
    const skipCycles = Math.min(consecutiveFailures, MAX_BACKOFF_MULTIPLIER) - 1
    // Use a simple counter — every N cycles we attempt a sync
    // This is tracked per-call; the interval stays the same but we skip N-1 out of N cycles
    if (skipCycles > 0) {
      const backoffMs = skipCycles * config.intervalMs
      console.log(`[github-cache] Backing off after ${consecutiveFailures} failures — skipping this cycle (effective interval: ${Math.round(backoffMs / 60000)}min)`)
      consecutiveFailures-- // decrement so we eventually retry
      return
    }
  }

  try {
    await syncAllGitHubRepoCaches()
    consecutiveFailures = 0 // Reset on success
  } catch (error) {
    const errMsg = (error as Error).message ?? ''
    if (errMsg.includes('rate limit')) {
      consecutiveFailures++
      console.error(`[github-cache] Rate limit hit (failure #${consecutiveFailures}). Next sync will back off.`)
    } else {
      console.error('[github-cache] Scheduled sync failed:', error)
    }
  }
}

export function startGitHubRepoCacheScheduler(customConfig?: Partial<GitHubRepoCacheSchedulerConfig>): void {
  config = { ...DEFAULT_CONFIG, ...customConfig }
  stopGitHubRepoCacheScheduler()

  if (!config.enabled) {
    console.log('[github-cache] Repo cache scheduler disabled')
    return
  }

  void runOnce()
  timer = setInterval(() => {
    void runOnce()
  }, config.intervalMs)
}

export function stopGitHubRepoCacheScheduler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
