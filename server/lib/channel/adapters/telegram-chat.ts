/**
 * Telegram Chat Session Handler
 *
 * Routes non-command Telegram messages to Astro's chat API (same backend as web UI).
 * Maps Telegram chat_id → project via connectedAccounts.mappings.defaultProject.
 *
 * Streaming pattern: send initial "thinking" message, then edit it every ~1.5s
 * with accumulated response text to avoid Telegram rate limits (Ductor edit_streaming).
 *
 * Session state stored in connectedAccounts.mappings.chatSession:
 *   - sessionId: provider session ID for resumption
 *   - streamId: stable relay routing key for this conversation
 *   - projectId: active project
 *   - messages: recent conversation history (last N turns)
 */

import { relayServer } from '../../relay-server.js'
import { streamingEventLog } from '../../streaming-event-log.js'
import { executionContextStore } from '../../execution-context-store.js'
import { buildChatSystemPrompt, formatMachineInstruction } from '../../prompt-templates.js'
import { DEFAULT_MACHINE_INSTRUCTION_FORMATTED, MACHINE_INSTRUCTION_PRESETS } from '../../machine-instruction-presets.js'
import { db } from '../../db/index.js'
import { connectedAccounts, projects, planNodes, planEdges, registeredMachines, machineInstructions } from '../../db/schema.js'
import { eq, and, isNull } from 'drizzle-orm'
import type {
  TaskDispatch as RelayTaskDispatch,
  TaskResultMessage,
  TaskTextMessage,
  TaskSessionInitMessage,
} from '../../../types/relay.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max conversation turns to keep in session history */
const MAX_HISTORY_MESSAGES = 30

/** Telegram HTML message character limit */
const TG_MESSAGE_LIMIT = 4000  // leave 96-char margin below 4096

/** How often to edit the in-progress Telegram message (ms) */
const EDIT_INTERVAL_MS = 1500

/** Relay task timeout (ms) */
const RELAY_TIMEOUT_MS = 180_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelegramChatSession {
  /** Provider session ID for resumption (null = start fresh) */
  sessionId: string | null
  /** Stable relay routing key — reused across turns in same conversation */
  streamId: string
  /** Active project ID */
  projectId: string
  /** Recent message history for context (fallback when session resume fails) */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface ChatSessionMappings {
  /** UUID of the project to send messages to */
  defaultProject?: string
  /** Active chat session state */
  chatSession?: TelegramChatSession
}

// ---------------------------------------------------------------------------
// Telegram API helpers (self-contained to avoid circular imports)
// ---------------------------------------------------------------------------

async function telegramApiCall(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return resp.json() as Promise<{ ok: boolean; result?: unknown; description?: string }>
}

/** Send a message and return the message_id */
export async function sendTgMessage(
  token: string,
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
): Promise<number | null> {
  const resp = await telegramApiCall(token, 'sendMessage', {
    chat_id: chatId,
    text: text.slice(0, TG_MESSAGE_LIMIT),
    parse_mode: parseMode,
  })
  if (!resp.ok) return null
  return (resp.result as { message_id: number } | undefined)?.message_id ?? null
}

/** Edit an existing message's text */
async function editTgMessage(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<void> {
  await telegramApiCall(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, TG_MESSAGE_LIMIT),
    parse_mode: 'HTML',
  }).catch(() => { /* ignore edit failures — rate limit or unchanged text */ })
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

/** Parse chat session from connectedAccounts.mappings */
export function parseChatSession(
  mappings: Record<string, unknown> | null | undefined,
): TelegramChatSession | null {
  if (!mappings) return null
  const s = mappings.chatSession as Record<string, unknown> | undefined
  if (!s?.streamId || !s?.projectId) return null
  return {
    sessionId: (s.sessionId as string | null) ?? null,
    streamId: s.streamId as string,
    projectId: s.projectId as string,
    messages: (s.messages as Array<{ role: 'user' | 'assistant'; content: string }>) || [],
  }
}

/** Parse just the default project from mappings */
export function parseDefaultProject(
  mappings: Record<string, unknown> | null | undefined,
): string | null {
  if (!mappings) return null
  return (mappings.defaultProject as string | undefined) ?? null
}

/** Create a fresh session state */
export function createFreshSession(projectId: string): TelegramChatSession {
  return {
    sessionId: null,
    streamId: `tg-chat-${projectId}-${Date.now()}`,
    projectId,
    messages: [],
  }
}

/** Add a message to history, trimming to MAX_HISTORY_MESSAGES */
function appendHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  role: 'user' | 'assistant',
  content: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const updated = [...messages, { role, content }]
  if (updated.length > MAX_HISTORY_MESSAGES) {
    return updated.slice(updated.length - MAX_HISTORY_MESSAGES)
  }
  return updated
}

