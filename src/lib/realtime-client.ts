/**
 * Realtime Client - Typed EventSource wrapper
 *
 * Manages an SSE connection to /api/events/stream with
 * automatic reconnection, Last-Event-ID replay, and typed events.
 */

import { getAccessToken, shouldUseSupabase } from './supabase-client'
import { apiUrl } from './api-url'

export type RealtimeEventType =
  | 'machines:snapshot'
  | 'node:status_changed'
  | 'task:init'
  | 'task:result'
  | 'task:stdout'
  | 'task:text'
  | 'task:progress'
  | 'task:steer_ack'
  | 'task:tool_trace'
  | 'task:file_change'
  | 'task:session_init'
  | 'task:approval_request'
  | 'task:approval_auto_responded'
  | 'task:safety_prompt'
  | 'task:safety_auto_proceeded'
  | 'machine:connected'
  | 'machine:disconnected'
  | 'session:attached'
  | 'session:detached'
  | 'session:event'
  | 'approval:requested'
  | 'approval:responded'
  | 'task:ready'
  | 'merge_queue:failed'
  | 'merge_queue:succeeded'
  | 'project:completed'
  | 'heartbeat'

export interface RealtimeEvent {
  type: RealtimeEventType
  data: unknown
  id?: string
}

export type RealtimeEventHandler = (event: RealtimeEvent) => void

export class RealtimeClient {
  private eventSource: EventSource | null = null
  private handlers = new Map<string, Set<RealtimeEventHandler>>()
  private globalHandlers = new Set<RealtimeEventHandler>()
  private _connected = false
  private _wasConnected = false
  private url: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private lastProjectId?: string
  private _lastSeq = 0
  private _onReconnect: (() => void) | null = null
  private _reconnectDelay = 3000 // Start at 3s, exponential backoff
  private _visibilityHandler: (() => void) | null = null
  private _pendingReconnect = false // True if reconnect was deferred due to hidden tab

  // Heartbeat monitoring: detect zombie SSE connections (TCP alive but no data)
  private _lastEventAt = 0
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null
  /** Server sends heartbeat every 15s; timeout at 3× to tolerate transient delays */
  private static readonly HEARTBEAT_TIMEOUT_MS = 45_000
  private static readonly HEARTBEAT_CHECK_INTERVAL_MS = 10_000

  constructor(baseUrl = '/api/events/stream') {
    this.url = apiUrl(baseUrl)
    // Listen for visibility changes to pause/resume reconnection
    if (typeof document !== 'undefined') {
      this._visibilityHandler = () => {
        if (document.visibilityState === 'visible' && this._pendingReconnect) {
          this._pendingReconnect = false
          this.scheduleReconnect(1000) // Resume quickly when tab becomes visible
        }
      }
      document.addEventListener('visibilitychange', this._visibilityHandler)
    }
  }

  get connected(): boolean {
    return this._connected
  }

  /** Highest sequence number seen from streaming events (for catch-up) */
  get lastSeq(): number {
    return this._lastSeq
  }

  /** Update lastSeq (e.g. after catch-up hydration fills the gap) */
  set lastSeq(value: number) {
    if (value > this._lastSeq) {
      this._lastSeq = value
    }
  }

