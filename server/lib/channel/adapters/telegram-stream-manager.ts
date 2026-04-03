/**
 * Telegram Stream Manager
 *
 * Streams task execution output to Telegram in real-time using the
 * edit-streaming approach: accumulate text chunks, edit the Telegram
 * message every ~1.5s with growing content. When the message exceeds
 * Telegram's 4096 char limit, a new message is created.
 *
 * Subscribes to RelayServer + ExecutionEventBus events for active
 * executions and maps streaming event types to Telegram-friendly output.
 */

import { relayServer } from '../../relay-server.js'
import { executionEventBus } from '../../execution-event-bus.js'
import type {
  TaskTextMessage,
  TaskResultMessage,
  TaskProgressMessage,
  TaskToolTraceMessage,
  TaskFileChangeMessage,
  TaskOperationalMessage,
  TaskSessionInitMessage,
} from '../../../types/relay.js'

// ---------------------------------------------------------------------------
// Telegram Bot API helpers (thin wrappers matching telegram-channel.ts)
// ---------------------------------------------------------------------------

interface TelegramApiResponse {
  ok: boolean
  description?: string
  result?: { message_id?: number } & Record<string, unknown>
}

async function telegramApi(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<TelegramApiResponse> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return (await response.json()) as TelegramApiResponse
}

async function tgSendMessage(
  token: string,
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
): Promise<TelegramApiResponse> {
  return telegramApi(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  })
}

async function tgEditMessage(
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
    disable_web_page_preview: true,
  })
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Telegram message character limit */
const TG_MAX_CHARS = 4096

/** How often to flush edits to Telegram (ms) */
const EDIT_INTERVAL_MS = 1500

/** Max chars to keep in the current message before creating a new one.
 *  Leave headroom for HTML tags and the header line. */
const MSG_SOFT_LIMIT = 3800

/** Max subscriptions per chat to prevent abuse */
const MAX_SUBS_PER_CHAT = 5

