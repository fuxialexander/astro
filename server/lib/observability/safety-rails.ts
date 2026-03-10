/**
 * Safety Rails
 *
 * Lightweight cost guard and tool restriction checking.
 * Tracks cumulative cost per execution and checks tool denylist.
 *
 * Dual-layer: local Map for zero-latency hot-path reads + Redis
 * INCRBYFLOAT for atomic cross-instance accumulation. When Redis
 * is unavailable (single-instance mode), falls back to local-only.
 */

import type { SafetyRailsConfig } from './types.js'
import { redisPubSub } from '../redis-pubsub.js'

/** Default cost limit per execution (USD) */
const DEFAULT_MAX_COST = 10.0

class SafetyRails {
  /** Per-project safety config */
  private configs = new Map<string, SafetyRailsConfig>()
  /** Per-execution cumulative cost (local cache — source of truth is Redis when connected) */
  private executionCosts = new Map<string, number>()

  /**
   * Load project-specific safety configuration.
   */
  loadConfig(projectId: string, config: SafetyRailsConfig): void {
    this.configs.set(projectId, config)
  }

  /**
   * Get config for a project (falls back to defaults).
   */
  getConfig(projectId: string): SafetyRailsConfig {
    return this.configs.get(projectId) ?? {}
  }

  /**
   * Track cost for an execution. Returns whether the limit has been exceeded.
   *
   * Uses Redis INCRBYFLOAT for atomic cross-instance accumulation when
   * Redis is connected. Falls back to local-only when disconnected.
   */
  trackCost(executionId: string, costUsd: number): {
    exceeded: boolean
    currentCost: number
    limit: number
  } {
    const current = (this.executionCosts.get(executionId) ?? 0) + costUsd
    this.executionCosts.set(executionId, current)

    const limit = DEFAULT_MAX_COST

    // Write-through to Redis for cross-instance accuracy.
    // Fire-and-forget: the local Map gives instant feedback;
    // Redis makes it durable across instances.
    redisPubSub.incrementExecutionCost(executionId, costUsd).then((redisCost) => {
      if (redisCost !== null && redisCost > current) {
        // Another instance contributed cost — update local cache
        this.executionCosts.set(executionId, redisCost)
        if (redisCost > limit) {
          console.warn(
            `[safety-rails] Cross-instance cost limit exceeded for execution ${executionId}: $${redisCost.toFixed(4)} > $${limit.toFixed(2)}`,
          )
        }
      }
    }).catch((err) => {
      console.error('[safety-rails] Failed to increment cost in Redis:', err)
    })

    if (current > limit) {
      console.warn(
        `[safety-rails] Cost limit exceeded for execution ${executionId}: $${current.toFixed(4)} > $${limit.toFixed(2)}`,
      )
    }

    return {
      exceeded: current > limit,
      currentCost: current,
      limit,
    }
  }

  /**
   * Check if a tool is allowed for a given project.
   * Returns true if allowed, false if denied.
   */
  isToolAllowed(projectId: string, toolName: string): boolean {
    const config = this.configs.get(projectId)
    if (!config?.deniedTools || config.deniedTools.length === 0) return true

    const denied = config.deniedTools.includes(toolName)
    if (denied) {
      console.warn(`[safety-rails] Tool '${toolName}' is denied for project ${projectId}`)
    }
    return !denied
  }

  /**
   * Clean up state for a completed execution.
   */
  resetExecution(executionId: string): void {
    this.executionCosts.delete(executionId)
    redisPubSub.removeExecutionCost(executionId).catch((err) => {
      console.error('[safety-rails] Failed to remove cost from Redis:', err)
    })
  }

  /**
   * Get current cost for an execution (local cache).
   */
  getExecutionCost(executionId: string): number {
    return this.executionCosts.get(executionId) ?? 0
  }

  /**
   * Get cross-instance cost for an execution (async, reads from Redis).
   * Falls back to local cache when Redis is unavailable.
   */
  async getExecutionCostCrossInstance(executionId: string): Promise<number> {
    const redisCost = await redisPubSub.getExecutionCost(executionId)
    if (redisCost > 0) {
      // Update local cache with cross-instance total
      this.executionCosts.set(executionId, redisCost)
      return redisCost
    }
    return this.executionCosts.get(executionId) ?? 0
  }
}

/** Singleton instance */
export const safetyRails = new SafetyRails()
