/**
 * Channel Router
 *
 * Central message coordinator that routes inbound chat messages
 * to the AI agent via relay, fans out notifications to registered channels,
 * and provides an envelope-based message bus for decoupled message delivery.
 *
 * The envelope bus (inspired by Ductor's Envelope/MessageBus pattern) wraps
 * all outbound messages — notifications, chat responses, streaming updates,
 * approval requests — in a unified Envelope type. This decouples message
 * production from delivery, enabling future transports (Discord, Matrix, etc.).
 */

import { relayServer } from '../relay-server.js'
import { buildChatSystemPrompt } from '../prompt-templates.js'
import type {
  InboundMessage,
  OutboundResponse,
  ChannelNotification,
  ChannelType,
  ChannelRouter as IChannelRouter,
  ResponseSenderFn,
  NotificationSenderFn,
  Envelope,
  EnvelopeType,
  EnvelopeHandler,
  BusSubscription,
  NotificationEnvelope,
  ChatEnvelope,
} from './channel-types.js'
import { formatForChannel } from './channel-formatter.js'
import type { ChannelFormat } from './channel-types.js'
import type { TaskTextMessage, TaskResultMessage } from '../../types/relay.js'
import { MessageBus } from './message-bus.js'

const FORMAT_MAP: Record<ChannelType, ChannelFormat> = {
  slack: 'slack_mrkdwn',
  telegram: 'telegram_html',
  github: 'github_gfm',
  linear: 'linear_markdown',
  openclaw: 'openclaw',
}

/**
 * Create an envelope with sensible defaults.
 */
export function createEnvelope<T>(
  fields: Omit<Envelope<T>, 'timestamp'> & { timestamp?: string }
): Envelope<T> {
  return {
    ...fields,
    timestamp: fields.timestamp || new Date().toISOString(),
  }
}

class ChannelRouterImpl implements IChannelRouter {
  /** channel → response sender functions */
  private responseSenders = new Map<ChannelType, ResponseSenderFn>()

  /** projectId → Map<channel, notification sender> */
  private notificationSenders = new Map<string, Map<ChannelType, NotificationSenderFn>>()

  /** channel → global notification sender (fires for ALL projects) */
  private globalNotificationSenders = new Map<ChannelType, NotificationSenderFn>()

  /** The underlying message bus */
  readonly bus = new MessageBus()

  constructor() {
    // Wire up built-in bus handlers that bridge envelopes to existing sender infrastructure.
    // This ensures backward compatibility: publishing a notification envelope triggers
    // the same per-project and global notification senders that sendNotification() uses.
    this.bus.subscribe('notification', async (envelope) => {
      const notifEnvelope = envelope as NotificationEnvelope
      await this.deliverNotification(notifEnvelope.payload, notifEnvelope.targetChannel)
    })

    this.bus.subscribe('chat', async (envelope) => {
      const chatEnvelope = envelope as ChatEnvelope
      if (chatEnvelope.targetChannel) {
        const sender = this.responseSenders.get(chatEnvelope.targetChannel)
        if (sender) {
          await sender(chatEnvelope.payload)
        }
      }
    })
  }

  /**
   * Route an inbound chat message through the AI agent via relay.
   */
  async routeMessage(message: InboundMessage): Promise<OutboundResponse> {
    const systemPrompt = buildChatSystemPrompt()
    const taskId = `channel-${message.channel}-${Date.now()}`

    const task = {
      taskId,
      projectId: message.projectId || '',
      nodeId: '',
      title: 'Channel chat',
      description: message.text.slice(0, 200),
      environment: 'remote' as const,
      prompt: message.text,
      systemPrompt,
      type: 'chat' as const,
      maxTurns: 1,
    }

    try {
      // Dispatch via relay and collect result
      const result = await new Promise<string>((resolve) => {
        let output = ''
        const timeout = setTimeout(() => {
          cleanup()
          resolve(output || 'Request timed out.')
        }, 60_000)

        const onText = (msg: TaskTextMessage) => {
          if (msg.taskId !== taskId) return
          output += msg.text
        }

        const onResult = (msg: TaskResultMessage) => {
          if (msg.result.taskId !== taskId) return
          clearTimeout(timeout)
          cleanup()
          resolve(msg.result.output || output || 'I was unable to generate a response.')
        }

        const cleanup = () => {
          relayServer.off('task:text', onText)
          relayServer.off('task:result', onResult)
        }

        relayServer.on('task:text', onText)
        relayServer.on('task:result', onResult)

        const dispatched = relayServer.dispatchTask(task)
        if (!dispatched) {
          clearTimeout(timeout)
          cleanup()
          resolve('No AI agent runner is currently available.')
        }
      })

      const format = FORMAT_MAP[message.channel]
      const formattedText = formatForChannel(result, format)

      return {
        text: formattedText,
        conversationRef: message.conversationRef,
      }
    } catch (err) {
      console.error(`[channel-router] Error routing message from ${message.channel}:`, err)
      return {
        text: 'An error occurred while processing your message. Please try again.',
        conversationRef: message.conversationRef,
      }
    }
  }

