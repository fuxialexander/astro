/**
 * Telegram Channel Adapter Tests — Bidirectional Messaging
 *
 * Tests the refactored Telegram adapter with:
 * - Message parsing (text, commands, photos, documents)
 * - Conversation state tracking per chat_id
 * - Inbound message routing to channelRouter
 * - Existing notification/approval flows preserved
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the adapter
// ---------------------------------------------------------------------------

// Track calls to Telegram API
const telegramApiCalls: Array<{ method: string; body?: Record<string, unknown> }> = []

// Mock fetch (Telegram Bot API)
vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
  const method = url.split('/').pop() || ''
  const body = opts?.body ? JSON.parse(opts.body as string) : undefined
  telegramApiCalls.push({ method, body })

  // Default responses per method
  if (method === 'getMe') {
    return new Response(JSON.stringify({
      ok: true,
      result: { username: 'TestAstroBot', first_name: 'Astro' },
    }))
  }
  return new Response(JSON.stringify({ ok: true, result: {} }))
}))

// Mock DB
const mockDbSelect = vi.fn()
const mockDbInsert = vi.fn()
const mockDbUpdate = vi.fn()
const mockDbDelete = vi.fn()

vi.mock('../../../db/index.js', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
}))

vi.mock('../../../db/schema.js', () => ({
  connectedAccounts: { userId: 'userId', channel: 'channel', externalId: 'externalId', enabled: 'enabled', id: 'id' },
  projects: { id: 'id', name: 'name', teamId: 'teamId', ownerId: 'ownerId', updatedAt: 'updatedAt' },
  teamMembers: { userId: 'userId', teamId: 'teamId' },
  webauthnChallenges: { key: 'key', challenge: 'challenge', expiresAt: 'expiresAt' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: 'inArray', args })),
  gt: vi.fn((...args: unknown[]) => ({ type: 'gt', args })),
  desc: vi.fn((...args: unknown[]) => ({ type: 'desc', args })),
}))

const mockRouteMessage = vi.fn().mockResolvedValue({
  text: 'AI response text',
  conversationRef: { channelId: '12345' },
})

vi.mock('../../channel-router.js', () => ({
  channelRouter: {
    registerNotificationSender: vi.fn(),
    registerResponseSender: vi.fn(),
    registerGlobalNotificationSender: vi.fn(),
    routeMessage: (...args: unknown[]) => mockRouteMessage(...args),
  },
}))

vi.mock('../../channel-config-manager.js', () => ({
  channelConfigManager: {
    invalidateCache: vi.fn(),
  },
}))

vi.mock('../../channel-formatter.js', () => ({
  formatForChannel: vi.fn((text: string) => text),
}))

// ---------------------------------------------------------------------------
// Import adapter (after mocks)
// ---------------------------------------------------------------------------

import { telegramChannel } from '../telegram-channel.js'
import type { ParsedTelegramMessage } from '../telegram-channel.js'
import { channelRouter } from '../../channel-router.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTelegramUpdate(overrides: Record<string, unknown> = {}) {
  return {
    update_id: 1,
    message: {
      message_id: 42,
      chat: { id: 12345, type: 'private' },
      from: { id: 67890, is_bot: false, first_name: 'John', last_name: 'Doe' },
      date: Date.now(),
      text: 'Hello Astro!',
      ...overrides,
    },
  }
}

function setupConnectedAccount() {
  // Mock: DB returns a connected account for chat 12345
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ userId: 'user-abc' }]),
    orderBy: vi.fn().mockReturnThis(),
  }
  mockDbSelect.mockReturnValue(chainable)
  return chainable
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelegramChannelAdapter', () => {
  beforeEach(async () => {
    telegramApiCalls.length = 0
    vi.clearAllMocks()
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123'

    // Start adapter
    await telegramChannel.start()
  })

  afterEach(() => {
    telegramChannel.stop()
    delete process.env.TELEGRAM_BOT_TOKEN
  })

  describe('start/stop', () => {
    it('should start and register both notification and response senders', () => {
      expect(telegramChannel.isStarted).toBe(true)
      expect(telegramChannel.isConfigured).toBe(true)
      expect(channelRouter.registerGlobalNotificationSender).toHaveBeenCalledWith('telegram', expect.any(Function))
      expect(channelRouter.registerResponseSender).toHaveBeenCalledWith('telegram', expect.any(Function))
    })

    it('should stop and clear conversations', () => {
      telegramChannel.stop()
      expect(telegramChannel.isStarted).toBe(false)
    })
  })

  describe('parseMessage', () => {
    it('should parse a text message', () => {
      const msg = {
        message_id: 42,
        chat: { id: 12345 },
        from: { id: 67890, is_bot: false, first_name: 'John', last_name: 'Doe' },
        text: 'Hello Astro!',
      }

      const parsed = telegramChannel.parseMessage(msg)
      expect(parsed).toEqual({
        type: 'text',
        text: 'Hello Astro!',
        chatId: '12345',
        messageId: '42',
        senderId: '67890',
        senderName: 'John Doe',
      })
    })

    it('should parse a command message', () => {
      const msg = {
        message_id: 43,
        chat: { id: 12345 },
        from: { id: 67890, is_bot: false, first_name: 'John' },
        text: '/project My Project',
      }

      const parsed = telegramChannel.parseMessage(msg)
      expect(parsed).toMatchObject({
        type: 'command',
        command: 'project',
        commandArgs: 'My Project',
      })
    })

    it('should strip @botname from commands', () => {
      const msg = {
        message_id: 44,
        chat: { id: 12345 },
        from: { id: 67890, is_bot: false, first_name: 'John' },
        text: '/status@TestAstroBot',
      }

      const parsed = telegramChannel.parseMessage(msg)
      expect(parsed).toMatchObject({
        type: 'command',
        command: 'status',
        commandArgs: '',
      })
    })

    it('should parse a photo message', () => {
      const msg = {
        message_id: 45,
        chat: { id: 12345 },
        from: { id: 67890, is_bot: false, first_name: 'John' },
        photo: [
          { file_id: 'small', file_size: 100 },
          { file_id: 'large', file_size: 5000 },
        ],
        caption: 'Check this out',
      }

      const parsed = telegramChannel.parseMessage(msg)
      expect(parsed).toMatchObject({
        type: 'photo',
        text: 'Check this out',
        file: {
          fileId: 'large',
          mimeType: 'image/jpeg',
          caption: 'Check this out',
        },
      })
    })

    it('should parse a document message', () => {
      const msg = {
        message_id: 46,
        chat: { id: 12345 },
        from: { id: 67890, is_bot: false, first_name: 'John' },
        document: {
          file_id: 'doc-123',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          file_size: 12000,
        },
        caption: 'Here is the report',
      }

      const parsed = telegramChannel.parseMessage(msg)
      expect(parsed).toMatchObject({
        type: 'file',
        text: 'Here is the report',
        file: {
          fileId: 'doc-123',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
        },
      })
    })

    it('should ignore bot messages', () => {
      const msg = {
        message_id: 47,
        chat: { id: 12345 },
        from: { id: 99999, is_bot: true, first_name: 'OtherBot' },
        text: 'I am a bot',
      }

      const parsed = telegramChannel.parseMessage(msg)
      expect(parsed).toBeNull()
    })

    it('should return null for messages without text, photo, or document', () => {
      const msg = {
        message_id: 48,
        chat: { id: 12345 },
        from: { id: 67890, is_bot: false, first_name: 'John' },
        // No text, no photo, no document (e.g., a sticker)
      }

      const parsed = telegramChannel.parseMessage(msg)
      expect(parsed).toBeNull()
    })
  })

  describe('handleUpdate — commands', () => {
    it('should handle /help command', async () => {
      const update = makeTelegramUpdate({ text: '/help' })
      await telegramChannel.handleUpdate(update)

      const helpMsg = telegramApiCalls.find(c => c.method === 'sendMessage' && c.body?.text?.toString().includes('Astro Bot Commands'))
      expect(helpMsg).toBeDefined()
    })

    it('should handle unknown commands', async () => {
      const update = makeTelegramUpdate({ text: '/foobar' })
      await telegramChannel.handleUpdate(update)

      const errorMsg = telegramApiCalls.find(c => c.method === 'sendMessage' && c.body?.text?.toString().includes('Unknown command'))
      expect(errorMsg).toBeDefined()
    })
  })

  describe('handleUpdate — inbound text messages', () => {
    it('should route text messages through channelRouter when user is connected', async () => {
      setupConnectedAccount()

      const update = makeTelegramUpdate({ text: 'What is the project status?' })
      await telegramChannel.handleUpdate(update)

      // Should have called routeMessage with an InboundMessage
      expect(mockRouteMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'telegram',
          text: 'What is the project status?',
          sender: expect.objectContaining({
            id: 'user-abc',
            name: 'John Doe',
          }),
          conversationRef: expect.objectContaining({
            channelId: '12345',
          }),
        })
      )

      // Should have sent the response back
      const responseMsgs = telegramApiCalls.filter(c => c.method === 'sendMessage' && c.body?.text === 'AI response text')
      expect(responseMsgs.length).toBe(1)
    })

    it('should send typing indicator while processing', async () => {
      setupConnectedAccount()

      const update = makeTelegramUpdate({ text: 'Hello' })
      await telegramChannel.handleUpdate(update)

      const typingCall = telegramApiCalls.find(c => c.method === 'sendChatAction')
      expect(typingCall?.body?.action).toBe('typing')
    })

    it('should tell unconnected users to link their account', async () => {
      // Mock: no connected account found
      const chainable = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockReturnThis(),
      }
      mockDbSelect.mockReturnValue(chainable)

      const update = makeTelegramUpdate({ text: 'Hello' })
      await telegramChannel.handleUpdate(update)

      const msg = telegramApiCalls.find(c =>
        c.method === 'sendMessage' && c.body?.text?.toString().includes('not connected')
      )
      expect(msg).toBeDefined()
      expect(mockRouteMessage).not.toHaveBeenCalled()
    })
  })

  describe('handleUpdate — file messages', () => {
    it('should route document messages with file metadata', async () => {
      setupConnectedAccount()

      const update = {
        update_id: 2,
        message: {
          message_id: 50,
          chat: { id: 12345, type: 'private' },
          from: { id: 67890, is_bot: false, first_name: 'John', last_name: 'Doe' },
          date: Date.now(),
          document: {
            file_id: 'doc-456',
            file_name: 'data.csv',
            mime_type: 'text/csv',
            file_size: 1000,
          },
          caption: 'Analyze this data',
        },
      }

      await telegramChannel.handleUpdate(update)

      expect(mockRouteMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('[File: data.csv]'),
        })
      )
    })

    it('should route photo messages', async () => {
      setupConnectedAccount()

      const update = {
        update_id: 3,
        message: {
          message_id: 51,
          chat: { id: 12345, type: 'private' },
          from: { id: 67890, is_bot: false, first_name: 'John' },
          date: Date.now(),
          photo: [
            { file_id: 'small', file_size: 100 },
            { file_id: 'large', file_size: 5000 },
          ],
          caption: 'Screenshot of the error',
        },
      }

      await telegramChannel.handleUpdate(update)

      expect(mockRouteMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Screenshot of the error'),
        })
      )
    })
  })

  describe('conversation state tracking', () => {
    it('should create conversation state on first message', async () => {
      setupConnectedAccount()

      const update = makeTelegramUpdate({ text: 'Hello' })
      await telegramChannel.handleUpdate(update)

      const convo = telegramChannel.getConversation('12345')
      expect(convo).toBeDefined()
      expect(convo?.userId).toBe('user-abc')
      expect(convo?.activeProjectId).toBeNull()
    })

    it('should reuse existing conversation state', async () => {
      setupConnectedAccount()

      // First message — creates state
      await telegramChannel.handleUpdate(makeTelegramUpdate({ text: 'First' }))
      const convo1 = telegramChannel.getConversation('12345')

      // Second message — reuses state
      await telegramChannel.handleUpdate(makeTelegramUpdate({ text: 'Second' }))
      const convo2 = telegramChannel.getConversation('12345')

      expect(convo1).toBe(convo2) // Same object reference
    })

    it('should clear conversations on stop', async () => {
      setupConnectedAccount()

      await telegramChannel.handleUpdate(makeTelegramUpdate({ text: 'Hello' }))
      expect(telegramChannel.getConversation('12345')).toBeDefined()

      telegramChannel.stop()
      expect(telegramChannel.getConversation('12345')).toBeUndefined()
    })
  })

  describe('message splitting', () => {
    it('should split long response messages', async () => {
      setupConnectedAccount()

      const longText = 'A'.repeat(5000)
      mockRouteMessage.mockResolvedValueOnce({
        text: longText,
        conversationRef: { channelId: '12345' },
      })

      const update = makeTelegramUpdate({ text: 'Give me a long response' })
      await telegramChannel.handleUpdate(update)

      // Should have sent multiple messages (the response + typing indicator)
      const sentMessages = telegramApiCalls.filter(c => c.method === 'sendMessage')
      expect(sentMessages.length).toBeGreaterThan(1)
    })
  })

  describe('callback queries (approvals) — preserved', () => {
    it('should still handle callback queries for approvals', async () => {
      const update = {
        update_id: 4,
        callback_query: {
          id: 'cb-1',
          data: 'approve:approval-123',
          message: {
            message_id: 100,
            chat: { id: 12345 },
            text: 'Approve this task?',
          },
          from: { id: 67890, is_bot: false },
        },
      }

      // Mock dispatch engine
      vi.mock('../../../dispatch/index.js', () => ({
        dispatchEngine: {
          respondToApproval: vi.fn().mockResolvedValue(undefined),
        },
      }))

      await telegramChannel.handleUpdate(update)

      // Should have answered the callback query
      const answerCall = telegramApiCalls.find(c => c.method === 'answerCallbackQuery')
      expect(answerCall).toBeDefined()
    })
  })
})
