/**
 * Telegram Channel Adapter
 *
 * Bidirectional Telegram integration: one shared bot, per-user connections.
 * Users connect by clicking a deep link (t.me/BotName?start=TOKEN),
 * then can both receive notifications AND send messages to Astro.
 *
 * Inbound messages are normalized into transport-agnostic InboundMessage
 * format (BotProtocol pattern) and routed to the Astro chat API via
 * channelRouter. Conversation state is tracked per chat_id.
 *
 * Link tokens are stored in the DB (webauthn_challenges table with
 * "tg-link:" prefix) for multi-instance compatibility.
 */

import { randomBytes } from 'node:crypto'
import { db } from '../../db/index.js'
import { connectedAccounts, projects, teamMembers, webauthnChallenges } from '../../db/schema.js'
import { eq, and, inArray, gt, desc } from 'drizzle-orm'
import { channelRouter } from '../channel-router.js'
import { channelConfigManager } from '../channel-config-manager.js'
import { formatForChannel } from '../channel-formatter.js'
import type { ChannelNotification, InboundMessage, OutboundResponse } from '../channel-types.js'

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
// Conversation state (per chat_id, in-memory — inherently per-process)
// ---------------------------------------------------------------------------

export interface ConversationState {
  /** The Astro userId linked to this chat */
  userId: string
  /** Active project for this conversation (set via /project command) */
  activeProjectId: string | null
  /** Timestamp of last activity */
  lastActivityAt: number
}

/** Max idle time before conversation state is evicted (30 minutes) */
const CONVERSATION_TTL_MS = 30 * 60 * 1000
/** Interval for evicting stale conversations (5 minutes) */
const EVICTION_INTERVAL_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// Normalized inbound message types (BotProtocol pattern)
// ---------------------------------------------------------------------------

export type TelegramMessageType = 'text' | 'command' | 'file' | 'photo'

export interface ParsedTelegramMessage {
  type: TelegramMessageType
  text: string
  chatId: string
  messageId: string
  senderId: string
  senderName: string
  /** For commands: the command name without leading slash */
  command?: string
  /** For commands: arguments after the command */
  commandArgs?: string
  /** For files: file metadata */
  file?: {
    fileId: string
    fileName?: string
    mimeType?: string
    fileSize?: number
    caption?: string
  }
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

  /** Per-chat conversation state tracking */
  private conversations = new Map<string, ConversationState>()
  private evictionTimer: ReturnType<typeof setInterval> | null = null

  get isConfigured(): boolean {
    return this.botToken !== null && this.botUsername !== null
  }

  get isStarted(): boolean {
    return this._started
  }

  /**
   * Start the adapter: validate bot token, resolve username,
   * register as global notification sender and response sender.
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

    // Register response sender so channelRouter can send replies back through Telegram
    channelRouter.registerResponseSender('telegram', async (response) => {
      await this.sendResponseToChat(response)
    })

    // Start conversation eviction timer
    this.evictionTimer = setInterval(() => this.evictStaleConversations(), EVICTION_INTERVAL_MS)

    this._started = true
    console.log(`[telegram] Adapter started — bot @${this.botUsername} (bidirectional)`)
  }

  stop(): void {
    this._started = false
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer)
      this.evictionTimer = null
    }
    this.conversations.clear()
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

  // ─── Message parsing (BotProtocol pattern) ─────────────────────

  /**
   * Parse a raw Telegram message into a normalized format.
   * Handles text messages, commands, photos, and documents.
   */
  parseMessage(msg: Record<string, unknown>): ParsedTelegramMessage | null {
    const chat = msg.chat as Record<string, unknown> | undefined
    const from = msg.from as Record<string, unknown> | undefined
    if (!chat || !from) return null

    // Ignore bot messages
    if (from.is_bot) return null

    const chatId = String(chat.id)
    const messageId = String(msg.message_id)
    const senderId = String(from.id)
    const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || senderId

    // Photo message (array of sizes, take highest resolution)
    const photo = msg.photo as Array<Record<string, unknown>> | undefined
    if (photo && photo.length > 0) {
      const bestPhoto = photo[photo.length - 1]
      return {
        type: 'photo',
        text: (msg.caption as string) || '',
        chatId,
        messageId,
        senderId,
        senderName,
        file: {
          fileId: bestPhoto.file_id as string,
          mimeType: 'image/jpeg',
          fileSize: bestPhoto.file_size as number | undefined,
          caption: msg.caption as string | undefined,
        },
      }
    }

    // Document message
    const document = msg.document as Record<string, unknown> | undefined
    if (document) {
      return {
        type: 'file',
        text: (msg.caption as string) || '',
        chatId,
        messageId,
        senderId,
        senderName,
        file: {
          fileId: document.file_id as string,
          fileName: document.file_name as string | undefined,
          mimeType: document.mime_type as string | undefined,
          fileSize: document.file_size as number | undefined,
          caption: msg.caption as string | undefined,
        },
      }
    }

    // Text message
    const text = msg.text as string | undefined
    if (!text) return null

    // Check if it's a command (starts with /)
    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ')
      const rawCommand = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1)
      // Strip @botname suffix from commands (e.g., /status@MyBot → status)
      const command = rawCommand.split('@')[0].toLowerCase()
      const commandArgs = spaceIdx > 0 ? text.slice(spaceIdx + 1).trim() : ''

