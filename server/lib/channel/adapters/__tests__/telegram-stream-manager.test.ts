/**
 * Tests for TelegramStreamManager
 *
 * Unit tests for the streaming logic: subscription management,
 * per-chat limits, and cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the relay server and execution event bus before importing the module
vi.mock('../../../relay-server.js', () => ({
  relayServer: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}))

vi.mock('../../../execution-event-bus.js', () => ({
  executionEventBus: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}))

// Mock fetch for Telegram API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

function mockTgResponse(messageId: number = 123): Response {
  return {
    json: () => Promise.resolve({ ok: true, result: { message_id: messageId } }),
  } as unknown as Response
}

describe('TelegramStreamManager', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let manager: any

  beforeEach(async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValue(mockTgResponse())

    const mod = await import('../telegram-stream-manager.js')
    manager = mod.telegramStreamManager
    manager.start('test-bot-token')
  })

  afterEach(() => {
    manager.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('subscribe', () => {
    it('should send initial message on subscribe', async () => {
      const error = await manager.subscribe('exec-123', 'chat-456', 'Test Task')
      expect(error).toBeNull()
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/sendMessage',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('chat-456'),
        }),
      )
    })

    it('should reject duplicate subscriptions', async () => {
      await manager.subscribe('exec-123', 'chat-456')
      const error = await manager.subscribe('exec-123', 'chat-456')
      expect(error).toBe('Already watching this execution')
    })

    it('should enforce per-chat limit', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.subscribe(`exec-${i}`, 'chat-456')
      }
      const error = await manager.subscribe('exec-5', 'chat-456')
      expect(error).toBe('Maximum 5 concurrent streams per chat')
    })

    it('should include task title in header', async () => {
      await manager.subscribe('exec-123', 'chat-456', 'Build Dashboard')
      // The sendMessage call should contain the task title in the body
      const sendCalls = mockFetch.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('sendMessage'),
      )
      // The initial message body should reference the task title
      const bodies = sendCalls.map(
        (c: unknown[]) => JSON.parse((c[1] as { body: string }).body).text as string,
      )
      expect(bodies.some((b: string) => b.includes('Build Dashboard'))).toBe(true)
    })
  })

  describe('getActiveSubscriptions', () => {
    it('should return active subscription IDs for a chat', async () => {
      await manager.subscribe('exec-1', 'chat-456')
      await manager.subscribe('exec-2', 'chat-456')
      const subs = manager.getActiveSubscriptions('chat-456')
      expect(subs).toContain('exec-1')
      expect(subs).toContain('exec-2')
      expect(subs).toHaveLength(2)
    })

    it('should return empty for unknown chat', () => {
      const subs = manager.getActiveSubscriptions('unknown-chat')
      expect(subs).toHaveLength(0)
    })
  })

  describe('unsubscribe', () => {
    it('should remove subscription', async () => {
      await manager.subscribe('exec-1', 'chat-456')
      manager.unsubscribe('exec-1', 'chat-456')
      const subs = manager.getActiveSubscriptions('chat-456')
      expect(subs).toHaveLength(0)
    })

    it('should free up chat sub count on unsubscribe', async () => {
      // Fill to max
      for (let i = 0; i < 5; i++) {
        await manager.subscribe(`exec-${i}`, 'chat-456')
      }
      // Unsubscribe one
      manager.unsubscribe('exec-0', 'chat-456')
      // Should now be able to add another
      const error = await manager.subscribe('exec-new', 'chat-456')
      expect(error).toBeNull()
    })
  })

  describe('event listener registration', () => {
    it('should register relay server event listeners on start', async () => {
      const { relayServer } = await import('../../../relay-server.js')
      const onCalls = (relayServer.on as ReturnType<typeof vi.fn>).mock.calls
      const eventTypes = onCalls.map((c: unknown[]) => c[0])

      expect(eventTypes).toContain('task:text')
      expect(eventTypes).toContain('task:result')
      expect(eventTypes).toContain('task:progress')
      expect(eventTypes).toContain('task:tool_trace')
      expect(eventTypes).toContain('task:file_change')
      expect(eventTypes).toContain('task:operational')
      expect(eventTypes).toContain('task:session_init')
      expect(eventTypes).toContain('task:error')
    })

    it('should register execution event bus listeners on start', async () => {
      const { executionEventBus } = await import('../../../execution-event-bus.js')
      const onCalls = (executionEventBus.on as ReturnType<typeof vi.fn>).mock.calls
      const eventTypes = onCalls.map((c: unknown[]) => c[0])

      expect(eventTypes).toContain('task:result')
      expect(eventTypes).toContain('task:error')
      expect(eventTypes).toContain('task:progress')
    })
  })
})