/** Strip non-Telegram-safe HTML tags from streamed response text */
function sanitizeForTelegram(text: string): string {
  // Telegram only allows: <b>, <i>, <u>, <s>, <code>, <pre>, <a href>, <tg-spoiler>, <blockquote>
  // Replace common markdown patterns and strip unsafe tags
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/<(?!\/?(?:b|i|u|s|code|pre|a|tg-spoiler|blockquote)[\s>/])[^>]+>/gi, '')
}

// ---------------------------------------------------------------------------
// Build system prompt for Telegram chat
// ---------------------------------------------------------------------------

async function buildTelegramSystemPrompt(
  projectId: string,
): Promise<string> {
  // Load vision doc and plan nodes for context
  const [project] = await db
    .select({
      visionDoc: projects.visionDoc,
      defaultMachineId: projects.defaultMachineId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  const visionDoc = project?.visionDoc ?? undefined

  // Load plan nodes (slim — no content/output)
  const nodes = await db
    .select({
      clientId: planNodes.clientId,
      title: planNodes.title,
      status: planNodes.status,
      type: planNodes.type,
      parentId: planNodes.parentId,
      number: planNodes.number,
    })
    .from(planNodes)
    .where(and(eq(planNodes.projectId, projectId), isNull(planNodes.deletedAt)))
    .limit(100)

  // Load edges
  const edges = await db
    .select({
      source: planEdges.source,
      target: planEdges.target,
    })
    .from(planEdges)
    .where(eq(planEdges.projectId, projectId))
    .limit(200)

  // Get machine instruction for skills injection
  let skills: string = DEFAULT_MACHINE_INSTRUCTION_FORMATTED
  if (project?.defaultMachineId) {
    try {
      const [machine] = await db
        .select({ defaultInstructionId: registeredMachines.defaultInstructionId })
        .from(registeredMachines)
        .where(eq(registeredMachines.id, project.defaultMachineId))
        .limit(1)

      const instrId = machine?.defaultInstructionId ?? 'builtin:default'
      let resolved: string | null = null

      if (instrId.startsWith('builtin:')) {
        const preset = MACHINE_INSTRUCTION_PRESETS.find((p) => p.id === instrId)
        if (preset) resolved = formatMachineInstruction(preset.name, preset.content)
      } else {
        const [instr] = await db
          .select({ content: machineInstructions.content, name: machineInstructions.name })
          .from(machineInstructions)
          .where(eq(machineInstructions.id, instrId))
          .limit(1)
        if (instr?.content) resolved = formatMachineInstruction(instr.name, instr.content)
      }

      if (resolved) skills = resolved
    } catch {
      // Use default skills
    }
  }

  // Add Telegram context note to system prompt
  const telegramNote = '\n\n<telegram_context>\nThis conversation is happening via Telegram. Keep responses concise and well-formatted for mobile. Use plain text or minimal HTML (<b>, <i>, <code>, <pre>). Avoid overly long responses.\n</telegram_context>'

  const basePrompt = buildChatSystemPrompt(
    visionDoc,
    nodes as Parameters<typeof buildChatSystemPrompt>[1],
    edges as Parameters<typeof buildChatSystemPrompt>[2],
    skills,
    projectId,
    'chat',
  )

  return basePrompt + telegramNote
}

// ---------------------------------------------------------------------------
// Main: dispatch chat to Telegram with streaming edits
// ---------------------------------------------------------------------------

export interface DispatchChatResult {
  response: string
  newSessionId: string | null
  updatedMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  success: boolean
  error?: string
}

/**
 * Dispatch a chat message to the relay and stream the response back to Telegram
 * by editing the initial "thinking" message as text arrives.
 */
export async function dispatchChatToTelegram(opts: {
  botToken: string
  chatId: string
  userId: string
  userMessage: string
  session: TelegramChatSession
}): Promise<DispatchChatResult> {
  const { botToken, chatId, userId, userMessage, session } = opts
  const taskId = session.streamId

  // 1. Verify project still exists
  const [project] = await db
    .select({
      id: projects.id,
      workingDirectory: projects.workingDirectory,
      defaultMachineId: projects.defaultMachineId,
    })
    .from(projects)
    .where(eq(projects.id, session.projectId))
    .limit(1)

  if (!project) {
    return {
      response: '',
      newSessionId: null,
      updatedMessages: session.messages,
      success: false,
      error: `Project not found: ${session.projectId}`,
    }
  }

  // 2. Build system prompt
  const systemPrompt = await buildTelegramSystemPrompt(session.projectId)

  // 3. Send initial "thinking" message to Telegram
  const messageId = await sendTgMessage(botToken, chatId, '🤔 <i>Thinking…</i>')

  // 4. Build history with user's new message
  const historyWithUser = appendHistory(session.messages, 'user', userMessage)

  // 5. Persist user message to streaming event log
  await streamingEventLog.append(taskId, 'chat_user', { message: userMessage }).catch(() => {})

  // 6. Register in execution context store for access control
  if (userId) {
    await executionContextStore.register({
      executionId: taskId,
      projectId: session.projectId,
      nodeId: '',
      userId,
      machineId: project.defaultMachineId || '',
    }).catch(() => {})
  }

  // 7. Build relay task
  const task: RelayTaskDispatch = {
    taskId,
    projectId: session.projectId,
    nodeId: '',
    title: 'telegram-chat',
    description: userMessage.slice(0, 200),
    prompt: userMessage,
    systemPrompt,
    type: 'chat',
    messages: session.messages,  // History WITHOUT the new user message (prompt carries it)
    maxTurns: 20,
    workingDirectory: project.workingDirectory ?? undefined,
    useWorktree: false,
    ...(session.sessionId ? { resumeSessionId: session.sessionId } : {}),
  }

  // 8. Dispatch and stream
  return new Promise((resolve) => {
    let accumulatedText = ''
    let newSessionId: string | null = session.sessionId
    let editInterval: ReturnType<typeof setInterval> | null = null
    let isDone = false
    let lastEditedText = ''

    const finish = (result: DispatchChatResult) => {
      if (isDone) return
      isDone = true
      if (editInterval) {
        clearInterval(editInterval)
        editInterval = null
      }
      relayServer.off('task:text', onText)
      relayServer.off('task:result', onResult)
      relayServer.off('task:session_init', onSessionInit)
      resolve(result)
    }

    // Timeout guard
    const timeoutHandle = setTimeout(() => {
      const truncated = accumulatedText || '(no response)'
      if (messageId) {
        editTgMessage(
          botToken, chatId, messageId,
          sanitizeForTelegram(truncated) + '\n\n<i>⚠️ Response timed out.</i>',
        ).catch(() => {})
      }
      finish({
        response: truncated,
        newSessionId,
        updatedMessages: appendHistory(historyWithUser, 'assistant', truncated),
        success: false,
        error: 'Timed out waiting for agent response',
      })
    }, RELAY_TIMEOUT_MS)

    // Periodic edit of Telegram message
    if (messageId) {
      editInterval = setInterval(() => {
        if (!isDone && accumulatedText && accumulatedText !== lastEditedText) {
          lastEditedText = accumulatedText
          const display = sanitizeForTelegram(accumulatedText)
          editTgMessage(botToken, chatId, messageId, display + '\n\n<i>▌</i>').catch(() => {})
        }
      }, EDIT_INTERVAL_MS)
    }

    const onText = (msg: TaskTextMessage) => {
      if (msg.taskId !== taskId) return
      accumulatedText += msg.text
    }

    const onSessionInit = (msg: TaskSessionInitMessage) => {
      if (msg.taskId !== taskId) return
      newSessionId = msg.sessionId
    }

    const onResult = (msg: TaskResultMessage) => {
      if (msg.result.taskId !== taskId) return
      clearTimeout(timeoutHandle)

      const isSuccess = msg.result.status === 'completed'
      const finalText = (msg.result.output || accumulatedText || '').trim()

      // Persist result
      streamingEventLog.appendTerminalIfAbsent(taskId, 'result', {
        status: isSuccess ? 'success' : 'failure',
        error: msg.result.error,
      }).catch(() => {})

      // Final edit of Telegram message
      if (messageId) {
        if (isSuccess && finalText) {
          editTgMessage(botToken, chatId, messageId, sanitizeForTelegram(finalText)).catch(() => {})
        } else if (!isSuccess) {
          const errText = `❌ ${msg.result.error || 'Agent returned an error'}`
          editTgMessage(botToken, chatId, messageId, errText).catch(() => {})
        } else {
          // Success but no text — shouldn't happen, but handle gracefully
          editTgMessage(botToken, chatId, messageId, '(No response)').catch(() => {})
        }
      } else if (isSuccess && finalText && !messageId) {
        // If we couldn't send initial message, send final as new message
        sendTgMessage(botToken, chatId, sanitizeForTelegram(finalText)).catch(() => {})
      }

      const assistantContent = finalText || msg.result.error || ''
      const updatedMessages = assistantContent
        ? appendHistory(historyWithUser, 'assistant', assistantContent)
        : historyWithUser

      finish({
        response: finalText,
        newSessionId,
        updatedMessages,
        success: isSuccess,
        error: msg.result.error,
      })
    }

    relayServer.on('task:text', onText)
    relayServer.on('task:result', onResult)
    relayServer.on('task:session_init', onSessionInit)

    const dispatched = relayServer.dispatchTask(task, project.defaultMachineId ?? undefined, userId)
    if (!dispatched) {
      clearTimeout(timeoutHandle)
      const errMsg = '❌ No agent runner connected. Start one with:\n<code>npx @astroanywhere/agent start</code>'
      if (messageId) {
        editTgMessage(botToken, chatId, messageId, errMsg).catch(() => {})
      } else {
        sendTgMessage(botToken, chatId, errMsg).catch(() => {})
      }
      finish({
        response: '',
        newSessionId,
        updatedMessages: historyWithUser,
        success: false,
        error: 'No agent runner connected',
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

/**
 * Save updated chat session state back to connectedAccounts.mappings.
 * Merges with existing mappings to preserve other fields (e.g. defaultProject).
 */
export async function saveChatSession(
  chatId: string,
  updatedSession: TelegramChatSession,
): Promise<void> {
  try {
    const [row] = await db
      .select({ id: connectedAccounts.id, mappings: connectedAccounts.mappings })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.channel, 'telegram'),
          eq(connectedAccounts.externalId, chatId),
          eq(connectedAccounts.enabled, true),
        ),
      )
      .limit(1)

    if (!row) return

    const currentMappings = (row.mappings as Record<string, unknown>) || {}
    const newMappings: Record<string, unknown> = {
      ...currentMappings,
      chatSession: {
        sessionId: updatedSession.sessionId,
        streamId: updatedSession.streamId,
        projectId: updatedSession.projectId,
        messages: updatedSession.messages,
      },
    }

    await db
      .update(connectedAccounts)
      .set({ mappings: newMappings, updatedAt: new Date() })
      .where(eq(connectedAccounts.id, row.id))
  } catch (err) {
    console.warn('[telegram-chat] Failed to save session:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Set the default project in connectedAccounts.mappings and clear existing session.
 */
export async function setDefaultProject(
  chatId: string,
  projectId: string,
): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: connectedAccounts.id, mappings: connectedAccounts.mappings })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.channel, 'telegram'),
          eq(connectedAccounts.externalId, chatId),
          eq(connectedAccounts.enabled, true),
        ),
      )
      .limit(1)

    if (!row) return false

    const currentMappings = (row.mappings as Record<string, unknown>) || {}
    const newMappings: Record<string, unknown> = {
      ...currentMappings,
      defaultProject: projectId,
      // Clear session so next message starts fresh with new project
      chatSession: undefined,
    }

    await db
      .update(connectedAccounts)
      .set({ mappings: newMappings, updatedAt: new Date() })
      .where(eq(connectedAccounts.id, row.id))

    return true
  } catch (err) {
    console.warn('[telegram-chat] Failed to set default project:', err instanceof Error ? err.message : String(err))
    return false
  }
}

/**
 * Clear the active chat session (used by /new command).
 */
export async function clearChatSession(chatId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: connectedAccounts.id, mappings: connectedAccounts.mappings })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.channel, 'telegram'),
          eq(connectedAccounts.externalId, chatId),
          eq(connectedAccounts.enabled, true),
        ),
      )
      .limit(1)

    if (!row) return false

    const currentMappings = (row.mappings as Record<string, unknown>) || {}
    const newMappings: Record<string, unknown> = {
      ...currentMappings,
      chatSession: undefined,
    }

    await db
      .update(connectedAccounts)
      .set({ mappings: newMappings, updatedAt: new Date() })
      .where(eq(connectedAccounts.id, row.id))

    return true
  } catch (err) {
    console.warn('[telegram-chat] Failed to clear session:', err instanceof Error ? err.message : String(err))
    return false
  }
}
