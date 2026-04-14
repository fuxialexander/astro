/**
 * Telegram Media Group Batching
 *
 * Telegram delivers album uploads (photo/video groups) as several separate
 * `message` updates that share a `media_group_id`. We want the agent to see
 * the whole album as a single input, so we buffer items for ~800ms after the
 * last addition, then flush.
 *
 * --- State location tradeoff ---
 * Astro's server is normally stateless (state lives in DB / Redis so any
 * instance can handle any request). Strictly, this batcher violates that:
 * it holds pending items in a module-level Map. We accept this because:
 *
 *   1. The existing `redisPubSub` module only exposes pub/sub + a few
 *      typed helpers; it does not expose a raw ioredis client, so using
 *      Redis here would require modifying that module (out of scope —
 *      other agents are editing sibling files in parallel).
 *   2. Telegram webhook delivery for a single `media_group_id` is
 *      effectively sticky: all updates for the group arrive in a tight
 *      burst over the same HTTPS connection and are load-balanced to the
 *      same backend instance in the overwhelming majority of cases.
 *   3. Worst case on a split delivery: each instance flushes its own
 *      partial batch independently. The agent sees two smaller albums
 *      instead of one — annoying but correct.
 *   4. A 5s watchdog guarantees no item is ever held indefinitely, even
 *      if `cancelBatch` is never called.
 *
 * If/when we need true cross-instance batching, swap the Map for a Redis
 * list keyed by `telegram:media_group:<id>` with a Lua-scripted flush.
 */

export interface BufferedMedia {
  fileId: string
  mimeType: string
  size?: number
  caption?: string
}

export interface BatchResult {
  mediaGroupId: string
  items: BufferedMedia[]
  /** First non-empty caption encountered across the batch. */
  caption?: string
  chatId: string
  threadId?: string
  fromId?: string
}

interface PendingMeta {
  chatId: string
  threadId?: string
  fromId?: string
  /** First non-empty caption seen so far. */
  caption?: string
}

type Resolver = (result: BatchResult | null) => void

interface PendingEntry {
  items: BufferedMedia[]
  meta: PendingMeta
  resolvers: Resolver[]
  /** Debounce timer that fires 800ms after the last addition. */
  timer: NodeJS.Timeout
  /** Hard watchdog; force-flush after 5s regardless of activity. */
  watchdog: NodeJS.Timeout
  /** Monotonically incremented when a new item is added. */
  generation: number
}

const DEBOUNCE_MS = 800
const WATCHDOG_MS = 5000

const pending = new Map<string, PendingEntry>()

function flush(mediaGroupId: string): void {
  const entry = pending.get(mediaGroupId)
  if (!entry) return
  pending.delete(mediaGroupId)
  clearTimeout(entry.timer)
  clearTimeout(entry.watchdog)

  const result: BatchResult = {
    mediaGroupId,
    items: entry.items,
    caption: entry.meta.caption,
    chatId: entry.meta.chatId,
    threadId: entry.meta.threadId,
    fromId: entry.meta.fromId,
  }

  // Only the LAST resolver receives the full batch — earlier addMedia
  // callers already had their promise superseded by a later call.
  const last = entry.resolvers.pop()
  for (const r of entry.resolvers) {
    try {
      r(null)
    } catch {
      /* ignore */
    }
  }
  if (last) {
    try {
      last(result)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Buffer a media item for a `media_group_id`. Returns a promise that
 * resolves with the full batch when the flush timer fires (800ms after
 * the last addition, or 5s watchdog, whichever is first).
 *
 * If called multiple times quickly for the same group, only the LAST
 * call's promise resolves with the batch; earlier calls resolve with
 * `null` and the caller should noop.
 */
export function bufferMedia(
  mediaGroupId: string,
  item: BufferedMedia,
  meta: { chatId: string; threadId?: string; fromId?: string; caption?: string },
): Promise<BatchResult | null> {
  return new Promise<BatchResult | null>((resolve) => {
    let entry = pending.get(mediaGroupId)

    if (!entry) {
      const initialMeta: PendingMeta = {
        chatId: meta.chatId,
        threadId: meta.threadId,
        fromId: meta.fromId,
        caption: meta.caption && meta.caption.length > 0 ? meta.caption : undefined,
      }
      entry = {
        items: [],
        meta: initialMeta,
        resolvers: [],
        // Placeholder timers; replaced below.
        timer: setTimeout(() => {}, 0),
        watchdog: setTimeout(() => {}, 0),
        generation: 0,
      }
      clearTimeout(entry.timer)
      clearTimeout(entry.watchdog)
      pending.set(mediaGroupId, entry)
      entry.watchdog = setTimeout(() => flush(mediaGroupId), WATCHDOG_MS)
    } else {
      // Clear only the debounce timer; keep the watchdog running.
      clearTimeout(entry.timer)
      // Capture first non-empty caption if we don't yet have one.
      if (!entry.meta.caption && meta.caption && meta.caption.length > 0) {
        entry.meta.caption = meta.caption
      }
    }

    // Also capture the item's own caption if the meta didn't have one.
    if (!entry.meta.caption && item.caption && item.caption.length > 0) {
      entry.meta.caption = item.caption
    }

    entry.items.push(item)
    entry.resolvers.push(resolve)
    entry.generation++
    entry.timer = setTimeout(() => flush(mediaGroupId), DEBOUNCE_MS)
  })
}

/**
 * Drop any pending state for a media group (e.g., on transport error).
 * All pending resolvers receive `null`.
 */
export function cancelBatch(mediaGroupId: string): void {
  const entry = pending.get(mediaGroupId)
  if (!entry) return
  pending.delete(mediaGroupId)
  clearTimeout(entry.timer)
  clearTimeout(entry.watchdog)
  for (const r of entry.resolvers) {
    try {
      r(null)
    } catch {
      /* ignore */
    }
  }
}
