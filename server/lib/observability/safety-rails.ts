/**
 * Safety Rails
 *
 * Lightweight cost guard and tool restriction checking.
 * Tracks cumulative cost per execution and checks tool denylist.
 */

import type { SafetyRailsConfig } from './types.js'

/** Default cost limit per execution (USD) */
const DEFAULT_MAX_COST = 10.0

class SafetyRails {
  /** Per-project safety config */
  private configs = new Map<string, SafetyRailsConfig>()
  /** Per-execution cumulative cost */
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
   */
  trackCost(executionId: string, costUsd: number): {
    exceeded: boolean
    currentCost: number
    limit: number
  } {
    const current = (this.executionCosts.get(executionId) ?? 0) + costUsd
    this.executionCosts.set(executionId, current)

    const limit = DEFAULT_MAX_COST

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
  }

  /**
   * Get current cost for an execution.
   */
  getExecutionCost(executionId: string): number {
    return this.executionCosts.get(executionId) ?? 0
  }
}

/** Singleton instance */
export const safetyRails = new SafetyRails()
