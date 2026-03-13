import { redisPubSub } from './redis-pubsub.js'
import { syncAllGitHubRepoCaches } from './github-repo-cache.js'

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

async function runOnce(): Promise<void> {
  const acquired = await redisPubSub.tryAcquireLeader(LEADER_NAME, LEADER_TTL_SECONDS)
  const renewed = !acquired && await redisPubSub.renewLeadership(LEADER_NAME, LEADER_TTL_SECONDS)
  if (!acquired && !renewed) {
    console.log('[github-cache] Another instance is the leader, skipping this cycle')
    return
  }

  try {
    await syncAllGitHubRepoCaches()
  } catch (error) {
    console.error('[github-cache] Scheduled sync failed:', error)
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
