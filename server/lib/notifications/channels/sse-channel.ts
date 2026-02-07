/**
 * SSE Notification Channel
 *
 * Broadcasts notifications to connected browser clients via Server-Sent Events.
 * Manages multiple SSE connections and handles connection lifecycle.
 */

import type {
  NotificationChannel,
  NotificationEvent,
  ChannelStatus,
  ChannelStats,
} from '../types.js'
import { eventBuffer } from '../../event-buffer.js'

// ============================================================================
// SSE Connection Management
// ============================================================================

export interface SSEConnection {
  id: string
  userId?: string
  projectId?: string
  write: (event: string, data: string, id?: string) => void
  close: () => void
  onClose: (callback: () => void) => void
}

// ============================================================================
// SSE Channel Implementation
// ============================================================================

export class SSEChannel implements NotificationChannel {
  readonly id = 'sse'
  readonly name = 'Server-Sent Events'

  private connections: Map<string, SSEConnection> = new Map()
  private _status: ChannelStatus = 'inactive'
  private _stats: ChannelStats = {
    eventsSent: 0,
    eventsDropped: 0,
    errors: 0,
  }

  get status(): ChannelStatus {
    return this._status
  }

  get stats(): ChannelStats {
    return { ...this._stats }
  }

  /**
   * Register a new SSE connection
   */
  addConnection(connection: SSEConnection): void {
    this.connections.set(connection.id, connection)

    connection.onClose(() => {
      this.connections.delete(connection.id)
      console.log(`[SSEChannel] Connection closed: ${connection.id}`)
    })

    console.log(`[SSEChannel] Connection added: ${connection.id} (total: ${this.connections.size})`)
  }

  /**
   * Remove an SSE connection
   */
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId)
    if (connection) {
      connection.close()
      this.connections.delete(connectionId)
    }
  }

  /**
   * Get number of active connections
   */
  getConnectionCount(): number {
    return this.connections.size
  }

  /**
   * Check if channel accepts this event
   * SSE accepts all events for connected browsers
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  accepts(_event: NotificationEvent): boolean {
    // Only process if we have connections
    if (this.connections.size === 0) {
      return false
    }

    // SSE handles all event types
    return true
  }

  /**
   * Send notification to all connected SSE clients
   */
  async send(event: NotificationEvent): Promise<void> {
    if (this.connections.size === 0) {
      this._stats.eventsDropped++
      return
    }

    const sseEventType = event.type
    const data = JSON.stringify(event.data)

    // Add to event buffer for reconnection replay
    const eventId = eventBuffer.push(sseEventType, data)

    // Broadcast to all matching connections
    let sentCount = 0
    const deadConnections: string[] = []

    for (const [id, connection] of this.connections) {
      // Filter by project if specified
      if (event.projectId && connection.projectId && connection.projectId !== event.projectId) {
        continue
      }

      // Filter by user if specified
      if (event.userId && connection.userId && connection.userId !== event.userId) {
        continue
      }

      try {
        connection.write(sseEventType, data, eventId)
        sentCount++
      } catch (error) {
        console.error(`[SSEChannel] Failed to write to connection ${id}:`, error)
        deadConnections.push(id)
        this._stats.errors++
      }
    }

    // Clean up dead connections
    for (const id of deadConnections) {
      this.connections.delete(id)
    }

    this._stats.eventsSent += sentCount
    this._stats.lastEventAt = new Date()
  }

  /**
   * Start the SSE channel
   */
  async start(): Promise<void> {
    this._status = 'active'
    console.log('[SSEChannel] Started')
  }

  /**
   * Stop the SSE channel
   */
  async stop(): Promise<void> {
    // Close all connections
    for (const [id, connection] of this.connections) {
      try {
        connection.close()
      } catch (error) {
        console.error(`[SSEChannel] Failed to close connection ${id}:`, error)
      }
    }
    this.connections.clear()
    this._status = 'inactive'
    console.log('[SSEChannel] Stopped')
  }
}

// Singleton instance
export const sseChannel = new SSEChannel()
