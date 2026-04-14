/**
 * Telegram Bot API — high-level methods
 *
 * All methods route through `telegramFetch` (see telegram-transport.ts).
 * All methods take a `token` as the first argument. None throw — they
 * return a `TelegramApiResponse` so callers can uniformly inspect `ok`.
 */

import { telegramFetch, type TelegramApiResponse } from './telegram-transport.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { TelegramApiResponse }

export type TelegramParseMode = 'HTML' | 'MarkdownV2'

export interface BufferFile {
  buffer: Buffer
  filename: string
  mimeType?: string
}

export type TelegramMedia = string | BufferFile

export interface SendMessageOpts {
  threadId?: string | number
  parseMode?: TelegramParseMode
  replyMarkup?: unknown
  replyToMessageId?: number
  disableWebPagePreview?: boolean
}

export interface EditMessageTextOpts {
  parseMode?: TelegramParseMode
  replyMarkup?: unknown
  disableWebPagePreview?: boolean
}

export interface SendMediaOpts {
  caption?: string
  threadId?: string | number
  parseMode?: TelegramParseMode
  replyToMessageId?: number
  replyMarkup?: unknown
}

export interface SendLocationOpts {
  threadId?: string | number
  replyToMessageId?: number
}

export interface BotCommand {
  command: string
  description: string
}

export type SetMyCommandsScope = Record<string, unknown>

export interface SetWebhookOpts {
  secretToken?: string
  allowedUpdates?: string[]
  dropPendingUpdates?: boolean
}

export interface DeleteWebhookOpts {
  dropPendingUpdates?: boolean
}

export interface TelegramFile {
  file_id: string
  file_unique_id?: string
  file_path?: string
  file_size?: number
}

// Max lengths per Telegram Bot API docs.
const MAX_TEXT_LENGTH = 4096
const MAX_CAPTION_LENGTH = 1024

// ---------------------------------------------------------------------------
// Core helper
// ---------------------------------------------------------------------------

/**
 * Invoke a Bot API method. Supports JSON (plain object body) or multipart
 * (FormData body). Returns a TelegramApiResponse.
 */
export async function callApi(
  token: string,
  method: string,
  body: Record<string, unknown> | FormData,
): Promise<TelegramApiResponse> {
  const url = `https://api.telegram.org/bot${token}/${method}`
  if (body instanceof FormData) {
    return telegramFetch(url, { method: 'POST', body })
  }
  return telegramFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function normaliseThreadId(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined
  return typeof v === 'string' ? Number.parseInt(v, 10) : v
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text
}

// ---------------------------------------------------------------------------
// Text & control
// ---------------------------------------------------------------------------

export async function sendMessage(
  token: string,
  chatId: string | number,
  text: string,
  opts: SendMessageOpts = {},
): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: truncate(text, MAX_TEXT_LENGTH),
  }
  if (opts.parseMode) body.parse_mode = opts.parseMode
  if (opts.replyMarkup) body.reply_markup = opts.replyMarkup
  if (opts.replyToMessageId) body.reply_to_message_id = opts.replyToMessageId
  if (opts.disableWebPagePreview) body.disable_web_page_preview = true
  const threadId = normaliseThreadId(opts.threadId)
  if (threadId !== undefined) body.message_thread_id = threadId
  return callApi(token, 'sendMessage', body)
}

export async function editMessageText(
  token: string,
  chatId: string | number,
  messageId: number,
  text: string,
  opts: EditMessageTextOpts = {},
): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: truncate(text, MAX_TEXT_LENGTH),
  }
  if (opts.parseMode) body.parse_mode = opts.parseMode
  if (opts.replyMarkup) body.reply_markup = opts.replyMarkup
  if (opts.disableWebPagePreview) body.disable_web_page_preview = true
  return callApi(token, 'editMessageText', body)
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert?: boolean,
): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = { callback_query_id: callbackQueryId }
  if (text !== undefined) body.text = text
  if (showAlert !== undefined) body.show_alert = showAlert
  return callApi(token, 'answerCallbackQuery', body)
}

/**
 * Set (or clear) the bot's emoji reaction on a message.
 * Pass `emoji = null` to remove an existing reaction.
 *
 * Telegram only allows the regular "thumbs"/standard emoji set without
 * Telegram Premium; non-allowed emoji or chat types (e.g. some channels)
 * return a 400. Callers should treat 400/403 as "swallowed" — reactions
 * are best-effort UX, never load-bearing.
 */
export async function setMessageReaction(
  token: string,
  chatId: string | number,
  messageId: number,
  emoji: string | null,
  opts: { isBig?: boolean } = {},
): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    reaction:
      emoji === null
        ? []
        : [{ type: 'emoji', emoji }],
  }
  if (opts.isBig !== undefined) body.is_big = opts.isBig
  return callApi(token, 'setMessageReaction', body)
}

export type ChatAction =
  | 'typing'
  | 'upload_photo'
  | 'upload_voice'
  | 'upload_document'
  | 'upload_video'

