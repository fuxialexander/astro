/**
 * fs-watcher worker thread.
 *
 * Owns one chokidar FSWatcher per subscription. Raw chokidar events are
 * buffered and flushed to main on a 50ms trailing timer so that bursty
 * filesystem activity (e.g. `npm install`, git checkout) does not drown
 * the main process or renderer subscribers.
 *
 * Runs on a Node worker_thread; no Electron APIs, no renderer access.
 */

import { parentPort } from 'node:worker_threads'
import chokidar, { type FSWatcher } from 'chokidar'

import type { Cmd, Event, WatchEvent, WatchEventType } from './protocol.js'

if (!parentPort) {
  throw new Error('[fs-watcher] must be run as a worker_thread')
}
const port = parentPort

const FLUSH_INTERVAL_MS = 50

/**
 * Default ignore patterns applied to every watcher to avoid EMFILE ("too many
 * open files") on large projects. These heavy directories contain thousands of
 * files that are not useful for a file-browser refresh signal.
 */
const DEFAULT_IGNORED: readonly (string | RegExp)[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/.tox/**',
  '**/target/**',        // Rust / Cargo
  '**/.astro/**',
  '**/.turbo/**',
]

interface Subscription {
  watcher: FSWatcher
  buffer: WatchEvent[]
  flushTimer: NodeJS.Timeout | null
}

const subscriptions = new Map<string, Subscription>()

/** chokidar event names we forward; everything else is dropped. */
const FORWARDED: ReadonlySet<string> = new Set<string>([
  'add',
  'change',
  'unlink',
  'addDir',
  'unlinkDir',
])

function post(event: Event): void {
  port.postMessage(event)
}

function flush(subscriptionId: string): void {
  const sub = subscriptions.get(subscriptionId)
  if (!sub) return
  if (sub.flushTimer) {
    clearTimeout(sub.flushTimer)
    sub.flushTimer = null
  }
  if (sub.buffer.length === 0) return
  const events = sub.buffer
  sub.buffer = []
  post({ type: 'batch', subscriptionId, events })
}

function bufferEvent(
  subscriptionId: string,
  eventType: WatchEventType,
  filePath: string
): void {
  const sub = subscriptions.get(subscriptionId)
  if (!sub) return
  sub.buffer.push({ type: eventType, path: filePath })
  if (!sub.flushTimer) {
    sub.flushTimer = setTimeout(() => flush(subscriptionId), FLUSH_INTERVAL_MS)
  }
}

function startWatch(cmd: Extract<Cmd, { type: 'watch' }>): void {
  const { subscriptionId, path, ignored, recursive } = cmd

  if (subscriptions.has(subscriptionId)) {
    post({
      type: 'error',
      subscriptionId,
      error: `subscription already exists: ${subscriptionId}`,
    })
    return
  }

  const mergedIgnored = [...DEFAULT_IGNORED, ...(ignored ?? [])]

  const watcher = chokidar.watch(path, {
    ignored: mergedIgnored,
    ignoreInitial: true,
    depth: recursive ? undefined : 0,
  })

  const sub: Subscription = { watcher, buffer: [], flushTimer: null }
  subscriptions.set(subscriptionId, sub)

  watcher.on('all', (eventName: string, filePath: string) => {
    if (!FORWARDED.has(eventName)) return
    bufferEvent(subscriptionId, eventName as WatchEventType, filePath)
  })

  watcher.on('error', (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    post({ type: 'error', subscriptionId, error: message })
  })

  watcher.once('ready', () => {
    post({ type: 'ack', subscriptionId })
  })
}

async function stopWatch(cmd: Extract<Cmd, { type: 'unwatch' }>): Promise<void> {
  const { subscriptionId } = cmd
  const sub = subscriptions.get(subscriptionId)
  if (!sub) {
    // Idempotent: still ack so the main handler can resolve.
    post({ type: 'ack', subscriptionId })
    return
  }
  // Flush any pending events before tearing down so renderers see the
  // final state before the unsubscribe completes.
  flush(subscriptionId)
  try {
    await sub.watcher.close()
  } catch (err) {
    post({
      type: 'error',
      subscriptionId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  subscriptions.delete(subscriptionId)
  post({ type: 'ack', subscriptionId })
}

port.on('message', (cmd: Cmd) => {
  if (!cmd || typeof cmd !== 'object') return
  switch (cmd.type) {
    case 'watch':
      startWatch(cmd)
      break
    case 'unwatch':
      void stopWatch(cmd)
      break
    default: {
      // Exhaustiveness guard — silently ignore unknown cmd types.
      const _exhaustive: never = cmd
      void _exhaustive
    }
  }
})
