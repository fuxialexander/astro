/**
 * Preload script for the main window.
 *
 * Exposes a single `window.astro` namespace built from three things:
 *   1. `platform` — info about the runtime (Electron/OS/versions)
 *   2. `invoke(channel, payload)` — the typed IPC entry point. Renderer
 *       calls go through src/lib/desktop-bridge.ts which knows the exact
 *       channel names + payload shapes.
 *   3. `streams.subscribe(channel, handler)` — high-frequency stream sink
 *       backed by a MessagePort. The main process posts the renderer-side
 *       port via webContents.postMessage('broker:init', null, [port]) at
 *       window creation; we receive it here and route published events to
 *       in-renderer handlers.
 *
 * Sandbox-safe: this file does NOT import any Node modules other than the
 * always-allowed `electron` preload subset (contextBridge, ipcRenderer).
 */

import { contextBridge, ipcRenderer } from 'electron'

// node:os is normally available in the preload sandbox, but keep the read
// fully best-effort — a failure here must NOT block `window.astro` from
// being exposed, otherwise the renderer's isDesktop() check breaks.
function readHostname(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os') as { hostname: () => string }
    return os.hostname()
  } catch {
    return ''
  }
}
const cachedHostname = readHostname()

type StreamHandler = (payload: unknown) => void

// channel → set of handlers in this renderer
const subscribers = new Map<string, Set<StreamHandler>>()
let brokerPort: MessagePort | null = null
const pendingSubscribes: string[] = []

// The broker port arrives as an ipcRenderer event with channel 'broker:init'.
// ipcRenderer.on receives the MessagePort via event.ports[0].
ipcRenderer.on('broker:init', (event) => {
  const port = event.ports[0]
  if (!port) return
  brokerPort = port
  port.onmessage = (msgEvent) => {
    const msg = msgEvent.data as { channel?: string; payload?: unknown } | null
    if (!msg || typeof msg.channel !== 'string') return
    const set = subscribers.get(msg.channel)
    if (!set) return
    for (const handler of set) {
      try {
        handler(msg.payload)
      } catch (err) {
        console.error('[preload] stream handler threw:', err)
      }
    }
  }
  port.start()

  // Replay any subscribe calls that landed before the port arrived.
  for (const channel of pendingSubscribes) {
    port.postMessage({ type: 'subscribe', channel })
  }
  pendingSubscribes.length = 0
})

function subscribe(channel: string, handler: StreamHandler): () => void {
  let set = subscribers.get(channel)
  if (!set) {
    set = new Set()
    subscribers.set(channel, set)
    // Tell main this is the first subscriber for this channel.
    if (brokerPort) {
      brokerPort.postMessage({ type: 'subscribe', channel })
    } else {
      pendingSubscribes.push(channel)
    }
  }
  set.add(handler)
  return () => {
    set!.delete(handler)
    if (set!.size === 0) {
      subscribers.delete(channel)
      brokerPort?.postMessage({ type: 'unsubscribe', channel })
    }
  }
}

const platform = {
  isElectron: true as const,
  os: process.platform,
  // Renderer uses this to decide whether a project's agent-runner lives on
  // the same machine as the Electron shell (so the terminal can just spawn
  // a local PTY) or on a remote one (so we SSH into it first).
  hostname: cachedHostname,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
}

contextBridge.exposeInMainWorld('astro', {
  platform,
  invoke: (channel: string, payload: unknown) => ipcRenderer.invoke(channel, payload),
  streams: { subscribe },
  onAuthCallback: (handler: (tokens: { accessToken: string; refreshToken: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, tokens: { accessToken: string; refreshToken: string }) => handler(tokens)
    ipcRenderer.on('auth:callback', listener)
    return () => ipcRenderer.removeListener('auth:callback', listener)
  },
  onUpdateReady: (handler: (info: { version: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: { version: string }) => handler(info)
    ipcRenderer.on('updater:ready', listener)
    return () => ipcRenderer.removeListener('updater:ready', listener)
  },
})

// Type augmentation for the renderer side. Mirrors what's exposed above —
// src/lib/desktop-bridge.ts uses this through a structural cast.
declare global {
  interface Window {
    astro: {
      platform: typeof platform
      invoke: (channel: string, payload: unknown) => Promise<unknown>
      streams: { subscribe: typeof subscribe }
      onAuthCallback: (
        handler: (tokens: { accessToken: string; refreshToken: string }) => void,
      ) => () => void
      onUpdateReady: (handler: (info: { version: string }) => void) => () => void
    }
  }
}
