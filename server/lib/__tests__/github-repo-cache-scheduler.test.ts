import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Mock the dependencies before importing
vi.mock('../redis-pubsub.js', () => ({
  redisPubSub: {
    tryAcquireLeader: vi.fn(),
    renewLeadership: vi.fn(),
  },
}))

vi.mock('../github-repo-cache.js', () => ({
  syncAllGitHubRepoCaches: vi.fn(),
}))

import { startGitHubRepoCacheScheduler, stopGitHubRepoCacheScheduler } from '../github-repo-cache-scheduler.js'
import { redisPubSub } from '../redis-pubsub.js'
import { syncAllGitHubRepoCaches } from '../github-repo-cache.js'

describe('github-repo-cache-scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    stopGitHubRepoCacheScheduler()
    vi.useRealTimers()
  })

  it('runs syncAllGitHubRepoCaches on start when leader is acquired', async () => {
    vi.mocked(redisPubSub.tryAcquireLeader).mockResolvedValue(true)
    vi.mocked(syncAllGitHubRepoCaches).mockResolvedValue()

    startGitHubRepoCacheScheduler({ enabled: true, intervalMs: 60_000 })

    // Wait for the initial async tick
    await vi.advanceTimersByTimeAsync(0)

    expect(redisPubSub.tryAcquireLeader).toHaveBeenCalledWith(
      'github-repo-cache-scheduler',
      600,
    )
    expect(syncAllGitHubRepoCaches).toHaveBeenCalledTimes(1)
  })

  it('skips sync when not the leader', async () => {
    vi.mocked(redisPubSub.tryAcquireLeader).mockResolvedValue(false)
    vi.mocked(redisPubSub.renewLeadership).mockResolvedValue(false)
    vi.mocked(syncAllGitHubRepoCaches).mockResolvedValue()

    startGitHubRepoCacheScheduler({ enabled: true, intervalMs: 60_000 })

    await vi.advanceTimersByTimeAsync(0)

    expect(syncAllGitHubRepoCaches).not.toHaveBeenCalled()
  })

  it('syncs when leadership is renewed (not acquired but renewed)', async () => {
    vi.mocked(redisPubSub.tryAcquireLeader).mockResolvedValue(false)
    vi.mocked(redisPubSub.renewLeadership).mockResolvedValue(true)
    vi.mocked(syncAllGitHubRepoCaches).mockResolvedValue()

    startGitHubRepoCacheScheduler({ enabled: true, intervalMs: 60_000 })

    await vi.advanceTimersByTimeAsync(0)

    expect(syncAllGitHubRepoCaches).toHaveBeenCalledTimes(1)
  })

  it('does not start when disabled', async () => {
    vi.mocked(redisPubSub.tryAcquireLeader).mockResolvedValue(true)
    vi.mocked(syncAllGitHubRepoCaches).mockResolvedValue()

    startGitHubRepoCacheScheduler({ enabled: false, intervalMs: 60_000 })

    await vi.advanceTimersByTimeAsync(0)

    expect(redisPubSub.tryAcquireLeader).not.toHaveBeenCalled()
    expect(syncAllGitHubRepoCaches).not.toHaveBeenCalled()
  })

  it('runs on interval after start', async () => {
    vi.mocked(redisPubSub.tryAcquireLeader).mockResolvedValue(true)
    vi.mocked(syncAllGitHubRepoCaches).mockResolvedValue()

    startGitHubRepoCacheScheduler({ enabled: true, intervalMs: 30_000 })

    // Initial run
    await vi.advanceTimersByTimeAsync(0)
    expect(syncAllGitHubRepoCaches).toHaveBeenCalledTimes(1)

    // After one interval
    await vi.advanceTimersByTimeAsync(30_000)
    expect(syncAllGitHubRepoCaches).toHaveBeenCalledTimes(2)

    // After another interval
    await vi.advanceTimersByTimeAsync(30_000)
    expect(syncAllGitHubRepoCaches).toHaveBeenCalledTimes(3)
  })

  it('stops the interval when stopGitHubRepoCacheScheduler is called', async () => {
    vi.mocked(redisPubSub.tryAcquireLeader).mockResolvedValue(true)
    vi.mocked(syncAllGitHubRepoCaches).mockResolvedValue()

    startGitHubRepoCacheScheduler({ enabled: true, intervalMs: 30_000 })

    await vi.advanceTimersByTimeAsync(0)
    expect(syncAllGitHubRepoCaches).toHaveBeenCalledTimes(1)

    stopGitHubRepoCacheScheduler()

    await vi.advanceTimersByTimeAsync(60_000)
    // Should not have run again
    expect(syncAllGitHubRepoCaches).toHaveBeenCalledTimes(1)
  })

  it('does not crash if syncAllGitHubRepoCaches throws', async () => {
    vi.mocked(redisPubSub.tryAcquireLeader).mockResolvedValue(true)
    vi.mocked(syncAllGitHubRepoCaches).mockRejectedValue(new Error('DB down'))

    startGitHubRepoCacheScheduler({ enabled: true, intervalMs: 60_000 })

    // Should not throw
    await vi.advanceTimersByTimeAsync(0)

    expect(syncAllGitHubRepoCaches).toHaveBeenCalled()
  })

  it('calling start twice stops the previous interval', async () => {
    vi.mocked(redisPubSub.tryAcquireLeader).mockResolvedValue(true)
    vi.mocked(syncAllGitHubRepoCaches).mockResolvedValue()

    startGitHubRepoCacheScheduler({ enabled: true, intervalMs: 10_000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(syncAllGitHubRepoCaches).toHaveBeenCalledTimes(1)

    // Start again with different interval — old one should be stopped
    startGitHubRepoCacheScheduler({ enabled: true, intervalMs: 20_000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(syncAllGitHubRepoCaches).toHaveBeenCalledTimes(2)

    // Advance 10s — old interval would have fired, but should not since it was cleared
    await vi.advanceTimersByTimeAsync(10_000)
    expect(syncAllGitHubRepoCaches).toHaveBeenCalledTimes(2)

    // Advance to 20s — new interval fires
    await vi.advanceTimersByTimeAsync(10_000)
    expect(syncAllGitHubRepoCaches).toHaveBeenCalledTimes(3)
  })
})
