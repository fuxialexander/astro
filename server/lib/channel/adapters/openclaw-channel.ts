/**
 * OpenClaw Channel Adapter — Relay-Routed
 *
 * Routes notifications and approval requests to users via OpenClaw, but
 * instead of connecting directly to the gateway (which only works when
 * server and gateway are co-located), routes through the relay:
 *
 *   Server → Relay WS → Agent Runner (with openclaw provider) → OpenClaw Gateway → User channels
 *
 * This works regardless of where the server runs (local, Fly.io, etc.)
 * because the agent runner on the user's machine handles the gateway connection.
 */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type {
  ChannelNotification,
  OutboundResponse,
  InboundMessage,
} from '../channel-types.js'
import { formatForChannel } from '../channel-formatter.js'
import { channelRouter } from '../channel-router.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pending request waiting for relay acknowledgment */
interface PendingRelay {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RELAY_TIMEOUT_MS = 15_000
const APPROVAL_TIMEOUT_MS = 300_000 // 5 minutes

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenClawChannelAdapter extends EventEmitter {
  private _started = false
  private pendingRelays = new Map<string, PendingRelay>()
  private pendingApprovals = new Map<string, PendingRelay>()

  /** Lazy-loaded relay server and machine registry */
  private async getRelay() {
    const { relayServer } = await import('../../relay-server.js')
    return relayServer
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._started) return

    const relay = await this.getRelay()

    // Check if any connected machine has openclaw provider
    const machineId = relay.findOpenClawMachine()
    if (!machineId) {
      console.log('[openclaw] No agent runner with OpenClaw provider connected')
    }

    this._started = true

    // Listen for relay events from agent runners
    relay.on('channel:notification_ack', (payload: { correlationId: string; success: boolean; error?: string }) => {
      this.resolveRelay(payload.correlationId, payload)
    })

    relay.on('channel:response_ack', (payload: { correlationId: string; success: boolean; error?: string }) => {
      this.resolveRelay(payload.correlationId, payload)
    })

    relay.on('channel:approval_response', (payload: { correlationId: string; approvalId: string; response: string }) => {
      // Resolve the pending approval
      const pending = this.pendingApprovals.get(payload.approvalId)
      if (pending) {
        clearTimeout(pending.timeoutId)
        this.pendingApprovals.delete(payload.approvalId)
        pending.resolve(payload.response)
      }
      // Also route to dispatch engine
      this.emit('approval-response', { approvalId: payload.approvalId, response: payload.response })
    })

    // Handle inbound messages from OpenClaw via agent runner
    relay.on('channel:inbound', (payload: {
      sourceMessageId: string
      text: string
      senderId: string
      senderName: string
      channelId: string
      threadId?: string
      metadata?: Record<string, unknown>
    }) => {
      this.handleInbound(payload)
    })

    // Route approval responses to the dispatch engine
    this.on('approval-response', async ({ approvalId, response }: { approvalId: string; response: string }) => {
      try {
        const { dispatchEngine } = await import('../../dispatch/index.js')
        const approved = response.toLowerCase() === 'yes' || response.toLowerCase() === 'approve'
        await dispatchEngine.respondToApproval(approvalId, approved, response)
      } catch {
        // Approval may not exist in dispatch engine
      }
    })

    // Register response sender
    channelRouter.registerResponseSender('openclaw', (r) => this.sendResponse(r))

    // Register global notification sender — fires for ALL projects.
    // For approval.requested notifications, this is interactive: sends to Telegram
    // and relays the user's response back to the agent runner.
    channelRouter.registerGlobalNotificationSender('openclaw', async (notification) => {
      if (notification.type === 'approval.requested') {
        const { requestId, taskId, machineId, options } = (notification.metadata || {}) as {
          requestId?: string; taskId?: string; machineId?: string; options?: string[]
        }

        if (requestId && taskId && machineId && options?.length) {
          // Interactive: request approval via OpenClaw bridge (Telegram poll)
          // and relay the response back. Race-safe: agent runner ignores duplicate responses.
          this.requestApproval({
            approvalId: requestId,
            projectId: notification.projectId,
            taskId,
            question: notification.summary,
            options,
          }).then(async (response) => {
            const relay = await this.getRelay()
            relay.sendApprovalResponse(taskId, machineId, requestId, true, response)
            console.log(`[openclaw] Approval answered via channel: task=${taskId} requestId=${requestId} answer="${response}"`)
          }).catch((err) => {
            // Timeout or no OpenClaw machine — user can still respond via web UI
            console.debug(`[openclaw] Channel approval not delivered: ${err.message}`)
          })
          return
        }
      }

      // All other notifications: send as one-way notification (best-effort).
      // If the agent runner has no recipient configured, this will fail —
      // that's expected and not an error worth logging at warn/error level.
      try {
        await this.sendNotification(notification)
      } catch (err) {
        const msg = (err as Error).message ?? ''
        if (msg.includes('No recipient configured') || msg.includes('No OpenClaw machine')) {
          console.debug(`[openclaw] Notification not delivered: ${msg}`)
        } else {
          console.warn(`[openclaw] Failed to send notification: ${msg}`)
        }
      }
    })

    console.log('[openclaw] Relay-routed adapter started')
  }

