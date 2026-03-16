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
let skipCounter = 0
const MAX_BACKOFF_CYCLES = 6 // max skip cycles (5min * 6 = 30min effective max)

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

  // Progressive backoff: after rate limit failures, skip N cycles before retrying
  if (skipCounter > 0) {
    console.log(`[github-cache] Backing off after ${consecutiveFailures} failure(s) — ${skipCounter} cycle(s) remaining`)
    skipCounter--
    return
  }

  try {
    await syncAllGitHubRepoCaches()
    consecutiveFailures = 0
    skipCounter = 0
  } catch (error) {
    const errMsg = (error as Error).message ?? ''
    if (errMsg.includes('rate limit')) {
      consecutiveFailures++
      skipCounter = Math.min(consecutiveFailures, MAX_BACKOFF_CYCLES)
      console.error(`[github-cache] Rate limit hit (failure #${consecutiveFailures}). Skipping next ${skipCounter} cycle(s).`)
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
