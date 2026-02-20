/**
 * Linear Channel Plugin
 *
 * Receives Linear webhook events (issues, comments, projects)
 * and routes @astro mentions through the channel router for AI responses.
 */

import { Hono } from 'hono'
import type { AstroServerPlugin, ServerPluginContributions } from '../../types/plugin.js'
import type { LinearChannelConfig } from '../../lib/channel/channel-types.js'
import { channelRouter } from '../../lib/channel/channel-router.js'
import { channelConfigManager } from '../../lib/channel/channel-config-manager.js'
import { verifyHmacSignature } from '../../lib/channel/webhook-verifier.js'
import { formatForChannel } from '../../lib/channel/channel-formatter.js'
import { postLinearComment } from './linear-api.js'
import {
  handleLinearIssueEvent,
  handleLinearCommentEvent,
  handleLinearProjectEvent,
} from './linear-webhook-handler.js'

let pluginConfig: LinearChannelConfig | null = null

function loadConfig(): LinearChannelConfig | null {
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET
  const apiToken = process.env.LINEAR_API_TOKEN

  if (!webhookSecret || !apiToken) {
    console.warn('[channel-linear] Missing LINEAR_WEBHOOK_SECRET or LINEAR_API_TOKEN')
    return null
  }

  let teamMappings: Record<string, string> = {}
  try {
    const raw = process.env.LINEAR_TEAM_MAPPINGS
    if (raw) {
      teamMappings = JSON.parse(raw) as Record<string, string>
    }
  } catch {
    console.warn('[channel-linear] Invalid LINEAR_TEAM_MAPPINGS JSON, using empty mappings')
  }

  const autoSyncIssues = process.env.LINEAR_AUTO_SYNC_ISSUES !== 'false'

  return {
    webhookSecret,
    apiToken,
    teamMappings,
    autoSyncIssues,
  }
}

function createRoutes(config: LinearChannelConfig): Hono {
  const app = new Hono()

  // POST /webhook — Linear webhook receiver
  app.post('/webhook', async (c) => {
    const signature = c.req.header('Linear-Signature')
    const eventType = c.req.header('Linear-Event')

    if (!signature) {
      return c.json({ error: 'Missing Linear-Signature header' }, 400)
    }

    const body = await c.req.text()

    if (!verifyHmacSignature(body, signature, config.webhookSecret)) {
      return c.json({ error: 'Invalid signature' }, 401)
    }

    // Must respond HTTP 200 within 5 seconds — process async
    const payload = JSON.parse(body) as Record<string, unknown>

    // Check if the team is mapped in env config; if not, try DB config
    let effectiveConfig = config
    const teamId = (payload.data as Record<string, unknown>)?.teamId as string | undefined
    if (teamId && !config.teamMappings[teamId]) {
      try {
        const dbConfig = await channelConfigManager.getConfigByExternalId('linear', teamId)
        if (dbConfig) {
          effectiveConfig = {
            webhookSecret: dbConfig.credentials.webhookSecret as string || config.webhookSecret,
            apiToken: dbConfig.credentials.apiToken as string || config.apiToken,
            teamMappings: { ...config.teamMappings, ...dbConfig.mappings },
            autoSyncIssues: (dbConfig.settings.autoSyncIssues as boolean) ?? config.autoSyncIssues,
          }
        }
      } catch {
        // DB not available, continue with env-var config
      }
    }

    void processEvent(eventType, payload, effectiveConfig).catch((err) => {
      console.error(`[channel-linear] Error processing ${eventType} event:`, err)
    })

    return c.json({ ok: true })
  })

  // GET /status — Plugin health check
  app.get('/status', (c) => {
    return c.json({
      plugin: 'channel-linear',
      status: 'active',
      autoSyncIssues: config.autoSyncIssues,
      mappedTeams: Object.keys(config.teamMappings).length,
    })
  })

  return app
}

async function processEvent(
  eventType: string | undefined,
  payload: Record<string, unknown>,
  config: LinearChannelConfig
): Promise<void> {
  // Linear sends the type in both the header and the payload
  const type = eventType ?? (payload.type as string) ?? ''

  switch (type) {
    case 'Issue':
      await handleLinearIssueEvent(payload, config)
      break
    case 'Comment':
      await handleLinearCommentEvent(payload, config, channelRouter)
      break
    case 'Project':
      await handleLinearProjectEvent(payload, config)
      break
    default:
      console.log(`[channel-linear] Unhandled event type: ${type}`)
  }
}

const plugin: AstroServerPlugin = {
  manifest: {
    id: 'channel-linear',
    name: 'Linear Channel',
    version: '1.0.0',
    description: 'Linear webhook integration for issue and project sync',
    capabilities: ['routes', 'signals'],
  },

  async activate(/* _context */): Promise<ServerPluginContributions> {
    pluginConfig = loadConfig()

    if (!pluginConfig) {
      console.warn('[channel-linear] Plugin activated without configuration — webhook routes will reject requests')
      return {}
    }

    const config = pluginConfig

    // Register notification senders for each mapped team
    for (const [, projectId] of Object.entries(config.teamMappings)) {
      channelRouter.registerNotificationSender(projectId, 'linear', async (notification) => {
        const body = formatForChannel(
          `**${notification.type}**: ${notification.summary}\n\n[View in Astro](${notification.astroUrl})`,
          'linear_markdown'
        )
        // Post notification as a comment on the relevant issue
        const issueId = (notification.metadata?.linearIssueId as string) ?? undefined
        if (issueId) {
          await postLinearComment(config.apiToken, issueId, body)
        }
      })
    }

    // Register notification senders from DB configs
    try {
      const dbConfigs = await channelConfigManager.getConfigsForChannel('linear')
      for (const cfg of dbConfigs) {
        if (cfg.accountId.startsWith('env-')) continue // Skip env-based configs
        for (const [, projId] of Object.entries(cfg.mappings)) {
          channelRouter.registerNotificationSender(projId, 'linear', async (notification) => {
            const body = formatForChannel(
              `**${notification.type}**: ${notification.summary}\n\n[View in Astro](${notification.astroUrl})`,
              'linear_markdown'
            )
            const issueId = (notification.metadata?.linearIssueId as string) ?? undefined
            if (issueId) {
              await postLinearComment(cfg.credentials.apiToken as string, issueId, body)
            }
          })
        }
      }
    } catch {
      // DB not available, env-var senders already registered
    }

    console.log(`[channel-linear] Activated with ${Object.keys(config.teamMappings).length} team mapping(s)`)

    return {
      routes: createRoutes(config),
      signalEvaluators: [
        { type: 'linear.issue', evaluator: (payload) => (payload as Record<string, unknown>)?.type === 'Issue' },
        { type: 'linear.comment', evaluator: (payload) => (payload as Record<string, unknown>)?.type === 'Comment' },
        { type: 'linear.project', evaluator: (payload) => (payload as Record<string, unknown>)?.type === 'Project' },
      ],
    }
  },

  async deactivate(): Promise<void> {
    pluginConfig = null
    console.log('[channel-linear] Deactivated')
  },
}

export default plugin
