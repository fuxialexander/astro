/**
 * Telegram Channel Adapter
 *
 * Telegram integration: one shared bot, per-user connections.
 * Users connect by clicking a deep link (t.me/BotName?start=TOKEN),
 * then receive all project notifications on their Telegram account.
 *
 * Features:
 * - Notification delivery (task complete, failed, approval, etc.)
 * - Image upload: users send photos → stored as blobs, associated with active project
 * - File output delivery: file_change events sent as document listings in notifications
 * - /files command: list recent file outputs from active project
 * - /project command: select active project for file context
 *
 * Link tokens are stored in the DB (webauthn_challenges table with
 * "tg-link:" prefix) for multi-instance compatibility.
 */

import { randomBytes } from 'node:crypto'
import { db } from '../../db/index.js'
import {
  connectedAccounts,
  projects,
  teamMembers,
  webauthnChallenges,
  blobs,
  fileChanges,
  taskExecutions,
} from '../../db/schema.js'
import { eq, and, inArray, gt, desc, sql } from 'drizzle-orm'
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
// File-related Telegram API helpers
// ---------------------------------------------------------------------------

interface TelegramFile {
  file_id: string
  file_unique_id: string
  file_size?: number
  file_path?: string
}

/**
 * Get file metadata from Telegram (includes file_path for download).
 * Only works for files up to 20MB.
 */
async function getFile(token: string, fileId: string): Promise<TelegramFile | null> {
  const resp = await telegramApi(token, 'getFile', { file_id: fileId })
  if (!resp.ok || !resp.result) return null
  return resp.result as TelegramFile
}

/**
 * Download a file from Telegram servers using the file_path from getFile.
 */
async function downloadFile(token: string, filePath: string): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Send a document to a Telegram chat using multipart/form-data.
 */
async function sendDocument(
  token: string,
  chatId: string,
  document: Buffer,
  filename: string,
  caption?: string,
): Promise<TelegramApiResponse> {
  const formData = new FormData()
  formData.append('chat_id', chatId)
  formData.append('document', new Blob([document]), filename)
  if (caption) {
    formData.append('caption', caption)
    formData.append('parse_mode', 'HTML')
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: formData,
  })
  return (await response.json()) as TelegramApiResponse
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const LINK_TOKEN_PREFIX = 'tg-link:'
const LINK_TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** In-memory store for recently uploaded images (chatId → uploads) with TTL */
interface TelegramUpload {
  blobId: string
  filename: string
  mimeType: string
  projectId: string
  caption?: string
  uploadedAt: number
}

const recentUploads = new Map<string, TelegramUpload[]>()
const UPLOAD_TTL_MS = 30 * 60 * 1000 // 30 minutes

