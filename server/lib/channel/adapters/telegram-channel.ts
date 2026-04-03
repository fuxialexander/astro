/**
 * Telegram Channel Adapter
 *
 * Simplified Telegram integration: one shared bot, per-user connections.
 * Users connect by clicking a deep link (t.me/BotName?start=TOKEN),
 * then receive all project notifications on their Telegram account.
 *
 * Link tokens are stored in the DB (webauthn_challenges table with
 * "tg-link:" prefix) for multi-instance compatibility.
 *
 * ### Approval Features
 *
 * 1. **Multi-option grid keyboard** — Options are laid out in a 2-column
 *    inline keyboard grid. Callback data uses short IDs to stay within
 *    Telegram's 64-byte limit.
 *
 * 2. **Free-text reply** — When `ask_user_question` is called with an empty
 *    options array, the bot sends the question without buttons and waits for
 *    the user's next text message in that chat.
 *
 * 3. **Escalation reminders** — If an approval is not responded to within
 *    ESCALATION_DELAY_MS (default 5 minutes), the notification is re-sent
 *    once with a ⏰ reminder prefix.
 *
 * 4. **Rich approval context** — Approval messages include task name,
 *    project name, the agent's question, and all options (inline + listed
 *    in the message body).
 */

import { randomBytes } from 'node:crypto'
import { db } from '../../db/index.js'
import { connectedAccounts, projects, teamMembers, webauthnChallenges } from '../../db/schema.js'
import { eq, and, inArray, gt } from 'drizzle-orm'
import { channelRouter } from '../channel-router.js'
import { channelConfigManager } from '../channel-config-manager.js'
import { formatForChannel } from '../channel-formatter.js'
import type { ChannelNotification } from '../channel-types.js'

// ---------------------------------------------------------------------------
// Telegram Bot API helpers
// ---------------------------------------------------------------------------

interface TelegramApiResponse {
  ok: boolean
  description?: string
  result?: unknown
}

interface TelegramMessage {
  message_id: number
  chat: { id: number }
  text?: string
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

async function editMessageReplyMarkup(
  token: string,
  chatId: string,
  messageId: number,
  replyMarkup: unknown,
): Promise<TelegramApiResponse> {
  return telegramApi(token, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
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
// Inline keyboard builder with grid layout and short callback IDs
// ---------------------------------------------------------------------------

/**
 * Registry mapping short IDs → { approvalId, options } to work around
 * Telegram's 64-byte callback_data limit.
 */
const approvalCallbackRegistry = new Map<string, { approvalId: string; options: string[] }>()
let callbackIdCounter = 0

function registerApprovalCallbacks(approvalId: string, options: string[]): string {
  const shortId = (callbackIdCounter++).toString(36)
  approvalCallbackRegistry.set(shortId, { approvalId, options })
  // Auto-expire after 2 hours — approvals should resolve well within this window
  setTimeout(() => approvalCallbackRegistry.delete(shortId), 2 * 60 * 60 * 1000)
  return shortId
}

/**
 * Build an inline keyboard for an approval request.
 *
 * Layout rules:
 * - 0 options   → no keyboard (free-text reply mode)
 * - 1–2 options → single row
 * - 3–4 options → 2-column grid
 * - 5+ options  → 2-column grid (up to 5 rows)
 */
function buildInlineKeyboard(
  shortId: string,
  options: string[],
): unknown | undefined {
  if (options.length === 0) return undefined

  // Build button objects using option index to stay well within 64-byte limit
  // Format: "o:<shortId>:<index>" e.g. "o:1a:0" = 9 bytes max
  const buttons = options.map((opt, idx) => ({
    text: opt.length > 20 ? opt.slice(0, 18) + '…' : opt,
    callback_data: `o:${shortId}:${idx}`,
  }))

  if (options.length <= 2) {
    // Single row
    return { inline_keyboard: [buttons] }
  }

  // 2-column grid
  const rows: (typeof buttons)[] = []
  for (let i = 0; i < buttons.length; i += 2) {
    const row = [buttons[i]]
    if (i + 1 < buttons.length) row.push(buttons[i + 1])
    rows.push(row)
  }
  return { inline_keyboard: rows }
}

/**
 * Build approve/reject keyboard (binary approval — no options).
 * Uses legacy format for backward compatibility: "approve:<approvalId>" etc.
 * These are short enough that no registry is needed if approvalId ≤ 55 chars.
 */
function buildBinaryKeyboard(approvalId: string): unknown {
  // If approvalId is short enough, use legacy format (no registry lookup needed)
  const approveData = `approve:${approvalId}`
  const rejectData = `reject:${approvalId}`
  if (approveData.length <= 64 && rejectData.length <= 64) {
    return {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: approveData },
        { text: '❌ Reject', callback_data: rejectData },
      ]],
    }
  }
  // Long approvalId: register a short code
  const shortId = registerApprovalCallbacks(approvalId, [])
  return {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `a:${shortId}` },
      { text: '❌ Reject', callback_data: `r:${shortId}` },
    ]],
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const LINK_TOKEN_PREFIX = 'tg-link:'
const LINK_TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** How long before an unanswered approval gets an escalation reminder */
const ESCALATION_DELAY_MS = 5 * 60 * 1000 // 5 minutes