  /**
   * Send a notification to all registered channels for a project.
   * Also fires global notification senders (e.g., OpenClaw) for any project.
   *
   * This is the legacy API. Prefer `publish()` with a notification envelope
   * for new code — it goes through the same delivery path but allows bus
   * subscribers to observe/transform the message.
   */
  async sendNotification(notification: ChannelNotification): Promise<void> {
    await this.deliverNotification(notification)
  }

  /**
   * Publish an envelope to the message bus.
   *
   * The bus routes the envelope to all matching subscribers. Built-in
   * subscribers bridge 'notification' and 'chat' envelopes to the existing
   * sender infrastructure for backward compatibility.
   */
  async publish(envelope: Envelope): Promise<void> {
    await this.bus.publish(envelope)
  }

  /**
   * Subscribe to envelopes by type.
   *
   * @returns A subscription handle with an `unsubscribe()` method.
   */
  subscribe(type: EnvelopeType, handler: EnvelopeHandler): BusSubscription {
    return this.bus.subscribe(type, handler)
  }

  registerResponseSender(channel: ChannelType, fn: ResponseSenderFn): void {
    this.responseSenders.set(channel, fn)
    console.log(`[channel-router] Registered response sender for ${channel}`)
  }

  registerNotificationSender(projectId: string, channel: ChannelType, fn: NotificationSenderFn): void {
    let senders = this.notificationSenders.get(projectId)
    if (!senders) {
      senders = new Map()
      this.notificationSenders.set(projectId, senders)
    }
    senders.set(channel, fn)
    console.log(`[channel-router] Registered notification sender for ${channel} on project ${projectId}`)
  }

  registerGlobalNotificationSender(channel: ChannelType, fn: NotificationSenderFn): void {
    this.globalNotificationSenders.set(channel, fn)
    console.log(`[channel-router] Registered global notification sender for ${channel}`)
  }

  getResponseSender(channel: ChannelType): ResponseSenderFn | undefined {
    return this.responseSenders.get(channel)
  }

  // ---------------------------------------------------------------------------
  // Internal delivery
  // ---------------------------------------------------------------------------

  /**
   * Deliver a notification through registered sender functions.
   * If `targetChannel` is specified, only deliver to that channel (unicast).
   * Otherwise, deliver to all registered channels (broadcast).
   */
  private async deliverNotification(
    notification: ChannelNotification,
    targetChannel?: ChannelType,
  ): Promise<void> {
    const promises: Promise<void>[] = []

    if (targetChannel) {
      // Unicast: deliver to a specific channel only
      const senders = this.notificationSenders.get(notification.projectId)
      const sender = senders?.get(targetChannel) || this.globalNotificationSenders.get(targetChannel)
      if (sender) {
        promises.push(
          sender(notification).catch(err => {
            console.error(`[channel-router] Failed to send notification to ${targetChannel} for project ${notification.projectId}:`, err)
          })
        )
      }
    } else {
      // Broadcast: deliver to all registered channels
      const senders = this.notificationSenders.get(notification.projectId)
      if (senders) {
        for (const [channel, sender] of senders.entries()) {
          promises.push(
            sender(notification).catch(err => {
              console.error(`[channel-router] Failed to send notification to ${channel} for project ${notification.projectId}:`, err)
            })
          )
        }
      }

      // Global senders (fire for all projects, skip if already covered by per-project)
      for (const [channel, sender] of this.globalNotificationSenders.entries()) {
        if (senders?.has(channel)) continue // per-project takes precedence
        promises.push(
          sender(notification).catch(err => {
            console.error(`[channel-router] Failed to send global notification to ${channel}:`, err)
          })
        )
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises)
    }
  }
}

export const channelRouter = new ChannelRouterImpl()
