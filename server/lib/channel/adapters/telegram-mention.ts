/**
 * Telegram Mention Gating
 *
 * Group-chat wake-word detection. In private chats the bot always responds,
 * but in groups we require an explicit trigger (mention, reply, or a
 * configurable regex pattern) so the bot doesn't spam every message.
 *
 * Configuration is merged from TELEGRAM_MENTION_PATTERNS (env — JSON array
 * or CSV) and per-account settings. Invalid regex sources are logged and
 * skipped — they never throw, so a single bad pattern can't break the bot.
 *
 * Pure module — no side effects beyond `console.warn` for bad regexes.
 */

export interface MentionSettings {
  /** If true (default in groups), require an explicit trigger. */
  requireMention?: boolean
  /** Regex source strings, from env or per-account settings. */
  mentionPatterns?: string[]
  /** Chat IDs that bypass gating entirely (free-response mode). */
  freeResponseChats?: string[]
  /** "chatId:threadId" keys whose messages are silently dropped. */
  ignoredThreads?: string[]
}

export interface CompiledMention {
  patterns: RegExp[]
  raw: MentionSettings
}

/** Parse the env-provided patterns string as either JSON array or CSV. */
function parseEnvPatterns(envPatterns: string | undefined): string[] {
  if (!envPatterns) return []
  const trimmed = envPatterns.trim()
  if (trimmed.length === 0) return []

  // Try JSON array first.
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed
          .filter((p): p is string => typeof p === 'string')
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      }
    } catch {
      // Fall through to CSV.
    }
  }

  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Merge env + per-account settings and compile regexes. Invalid patterns
 * are logged via console.warn and skipped.
 */
export function compileMentionPatterns(
  envPatterns: string | undefined,
  accountSettings: MentionSettings | undefined,
): CompiledMention {
  const envList = parseEnvPatterns(envPatterns)
  const acctList = (accountSettings?.mentionPatterns ?? []).filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  )

  const sources = [...envList, ...acctList]
  const patterns: RegExp[] = []
  for (const src of sources) {
    try {
      patterns.push(new RegExp(src, 'i'))
    } catch (err) {
      console.warn(
        `[telegram-mention] Ignoring invalid regex pattern ${JSON.stringify(src)}:`,
        (err as Error).message,
      )
    }
  }

  const raw: MentionSettings = {
    requireMention: accountSettings?.requireMention ?? true,
    mentionPatterns: sources,
    freeResponseChats: accountSettings?.freeResponseChats ?? [],
    ignoredThreads: accountSettings?.ignoredThreads ?? [],
  }

  return { patterns, raw }
}

export interface ShouldProcessInput {
  text: string
  chatId: string
  threadId?: string
  botUsername: string
  botId?: string | number
  replyToFromId?: string | number
}

/**
 * Decide whether an incoming group-chat message should be processed.
 * Returns { process, reason } so callers can log why a message was
 * accepted or dropped.
 */
export function shouldProcessMessage(
  input: ShouldProcessInput,
  compiled: CompiledMention,
): { process: boolean; reason: string } {
  const { text, chatId, threadId, botUsername, botId, replyToFromId } = input
  const { patterns, raw } = compiled

  // 1. Free-response chat → always process.
  if (raw.freeResponseChats && raw.freeResponseChats.includes(chatId)) {
    return { process: true, reason: 'free_response_chat' }
  }

  // 2. Ignored thread → short-circuit NO.
  if (threadId && raw.ignoredThreads && raw.ignoredThreads.includes(`${chatId}:${threadId}`)) {
    return { process: false, reason: 'ignored_thread' }
  }

  // 3. requireMention=false → always process.
  if (raw.requireMention === false) {
    return { process: true, reason: 'require_mention=false' }
  }

  // 4. Text contains @botUsername (case-insensitive).
  if (botUsername && text) {
    const needle = `@${botUsername}`.toLowerCase()
    if (text.toLowerCase().includes(needle)) {
      return { process: true, reason: 'mention' }
    }
  }

  // 5. Reply to the bot.
  if (
    replyToFromId !== undefined &&
    replyToFromId !== null &&
    botId !== undefined &&
    botId !== null &&
    String(replyToFromId) === String(botId)
  ) {
    return { process: true, reason: 'reply_to_bot' }
  }

  // 6. Any compiled pattern matches.
  if (text) {
    for (const re of patterns) {
      if (re.test(text)) {
        return { process: true, reason: 'pattern' }
      }
    }
  }

  return { process: false, reason: 'no_trigger' }
}
