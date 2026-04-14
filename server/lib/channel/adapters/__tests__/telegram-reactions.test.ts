/**
 * Tests for telegram-reactions lifecycle hooks.
 *
 * Mirrors hermes-agent tests/gateway/test_telegram_reactions.py:
 *   - reactions disabled by default
 *   - enabled flag can be parsed from various truthy values
 *   - posting a reaction calls Bot API with correct emoji + ids
 *   - graceful no-op when target is missing or API errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the API module before importing the reactions module.
vi.mock('../telegram-api.js', () => ({
  setMessageReaction: vi.fn(),
}))

import { setMessageReaction } from '../telegram-api.js'
import {
  REACTION_EMOJI,
  parseReactionsEnabled,
  postLifecycleReaction,
  reactProcessing,
  reactSuccess,
  reactError,
  reactTruncated,
} from '../telegram-reactions.js'

const mockedSetReaction = vi.mocked(setMessageReaction)

beforeEach(() => {
  mockedSetReaction.mockReset()
  mockedSetReaction.mockResolvedValue({ ok: true, result: true })
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('parseReactionsEnabled', () => {
  it('returns false for undefined / null / arbitrary values', () => {
    expect(parseReactionsEnabled(undefined)).toBe(false)
    expect(parseReactionsEnabled(null)).toBe(false)
    expect(parseReactionsEnabled(0)).toBe(false)
    expect(parseReactionsEnabled({})).toBe(false)
  })
  it('returns true for boolean true', () => {
    expect(parseReactionsEnabled(true)).toBe(true)
  })
  it('parses common truthy strings', () => {
    expect(parseReactionsEnabled('true')).toBe(true)
    expect(parseReactionsEnabled('TRUE')).toBe(true)
    expect(parseReactionsEnabled('1')).toBe(true)
    expect(parseReactionsEnabled('yes')).toBe(true)
    expect(parseReactionsEnabled('on')).toBe(true)
  })
  it('rejects falsy strings', () => {
    expect(parseReactionsEnabled('false')).toBe(false)
    expect(parseReactionsEnabled('0')).toBe(false)
    expect(parseReactionsEnabled('no')).toBe(false)
    expect(parseReactionsEnabled('')).toBe(false)
  })
})

describe('postLifecycleReaction — disabled by default', () => {
  it('does nothing when enabled is omitted', async () => {
    const ok = await postLifecycleReaction('token', { chatId: '1', messageId: 2 }, 'processing')
    expect(ok).toBe(false)
    expect(mockedSetReaction).not.toHaveBeenCalled()
  })

  it('does nothing when enabled is explicitly false', async () => {
    const ok = await postLifecycleReaction(
      'token',
      { chatId: '1', messageId: 2 },
      'processing',
      { enabled: false },
    )
    expect(ok).toBe(false)
    expect(mockedSetReaction).not.toHaveBeenCalled()
  })
})

describe('postLifecycleReaction — enabled', () => {
  const opts = { enabled: true }
  const target = { chatId: '12345', messageId: 678 }

  it('posts processing emoji', async () => {
    const ok = await postLifecycleReaction('token', target, 'processing', opts)
    expect(ok).toBe(true)
    expect(mockedSetReaction).toHaveBeenCalledWith('token', '12345', 678, REACTION_EMOJI.processing)
  })

  it('posts success emoji', async () => {
    const ok = await postLifecycleReaction('token', target, 'success', opts)
    expect(ok).toBe(true)
    expect(mockedSetReaction).toHaveBeenCalledWith('token', '12345', 678, REACTION_EMOJI.success)
  })

  it('posts error emoji', async () => {
    const ok = await postLifecycleReaction('token', target, 'error', opts)
    expect(ok).toBe(true)
    expect(mockedSetReaction).toHaveBeenCalledWith('token', '12345', 678, REACTION_EMOJI.error)
  })

  it('posts truncated emoji', async () => {
    const ok = await postLifecycleReaction('token', target, 'truncated', opts)
    expect(ok).toBe(true)
    expect(mockedSetReaction).toHaveBeenCalledWith('token', '12345', 678, REACTION_EMOJI.truncated)
  })

  it('no-ops when target is null', async () => {
    const ok = await postLifecycleReaction('token', null, 'processing', opts)
    expect(ok).toBe(false)
    expect(mockedSetReaction).not.toHaveBeenCalled()
  })

  it('no-ops when chatId or messageId is missing', async () => {
    const ok1 = await postLifecycleReaction('token', { chatId: '', messageId: 1 }, 'processing', opts)
    const ok2 = await postLifecycleReaction('token', { chatId: '1', messageId: 0 }, 'processing', opts)
    expect(ok1).toBe(false)
    expect(ok2).toBe(false)
    expect(mockedSetReaction).not.toHaveBeenCalled()
  })

  it('swallows API non-ok response (e.g. 400/403 from restricted chat)', async () => {
    mockedSetReaction.mockResolvedValueOnce({ ok: false, description: 'BAD_REQUEST: chat type unsupported' })
    const ok = await postLifecycleReaction('token', target, 'processing', opts)
    expect(ok).toBe(false)
  })

  it('swallows network / thrown errors', async () => {
    mockedSetReaction.mockRejectedValueOnce(new Error('network'))
    const ok = await postLifecycleReaction('token', target, 'success', opts)
    expect(ok).toBe(false)
  })
})

describe('react* convenience helpers', () => {
  const target = { chatId: '1', messageId: 2 }
  const opts = { enabled: true }

  it('reactProcessing → ⏳', async () => {
    await reactProcessing('t', target, opts)
    expect(mockedSetReaction).toHaveBeenCalledWith('t', '1', 2, REACTION_EMOJI.processing)
  })
  it('reactSuccess → ✅', async () => {
    await reactSuccess('t', target, opts)
    expect(mockedSetReaction).toHaveBeenCalledWith('t', '1', 2, REACTION_EMOJI.success)
  })
  it('reactError → ❌', async () => {
    await reactError('t', target, opts)
    expect(mockedSetReaction).toHaveBeenCalledWith('t', '1', 2, REACTION_EMOJI.error)
  })
  it('reactTruncated → 📦', async () => {
    await reactTruncated('t', target, opts)
    expect(mockedSetReaction).toHaveBeenCalledWith('t', '1', 2, REACTION_EMOJI.truncated)
  })
})
