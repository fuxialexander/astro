/**
 * MessageChannelMain broker for high-frequency streams.
 *
 * The renderer cannot use `ipcMain.handle` for streams (every message
 * round-trips through the main event loop). Instead, at window creation
 * we hand the renderer a `MessagePort`; the renderer listens on it via
 * `window.astro.streams.subscribe(channel, handler)` exposed by the preload.
 *
 * In the renderer-facing direction this broker is the producer side: any
 * worker (terminal, fs-watcher) or service can call `broker.publish(channel,
 * payload)` and every subscribed renderer port receives it.
 *
 * Phase 2 scope: simple fan-out, no per-pane filtering. Phase 3's pane
 * system layers per-pane subscriptions on top by passing a paneId in the
 * channel (e.g. `terminal:pane-7:data`).
 */

import { MessageChannelMain, type MessagePortMain, type WebContents } from 'electron'

interface RendererSubscription {
  port: MessagePortMain
  webContentsId: number
}

/**
 * Maximum number of early messages to buffer per channel before any subscriber
 * exists. Sized for typical PTY startup bursts (shell init + MOTD + first
 * prompt is usually <30 chunks); 64 leaves headroom without unbounded growth
 * if a subscriber never arrives.
 */
const EARLY_BUFFER_MAX = 64
/**
 * How long (ms) to keep early buffers alive before discarding them. Covers
 * the worst-case renderer init delay (Electron app.whenReady → window create
 * → webContents load → preload subscribe). Anything older than this is stale
 * for the user anyway.
 */
const EARLY_BUFFER_TTL_MS = 5_000

interface EarlyBuffer {
  messages: unknown[]
  timer: NodeJS.Timeout
}

class StreamBroker {
  /** channel → set of subscriber ports. */
  private subscriptions = new Map<string, Set<RendererSubscription>>()
  /** channel → buffered payloads published before any subscriber existed. */
  private earlyBuffers = new Map<string, EarlyBuffer>()

  /**
   * Establish a fresh MessagePort pair with the given renderer and send
   * the renderer end via webContents.postMessage. Call this once per
   * window during creation. The returned port is held internally.
   */
  attachWindow(webContents: WebContents): void {
    const { port1, port2 } = new MessageChannelMain()

    // The renderer-side port is transferred via postMessage. Channel name
    // 'broker:init' is special — preload listens for it and stores the port
    // as the global stream sink for window.astro.streams.subscribe.
    webContents.postMessage('broker:init', null, [port2])

    // Renderer can request subscriptions over port1 by sending a control
    // message: { type: 'subscribe' | 'unsubscribe', channel: string }.
    port1.on('message', (event) => {
      const msg = event.data as { type?: string; channel?: string } | null
      if (!msg || typeof msg.channel !== 'string') return
      if (msg.type === 'subscribe') {
        this.addSubscription(msg.channel, {
          port: port1,
          webContentsId: webContents.id,
        })
      } else if (msg.type === 'unsubscribe') {
        this.removeSubscription(msg.channel, port1)
      }
    })
    port1.start()

    webContents.once('destroyed', () => {
      this.removeAllForPort(port1)
      try {
        port1.close()
      } catch {
        // already closed
      }
    })
  }

  /**
   * Producer-side: broadcast a payload to every subscriber of this channel.
   * Workers and services use this to push events to the renderer without
   * round-tripping through main's ipcMain queue.
   */
  publish(channel: string, payload: unknown): void {
    const subs = this.subscriptions.get(channel)
    if (!subs || subs.size === 0) {
      // No subscribers yet — buffer early messages so they can be replayed
      // once the renderer subscribes (fixes PTY prompt race condition).
      this.bufferEarly(channel, payload)
      return
    }
    for (const sub of subs) {
      try {
        sub.port.postMessage({ channel, payload })
      } catch (err) {
        console.warn(`[broker] failed to publish on ${channel}:`, err)
        subs.delete(sub)
      }
    }
  }

  private addSubscription(channel: string, sub: RendererSubscription): void {
    let set = this.subscriptions.get(channel)
    if (!set) {
      set = new Set()
      this.subscriptions.set(channel, set)
    }
    set.add(sub)

    // Replay any early-buffered messages so the new subscriber sees data
    // that arrived before it subscribed (e.g. the shell prompt).
    const buf = this.earlyBuffers.get(channel)
    if (buf) {
      clearTimeout(buf.timer)
      this.earlyBuffers.delete(channel)
      for (const payload of buf.messages) {
        try {
          sub.port.postMessage({ channel, payload })
        } catch {
          // subscriber already gone — nothing to do
        }
      }
    }
  }

  private removeSubscription(channel: string, port: MessagePortMain): void {
    const set = this.subscriptions.get(channel)
    if (!set) return
    for (const sub of set) {
      if (sub.port === port) set.delete(sub)
    }
    if (set.size === 0) this.subscriptions.delete(channel)
  }

  private removeAllForPort(port: MessagePortMain): void {
    for (const [channel, set] of this.subscriptions) {
      for (const sub of set) {
        if (sub.port === port) set.delete(sub)
      }
      if (set.size === 0) this.subscriptions.delete(channel)
    }
  }

  /**
   * Buffer a message on a channel that has no subscribers yet. The buffer is
   * capped and auto-expires so it doesn't leak if no subscriber ever appears.
   */
  private bufferEarly(channel: string, payload: unknown): void {
    let buf = this.earlyBuffers.get(channel)
    if (!buf) {
      const timer = setTimeout(() => {
        this.earlyBuffers.delete(channel)
      }, EARLY_BUFFER_TTL_MS)
      buf = { messages: [], timer }
      this.earlyBuffers.set(channel, buf)
    }
    if (buf.messages.length < EARLY_BUFFER_MAX) {
      buf.messages.push(payload)
    }
  }
}

export const streamBroker = new StreamBroker()