  stop(): void {
    this._started = false

    for (const [id, pending] of this.pendingRelays) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error('OpenClaw adapter stopped'))
      this.pendingRelays.delete(id)
    }

    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error('OpenClaw adapter stopped'))
      this.pendingApprovals.delete(id)
    }
  }

  get isConnected(): boolean {
    // We're "connected" if any agent runner with openclaw is available
    // This is checked lazily — we don't hold a persistent reference
    return this._started
  }

  // ─── Outbound Notifications ────────────────────────────────────

  async sendNotification(notification: ChannelNotification): Promise<void> {
    const relay = await this.getRelay()
    const machineId = relay.findOpenClawMachine()
    if (!machineId) {
      console.warn('[openclaw] No OpenClaw machine available for notification')
      return
    }

    const correlationId = randomUUID()
    const formatted = formatForChannel(notification.summary, 'openclaw')

    const sent = relay.sendChannelNotification(machineId, correlationId, {
      type: notification.type,
      projectId: notification.projectId,
      summary: formatted,
      astroUrl: notification.astroUrl,
      metadata: notification.metadata,
    })

    if (!sent) {
      console.warn('[openclaw] Failed to send notification via relay')
      return
    }

    // Wait for acknowledgment
    await this.waitForRelay(correlationId)
  }

  async sendResponse(response: OutboundResponse): Promise<void> {
    const relay = await this.getRelay()
    const machineId = relay.findOpenClawMachine()
    if (!machineId) {
      console.warn('[openclaw] No OpenClaw machine available for response')
      return
    }

    const correlationId = randomUUID()
    const formatted = formatForChannel(response.text, 'openclaw')

    const sent = relay.sendChannelResponse(machineId, correlationId, {
      text: formatted,
      channelId: response.conversationRef.channelId,
      threadId: response.conversationRef.threadId,
      metadata: response.conversationRef.metadata,
    })

    if (!sent) {
      console.warn('[openclaw] Failed to send response via relay')
      return
    }

    await this.waitForRelay(correlationId)
  }

  // ─── Approval Routing ──────────────────────────────────────────

  async requestApproval(opts: {
    approvalId: string
    projectId: string
    taskId: string
    question: string
    options?: string[]
  }): Promise<string> {
    const relay = await this.getRelay()
    const machineId = relay.findOpenClawMachine()
    if (!machineId) {
      throw new Error('No OpenClaw machine available for approval request')
    }

    const correlationId = randomUUID()
    const formatted = formatForChannel(opts.question, 'openclaw')

    const sent = relay.sendChannelApprovalRequest(machineId, correlationId, {
      approvalId: opts.approvalId,
      projectId: opts.projectId,
      taskId: opts.taskId,
      question: formatted,
      options: opts.options,
    })

    if (!sent) {
      throw new Error('Failed to send approval request via relay')
    }

    // Wait for user's response (not just the ack)
    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingApprovals.delete(opts.approvalId)
        reject(new Error(`Approval ${opts.approvalId} timed out after ${APPROVAL_TIMEOUT_MS}ms`))
      }, APPROVAL_TIMEOUT_MS)

      this.pendingApprovals.set(opts.approvalId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      })
    })
  }

  // ─── Inbound Messages ──────────────────────────────────────────

  private async handleInbound(payload: {
    sourceMessageId: string
    text: string
    senderId: string
    senderName: string
    channelId: string
    threadId?: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    // For inbound routing, we need project mappings
    // For now, include channelId in the message so the router can resolve it
    const message: InboundMessage = {
      sourceMessageId: payload.sourceMessageId,
      channel: 'openclaw',
      text: payload.text,
      sender: {
        id: payload.senderId,
        name: payload.senderName,
      },
      conversationRef: {
        channelId: payload.channelId,
        threadId: payload.threadId,
        metadata: payload.metadata,
      },
      projectId: '', // Will be resolved by router based on channel mappings
    }

    try {
      const response = await channelRouter.routeMessage(message)
      await this.sendResponse(response)
    } catch (err) {
      console.error('[openclaw] Failed to route inbound message:', err)
    }
  }

  // ─── Relay Helpers ─────────────────────────────────────────────

  private waitForRelay(correlationId: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRelays.delete(correlationId)
        reject(new Error(`Relay request ${correlationId} timed out`))
      }, RELAY_TIMEOUT_MS)

      this.pendingRelays.set(correlationId, { resolve, reject, timeoutId })
    })
  }

  private resolveRelay(correlationId: string, result: { success: boolean; error?: string }): void {
    const pending = this.pendingRelays.get(correlationId)
    if (!pending) return

    clearTimeout(pending.timeoutId)
    this.pendingRelays.delete(correlationId)

    if (result.success) {
      pending.resolve(result)
    } else {
      pending.reject(new Error(result.error || 'Relay request failed'))
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const openClawChannel = new OpenClawChannelAdapter()