export async function sendChatAction(
  token: string,
  chatId: string | number,
  action: ChatAction,
  threadId?: string | number,
): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = { chat_id: chatId, action }
  const t = normaliseThreadId(threadId)
  if (t !== undefined) body.message_thread_id = t
  return callApi(token, 'sendChatAction', body)
}

export async function getMe(token: string): Promise<TelegramApiResponse> {
  return callApi(token, 'getMe', {})
}

export async function setMyCommands(
  token: string,
  commands: BotCommand[],
  scope?: SetMyCommandsScope,
): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = { commands }
  if (scope) body.scope = scope
  return callApi(token, 'setMyCommands', body)
}

export async function setWebhook(
  token: string,
  url: string,
  opts: SetWebhookOpts = {},
): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = { url }
  if (opts.secretToken) body.secret_token = opts.secretToken
  if (opts.allowedUpdates) body.allowed_updates = opts.allowedUpdates
  if (opts.dropPendingUpdates) body.drop_pending_updates = true
  return callApi(token, 'setWebhook', body)
}

export async function deleteWebhook(
  token: string,
  opts: DeleteWebhookOpts = {},
): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = {}
  if (opts.dropPendingUpdates) body.drop_pending_updates = true
  return callApi(token, 'deleteWebhook', body)
}

// ---------------------------------------------------------------------------
// Media send
// ---------------------------------------------------------------------------

function applyCommonMediaFields(
  target: Record<string, unknown> | FormData,
  chatId: string | number,
  opts: SendMediaOpts,
): void {
  const caption = opts.caption !== undefined ? truncate(opts.caption, MAX_CAPTION_LENGTH) : undefined
  const threadId = normaliseThreadId(opts.threadId)
  if (target instanceof FormData) {
    target.append('chat_id', String(chatId))
    if (caption !== undefined) target.append('caption', caption)
    if (opts.parseMode) target.append('parse_mode', opts.parseMode)
    if (opts.replyToMessageId !== undefined)
      target.append('reply_to_message_id', String(opts.replyToMessageId))
    if (opts.replyMarkup) target.append('reply_markup', JSON.stringify(opts.replyMarkup))
    if (threadId !== undefined) target.append('message_thread_id', String(threadId))
  } else {
    target.chat_id = chatId
    if (caption !== undefined) target.caption = caption
    if (opts.parseMode) target.parse_mode = opts.parseMode
    if (opts.replyToMessageId !== undefined) target.reply_to_message_id = opts.replyToMessageId
    if (opts.replyMarkup) target.reply_markup = opts.replyMarkup
    if (threadId !== undefined) target.message_thread_id = threadId
  }
}

function bufferToBlob(file: BufferFile): Blob {
  // Node 18+ exposes global Blob; undici fetch accepts it inside FormData.
  const type = file.mimeType || 'application/octet-stream'
  // Uint8Array view is required because Blob typings don't accept raw Buffer
  // in some TS lib versions.
  const view = new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength)
  return new Blob([view], { type })
}

async function sendMediaGeneric(
  token: string,
  method: string,
  field: string,
  chatId: string | number,
  media: TelegramMedia,
  opts: SendMediaOpts,
): Promise<TelegramApiResponse> {
  if (typeof media === 'string') {
    const body: Record<string, unknown> = { [field]: media }
    applyCommonMediaFields(body, chatId, opts)
    return callApi(token, method, body)
  }
  const form = new FormData()
  form.append(field, bufferToBlob(media), media.filename)
  applyCommonMediaFields(form, chatId, opts)
  return callApi(token, method, form)
}

export async function sendPhoto(
  token: string,
  chatId: string | number,
  photo: TelegramMedia,
  opts: SendMediaOpts = {},
): Promise<TelegramApiResponse> {
  return sendMediaGeneric(token, 'sendPhoto', 'photo', chatId, photo, opts)
}

export async function sendVideo(
  token: string,
  chatId: string | number,
  video: TelegramMedia,
  opts: SendMediaOpts = {},
): Promise<TelegramApiResponse> {
  return sendMediaGeneric(token, 'sendVideo', 'video', chatId, video, opts)
}

export async function sendVoice(
  token: string,
  chatId: string | number,
  voice: TelegramMedia,
  opts: SendMediaOpts = {},
): Promise<TelegramApiResponse> {
  return sendMediaGeneric(token, 'sendVoice', 'voice', chatId, voice, opts)
}

export async function sendAudio(
  token: string,
  chatId: string | number,
  audio: TelegramMedia,
  opts: SendMediaOpts = {},
): Promise<TelegramApiResponse> {
  return sendMediaGeneric(token, 'sendAudio', 'audio', chatId, audio, opts)
}

export async function sendAnimation(
  token: string,
  chatId: string | number,
  animation: TelegramMedia,
  opts: SendMediaOpts = {},
): Promise<TelegramApiResponse> {
  return sendMediaGeneric(token, 'sendAnimation', 'animation', chatId, animation, opts)
}

