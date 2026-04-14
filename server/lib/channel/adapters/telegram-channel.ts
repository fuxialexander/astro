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
import {
  getMe,
  sendMessage as apiSendMessage,
  editMessageText as apiEditMessageText,
  answerCallbackQuery as apiAnswerCallbackQuery,
  getFile,
  downloadFile,
  safeSend,
  type TelegramApiResponse,
} from './telegram-api.js'
import { parseAllowlist, isUserAllowed } from './telegram-auth.js'
import { bufferMedia, type BufferedMedia, type BatchResult } from './telegram-media-batch.js'
import {
  compileMentionPatterns,
  shouldProcessMessage,
  type CompiledMention,
} from './telegram-mention.js'
import { getModelProviders } from './telegram-commands.js'

// ---------------------------------------------------------------------------
// Thin local wrappers — preserve the call-site signatures used throughout
// this file (default parseMode='HTML', positional args, etc.)
// ---------------------------------------------------------------------------

async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'MarkdownV2'
    replyMarkup?: unknown
    threadId?: string | number
  },
): Promise<TelegramApiResponse> {
  return apiSendMessage(token, chatId, text, {
    parseMode: options?.parseMode ?? 'HTML',
    replyMarkup: options?.replyMarkup,
    threadId: options?.threadId,
  })
}

