/**
 * Telegram Channel Adapter
 *
 * Simplified Telegram integration: one shared bot, per-user connections.
 * Users connect by clicking a deep link (t.me/BotName?start=TOKEN),
 * then receive all project notifications on their Telegram account.
 *
 * Link tokens are stored in the DB (webauthn_challenges table with
 * "tg-link:" prefix) for multi-instance compatibility.
 */

import { randomBytes } from 'node:crypto'
import { db } from '../../db/index.js'
import { connectedAccounts, projects, teamMembers, webauthnChallenges } from '../../db/schema.js'
import { eq, and, inArray, gt } from 'drizzle-orm'
import { channelRouter } from '../channel-router.js'
import { formatForChannel } from '../channel-formatter.js'
import { channelConfigManager } from '../channel-config-manager.js'
import type { ChannelNotification } from '../channel-types.js'

// ---------------------------------------------------------------------------
// Telegram Bot API helpers (inlined from deleted plugin)
// ---------------------------------------------------------------------------

interface TelegramApiResponse {
  ok: boolean
  description?: string
  result?: unknown
}

async function telegramApi(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<TelegramApiResponse> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return (await response.json()) as TelegramApiResponse
}

async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML'
): Promise<TelegramApiResponse> {
  return telegramApi(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
  })
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const LINK_TOKEN_PREFIX = 'tg-link:'
const LINK_TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes

class TelegramChannelAdapter {
  private botToken: string | null = null
  private botUsername: string | null = null
  private _started = false

  get isConfigured(): boolean {
    return this.botToken !== null && this.botUsername !== null
  }

  get isStarted(): boolean {
    return this._started
  }

