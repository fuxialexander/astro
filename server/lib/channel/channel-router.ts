/**
 * Channel Router
 *
 * Central message coordinator that routes inbound chat messages
 * to the AI agent and fans out notifications to registered channels.
 *
 * Uses provider.execute() directly (non-streaming) following the same
 * getChatProvider() pattern from server/routes/agent.ts.
 */

import {
  providerRegistry,
  type TaskDispatch,
} from '../providers/index.js'
import { buildChatSystemPrompt } from '../prompt-templates.js'
import type {
  InboundMessage,
  OutboundResponse,
  ChannelNotification,
  ChannelType,
  ChannelRouter as IChannelRouter,
  ResponseSenderFn,
  NotificationSenderFn,
} from './channel-types.js'
import { formatForChannel } from './channel-formatter.js'
import type { ChannelFormat } from './channel-types.js'

const FORMAT_MAP: Record<ChannelType, ChannelFormat> = {
  slack: 'slack_mrkdwn',
  telegram: 'telegram_html',
  github: 'github_gfm',
  linear: 'linear_markdown',
}

/**
 * Get the best provider for channel chat.
 * Mirrors getChatProvider() from server/routes/agent.ts.
 */
function getChatProvider() {
  const directReg = providerRegistry.getRegisteredProvider('anthropic-direct')
  if (directReg?.available) {
    return directReg.provider
  }
  return providerRegistry.getDefaultProvider()
}

class ChannelRouterImpl implements IChannelRouter {
  /** channel → response sender functions */
  private responseSenders = new Map<ChannelType, ResponseSenderFn>()

  /** projectId → Map<channel, notification sender> */
  private notificationSenders = new Map<string, Map<ChannelType, NotificationSenderFn>>()

  /**
   * Route an inbound chat message through the AI agent.
   * Calls provider.execute() (non-streaming) and returns the formatted response.
   */
  async routeMessage(message: InboundMessage): Promise<OutboundResponse> {
    const provider = getChatProvider()

    if (!provider) {
      return {
        text: 'No AI provider is currently available. Please check your Astro server configuration.',
        conversationRef: message.conversationRef,
      }
    }

    const systemPrompt = buildChatSystemPrompt()
    const taskId = `channel-${message.channel}-${Date.now()}`

    const task: TaskDispatch = {
      taskId,
      type: 'chat',
      prompt: message.text,
      systemPrompt,
      maxTurns: 1,
      context: {
        projectId: message.projectId,
      },
    }

    try {
      const result = await provider.execute(task)
      const rawText = result.stdout || 'I was unable to generate a response.'
      const format = FORMAT_MAP[message.channel]
      const formattedText = formatForChannel(rawText, format)

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
   */
  async sendNotification(notification: ChannelNotification): Promise<void> {
    const senders = this.notificationSenders.get(notification.projectId)
    if (!senders || senders.size === 0) return

    const promises = Array.from(senders.entries()).map(async ([channel, sender]) => {
      try {
        await sender(notification)
      } catch (err) {
        console.error(`[channel-router] Failed to send notification to ${channel} for project ${notification.projectId}:`, err)
      }
    })

    await Promise.allSettled(promises)
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

  /** Get the response sender for a channel (used by plugins to post responses) */
  getResponseSender(channel: ChannelType): ResponseSenderFn | undefined {
    return this.responseSenders.get(channel)
  }
}

export const channelRouter = new ChannelRouterImpl()
