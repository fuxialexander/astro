/**
 * Telegram Channel Plugin
 *
 * Integrates Telegram as a chat channel for Astro projects.
 * Receives messages via Telegram Bot API webhook, routes them through
 * the channel router, and sends responses back via the Bot API.
 */

import { Hono } from 'hono'
import type { AstroServerPlugin, ServerPluginContributions } from '../../types/plugin.js'
import type { TelegramChannelConfig, InboundMessage } from '../../lib/channel/channel-types.js'
import { channelRouter } from '../../lib/channel/channel-router.js'
import { channelConfigManager } from '../../lib/channel/channel-config-manager.js'
import { verifySimpleToken } from '../../lib/channel/webhook-verifier.js'
import { formatForChannel } from '../../lib/channel/channel-formatter.js'
import { sendTelegramMessage, setTelegramWebhook } from './telegram-api.js'

function loadConfig(): TelegramChannelConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  const mappingsJson = process.env.TELEGRAM_CHAT_MAPPINGS

  if (!botToken || !webhookSecret || !mappingsJson) {
    console.warn('[channel-telegram] Missing required env vars (TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_CHAT_MAPPINGS)')
    return null
  }

  try {
    const chatMappings = JSON.parse(mappingsJson) as Record<string, string>
    return { botToken, webhookSecret, chatMappings }
  } catch {
    console.error('[channel-telegram] Failed to parse TELEGRAM_CHAT_MAPPINGS as JSON')
    return null
  }
}

const telegramPlugin: AstroServerPlugin = {
  manifest: {
    id: 'channel-telegram',
    name: 'Telegram Channel',
    version: '1.0.0',
    description: 'Telegram integration for Astro project channels',
    capabilities: ['routes', 'hooks'],
  },

  async activate(/* _context */): Promise<ServerPluginContributions> {
    const config = loadConfig()
    if (!config) {
      console.warn('[channel-telegram] Plugin activated without configuration — routes will return 503')
    }

    const app = new Hono()

    // POST /webhook — Telegram Update handler
    app.post('/webhook', async (c) => {
      if (!config) {
        return c.json({ error: 'Telegram plugin not configured' }, 503)
      }

      // Verify secret token header
      const secretHeader = c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? ''
      if (!verifySimpleToken(secretHeader, config.webhookSecret)) {
        return c.json({ error: 'Invalid secret token' }, 401)
      }

      const update = await c.req.json()

      // Filter: only process message updates with text content
      if (!update.message || !update.message.text) {
        return c.json({ ok: true })
      }

      const msg = update.message

      // Filter: ignore bot messages
      if (msg.from?.is_bot) {
        return c.json({ ok: true })
      }

      const chatId = String(msg.chat.id)

      // Try env-var config first
      let projectId = config.chatMappings[chatId]
      let botToken = config.botToken

      // If no env-var mapping, try DB config
      if (!projectId) {
        try {
          const dbConfig = await channelConfigManager.getConfigByExternalId('telegram', chatId)
          if (dbConfig) {
            projectId = dbConfig.mappings[chatId]
            botToken = dbConfig.credentials.botToken as string
          }
        } catch {
          // DB not available, continue with env-var config
        }
      }

      if (!projectId || !botToken) {
        // Message from an unmapped chat — ignore
        return c.json({ ok: true })
      }

      const message: InboundMessage = {
        sourceMessageId: String(msg.message_id),
        channel: 'telegram',
        text: msg.text,
        sender: {
          id: String(msg.from?.id ?? 'unknown'),
          name: msg.from?.first_name
            ? `${msg.from.first_name}${msg.from.last_name ? ` ${msg.from.last_name}` : ''}`
            : 'unknown',
        },
        conversationRef: {
          channelId: chatId,
          threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined,
        },
        projectId,
      }

      // Route through the channel router and respond
      try {
        const response = await channelRouter.routeMessage(message)
        await sendTelegramMessage(botToken, {
          chat_id: chatId,
          text: response.text,
          parse_mode: 'HTML',
          reply_to_message_id: msg.message_id,
        })
      } catch (err) {
        console.error('[channel-telegram] Error processing message:', err)
      }

      return c.json({ ok: true })
    })

    // POST /setup — Register the Telegram webhook URL
    app.post('/setup', async (c) => {
      if (!config) {
        return c.json({ error: 'Telegram plugin not configured' }, 503)
      }

      const body = await c.req.json()
      const webhookUrl = body.url as string

      if (!webhookUrl) {
        return c.json({ error: 'Missing "url" in request body' }, 400)
      }

      const result = await setTelegramWebhook(config.botToken, webhookUrl, config.webhookSecret)
      return c.json(result)
    })

    // GET /status — Plugin health check
    app.get('/status', (c) => {
      return c.json({
        plugin: 'channel-telegram',
        configured: config !== null,
        mappedChats: config ? Object.keys(config.chatMappings).length : 0,
      })
    })

    // Register notification senders for each mapped chat
    if (config) {
      for (const [chatId, projectId] of Object.entries(config.chatMappings)) {
        channelRouter.registerNotificationSender(projectId, 'telegram', async (notification) => {
          const text = formatForChannel(
            `**${notification.type}**\n${notification.summary}\n[View in Astro](${notification.astroUrl})`,
            'telegram_html'
          )
          await sendTelegramMessage(config.botToken, {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
          })
        })
      }

      // Register response sender for Telegram
      channelRouter.registerResponseSender('telegram', async (response) => {
        await sendTelegramMessage(config.botToken, {
          chat_id: response.conversationRef.channelId,
          text: response.text,
          parse_mode: 'HTML',
        })
      })
    }

    // Register notification senders from DB configs
    try {
      const dbConfigs = await channelConfigManager.getConfigsForChannel('telegram')
      for (const cfg of dbConfigs) {
        if (cfg.accountId.startsWith('env-')) continue // Skip env-based configs
        for (const [chId, projId] of Object.entries(cfg.mappings)) {
          channelRouter.registerNotificationSender(projId, 'telegram', async (notification) => {
            const text = formatForChannel(
              `**${notification.type}**\n${notification.summary}\n[View in Astro](${notification.astroUrl})`,
              'telegram_html'
            )
            await sendTelegramMessage(cfg.credentials.botToken as string, {
              chat_id: chId,
              text,
              parse_mode: 'HTML',
            })
          })
        }
      }
    } catch {
      // DB not available, env-var senders already registered
    }

    return { routes: app }
  },

  async deactivate(): Promise<void> {
    console.log('[channel-telegram] Plugin deactivated')
  },
}

export default telegramPlugin
