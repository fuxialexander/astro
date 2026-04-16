/**
 * Preload for the find-in-page overlay window.
 *
 * Exposes a very small `window.astro` surface: just enough to drive
 * `webContents.findInPage()` on the target window via IPC.
 *
 *   astro.find(text, opts) — start or update a search
 *   astro.stop()           — clear current highlight
 *   astro.close()          — hide the overlay
 *   astro.onResult(cb)     — subscribe to found-in-page results
 *
 * Sandbox-safe: uses only the allowed `electron` preload subset.
 */

import { contextBridge, ipcRenderer } from 'electron'

export interface FindOptions {
  forward?: boolean
  matchCase?: boolean
  findNext?: boolean
}

export interface FindResult {
  requestId: number
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}

type ResultHandler = (result: FindResult) => void

const handlers = new Set<ResultHandler>()

ipcRenderer.on('find:result', (_e, result: FindResult) => {
  for (const h of handlers) {
    try {
      h(result)
    } catch (err) {
      console.error('[find-in-page preload] result handler threw:', err)
    }
  }
})

const api = {
  find: (text: string, opts: FindOptions = {}) =>
    ipcRenderer.invoke('find-in-page:find', {
      text,
      forward: opts.forward,
      matchCase: opts.matchCase,
      findNext: opts.findNext,
    }) as Promise<{ ok: true }>,
  stop: () => ipcRenderer.invoke('find-in-page:stop') as Promise<{ ok: true }>,
  close: () => ipcRenderer.invoke('find-in-page:close') as Promise<{ ok: true }>,
  onResult: (cb: ResultHandler): (() => void) => {
    handlers.add(cb)
    return () => {
      handlers.delete(cb)
    }
  },
}

contextBridge.exposeInMainWorld('astro', api)

export type FindInPageBridge = typeof api
