/**
 * Watcher IPC channel handlers.
 *
 * Lazily spawns a singleton fs-watcher worker_thread on first subscribe.
 * Routes Cmd messages to the worker and fans worker events out over the
 * stream broker on channel `watcher:<subscriptionId>`.
 *
 * Renderer contract (see electron/main/ipc/schema/watcher.ts):
 *   - watcher:subscribe    → { subscriptionId }
 *   - watcher:unsubscribe  → { ok: true }
 *   - events arrive on broker channel `watcher:<subscriptionId>` as
 *     { events: [...] } or { error: string }.
 */

import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'

import { streamBroker } from '../broker.js'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/watcher.js'
import type { Cmd, Event } from '../../../workers/fs-watcher/protocol.js'

interface PendingAck {
  resolve: () => void
  reject: (err: Error) => void
}

let worker: Worker | null = null
const pendingAcks = new Map<string, PendingAck>()

function ensureWorker(): Worker {
  if (worker) return worker

  // Compiled layout:
  //   electron/dist/main/ipc/channels/watcher.js
  //   electron/dist/workers/fs-watcher/worker.js
  // From the channel file, the worker is three directories up then into
  // workers/fs-watcher/worker.js.
  const workerUrl = new URL(
    '../../../workers/fs-watcher/worker.js',
    import.meta.url
  )

  const w = new Worker(workerUrl)

  w.on('message', (msg: Event) => {
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'batch':
        streamBroker.publish(`watcher:${msg.subscriptionId}`, {
          events: msg.events,
        })
        break
      case 'ack': {
        const pending = pendingAcks.get(msg.subscriptionId)
        if (pending) {
          pendingAcks.delete(msg.subscriptionId)
          pending.resolve()
        }
        break
      }
      case 'error': {
        // Surface errors on the same broker channel so the renderer can
        // react. If there is still a pending ack for this subscription
        // (e.g. the watcher failed before becoming ready), reject it so
        // the IPC caller sees the failure instead of hanging.
        streamBroker.publish(`watcher:${msg.subscriptionId}`, {
          error: msg.error,
        })
        const pending = pendingAcks.get(msg.subscriptionId)
        if (pending) {
          pendingAcks.delete(msg.subscriptionId)
          pending.reject(new Error(msg.error))
        }
        break
      }
      default:
        break
    }
  })

  w.on('error', (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err))
    console.error('[watcher] worker error:', error)
    // Reject any outstanding acks so callers do not hang.
    for (const [, pending] of pendingAcks) {
      pending.reject(error)
    }
    pendingAcks.clear()
  })

  w.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[watcher] worker exited with code ${code}`)
    }
    worker = null
    for (const [, pending] of pendingAcks) {
      pending.reject(new Error(`fs-watcher worker exited (code ${code})`))
    }
    pendingAcks.clear()
  })

  worker = w
  return w
}

function sendCmdAwaitAck(cmd: Cmd): Promise<void> {
  const w = ensureWorker()
  const subscriptionId =
    cmd.type === 'watch' ? cmd.subscriptionId : cmd.subscriptionId
  return new Promise<void>((resolve, reject) => {
    pendingAcks.set(subscriptionId, { resolve, reject })
    try {
      w.postMessage(cmd)
    } catch (err) {
      pendingAcks.delete(subscriptionId)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

export function registerWatcherChannels(): void {
  defineHandler('watcher:subscribe', schema.subscribe, async (req) => {
    const subscriptionId = randomUUID()
    await sendCmdAwaitAck({
      type: 'watch',
      subscriptionId,
      path: req.path,
      ignored: req.ignored,
      recursive: req.recursive,
    })
    return { subscriptionId }
  })

  defineHandler('watcher:unsubscribe', schema.unsubscribe, async (req) => {
    await sendCmdAwaitAck({
      type: 'unwatch',
      subscriptionId: req.subscriptionId,
    })
    return { ok: true as const }
  })
}
