/**
 * Chat context truncation for fallback sessions.
 *
 * When a chat session cannot be resumed (provider change, session expired, first turn),
 * the full message history is sent as fallback context. For long conversations this can
 * exceed the model's context window before the SDK's auto-compaction kicks in.
 *
 * This module truncates the message history to a safe size, keeping only the most recent
 * turns so the agent has enough context to continue coherently.
 */

/** Max number of messages to keep in fallback context (~20 user/assistant pairs) */
export const FALLBACK_MAX_MESSAGES = 40

/** Max total characters across all messages (~50K tokens — leaves room for system prompt + tools) */
export const FALLBACK_MAX_CHARS = 200_000

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export interface TruncationResult {
  messages: ChatMessage[]
  truncated: boolean
  originalCount: number
}

/**
 * Truncate conversation history for a fresh session (no resume).
 *
 * Keeps the most recent messages within both count and character limits.
 * Ensures the resulting array starts with a user message (assistant-first is invalid).
 */
export function truncateMessagesForFallback(messages: ChatMessage[]): TruncationResult {
  const originalCount = messages.length
  let result = messages

  // Step 1: cap number of messages (keep most recent)
  if (result.length > FALLBACK_MAX_MESSAGES) {
    result = result.slice(-FALLBACK_MAX_MESSAGES)
  }

  // Step 2: cap total character size (trim from oldest if still too large).
  // Keep at least 4 messages (~2 exchanges) so the model has enough context
  // to compact from — it will auto-compact after loading.
  let totalChars = result.reduce((sum, m) => sum + m.content.length, 0)
  while (totalChars > FALLBACK_MAX_CHARS && result.length > 4) {
    totalChars -= result[0].content.length
    result = result.slice(1)
  }

  // Step 3: if still over budget with <= 4 messages (e.g. one super-long prompt),
  // truncate individual message content. Preserve the latest message fully;
  // trim older messages to fit within the remaining budget.
  totalChars = result.reduce((sum, m) => sum + m.content.length, 0)
  if (totalChars > FALLBACK_MAX_CHARS && result.length > 0) {
    const perMessageBudget = Math.floor(FALLBACK_MAX_CHARS / result.length)
    result = result.map((m, i) => {
      if (i === result.length - 1) return m // preserve latest message
      if (m.content.length > perMessageBudget) {
        return { ...m, content: m.content.slice(-perMessageBudget) }
      }
      return m
    })
  }

  // Track whether size-based truncation actually occurred (before role normalization)
  const truncated = result.length < originalCount

  // Ensure we start with a user message (assistant-first is invalid context)
  if (result.length > 0 && result[0].role === 'assistant') {
    result = result.slice(1)
  }

  return { messages: result, truncated, originalCount }
}
