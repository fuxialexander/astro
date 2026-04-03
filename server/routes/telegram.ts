/**
 * Telegram Routes
 *
 * Handles the Telegram webhook (receives updates from Telegram Bot API)
 * and user-facing endpoints for connecting/disconnecting Telegram.
 */

import { Hono } from 'hono'
import { telegramChannel } from '../lib/channel/adapters/telegram-channel.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { db } from '../lib/db/index.js'
import { connectedAccounts, teams } from '../lib/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { channelConfigManager } from '../lib/channel/channel-config-manager.js'
import { hasFeature } from '../lib/feature-flags.js'

const app = new Hono()

// ── Webhook (no auth — Telegram calls this) ──────────────────────

app.post('/webhook', async (c) => {
  if (!telegramChannel.isConfigured) {
    return c.json({ error: 'Telegram not configured' }, 503)
  }

  // Verify secret token header if configured
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (webhookSecret) {
    const header = c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? ''
    if (header !== webhookSecret) {
      return c.json({ error: 'Invalid secret token' }, 401)
    }
  }

  const update = await c.req.json()

  // Process asynchronously — Telegram expects a fast 200
  telegramChannel.handleUpdate(update).catch((err) => {
    console.error('[telegram] Error handling update:', err)
  })

  return c.json({ ok: true })
})

// ── Authenticated endpoints (gated by telegram-full-client flag) ─

app.use('/link', requireAuth)
app.use('/status', requireAuth)
app.use('/disconnect', requireAuth)
app.use('/setup-webhook', requireAuth)

/**
 * Middleware: check the telegram-full-client feature flag.
 * Applied to all authenticated Telegram endpoints below.
 * The webhook endpoint above is NOT gated — notifications work regardless.
 */
const requireTelegramFullClient = async (c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) => {
  const user = c.get('user') as AuthUser
  const [teamRow] = await db.select({ featureFlags: teams.featureFlags })
    .from(teams).where(eq(teams.id, user.teamId)).limit(1)
  if (!hasFeature(teamRow?.featureFlags ?? null, 'telegram-full-client')) {
    return c.json({ error: 'Telegram full client is not enabled for this team' }, 403)
  }
  await next()
}

app.use('/link', requireTelegramFullClient)
app.use('/status', requireTelegramFullClient)
app.use('/disconnect', requireTelegramFullClient)
app.use('/setup-webhook', requireTelegramFullClient)

/** POST /link — Generate a deep-link URL for connecting Telegram */
app.post('/link', async (c) => {
  if (!telegramChannel.isConfigured) {
    return c.json({ error: 'Telegram bot not configured on this server' }, 503)
  }

  const user = c.get('user') as AuthUser
  const result = await telegramChannel.generateLinkToken(user.id)
  return c.json(result)
})

/** GET /status — Check if the user has Telegram connected */
app.get('/status', async (c) => {
  const user = c.get('user') as AuthUser

  const rows = await db.select({
    id: connectedAccounts.id,
    externalId: connectedAccounts.externalId,
    enabled: connectedAccounts.enabled,
  })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, user.id),
        eq(connectedAccounts.channel, 'telegram'),
      )
    )
    .limit(1)

  if (rows.length > 0 && rows[0].enabled) {
    return c.json({
      connected: true,
      chatId: rows[0].externalId,
      botConfigured: telegramChannel.isConfigured,
    })
  }

  return c.json({
    connected: false,
    botConfigured: telegramChannel.isConfigured,
  })
})

/** DELETE /disconnect — Disconnect the user's Telegram */
app.delete('/disconnect', async (c) => {
  const user = c.get('user') as AuthUser

  await db.delete(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, user.id),
        eq(connectedAccounts.channel, 'telegram'),
      )
    )

  channelConfigManager.invalidateCache()
  return c.json({ success: true })
})

/**
 * POST /reply — Send a reply from an agent execution to a Telegram chat.
 * Called by the telegram_reply MCP tool in agent-runner.
 * Auth: Bearer token (same as other agent API calls).
 */
app.use('/reply', requireAuth)
app.post('/reply', async (c) => {
  if (!telegramChannel.isConfigured) {
    return c.json({ error: 'Telegram not configured' }, 503)
  }

  const body = await c.req.json()
  const { chatId, message, executionId: execId, nodeId: nId, projectId: pId } = body as {
    chatId?: string
    message?: string
    executionId?: string
    nodeId?: string
    projectId?: string
  }

  if (!chatId || typeof chatId !== 'string') {
    return c.json({ error: 'chatId is required' }, 400)
  }
  if (!message || typeof message !== 'string') {
    return c.json({ error: 'message is required' }, 400)
  }

  const result = await telegramChannel.sendAgentReply(chatId, message, {
    executionId: execId,
    nodeId: nId,
    projectId: pId,
  })

  if (!result.success) {
    return c.json({ error: result.error || 'Failed to send message' }, 500)
  }

  return c.json({ success: true })
})

/** POST /setup-webhook — Register the Telegram webhook URL (admin) */
app.post('/setup-webhook', async (c) => {
  const botToken = telegramChannel.getBotToken()
  if (!botToken) {
    return c.json({ error: 'Telegram bot not configured' }, 503)
  }

  const body = await c.req.json()
  let webhookUrl = body.url as string | undefined

  // Auto-detect webhook URL if not provided
  if (!webhookUrl) {
    const baseUrl = process.env.ASTRO_BASE_URL || process.env.FRONTEND_URL
    if (!baseUrl) {
      return c.json({ error: 'Provide "url" in body or set ASTRO_BASE_URL env var' }, 400)
    }
    webhookUrl = `${baseUrl}/api/telegram/webhook`
  }

  const params: Record<string, unknown> = { url: webhookUrl }
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (webhookSecret) {
    params.secret_token = webhookSecret
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  const data = await response.json()
  return c.json(data)
})

export const telegramRoute = app
