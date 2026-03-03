/**
 * GitHub Channel Plugin
 *
 * Receives GitHub webhook events (issues, PRs, pushes, check runs)
 * and routes @astro mentions through the channel router for AI responses.
 */

import { Hono } from 'hono'
import type { AstroServerPlugin, ServerPluginContributions } from '../../types/plugin.js'
import type { GitHubChannelConfig } from '../../lib/channel/channel-types.js'
import { channelRouter } from '../../lib/channel/channel-router.js'
import { channelConfigManager } from '../../lib/channel/channel-config-manager.js'
import { verifyHmacSignature } from '../../lib/channel/webhook-verifier.js'
import { formatForChannel } from '../../lib/channel/channel-formatter.js'
import { postGitHubComment } from './github-api.js'
import {
  handleIssueEvent,
  handleIssueCommentEvent,
  handlePRReviewCommentEvent,
  handlePullRequestEvent,
  handlePushEvent,
  handleCheckRunEvent,
  handleMergeGroupEvent,
} from './github-webhook-handler.js'

let pluginConfig: GitHubChannelConfig | null = null

function loadConfig(): GitHubChannelConfig | null {
  const webhookSecret = process.env.GITHUB_CHANNEL_WEBHOOK_SECRET
  const authToken = process.env.GITHUB_CHANNEL_AUTH_TOKEN

  if (!webhookSecret || !authToken) {
    console.warn('[channel-github] Missing GITHUB_CHANNEL_WEBHOOK_SECRET or GITHUB_CHANNEL_AUTH_TOKEN')
    return null
  }

  let repoMappings: Record<string, string> = {}
  try {
    const raw = process.env.GITHUB_REPO_MAPPINGS
    if (raw) {
      repoMappings = JSON.parse(raw) as Record<string, string>
    }
  } catch {
    console.warn('[channel-github] Invalid GITHUB_REPO_MAPPINGS JSON, using empty mappings')
  }

  const enabledEvents = process.env.GITHUB_CHANNEL_EVENTS
    ? process.env.GITHUB_CHANNEL_EVENTS.split(',').map((e) => e.trim())
    : ['issues', 'issue_comment', 'pull_request', 'pull_request_review_comment', 'push', 'check_run', 'merge_group']

  return {
    webhookSecret,
    authToken,
    repoMappings,
    enabledEvents,
    autoCreateTasks: true,
  }
}

function createRoutes(config: GitHubChannelConfig): Hono {
  const app = new Hono()

  // POST /webhook — GitHub webhook receiver
  app.post('/webhook', async (c) => {
    const signature = c.req.header('X-Hub-Signature-256')
    const eventType = c.req.header('X-GitHub-Event')

    if (!signature || !eventType) {
      return c.json({ error: 'Missing signature or event type header' }, 400)
    }

    const body = await c.req.text()

    if (!verifyHmacSignature(body, signature, config.webhookSecret, { prefix: 'sha256=' })) {
      return c.json({ error: 'Invalid signature' }, 401)
    }

    // Respond 200 immediately, process async
    const payload = JSON.parse(body) as Record<string, unknown>

    // Check if the repo is mapped in env config; if not, try DB config
    let effectiveConfig = config
    const repo = payload.repository as Record<string, unknown> | undefined
    const repoFullName = repo?.full_name as string | undefined

    if (repoFullName && !config.repoMappings[repoFullName]) {
      try {
        const dbConfig = await channelConfigManager.getConfigByExternalId('github', repoFullName)
        if (dbConfig) {
          effectiveConfig = {
            webhookSecret: dbConfig.credentials.webhookSecret as string || config.webhookSecret,
            authToken: dbConfig.credentials.authToken as string || config.authToken,
            repoMappings: { ...config.repoMappings, ...dbConfig.mappings },
            enabledEvents: (dbConfig.settings.enabledEvents as string[]) || config.enabledEvents,
            autoCreateTasks: (dbConfig.settings.autoCreateTasks as boolean) ?? config.autoCreateTasks,
          }
        }
      } catch {
        // DB not available, continue with env-var config
      }
    }

    // Fire and forget — process event asynchronously
    void processEvent(eventType, payload, effectiveConfig).catch((err) => {
      console.error(`[channel-github] Error processing ${eventType} event:`, err)
    })

    return c.json({ ok: true })
  })

  // GET /status — Plugin health check
  app.get('/status', (c) => {
    return c.json({
      plugin: 'channel-github',
      status: 'active',
      enabledEvents: config.enabledEvents,
      mappedRepos: Object.keys(config.repoMappings).length,
    })
  })

  return app
}

