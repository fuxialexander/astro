/**
 * Tests for Telegram media-group batching.
 *
 * Mirrors hermes-agent behavioural specs:
 *   - tests/gateway/test_telegram_caption_merge.py — caption dedup semantics
 *   - tests/gateway/test_telegram_photo_interrupts.py — arrival-order (FIFO)
 *
 * Caption merge contract (Gap #1):
 *   - Unique captions joined with "\n\n" in arrival order.
 *   - Dedup is exact-match on trimmed text (NOT substring).
 *   - Empty / whitespace-only captions are ignored.
 *
 * FIFO contract (Gap #7):
 *   - Items in a media_group preserve arrival order regardless of type.
 *     A late-arriving photo never jumps ahead of earlier documents/audio.
 */

import { describe, it, expect } from 'vitest'
import {
  bufferMedia,
  cancelBatch,
  mergeCaption,
  type BatchResult,
  type BufferedMedia,
} from '../telegram-media-batch.js'

// Use unique media_group_id per test to avoid cross-talk via the
// module-level `pending` map.
let groupCounter = 0
const nextGroupId = () => `mg-${Date.now()}-${++groupCounter}`

describe('mergeCaption', () => {
  it('returns new caption when existing is undefined', () => {
    const seen = new Set<string>()
    expect(mergeCaption(undefined, 'Hello', seen)).toBe('Hello')
  })

  it('returns new caption when existing is empty', () => {
    const seen = new Set<string>()
    expect(mergeCaption('', 'Hello', seen)).toBe('Hello')
  })

  it('drops exact duplicate', () => {
    const seen = new Set<string>()
    let result = mergeCaption(undefined, 'Revenue', seen)
    result = mergeCaption(result, 'Revenue', seen)
    expect(result).toBe('Revenue')
  })

  it('joins different captions with \\n\\n', () => {
    const seen = new Set<string>()
    let r = mergeCaption(undefined, 'Q3 Results', seen)
    r = mergeCaption(r, 'Q4 Projections', seen)
    expect(r).toBe('Q3 Results\n\nQ4 Projections')
  })

  it('does NOT drop a shorter caption that is a substring of an earlier one', () => {
    // The classic substring bug: "Meeting" in "Meeting agenda" is true,
    // but they are different captions and both must be preserved.
    const seen = new Set<string>()
    let r = mergeCaption(undefined, 'Meeting agenda', seen)
    r = mergeCaption(r, 'Meeting', seen)
    expect(r).toBe('Meeting agenda\n\nMeeting')
  })

  it('does NOT drop a longer caption that contains an earlier one', () => {
    const seen = new Set<string>()
    let r = mergeCaption(undefined, 'Revenue', seen)
    r = mergeCaption(r, 'Revenue and Profit', seen)
    expect(r).toBe('Revenue\n\nRevenue and Profit')
  })

  it('treats trailing whitespace as a duplicate (trim before compare)', () => {
    const seen = new Set<string>()
    let r = mergeCaption(undefined, 'Revenue', seen)
    r = mergeCaption(r, 'Revenue   ', seen)
    expect(r).toBe('Revenue')
  })

  it('treats leading whitespace as a duplicate', () => {
    const seen = new Set<string>()
    let r = mergeCaption(undefined, 'Revenue', seen)
    r = mergeCaption(r, '   Revenue', seen)
    expect(r).toBe('Revenue')
  })

  it('ignores whitespace-only captions', () => {
    const seen = new Set<string>()
    let r = mergeCaption(undefined, 'Revenue', seen)
    r = mergeCaption(r, '   ', seen)
    expect(r).toBe('Revenue')
  })

  it('ignores undefined / empty next', () => {
    const seen = new Set<string>()
    expect(mergeCaption('A', undefined, seen)).toBe('A')
    expect(mergeCaption('A', '', seen)).toBe('A')
  })

  it('preserves order across three unique captions', () => {
    const seen = new Set<string>()
    let r = mergeCaption(undefined, 'A', seen)
    r = mergeCaption(r, 'B', seen)
    r = mergeCaption(r, 'C', seen)
    expect(r).toBe('A\n\nB\n\nC')
  })

  it('drops a duplicate appearing in the middle', () => {
    const seen = new Set<string>()
    let r = mergeCaption(undefined, 'A', seen)
    r = mergeCaption(r, 'B', seen)
    r = mergeCaption(r, 'A', seen)
    expect(r).toBe('A\n\nB')
  })
})

