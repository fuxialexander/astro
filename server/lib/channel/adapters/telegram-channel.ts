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
import { channelConfigManager } from '../channel-config-manager.js'
import { formatForChannel } from '../channel-formatter.js'
import type { ChannelNotification } from '../channel-types.js'
import { commandRegistry, handleCommand, resolveUserFromChat } from './telegram-commands.js'
import {
  dispatchChatToTelegram,
  parseChatSession,
  parseDefaultProject,
  createFreshSession,
  saveChatSession,
} from './telegram-chat.js'

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
  options?: { parseMode?: 'HTML' | 'MarkdownV2'; replyMarkup?: unknown }
): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: options?.parseMode ?? 'HTML',
  }
  if (options?.replyMarkup) {
    body.reply_markup = options.replyMarkup
  }
  return telegramApi(token, 'sendMessage', body)
}

async function editMessageText(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<TelegramApiResponse> {
  return telegramApi(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
  })
}

async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<TelegramApiResponse> {
  return telegramApi(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
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

    // Register slash commands with Telegram Bot API
    await commandRegistry.registerWithTelegram(token)

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

    // Handle callback queries (inline keyboard button taps)
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query as Record<string, unknown>)
      return
    }

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

    // Handle /status command (connection status, not execution status)
    if (text === '/status') {
      await this.handleStatusCommand(chatId)
      return
    }

    // Handle /disconnect command
    if (text === '/disconnect') {
      await this.handleDisconnectCommand(chatId)
      return
    }

    // Route slash commands through the command registry
    if (text.startsWith('/')) {
      const response = await handleCommand(text, chatId, this.botToken)
      if (response) {
        await sendMessage(this.botToken, chatId, response)
      } else {
        // Unknown command
        await sendMessage(
          this.botToken,
          chatId,
          'Unknown command. Use /help to see available commands.',
        )
      }
      return
    }

    // Non-command text: route to chat session
    await this.handleChatMessage(text, chatId)
  }

  /**
   * Route a non-command message to the project chat.
   * Looks up the user's connected account, resolves the active project,
   * and dispatches the message via the relay with streaming edits.
   */
  private async handleChatMessage(text: string, chatId: string): Promise<void> {
    if (!this.botToken) return

    // Resolve user from chat ID
    const userId = await resolveUserFromChat(chatId)
    if (!userId) {
      await sendMessage(
        this.botToken,
        chatId,
        'You need to connect your Telegram first. Use the link from Astro Settings.',
      )
      return
    }

    // Load connected account for mappings
    const [account] = await db
      .select({
        mappings: connectedAccounts.mappings,
        userId: connectedAccounts.userId,
      })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.channel, 'telegram'),
          eq(connectedAccounts.externalId, chatId),
          eq(connectedAccounts.enabled, true),
        ),
      )
      .limit(1)

    if (!account) {
      await sendMessage(this.botToken, chatId, 'Your account is not connected. Use the link from Astro Settings.')
      return
    }

    const mappings = account.mappings as Record<string, unknown> | null

    // Resolve active project
    let projectId = parseDefaultProject(mappings)
    if (!projectId) {
      // Try to find an existing session
      const existingSession = parseChatSession(mappings)
      if (existingSession) {
        projectId = existingSession.projectId
      }
    }

    if (!projectId) {
      await sendMessage(
        this.botToken,
        chatId,
        'No project selected. Use <b>/bind &lt;project-id&gt;</b> to link a project, then chat freely.\n\nUse /projects to list your projects.',
        { parseMode: 'HTML' },
      )
      return
    }

    // Get or create chat session
    let session = parseChatSession(mappings)
    if (!session || session.projectId !== projectId) {
      session = createFreshSession(projectId)
    }

    // Dispatch chat
    try {
      const result = await dispatchChatToTelegram({
        botToken: this.botToken,
        chatId,
        userId,
        userMessage: text,
        session,
      })

      // Persist updated session (new sessionId, updated history)
      if (result.success || result.updatedMessages.length > session.messages.length) {
        await saveChatSession(chatId, {
          sessionId: result.newSessionId,
          streamId: session.streamId,
          projectId: session.projectId,
          messages: result.updatedMessages,
        })
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[telegram] Chat dispatch error for chat ${chatId}:`, errMsg)
      await sendMessage(
        this.botToken,
        chatId,
        `❌ Failed to process your message: ${errMsg.slice(0, 200)}`,
      )
    }
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

  /**
   * Handle inline keyboard button taps (approval responses).
   * Callback data format: "approve:<approvalId>" or "reject:<approvalId>"
   * or "option:<approvalId>:<selectedOption>"
   */
  private async handleCallbackQuery(query: Record<string, unknown>): Promise<void> {
    if (!this.botToken) return

    const callbackId = query.id as string
    const data = query.data as string | undefined
    const message = query.message as Record<string, unknown> | undefined
    const chatId = message ? String((message.chat as Record<string, unknown>).id) : null
    const messageId = message?.message_id as number | undefined

    if (!data || !chatId) {
      await answerCallbackQuery(this.botToken, callbackId, 'Invalid request')
      return
    }

    // Parse callback data
    let approvalId: string
    let approved: boolean
    let selectedOption: string | undefined

    if (data.startsWith('approve:')) {
      approvalId = data.slice(8)
      approved = true
    } else if (data.startsWith('reject:')) {
      approvalId = data.slice(7)
      approved = false
    } else if (data.startsWith('option:')) {
      const parts = data.slice(7).split(':')
      approvalId = parts[0]
      selectedOption = parts.slice(1).join(':')
      approved = true
    } else {
      await answerCallbackQuery(this.botToken, callbackId, 'Unknown action')
      return
    }

    // Call the approval API
    try {
      const { dispatchEngine } = await import('../../dispatch/index.js')
      await dispatchEngine.respondToApproval(approvalId, approved, selectedOption)

      // Update the message to show the response
      const responseText = approved
        ? (selectedOption ? `Approved: ${selectedOption}` : 'Approved')
        : 'Rejected'

      if (messageId) {
        const originalText = (message?.text as string) || 'Approval request'
        await editMessageText(
          this.botToken,
          chatId,
          messageId,
          `${originalText}\n\n✅ <b>${responseText}</b>`,
        )
      }

      await answerCallbackQuery(this.botToken, callbackId, responseText)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[telegram] Approval response failed for ${approvalId}:`, errMsg)

      // Try to give a useful error
      if (errMsg.includes('No pending approval found')) {
        await answerCallbackQuery(this.botToken, callbackId, 'This approval has expired or was already handled.')
        if (messageId) {
          const originalText = (message?.text as string) || 'Approval request'
          await editMessageText(this.botToken, chatId, messageId, `${originalText}\n\n⚠️ <b>Expired or already handled</b>`)
        }
      } else {
        await answerCallbackQuery(this.botToken, callbackId, `Error: ${errMsg.slice(0, 100)}`)
      }
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

      // Format notification with visual indicators
      const formattedSummary = formatForChannel(notification.summary, 'telegram_html')
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
      let icon: string
      let title: string
      switch (notification.type) {
        case 'task.completed':
          icon = '\u2705'
          title = 'Task Completed'
          break
        case 'task.failed':
          icon = '\u274C'
          title = 'Task Failed'
          break
        case 'approval.requested':
          icon = '\u270B'
          title = 'Approval Needed'
          break
        case 'branch.pruned':
          icon = '\u2702\uFE0F'
          title = 'Branch Pruned'
          break
        case 'project.completed':
          icon = '\uD83C\uDF89'
          title = 'Project Completed'
          break
        default:
          icon = '\u2139\uFE0F'
          title = notification.type.replace('.', ' ').toUpperCase()
      }
      const text = `${icon} <b>${title}</b>\n\n${formattedSummary}\n\n<a href="${notification.astroUrl}">View in Astro</a>\n\n<i>${timestamp}</i>`

      // Build inline keyboard for approval requests
      let replyMarkup: unknown = undefined
      if (notification.type === 'approval.requested' && notification.metadata) {
        const approvalId = notification.metadata.approvalId as string | undefined
        const options = notification.metadata.options as string[] | undefined

        if (approvalId) {
          if (options && options.length > 0) {
            // Show each option as a button
            replyMarkup = {
              inline_keyboard: options.map((opt) => ([
                { text: opt, callback_data: `option:${approvalId}:${opt}`.slice(0, 64) },
              ])),
            }
          } else {
            // Default approve/reject buttons
            replyMarkup = {
              inline_keyboard: [[
                { text: 'Approve', callback_data: `approve:${approvalId}` },
                { text: 'Reject', callback_data: `reject:${approvalId}` },
              ]],
            }
          }
        }
      }

      // Send to each connected chat
      const sendPromises = accounts
        .filter((a) => a.externalId)
        .map((a) =>
          sendMessage(this.botToken!, a.externalId!, text, { replyMarkup }).catch((err) => {
            console.warn(`[telegram] Failed to send to chat ${a.externalId}:`, err)
          })
        )

      await Promise.allSettled(sendPromises)
    } catch (err) {
      console.error('[telegram] Error sending notification:', err)
    }
  }

  // ─── Agent reply (telegram_reply MCP tool) ─────────────────────

  /**
   * Send a reply from an agent execution back to a Telegram chat.
   * Used by the telegram_reply MCP tool to enable proactive agent communication.
   */
  async sendAgentReply(
    chatId: string,
    message: string,
    metadata?: { executionId?: string; nodeId?: string; projectId?: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: 'Telegram adapter not configured' }
    }

    try {
      // Format the message with agent attribution
      const prefix = '🤖 <b>Agent Update</b>\n\n'
      const suffix = metadata?.executionId
        ? `\n\n<i>From execution ${metadata.executionId.slice(0, 8)}…</i>`
        : ''
      const fullMessage = `${prefix}${message}${suffix}`

      const result = await sendMessage(this.botToken, chatId, fullMessage)

      if (!result.ok) {
        return { success: false, error: result.description || 'Failed to send message' }
      }

      return { success: true }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[telegram] Agent reply failed for chat ${chatId}:`, errMsg)
      return { success: false, error: errMsg }
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
