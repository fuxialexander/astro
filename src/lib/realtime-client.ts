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
  | 'task:result'
  | 'task:stdout'
  | 'task:text'
  | 'task:progress'
  | 'task:steer_ack'
  | 'task:tool_trace'
  | 'task:file_change'
  | 'task:session_init'
  | 'task:approval_request'
  | 'task:safety_prompt'
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
  private url: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private lastProjectId?: string

  constructor(baseUrl = '/api/events/stream') {
    this.url = apiUrl(baseUrl)
  }

  get connected(): boolean {
    return this._connected
  }

  async connect(projectId?: string): Promise<void> {
    if (this.eventSource) {
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

    const url = params.toString() ? `${this.url}?${params}` : this.url
    this.eventSource = new EventSource(url)

    this.eventSource.onopen = () => {
      this._connected = true
      this.emit({ type: 'heartbeat' as RealtimeEventType, data: { connected: true } })
    }

    this.eventSource.onerror = () => {
      this._connected = false
      // Close stale connection and reconnect with a fresh token
      this.disconnect()
      this.scheduleReconnect(3000)
    }

    // Register known event types
    const eventTypes: RealtimeEventType[] = [
      'machines:snapshot',
      'task:result',
      'task:stdout',
      'task:text',
      'task:progress',
      'task:steer_ack',
      'task:tool_trace',
      'task:file_change',
      'task:session_init',
      'task:approval_request',
      'task:safety_prompt',
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
      'heartbeat',
    ]

    for (const type of eventTypes) {
      this.eventSource.addEventListener(type, (e: MessageEvent) => {
        let data: unknown
        try {
          data = e.data ? JSON.parse(e.data) : {}
        } catch {
          data = e.data
        }

        const event: RealtimeEvent = {
          type,
          data,
          id: (e as MessageEvent & { lastEventId?: string }).lastEventId,
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
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this._connected = false
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
