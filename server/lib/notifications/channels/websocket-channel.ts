/**
 * WebSocket Notification Channel
 *
 * Broadcasts notifications to connected native app clients via WebSocket.
 * Better suited for iOS/macOS/Android apps than SSE.
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage, Server } from 'http'
import jwt from 'jsonwebtoken'
import type {
  NotificationChannel,
  NotificationEvent,
  ChannelStatus,
  ChannelStats,
} from '../types.js'

// ============================================================================
// WebSocket Client Management
// ============================================================================

interface WSClient {
  id: string
  ws: WebSocket
  userId?: string
  projectIds?: string[]
  platform?: string  // ios, macos, android, web
  connectedAt: Date
  lastPingAt: Date
}

interface WSAuthPayload {
  userId: string
  platform?: string
  projectIds?: string[]
}

// ============================================================================
// WebSocket Channel Configuration
// ============================================================================

export interface WebSocketChannelConfig {
  /** Port for WebSocket server (if standalone) */
  port?: number
  /** HTTP server to attach to (alternative to port) */
  server?: Server
  /** Path for WebSocket endpoint */
  path?: string
  /** JWT secret for authentication */
  jwtSecret?: string
  /** Heartbeat interval in ms */
  heartbeatInterval?: number
  /** Connection timeout in ms */
  connectionTimeout?: number
}

const DEFAULT_CONFIG: Required<Omit<WebSocketChannelConfig, 'server' | 'jwtSecret'>> = {
  port: 3003,
  path: '/api/notifications/ws',
  heartbeatInterval: 30000,
  connectionTimeout: 90000,
}

// ============================================================================
// WebSocket Channel Implementation
// ============================================================================

export class WebSocketChannel implements NotificationChannel {
  readonly id = 'websocket'
  readonly name = 'WebSocket'

  private config: WebSocketChannelConfig
  private wss?: WebSocketServer
  private clients: Map<string, WSClient> = new Map()
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private _status: ChannelStatus = 'inactive'
  private _stats: ChannelStats = {
    eventsSent: 0,
    eventsDropped: 0,
    errors: 0,
  }

  constructor(config: WebSocketChannelConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  get status(): ChannelStatus {
    return this._status
  }

  get stats(): ChannelStats {
    return { ...this._stats }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size
  }

  /**
   * Get clients by platform
   */
  getClientsByPlatform(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const client of this.clients.values()) {
      const platform = client.platform || 'unknown'
      counts[platform] = (counts[platform] || 0) + 1
    }
    return counts
  }