function cleanExpiredUploads(): void {
  const now = Date.now()
  for (const [chatId, uploads] of recentUploads) {
    const valid = uploads.filter((u) => now - u.uploadedAt < UPLOAD_TTL_MS)
    if (valid.length === 0) {
      recentUploads.delete(chatId)
    } else {
      recentUploads.set(chatId, valid)
    }
  }
}

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

    // Handle callback queries (inline keyboard button taps)
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query as Record<string, unknown>)
      return
    }

    const msg = update.message as Record<string, unknown> | undefined
    if (!msg) return

    const chat = msg.chat as Record<string, unknown> | undefined
    if (!chat) return
    const chatId = String(chat.id)
    const from = msg.from as Record<string, unknown> | undefined

    // Ignore bot messages
    if (from?.is_bot) return

    // Handle photo messages (image upload)
    if (msg.photo) {
      await this.handlePhotoUpload(msg, chatId)
      return
    }

    // Handle document messages (file upload)
    if (msg.document && !msg.text) {
      await this.handleDocumentUpload(msg, chatId)
      return
    }

    // Text-only processing from here
    if (!msg.text) return
    const text = msg.text as string

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
        '👋 Welcome! To connect your Telegram to Astro, use the link from your Astro Settings page.\n\n'
        + '<b>Available commands:</b>\n'
        + '/status — Check your connection\n'
        + '/project — View or set active project\n'
        + '/files — List recent file outputs\n'
        + '/disconnect — Unlink your account',
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

    // Handle /project command
    if (text === '/project' || text.startsWith('/project ')) {
      await this.handleProjectCommand(chatId, text)
      return
    }

    // Handle /files command
    if (text === '/files') {
      await this.handleFilesCommand(chatId)
      return
    }

    // For any other message, let them know about available commands
    await sendMessage(
      this.botToken,
      chatId,
      'I can send Astro notifications and handle file transfers.\n\n'
      + '<b>Commands:</b>\n'
      + '/status — Check your connection\n'
      + '/project — View or set active project\n'
      + '/files — List recent file outputs\n'
      + '/disconnect — Unlink your account\n\n'
      + '📷 Send images to upload them as project context.',
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
      '✅ Connected! You will now receive Astro notifications here.\n\n'
      + 'Use /project to set your active project, then send images for context.\n'
      + 'Use /status to check your connection or /disconnect to unlink.',
    )
  }

  private async handleStatusCommand(chatId: string): Promise<void> {
    if (!this.botToken) return

    const account = await this.getAccountByChatId(chatId)

    if (account) {
      const settings = (account.settings ?? {}) as Record<string, unknown>
      const activeProjectId = settings.activeProjectId as string | undefined
      let projectInfo = ''

      if (activeProjectId) {
        const [project] = await db.select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, activeProjectId))
          .limit(1)
        if (project) {
          projectInfo = `\n📁 Active project: <b>${this.escapeHtml(project.name)}</b>`
        }
      }

      await sendMessage(
        this.botToken,
        chatId,
        `✅ Your Telegram is connected to Astro.${projectInfo}\n\nYou will receive notifications for all your projects.`,
      )
    } else {
      await sendMessage(this.botToken, chatId, '❌ Your Telegram is not connected to Astro. Use the link from Astro Settings to connect.')
    }
  }

  /**
   * Handle inline keyboard button taps (approval responses + project selection).
   * Callback data format: "approve:<approvalId>" or "reject:<approvalId>"
   * or "option:<approvalId>:<selectedOption>" or "project:<projectId>"
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

    // Handle project selection callback
    if (data.startsWith('project:')) {
      const projectId = data.slice(8)
      await this.handleProjectSelection(chatId, projectId, callbackId, messageId)
      return
    }

    // Parse approval callback data
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
      // Clean up in-memory uploads
      recentUploads.delete(chatId)
      await sendMessage(this.botToken, chatId, '👋 Disconnected. You will no longer receive Astro notifications here.')
    } else {
      await sendMessage(this.botToken, chatId, 'No active connection found.')
    }
  }

  // ─── Project selection ─────────────────────────────────────────

  /**
   * Handle /project command — view or set active project.
   * /project → show current + list available
   * /project <name> → search and set
   */
  private async handleProjectCommand(chatId: string, text: string): Promise<void> {
    if (!this.botToken) return

    const account = await this.getAccountByChatId(chatId)
    if (!account) {
      await sendMessage(this.botToken, chatId, '❌ Not connected. Use the link from Astro Settings to connect first.')
      return
    }

    const settings = (account.settings ?? {}) as Record<string, unknown>
    const search = text.replace(/^\/project\s*/, '').trim()

    // Get user's projects (via team membership)
    const userTeams = await db.select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, account.userId))

    const teamIds = userTeams.map((t) => t.teamId)
    if (teamIds.length === 0) {
      await sendMessage(this.botToken, chatId, 'You are not a member of any team.')
      return
    }

    let userProjects = await db.select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      icon: projects.icon,
    })
      .from(projects)
      .where(
        and(
          inArray(projects.teamId, teamIds),
          eq(projects.status, 'active'),
        )
      )
      .orderBy(desc(projects.createdAt))
      .limit(20)

    if (search) {
      // Filter by search term
      const lower = search.toLowerCase()
      userProjects = userProjects.filter((p) => p.name.toLowerCase().includes(lower))
    }

    // If no search and just /project, show status + list
    if (!search) {
      const activeProjectId = settings.activeProjectId as string | undefined
      let currentLine = ''
      if (activeProjectId) {
        const current = userProjects.find((p) => p.id === activeProjectId)
        currentLine = current
          ? `📁 <b>Active:</b> ${current.icon || '📋'} ${this.escapeHtml(current.name)}\n\n`
          : '⚠️ Active project not found (may have been archived).\n\n'
      }

      if (userProjects.length === 0) {
        await sendMessage(this.botToken, chatId, `${currentLine}No active projects found.`)
        return
      }

      // Show inline keyboard with project buttons
      const keyboard = userProjects.slice(0, 10).map((p) => ([
        {
          text: `${p.icon || '📋'} ${p.name}`,
          callback_data: `project:${p.id}`.slice(0, 64),
        },
      ]))

      await sendMessage(
        this.botToken,
        chatId,
        `${currentLine}Select a project:`,
        { replyMarkup: { inline_keyboard: keyboard } },
      )
      return
    }

    // Search results
    if (userProjects.length === 0) {
      await sendMessage(this.botToken, chatId, `No projects found matching "${this.escapeHtml(search)}".`)
      return
    }

    if (userProjects.length === 1) {
      // Exact match — set directly
      await this.setActiveProject(chatId, account.userId, userProjects[0].id, userProjects[0].name, userProjects[0].icon)
      return
    }

    // Multiple matches — show selection
    const keyboard = userProjects.slice(0, 10).map((p) => ([
      {
        text: `${p.icon || '📋'} ${p.name}`,
        callback_data: `project:${p.id}`.slice(0, 64),
      },
    ]))

    await sendMessage(
      this.botToken,
      chatId,
      `Multiple projects found for "${this.escapeHtml(search)}":`,
      { replyMarkup: { inline_keyboard: keyboard } },
    )
  }

  /**
   * Handle project selection via inline keyboard callback.
   */
  private async handleProjectSelection(
    chatId: string,
    projectId: string,
    callbackId: string,
    messageId?: number,
  ): Promise<void> {
    if (!this.botToken) return

    const account = await this.getAccountByChatId(chatId)
    if (!account) {
      await answerCallbackQuery(this.botToken, callbackId, 'Not connected')
      return
    }

    const [project] = await db.select({ name: projects.name, icon: projects.icon })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (!project) {
      await answerCallbackQuery(this.botToken, callbackId, 'Project not found')
      return
    }

    await this.setActiveProject(chatId, account.userId, projectId, project.name, project.icon)

    if (messageId) {
      await editMessageText(
        this.botToken,
        chatId,
        messageId,
        `📁 Active project set to: <b>${project.icon || '📋'} ${this.escapeHtml(project.name)}</b>`,
      )
    }

    await answerCallbackQuery(this.botToken, callbackId, `Active: ${project.name}`)
  }

  /**
   * Set the active project for a Telegram chat.
   */
  private async setActiveProject(
    chatId: string,
    userId: string,
    projectId: string,
    projectName: string,
    projectIcon?: string | null,
  ): Promise<void> {
    if (!this.botToken) return

    // Update connected account settings
    await db.update(connectedAccounts)
      .set({
        settings: sql`jsonb_set(COALESCE(settings, '{}'), '{activeProjectId}', ${JSON.stringify(projectId)}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(connectedAccounts.userId, userId),
          eq(connectedAccounts.channel, 'telegram'),
          eq(connectedAccounts.externalId, chatId),
        )
      )

    await sendMessage(
      this.botToken,
      chatId,
      `📁 Active project set to: <b>${projectIcon || '📋'} ${this.escapeHtml(projectName)}</b>\n\n`
      + '📷 You can now send images to upload them as project context.\n'
      + 'Use /files to see recent file outputs.',
    )
  }

  // ─── File upload handling ─────────────────────────────────────

  /**
   * Handle photo uploads from Telegram users.
   * Downloads the photo, stores as a blob, associates with active project.
   */
  private async handlePhotoUpload(msg: Record<string, unknown>, chatId: string): Promise<void> {
    if (!this.botToken) return

    const account = await this.getAccountByChatId(chatId)
    if (!account) {
      await sendMessage(this.botToken, chatId, '❌ Not connected. Use /start to connect first.')
      return
    }

    const settings = (account.settings ?? {}) as Record<string, unknown>
    const activeProjectId = settings.activeProjectId as string | undefined

    if (!activeProjectId) {
      await sendMessage(
        this.botToken,
        chatId,
        '⚠️ No active project set. Use /project to select one first, then send your image.',
      )
      return
    }

    // Get the largest photo (last element in the array)
    const photos = msg.photo as Array<Record<string, unknown>>
    const photo = photos[photos.length - 1]
    const fileId = photo.file_id as string
    const caption = (msg.caption as string) || undefined

    try {
      // Download the photo from Telegram
      const fileInfo = await getFile(this.botToken, fileId)
      if (!fileInfo?.file_path) {
        await sendMessage(this.botToken, chatId, '❌ Could not retrieve file from Telegram.')
        return
      }

      const buffer = await downloadFile(this.botToken, fileInfo.file_path)

      // Determine MIME type from file path
      const ext = fileInfo.file_path.split('.').pop()?.toLowerCase() || 'jpg'
      const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
      const timestamp = Date.now()
      const filename = `telegram-upload-${timestamp}.${ext}`

      // Look up project for teamId
      const [project] = await db.select({ teamId: projects.teamId, name: projects.name })
        .from(projects)
        .where(eq(projects.id, activeProjectId))
        .limit(1)

      if (!project) {
        await sendMessage(this.botToken, chatId, '⚠️ Active project not found. Use /project to select a new one.')
        return
      }

      // Store as blob
      const base64Data = buffer.toString('base64')
      const [blob] = await db.insert(blobs)
        .values({
          ownerId: account.userId,
          teamId: project.teamId,
          mimeType,
          size: buffer.length,
          data: base64Data,
          filename,
          projectId: activeProjectId,
          nodeId: caption ? JSON.stringify({ source: 'telegram', caption }) : JSON.stringify({ source: 'telegram' }),
        })
        .returning({ id: blobs.id })

      // Track in recent uploads
      const upload: TelegramUpload = {
        blobId: blob.id,
        filename,
        mimeType,
        projectId: activeProjectId,
        caption,
        uploadedAt: timestamp,
      }
      const existing = recentUploads.get(chatId) || []
      existing.push(upload)
      recentUploads.set(chatId, existing)

      // Periodically clean up
      if (Math.random() < 0.1) cleanExpiredUploads()

      const sizeKb = Math.round(buffer.length / 1024)
      const captionLine = caption ? `\n📝 Caption: ${this.escapeHtml(caption)}` : ''

      await sendMessage(
        this.botToken,
        chatId,
        `📷 <b>Image uploaded</b> (${sizeKb} KB)${captionLine}\n`
        + `📁 Project: ${this.escapeHtml(project.name)}\n`
        + `🔗 Blob ID: <code>${blob.id}</code>\n\n`
        + 'The image is now available as context for your project.',
      )
    } catch (err) {
      console.error('[telegram] Photo upload failed:', err)
      await sendMessage(this.botToken, chatId, '❌ Failed to upload image. Please try again.')
    }
  }

  /**
   * Handle document uploads from Telegram users.
   * Similar to photo upload but preserves original filename and MIME type.
   */
  private async handleDocumentUpload(msg: Record<string, unknown>, chatId: string): Promise<void> {
    if (!this.botToken) return

    const account = await this.getAccountByChatId(chatId)
    if (!account) {
      await sendMessage(this.botToken, chatId, '❌ Not connected. Use /start to connect first.')
      return
    }

    const settings = (account.settings ?? {}) as Record<string, unknown>
    const activeProjectId = settings.activeProjectId as string | undefined

    if (!activeProjectId) {
      await sendMessage(
        this.botToken,
        chatId,
        '⚠️ No active project set. Use /project to select one first, then send your file.',
      )
      return
    }

    const doc = msg.document as Record<string, unknown>
    const fileId = doc.file_id as string
    const originalFilename = (doc.file_name as string) || 'telegram-document'
    const mimeType = (doc.mime_type as string) || 'application/octet-stream'
    const fileSize = (doc.file_size as number) || 0
    const caption = (msg.caption as string) || undefined

    // Telegram getFile limit is 20MB
    if (fileSize > 20 * 1024 * 1024) {
      await sendMessage(this.botToken, chatId, '⚠️ File too large (max 20MB via Telegram Bot API).')
      return
    }

    try {
      const fileInfo = await getFile(this.botToken, fileId)
      if (!fileInfo?.file_path) {
        await sendMessage(this.botToken, chatId, '❌ Could not retrieve file from Telegram.')
        return
      }

      const buffer = await downloadFile(this.botToken, fileInfo.file_path)

      // Look up project for teamId
      const [project] = await db.select({ teamId: projects.teamId, name: projects.name })
        .from(projects)
        .where(eq(projects.id, activeProjectId))
        .limit(1)

      if (!project) {
        await sendMessage(this.botToken, chatId, '⚠️ Active project not found. Use /project to select a new one.')
        return
      }

      // Store as blob
      const base64Data = buffer.toString('base64')
      const [blob] = await db.insert(blobs)
        .values({
          ownerId: account.userId,
          teamId: project.teamId,
          mimeType,
          size: buffer.length,
          data: base64Data,
          filename: originalFilename,
          projectId: activeProjectId,
          nodeId: JSON.stringify({ source: 'telegram', caption, originalFilename }),
        })
        .returning({ id: blobs.id })

      // Track in recent uploads
      const upload: TelegramUpload = {
        blobId: blob.id,
        filename: originalFilename,
        mimeType,
        projectId: activeProjectId,
        caption,
        uploadedAt: Date.now(),
      }
      const existing = recentUploads.get(chatId) || []
      existing.push(upload)
      recentUploads.set(chatId, existing)

      const sizeKb = Math.round(buffer.length / 1024)
      const captionLine = caption ? `\n📝 Caption: ${this.escapeHtml(caption)}` : ''

      await sendMessage(
        this.botToken,
        chatId,
        `📎 <b>File uploaded:</b> ${this.escapeHtml(originalFilename)} (${sizeKb} KB)${captionLine}\n`
        + `📁 Project: ${this.escapeHtml(project.name)}\n`
        + `🔗 Blob ID: <code>${blob.id}</code>\n\n`
        + 'The file is now available as context for your project.',
      )
    } catch (err) {
      console.error('[telegram] Document upload failed:', err)
      await sendMessage(this.botToken, chatId, '❌ Failed to upload document. Please try again.')
    }
  }

  // ─── File listing ─────────────────────────────────────────────

  /**
   * Handle /files command — list recent file outputs from active project.
   */
  private async handleFilesCommand(chatId: string): Promise<void> {
    if (!this.botToken) return

    const account = await this.getAccountByChatId(chatId)
    if (!account) {
      await sendMessage(this.botToken, chatId, '❌ Not connected. Use /start to connect first.')
      return
    }

    const settings = (account.settings ?? {}) as Record<string, unknown>
    const activeProjectId = settings.activeProjectId as string | undefined

    if (!activeProjectId) {
      await sendMessage(
        this.botToken,
        chatId,
        '⚠️ No active project set. Use /project to select one first.',
      )
      return
    }

    // Get project name
    const [project] = await db.select({ name: projects.name, icon: projects.icon })
      .from(projects)
      .where(eq(projects.id, activeProjectId))
      .limit(1)

    if (!project) {
      await sendMessage(this.botToken, chatId, '⚠️ Active project not found. Use /project to select a new one.')
      return
    }

    // Query recent file changes for this project
    const changes = await db.select({
      path: fileChanges.path,
      action: fileChanges.action,
      linesAdded: fileChanges.linesAdded,
      linesRemoved: fileChanges.linesRemoved,
      timestamp: fileChanges.timestamp,
    })
      .from(fileChanges)
      .innerJoin(taskExecutions, eq(fileChanges.executionId, taskExecutions.executionId))
      .where(eq(taskExecutions.projectId, activeProjectId))
      .orderBy(desc(fileChanges.timestamp))
      .limit(25)

    if (changes.length === 0) {
      await sendMessage(
        this.botToken,
        chatId,
        `📁 <b>${project.icon || '📋'} ${this.escapeHtml(project.name)}</b>\n\nNo file changes found.`,
      )
      return
    }

    // Format the file list
    const lines: string[] = [
      `📁 <b>${project.icon || '📋'} ${this.escapeHtml(project.name)}</b>`,
      `<i>Recent file changes (${changes.length}):</i>`,
      '',
    ]

    for (const fc of changes) {
      const icon = fc.action === 'create' ? '🟢' : fc.action === 'delete' ? '🔴' : '🟡'
      const shortPath = fc.path.length > 50 ? '...' + fc.path.slice(-47) : fc.path
      const stats: string[] = []
      if (fc.linesAdded) stats.push(`+${fc.linesAdded}`)
      if (fc.linesRemoved) stats.push(`-${fc.linesRemoved}`)
      const statsStr = stats.length > 0 ? ` (${stats.join('/')})` : ''
      const time = fc.timestamp ? new Date(fc.timestamp).toISOString().slice(5, 16).replace('T', ' ') : ''

      lines.push(`${icon} <code>${this.escapeHtml(shortPath)}</code>${statsStr}`)
      if (time) lines.push(`    <i>${time}</i>`)
    }

    // Truncate message to fit Telegram's 4096 char limit
    let message = lines.join('\n')
    if (message.length > 4000) {
      message = message.slice(0, 3990) + '\n\n<i>... truncated</i>'
    }

    await sendMessage(this.botToken, chatId, message)
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

      // Build the main notification text
      let text = `${icon} <b>${title}</b>\n\n${formattedSummary}`

      // Append file changes section for task completions
      const fileChangesList = notification.metadata?.fileChanges as Array<{
        path: string; action: string; linesAdded?: number; linesRemoved?: number
      }> | undefined

      if (fileChangesList && fileChangesList.length > 0) {
        text += '\n\n📂 <b>Files changed:</b>'
        for (const fc of fileChangesList.slice(0, 10)) {
          const fIcon = fc.action === 'create' ? '+' : fc.action === 'delete' ? '-' : '~'
          const shortPath = fc.path.length > 40 ? '...' + fc.path.slice(-37) : fc.path
          const stats: string[] = []
          if (fc.linesAdded) stats.push(`+${fc.linesAdded}`)
          if (fc.linesRemoved) stats.push(`-${fc.linesRemoved}`)
          const statsStr = stats.length > 0 ? ` ${stats.join('/')}` : ''
          text += `\n<code>${fIcon} ${this.escapeHtml(shortPath)}${statsStr}</code>`
        }
        if (fileChangesList.length > 10) {
          text += `\n<i>... and ${fileChangesList.length - 10} more</i>`
        }
      }

      text += `\n\n<a href="${notification.astroUrl}">View in Astro</a>\n\n<i>${timestamp}</i>`

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

  // ─── Public methods for file delivery ─────────────────────────

  /**
   * Send a document to a specific Telegram chat.
   * Used by external hooks to deliver file outputs.
   */
  async sendDocumentToChat(
    chatId: string,
    document: Buffer,
    filename: string,
    caption?: string,
  ): Promise<void> {
    if (!this.botToken) return

    try {
      const result = await sendDocument(this.botToken, chatId, document, filename, caption)
      if (!result.ok) {
        console.warn(`[telegram] sendDocument failed for chat ${chatId}:`, result.description)
      }
    } catch (err) {
      console.error(`[telegram] sendDocument error for chat ${chatId}:`, err)
    }
  }

  /**
   * Send file change information for an execution to relevant Telegram chats.
   * Called by the notification hook when a task completes with file changes.
   */
  async sendFileChangeSummary(
    projectId: string,
    executionId: string,
    changes: Array<{ path: string; action: string; linesAdded?: number; linesRemoved?: number }>,
  ): Promise<void> {
    if (!this.botToken || changes.length === 0) return

    // This is handled inline via the notification metadata — see sendNotificationToProjectMembers
    // This method is available for explicit file delivery if needed in the future
  }

  /**
   * Get recent uploads for a chat (for injecting into chat context).
   */
  getRecentUploads(chatId: string): TelegramUpload[] {
    cleanExpiredUploads()
    return recentUploads.get(chatId) || []
  }

  // ─── Public accessors for route handlers ───────────────────────

  getBotToken(): string | null {
    return this.botToken
  }

  getBotUsername(): string | null {
    return this.botUsername
  }

  // ─── Private helpers ──────────────────────────────────────────

  /**
   * Look up a connected account by Telegram chat ID.
   */
  private async getAccountByChatId(chatId: string): Promise<{
    userId: string
    settings: Record<string, unknown> | null
    accountId: string
  } | null> {
    const [row] = await db.select({
      userId: connectedAccounts.userId,
      settings: connectedAccounts.settings,
      accountId: connectedAccounts.id,
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

    return row ?? null
  }

  /**
   * Escape HTML special characters for Telegram HTML messages.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}

export const telegramChannel = new TelegramChannelAdapter()
