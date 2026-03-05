/**
 * OpenClaw Channel Adapter
 *
 * Routes notifications and approval requests from Astro to users'
 * preferred messaging channels via the OpenClaw gateway WebSocket.
 *
 * Outbound flow:
 *   Astro event → format message → WebSocket `message.send` RPC → OpenClaw gateway → user channel
 *
 * Approval flow:
 *   Agent emits `ask_user_question` → adapter sends approval request via gateway
 *   User responds in their messaging channel → gateway relays response back via WebSocket
 *   Adapter resolves the pending approval promise → execution continues
 */

import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import type {
  ChannelNotification,
  OutboundResponse,
  OpenClawChannelConfig,
} from '../channel-types.js'
import { formatForChannel } from '../channel-formatter.js'
import { channelRouter } from '../channel-router.js'
import { channelConfigManager } from '../channel-config-manager.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** JSON-RPC 2.0 request sent over WebSocket to the gateway */
export interface OpenClawRpcRequest {
  jsonrpc: '2.0'
  id: string
  method: string
  params: Record<string, unknown>
}

/** JSON-RPC 2.0 response received from the gateway */
export interface OpenClawRpcResponse {
  jsonrpc: '2.0'
  id: string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** Inbound message pushed by the gateway (server → client notification) */
export interface OpenClawGatewayEvent {
  jsonrpc: '2.0'
  method: string
  params: Record<string, unknown>
}

/** Pending approval waiting for user response */
interface PendingApproval {
  resolve: (response: string) => void
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
const RPC_TIMEOUT_MS = 15_000
const WS_READY_STATE_OPEN = 1

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenClawChannelAdapter extends EventEmitter {
  private ws: IWebSocket | null = null
  private config: OpenClawChannelConfig | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pendingApprovals = new Map<string, PendingApproval>()
  private pendingRpc = new Map<string, {
    resolve: (value: unknown) => void
    reject: (err: Error) => void
    timeoutId: ReturnType<typeof setTimeout>
  }>()
  private rpcCounter = 0
  private _started = false

  /** Injected WebSocket factory for testability */
  private createWebSocket: ((url: string) => IWebSocket) | null = null

  constructor(opts?: { createWebSocket?: (url: string) => IWebSocket }) {
    super()
    if (opts?.createWebSocket) {
      this.createWebSocket = opts.createWebSocket
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  /**
   * Initialize the adapter: load config, connect, and register with the channel router.
   */
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
    console.log(`[openclaw] Adapter started, gateway=${this.config.gatewayUrl}`)
  }

  /**
   * Disconnect and clean up.
   */
  stop(): void {
    this._started = false

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Reject all pending approvals
    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error('OpenClaw adapter stopped'))
      this.pendingApprovals.delete(id)
    }

    // Reject all pending RPCs
    for (const [id, pending] of this.pendingRpc) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error('OpenClaw adapter stopped'))
      this.pendingRpc.delete(id)
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WS_READY_STATE_OPEN
  }

  // ─── WebSocket Connection ──────────────────────────────────────

  private connect(): void {
    if (!this.config) return

    try {
      if (this.createWebSocket) {
        this.ws = this.createWebSocket(this.config.gatewayUrl)
      } else {
        // Dynamic require to avoid bundling ws in environments that don't need it
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
    console.log('[openclaw] Connected to gateway')
    this.emit('connected')

    // Authenticate with the gateway
    if (this.config?.apiKey) {
      this.sendRpc('auth.authenticate', { apiKey: this.config.apiKey }).catch((err) => {
        console.error('[openclaw] Authentication failed:', err)
      })
    }
  }

  private onMessage(data: unknown): void {
    let msg: OpenClawRpcResponse | OpenClawGatewayEvent

    try {
      const raw = typeof data === 'string' ? data : String(data)
      msg = JSON.parse(raw)
    } catch {
      console.warn('[openclaw] Received non-JSON message, ignoring')
      return
    }

    // Handle RPC responses (has id + result/error)
    if ('id' in msg && msg.id && ('result' in msg || 'error' in msg)) {
      this.handleRpcResponse(msg as OpenClawRpcResponse)
      return
    }

    // Handle gateway-pushed events (has method, no id)
    if ('method' in msg && msg.method) {
      this.handleGatewayEvent(msg as OpenClawGatewayEvent)
      return
    }
  }

  private onClose(): void {
    console.log('[openclaw] Disconnected from gateway')
    this.ws = null
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

  // ─── RPC Communication ─────────────────────────────────────────

  /**
   * Send a JSON-RPC request to the gateway and wait for the response.
   */
  sendRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WS_READY_STATE_OPEN) {
        reject(new Error('OpenClaw gateway not connected'))
        return
      }

      const id = `rpc-${++this.rpcCounter}-${Date.now()}`

      const timeoutId = setTimeout(() => {
        this.pendingRpc.delete(id)
        reject(new Error(`RPC ${method} timed out after ${RPC_TIMEOUT_MS}ms`))
      }, RPC_TIMEOUT_MS)

      this.pendingRpc.set(id, { resolve, reject, timeoutId })

      const request: OpenClawRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      this.ws.send(JSON.stringify(request))
    })
  }

  private handleRpcResponse(msg: OpenClawRpcResponse): void {
    const pending = this.pendingRpc.get(msg.id)
    if (!pending) return

    clearTimeout(pending.timeoutId)
    this.pendingRpc.delete(msg.id)

    if (msg.error) {
      pending.reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`))
    } else {
      pending.resolve(msg.result)
    }
  }

  private handleGatewayEvent(msg: OpenClawGatewayEvent): void {
    switch (msg.method) {
      case 'approval.response': {
        const approvalId = msg.params.approvalId as string | undefined
        const response = msg.params.response as string | undefined
        if (approvalId && response) {
          this.resolveApproval(approvalId, response)
        }
        break
      }
      case 'message.inbound': {
        // Inbound messages from user's channel → Astro chat
        this.emit('inbound', msg.params)
        break
      }
      default:
        this.emit('gateway-event', msg)
    }
  }

  // ─── Outbound Notifications ────────────────────────────────────

  /**
   * Send a notification to the user's preferred channel via the OpenClaw gateway.
   */
  async sendNotification(notification: ChannelNotification): Promise<void> {
    const formatted = formatForChannel(notification.summary, 'openclaw')

    const message = this.buildNotificationMessage(notification, formatted)

    await this.sendRpc('message.send', {
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

  /**
   * Send a response back to a conversation via the gateway.
   */
  async sendResponse(response: OutboundResponse): Promise<void> {
    const formatted = formatForChannel(response.text, 'openclaw')

    await this.sendRpc('message.send', {
      channelId: response.conversationRef.channelId,
      threadId: response.conversationRef.threadId,
      text: formatted,
      metadata: response.conversationRef.metadata,
    })
  }

  // ─── Approval Routing ──────────────────────────────────────────

  /**
   * Route an `ask_user_question` approval request to the user via the gateway.
   * Returns a promise that resolves when the user responds.
   */
  async requestApproval(opts: {
    approvalId: string
    projectId: string
    taskId: string
    question: string
    options?: string[]
  }): Promise<string> {
    const formatted = formatForChannel(opts.question, 'openclaw')

    // Send the approval request via gateway
    await this.sendRpc('approval.request', {
      approvalId: opts.approvalId,
      projectId: opts.projectId,
      taskId: opts.taskId,
      question: formatted,
      options: opts.options ?? [],
    })

    // Wait for the user's response
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
