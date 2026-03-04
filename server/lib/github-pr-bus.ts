/**
 * GitHub PR Event Bus
 *
 * A lightweight in-process event bus that broadcasts PR state changes
 * (CI status, review status, PR open/close/merge) to connected SSE clients.
 *
 * Mirrors the pattern of github-comment-bus.ts for comment broadcasting.
 */

import { EventEmitter } from 'events'

export interface GitHubPrEvent {
  owner: string
  repo: string
  prNumber: number
  /** The type of PR change that occurred */
  changeType: 'ci_status' | 'review_status' | 'pr_state' | 'branch_linked'
  /** Updated PR data snapshot */
  data: {
    title?: string
    state?: 'open' | 'closed' | 'merged'
    branchName?: string
    baseBranch?: string
    draft?: boolean
    additions?: number
    deletions?: number
    changedFiles?: number
    ciStatus?: string
    reviewStatus?: string
    checkRuns?: Array<{ name: string; status: string; conclusion: string | null }>
    reviewerStates?: Record<string, string>
    mergeable?: boolean
    /** For branch_linked events */
    nodeId?: string
    linkSource?: string
  }
}

class GitHubPrBus extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(50)
  }

  /** Emit a PR state change for connected SSE clients */
  emitPrChange(event: GitHubPrEvent): boolean {
    return super.emit('pr_change', event)
  }

  /** Subscribe to PR state change events */
  onPrChange(handler: (event: GitHubPrEvent) => void): void {
    this.on('pr_change', handler)
  }

  /** Unsubscribe from PR state change events */
  offPrChange(handler: (event: GitHubPrEvent) => void): void {
    this.off('pr_change', handler)
  }
}

export const githubPrBus = new GitHubPrBus()
