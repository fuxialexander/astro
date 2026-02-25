/**
 * SSE stream manager with auto-reconnect.
 * Connects to GET /api/events/stream and dispatches events to stores.
 */
import type { AstroClient } from './client-adapter.js'

export interface SSEEvent {
  type: string
  data: Record<string, unknown>
}

export type SSEEventHandler = (event: SSEEvent) => void

export class SSEClient {
  private client: AstroClient
  private abortController: AbortController | null = null
  private handler: SSEEventHandler
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private _connected = false
  private _stopped = false

  constructor(client: AstroClient, handler: SSEEventHandler) {
    this.client = client
    this.handler = handler
  }

  get connected(): boolean {
    return this._connected
  }

  async start(): Promise<void> {
    this._stopped = false
    this.reconnectDelay = 1000
    await this.connect()
  }

  stop(): void {
    this._stopped = true
    this._connected = false
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  private async connect(): Promise<void> {
    if (this._stopped) return

    try {
      const response = await this.client.streamEvents()
      this._connected = true
      this.reconnectDelay = 1000
      this.handler({ type: '__connected', data: {} })

      if (!response.body) return

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = ''

      while (!this._stopped) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6)
            try {
              const data = JSON.parse(dataStr) as Record<string, unknown>
              this.handler({ type: eventType || 'message', data })
            } catch {
              // Non-JSON data line, treat as text
              this.handler({ type: eventType || 'message', data: { raw: dataStr } })
            }
            eventType = ''
          } else if (line === '') {
            // Empty line = event boundary, reset
            eventType = ''
          }
        }
      }
    } catch (err) {
      this._connected = false
      if (this._stopped) return
      this.handler({
        type: '__disconnected',
        data: { error: err instanceof Error ? err.message : String(err) },
      })
    }

    // Reconnect with exponential backoff
    if (!this._stopped) {
      this._connected = false
      this.handler({ type: '__reconnecting', data: { delay: this.reconnectDelay } })
      await new Promise((r) => setTimeout(r, this.reconnectDelay))
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
      await this.connect()
    }
  }
}
