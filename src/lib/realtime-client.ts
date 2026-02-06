/**
 * Realtime Client - Typed EventSource wrapper
 *
 * Manages an SSE connection to /api/events/stream with
 * automatic reconnection, Last-Event-ID replay, and typed events.
 */

export type RealtimeEventType =
  | 'machines:snapshot'
  | 'task:result'
  | 'task:stdout'
  | 'task:progress'
  | 'task:steer_ack'
  | 'task:tool_trace'
  | 'task:file_change'
  | 'machine:connected'
  | 'machine:disconnected'
  | 'session:attached'
  | 'session:detached'
  | 'session:event'
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
    this.url = baseUrl
  }

  get connected(): boolean {
    return this._connected
  }

  connect(projectId?: string): void {
    if (this.eventSource) {
      this.disconnect()
    }

    const url = projectId ? `${this.url}?projectId=${projectId}` : this.url
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
      'task:progress',
      'task:steer_ack',
      'task:tool_trace',
      'task:file_change',
      'machine:connected',
      'machine:disconnected',
      'session:attached',
      'session:detached',
      'session:event',
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