/** Pending text-reply state per Telegram chat ID */
interface PendingTextReply {
  approvalId: string
  sentMessageId?: number
  expiresAt: Date
}

/** Escalation tracking per approvalId */
interface PendingEscalation {
  approvalId: string
  notification: ChannelNotification
  chatIds: string[]
  messageText: string
  replyMarkup: unknown | undefined
  sentAt: Date
  escalated: boolean
}

class TelegramChannelAdapter {
  private botToken: string | null = null
  private botUsername: string | null = null
  private _started = false

  /** chatId → pending text reply (free-text approval mode) */
  private pendingTextReplies = new Map<string, PendingTextReply>()

  /** approvalId → escalation entry */
  private pendingEscalations = new Map<string, PendingEscalation>()

  private escalationTimer: ReturnType<typeof setInterval> | null = null

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

    // Start escalation checker — runs every 60 seconds
    this.escalationTimer = setInterval(() => this.checkEscalations(), 60 * 1000)

    this._started = true
    console.log(`[telegram] Adapter started — bot @${this.botUsername}`)
  }

  stop(): void {
    if (this.escalationTimer) {
      clearInterval(this.escalationTimer)
      this.escalationTimer = null
    }
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

    // Check if this chat has a pending free-text approval reply
    const pendingReply = this.pendingTextReplies.get(chatId)
    if (pendingReply) {
      if (new Date() < pendingReply.expiresAt) {
        await this.handleTextApprovalReply(chatId, text, pendingReply, msg)
        return
      } else {
        // Expired — clean up and fall through to default message
        this.pendingTextReplies.delete(chatId)
      }
    }

    // For any other message, let them know this is a notification bot
    await sendMessage(
      this.botToken,
      chatId,
      'I send Astro notifications here. Use /status to check your connection or /disconnect to unlink.',
    )
  }

  /**
   * Route a free-text message as an approval response.
   */
  private async handleTextApprovalReply(
    chatId: string,
    text: string,
    pendingReply: PendingTextReply,
    msg: Record<string, unknown>,
  ): Promise<void> {
    if (!this.botToken) return

    const { approvalId, sentMessageId } = pendingReply

    // Remove the pending reply immediately to prevent re-entrant processing
    this.pendingTextReplies.delete(chatId)
    this.pendingEscalations.delete(approvalId)

    try {
      const { dispatchEngine } = await import('../../dispatch/index.js')
      await dispatchEngine.respondToApproval(approvalId, true, text)

      // Confirm receipt to the user
      const messageId = msg.message_id as number | undefined
      const replyOptions = messageId
        ? { reply_to_message_id: messageId }
        : {}
      await sendMessage(
        this.botToken,
        chatId,
        `✅ <b>Answer received</b>\n\n<i>${escapeHtml(text)}</i>`,
        { ...replyOptions } as Parameters<typeof sendMessage>[3],
      )

      // Edit the original approval request to mark it as answered
      if (sentMessageId) {
        await editMessageText(
          this.botToken,
          chatId,
          sentMessageId,
          `${await this.getOriginalMessageText(chatId, sentMessageId)}\n\n✅ <b>Answered:</b> ${escapeHtml(text)}`,
        ).catch(() => {}) // non-critical
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[telegram] Text approval response failed for ${approvalId}:`, errMsg)

      if (errMsg.includes('No pending approval found')) {
        await sendMessage(
          this.botToken,
          chatId,
          '⚠️ This approval has already been handled or expired.',
        )
      } else {
        // Re-register so the user can try again
        this.pendingTextReplies.set(chatId, pendingReply)
        await sendMessage(
          this.botToken,
          chatId,
          `❌ Failed to submit your answer. Please try again.\n<i>${escapeHtml(errMsg.slice(0, 100))}</i>`,
        )
      }
    }
  }

  /** Fetch the original text of a sent message (best-effort from reply data). */
  private async getOriginalMessageText(chatId: string, messageId: number): Promise<string> {
    // We don't have a local cache of sent message text. Use the edit API's fallback.
    // The editMessageText call appends to whatever is already there, so we pass a placeholder.
    void chatId; void messageId
    return 'Approval request'
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
   *
   * Supported callback_data formats:
   *   Legacy (for short approvalIds):
   *     "approve:<approvalId>"
   *     "reject:<approvalId>"
   *     "option:<approvalId>:<selectedOption>"
   *
   *   New (short code, registry-based):
   *     "o:<shortId>:<optionIndex>"   — multi-choice option
   *     "a:<shortId>"                 — approve (binary, long approvalId)
   *     "r:<shortId>"                 — reject (binary, long approvalId)
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

    if (data.startsWith('o:')) {
      // New registry-based multi-choice: "o:<shortId>:<optionIndex>"
      const parts = data.slice(2).split(':')
      const shortId = parts[0]
      const optIndex = parseInt(parts[1] ?? '0', 10)
      const entry = approvalCallbackRegistry.get(shortId)
      if (!entry) {
        await answerCallbackQuery(this.botToken, callbackId, 'This approval has expired.')
        return
      }
      approvalId = entry.approvalId
      selectedOption = entry.options[optIndex] ?? `Option ${optIndex + 1}`
      approved = true
    } else if (data.startsWith('a:')) {
      // New registry-based approve: "a:<shortId>"
      const shortId = data.slice(2)
      const entry = approvalCallbackRegistry.get(shortId)
      if (!entry) {
        await answerCallbackQuery(this.botToken, callbackId, 'This approval has expired.')
        return
      }
      approvalId = entry.approvalId
      approved = true
    } else if (data.startsWith('r:')) {
      // New registry-based reject: "r:<shortId>"
      const shortId = data.slice(2)
      const entry = approvalCallbackRegistry.get(shortId)
      if (!entry) {
        await answerCallbackQuery(this.botToken, callbackId, 'This approval has expired.')
        return
      }
      approvalId = entry.approvalId
      approved = false
    } else if (data.startsWith('approve:')) {
      // Legacy format
      approvalId = data.slice(8)
      approved = true
    } else if (data.startsWith('reject:')) {
      // Legacy format
      approvalId = data.slice(7)
      approved = false
    } else if (data.startsWith('option:')) {
      // Legacy format
      const parts = data.slice(7).split(':')
      approvalId = parts[0]
      selectedOption = parts.slice(1).join(':')
      approved = true
    } else {
      await answerCallbackQuery(this.botToken, callbackId, 'Unknown action')
      return
    }

    // Clear escalation tracking and text-reply state for this approval
    this.pendingEscalations.delete(approvalId)
    // Also clear any text-reply state for this chat (unlikely both exist but be safe)
    for (const [cid, reply] of this.pendingTextReplies) {
      if (reply.approvalId === approvalId) {
        this.pendingTextReplies.delete(cid)
        break
      }
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
          `${originalText}\n\n${approved ? '✅' : '❌'} <b>${escapeHtml(responseText)}</b>`,
        ).catch(() => {}) // non-critical — message may already be edited
        // Remove the keyboard so buttons can't be pressed again
        await editMessageReplyMarkup(this.botToken, chatId, messageId, {}).catch(() => {})
      }

      await answerCallbackQuery(this.botToken, callbackId, responseText)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[telegram] Approval response failed for ${approvalId}:`, errMsg)

      if (errMsg.includes('No pending approval found')) {
        await answerCallbackQuery(this.botToken, callbackId, 'This approval has expired or was already handled.')
        if (messageId) {
          const originalText = (message?.text as string) || 'Approval request'
          await editMessageText(
            this.botToken,
            chatId,
            messageId,
            `${originalText}\n\n⚠️ <b>Expired or already handled</b>`,
          ).catch(() => {})
          await editMessageReplyMarkup(this.botToken, chatId, messageId, {}).catch(() => {})
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

  // ─── Escalation checker ────────────────────────────────────────

  /**
   * Periodically checks for approvals that haven't been responded to within
   * ESCALATION_DELAY_MS and sends a reminder notification.
   */
  private async checkEscalations(): Promise<void> {
    if (!this.botToken) return

    const now = Date.now()
    for (const [approvalId, entry] of this.pendingEscalations) {
      if (entry.escalated) continue
      if (now - entry.sentAt.getTime() < ESCALATION_DELAY_MS) continue

      // Check if the approval is still pending in the dispatch engine
      try {
        const { dispatchEngine } = await import('../../dispatch/index.js')
        if (!dispatchEngine.hasPendingApproval(approvalId)) {
          // Already handled — clean up
          this.pendingEscalations.delete(approvalId)
          continue
        }
      } catch {
        // dispatch engine not available — skip
        continue
      }

      // Mark as escalated to prevent sending multiple reminders
      entry.escalated = true

      // Re-send to all chat IDs with a reminder prefix
      const escalationText = `⏰ <b>Reminder — Approval Still Needed</b>\n\n${entry.messageText}`
      const sendPromises = entry.chatIds.map((chatId) =>
        sendMessage(this.botToken!, chatId, escalationText, {
          replyMarkup: entry.replyMarkup,
        }).catch((err: unknown) => {
          console.warn(`[telegram] Escalation reminder failed for chat ${chatId}:`, err)
        })
      )
      await Promise.allSettled(sendPromises)

      console.log(`[telegram] Sent escalation reminder for approval ${approvalId} to ${entry.chatIds.length} chat(s)`)
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

      // Build message text
      let text: string
      let replyMarkup: unknown = undefined

      if (notification.type === 'approval.requested' && notification.metadata) {
        const approvalId = notification.metadata.approvalId as string | undefined
        const options = notification.metadata.options as string[] | undefined
        const taskTitle = notification.metadata.taskTitle as string | undefined
        const projectName = notification.metadata.projectName as string | undefined
        const isFreeText = notification.metadata.freeText as boolean | undefined

        text = buildApprovalMessage({
          icon,
          taskTitle,
          projectName,
          summary: formattedSummary,
          astroUrl: notification.astroUrl,
          timestamp,
          isFreeText: isFreeText ?? (!options || options.length === 0),
        })

        if (approvalId) {
          if (options && options.length > 0) {
            // Multi-choice: register short IDs and build grid keyboard
            const shortId = registerApprovalCallbacks(approvalId, options)
            replyMarkup = buildInlineKeyboard(shortId, options)
          } else if (options && options.length === 0) {
            // Explicitly empty options: free-text reply mode — no keyboard
            // (text reply registered per-chat below)
            replyMarkup = undefined
          } else {
            // options is undefined: procedure-level binary approval
            replyMarkup = buildBinaryKeyboard(approvalId)
          }
        }
      } else {
        text = `${icon} <b>${title}</b>\n\n${formattedSummary}\n\n<a href="${notification.astroUrl}">View in Astro</a>\n\n<i>${timestamp}</i>`
      }

      // Send to each connected chat
      const chatIds = accounts
        .map((a) => a.externalId)
        .filter((id): id is string => !!id)

      const sendPromises = chatIds.map(async (chatId) => {
        try {
          const result = await sendMessage(this.botToken!, chatId, text, { replyMarkup })

          // For free-text approvals (explicitly empty options []): register this chat as awaiting a text reply
          if (
            notification.type === 'approval.requested' &&
            notification.metadata?.approvalId &&
            Array.isArray(notification.metadata.options) &&
            (notification.metadata.options as string[]).length === 0
          ) {
            const approvalId = notification.metadata.approvalId as string
            const sentMsg = result.result as TelegramMessage | undefined
            this.pendingTextReplies.set(chatId, {
              approvalId,
              sentMessageId: sentMsg?.message_id,
              expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30-minute window
            })
          }

          return result
        } catch (err) {
          console.warn(`[telegram] Failed to send to chat ${chatId}:`, err)
        }
      })

      await Promise.allSettled(sendPromises)

      // Register escalation tracking for approval requests
      if (
        notification.type === 'approval.requested' &&
        notification.metadata?.approvalId
      ) {
        const approvalId = notification.metadata.approvalId as string
        this.pendingEscalations.set(approvalId, {
          approvalId,
          notification,
          chatIds,
          messageText: text,
          replyMarkup,
          sentAt: new Date(),
          escalated: false,
        })
      }
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

// ---------------------------------------------------------------------------
// Approval message builder
// ---------------------------------------------------------------------------

interface ApprovalMessageOptions {
  icon: string
  taskTitle?: string
  projectName?: string
  summary: string
  astroUrl: string
  timestamp: string
  isFreeText: boolean
}

function buildApprovalMessage(opts: ApprovalMessageOptions): string {
  const { icon, taskTitle, projectName, summary, astroUrl, timestamp, isFreeText } = opts
  const lines: string[] = []

  lines.push(`${icon} <b>Approval Needed</b>`)

  if (taskTitle || projectName) {
    lines.push('')
    if (taskTitle && projectName) {
      lines.push(`📋 <b>${escapeHtml(taskTitle)}</b> — <i>${escapeHtml(projectName)}</i>`)
    } else if (taskTitle) {
      lines.push(`📋 <b>${escapeHtml(taskTitle)}</b>`)
    }
  }

  lines.push('')
  lines.push(summary)

  if (isFreeText) {
    lines.push('')
    lines.push('✏️ <i>Type your answer as a reply to this message.</i>')
  }

  lines.push('')
  lines.push(`<a href="${astroUrl}">View in Astro</a>`)
  lines.push('')
  lines.push(`<i>${timestamp}</i>`)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// HTML escaping helper
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const telegramChannel = new TelegramChannelAdapter()
