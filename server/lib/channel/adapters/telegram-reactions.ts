/**
 * Telegram Lifecycle Reactions
 *
 * Posts emoji reactions on the inbound user message at well-known points
 * in its processing lifecycle, mirroring hermes-agent's
 * `TelegramAdapter.on_processing_*` hooks:
 *
 *   ⏳  processing started
 *   ✓   reply delivered successfully
 *   ✗   error / failure
 *   📦  response was truncated / chunked across multiple messages
 *
 * Gated by per-account setting `reactionsEnabled` (default false). When
 * disabled, every helper here is a no-op so callers can sprinkle hooks
 * unconditionally without checking.
 *
 * The Bot API `setMessageReaction` returns 400/403 for chat types that
 * disallow reactions (e.g. some channels) or for emoji not in the
 * allowed set without Telegram Premium. We swallow those — reactions
 * are best-effort UX, never load-bearing.
 */

import { setMessageReaction, type TelegramApiResponse } from './telegram-api.js'

/** Emoji vocabulary for lifecycle reactions. Single-character pickable set. */
export const REACTION_EMOJI = {
  processing: '\u23F3', // ⏳
  success: '\u2705', // ✅
  error: '\u274C', // ❌
  truncated: '\uD83D\uDCE6', // 📦
} as const

export type LifecycleReaction = keyof typeof REACTION_EMOJI

export interface ReactionTarget {
  /** Telegram chat_id (string-form, as used elsewhere in the adapter). */
  chatId: string
  /** Original user message_id to react to. */
  messageId: number
}

export interface ReactionOptions {
  /** Whether reactions are enabled at all. Default false. */
  enabled?: boolean
}

/** Parse an arbitrary settings.reactionsEnabled value into a boolean. */
export function parseReactionsEnabled(raw: unknown): boolean {
  if (raw === true) return true
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase()
    return v === 'true' || v === '1' || v === 'yes' || v === 'on'
  }
  return false
}

/**
 * Post a single lifecycle reaction. No-op if `enabled` is false or the
 * target is missing required fields. Swallows API errors.
 */
export async function postLifecycleReaction(
  botToken: string,
  target: ReactionTarget | null | undefined,
  reaction: LifecycleReaction,
  options: ReactionOptions = {},
): Promise<boolean> {
  if (!options.enabled) return false
  if (!target || !target.chatId || !target.messageId) return false
  const emoji = REACTION_EMOJI[reaction]
  try {
    const resp: TelegramApiResponse = await setMessageReaction(
      botToken,
      target.chatId,
      target.messageId,
      emoji,
    )
    if (!resp.ok) {
      // 400 / 403 are expected for restricted chats — swallow.
      return false
    }
    return true
  } catch {
    // Network / unexpected error — swallow.
    return false
  }
}

/** Convenience wrappers — make call sites grep-friendly. */
export const reactProcessing = (token: string, target: ReactionTarget | null | undefined, opts?: ReactionOptions) =>
  postLifecycleReaction(token, target, 'processing', opts)
export const reactSuccess = (token: string, target: ReactionTarget | null | undefined, opts?: ReactionOptions) =>
  postLifecycleReaction(token, target, 'success', opts)
export const reactError = (token: string, target: ReactionTarget | null | undefined, opts?: ReactionOptions) =>
  postLifecycleReaction(token, target, 'error', opts)
export const reactTruncated = (token: string, target: ReactionTarget | null | undefined, opts?: ReactionOptions) =>
  postLifecycleReaction(token, target, 'truncated', opts)
