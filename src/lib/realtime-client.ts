/**
 * Realtime Client - Typed EventSource wrapper
 *
 * Manages an SSE connection to /api/events/stream with
 * automatic reconnection, Last-Event-ID replay, and typed events.
 */

import { getAccessToken } from './supabase-client'
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
  | 'machine:connected'
  | 'machine:disconnected'
  | 'session:attached'
  | 'session:detached'
  | 'session:event'
  | 'approval:requested'
  | 'approval:responded'
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

    // Get auth token for SSE connection (EventSource doesn't support headers)
    const token = await getAccessToken()
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
      // EventSource handles reconnection automatically
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
      'machine:connected',
      'machine:disconnected',
      'session:attached',
      'session:detached',
      'session:event',
      'approval:requested',
      'approval:responded',
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
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this._connected = false
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
