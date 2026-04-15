/**
 * Telegram Wave 1 unit tests.
 *
 * Pure module tests — no DB, no network, no timers except fake ones where
 * needed. Covers markdown-v2, chunking, mention gating, allowlist, and
 * media-group batching.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  escapeMdv2,
  toMarkdownV2,
  stripMdv2,
} from '../../server/lib/channel/adapters/telegram-markdown-v2.js'
import {
  chunkMessage,
  utf16Len,
} from '../../server/lib/channel/adapters/telegram-chunking.js'
import {
  compileMentionPatterns,
  shouldProcessMessage,
} from '../../server/lib/channel/adapters/telegram-mention.js'
import {
  parseAllowlist,
  isUserAllowed,
} from '../../server/lib/channel/adapters/telegram-auth.js'
import {
  bufferMedia,
  cancelBatch,
} from '../../server/lib/channel/adapters/telegram-media-batch.js'

// ---------------------------------------------------------------------------
// MarkdownV2
// ---------------------------------------------------------------------------

describe('telegram-markdown-v2', () => {
  it('escapeMdv2 escapes . and !', () => {
    const out = escapeMdv2('hello.world!')
    expect(out).toContain('\\.')
    expect(out).toContain('\\!')
    expect(out).toBe('hello\\.world\\!')
  })

  it('escapeMdv2 escapes all MdV2 specials including backslash', () => {
    const out = escapeMdv2('a_b*c[d](e)')
    expect(out).toBe('a\\_b\\*c\\[d\\]\\(e\\)')
  })

  it('toMarkdownV2 converts **bold** to single-star *bold*', () => {
    const out = toMarkdownV2('**bold**')
    expect(out).toBe('*bold*')
  })

  it('toMarkdownV2 converts *italic* to _italic_', () => {
    const out = toMarkdownV2('*italic*')
    expect(out).toBe('_italic_')
  })

  it('toMarkdownV2 keeps code-span body untouched (no escape of _ inside)', () => {
    const out = toMarkdownV2('`code with _underscore_`')
    // The backtick span should survive as-is (escapeCodeBody only touches ` and \).
    expect(out).toBe('`code with _underscore_`')
  })

  it('toMarkdownV2 converts # Header to bold', () => {
    const out = toMarkdownV2('# Header')
    expect(out).toBe('*Header*')
  })

  it('toMarkdownV2 escapes dots in literal text', () => {
    const out = toMarkdownV2('Hello world.')
    expect(out).toBe('Hello world\\.')
  })

  it('toMarkdownV2 handles triple-backtick code blocks', () => {
    const out = toMarkdownV2('```js\nconst x = 1.0;\n```')
    // Dot inside code block must NOT be escaped.
    expect(out).toContain('const x = 1.0;')
    expect(out).toContain('```')
  })

  it('stripMdv2 removes formatting markers', () => {
    expect(stripMdv2('*bold*')).toBe('bold')
    expect(stripMdv2('_ital_')).toBe('ital')
    expect(stripMdv2('`code`')).toBe('code')
  })

  it('stripMdv2 unescapes backslash escapes', () => {
    expect(stripMdv2('hello\\.world')).toBe('hello.world')
  })
})

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

describe('telegram-chunking', () => {
  it('utf16Len counts surrogate pairs as 2 code units', () => {
    expect(utf16Len('a🎉b')).toBe(4)
    expect(utf16Len('abc')).toBe(3)
    expect(utf16Len('')).toBe(0)
  })

  it('returns a single chunk for short text with no (1/N) prefix', () => {
    const chunks = chunkMessage('hello world')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe('hello world')
    expect(chunks[0].total).toBe(1)
    expect(chunks[0].isFirst).toBe(true)
    expect(chunks[0].isLast).toBe(true)
    expect(chunks[0].text).not.toMatch(/^\(1\/1\)/)
  })

  it('splits text just over 4096 UTF-16 units into 2 chunks with (i/N) prefixes', () => {
    // Use non-space, non-newline filler so findBreakpoint falls through to hard cut.
    const body = 'x'.repeat(5000)
    const chunks = chunkMessage(body)
    expect(chunks.length).toBe(2)
    expect(chunks[0].text.startsWith('(1/2)\n')).toBe(true)
    expect(chunks[1].text.startsWith('(2/2)\n')).toBe(true)
    expect(chunks[0].total).toBe(2)
    // Neither chunk should exceed the hard limit.
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(4096)
  })

  it('does not split surrogate pairs across chunks', () => {
    // Build a string where a 🎉 sits right around the cut boundary.
    // Each 🎉 is 2 UTF-16 units. Place many of them with a filler to exceed 4096.
    const filler = 'a'.repeat(4090)
    const body = filler + '🎉🎉🎉🎉🎉🎉'
    const chunks = chunkMessage(body)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    // Recombine bodies (stripping the "(i/N)\n" prefix) and verify no lone surrogate.
    for (const c of chunks) {
      const t = c.text.replace(/^\(\d+\/\d+\)\n/, '')
      // No high surrogate may appear as the final code unit without a trailing low surrogate.
      for (let i = 0; i < t.length; i++) {
        const code = t.charCodeAt(i)
        if (code >= 0xd800 && code <= 0xdbff) {
          // Next must exist and be a low surrogate.
          expect(i + 1).toBeLessThan(t.length)
          const next = t.charCodeAt(i + 1)
          expect(next).toBeGreaterThanOrEqual(0xdc00)
          expect(next).toBeLessThanOrEqual(0xdfff)
          i++ // skip the low surrogate we just validated
        }
      }
    }
  })

  it('does not split inside an inline code span', () => {
    // Force an inline code span to sit near the cut boundary.
    const head = 'x'.repeat(4000)
    const body = head + '`codespan_stays_together`'
    const chunks = chunkMessage(body)
    // Find which chunk contains the opening backtick.
    const chunkWithOpen = chunks.find((c) => c.text.includes('`codespan_stays_together`'))
    expect(chunkWithOpen).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Mention patterns
// ---------------------------------------------------------------------------

describe('telegram-mention', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('compiles a JSON-array env var into 1 regex', () => {
    const compiled = compileMentionPatterns('["^hey bot"]', undefined)
    expect(compiled.patterns).toHaveLength(1)
    expect(compiled.patterns[0].test('hey bot how are you')).toBe(true)
  })

  it('compiles a CSV env var into 2 regexes', () => {
    const compiled = compileMentionPatterns('foo,bar', undefined)
    expect(compiled.patterns).toHaveLength(2)
  })

  it('skips invalid regex and logs a warning', () => {
    const compiled = compileMentionPatterns('[', undefined)
    expect(compiled.patterns).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('matches @botname explicit mention', () => {
    const compiled = compileMentionPatterns(undefined, { requireMention: true })
    const res = shouldProcessMessage(
      { text: '@botname hi', chatId: 'c1', botUsername: 'botname' },
      compiled,
    )
    expect(res.process).toBe(true)
    expect(res.reason).toBe('mention')
  })

  it('matches reply-to-bot case', () => {
    const compiled = compileMentionPatterns(undefined, { requireMention: true })
    const res = shouldProcessMessage(
      {
        text: 'just a reply',
        chatId: 'c1',
        botUsername: 'botname',
        botId: 42,
        replyToFromId: 42,
      },
      compiled,
    )
    expect(res.process).toBe(true)
    expect(res.reason).toBe('reply_to_bot')
  })

  it('returns false when requireMention=true and no trigger matches', () => {
    const compiled = compileMentionPatterns(undefined, { requireMention: true })
    const res = shouldProcessMessage(
      { text: 'casual chat', chatId: 'c1', botUsername: 'botname' },
      compiled,
    )
    expect(res.process).toBe(false)
    expect(res.reason).toBe('no_trigger')
  })

  it('ignoredThreads takes priority over other rules', () => {
    const compiled = compileMentionPatterns(undefined, {
      requireMention: true,
      ignoredThreads: ['c1:t9'],
    })
    const res = shouldProcessMessage(
      {
        text: '@botname hi',
        chatId: 'c1',
        threadId: 't9',
        botUsername: 'botname',
      },
      compiled,
    )
    expect(res.process).toBe(false)
    expect(res.reason).toBe('ignored_thread')
  })

  it('freeResponseChats bypass gating', () => {
    const compiled = compileMentionPatterns(undefined, {
      requireMention: true,
      freeResponseChats: ['c1'],
    })
    const res = shouldProcessMessage(
      { text: 'hi', chatId: 'c1', botUsername: 'botname' },
      compiled,
    )
    expect(res.process).toBe(true)
    expect(res.reason).toBe('free_response_chat')
  })
})

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

describe('telegram-auth', () => {
  it('wildcard "*" allows any user', () => {
    const cfg = parseAllowlist('*', undefined)
    expect(isUserAllowed('any', cfg)).toBe(true)
    expect(isUserAllowed(12345, cfg)).toBe(true)
  })

  it('empty env and no account list allows all', () => {
    const cfg = parseAllowlist('', undefined)
    expect(isUserAllowed('789', cfg)).toBe(true)
  })

  it('CSV env denies users not in the list', () => {
    const cfg = parseAllowlist('123,456', undefined)
    expect(isUserAllowed('789', cfg)).toBe(false)
    expect(isUserAllowed('123', cfg)).toBe(true)
  })

  it('merges env and account allowlists', () => {
    const cfg = parseAllowlist('123', ['456'])
    expect(isUserAllowed('123', cfg)).toBe(true)
    expect(isUserAllowed('456', cfg)).toBe(true)
    expect(isUserAllowed('789', cfg)).toBe(false)
  })

  it('accepts numeric userId input', () => {
    const cfg = parseAllowlist('123', undefined)
    expect(isUserAllowed(123, cfg)).toBe(true)
    expect(isUserAllowed(999, cfg)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Media batching
// ---------------------------------------------------------------------------

describe('telegram-media-batch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('single bufferMedia call resolves with 1-item batch after ~800ms', async () => {
    const p = bufferMedia(
      'group-A',
      { fileId: 'f1', mimeType: 'image/jpeg' },
      { chatId: 'c1', fromId: 'u1' },
    )
    await vi.advanceTimersByTimeAsync(800)
    const result = await p
    expect(result).not.toBeNull()
    expect(result!.mediaGroupId).toBe('group-A')
    expect(result!.items).toHaveLength(1)
    expect(result!.items[0].fileId).toBe('f1')
    expect(result!.chatId).toBe('c1')
  })

  it('three rapid calls for same group: only the LAST resolver gets the batch', async () => {
    const p1 = bufferMedia(
      'group-B',
      { fileId: 'f1', mimeType: 'image/jpeg' },
      { chatId: 'c1' },
    )
    const p2 = bufferMedia(
      'group-B',
      { fileId: 'f2', mimeType: 'image/jpeg' },
      { chatId: 'c1' },
    )
    const p3 = bufferMedia(
      'group-B',
      { fileId: 'f3', mimeType: 'image/jpeg' },
      { chatId: 'c1' },
    )
    await vi.advanceTimersByTimeAsync(800)
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1).toBeNull()
    expect(r2).toBeNull()
    expect(r3).not.toBeNull()
    expect(r3!.items).toHaveLength(3)
    expect(r3!.items.map((i) => i.fileId)).toEqual(['f1', 'f2', 'f3'])
  })

  it('different group IDs do not interfere', async () => {
    const pA = bufferMedia(
      'group-C',
      { fileId: 'a1', mimeType: 'image/jpeg' },
      { chatId: 'c1' },
    )
    const pB = bufferMedia(
      'group-D',
      { fileId: 'b1', mimeType: 'image/jpeg' },
      { chatId: 'c2' },
    )
    await vi.advanceTimersByTimeAsync(800)
    const [rA, rB] = await Promise.all([pA, pB])
    expect(rA).not.toBeNull()
    expect(rB).not.toBeNull()
    expect(rA!.items).toHaveLength(1)
    expect(rB!.items).toHaveLength(1)
    expect(rA!.items[0].fileId).toBe('a1')
    expect(rB!.items[0].fileId).toBe('b1')
  })

  it('cancelBatch resolves pending promises with null without waiting', async () => {
    const p = bufferMedia(
      'group-E',
      { fileId: 'f1', mimeType: 'image/jpeg' },
      { chatId: 'c1' },
    )
    cancelBatch('group-E')
    // No timer advance needed.
    const result = await p
    expect(result).toBeNull()
  })
})
