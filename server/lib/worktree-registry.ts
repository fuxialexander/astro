/**
 * Worktree Registry
 *
 * Singleton map that tracks active worktree paths for task executions.
 * Worktrees persist after execution completes until the task is explicitly
 * completed or pruned, enabling post-execution steering (resume sessions).
 */

import type { ServerWorktreeSetup } from './worktree-manager.js'

export interface WorktreeEntry {
  executionId: string
  nodeId: string
  projectId: string
  worktreePath: string
  branchName: string
  repoPath: string
  sessionId?: string
  cleanup: ServerWorktreeSetup['cleanup']
  createdAt: Date
}

class WorktreeRegistry {
  private entries = new Map<string, WorktreeEntry>()

  /**
   * Register a worktree for tracking.
   */
  register(entry: WorktreeEntry): void {
    this.entries.set(entry.executionId, entry)
    console.log(`[worktree-registry] Registered worktree for ${entry.executionId}: ${entry.worktreePath}`)
  }

  /**
   * Look up a worktree by executionId.
   */
  get(executionId: string): WorktreeEntry | undefined {
    return this.entries.get(executionId)
  }

  /**
   * Look up a worktree by nodeId (for steer from UI which uses nodeId).
   * Returns the most recent entry for this nodeId.
   */
  getByNodeId(nodeId: string): WorktreeEntry | undefined {
    let latest: WorktreeEntry | undefined
    for (const entry of this.entries.values()) {
      if (entry.nodeId === nodeId) {
        if (!latest || entry.createdAt > latest.createdAt) {
          latest = entry
        }
      }
    }
    return latest
  }

  /**
   * Update the sessionId for an entry (called when Claude session initializes).
   */
  updateSessionId(executionId: string, sessionId: string): void {
    const entry = this.entries.get(executionId)
    if (entry) {
      entry.sessionId = sessionId
      console.log(`[worktree-registry] Updated sessionId for ${executionId}: ${sessionId}`)
    }
  }

  /**
   * Remove entry and clean up worktree on disk.
   */
  async remove(executionId: string, keepBranch = true): Promise<boolean> {
    const entry = this.entries.get(executionId)
    if (!entry) return false

    try {
      await entry.cleanup({ keepBranch })
      console.log(`[worktree-registry] Cleaned up worktree for ${executionId}: ${entry.worktreePath}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[worktree-registry] Cleanup failed for ${executionId}: ${msg}`)
    }

    this.entries.delete(executionId)
    return true
  }

  /**
   * List all tracked worktrees.
   */
  list(): WorktreeEntry[] {
    return Array.from(this.entries.values())
  }

  /**
   * Get count of tracked worktrees.
   */
  get size(): number {
    return this.entries.size
  }
}

// Export singleton
export const worktreeRegistry = new WorktreeRegistry()
