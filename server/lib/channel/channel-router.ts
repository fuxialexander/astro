/**
 * Channel Router
 *
 * Central message coordinator that routes inbound chat messages
 * to the AI agent via relay and fans out notifications to registered channels.
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
} from './channel-types.js'
import { formatForChannel } from './channel-formatter.js'
import type { ChannelFormat } from './channel-types.js'
import type { TaskTextMessage, TaskResultMessage } from '../../types/relay.js'

const FORMAT_MAP: Record<ChannelType, ChannelFormat> = {
  slack: 'slack_mrkdwn',
  telegram: 'telegram_html',
  github: 'github_gfm',
  linear: 'linear_markdown',
}

class ChannelRouterImpl implements IChannelRouter {
  /** channel → response sender functions */
  private responseSenders = new Map<ChannelType, ResponseSenderFn>()

  /** projectId → Map<channel, notification sender> */
  private notificationSenders = new Map<string, Map<ChannelType, NotificationSenderFn>>()

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

  getResponseSender(channel: ChannelType): ResponseSenderFn | undefined {
    return this.responseSenders.get(channel)
  }
}

export const channelRouter = new ChannelRouterImpl()
