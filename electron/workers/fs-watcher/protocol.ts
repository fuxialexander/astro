/**
 * Message protocol between main and the fs-watcher worker thread.
 *
 * Main → worker: `Cmd` (watch / unwatch).
 * Worker → main: `Event` (batch of debounced chokidar events, ack, or error).
 *
 * The worker debounces raw chokidar events per subscription at 50ms granularity
 * and emits them as a single `batch` message so the main process and the
 * eventual renderer subscribers are not swamped under heavy churn.
 */

export type WatchEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface WatchEvent {
  type: WatchEventType
  path: string
}

export type Cmd =
  | {
      type: 'watch'
      subscriptionId: string
      path: string
      ignored?: string[]
      recursive: boolean
    }
  | {
      type: 'unwatch'
      subscriptionId: string
    }

export type Event =
  | {
      type: 'batch'
      subscriptionId: string
      events: WatchEvent[]
    }
  | {
      type: 'error'
      subscriptionId: string
      error: string
    }
  | {
      type: 'ack'
      subscriptionId: string
    }