async function processEvent(
  eventType: string,
  payload: Record<string, unknown>,
  config: GitHubChannelConfig
): Promise<void> {
  if (!config.enabledEvents.includes(eventType)) {
    console.log(`[channel-github] Ignoring disabled event type: ${eventType}`)
    return
  }

  switch (eventType) {
    case 'issues':
      await handleIssueEvent(payload, config)
      break
    case 'issue_comment':
      await handleIssueCommentEvent(payload, config, channelRouter)
      break
    case 'pull_request':
      await handlePullRequestEvent(payload, config)
      break
    case 'push':
      await handlePushEvent(payload, config)
      break
    case 'pull_request_review_comment':
      await handlePRReviewCommentEvent(payload, config)
      break
    case 'check_run':
      await handleCheckRunEvent(payload, config)
      break
    case 'merge_group':
      await handleMergeGroupEvent(payload, config)
      break
    default:
      console.log(`[channel-github] Unhandled event type: ${eventType}`)
  }
}

const plugin: AstroServerPlugin = {
  manifest: {
    id: 'channel-github',
    name: 'GitHub Channel',
    version: '1.0.0',
    description: 'GitHub webhook integration for issues, PRs, and CI events',
    capabilities: ['routes', 'signals'],
  },

  async activate(/* _context */): Promise<ServerPluginContributions> {
    pluginConfig = loadConfig()

    if (!pluginConfig) {
      console.warn('[channel-github] Plugin activated without configuration — webhook routes will reject requests')
      return {}
    }

    const config = pluginConfig

    // Register notification senders for each mapped repo
    for (const [repoFullName, projectId] of Object.entries(config.repoMappings)) {
      const [owner, repo] = repoFullName.split('/')
      channelRouter.registerNotificationSender(projectId, 'github', async (notification) => {
        const body = formatForChannel(
          `**${notification.type}**: ${notification.summary}\n\n[View in Astro](${notification.astroUrl})`,
          'github_gfm'
        )
        // Post notification as a comment on the repo's default issue/discussion
        // In practice, the metadata would specify the target issue number
        const issueNumber = (notification.metadata?.issueNumber as number) ?? undefined
        if (issueNumber) {
          await postGitHubComment(config.authToken, owner, repo, issueNumber, body)
        }
      })
    }

    // Register notification senders from DB configs
    try {
      const dbConfigs = await channelConfigManager.getConfigsForChannel('github')
      for (const cfg of dbConfigs) {
        if (cfg.accountId.startsWith('env-')) continue // Skip env-based configs
        for (const [repoName, projId] of Object.entries(cfg.mappings)) {
          const [dbOwner, dbRepo] = repoName.split('/')
          channelRouter.registerNotificationSender(projId, 'github', async (notification) => {
            const body = formatForChannel(
              `**${notification.type}**: ${notification.summary}\n\n[View in Astro](${notification.astroUrl})`,
              'github_gfm'
            )
            const issueNumber = (notification.metadata?.issueNumber as number) ?? undefined
            if (issueNumber) {
              await postGitHubComment(cfg.credentials.authToken as string, dbOwner, dbRepo, issueNumber, body)
            }
          })
        }
      }
    } catch {
      // DB not available, env-var senders already registered
    }

    console.log(`[channel-github] Activated with ${Object.keys(config.repoMappings).length} repo mapping(s)`)

    return {
      routes: createRoutes(config),
      signalEvaluators: [
        { type: 'github.push', evaluator: (payload) => (payload as Record<string, unknown>)?.ref !== undefined },
        { type: 'github.issues', evaluator: (payload) => (payload as Record<string, unknown>)?.issue !== undefined },
        { type: 'github.pull_request', evaluator: (payload) => (payload as Record<string, unknown>)?.pull_request !== undefined },
        { type: 'github.pull_request_review_comment', evaluator: (payload) => {
          const p = payload as Record<string, unknown>
          return p?.comment !== undefined && p?.pull_request !== undefined && p?.action === 'created'
        }},
        { type: 'github.check_run', evaluator: (payload) => (payload as Record<string, unknown>)?.check_run !== undefined },
        { type: 'github.merge_group', evaluator: (payload) => (payload as Record<string, unknown>)?.merge_group !== undefined },
      ],
    }
  },

  async deactivate(): Promise<void> {
    pluginConfig = null
    console.log('[channel-github] Deactivated')
  },
}

export default plugin
