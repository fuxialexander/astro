/**
 * Slack Channel Plugin
 *
 * Integrates Slack as a chat channel for Astro projects.
 * Receives messages via Slack Events API webhook, routes them through
 * the channel router, and posts responses back to Slack.
 */

import { Hono } from 'hono'
import type { AstroServerPlugin, ServerPluginContributions } from '../../types/plugin.js'
import type { SlackChannelConfig, InboundMessage } from '../../lib/channel/channel-types.js'
import { channelRouter } from '../../lib/channel/channel-router.js'
import { channelConfigManager } from '../../lib/channel/channel-config-manager.js'
import { verifySlackSignature } from '../../lib/channel/webhook-verifier.js'
import { formatForChannel } from '../../lib/channel/channel-formatter.js'
import { postSlackMessage } from './slack-api.js'

function loadConfig(): SlackChannelConfig | null {
  const botToken = process.env.SLACK_BOT_TOKEN
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  const mappingsJson = process.env.SLACK_CHANNEL_MAPPINGS

  if (!botToken || !signingSecret || !mappingsJson) {
    console.warn('[channel-slack] Missing required env vars (SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_CHANNEL_MAPPINGS)')
    return null
  }

  try {
    const channelMappings = JSON.parse(mappingsJson) as Record<string, string>
    return { botToken, signingSecret, channelMappings }
  } catch {
    console.error('[channel-slack] Failed to parse SLACK_CHANNEL_MAPPINGS as JSON')
    return null
  }
}

const slackPlugin: AstroServerPlugin = {
  manifest: {
    id: 'channel-slack',
    name: 'Slack Channel',
    version: '1.0.0',
    description: 'Slack integration for Astro project channels',
    capabilities: ['routes', 'hooks'],
  },

  async activate(/* _context */): Promise<ServerPluginContributions> {
    const config = loadConfig()
    if (!config) {
      console.warn('[channel-slack] Plugin activated without configuration — routes will return 503')
    }

    const app = new Hono()

    // POST /webhook — Slack Events API endpoint
    app.post('/webhook', async (c) => {
      const rawBody = await c.req.text()

      // Handle Slack URL verification challenge (no config needed)
      try {
        const payload = JSON.parse(rawBody)
        if (payload.type === 'url_verification') {
          return c.json({ challenge: payload.challenge })
        }
      } catch {
        return c.json({ error: 'Invalid JSON' }, 400)
      }

      // Ignore retries (Slack re-sends if no 200 within 3s)
      const retryNum = c.req.header('X-Slack-Retry-Num')
      if (retryNum) {
        return c.json({ ok: true })
      }

      // Verify Slack signature (env-var config needed for this)
      if (config) {
        const timestamp = c.req.header('X-Slack-Request-Timestamp') ?? ''
        const signature = c.req.header('X-Slack-Signature') ?? ''

        if (!verifySlackSignature(rawBody, timestamp, signature, config.signingSecret)) {
          return c.json({ error: 'Invalid signature' }, 401)
        }
      }

      const payload = JSON.parse(rawBody)
      const event = payload.event

      // Filter: only process message events, ignore bot messages
      if (!event || event.type !== 'message' || event.subtype || event.bot_id) {
        return c.json({ ok: true })
      }

      const channelId: string = event.channel

      // Try env-var config first
      let projectId = config?.channelMappings[channelId]
      let botToken = config?.botToken

      // If no env-var mapping, try DB config
      if (!projectId) {
        try {
          const teamId = (payload as Record<string, unknown>).team_id as string
          if (teamId) {
            const dbConfig = await channelConfigManager.getConfigByExternalId('slack', teamId)
            if (dbConfig) {
              projectId = dbConfig.mappings[channelId]
              botToken = dbConfig.credentials.botToken as string
            }
          }
        } catch {
          // DB not available, continue with env-var config
        }
      }

      if (!projectId || !botToken) {
        // Unmapped channel — ignore
        return c.json({ ok: true })
      }

      const message: InboundMessage = {
        sourceMessageId: event.ts,
        channel: 'slack',
        text: event.text ?? '',
        sender: {
          id: event.user ?? 'unknown',
          name: event.user ?? 'unknown',
        },
        conversationRef: {
          channelId,
          threadId: event.thread_ts ?? event.ts,
        },
        projectId,
      }

      // Respond 200 immediately (Slack requires <3s), then process async
      const resolvedBotToken = botToken
      const responsePromise = channelRouter.routeMessage(message)
        .then(async (response) => {
          await postSlackMessage(resolvedBotToken, {
            channel: channelId,
            text: response.text,
            thread_ts: message.conversationRef.threadId,
          })
        })
        .catch((err) => {
          console.error('[channel-slack] Error processing message:', err)
        })

      // Don't await — fire and forget
      void responsePromise

      return c.json({ ok: true })
    })

    // GET /status — Plugin health check
    app.get('/status', (c) => {
      return c.json({
        plugin: 'channel-slack',
        configured: config !== null,
        mappedChannels: config ? Object.keys(config.channelMappings).length : 0,
      })
    })

    // Register notification senders for each mapped project
    if (config) {
      for (const [channelId, projectId] of Object.entries(config.channelMappings)) {
        channelRouter.registerNotificationSender(projectId, 'slack', async (notification) => {
          const text = formatForChannel(
            `*${notification.type}*\n${notification.summary}\n<${notification.astroUrl}|View in Astro>`,
            'slack_mrkdwn'
          )
          await postSlackMessage(config.botToken, {
            channel: channelId,
            text,
          })
        })
      }

      // Register response sender for Slack
      channelRouter.registerResponseSender('slack', async (response) => {
        await postSlackMessage(config.botToken, {
          channel: response.conversationRef.channelId,
          text: response.text,
          thread_ts: response.conversationRef.threadId,
        })
      })
    }

    // Register notification senders from DB configs
    try {
      const dbConfigs = await channelConfigManager.getConfigsForChannel('slack')
      for (const cfg of dbConfigs) {
        if (cfg.accountId.startsWith('env-')) continue // Skip env-based configs (already registered above)
        for (const [chId, projId] of Object.entries(cfg.mappings)) {
          channelRouter.registerNotificationSender(projId, 'slack', async (notification) => {
            const text = formatForChannel(
              `*${notification.type}*\n${notification.summary}\n<${notification.astroUrl}|View in Astro>`,
              'slack_mrkdwn'
            )
            await postSlackMessage(cfg.credentials.botToken as string, {
              channel: chId,
              text,
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
    console.log('[channel-slack] Plugin deactivated')
  },
}

export default slackPlugin