/** Auto-cleanup timeout: if no events for 30 min, unsubscribe */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StreamSubscription {
  executionId: string
  chatId: string
  /** Current Telegram message ID being edited */
  currentMessageId: number | null
  /** Accumulated text for the current message */
  buffer: string
  /** Header line shown at the top of each message */
  header: string
  /** Whether we've sent the initial message */
  initialized: boolean
  /** Last edit timestamp (to throttle edits) */
  lastEditAt: number
  /** Whether buffer has changed since last edit */
  dirty: boolean
  /** Timer for periodic edits */
  editTimer: ReturnType<typeof setInterval> | null
  /** Timer for idle cleanup */
  idleTimer: ReturnType<typeof setTimeout> | null
  /** Whether the stream has ended */
  ended: boolean
  /** Count of messages sent for this execution */
  messageCount: number
  /** Task title for display */
  taskTitle?: string
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

class TelegramStreamManager {
  /** Active subscriptions: executionId → chatId → subscription */
  private subs = new Map<string, Map<string, StreamSubscription>>()
  /** Count of active subs per chat */
  private chatSubCount = new Map<string, number>()
  /** Bot token (set on start) */
  private botToken: string | null = null
  /** Whether event listeners are registered */
  private listening = false

  /**
   * Initialize with bot token. Call this when the Telegram adapter starts.
   */
  start(botToken: string): void {
    this.botToken = botToken
    if (!this.listening) {
      this.registerEventListeners()
      this.listening = true
    }
    console.log('[telegram-stream] Stream manager started')
  }

  stop(): void {
    // Cleanup all subscriptions
    for (const [execId, chatMap] of this.subs) {
      for (const [chatId] of chatMap) {
        this.unsubscribeInternal(execId, chatId, 'manager stopped')
      }
    }
    this.subs.clear()
    this.chatSubCount.clear()
    console.log('[telegram-stream] Stream manager stopped')
  }

  /**
   * Subscribe a Telegram chat to an execution's streaming output.
   * Returns an error string if subscription fails, null on success.
   */
  async subscribe(
    executionId: string,
    chatId: string,
    taskTitle?: string,
  ): Promise<string | null> {
    if (!this.botToken) {
      return 'Telegram bot not configured'
    }

    // Check if already subscribed
    const existing = this.subs.get(executionId)?.get(chatId)
    if (existing && !existing.ended) {
      return 'Already watching this execution'
    }

    // Check per-chat limit
    const chatCount = this.chatSubCount.get(chatId) || 0
    if (chatCount >= MAX_SUBS_PER_CHAT) {
      return `Maximum ${MAX_SUBS_PER_CHAT} concurrent streams per chat`
    }

    const header = taskTitle
      ? `🔄 <b>Streaming:</b> ${escapeHtml(taskTitle)}`
      : `🔄 <b>Streaming:</b> <code>${executionId.slice(0, 8)}</code>`

    const sub: StreamSubscription = {
      executionId,
      chatId,
      currentMessageId: null,
      buffer: '',
      header,
      initialized: false,
      lastEditAt: 0,
      dirty: false,
      editTimer: null,
      idleTimer: null,
      ended: false,
      messageCount: 0,
      taskTitle,
    }

    // Register in maps
    if (!this.subs.has(executionId)) {
      this.subs.set(executionId, new Map())
    }
    this.subs.get(executionId)!.set(chatId, sub)
    this.chatSubCount.set(chatId, chatCount + 1)

    // Start the edit timer
    sub.editTimer = setInterval(() => {
      void this.flushEdit(sub)
    }, EDIT_INTERVAL_MS)

    // Start idle timer
    this.resetIdleTimer(sub)

    // Send initial message
    const initText = `${header}\n\n⏳ Waiting for output...`
    const resp = await tgSendMessage(this.botToken, chatId, initText)
    if (resp.ok && resp.result?.message_id) {
      sub.currentMessageId = resp.result.message_id
      sub.initialized = true
      sub.messageCount = 1
    }

    return null
  }

  /**
   * Unsubscribe a chat from an execution.
   */
  unsubscribe(executionId: string, chatId: string): void {
    this.unsubscribeInternal(executionId, chatId, 'user request')
  }

  /**
   * Check if a chat is subscribed to any execution.
   */
  getActiveSubscriptions(chatId: string): string[] {
    const result: string[] = []
    for (const [execId, chatMap] of this.subs) {
      const sub = chatMap.get(chatId)
      if (sub && !sub.ended) {
        result.push(execId)
      }
    }
    return result
  }

  // ─── Event Listeners ─────────────────────────────────────────────

  private registerEventListeners(): void {
    // Subscribe to relay server events (covers both local and cross-instance)
    relayServer.on('task:text', this.onText)
    relayServer.on('task:result', this.onResult)
    relayServer.on('task:progress', this.onProgress)
    relayServer.on('task:tool_trace', this.onToolTrace)
    relayServer.on('task:file_change', this.onFileChange)
    relayServer.on('task:operational', this.onOperational)
    relayServer.on('task:session_init', this.onSessionInit)
    relayServer.on('task:error', this.onError)

    // Also subscribe to execution event bus for local executions
    executionEventBus.on('task:result', this.onExecBusResult)
    executionEventBus.on('task:error', this.onExecBusError)
    executionEventBus.on('task:progress', this.onExecBusProgress)
    executionEventBus.on('task:tool_trace', this.onExecBusToolTrace)
    executionEventBus.on('task:file_change', this.onExecBusFileChange)
    executionEventBus.on('task:session_init', this.onExecBusSessionInit)
  }

  // ─── Relay Server Handlers ────────────────────────────────────────

  private onText = (msg: TaskTextMessage): void => {
    this.appendToAll(msg.taskId, msg.text)
  }

  private onResult = (msg: TaskResultMessage): void => {
    const taskId = msg.result.taskId
    const status = msg.result.status
    const output = msg.result.output
    const error = msg.result.error

    let text = ''
    if (status === 'completed' || status === 'success') {
      text = '\n\n✅ <b>Task completed</b>'
      if (output) {
        const summary = truncateText(output, 500)
        text += `\n${escapeHtml(summary)}`
      }
    } else if (status === 'error' || status === 'failure') {
      text = '\n\n❌ <b>Task failed</b>'
      if (error) {
        text += `\n<code>${escapeHtml(truncateText(error, 300))}</code>`
      }
    } else {
      text = `\n\n📋 <b>Task finished:</b> ${escapeHtml(status)}`
    }

    // Append summary and PR info if available
    const result = msg.result as Record<string, unknown>
    if (result.prUrl) {
      text += `\n🔗 <a href="${result.prUrl as string}">PR #${result.prNumber || '?'}</a>`
    }
    if (result.branchName) {
      text += `\n🌿 Branch: <code>${escapeHtml(result.branchName as string)}</code>`
    }

    this.appendToAll(taskId, text)

    // End all streams for this execution
    this.endStreams(taskId)
  }

  private onProgress = (msg: TaskProgressMessage): void => {
    const pct = Math.round(msg.progress)
    const bar = progressBar(pct)
    const progressText = msg.message
      ? `\n📊 ${bar} ${pct}% — ${escapeHtml(msg.message)}`
      : `\n📊 ${bar} ${pct}%`
    this.appendToAll(msg.taskId, progressText)
  }

  private onToolTrace = (msg: TaskToolTraceMessage): void => {
    if (msg.toolResult !== undefined) {
      // Tool result
      const success = msg.success !== false
      const icon = success ? '✅' : '❌'
      const duration = msg.duration ? ` (${(msg.duration / 1000).toFixed(1)}s)` : ''
      this.appendToAll(msg.taskId, `\n${icon} ${escapeHtml(msg.toolName)}${duration}`)
    } else {
      // Tool use
      const input = formatToolInput(msg.toolName, msg.toolInput)
      this.appendToAll(msg.taskId, `\n🔧 <b>${escapeHtml(msg.toolName)}</b>${input}`)
    }
  }

  private onFileChange = (msg: TaskFileChangeMessage): void => {
    const action = msg.action || 'modified'
    const icon = action === 'created' ? '📄' : action === 'deleted' ? '🗑️' : '✏️'
    let line = `\n${icon} ${escapeHtml(msg.path)}`
    if (msg.linesAdded || msg.linesRemoved) {
      const parts: string[] = []
      if (msg.linesAdded) parts.push(`+${msg.linesAdded}`)
      if (msg.linesRemoved) parts.push(`-${msg.linesRemoved}`)
      line += ` (${parts.join('/')})`
    }
    this.appendToAll(msg.taskId, line)
  }

  private onOperational = (msg: TaskOperationalMessage): void => {
    this.appendToAll(msg.taskId, `\n⚙️ ${escapeHtml(msg.message)}`)
  }

  private onSessionInit = (msg: TaskSessionInitMessage): void => {
    const model = msg.model ? ` (${escapeHtml(msg.model)})` : ''
    this.appendToAll(msg.taskId, `\n🤖 Session started${model}`)
  }

  private onError = (msg: { taskId: string; error: string; recoverable?: boolean }): void => {
    const icon = msg.recoverable ? '⚠️' : '❌'
    this.appendToAll(msg.taskId, `\n${icon} <b>Error:</b> <code>${escapeHtml(truncateText(msg.error, 200))}</code>`)
    if (!msg.recoverable) {
      this.endStreams(msg.taskId)
    }
  }

  // ─── Execution Event Bus Handlers ─────────────────────────────────
  // These handle local executions. The message shapes differ slightly
  // from relay server messages; we normalize them here.

  private onExecBusResult = (msg: Record<string, unknown>): void => {
    // Local execution results have a different shape
    const taskId = (msg.taskId || msg.executionId) as string | undefined
    if (!taskId || !this.subs.has(taskId)) return
    // Delegate to the main handler format
    this.onResult({
      type: 'task.result',
      timestamp: new Date(),
      result: {
        taskId,
        status: (msg.status as string) || 'completed',
        output: msg.output as string | undefined,
        error: msg.error as string | undefined,
        ...(msg as Record<string, unknown>),
      },
    } as TaskResultMessage)
  }

  private onExecBusError = (msg: Record<string, unknown>): void => {
    const taskId = (msg.taskId || msg.executionId) as string | undefined
    if (!taskId || !this.subs.has(taskId)) return
    this.onError({
      taskId,
      error: (msg.error as string) || 'Unknown error',
      recoverable: msg.recoverable as boolean | undefined,
    })
  }

  private onExecBusProgress = (msg: Record<string, unknown>): void => {
    const taskId = (msg.taskId || msg.executionId) as string | undefined
    if (!taskId || !this.subs.has(taskId)) return
    this.onProgress({
      type: 'task.progress',
      timestamp: new Date(),
      taskId,
      progress: (msg.progress as number) || 0,
      message: msg.message as string | undefined,
    })
  }

  private onExecBusToolTrace = (msg: Record<string, unknown>): void => {
    const taskId = (msg.taskId || msg.executionId) as string | undefined
    if (!taskId || !this.subs.has(taskId)) return
    this.onToolTrace({
      type: 'task.tool_trace',
      timestamp: new Date(),
      taskId,
      toolName: (msg.toolName as string) || 'unknown',
      toolInput: msg.toolInput,
      toolResult: msg.toolResult,
      success: msg.success as boolean | undefined,
      duration: msg.duration as number | undefined,
    })
  }

  private onExecBusFileChange = (msg: Record<string, unknown>): void => {
    const taskId = (msg.taskId || msg.executionId) as string | undefined
    if (!taskId || !this.subs.has(taskId)) return
    this.onFileChange({
      type: 'task.file_change',
      timestamp: new Date(),
      taskId,
      path: (msg.path as string) || 'unknown',
      action: msg.action as string | undefined,
      linesAdded: msg.linesAdded as number | undefined,
      linesRemoved: msg.linesRemoved as number | undefined,
    } as TaskFileChangeMessage)
  }

  private onExecBusSessionInit = (msg: Record<string, unknown>): void => {
    const taskId = (msg.taskId || msg.executionId) as string | undefined
    if (!taskId || !this.subs.has(taskId)) return
    this.onSessionInit({
      type: 'task.session_init',
      timestamp: new Date(),
      taskId,
      sessionId: (msg.sessionId as string) || '',
      model: msg.model as string | undefined,
    })
  }

  // ─── Core Streaming Logic ─────────────────────────────────────────

  /**
   * Append text to all subscribed chats for an execution.
   */
  private appendToAll(executionId: string, text: string): void {
    const chatMap = this.subs.get(executionId)
    if (!chatMap) return

    for (const sub of chatMap.values()) {
      if (sub.ended) continue
      sub.buffer += text
      sub.dirty = true
      this.resetIdleTimer(sub)
    }
  }

  /**
   * Flush accumulated buffer to Telegram via message edit.
   * If the message exceeds the soft limit, create a new message.
   */
  private async flushEdit(sub: StreamSubscription): Promise<void> {
    if (!this.botToken || !sub.dirty || sub.ended) return

    // Throttle: don't edit more often than EDIT_INTERVAL_MS
    const now = Date.now()
    if (now - sub.lastEditAt < EDIT_INTERVAL_MS - 100) return

    sub.dirty = false
    sub.lastEditAt = now

    const fullText = `${sub.header}\n\n${sub.buffer}`

    // Check if we need to split into a new message
    if (fullText.length > MSG_SOFT_LIMIT && sub.currentMessageId) {
      // Finalize the current message and start a new one
      await this.finalizeCurrentMessage(sub)
      return
    }

    // Truncate if somehow exceeds hard limit
    const displayText = fullText.length > TG_MAX_CHARS
      ? fullText.slice(0, TG_MAX_CHARS - 20) + '\n\n<i>[truncated]</i>'
      : fullText

    try {
      if (sub.currentMessageId) {
        // Edit existing message
        const resp = await tgEditMessage(
          this.botToken,
          sub.chatId,
          sub.currentMessageId,
          displayText,
        )
        // If edit fails (message too old, deleted, etc.), create new
        if (!resp.ok && resp.description?.includes('message is not modified')) {
          // Content hasn't changed, that's fine
          return
        }
        if (!resp.ok) {
          console.warn(`[telegram-stream] Edit failed for ${sub.executionId}: ${resp.description}`)
          // Create a new message instead
          sub.currentMessageId = null
        }
      }

      if (!sub.currentMessageId) {
        // Send a new message
        const resp = await tgSendMessage(this.botToken, sub.chatId, displayText)
        if (resp.ok && resp.result?.message_id) {
          sub.currentMessageId = resp.result.message_id
          sub.messageCount++
        }
      }
    } catch (err) {
      console.warn(`[telegram-stream] Failed to update message for ${sub.executionId}:`, err)
    }
  }

  /**
   * Finalize the current message and start a new one.
   * Used when content exceeds the soft limit.
   */
  private async finalizeCurrentMessage(sub: StreamSubscription): Promise<void> {
    if (!this.botToken) return

    // Final edit of the current message with what we have
    const currentText = `${sub.header}\n\n${sub.buffer}`
    const truncated = currentText.length > TG_MAX_CHARS
      ? currentText.slice(0, TG_MAX_CHARS - 30) + '\n\n<i>[continued below ↓]</i>'
      : currentText

    if (sub.currentMessageId) {
      try {
        await tgEditMessage(this.botToken, sub.chatId, sub.currentMessageId, truncated)
      } catch {
        // Best effort
      }
    }

    // Reset buffer and create new message
    sub.buffer = ''
    sub.dirty = false

    const continueHeader = `${sub.header} <i>(continued)</i>`
    const resp = await tgSendMessage(this.botToken, sub.chatId, `${continueHeader}\n\n⏳ ...`)
    if (resp.ok && resp.result?.message_id) {
      sub.currentMessageId = resp.result.message_id
      sub.messageCount++
    } else {
      sub.currentMessageId = null
    }
  }

  /**
   * End streaming for all chats subscribed to an execution.
   */
  private endStreams(executionId: string): void {
    const chatMap = this.subs.get(executionId)
    if (!chatMap) return

    for (const [chatId, sub] of chatMap) {
      if (sub.ended) continue
      sub.ended = true

      // Final flush
      void this.flushEdit(sub).then(() => {
        this.cleanupSub(sub)
      })

      // Decrease chat count
      const count = this.chatSubCount.get(chatId) || 1
      this.chatSubCount.set(chatId, Math.max(0, count - 1))
    }

    // Clean up after a short delay to allow final flush
    setTimeout(() => {
      this.subs.delete(executionId)
    }, 5000)
  }

  private unsubscribeInternal(executionId: string, chatId: string, reason: string): void {
    const chatMap = this.subs.get(executionId)
    if (!chatMap) return

    const sub = chatMap.get(chatId)
    if (!sub) return

    sub.ended = true
    this.cleanupSub(sub)
    chatMap.delete(chatId)

    if (chatMap.size === 0) {
      this.subs.delete(executionId)
    }

    // Decrease chat count
    const count = this.chatSubCount.get(chatId) || 1
    this.chatSubCount.set(chatId, Math.max(0, count - 1))

    // Notify user if not a system cleanup
    if (this.botToken && reason === 'user request') {
      void tgSendMessage(
        this.botToken,
        chatId,
        `🛑 Stopped streaming <code>${executionId.slice(0, 8)}</code>`,
      )
    }
  }

  private cleanupSub(sub: StreamSubscription): void {
    if (sub.editTimer) {
      clearInterval(sub.editTimer)
      sub.editTimer = null
    }
    if (sub.idleTimer) {
      clearTimeout(sub.idleTimer)
      sub.idleTimer = null
    }
  }

  private resetIdleTimer(sub: StreamSubscription): void {
    if (sub.idleTimer) {
      clearTimeout(sub.idleTimer)
    }
    sub.idleTimer = setTimeout(() => {
      if (!sub.ended) {
        sub.ended = true
        void this.flushEdit(sub).then(() => {
          if (this.botToken) {
            void tgSendMessage(
              this.botToken,
              sub.chatId,
              `⏰ Stream for <code>${sub.executionId.slice(0, 8)}</code> timed out (no activity for 30 min)`,
            )
          }
          this.unsubscribeInternal(sub.executionId, sub.chatId, 'idle timeout')
        })
      }
    }, IDLE_TIMEOUT_MS)
  }

  /**
   * Auto-subscribe all Telegram-connected members of a project to an execution.
   * Called when a task is dispatched so users automatically see live output.
   */
  async autoSubscribeProjectMembers(
    executionId: string,
    projectId: string,
    taskTitle?: string,
  ): Promise<void> {
    if (!this.botToken) return

    try {
      // Dynamic import to avoid circular dependencies
      const { db } = await import('../../db/index.js')
      const { connectedAccounts, projects, teamMembers } = await import('../../db/schema.js')
      const { eq, and, inArray } = await import('drizzle-orm')

      // Look up project to get teamId and ownerId
      const [project] = await db.select({
        teamId: projects.teamId,
        ownerId: projects.ownerId,
      })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      if (!project) return

      // Collect user IDs
      let userIds: string[] = []
      if (project.teamId) {
        const members = await db.select({ userId: teamMembers.userId })
          .from(teamMembers)
          .where(eq(teamMembers.teamId, project.teamId))
        userIds = members.map((m) => m.userId)
      }
      if (!userIds.includes(project.ownerId)) {
        userIds.push(project.ownerId)
      }

      if (userIds.length === 0) return

      // Get Telegram-connected accounts with streaming enabled
      const accounts = await db.select({
        externalId: connectedAccounts.externalId,
        settings: connectedAccounts.settings,
      })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.channel, 'telegram'),
            eq(connectedAccounts.enabled, true),
            inArray(connectedAccounts.userId, userIds),
          ),
        )

      // Subscribe each connected chat (only if they have streaming enabled or default)
      for (const account of accounts) {
        if (!account.externalId) continue
        const settings = account.settings as Record<string, unknown> | null
        // Auto-streaming is opt-in: users must have `autoStream: true` in settings
        if (!settings || settings.autoStream !== true) continue

        await this.subscribe(executionId, account.externalId, taskTitle)
      }
    } catch (err) {
      console.warn('[telegram-stream] Failed to auto-subscribe project members:', err)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

/**
 * Render a text-based progress bar.
 * e.g., ████████░░ 80%
 */
function progressBar(pct: number): string {
  const filled = Math.round(pct / 10)
  const empty = 10 - filled
  return '█'.repeat(filled) + '░'.repeat(empty)
}

/**
 * Format tool input into a compact display string.
 */
function formatToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''

  const obj = input as Record<string, unknown>

  // Common tool patterns
  if (toolName === 'Read' || toolName === 'read_file') {
    return obj.file_path ? `: <code>${escapeHtml(String(obj.file_path))}</code>` : ''
  }
  if (toolName === 'Write' || toolName === 'write_file') {
    return obj.file_path ? `: <code>${escapeHtml(String(obj.file_path))}</code>` : ''
  }
  if (toolName === 'Edit' || toolName === 'edit_file') {
    return obj.file_path ? `: <code>${escapeHtml(String(obj.file_path))}</code>` : ''
  }
  if (toolName === 'Bash' || toolName === 'execute_command') {
    const cmd = obj.command ? String(obj.command) : ''
    return cmd ? `: <code>${escapeHtml(truncateText(cmd, 80))}</code>` : ''
  }
  if (toolName === 'Grep' || toolName === 'search') {
    return obj.pattern ? `: <code>${escapeHtml(truncateText(String(obj.pattern), 60))}</code>` : ''
  }
  if (toolName === 'Glob') {
    return obj.pattern ? `: <code>${escapeHtml(String(obj.pattern))}</code>` : ''
  }
  if (toolName === 'WebFetch' || toolName === 'web_fetch') {
    return obj.url ? `: <code>${escapeHtml(truncateText(String(obj.url), 60))}</code>` : ''
  }

  return ''
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const telegramStreamManager = new TelegramStreamManager()
