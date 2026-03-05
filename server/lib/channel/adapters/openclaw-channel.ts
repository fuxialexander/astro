/**
 * OpenClaw Channel Adapter
 *
 * Routes notifications and approval requests from Astro to users'
 * preferred messaging channels via the OpenClaw gateway WebSocket.
 *
 * Uses the OpenClaw gateway protocol v3:
 *   - Frames: event ({ type: "event" }), request ({ type: "req" }), response ({ type: "res" })
 *   - Connection: challenge-response handshake (gateway sends connect.challenge → client sends connect)
 *   - Auth: gateway token + optional Ed25519 device auth
 *
 * Outbound flow:
 *   Astro event → format message → WebSocket request → OpenClaw gateway → user channel
 *
 * Approval flow:
 *   Agent emits `ask_user_question` → adapter sends approval request via gateway
 *   User responds in their messaging channel → gateway relays response back via WebSocket
 *   Adapter resolves the pending approval promise → execution continues
 */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type {
  ChannelNotification,
  OutboundResponse,
  InboundMessage,
  OpenClawChannelConfig,
} from '../channel-types.js'
import { formatForChannel } from '../channel-formatter.js'
import { channelRouter } from '../channel-router.js'
import { channelConfigManager } from '../channel-config-manager.js'

// ---------------------------------------------------------------------------
// Types — OpenClaw Gateway Protocol v3
// ---------------------------------------------------------------------------

/** Event frame pushed by the gateway (server → client) */
export interface OpenClawEventFrame {
  type: 'event'
  event: string
  payload: Record<string, unknown>
  seq?: number
}

/** Request frame sent by the client (client → server) */
export interface OpenClawRequestFrame {
  type: 'req'
  id: string
  method: string
  params: Record<string, unknown>
}

/** Response frame from the gateway (server → client) */
export interface OpenClawResponseFrame {
  type: 'res'
  id: string
  ok: boolean
  payload?: Record<string, unknown>
  error?: { code: number; message: string; data?: unknown }
}

/** Any frame received over the WebSocket */
export type OpenClawFrame = OpenClawEventFrame | OpenClawResponseFrame

