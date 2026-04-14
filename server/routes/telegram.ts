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
import { connectedAccounts, projects, teamMembers } from '../lib/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { channelConfigManager } from '../lib/channel/channel-config-manager.js'
import { setWebhook } from '../lib/channel/adapters/telegram-api.js'

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

// ── Authenticated endpoints ──────────────────────────────────────

app.use('/link', requireAuth)
app.use('/status', requireAuth)
app.use('/disconnect', requireAuth)
app.use('/setup-webhook', requireAuth)

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

  // Verify the authenticated user owns a connected Telegram account for this chatId,
  // OR that the projectId belongs to a project the user's team owns.
  const user = c.get('user') as AuthUser
  let authorized = false

  if (pId) {
    // Check project team membership
    const [membership] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
      .where(and(eq(teamMembers.userId, user.id), eq(projects.id, pId)))
      .limit(1)
    authorized = !!membership
  }

  if (!authorized) {
    // Fall back: check if the authenticated user owns a Telegram account matching chatId
    const [account] = await db
      .select({ externalId: connectedAccounts.externalId })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.userId, user.id),
          eq(connectedAccounts.channel, 'telegram'),
          eq(connectedAccounts.enabled, true),
        ),
      )
      .limit(1)
    authorized = !!account && account.externalId === chatId
  }

  if (!authorized) {
    return c.json({ error: 'Unauthorized: chatId does not belong to this user' }, 403)
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

/**
 * GET /topic-bindings — List all forum topic bindings for the authenticated user.
 * Returns an array of { key, groupChatId, threadId, projectId } objects.
 */
app.use('/topic-bindings', requireAuth)
app.use('/topic-bindings', requireTelegramFullClient)

app.get('/topic-bindings', async (c) => {
  const user = c.get('user') as AuthUser

  const rows = await db
    .select({
      id: connectedAccounts.id,
      mappings: connectedAccounts.mappings,
    })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, user.id),
        eq(connectedAccounts.channel, 'telegram'),
        eq(connectedAccounts.enabled, true),
      ),
    )
    .limit(1)

  if (rows.length === 0) {
    return c.json({ bindings: [] })
  }

  const mappings = ((rows[0].mappings ?? {}) as Record<string, string>)
  const TOPIC_KEY_RE = /^(-?\d+):topic:(\d+)$/

  const bindings = Object.entries(mappings)
    .filter(([k]) => TOPIC_KEY_RE.test(k))
    .map(([key, projectId]) => {
      const m = TOPIC_KEY_RE.exec(key)!
      return {
        key,
        groupChatId: m[1],
        threadId: m[2],
        projectId,
      }
    })

  return c.json({ bindings })
})

/**
 * POST /topic-bindings — Create or update a topic → project binding via REST API.
 * Body: { groupChatId: string, threadId: string, projectId: string }
 */
app.post('/topic-bindings', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json() as {
    groupChatId?: string
    threadId?: string
    projectId?: string
  }

  const { groupChatId, threadId, projectId } = body
  if (!groupChatId || !threadId || !projectId) {
    return c.json({ error: 'groupChatId, threadId, and projectId are required' }, 400)
  }

  const rows = await db
    .select({ id: connectedAccounts.id, mappings: connectedAccounts.mappings })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, user.id),
        eq(connectedAccounts.channel, 'telegram'),
        eq(connectedAccounts.enabled, true),
      ),
    )
    .limit(1)

  if (rows.length === 0) {
    return c.json({ error: 'No Telegram account connected' }, 404)
  }

  const account = rows[0]
  const currentMappings = ((account.mappings ?? {}) as Record<string, string>)
  const mappingKey = `${groupChatId}:topic:${threadId}`
  const updatedMappings = { ...currentMappings, [mappingKey]: projectId }

  await db
    .update(connectedAccounts)
    .set({ mappings: updatedMappings, updatedAt: new Date() })
    .where(eq(connectedAccounts.id, account.id))

  channelConfigManager.invalidateCache()

  return c.json({ success: true, key: mappingKey, projectId })
})

/**
 * DELETE /topic-bindings/:groupChatId/:threadId — Remove a topic binding.
 */
app.delete('/topic-bindings/:groupChatId/:threadId', requireAuth, requireTelegramFullClient, async (c) => {
  const user = c.get('user') as AuthUser
  const groupChatId = c.req.param('groupChatId')
  const threadId = c.req.param('threadId')

  const rows = await db
    .select({ id: connectedAccounts.id, mappings: connectedAccounts.mappings })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, user.id),
        eq(connectedAccounts.channel, 'telegram'),
        eq(connectedAccounts.enabled, true),
      ),
    )
    .limit(1)

  if (rows.length === 0) {
    return c.json({ error: 'No Telegram account connected' }, 404)
  }

  const account = rows[0]
  const mappingKey = `${groupChatId}:topic:${threadId}`
  const currentMappings = ((account.mappings ?? {}) as Record<string, string>)

  if (!currentMappings[mappingKey]) {
    return c.json({ error: 'Binding not found' }, 404)
  }

  const updatedMappings = Object.fromEntries(
    Object.entries(currentMappings).filter(([k]) => k !== mappingKey),
  )

  await db
    .update(connectedAccounts)
    .set({ mappings: updatedMappings, updatedAt: new Date() })
    .where(eq(connectedAccounts.id, account.id))

  channelConfigManager.invalidateCache()

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

  const data = await setWebhook(botToken, webhookUrl, {
    secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowedUpdates: ['message', 'callback_query', 'message_reaction', 'edited_message'],
    dropPendingUpdates: false,
  })
  return c.json(data)
})

export const telegramRoute = app
