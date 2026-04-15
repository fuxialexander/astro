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
import { connectedAccounts, projects, planNodes, planEdges, registeredMachines, machineInstructions, teamMembers } from '../../db/schema.js'
import { eq, and, isNull } from 'drizzle-orm'
import type {
  TaskDispatch as RelayTaskDispatch,
  TaskResultMessage,
  TaskTextMessage,
  TaskSessionInitMessage,
} from '../../../types/relay.js'
import {
  sendMessage,
  editMessageText,
  sendChatAction,
  safeSend,
  type TelegramApiResponse,
} from './telegram-api.js'
import { toMarkdownV2, stripMdv2 } from './telegram-markdown-v2.js'
import { chunkMessage } from './telegram-chunking.js'
import {
  reactProcessing,
  reactSuccess,
  reactError,
  reactTruncated,
} from './telegram-reactions.js'

/** How the first chunk of a multi-chunk reply relates to the originating user message. */
export type ReplyToMode = 'off' | 'first' | 'all'

/**
 * Pure policy: should chunk `chunkIndex` of a multi-chunk reply be sent
 * with reply_to_message_id set?
 *
 *   - If there is no original message to reply to, never thread.
 *   - 'off'   → never thread any chunk.
 *   - 'first' → only the first chunk threads (default; matches hermes).
 *   - 'all'   → every chunk threads.
 *   - Unknown values fall back to 'first' behaviour.
 */