/** Pending approval waiting for user response */
interface PendingApproval {
  resolve: (response: string) => void
  reject: (err: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

/** Pending request waiting for gateway response */
interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

/** Minimal WebSocket interface for testability (matches ws and native WebSocket) */
export interface IWebSocket {
  readyState: number
  send(data: string): void
  close(): void
  on(event: string, listener: (...args: unknown[]) => void): void
  off(event: string, listener: (...args: unknown[]) => void): void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECONNECT_DELAY_MS = 5_000
const APPROVAL_TIMEOUT_MS = 300_000 // 5 minutes
const REQUEST_TIMEOUT_MS = 15_000
const CONNECT_CHALLENGE_TIMEOUT_MS = 5_000
const WS_READY_STATE_OPEN = 1
const PROTOCOL_VERSION = 3

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenClawChannelAdapter extends EventEmitter {
  private ws: IWebSocket | null = null
  private config: OpenClawChannelConfig | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private challengeTimer: ReturnType<typeof setTimeout> | null = null
  private pendingApprovals = new Map<string, PendingApproval>()
  private pendingRequests = new Map<string, PendingRequest>()
  private _started = false
  private _authenticated = false

  /** Injected WebSocket factory for testability */
  private createWebSocket: ((url: string) => IWebSocket) | null = null

  constructor(opts?: { createWebSocket?: (url: string) => IWebSocket }) {
    super()
    if (opts?.createWebSocket) {
      this.createWebSocket = opts.createWebSocket
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._started) return

    const configs = await channelConfigManager.getConfigsForChannel('openclaw')
    if (configs.length === 0) {
      console.log('[openclaw] No OpenClaw config found, adapter not started')
      return
    }

    const cfg = configs[0]
    this.config = {
      gatewayUrl: cfg.credentials.gatewayUrl as string,
      apiKey: cfg.credentials.apiKey as string,
      channelMappings: cfg.mappings,
    }

    this._started = true
    this.connect()

    // Register senders for each mapped project
    for (const [, projectId] of Object.entries(this.config.channelMappings)) {
      channelRouter.registerNotificationSender(projectId, 'openclaw', (n) => this.sendNotification(n))
    }

    channelRouter.registerResponseSender('openclaw', (r) => this.sendResponse(r))

    // Route inbound chat messages to the channel router
    this.on('inbound', async (payload: Record<string, unknown>) => {
      const projectId = this.resolveProjectId(payload.channelId as string | undefined)
      if (!projectId) return

      const message: InboundMessage = {
        sourceMessageId: (payload.messageId as string) ?? String(Date.now()),
        channel: 'openclaw',
        text: (payload.text as string) ?? '',
        sender: {
          id: (payload.senderId as string) ?? 'unknown',
          name: (payload.senderName as string) ?? 'unknown',
        },
        conversationRef: {
          channelId: (payload.channelId as string) ?? '',
          threadId: payload.threadId as string | undefined,
          metadata: payload.metadata as Record<string, unknown> | undefined,
        },
        projectId,
      }

      try {
        const response = await channelRouter.routeMessage(message)
        await this.sendResponse(response)
      } catch (err) {
        console.error('[openclaw] Failed to route inbound message:', err)
      }
    })

    // Route approval responses to the dispatch engine
    this.on('approval-response', async ({ approvalId, response }: { approvalId: string; response: string }) => {
      try {
        const { dispatchEngine } = await import('../../dispatch/index.js')
        const approved = response.toLowerCase() === 'yes' || response.toLowerCase() === 'approve'
        await dispatchEngine.respondToApproval(approvalId, approved, response)
      } catch {
        // Approval may not exist in dispatch engine (e.g., already resolved)
      }
    })

    console.log(`[openclaw] Adapter started, gateway=${this.config.gatewayUrl}`)
  }

  stop(): void {
    this._started = false
    this._authenticated = false

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer)
      this.challengeTimer = null
    }

    // Reject all pending approvals
    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error('OpenClaw adapter stopped'))
      this.pendingApprovals.delete(id)
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error('OpenClaw adapter stopped'))
      this.pendingRequests.delete(id)
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WS_READY_STATE_OPEN && this._authenticated
  }

  // ─── WebSocket Connection ──────────────────────────────────────

  private connect(): void {
    if (!this.config) return

    try {
      if (this.createWebSocket) {
        this.ws = this.createWebSocket(this.config.gatewayUrl)
      } else {
        const esmRequire = createRequire(import.meta.url)
        const WebSocket = esmRequire('ws') as typeof import('ws').default
        this.ws = new WebSocket(this.config.gatewayUrl) as unknown as IWebSocket
      }

      this.ws.on('open', () => this.onOpen())
      this.ws.on('message', (data: unknown) => this.onMessage(data))
      this.ws.on('close', () => this.onClose())
      this.ws.on('error', (err: unknown) => this.onError(err))
    } catch (err) {
      console.error('[openclaw] Failed to create WebSocket connection:', err)
      this.scheduleReconnect()
    }
  }

  private onOpen(): void {
    console.log('[openclaw] WebSocket open, waiting for challenge...')

    // Start timeout for the connect challenge
    this.challengeTimer = setTimeout(() => {
      console.error('[openclaw] Connect challenge timeout')
      this.ws?.close()
    }, CONNECT_CHALLENGE_TIMEOUT_MS)
  }

  private onMessage(data: unknown): void {
    let frame: OpenClawFrame | OpenClawEventFrame

    try {
      const raw = typeof data === 'string' ? data : String(data)
      frame = JSON.parse(raw)
    } catch {
      console.warn('[openclaw] Received non-JSON message, ignoring')
      return
    }

    // Event frames: { type: "event", event: "...", payload: {...} }
    if (frame.type === 'event') {
      this.handleEventFrame(frame as OpenClawEventFrame)
      return
    }

    // Response frames: { type: "res", id: "...", ok: true/false, ... }
    if (frame.type === 'res') {
      this.handleResponseFrame(frame as OpenClawResponseFrame)
      return
    }
  }

  private onClose(): void {
    console.log('[openclaw] Disconnected from gateway')
    this.ws = null
    this._authenticated = false

    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer)
      this.challengeTimer = null
    }

    this.emit('disconnected')
    if (this._started) {
      this.scheduleReconnect()
    }
  }

  private onError(err: unknown): void {
    console.error('[openclaw] WebSocket error:', err)
    this.emit('error', err)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    console.log(`[openclaw] Reconnecting in ${RECONNECT_DELAY_MS}ms...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this._started) {
        this.connect()
      }
    }, RECONNECT_DELAY_MS)
  }

  // ─── Challenge-Response Handshake ─────────────────────────────

  private handleEventFrame(frame: OpenClawEventFrame): void {
    if (frame.event === 'connect.challenge') {
      this.handleConnectChallenge(frame.payload)
      return
    }

    // Dispatch application-level events
    this.handleGatewayEvent(frame)
  }

  private handleConnectChallenge(payload: Record<string, unknown>): void {
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer)
      this.challengeTimer = null
    }

    const nonce = payload.nonce as string | undefined
    if (!nonce) {
      console.error('[openclaw] Connect challenge missing nonce')
      this.ws?.close()
      return
    }

    this.sendConnectRequest()
  }

  private sendConnectRequest(): void {
    if (!this.ws || !this.config) return

    const connectReq: OpenClawRequestFrame = {
      type: 'req',
      id: 'connect-1',
      method: 'connect',
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: 'gateway-client',
          version: 'dev',
          platform: process.platform,
          mode: 'backend',
        },
        caps: [],
        auth: {
          token: this.config.apiKey,
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
      },
    }

    this.ws.send(JSON.stringify(connectReq))

    // Register a handler for the connect response
    const timeoutId = setTimeout(() => {
      this.pendingRequests.delete('connect-1')
      console.error('[openclaw] Connect request timed out')
      this.ws?.close()
    }, REQUEST_TIMEOUT_MS)

    this.pendingRequests.set('connect-1', {
      resolve: () => {
        this._authenticated = true
        console.log('[openclaw] Connected to gateway')
        this.emit('connected')
      },
      reject: (err: Error) => {
        console.error('[openclaw] Connect failed:', err.message)
        this.ws?.close()
      },
      timeoutId,
    })
  }

  // ─── Request/Response Communication ───────────────────────────

  /**
   * Send a request to the gateway and wait for the response.
   */
  sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WS_READY_STATE_OPEN) {
        reject(new Error('OpenClaw gateway not connected'))
        return
      }

      const id = randomUUID()

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request ${method} timed out after ${REQUEST_TIMEOUT_MS}ms`))
      }, REQUEST_TIMEOUT_MS)

      this.pendingRequests.set(id, { resolve, reject, timeoutId })

      const request: OpenClawRequestFrame = {
        type: 'req',
        id,
        method,
        params,
      }

      this.ws.send(JSON.stringify(request))
    })
  }

  private handleResponseFrame(frame: OpenClawResponseFrame): void {
    const pending = this.pendingRequests.get(frame.id)
    if (!pending) return

    clearTimeout(pending.timeoutId)
    this.pendingRequests.delete(frame.id)

    if (frame.ok) {
      pending.resolve(frame.payload)
    } else {
      const errMsg = frame.error?.message ?? 'unknown error'
      const errCode = frame.error?.code ?? -1
      pending.reject(new Error(`Request error ${errCode}: ${errMsg}`))
    }
  }

  private handleGatewayEvent(frame: OpenClawEventFrame): void {
    switch (frame.event) {
      case 'approval.response': {
        const approvalId = frame.payload.approvalId as string | undefined
        const response = frame.payload.response as string | undefined
        if (approvalId && response) {
          // Route to local pending approval (if this adapter sent it)
          this.resolveApproval(approvalId, response)
          // Also route to dispatch engine for channel-notification-originated approvals
          this.emit('approval-response', { approvalId, response })
        }
        break
      }
      case 'message.inbound': {
        this.emit('inbound', frame.payload)
        break
      }
      default:
        this.emit('gateway-event', frame)
    }
  }

  // ─── Outbound Notifications ────────────────────────────────────

  async sendNotification(notification: ChannelNotification): Promise<void> {
    const formatted = formatForChannel(notification.summary, 'openclaw')
    const message = this.buildNotificationMessage(notification, formatted)

    await this.sendRequest('message.send', {
      projectId: notification.projectId,
      type: notification.type,
      text: message,
      metadata: {
        astroUrl: notification.astroUrl,
        notificationType: notification.type,
        ...notification.metadata,
      },
    })
  }

  async sendResponse(response: OutboundResponse): Promise<void> {
    const formatted = formatForChannel(response.text, 'openclaw')

    await this.sendRequest('message.send', {
      channelId: response.conversationRef.channelId,
      threadId: response.conversationRef.threadId,
      text: formatted,
      metadata: response.conversationRef.metadata,
    })
  }

  // ─── Approval Routing ──────────────────────────────────────────

  async requestApproval(opts: {
    approvalId: string
    projectId: string
    taskId: string
    question: string
    options?: string[]
  }): Promise<string> {
    const formatted = formatForChannel(opts.question, 'openclaw')

    await this.sendRequest('approval.request', {
      approvalId: opts.approvalId,
      projectId: opts.projectId,
      taskId: opts.taskId,
      question: formatted,
      options: opts.options ?? [],
    })

    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingApprovals.delete(opts.approvalId)
        reject(new Error(`Approval ${opts.approvalId} timed out after ${APPROVAL_TIMEOUT_MS}ms`))
      }, APPROVAL_TIMEOUT_MS)

      this.pendingApprovals.set(opts.approvalId, { resolve, reject, timeoutId })
    })
  }

  private resolveApproval(approvalId: string, response: string): void {
    const pending = this.pendingApprovals.get(approvalId)
    if (!pending) {
      console.warn(`[openclaw] Received approval response for unknown ID: ${approvalId}`)
      return
    }

    clearTimeout(pending.timeoutId)
    this.pendingApprovals.delete(approvalId)
    pending.resolve(response)
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private resolveProjectId(channelId: string | undefined): string | null {
    if (!channelId || !this.config?.channelMappings) return null
    return this.config.channelMappings[channelId] ?? null
  }

  // ─── Message Formatting ────────────────────────────────────────

  private buildNotificationMessage(
    notification: ChannelNotification,
    formattedSummary: string
  ): string {
    const prefix = this.getNotificationPrefix(notification.type)
    return `${prefix} ${formattedSummary}\n\n${notification.astroUrl}`
  }

  private getNotificationPrefix(type: ChannelNotification['type']): string {
    switch (type) {
      case 'task.completed':
        return '[Completed]'
      case 'task.failed':
        return '[Failed]'
      case 'approval.requested':
        return '[Approval Needed]'
      case 'branch.pruned':
        return '[Pruned]'
      default:
        return '[Astro]'
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const openClawChannel = new OpenClawChannelAdapter()