describe('bufferMedia — caption merging in a media group', () => {
  const meta = (caption?: string) => ({
    chatId: 'chat-1',
    threadId: undefined,
    fromId: 'u1',
    caption,
  })
  const item = (id: string, caption?: string): BufferedMedia => ({
    fileId: id,
    mimeType: 'image/jpeg',
    caption,
  })

  it('merges unique captions across items, dropping duplicates', async () => {
    const mg = nextGroupId()
    const p1 = bufferMedia(mg, item('a'), meta('Revenue and Profit'))
    // Small gap to ensure ordering, well within the 800ms debounce.
    await new Promise((r) => setTimeout(r, 5))
    const p2 = bufferMedia(mg, item('b'), meta('Revenue'))

    const [r1, r2] = await Promise.all([p1, p2])
    // Earlier resolver gets null, the latest gets the batch.
    const batch = (r2 ?? r1) as BatchResult
    expect(r1).toBeNull()
    expect(batch).not.toBeNull()
    expect(batch.items.map((i) => i.fileId)).toEqual(['a', 'b'])
    expect(batch.caption).toBe('Revenue and Profit\n\nRevenue')
  })

  it('produces a single caption when both items carry the same caption', async () => {
    const mg = nextGroupId()
    const p1 = bufferMedia(mg, item('a'), meta('Same'))
    await new Promise((r) => setTimeout(r, 5))
    const p2 = bufferMedia(mg, item('b'), meta('Same'))
    const [, r2] = await Promise.all([p1, p2])
    expect(r2?.caption).toBe('Same')
  })

  it('handles three items with one duplicate in the middle', async () => {
    const mg = nextGroupId()
    const p1 = bufferMedia(mg, item('a'), meta('A'))
    await new Promise((r) => setTimeout(r, 5))
    const p2 = bufferMedia(mg, item('b'), meta('B'))
    await new Promise((r) => setTimeout(r, 5))
    const p3 = bufferMedia(mg, item('c'), meta('A'))
    const results = await Promise.all([p1, p2, p3])
    const batch = results[results.length - 1] as BatchResult
    expect(batch.caption).toBe('A\n\nB')
    expect(batch.items.map((i) => i.fileId)).toEqual(['a', 'b', 'c'])
  })
})

describe('bufferMedia — FIFO ordering across mixed media types', () => {
  const meta = () => ({ chatId: 'chat-1', fromId: 'u1' })

  it('preserves arrival order: document, audio, photo (photo never jumps ahead)', async () => {
    const mg = nextGroupId()
    const doc: BufferedMedia = { fileId: 'doc-1', mimeType: 'application/pdf' }
    const audio: BufferedMedia = { fileId: 'audio-1', mimeType: 'audio/mpeg' }
    const photo: BufferedMedia = { fileId: 'photo-1', mimeType: 'image/jpeg' }

    const p1 = bufferMedia(mg, doc, meta())
    await new Promise((r) => setTimeout(r, 5))
    const p2 = bufferMedia(mg, audio, meta())
    await new Promise((r) => setTimeout(r, 5))
    const p3 = bufferMedia(mg, photo, meta())

    const results = await Promise.all([p1, p2, p3])
    const batch = results[results.length - 1] as BatchResult
    expect(batch.items.map((i) => i.fileId)).toEqual(['doc-1', 'audio-1', 'photo-1'])
  })

  it('a late photo joins the tail even after multiple earlier items', async () => {
    const mg = nextGroupId()
    const items: BufferedMedia[] = [
      { fileId: 'a', mimeType: 'application/pdf' },
      { fileId: 'b', mimeType: 'audio/mpeg' },
      { fileId: 'c', mimeType: 'video/mp4' },
      { fileId: 'd', mimeType: 'image/jpeg' }, // late photo
    ]
    const promises: Promise<BatchResult | null>[] = []
    for (const it of items) {
      promises.push(bufferMedia(mg, it, meta()))
      await new Promise((r) => setTimeout(r, 3))
    }
    const results = await Promise.all(promises)
    const batch = results[results.length - 1] as BatchResult
    expect(batch.items.map((i) => i.fileId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('cancelBatch drops pending state cleanly', async () => {
    const mg = nextGroupId()
    const photo: BufferedMedia = { fileId: 'p1', mimeType: 'image/jpeg' }
    const promise = bufferMedia(mg, photo, meta())
    cancelBatch(mg)
    expect(await promise).toBeNull()
  })
})