async function editMessageText(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<TelegramApiResponse> {
  return apiEditMessageText(token, chatId, messageId, text, { parseMode: 'HTML' })
}

async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert?: boolean,
): Promise<TelegramApiResponse> {
  return apiAnswerCallbackQuery(token, callbackQueryId, text, showAlert)
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const LINK_TOKEN_PREFIX = 'tg-link:'
const LINK_TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes

class TelegramChannelAdapter {
  private botToken: string | null = null
  private botUsername: string | null = null
  private botId: number | null = null
  private _started = false
  private mentionPatterns: CompiledMention | null = null

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
    const me = await getMe(token)
    if (!me.ok || !me.result) {
      console.error('[telegram] getMe failed — check TELEGRAM_BOT_TOKEN:', me.description)
      return
    }

    const botInfo = me.result as { id?: number; username?: string; first_name?: string }
    this.botToken = token
    this.botUsername = botInfo.username || process.env.TELEGRAM_BOT_USERNAME || null
    this.botId = typeof botInfo.id === 'number' ? botInfo.id : null

    // Compile mention-gating patterns once at startup. Per-account settings
    // are not yet wired; we only honour the env-level configuration.
    const requireMention = (() => {
      const raw = (process.env.TELEGRAM_REQUIRE_MENTION ?? '').trim().toLowerCase()
      if (raw === '0' || raw === 'false' || raw === 'no') return false
      return true
    })()
    this.mentionPatterns = compileMentionPatterns(
      process.env.TELEGRAM_MENTION_PATTERNS,
      { requireMention },
    )

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

    // Warn if webhook secret is not configured — the webhook endpoint will accept
    // any POST from the internet without verification in that case.
    if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
      console.warn(
        '[telegram] WARNING: TELEGRAM_WEBHOOK_SECRET is not set. ' +
        'The /api/telegram/webhook endpoint will accept unauthenticated requests. ' +
        'Set this variable and re-register the webhook to secure the endpoint.',
      )
    }

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
    if (!msg) return

    const chatObj = msg.chat as Record<string, unknown> | undefined
    if (!chatObj) return
    const chatId = String(chatObj.id)
    const chatType = chatObj.type as string // 'private', 'group', 'supergroup', 'channel'
    const from = msg.from as Record<string, unknown> | undefined

    // Ignore bot messages
    if (from?.is_bot) return

    const fromId = from?.id ? String(from.id) : undefined
    // message_thread_id is set for messages inside forum topics
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : undefined
    const isGroupChat = chatType === 'group' || chatType === 'supergroup'

    // ── Inbound media detection ─────────────────────────────────────────────
    const mediaGroupId = msg.media_group_id as string | undefined
    const caption = (msg.caption as string | undefined) ?? ''

    const photo = msg.photo as Array<{ file_id: string; file_size?: number }> | undefined
    const video = msg.video as { file_id: string; mime_type?: string; file_size?: number } | undefined
    const voice = msg.voice as { file_id: string; mime_type?: string; duration?: number; file_size?: number } | undefined
    const audio = msg.audio as { file_id: string; mime_type?: string; file_size?: number } | undefined
    const document = msg.document as { file_id: string; mime_type?: string; file_name?: string; file_size?: number } | undefined
    const animation = msg.animation as { file_id: string; mime_type?: string; file_size?: number } | undefined
    const sticker = msg.sticker as { file_id: string; emoji?: string } | undefined
    const location = msg.location as { latitude: number; longitude: number } | undefined
    const venue = msg.venue as { title: string; address: string; location: { latitude: number; longitude: number } } | undefined

    let mediaItem: BufferedMedia | null = null
    if (photo && photo.length > 0) {
      mediaItem = {
        fileId: photo[photo.length - 1].file_id,
        mimeType: 'image/jpeg',
        size: photo[photo.length - 1].file_size,
        caption,
      }
    } else if (video) {
      mediaItem = { fileId: video.file_id, mimeType: video.mime_type ?? 'video/mp4', size: video.file_size, caption }
    } else if (voice) {
      mediaItem = { fileId: voice.file_id, mimeType: voice.mime_type ?? 'audio/ogg', size: voice.file_size, caption }
    } else if (audio) {
      mediaItem = { fileId: audio.file_id, mimeType: audio.mime_type ?? 'audio/mpeg', size: audio.file_size, caption }
    } else if (animation) {
      mediaItem = { fileId: animation.file_id, mimeType: animation.mime_type ?? 'image/gif', size: animation.file_size, caption }
    } else if (document) {
      mediaItem = {
        fileId: document.file_id,
        mimeType: document.mime_type ?? 'application/octet-stream',
        size: document.file_size,
        caption,
      }
    } else if (sticker) {
      mediaItem = { fileId: sticker.file_id, mimeType: 'image/webp', caption: sticker.emoji ?? '' }
    }

    // Collect attachments (data URLs) if we have media
    let attachments: Array<{ dataUrl: string; mimeType: string; size?: number }> | undefined
    let batchCaption = caption

    if (mediaItem) {
      let batchItems: BufferedMedia[] = [mediaItem]
      if (mediaGroupId) {
        const batch: BatchResult | null = await bufferMedia(mediaGroupId, mediaItem, {
          chatId,
          threadId,
          fromId,
          caption,
        })
        if (!batch) {
          // Another call will flush this group
          return
        }
        batchItems = batch.items
        if (batch.caption) batchCaption = batch.caption
      }

      attachments = []
      for (const item of batchItems) {
        try {
          const fileResp = await getFile(this.botToken, item.fileId)
          if (!fileResp.ok || !fileResp.result) {
            console.warn(`[telegram] getFile failed for ${item.fileId}: ${fileResp.description}`)
            continue
          }
          const fileInfo = fileResp.result as { file_path?: string }
          if (!fileInfo.file_path) {
            console.warn(`[telegram] getFile returned no file_path for ${item.fileId}`)
            continue
          }
          const buffer = await downloadFile(this.botToken, fileInfo.file_path)
          if (!buffer) {
            await sendMessage(
              this.botToken,
              chatId,
              '⚠️ Attachment is too large or could not be downloaded — skipping.',
              { threadId },
            )
            continue
          }
          const dataUrl = `data:${item.mimeType};base64,${buffer.toString('base64')}`
          attachments.push({ dataUrl, mimeType: item.mimeType, size: item.size })
        } catch (err) {
          console.warn(`[telegram] Failed to process media item ${item.fileId}:`, err)
        }
      }
      if (attachments.length === 0) attachments = undefined
    }

    // ── Location/venue → synthesize text and fall through ──────────────────
    let text: string
    if (typeof msg.text === 'string' && msg.text.length > 0) {
      text = msg.text
    } else if (location || venue) {
      const loc = venue?.location ?? location!
      const lat = loc.latitude
      const lon = loc.longitude
      const title = venue ? `Venue: ${venue.title}\nAddress: ${venue.address}\n` : ''
      text = `[shared location]\n${title}latitude: ${lat}\nlongitude: ${lon}\nMap: https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    } else if (attachments && attachments.length > 0) {
      // Media without text caption — synthesize a minimal prompt
      text = batchCaption && batchCaption.length > 0 ? batchCaption : '[attached media]'
    } else {
      // Nothing actionable
      return
    }

    // ── Private chat built-in commands ──────────────────────────────────────
    if (!isGroupChat) {
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

      // Handle /connection command (Telegram connection status).
      // Note: /status is handled by the command registry (execution status).
      if (text === '/connection') {
        await this.handleStatusCommand(chatId)
        return
      }

      // Handle /disconnect command
      if (text === '/disconnect') {
        await this.handleDisconnectCommand(chatId)
        return
      }
    }

    // ── Slash command routing (both private and group chats) ─────────────────
    if (text.startsWith('/')) {
      const response = await handleCommand(text, chatId, this.botToken, {
        fromId: isGroupChat ? fromId : undefined,
        threadId,
        isGroupChat,
      })
      if (response !== null) {
        await sendMessage(this.botToken, chatId, response, { threadId })
      } else if (!isGroupChat) {
        // Unknown command in private chat
        await sendMessage(
          this.botToken,
          chatId,
          'Unknown command. Use /help to see available commands.',
        )
      }
      return
    }

    // ── Forum topic chat routing (group messages in a bound topic) ───────────
    if (isGroupChat && threadId) {
      const projectId = await this.resolveTopicProject(chatId, threadId)
      if (projectId) {
        // Bound forum topics bypass mention gating — the binding is itself
        // the opt-in signal that the bot should respond to every message.
        await this.handleTopicChatMessage(chatId, threadId, text, projectId, from, attachments)
        return
      }
      // Message in an unbound topic — silently ignore (don't spam the group)
      return
    }

    // ── Group-chat mention gating ───────────────────────────────────────────
    // For plain group messages (not commands, not in a bound forum topic),
    // only respond when the user explicitly addresses the bot. Private chats
    // are unaffected.
    if (isGroupChat && this.mentionPatterns && this.botUsername) {
      const replyTo = msg.reply_to_message as { from?: { id?: number | string } } | undefined
      const decision = shouldProcessMessage(
        {
          text,
          chatId,
          threadId,
          botUsername: this.botUsername,
          botId: this.botId ?? undefined,
          replyToFromId: replyTo?.from?.id,
        },
        this.mentionPatterns,
      )
      if (!decision.process) {
        return
      }
    }

    // ── Private chat non-command text → AI chat session ─────────────────────
    if (!isGroupChat) {
      await this.handleChatMessage(text, chatId, attachments)
    }
  }

  /**
   * Look up which Astro project a forum topic is bound to.
   * Returns the project ID if a binding exists, null otherwise.
   */
  private async resolveTopicProject(groupChatId: string, threadId: string): Promise<string | null> {
    const mappingKey = `${groupChatId}:topic:${threadId}`

    // Fetch all enabled telegram connected accounts and scan mappings.
    // In practice, the number of Telegram-connected accounts is small.
    const accounts = await db
      .select({ mappings: connectedAccounts.mappings })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.channel, 'telegram'),
          eq(connectedAccounts.enabled, true),
        ),
      )

    for (const account of accounts) {
      const mappings = (account.mappings ?? {}) as Record<string, string>
      if (mappings[mappingKey]) {
        return mappings[mappingKey]
      }
    }

    return null
  }

  /**
   * Route a message from a bound forum topic through the channel router.
   * Sends the AI agent's reply back to the same topic thread.
   */
  private async handleTopicChatMessage(
    groupChatId: string,
    threadId: string,
    text: string,
    projectId: string,
    from: Record<string, unknown> | undefined,
    attachments?: Array<{ dataUrl: string; mimeType: string; size?: number }>,
  ): Promise<void> {
    if (!this.botToken) return

    const senderName =
      [from?.first_name, from?.last_name].filter(Boolean).join(' ') || 'Unknown'

    // Verify the sender has a connected Astro account and is a member of the project's team.
    // Silently drop messages from unauthorized group members rather than routing them to agents.
    if (from?.id) {
      const senderId = String(from.id)
      const [connectedAccount] = await db
        .select({ userId: connectedAccounts.userId })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.channel, 'telegram'),
            eq(connectedAccounts.externalId, senderId),
            eq(connectedAccounts.enabled, true),
          ),
        )
        .limit(1)

      if (!connectedAccount) {
        // Sender is not a registered Astro user — silently drop
        return
      }

      // Check the sender is a team member for the project
      const [membership] = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
        .where(
          and(
            eq(teamMembers.userId, connectedAccount.userId),
            eq(projects.id, projectId),
          ),
        )
        .limit(1)

      if (!membership) {
        // Sender is not a member of this project's team — silently drop
        return
      }
    }

    try {
      const response = await channelRouter.routeMessage({
        sourceMessageId: `tg-${groupChatId}-${threadId}-${Date.now()}`,
        channel: 'telegram',
        text,
        sender: {
          id: from?.id ? String(from.id) : 'unknown',
          name: senderName,
        },
        conversationRef: {
          channelId: groupChatId,
          threadId,
          // TODO(wave3): add `attachments` to InboundMessage type
          metadata: attachments ? { attachments } : undefined,
        },
        projectId,
      } as Parameters<typeof channelRouter.routeMessage>[0])

      const token = this.botToken!
      await safeSend(
        () => sendMessage(token, groupChatId, response.text, { threadId }),
        {
          retryWithoutThread: () => sendMessage(token, groupChatId, response.text),
          retryTruncated: (maxLen) =>
            sendMessage(token, groupChatId, response.text.slice(0, maxLen), { threadId }),
        },
      )
    } catch (err) {
      console.error('[telegram] Error routing topic message:', err)
      await sendMessage(
        this.botToken,
        groupChatId,
        '⚠️ An error occurred while processing your message.',
        { threadId },
      )
    }
  }

  /**
   * Route a non-command message to the project chat.
   * Looks up the user's connected account, resolves the active project,
   * and dispatches the message via the relay with streaming edits.
   */
  private async handleChatMessage(
    text: string,
    chatId: string,
    attachments?: Array<{ dataUrl: string; mimeType: string; size?: number }>,
  ): Promise<void> {
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
      // TODO(wave3): telegram-chat.ts will accept `attachments` and forward
      // them to the agent as imageRefs. For now, pass through via `as any`.
      const result = await dispatchChatToTelegram({
        botToken: this.botToken,
        chatId,
        userId,
        userMessage: text,
        session,
        attachments,
      } as Parameters<typeof dispatchChatToTelegram>[0] & {
        attachments?: Array<{ dataUrl: string; mimeType: string; size?: number }>
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
    // Identify the user who tapped the button (from.id is the button-tapper's Telegram ID)
    const fromId = query.from ? String((query.from as Record<string, unknown>).id) : null

    if (!data || !chatId) {
      await answerCallbackQuery(this.botToken, callbackId, 'Invalid request')
      return
    }

    // Allowlist gate — denies button-taps from non-allowlisted users before
    // hitting any DB or dispatch code.
    const allowlist = parseAllowlist(process.env.TELEGRAM_ALLOWED_USERS, undefined)
    if (fromId && !isUserAllowed(fromId, allowlist)) {
      await answerCallbackQuery(this.botToken, callbackId, 'Not allowed', true)
      return
    }

    // Verify the button tapper has a connected Astro account — prevents replay attacks
    // and anonymous users from responding to approvals. Also capture the caller's
    // Astro userId so respondToApproval can check dispatcher-level authorization.
    let callerUserId: string | null = null
    if (fromId) {
      const [account] = await db
        .select({ id: connectedAccounts.id, userId: connectedAccounts.userId })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.channel, 'telegram'),
            eq(connectedAccounts.externalId, fromId),
            eq(connectedAccounts.enabled, true),
          ),
        )
        .limit(1)

      if (!account) {
        await answerCallbackQuery(
          this.botToken,
          callbackId,
          'Your Telegram account is not connected to Astro. Use /start to link it.',
        )
        return
      }
      callerUserId = account.userId ?? null
    }

    // Parse callback data
    let approvalId: string
    let approved: boolean
    let selectedOption: string | undefined
    let choice: 'once' | 'session' | 'always' | 'deny' | undefined

    if (data.startsWith('ea:')) {
      // ea:<choice>:<approvalId>
      const rest = data.slice(3)
      const colon = rest.indexOf(':')
      if (colon < 0) {
        await answerCallbackQuery(this.botToken, callbackId, 'Invalid ea payload')
        return
      }
      const rawChoice = rest.slice(0, colon)
      approvalId = rest.slice(colon + 1)
      if (rawChoice !== 'once' && rawChoice !== 'session' && rawChoice !== 'always' && rawChoice !== 'deny') {
        await answerCallbackQuery(this.botToken, callbackId, 'Unknown choice')
        return
      }
      choice = rawChoice
      approved = choice !== 'deny'
    } else if (data.startsWith('approve:')) {
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
    } else if (data.startsWith('mp:') || data.startsWith('mm:')) {
      // /model picker callbacks.
      //   mp:__cancel__       → cancel
      //   mp:__back__         → re-show provider list
      //   mp:<providerSlug>   → drill into that provider's model list
      //   mm:<provider>:<model> → persist selection
      if (data === 'mp:cancel' || data === 'mp:__cancel__') {
        await answerCallbackQuery(this.botToken, callbackId, 'Cancelled')
        if (messageId && chatId) {
          try {
            await editMessageText(this.botToken, chatId, messageId, '❌ Model selection cancelled')
          } catch {
            /* ignore edit failures */
          }
        }
        return
      }
      if (data.startsWith('mp:')) {
        const providerSlug = data.slice(3)
        const providers = getModelProviders()
        if (providerSlug === '__back__') {
          // Re-show provider list
          const providerKeyboard: Array<Array<{ text: string; callback_data: string }>> = providers.map((p) => [
            { text: p.label, callback_data: `mp:${p.id}` },
          ])
          providerKeyboard.push([{ text: '✖️ Cancel', callback_data: 'mp:__cancel__' }])
          if (messageId && chatId) {
            try {
              await apiEditMessageText(
                this.botToken,
                chatId,
                messageId,
                '<b>🧠 Select a provider</b>\n\nChoose a model provider, then pick a specific model.',
                { parseMode: 'HTML', replyMarkup: { inline_keyboard: providerKeyboard } },
              )
            } catch {
              /* ignore edit failures */
            }
          }
          await answerCallbackQuery(this.botToken, callbackId)
          return
        }
        const provider = providers.find((p) => p.id === providerSlug)
        if (!provider) {
          await answerCallbackQuery(this.botToken, callbackId, 'Unknown provider')
          return
        }
        // Build keyboard of models for this provider (one model per row).
        const modelKeyboard: Array<Array<{ text: string; callback_data: string }>> = provider.models.map((m) => [
          { text: m, callback_data: `mm:${provider.id}:${m}` },
        ])
        modelKeyboard.push([
          { text: '⬅️ Back', callback_data: 'mp:__back__' },
          { text: '✖️ Cancel', callback_data: 'mp:__cancel__' },
        ])
        if (messageId && chatId) {
          try {
            await apiEditMessageText(
              this.botToken,
              chatId,
              messageId,
              `<b>🧠 ${provider.label}</b>\n\nSelect a model:`,
              { parseMode: 'HTML', replyMarkup: { inline_keyboard: modelKeyboard } },
            )
          } catch {
            /* ignore edit failures */
          }
        }
        await answerCallbackQuery(this.botToken, callbackId)
        return
      }
      // data.startsWith('mm:') — persist preferred model to the account mapping.
      // Payload: mm:<providerSlug>:<modelSlug>  (legacy: mm:<modelSlug>)
      const mmRest = data.slice(3)
      const firstColon = mmRest.indexOf(':')
      const model = firstColon >= 0 ? mmRest.slice(firstColon + 1) : mmRest
      if (fromId && model) {
        try {
          const [account] = await db
            .select({
              id: connectedAccounts.id,
              mappings: connectedAccounts.mappings,
            })
            .from(connectedAccounts)
            .where(
              and(
                eq(connectedAccounts.channel, 'telegram'),
                eq(connectedAccounts.externalId, fromId),
                eq(connectedAccounts.enabled, true),
              ),
            )
            .limit(1)
          if (account) {
            const current = (account.mappings ?? {}) as Record<string, unknown>
            const next = { ...current, preferredModel: model }
            await db
              .update(connectedAccounts)
              .set({ mappings: next })
              .where(eq(connectedAccounts.id, account.id))
          }
        } catch (err) {
          console.warn('[telegram] failed to persist preferred model:', err)
        }
      }
      await answerCallbackQuery(this.botToken, callbackId, `Model set to ${model}`)
      if (messageId && chatId) {
        try {
          await editMessageText(this.botToken, chatId, messageId, `Model set to <b>${model}</b>`)
        } catch {
          /* ignore edit failures */
        }
      }
      return
    } else {
      await answerCallbackQuery(this.botToken, callbackId, 'Unknown action')
      return
    }

    // Call the approval API
    try {
      const { dispatchEngine } = await import('../../dispatch/index.js')
      if (choice !== undefined) {
        await dispatchEngine.respondToApproval(
          approvalId,
          approved,
          { choice, selectedOption },
          callerUserId ?? undefined,
        )
      } else {
        await dispatchEngine.respondToApproval(
          approvalId,
          approved,
          selectedOption,
          callerUserId ?? undefined,
        )
      }

      // Update the message to show the response
      const choiceLabels: Record<'once' | 'session' | 'always' | 'deny', string> = {
        once: 'Allowed (once)',
        session: 'Allowed (session)',
        always: 'Allowed (always)',
        deny: 'Denied',
      }
      const responseText = choice
        ? choiceLabels[choice]
        : approved
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
      } else if (errMsg.includes('not authorized')) {
        await answerCallbackQuery(
          this.botToken,
          callbackId,
          'Not authorized — only the task dispatcher can approve this',
          true,
        )
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

      // Get all Telegram-connected accounts for these users (including mappings for topic delivery)
      const accounts = await db.select({
        externalId: connectedAccounts.externalId,
        mappings: connectedAccounts.mappings,
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
            // Show each option as a button.
            // Telegram's callback_data limit is 64 bytes. We preserve the full approvalId
            // (UUID, 36 chars) and truncate only the option text: "option:" (7) + uuid (36) + ":" (1) = 44 chars overhead.
            const MAX_CB = 64
            const prefix = `option:${approvalId}:`
            const maxOptLen = MAX_CB - prefix.length
            replyMarkup = {
              inline_keyboard: options.map((opt) => ([
                {
                  text: opt,
                  callback_data: `${prefix}${opt.slice(0, Math.max(1, maxOptLen))}`,
                },
              ])),
            }
          } else {
            // Four-choice approval buttons (2x2 grid)
            replyMarkup = {
              inline_keyboard: [
                [
                  { text: 'Allow Once', callback_data: `ea:once:${approvalId}` },
                  { text: 'Session', callback_data: `ea:session:${approvalId}` },
                ],
                [
                  { text: 'Always', callback_data: `ea:always:${approvalId}` },
                  { text: 'Deny', callback_data: `ea:deny:${approvalId}` },
                ],
              ],
            }
          }
        }
      }

      // ── Personal chat sends ──────────────────────────────────────────────
      const personalChatIds = [...new Set(
        accounts.filter((a) => a.externalId).map((a) => a.externalId!),
      )]

      const token = this.botToken!
      const personalSends = personalChatIds.map((chatId) =>
        safeSend(
          () => sendMessage(token, chatId, text, { replyMarkup }),
          {
            retryWithoutParseMode: () =>
              apiSendMessage(token, chatId, text, { replyMarkup }),
            retryTruncated: (maxLen) =>
              sendMessage(token, chatId, text.slice(0, maxLen), { replyMarkup }),
          },
        ).catch((err) => {
          console.warn(`[telegram] Failed to send to personal chat ${chatId}:`, err)
        })
      )

      // ── Group forum topic sends ──────────────────────────────────────────
      // Collect unique group:topic destinations that map to this project.
      const topicDestinations: Array<{ chatId: string; threadId: string }> = []
      const TOPIC_KEY_RE = /^(-?\d+):topic:(\d+)$/

      for (const account of accounts) {
        const mappings = ((account.mappings ?? {}) as Record<string, string>)
        for (const [key, projectId] of Object.entries(mappings)) {
          if (projectId !== notification.projectId) continue
          const m = TOPIC_KEY_RE.exec(key)
          if (!m) continue
          const [, groupChatId, threadId] = m
          if (!topicDestinations.some((d) => d.chatId === groupChatId && d.threadId === threadId)) {
            topicDestinations.push({ chatId: groupChatId, threadId })
          }
        }
      }

      const topicSends = topicDestinations.map(({ chatId, threadId }) =>
        safeSend(
          () => sendMessage(token, chatId, text, { threadId, replyMarkup }),
          {
            retryWithoutThread: () => sendMessage(token, chatId, text, { replyMarkup }),
            retryWithoutParseMode: () =>
              apiSendMessage(token, chatId, text, { threadId, replyMarkup }),
            retryTruncated: (maxLen) =>
              sendMessage(token, chatId, text.slice(0, maxLen), { threadId, replyMarkup }),
          },
        ).catch((err) => {
          console.warn(`[telegram] Failed to send to group ${chatId} topic ${threadId}:`, err)
        })
      )

      await Promise.allSettled([...personalSends, ...topicSends])
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