      return {
        type: 'command',
        text,
        chatId,
        messageId,
        senderId,
        senderName,
        command,
        commandArgs,
      }
    }

    return {
      type: 'text',
      text,
      chatId,
      messageId,
      senderId,
      senderName,
    }
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
    if (!msg) return

    // Parse into normalized format
    const parsed = this.parseMessage(msg)
    if (!parsed) return

    // Handle commands
    if (parsed.type === 'command') {
      await this.handleCommand(parsed)
      return
    }

    // Route text/file/photo messages to chat
    await this.handleInboundMessage(parsed)
  }

  // ─── Command dispatch ────────────────────────────────────────

  /**
   * Dispatch bot commands to their handlers.
   */
  private async handleCommand(parsed: ParsedTelegramMessage): Promise<void> {
    if (!this.botToken) return

    switch (parsed.command) {
      case 'start':
        if (parsed.commandArgs) {
          await this.handleStartCommand(parsed.commandArgs, parsed.chatId)
        } else {
          await sendMessage(
            this.botToken,
            parsed.chatId,
            'Welcome to Astro! To connect your Telegram, use the link from your Astro Settings page.\n\nOnce connected, you can:\n• Send messages directly to chat with Astro AI\n• Use /project to select an active project\n• Use /projects to list your projects\n• Use /status to check your connection\n• Use /help for all commands',
          )
        }
        break
      case 'status':
        await this.handleStatusCommand(parsed.chatId)
        break
      case 'disconnect':
        await this.handleDisconnectCommand(parsed.chatId)
        break
      case 'project':
        await this.handleProjectCommand(parsed.chatId, parsed.commandArgs || '')
        break
      case 'projects':
        await this.handleProjectsCommand(parsed.chatId)
        break
      case 'help':
        await this.handleHelpCommand(parsed.chatId)
        break
      default:
        await sendMessage(
          this.botToken,
          parsed.chatId,
          `Unknown command: /${parsed.command}\nUse /help to see available commands.`,
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
          label: 'Telegram Chat',
          credentials: {},
          mappings: {},
          settings: {},
          externalId: chatId,
          enabled: true,
        })
    }

    channelConfigManager.invalidateCache()

    // Initialize conversation state
    this.conversations.set(chatId, {
      userId,
      activeProjectId: null,
      lastActivityAt: Date.now(),
    })

    await sendMessage(
      this.botToken,
      chatId,
      'Connected! You can now chat with Astro directly here.\n\nUse /project to select a project, or just send a message to start chatting.\n\nUse /help to see all commands.',
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
      const convo = this.conversations.get(chatId)
      const projectInfo = convo?.activeProjectId
        ? `\n\nActive project: <code>${convo.activeProjectId}</code>`
        : '\n\nNo active project set. Use /project &lt;name&gt; to set one.'

      await sendMessage(
        this.botToken,
        chatId,
        `Your Telegram is connected to Astro. You can send and receive messages here.${projectInfo}`,
      )
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
    this.conversations.delete(chatId)

    if (rows.length > 0) {
      await sendMessage(this.botToken, chatId, 'Disconnected. You will no longer receive Astro notifications here.')
    } else {
      await sendMessage(this.botToken, chatId, 'No active connection found.')
    }
  }

  /**
   * Set the active project for a chat. Accepts project name or ID.
   */
  private async handleProjectCommand(chatId: string, args: string): Promise<void> {
    if (!this.botToken) return

    const convo = await this.getOrCreateConversation(chatId)
    if (!convo) {
      await sendMessage(this.botToken, chatId, 'Your Telegram is not connected to Astro. Use the link from Astro Settings to connect.')
      return
    }

    if (!args) {
      if (convo.activeProjectId) {
        await sendMessage(this.botToken, chatId, `Active project: <code>${convo.activeProjectId}</code>\n\nUse /project &lt;name&gt; to change, or /projects to list all.`)
      } else {
        await sendMessage(this.botToken, chatId, 'No active project set.\n\nUse /project &lt;name&gt; to set one, or /projects to list available projects.')
      }
      return
    }

    // Look up project by name (case-insensitive partial match) or ID
    const userProjects = await this.getUserProjects(convo.userId)
    const searchLower = args.toLowerCase()

    const match = userProjects.find(
      (p) => p.id === args || p.name.toLowerCase() === searchLower
    ) || userProjects.find(
      (p) => p.name.toLowerCase().includes(searchLower)
    )

    if (!match) {
      await sendMessage(
        this.botToken,
        chatId,
        `No project found matching "${args}".\n\nUse /projects to see your available projects.`,
      )
      return
    }

    convo.activeProjectId = match.id
    convo.lastActivityAt = Date.now()

    await sendMessage(
      this.botToken,
      chatId,
      `Active project set to: <b>${match.name}</b>\n\nYou can now send messages about this project.`,
    )
  }

  /**
   * List user's projects.
   */
  private async handleProjectsCommand(chatId: string): Promise<void> {
    if (!this.botToken) return

    const convo = await this.getOrCreateConversation(chatId)
    if (!convo) {
      await sendMessage(this.botToken, chatId, 'Your Telegram is not connected to Astro. Use the link from Astro Settings to connect.')
      return
    }

    const userProjects = await this.getUserProjects(convo.userId)

    if (userProjects.length === 0) {
      await sendMessage(this.botToken, chatId, 'You have no projects yet. Create one in Astro first.')
      return
    }

    const lines = userProjects.slice(0, 20).map((p) => {
      const active = convo.activeProjectId === p.id ? ' ✅' : ''
      return `• <b>${p.name}</b>${active}`
    })

    const suffix = userProjects.length > 20 ? `\n\n... and ${userProjects.length - 20} more` : ''
    await sendMessage(
      this.botToken,
      chatId,
      `Your projects:\n\n${lines.join('\n')}${suffix}\n\nUse /project &lt;name&gt; to set active project.`,
    )
  }

  private async handleHelpCommand(chatId: string): Promise<void> {
    if (!this.botToken) return

    await sendMessage(
      this.botToken,
      chatId,
      '<b>Astro Bot Commands</b>\n\n'
      + '/project &lt;name&gt; — Set active project\n'
      + '/projects — List your projects\n'
      + '/status — Check connection status\n'
      + '/disconnect — Unlink your account\n'
      + '/help — Show this help\n\n'
      + '<b>Chat</b>\nJust type a message to chat with Astro AI about your active project. '
      + 'You can also send photos and documents.',
    )
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

  // ─── Inbound message routing ──────────────────────────────────

  /**
   * Route a non-command inbound message to the Astro chat API via channelRouter.
   * Normalizes the Telegram message into the transport-agnostic InboundMessage format.
   */
  private async handleInboundMessage(parsed: ParsedTelegramMessage): Promise<void> {
    if (!this.botToken) return

    // Get or create conversation state (validates user is connected)
    const convo = await this.getOrCreateConversation(parsed.chatId)
    if (!convo) {
      await sendMessage(
        this.botToken,
        parsed.chatId,
        'Your Telegram is not connected to Astro. Use the link from your Astro Settings page to connect.',
      )
      return
    }

    // Update activity timestamp
    convo.lastActivityAt = Date.now()

    // Build the message text, incorporating file info if present
    let messageText = parsed.text
    if (parsed.file) {
      const fileLabel = parsed.file.fileName
        ? `[File: ${parsed.file.fileName}]`
        : `[${parsed.type === 'photo' ? 'Photo' : 'File'}${parsed.file.mimeType ? ` (${parsed.file.mimeType})` : ''}]`

      messageText = parsed.text
        ? `${fileLabel}\n${parsed.text}`
        : fileLabel
    }

    if (!messageText.trim()) {
      // Empty message, nothing to route
      return
    }

    // Normalize into InboundMessage (transport-agnostic format)
    const inbound: InboundMessage = {
      sourceMessageId: parsed.messageId,
      channel: 'telegram',
      text: messageText,
      sender: {
        id: convo.userId,
        name: parsed.senderName,
      },
      conversationRef: {
        channelId: parsed.chatId,
        metadata: {
          telegramSenderId: parsed.senderId,
          ...(parsed.file ? { fileId: parsed.file.fileId, fileName: parsed.file.fileName, mimeType: parsed.file.mimeType } : {}),
        },
      },
      projectId: convo.activeProjectId || '',
    }

    // Send "typing" indicator while processing
    telegramApi(this.botToken, 'sendChatAction', {
      chat_id: parsed.chatId,
      action: 'typing',
    }).catch(() => { /* best-effort */ })

    try {
      const response = await channelRouter.routeMessage(inbound)

      // Send the response back to the chat
      await this.sendResponseToChat(response)
    } catch (err) {
      console.error(`[telegram] Failed to route inbound message from chat ${parsed.chatId}:`, err)
      await sendMessage(
        this.botToken,
        parsed.chatId,
        'Sorry, I encountered an error processing your message. Please try again.',
      )
    }
  }

  /**
   * Send an outbound response back to a Telegram chat.
   * Used by channelRouter as the registered response sender.
   */
  private async sendResponseToChat(response: OutboundResponse): Promise<void> {
    if (!this.botToken) return

    const chatId = response.conversationRef.channelId
    if (!chatId) {
      console.warn('[telegram] Cannot send response — no chatId in conversationRef')
      return
    }

    // Split long messages (Telegram limit is 4096 chars)
    const maxLen = 4000 // Leave some margin for HTML tags
    const text = response.text

    if (text.length <= maxLen) {
      await sendMessage(this.botToken, chatId, text)
    } else {
      // Split on paragraph boundaries where possible
      const chunks = this.splitMessage(text, maxLen)
      for (const chunk of chunks) {
        await sendMessage(this.botToken, chatId, chunk)
      }
    }
  }

  /**
   * Split a long message into chunks, preferring paragraph boundaries.
   */
  private splitMessage(text: string, maxLen: number): string[] {
    const chunks: string[] = []
    let remaining = text

    while (remaining.length > maxLen) {
      // Try to split on double newline
      let splitIdx = remaining.lastIndexOf('\n\n', maxLen)
      if (splitIdx < maxLen / 2) {
        // Try single newline
        splitIdx = remaining.lastIndexOf('\n', maxLen)
      }
      if (splitIdx < maxLen / 2) {
        // Fall back to space
        splitIdx = remaining.lastIndexOf(' ', maxLen)
      }
      if (splitIdx < maxLen / 2) {
        // Hard split
        splitIdx = maxLen
      }

      chunks.push(remaining.slice(0, splitIdx))
      remaining = remaining.slice(splitIdx).trimStart()
    }

    if (remaining) {
      chunks.push(remaining)
    }

    return chunks
  }

  // ─── Conversation state management ─────────────────────────────

  /**
   * Get or lazily create conversation state for a chat_id.
   * Looks up the connected account in DB to resolve userId.
   * Returns null if the chat is not connected.
   */
  async getOrCreateConversation(chatId: string): Promise<ConversationState | null> {
    const existing = this.conversations.get(chatId)
    if (existing) {
      return existing
    }

    // Look up connected account
    const rows = await db.select({
      userId: connectedAccounts.userId,
    })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.channel, 'telegram'),
          eq(connectedAccounts.externalId, chatId),
          eq(connectedAccounts.enabled, true),
        )
      )
      .limit(1)

    if (rows.length === 0) return null

    const state: ConversationState = {
      userId: rows[0].userId,
      activeProjectId: null,
      lastActivityAt: Date.now(),
    }

    this.conversations.set(chatId, state)
    return state
  }

  /**
   * Get conversation state for a chat_id (if it exists in memory).
   * Does not create or look up from DB. Used for read-only checks.
   */
  getConversation(chatId: string): ConversationState | undefined {
    return this.conversations.get(chatId)
  }

  /**
   * Evict stale conversations that have been idle beyond the TTL.
   */
  private evictStaleConversations(): void {
    const cutoff = Date.now() - CONVERSATION_TTL_MS
    for (const [chatId, state] of this.conversations) {
      if (state.lastActivityAt < cutoff) {
        this.conversations.delete(chatId)
      }
    }
  }

  /**
   * Get projects accessible to a user (owned + team projects).
   */
  private async getUserProjects(userId: string): Promise<Array<{ id: string; name: string }>> {
    // Get user's team memberships
    const memberships = await db.select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId))

    const teamIds = memberships.map((m) => m.teamId)

    // Get projects: owned by user OR in their teams
    let userProjects: Array<{ id: string; name: string }>

    if (teamIds.length > 0) {
      userProjects = await db.select({
        id: projects.id,
        name: projects.name,
      })
        .from(projects)
        .where(
          inArray(projects.teamId, teamIds)
        )
        .orderBy(desc(projects.updatedAt))
        .limit(50)
    } else {
      userProjects = await db.select({
        id: projects.id,
        name: projects.name,
      })
        .from(projects)
        .where(eq(projects.ownerId, userId))
        .orderBy(desc(projects.updatedAt))
        .limit(50)
    }

    return userProjects
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

  // ─── Public accessors for route handlers ───────────────────────

  getBotToken(): string | null {
    return this.botToken
  }

  getBotUsername(): string | null {
    return this.botUsername
  }
}

export const telegramChannel = new TelegramChannelAdapter()