export async function sendDocument(
  token: string,
  chatId: string | number,
  document: TelegramMedia,
  opts: SendMediaOpts = {},
): Promise<TelegramApiResponse> {
  return sendMediaGeneric(token, 'sendDocument', 'document', chatId, document, opts)
}

export async function sendLocation(
  token: string,
  chatId: string | number,
  latitude: number,
  longitude: number,
  opts: SendLocationOpts = {},
): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    latitude,
    longitude,
  }
  if (opts.replyToMessageId !== undefined) body.reply_to_message_id = opts.replyToMessageId
  const threadId = normaliseThreadId(opts.threadId)
  if (threadId !== undefined) body.message_thread_id = threadId
  return callApi(token, 'sendLocation', body)
}

// ---------------------------------------------------------------------------
// File download
// ---------------------------------------------------------------------------

export async function getFile(token: string, fileId: string): Promise<TelegramApiResponse> {
  return callApi(token, 'getFile', { file_id: fileId })
}

/**
 * Download a file from Telegram's file host. Enforces a max size in MB
 * (default 5) configurable via `TELEGRAM_MAX_INBOUND_FILE_MB`.
 *
 * Returns the file as a Buffer, or null if the download failed or the
 * file exceeds the size limit.
 */
export async function downloadFile(token: string, filePath: string): Promise<Buffer | null> {
  const maxMb = Number.parseInt(process.env.TELEGRAM_MAX_INBOUND_FILE_MB || '5', 10)
  const maxBytes = (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 5) * 1024 * 1024

  const url = `https://api.telegram.org/file/bot${token}/${filePath}`
  // We bypass the JSON-parsing path because the file endpoint returns
  // raw bytes, not JSON. We still want the transport's timeout/retry/proxy
  // behaviour, but the simplest correct path is a direct fetch with the
  // same timeout configuration.
  const controller = new AbortController()
  const connectTimeout = Number.parseInt(process.env.TELEGRAM_HTTP_CONNECT_TIMEOUT || '10', 10)
  const readTimeout = Number.parseInt(process.env.TELEGRAM_HTTP_READ_TIMEOUT || '20', 10)
  const total =
    ((Number.isFinite(connectTimeout) && connectTimeout > 0 ? connectTimeout : 10) +
      (Number.isFinite(readTimeout) && readTimeout > 0 ? readTimeout : 20)) *
    1000
  const t = setTimeout(() => controller.abort(), total)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (fetch as any)(url, { signal: controller.signal })
    if (!res || !res.ok) return null
    const contentLength = res.headers?.get?.('content-length')
    if (contentLength) {
      const size = Number.parseInt(contentLength, 10)
      if (Number.isFinite(size) && size > maxBytes) {
        console.warn(
          `[telegram-api] downloadFile: file exceeds ${maxMb}MB limit (${size} bytes)`,
        )
        return null
      }
    }
    const arrayBuffer = await res.arrayBuffer()
    if (arrayBuffer.byteLength > maxBytes) {
      console.warn(
        `[telegram-api] downloadFile: file exceeds ${maxMb}MB limit (${arrayBuffer.byteLength} bytes)`,
      )
      return null
    }
    return Buffer.from(arrayBuffer)
  } catch (e) {
    console.warn(`[telegram-api] downloadFile failed: ${(e as Error).message}`)
    return null
  } finally {
    clearTimeout(t)
  }
}

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// safeSend — BadRequest recovery wrapper
// ---------------------------------------------------------------------------

export interface SafeSendOpts {
  retryWithoutThread?: () => Promise<TelegramApiResponse>
  retryWithoutReply?: () => Promise<TelegramApiResponse>
  retryWithoutParseMode?: () => Promise<TelegramApiResponse>
  retryTruncated?: (maxLen: number) => Promise<TelegramApiResponse>
}

/**
 * Call `fn`; if it returns a Bad Request-style failure, try an appropriate
 * recovery variant based on the error description. Returns whichever
 * response succeeds (or the final failure).
 */
export async function safeSend(
  fn: () => Promise<TelegramApiResponse>,
  opts: SafeSendOpts = {},
): Promise<TelegramApiResponse> {
  const first = await fn()
  if (first.ok) return first

  const desc = first.description || ''

  if (/thread.*not.*found/i.test(desc) && opts.retryWithoutThread) {
    return opts.retryWithoutThread()
  }
  if (/reply.*(not found|deleted|message)/i.test(desc) && opts.retryWithoutReply) {
    return opts.retryWithoutReply()
  }
  if (/message is too long/i.test(desc) && opts.retryTruncated) {
    return opts.retryTruncated(3900)
  }
  if (/message is not modified/i.test(desc)) {
    return { ok: true }
  }
  if (/can't parse entities/i.test(desc) && opts.retryWithoutParseMode) {
    return opts.retryWithoutParseMode()
  }

  return first
}