  /**
   * Check if channel accepts this event
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  accepts(_event: NotificationEvent): boolean {
    // Only process if we have clients
    if (this.clients.size === 0) {
      return false
    }

    // WebSocket handles all event types
    return true
  }

  /**
   * Send notification to matching WebSocket clients
   */
  async send(event: NotificationEvent): Promise<void> {
    if (this.clients.size === 0) {
      this._stats.eventsDropped++
      return
    }

    const message = JSON.stringify({
      type: event.type,
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      priority: event.priority,
      data: event.data,
    })

    let sentCount = 0
    const deadClients: string[] = []

    for (const [id, client] of this.clients) {
      // Filter by user if specified
      if (event.userId && client.userId && client.userId !== event.userId) {
        continue
      }

      // Filter by project if specified
      if (event.projectId && client.projectIds && client.projectIds.length > 0) {
        if (!client.projectIds.includes(event.projectId)) {
          continue
        }
      }

      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(message)
          sentCount++
        } else {
          deadClients.push(id)
        }
      } catch (error) {
        console.error(`[WebSocketChannel] Failed to send to client ${id}:`, error)
        deadClients.push(id)
        this._stats.errors++
      }
    }

    // Clean up dead clients
    for (const id of deadClients) {
      this.removeClient(id)
    }

    this._stats.eventsSent += sentCount
    this._stats.lastEventAt = new Date()
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    if (this.wss) {
      console.warn('[WebSocketChannel] Already started')
      return
    }

    // Create WebSocket server
    if (this.config.server) {
      this.wss = new WebSocketServer({
        server: this.config.server,
        path: this.config.path,
      })
    } else {
      this.wss = new WebSocketServer({
        port: this.config.port,
        path: this.config.path,
      })
    }

    // Handle new connections
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req)
    })

    // Start heartbeat timer
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeats()
    }, this.config.heartbeatInterval || DEFAULT_CONFIG.heartbeatInterval)

    this._status = 'active'
    console.log(`[WebSocketChannel] Started on ${this.config.server ? 'attached server' : `port ${this.config.port}`}`)
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    // Stop heartbeat timer
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      try {
        client.ws.close(1001, 'Server shutting down')
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear()

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve())
      })
      this.wss = undefined
    }

    this._status = 'inactive'
    console.log('[WebSocketChannel] Stopped')
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = this.generateClientId()

    // Parse auth from query params or headers
    const auth = this.parseAuth(req)

    const client: WSClient = {
      id: clientId,
      ws,
      userId: auth?.userId,
      projectIds: auth?.projectIds,
      platform: auth?.platform,
      connectedAt: new Date(),
      lastPingAt: new Date(),
    }

    this.clients.set(clientId, client)

    console.log(`[WebSocketChannel] Client connected: ${clientId} (platform: ${client.platform || 'unknown'}, total: ${this.clients.size})`)

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      timestamp: new Date().toISOString(),
    }))

    // Handle messages from client
    ws.on('message', (data: Buffer) => {
      this.handleMessage(client, data)
    })

    // Handle close
    ws.on('close', () => {
      this.removeClient(clientId)
    })

    // Handle errors
    ws.on('error', (error) => {
      console.error(`[WebSocketChannel] Client error ${clientId}:`, error)
      this._stats.errors++
      this.removeClient(clientId)
    })
  }

  /**
   * Handle message from client
   */
  private handleMessage(client: WSClient, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString())

      switch (message.type) {
        case 'ping':
          client.lastPingAt = new Date()
          client.ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }))
          break

        case 'subscribe':
          // Update project subscriptions
          if (message.projectIds) {
            client.projectIds = message.projectIds
          }
          break

        case 'unsubscribe':
          // Remove project subscriptions
          if (message.projectIds && client.projectIds) {
            client.projectIds = client.projectIds.filter(
              id => !message.projectIds.includes(id)
            )
          }
          break

        default:
          console.log(`[WebSocketChannel] Unknown message type: ${message.type}`)
      }
    } catch (error) {
      console.error('[WebSocketChannel] Failed to parse message:', error)
    }
  }

  /**
   * Parse authentication from request
   */
  private parseAuth(req: IncomingMessage): WSAuthPayload | null {
    // Try Authorization header
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ') && this.config.jwtSecret) {
      try {
        const token = authHeader.slice(7)
        const payload = jwt.verify(token, this.config.jwtSecret) as WSAuthPayload
        return payload
      } catch (error) {
        console.error('[WebSocketChannel] Invalid JWT:', error)
      }
    }

    // Try query params
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const userId = url.searchParams.get('userId')
    const platform = url.searchParams.get('platform')
    const projectIds = url.searchParams.get('projectIds')?.split(',')

    if (userId) {
      return { userId, platform: platform || undefined, projectIds }
    }

    return null
  }

  /**
   * Check heartbeats and remove stale connections
   */
  private checkHeartbeats(): void {
    const now = Date.now()
    const timeout = this.config.connectionTimeout || DEFAULT_CONFIG.connectionTimeout

    for (const [id, client] of this.clients) {
      const elapsed = now - client.lastPingAt.getTime()
      if (elapsed > timeout) {
        console.log(`[WebSocketChannel] Client ${id} timed out`)
        this.removeClient(id)
      }
    }
  }

  /**
   * Remove a client
   */
  private removeClient(clientId: string): void {
    const client = this.clients.get(clientId)
    if (client) {
      try {
        client.ws.close()
      } catch {
        // Ignore close errors
      }
      this.clients.delete(clientId)
      console.log(`[WebSocketChannel] Client disconnected: ${clientId} (total: ${this.clients.size})`)
    }
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }
}

// Factory function for creating WebSocket channel
export function createWebSocketChannel(config?: WebSocketChannelConfig): WebSocketChannel {
  return new WebSocketChannel(config)
}
