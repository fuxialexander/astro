/**
 * Git IPC channel handlers. Bridges renderer IPC calls to a singleton
 * worker_thread that runs simple-git. The worker lives for the lifetime of
 * the main process; all six git channels share it and multiplex via
 * correlation IDs.
 */

import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/git.js'
import type { GitOp, WorkerRequest, WorkerResponse } from '../../../workers/git/protocol.js'

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

let worker: Worker | null = null
const pending = new Map<string, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  // Path from compiled electron/dist/main/ipc/channels/git.js to
  // electron/dist/workers/git/worker.js.
  const w = new Worker(new URL('../../../workers/git/worker.js', import.meta.url))
  w.on('message', (msg: WorkerResponse) => {
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.ok) {
      entry.resolve(msg.result)
    } else {
      entry.reject(new Error(msg.error))
    }
  })
  w.on('error', (err: Error) => {
    // Fail all pending requests; do not silently drop.
    for (const [, entry] of pending) {
      entry.reject(err)
    }
    pending.clear()
    worker = null
  })
  w.on('exit', (code) => {
    if (code !== 0) {
      const err = new Error(`[git-worker] exited with code ${code}`)
      for (const [, entry] of pending) {
        entry.reject(err)
      }
      pending.clear()
    }
    worker = null
  })
  worker = w
  return w
}

function callWorker<T>(op: GitOp, args: unknown): Promise<T> {
  const id = randomUUID()
  const w = getWorker()
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
    })
    const req: WorkerRequest = { id, op, args }
    w.postMessage(req)
  })
}

let registered = false

export function registerGitChannels(): void {
  if (registered) return
  registered = true

  defineHandler('git:status', schema.status, async (req) => {
    return callWorker<ReturnType<typeof schema.status.res.parse>>('status', req)
  })

  defineHandler('git:log', schema.log, async (req) => {
    return callWorker<ReturnType<typeof schema.log.res.parse>>('log', req)
  })

  defineHandler('git:diff', schema.diff, async (req) => {
    return callWorker<ReturnType<typeof schema.diff.res.parse>>('diff', req)
  })

  defineHandler('git:branches', schema.branchList, async (req) => {
    return callWorker<ReturnType<typeof schema.branchList.res.parse>>('branches', req)
  })

  defineHandler('git:checkout', schema.checkout, async (req) => {
    return callWorker<ReturnType<typeof schema.checkout.res.parse>>('checkout', req)
  })

  defineHandler('git:commit', schema.commit, async (req) => {
    return callWorker<ReturnType<typeof schema.commit.res.parse>>('commit', req)
  })
}
