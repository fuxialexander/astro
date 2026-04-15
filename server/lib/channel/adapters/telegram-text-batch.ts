/**
 * Telegram Text Message Batching
 *
 * When a user sends a long message, Telegram clients sometimes split it into
 * several rapid `sendMessage` calls. We aggregate text messages from the
 * same conversation key (chatId + threadId + userId) within a short window
 * and dispatch them to the agent as a single concatenated input.
 *
 * Mirrors hermes-agent `TelegramAdapter._enqueue_text_event` semantics:
 *   - Buffer plain text messages from the same key for ~800ms after the
 *     last addition.
 *   - Each new addition restarts the debounce timer.
 *   - On flush, items are joined with "\n\n" in arrival order.
 *   - Commands (text starting with "/") are never batched and force a
 *     flush of any pending batch for the same key first.
 *   - A non-text message (caller passes `forceFlush`) for the same key
 *     also triggers an immediate flush.
 *   - Different keys (chat / thread / user) never share a batch.
 *
 * --- State location tradeoff ---
 * Same as `telegram-media-batch.ts`: in-memory module-level Map. Telegram
 * webhook delivery for a given chat is effectively sticky over short
 * windows, so cross-instance fan-out is rare. Worst case: each instance
 * flushes its own partial batch — annoying but correct.
 */

const DEFAULT_DEBOUNCE_MS = 800

export interface TextBatchKey {
  chatId: string
  threadId?: string
  userId?: string
}

export interface BufferedText {
  text: string
  /** Original Telegram message_id, for reply-to / lifecycle hooks. */
  messageId?: number
}

export interface TextBatchResult {
  key: TextBatchKey
  /** Concatenated text (joined with "\n\n"). */
  text: string
  items: BufferedText[]
}

interface PendingTextEntry {
  key: TextBatchKey
  items: BufferedText[]
  timer: NodeJS.Timeout
  resolve: (result: TextBatchResult) => void
  /** Promise everyone added so far is awaiting. */
  promise: Promise<TextBatchResult>
}

const pending = new Map<string, PendingTextEntry>()

/** Stable string key derived from the structured TextBatchKey. */
function keyToString(k: TextBatchKey): string {
  return `${k.chatId}|${k.threadId ?? ''}|${k.userId ?? ''}`
}

function flush(keyStr: string): void {
  const entry = pending.get(keyStr)
  if (!entry) return
  pending.delete(keyStr)
  clearTimeout(entry.timer)
  const result: TextBatchResult = {
    key: entry.key,
    text: entry.items.map((i) => i.text).join('\n\n'),
    items: entry.items,
  }
  try {
    entry.resolve(result)
  } catch {
    /* ignore */
  }
}

/**
 * Buffer a plain text message for the given key. Returns a promise that
 * resolves with the merged batch when the debounce window expires (or
 * `forceFlushPending` is called for the same key).
 *
 * If a batch is already pending for this key, all earlier `enqueueText`
 * callers receive the SAME promise as the latest caller — every caller
 * sees the full merged batch on flush. This matches hermes' "shared
 * future" semantics and lets callers tee off whatever post-flush work
 * they need (logging, reactions, etc.).
 */
export function enqueueText(
  key: TextBatchKey,
  item: BufferedText,
  opts: { debounceMs?: number } = {},
): Promise<TextBatchResult> {
  const debounce = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const ks = keyToString(key)
  let entry = pending.get(ks)
  if (!entry) {
    let resolveFn!: (r: TextBatchResult) => void
    const promise = new Promise<TextBatchResult>((res) => {
      resolveFn = res
    })
    entry = {
      key,
      items: [],
      timer: setTimeout(() => flush(ks), debounce),
      resolve: resolveFn,
      promise,
    }
    pending.set(ks, entry)
  } else {
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => flush(ks), debounce)
  }
  entry.items.push(item)
  return entry.promise
}

/**
 * Force-flush any pending text batch for `key`. Returns the resolved
 * batch (or null if nothing was pending). Use this when:
 *   - a non-text message arrives for the same key (the in-progress text
 *     batch should be delivered first so message order is preserved)
 *   - a command (text starting with "/") arrives — commands never batch
 *   - the adapter shuts down
 */
export function forceFlushPending(key: TextBatchKey): TextBatchResult | null {
  const ks = keyToString(key)
  const entry = pending.get(ks)
  if (!entry) return null
  // Snapshot the result synchronously so the caller can act on it
  // immediately without awaiting the promise.
  pending.delete(ks)
  clearTimeout(entry.timer)
  const result: TextBatchResult = {
    key: entry.key,
    text: entry.items.map((i) => i.text).join('\n\n'),
    items: entry.items,
  }
  try {
    entry.resolve(result)
  } catch {
    /* ignore */
  }
  return result
}

/**
 * Returns true if `text` is a Telegram bot command (starts with "/" and
 * is not just a slash). Commands bypass batching entirely.
 */
export function isTelegramCommand(text: string): boolean {
  return text.length > 1 && text.startsWith('/')
}

/** Test helper: drop all pending batches without resolving. */
export function _resetForTests(): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer)
  }
  pending.clear()
}