  async connect(projectId?: string): Promise<void> {
    if (this.eventSource) {
      // Intentional reconnect (e.g. project switch) — reset _wasConnected
      // so onReconnect doesn't fire spuriously on the new connection.
      // Auto-reconnect (via onerror → scheduleReconnect → connect) won't
      // enter this branch because disconnect() already set eventSource = null.
      this._wasConnected = false
      this.disconnect()
    }
    this.lastProjectId = projectId

    // Get auth token for SSE connection (EventSource doesn't support headers)
    const token = await getAccessToken()

    // In server mode, don't connect without a token — retry until auth is ready
    if (!token && shouldUseSupabase()) {
      this.scheduleReconnect(2000)
      return
    }

    const params = new URLSearchParams()
    if (projectId) params.set('projectId', projectId)
    if (token) params.set('token', token)
    // Include lastSeq on reconnect so the server can do DB-backed catch-up
    if (this._lastSeq > 0) params.set('lastSeq', String(this._lastSeq))

    const url = params.toString() ? `${this.url}?${params}` : this.url
    this.eventSource = new EventSource(url)

    this.eventSource.onopen = () => {
      const wasReconnect = this._wasConnected
      this._connected = true
      this._wasConnected = true
      this._reconnectDelay = 3000 // Reset backoff on successful connection
      this.emit({ type: 'heartbeat' as RealtimeEventType, data: { connected: true } })
      // Fire reconnect callback so the store can trigger catch-up hydration
      if (wasReconnect && this._onReconnect) {
        this._onReconnect()
      }
      // Start heartbeat monitoring for zombie SSE detection
      this.startHeartbeatMonitor()
    }

    this.eventSource.onerror = () => {
      this._connected = false
      // Close stale connection and reconnect with backoff
      this.disconnect()
      // Pause reconnection when tab is hidden to avoid hammering server
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        this._pendingReconnect = true
        return
      }
      this.scheduleReconnect(this._reconnectDelay)
      // Exponential backoff: 3s → 6s → 12s → 24s → 48s → 60s (cap)
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 60000)
    }

    // Handle graceful server-initiated close (e.g. max-lifetime timer).
    // The server sends 'server-close' then terminates the stream. We do a
    // clean reconnect immediately (no backoff increment) since this is not a
    // network error.
    this.eventSource.addEventListener('server-close', () => {
      this._lastEventAt = Date.now()
      this.disconnect()
      this.scheduleReconnect(0)
      // Do not increment _reconnectDelay — this is a planned server close.
    })

    // Register known event types
    const eventTypes: RealtimeEventType[] = [
      'machines:snapshot',
      'node:status_changed',
      'task:init',
      'task:result',
      'task:stdout',
      'task:text',
      'task:progress',
      'task:steer_ack',
      'task:tool_trace',
      'task:file_change',
      'task:session_init',
      'task:approval_request',
      'task:approval_auto_responded',
      'task:safety_prompt',
      'task:safety_auto_proceeded',
      'machine:connected',
      'machine:disconnected',
      'session:attached',
      'session:detached',
      'session:event',
      'approval:requested',
      'approval:responded',
      'task:ready',
      'merge_queue:failed',
      'merge_queue:succeeded',
      'project:completed',
      'heartbeat',
    ]

    for (const type of eventTypes) {
      this.eventSource.addEventListener(type, (e: MessageEvent) => {
        // Track last event time for heartbeat monitoring
        this._lastEventAt = Date.now()

        let data: unknown
        try {
          data = e.data ? JSON.parse(e.data) : {}
        } catch {
          data = e.data
        }

        const eventId = (e as MessageEvent & { lastEventId?: string }).lastEventId
        // Track highest seq for catch-up on reconnect
        if (eventId) {
          const seq = parseInt(eventId, 10)
          if (!isNaN(seq) && seq > this._lastSeq) {
            this._lastSeq = seq
          }
        }

        const event: RealtimeEvent = {
          type,
          data,
          id: eventId,
        }

        this.emit(event)
      })
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this._connected = false
    this._pendingReconnect = false
  }

  /**
   * Start heartbeat monitoring. If no event is received within HEARTBEAT_TIMEOUT_MS,
   * force-disconnect and schedule a fast reconnect. This detects zombie SSE connections
   * that browser EventSource's built-in reconnection misses (TCP alive but no data).
   */
  private startHeartbeatMonitor(): void {
    this._lastEventAt = Date.now()
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer)
    this._heartbeatTimer = setInterval(() => {
      if (!this._connected) return
      // Don't monitor when tab is hidden — no events expected
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const elapsed = Date.now() - this._lastEventAt
      if (elapsed > RealtimeClient.HEARTBEAT_TIMEOUT_MS) {
        console.warn(`[realtime] Heartbeat timeout (${Math.round(elapsed / 1000)}s without events), forcing reconnect`)
        this.disconnect()
        this.scheduleReconnect(1000) // Fast reconnect on heartbeat timeout
      }
    }, RealtimeClient.HEARTBEAT_CHECK_INTERVAL_MS)
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer) return // already scheduled
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect(this.lastProjectId)
    }, delayMs)
  }

  on(type: RealtimeEventType | '*', handler: RealtimeEventHandler): () => void {
    if (type === '*') {
      this.globalHandlers.add(handler)
      return () => this.globalHandlers.delete(handler)
    }

    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  off(type: RealtimeEventType | '*', handler: RealtimeEventHandler): void {
    if (type === '*') {
      this.globalHandlers.delete(handler)
    } else {
      this.handlers.get(type)?.delete(handler)
    }
  }

  /** Register a callback that fires on successful reconnection (not initial connect) */
  set onReconnect(cb: (() => void) | null) {
    this._onReconnect = cb
  }

  private emit(event: RealtimeEvent): void {
    // Type-specific handlers
    const typeHandlers = this.handlers.get(event.type)
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        handler(event)
      }
    }

    // Global handlers
    for (const handler of this.globalHandlers) {
      handler(event)
    }
  }
}

// Singleton
export const realtimeClient = new RealtimeClient()
