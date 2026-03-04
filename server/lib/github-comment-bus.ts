/**
 * GitHub Comment Event Bus
 *
 * A lightweight in-process event bus that broadcasts new GitHub comments
 * to connected SSE clients for real-time updates.
 *
 * When a webhook delivers a new comment, it is emitted here.
 * The SSE endpoint subscribes to these events and pushes them to the frontend.
 */

import { EventEmitter } from 'events'
import type { GitHubComment } from '../types/github.js'

export interface GitHubCommentEvent {
  owner: string
  repo: string
  number: number
  comment: GitHubComment
}

class GitHubCommentBus extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(50)
  }

  /**
   * Emit a new comment event for connected SSE clients
   */
  emit(event: GitHubCommentEvent): boolean {
    return super.emit('comment', event)
  }

  /**
   * Subscribe to new comment events
   */
  onComment(handler: (event: GitHubCommentEvent) => void): void {
    this.on('comment', handler)
  }

  /**
   * Unsubscribe from comment events
   */
  offComment(handler: (event: GitHubCommentEvent) => void): void {
    this.off('comment', handler)
  }
}

export const githubCommentBus = new GitHubCommentBus()