  /**
   * Start the adapter: validate bot token, resolve username,
   * register as global notification sender.
   */
  async start(): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) {
      console.log('[telegram] No TELEGRAM_BOT_TOKEN configured — adapter disabled')
      return
    }

    // Validate token and get bot username
    const me = await telegramApi(token, 'getMe')
    if (!me.ok || !me.result) {
      console.error('[telegram] getMe failed — check TELEGRAM_BOT_TOKEN:', me.description)
      return
    }

    const botInfo = me.result as { username?: string; first_name?: string }
    this.botToken = token
    this.botUsername = botInfo.username || process.env.TELEGRAM_BOT_USERNAME || null

    if (!this.botUsername) {
      console.error('[telegram] Could not determine bot username — adapter disabled')
      this.botToken = null
      return
    }

    // Register global notification sender (fires for ALL projects)
    channelRouter.registerGlobalNotificationSender('telegram', async (notification) => {
      await this.sendNotificationToProjectMembers(notification)
    })

    this._started = true
    console.log(`[telegram] Adapter started — bot @${this.botUsername}`)
  }

  stop(): void {
    this._started = false
    console.log('[telegram] Adapter stopped')
  }

  // ─── Link flow ──────────────────────────────────────────────────

  /**
   * Generate a one-time link token for a user.
   * Returns the t.me deep-link URL.
   */
  async generateLinkToken(userId: string): Promise<{ url: string; token: string }> {
    if (!this.botUsername) {
      throw new Error('Telegram adapter not configured')
    }

    const token = randomBytes(24).toString('base64url')
    const key = `${LINK_TOKEN_PREFIX}${token}`
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS)

    // Store in DB (webauthn_challenges table, reusing existing infrastructure)
    await db.insert(webauthnChallenges)
      .values({ key, challenge: userId, expiresAt })
      .onConflictDoUpdate({
        target: webauthnChallenges.key,
        set: { challenge: userId, expiresAt },
      })

    const url = `https://t.me/${this.botUsername}?start=${token}`
    return { url, token }
  }

  /**
   * Consume a link token. Returns the userId if valid, null otherwise.
   */
  async consumeLinkToken(token: string): Promise<string | null> {
    const key = `${LINK_TOKEN_PREFIX}${token}`
    const now = new Date()

    const rows = await db.delete(webauthnChallenges)
      .where(
        and(
          eq(webauthnChallenges.key, key),
          gt(webauthnChallenges.expiresAt, now),
        )
      )
      .returning()

    if (rows.length === 0) return null
    return rows[0].challenge // This is the userId we stored
  }

  // ─── Webhook handler ───────────────────────────────────────────

  /**
   * Handle a Telegram Update (webhook payload).
   */
  async handleUpdate(update: Record<string, unknown>): Promise<void> {
    if (!this.botToken) return

    const msg = update.message as Record<string, unknown> | undefined
    if (!msg?.text) return

    const text = msg.text as string
    const chatId = String((msg.chat as Record<string, unknown>).id)
    const from = msg.from as Record<string, unknown> | undefined

    // Ignore bot messages
    if (from?.is_bot) return

    // Handle /start <token> command
    if (text.startsWith('/start ')) {
      const token = text.slice(7).trim()
      await this.handleStartCommand(token, chatId)
      return
    }

    // Handle /start without token (user just opened the bot)
    if (text === '/start') {
      await sendMessage(
        this.botToken,
        chatId,
        'Welcome! To connect your Telegram to Astro, use the link from your Astro Settings page.',
      )
      return
    }

    // Handle /status command
    if (text === '/status') {
      await this.handleStatusCommand(chatId)
      return
    }

    // Handle /disconnect command
    if (text === '/disconnect') {
      await this.handleDisconnectCommand(chatId)
      return
    }

    // For any other message, let them know this is a notification bot
    await sendMessage(
      this.botToken,
      chatId,
      'I send Astro notifications here. Use /status to check your connection or /disconnect to unlink.',
    )
  }

  private async handleStartCommand(token: string, chatId: string): Promise<void> {
    if (!this.botToken) return

    const userId = await this.consumeLinkToken(token)
    if (!userId) {
      await sendMessage(
        this.botToken,
        chatId,
        'This link has expired or is invalid. Please generate a new one from Astro Settings.',
      )
      return
    }

    // Check if user already has a telegram connected account
    const existing = await db.select()
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.userId, userId),
          eq(connectedAccounts.channel, 'telegram'),
        )
      )
      .limit(1)

    if (existing.length > 0) {
      // Update existing row with new chat_id
      await db.update(connectedAccounts)
        .set({
          externalId: chatId,
          enabled: true,
          credentials: {},
          mappings: {},
          updatedAt: new Date(),
        })
        .where(eq(connectedAccounts.id, existing[0].id))
    } else {
      // Insert new connected account
      await db.insert(connectedAccounts)
        .values({
          userId,
          channel: 'telegram',
          label: 'Telegram Notifications',
          credentials: {},
          mappings: {},
          settings: {},
          externalId: chatId,
          enabled: true,
        })
    }

    channelConfigManager.invalidateCache()

    await sendMessage(
      this.botToken,
      chatId,
      'Connected! You will now receive Astro notifications here.\n\nUse /status to check your connection or /disconnect to unlink.',
    )
  }

  private async handleStatusCommand(chatId: string): Promise<void> {
    if (!this.botToken) return

    const rows = await db.select()
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.channel, 'telegram'),
          eq(connectedAccounts.externalId, chatId),
          eq(connectedAccounts.enabled, true),
        )
      )
      .limit(1)

    if (rows.length > 0) {
      await sendMessage(this.botToken, chatId, 'Your Telegram is connected to Astro. You will receive notifications for all your projects.')
    } else {
      await sendMessage(this.botToken, chatId, 'Your Telegram is not connected to Astro. Use the link from Astro Settings to connect.')
    }
  }

  private async handleDisconnectCommand(chatId: string): Promise<void> {
    if (!this.botToken) return

    const rows = await db.delete(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.channel, 'telegram'),
          eq(connectedAccounts.externalId, chatId),
        )
      )
      .returning()

    channelConfigManager.invalidateCache()

    if (rows.length > 0) {
      await sendMessage(this.botToken, chatId, 'Disconnected. You will no longer receive Astro notifications here.')
    } else {
      await sendMessage(this.botToken, chatId, 'No active connection found.')
    }
  }

  // ─── Notification fan-out ──────────────────────────────────────

  /**
   * Send a notification to all project members who have Telegram connected.
   * Resolves project → team → members → connected_accounts.
   */
  private async sendNotificationToProjectMembers(notification: ChannelNotification): Promise<void> {
    if (!this.botToken) return

    try {
      // Look up the project to get teamId and ownerId
      const [project] = await db.select({
        teamId: projects.teamId,
        ownerId: projects.ownerId,
      })
        .from(projects)
        .where(eq(projects.id, notification.projectId))
        .limit(1)

      if (!project) return

      // Collect user IDs to notify
      let userIds: string[] = []

      if (project.teamId) {
        // Get all team members
        const members = await db.select({ userId: teamMembers.userId })
          .from(teamMembers)
          .where(eq(teamMembers.teamId, project.teamId))

        userIds = members.map((m) => m.userId)
      }

      // Always include the owner
      if (!userIds.includes(project.ownerId)) {
        userIds.push(project.ownerId)
      }

      if (userIds.length === 0) return

      // Get all Telegram-connected accounts for these users
      const accounts = await db.select({
        externalId: connectedAccounts.externalId,
      })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.channel, 'telegram'),
            eq(connectedAccounts.enabled, true),
            inArray(connectedAccounts.userId, userIds),
          )
        )

      if (accounts.length === 0) return

      // Format notification
      const text = formatForChannel(
        `<b>${notification.type.replace('.', ' ').toUpperCase()}</b>\n${notification.summary}\n\n<a href="${notification.astroUrl}">View in Astro</a>`,
        'telegram_html'
      )

      // Send to each connected chat
      const sendPromises = accounts
        .filter((a) => a.externalId)
        .map((a) =>
          sendMessage(this.botToken!, a.externalId!, text).catch((err) => {
            console.warn(`[telegram] Failed to send to chat ${a.externalId}:`, err)
          })
        )

      await Promise.allSettled(sendPromises)
    } catch (err) {
      console.error('[telegram] Error sending notification:', err)
    }
  }

  // ─── Public accessors for route handlers ───────────────────────

  getBotToken(): string | null {
    return this.botToken
  }

  getBotUsername(): string | null {
    return this.botUsername
  }
}

export const telegramChannel = new TelegramChannelAdapter()