export function shouldThreadReply(
  replyToMessageId: number | undefined | null,
  chunkIndex: number,
  mode: ReplyToMode,
): boolean {
  if (replyToMessageId === undefined || replyToMessageId === null) return false
  if (mode === 'off') return false
  if (mode === 'all') return true
  // 'first' (and any unknown / invalid value)
  return chunkIndex === 0
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max conversation turns to keep in session history */
const MAX_HISTORY_MESSAGES = 30

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
// Telegram API thin wrappers (delegate to ./telegram-api.js)
// ---------------------------------------------------------------------------

function extractMessageId(resp: TelegramApiResponse): number | null {
  if (!resp.ok) return null
  const result = resp.result as { message_id?: number } | undefined
  return result?.message_id ?? null
}

/** Send a text message and return the new message_id (or null on failure). */
export async function sendTgMessage(
  token: string,
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
  opts: { threadId?: string; replyToMessageId?: number } = {},
): Promise<number | null> {
  const resp = await sendMessage(token, chatId, text, {
    parseMode,
    threadId: opts.threadId,
    replyToMessageId: opts.replyToMessageId,
  })
  return extractMessageId(resp)
}

/** Edit an existing message's text. Swallows failures (rate-limit / unchanged). */
async function editTgMessage(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
): Promise<void> {
  await editMessageText(token, chatId, messageId, text, { parseMode }).catch(() => { /* ignore */ })
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
  userId: string | null,
): Promise<string | null> {
  // Defense-in-depth: require the caller to be a member of the team that
  // owns this project before loading its vision doc, plan nodes, and
  // machine instructions into the AI context. Callers upstream (topic
  // binding creation, private-chat session lookup) already scope projectId
  // to the user, but this guard prevents a future regression in any of
  // those paths from leaking cross-team project context. Returns null
  // when unauthorized so the caller can abort the dispatch.
  if (!userId) return null
  const [project] = await db
    .select({
      visionDoc: projects.visionDoc,
      defaultMachineId: projects.defaultMachineId,
    })
    .from(projects)
    .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
    .where(and(eq(projects.id, projectId), eq(teamMembers.userId, userId)))
    .limit(1)

  if (!project) return null

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
      source: planEdges.sourceClientId,
      target: planEdges.targetClientId,
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
 * Deliver the final MarkdownV2-formatted response as one or more Telegram
 * messages. Earlier chunks are sent as new messages; the last chunk replaces
 * the in-place "thinking" message via editMessageText. Parse errors
 * gracefully degrade to plain text (stripMdv2) via safeSend.
 */
async function deliverFinalChunks(args: {
  botToken: string
  chatId: string
  threadId?: string
  replyToMessageId?: number
  replyToMode: ReplyToMode
  messageId: number | null
  chunks: Array<{ text: string; isFirst: boolean; isLast: boolean }>
}): Promise<void> {
  const { botToken, chatId, threadId, replyToMessageId, replyToMode, messageId, chunks } = args
  if (chunks.length === 0) return

  const replyIdForChunk = (chunkIndex: number): number | undefined => {
    return shouldThreadReply(replyToMessageId, chunkIndex, replyToMode)
      ? replyToMessageId
      : undefined
  }

  // Earlier chunks: send as new messages (in order).
  for (let i = 0; i < chunks.length - 1; i++) {
    const chunk = chunks[i]
    const rid = replyIdForChunk(i)
    await safeSend(
      () => sendMessage(botToken, chatId, chunk.text, {
        parseMode: 'MarkdownV2',
        threadId,
        replyToMessageId: rid,
      }),
      {
        retryWithoutParseMode: () => sendMessage(botToken, chatId, stripMdv2(chunk.text), {
          threadId,
          replyToMessageId: rid,
        }),
        retryWithoutReply: () => sendMessage(botToken, chatId, chunk.text, {
          parseMode: 'MarkdownV2',
          threadId,
        }),
      },
    ).catch(() => {})
  }

  // Final chunk: edit the thinking-message in-place if we have one, else send.
  const last = chunks[chunks.length - 1]
  const lastReplyId = replyIdForChunk(chunks.length - 1)
  if (messageId) {
    await safeSend(
      () => editMessageText(botToken, chatId, messageId, last.text, { parseMode: 'MarkdownV2' }),
      {
        retryWithoutParseMode: () => editMessageText(botToken, chatId, messageId, stripMdv2(last.text)),
      },
    ).catch(() => {})
  } else {
    await safeSend(
      () => sendMessage(botToken, chatId, last.text, {
        parseMode: 'MarkdownV2',
        threadId,
        replyToMessageId: lastReplyId,
      }),
      {
        retryWithoutParseMode: () => sendMessage(botToken, chatId, stripMdv2(last.text), {
          threadId,
          replyToMessageId: lastReplyId,
        }),
        retryWithoutReply: () => sendMessage(botToken, chatId, last.text, {
          parseMode: 'MarkdownV2',
          threadId,
        }),
      },
    ).catch(() => {})
  }
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
  /** Optional thread (forum topic) to send to. */
  threadId?: string
  /** Optional id of the incoming user message to reply to. */
  replyToMessageId?: number
  /** Reply-to policy for multi-chunk replies. Default: 'first'. */
  replyToMode?: ReplyToMode
  /** When true, post lifecycle emoji reactions on the inbound user message. */
  reactionsEnabled?: boolean
  /** Optional image references (data: URLs) extracted from the inbound Telegram message. */
  imageRefs?: string[]
}): Promise<DispatchChatResult> {
  const {
    botToken,
    chatId,
    userId,
    userMessage,
    session,
    threadId,
    replyToMessageId,
    imageRefs,
  } = opts
  const replyToMode: ReplyToMode = opts.replyToMode ?? 'first'
  const reactionsEnabled = opts.reactionsEnabled ?? false
  const reactionTarget =
    replyToMessageId !== undefined ? { chatId, messageId: replyToMessageId } : null
  const reactionOpts = { enabled: reactionsEnabled }
  const taskId = session.streamId

  // Lifecycle hook: processing started.
  if (reactionsEnabled && reactionTarget) {
    void reactProcessing(botToken, reactionTarget, reactionOpts)
  }

  // Kick off (and periodically refresh) a "typing…" action for as long as the
  // agent is thinking. Telegram clears this automatically after ~5s so we
  // refresh every 4s. Any failure here is non-fatal.
  let typingInterval: ReturnType<typeof setInterval> | null = null
  try {
    await sendChatAction(botToken, chatId, 'typing', threadId).catch(() => {})
    typingInterval = setInterval(() => {
      sendChatAction(botToken, chatId, 'typing', threadId).catch(() => {})
    }, 4000)
  } catch { /* ignore */ }
  const stopTyping = () => {
    if (typingInterval) {
      clearInterval(typingInterval)
      typingInterval = null
    }
  }

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
    stopTyping()
    return {
      response: '',
      newSessionId: null,
      updatedMessages: session.messages,
      success: false,
      error: `Project not found: ${session.projectId}`,
    }
  }

  // 2. Build system prompt (enforces team membership as defense-in-depth;
  //    returns null if the caller is not a member of the project's team)
  const systemPrompt = await buildTelegramSystemPrompt(session.projectId, userId ?? null)
  if (!systemPrompt) {
    stopTyping()
    return {
      response: '',
      newSessionId: null,
      updatedMessages: session.messages,
      success: false,
      error: `Not authorized to access project: ${session.projectId}`,
    }
  }

  // 3. Send initial "thinking" message to Telegram (plain HTML — mid-stream
  //    MdV2 escaping is fragile; we swap to MdV2 on the final edit only).
  const messageId = await sendTgMessage(botToken, chatId, '🤔 <i>Thinking…</i>', 'HTML', {
    threadId,
    replyToMessageId,
  })

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
    ...(imageRefs && imageRefs.length > 0 ? { imageRefs } : {}),
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
      stopTyping()
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
      if (reactionsEnabled && reactionTarget) {
        void reactError(botToken, reactionTarget, reactionOpts)
      }
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

      // Final output: convert to MarkdownV2 and chunk for >4096 UTF-16 units.
      // Chunks are delivered as follows:
      //   • last chunk -> edit the in-place "thinking" message
      //   • earlier chunks -> sent as new messages (in order)
      //   • reply_to_message_id applied per `replyToMode`
      if (isSuccess && finalText) {
        const mdv2 = toMarkdownV2(finalText)
        const chunks = chunkMessage(mdv2, { maxUnits: 4096 })
        // Fire-and-forget from this SSE callback; handle errors internally.
        void deliverFinalChunks({
          botToken,
          chatId,
          threadId,
          replyToMessageId,
          replyToMode,
          messageId,
          chunks,
        })
        // Lifecycle hook: success (or truncated if the reply was chunked).
        if (reactionsEnabled && reactionTarget) {
          if (chunks.length > 1) {
            void reactTruncated(botToken, reactionTarget, reactionOpts)
          } else {
            void reactSuccess(botToken, reactionTarget, reactionOpts)
          }
        }
      } else if (!isSuccess) {
        if (reactionsEnabled && reactionTarget) {
          void reactError(botToken, reactionTarget, reactionOpts)
        }
        const errText = `❌ ${msg.result.error || 'Agent returned an error'}`
        if (messageId) {
          editTgMessage(botToken, chatId, messageId, errText, 'HTML').catch(() => {})
        } else {
          sendTgMessage(botToken, chatId, errText, 'HTML', { threadId, replyToMessageId }).catch(() => {})
        }
      } else if (messageId) {
        // Success but no text — handle gracefully
        editTgMessage(botToken, chatId, messageId, '(No response)', 'HTML').catch(() => {})
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
      if (reactionsEnabled && reactionTarget) {
        void reactError(botToken, reactionTarget, reactionOpts)
      }
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
