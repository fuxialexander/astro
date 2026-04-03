/**
 * Telegram Bidirectional Integration Tests
 *
 * Covers:
 * 1. Webhook receives text message → routes to chat API
 * 2. Slash command parsing → correct handler dispatch
 * 3. Streaming event → Telegram message edit sequence
 * 4. Approval request → inline keyboard → response routing
 * 5. topic_id → project mapping (via team members fan-out)
 * 6. Envelope creation and bus routing (channel-notification-hook → channel-router)
 */

import { vi, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import type { NotificationSenderFn } from '../../server/lib/channel/channel-types.js'

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock() calls
// ---------------------------------------------------------------------------

const { mockDb, mockSelect, mockDelete, mockInsert, mockUpdate, mockWhere, mockReturning, mockLimit } = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([])
  const mockLimit = vi.fn().mockReturnValue(mockReturning)
  const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning, limit: mockLimit, set: vi.fn() })
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
  const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) })
  const mockSelect = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: mockWhere }) })
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues })
  const mockDelete = vi.fn().mockReturnValue({ where: mockWhere })
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet })

  const mockDb = {
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
    update: mockUpdate,
  }

  return { mockDb, mockSelect, mockDelete, mockInsert, mockUpdate, mockWhere, mockReturning, mockLimit }
})

// Capture the notification sender fn when it's registered
let capturedNotificationSender: NotificationSenderFn | null = null

vi.mock('../../server/lib/db/index.js', () => ({ db: mockDb }))

vi.mock('../../server/lib/db/schema.js', () => {
  const table = (name: string) => {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get: (_target, prop) => {
        if (prop === '$inferInsert' || prop === '$inferSelect') return {}
        return `${name}.${String(prop)}`
      },
    }
    return new Proxy({}, handler)
  }
  return {
    connectedAccounts: table('connectedAccounts'),
    projects: table('projects'),
    teamMembers: table('teamMembers'),
    webauthnChallenges: table('webauthnChallenges'),
  }
})

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: 'inArray', args })),
  gt: vi.fn((...args: unknown[]) => ({ op: 'gt', args })),
}))

const mockSendNotification = vi.fn().mockResolvedValue(undefined)

vi.mock('../../server/lib/channel/channel-router.js', () => ({
  channelRouter: {
    registerGlobalNotificationSender: vi.fn((channel: string, fn: NotificationSenderFn) => {
      if (channel === 'telegram') {
        capturedNotificationSender = fn
      }
    }),
    registerNotificationSender: vi.fn(),
    registerResponseSender: vi.fn(),
    sendNotification: mockSendNotification,
    routeMessage: vi.fn().mockResolvedValue({
      text: 'AI response text',
      conversationRef: { channelId: 'chat-123' },
    }),
  },
}))

vi.mock('../../server/lib/channel/channel-config-manager.js', () => ({
  channelConfigManager: {
    invalidateCache: vi.fn(),
  },
}))

vi.mock('../../server/lib/channel/channel-formatter.js', () => ({
  formatForChannel: vi.fn((text: string) => text),
}))

// Mock dispatch engine for approval tests
const mockRespondToApproval = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/lib/dispatch/index.js', () => ({
  dispatchEngine: {
    respondToApproval: mockRespondToApproval,
  },
}))

// ---------------------------------------------------------------------------
// Intercept global fetch for Telegram Bot API calls
// ---------------------------------------------------------------------------

const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = []
const originalFetch = globalThis.fetch

// ---------------------------------------------------------------------------
// Adapter setup — start once, reuse across tests
// ---------------------------------------------------------------------------

let adapter: Awaited<ReturnType<typeof import('../../server/lib/channel/adapters/telegram-channel.js')>>['telegramChannel']

beforeAll(async () => {
  // Set up fetch mock for getMe call during start()
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    const body = init?.body ? JSON.parse(init.body as string) : {}
    fetchCalls.push({ url: urlStr, body })
    if (urlStr.includes('/getMe')) {
      return new Response(JSON.stringify({ ok: true, result: { username: 'astro_test_bot', first_name: 'Astro' } }))
    }
    return new Response(JSON.stringify({ ok: true }))
  }) as typeof fetch

  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-123'
  const mod = await import('../../server/lib/channel/adapters/telegram-channel.js')
  adapter = mod.telegramChannel
  await adapter.start()

  // Verify startup
  if (!adapter.isStarted) {
    throw new Error('Adapter failed to start')
  }
  if (!capturedNotificationSender) {
    throw new Error('Notification sender not captured during start()')
  }
})

beforeEach(() => {
  fetchCalls.length = 0
  mockRespondToApproval.mockReset().mockResolvedValue(undefined)

  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    const body = init?.body ? JSON.parse(init.body as string) : {}
    fetchCalls.push({ url: urlStr, body })

    if (urlStr.includes('/getMe')) {
      return new Response(JSON.stringify({ ok: true, result: { username: 'astro_test_bot', first_name: 'Astro' } }))
    }
    if (urlStr.includes('/sendMessage')) {
      return new Response(JSON.stringify({
        ok: true,
        result: { message_id: 100 + fetchCalls.length, chat: { id: body.chat_id } },
      }))
    }
    if (urlStr.includes('/editMessageText')) {
      return new Response(JSON.stringify({ ok: true, result: {} }))
    }
    if (urlStr.includes('/answerCallbackQuery')) {
      return new Response(JSON.stringify({ ok: true }))
    }
    return new Response(JSON.stringify({ ok: true }))
  }) as typeof fetch
})

afterEach(() => {
  // Reset DB mocks but not the module-level captured sender
  mockSelect.mockClear()
  mockInsert.mockClear()
  mockDelete.mockClear()
  mockUpdate.mockClear()
  mockWhere.mockClear()
  mockReturning.mockClear()
  mockLimit.mockClear()
  mockSendNotification.mockClear()

  // Re-apply default chaining behavior
  mockReturning.mockResolvedValue([])
  mockLimit.mockReturnValue(mockReturning)
  mockWhere.mockReturnValue({ returning: mockReturning, limit: mockLimit, set: vi.fn() })
  mockSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ where: mockWhere }) })
  mockInsert.mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) })
  mockDelete.mockReturnValue({ where: mockWhere })
  mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: mockWhere }) })
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

// Helper to get the captured notification sender
function getSender(): NotificationSenderFn {
  if (!capturedNotificationSender) {
    throw new Error('Notification sender not captured')
  }
  return capturedNotificationSender
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Telegram Bidirectional Integration', () => {

  // ─── 1. Webhook receives text message → routes to handleUpdate ──────

  describe('webhook text message handling', () => {
    it('should respond with help text for unrecognized messages', async () => {
      await adapter.handleUpdate({
        update_id: 1001,
        message: {
          message_id: 42,
          chat: { id: 12345, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Test' },
          text: 'Hello bot!',
          date: Date.now(),
        },
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.chat_id).toBe('12345')
      expect(sendCalls[0].body.text).toContain('notifications')
    })

    it('should ignore messages from bots', async () => {
      await adapter.handleUpdate({
        update_id: 1002,
        message: {
          message_id: 43,
          chat: { id: 12345, type: 'private' },
          from: { id: 888, is_bot: true, first_name: 'OtherBot' },
          text: 'Bot message',
          date: Date.now(),
        },
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(0)
    })

    it('should skip updates without message text', async () => {
      await adapter.handleUpdate({
        update_id: 1003,
        message: {
          message_id: 44,
          chat: { id: 12345, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Test' },
          // no text field (e.g., photo message)
          date: Date.now(),
        },
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(0)
    })

    it('should skip updates without message at all', async () => {
      await adapter.handleUpdate({
        update_id: 1004,
        // no message, no callback_query
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(0)
    })
  })

  // ─── 2. Slash command parsing → correct handler dispatch ────────────

  describe('slash command parsing', () => {
    it('/start without token should send welcome message', async () => {
      await adapter.handleUpdate({
        update_id: 2001,
        message: {
          message_id: 50,
          chat: { id: 67890, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Test' },
          text: '/start',
          date: Date.now(),
        },
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('Welcome')
      expect(sendCalls[0].body.text).toContain('Astro Settings')
    })

    it('/start with expired token should send error', async () => {
      // Mock consumeLinkToken → delete returns empty (expired/invalid)
      mockWhere.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([]) })

      await adapter.handleUpdate({
        update_id: 2002,
        message: {
          message_id: 51,
          chat: { id: 67890, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Test' },
          text: '/start abc123token',
          date: Date.now(),
        },
      })

      expect(mockDb.delete).toHaveBeenCalled()
      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('expired')
    })

    it('/start with valid token should link the account (new user)', async () => {
      // Mock consumeLinkToken → returns userId
      mockWhere.mockReturnValueOnce({
        returning: vi.fn().mockResolvedValue([{ challenge: 'user-abc-123' }]),
      })

      // Mock select for existing connected account check → none found
      const mockSelectFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      })
      mockSelect.mockReturnValueOnce({ from: mockSelectFrom })

      // Mock insert for new connected account
      const mockInsertValues = vi.fn().mockResolvedValue(undefined)
      mockInsert.mockReturnValueOnce({ values: mockInsertValues })

      await adapter.handleUpdate({
        update_id: 2003,
        message: {
          message_id: 52,
          chat: { id: 67890, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Test' },
          text: '/start validtoken123',
          date: Date.now(),
        },
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('Connected')
    })

    it('/start with valid token should update existing account', async () => {
      // Mock consumeLinkToken → returns userId
      mockWhere.mockReturnValueOnce({
        returning: vi.fn().mockResolvedValue([{ challenge: 'user-existing' }]),
      })

      // Mock select for existing connected account check → found one
      const mockSelectFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'acc-existing' }]),
        }),
      })
      mockSelect.mockReturnValueOnce({ from: mockSelectFrom })

      // Mock update
      const mockUpdateSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      mockUpdate.mockReturnValueOnce({ set: mockUpdateSet })

      await adapter.handleUpdate({
        update_id: 2003,
        message: {
          message_id: 52,
          chat: { id: 67890, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Test' },
          text: '/start updatetoken',
          date: Date.now(),
        },
      })

      expect(mockDb.update).toHaveBeenCalled()
      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('Connected')
    })

    it('/connection should report connected when account exists', async () => {
      mockLimit.mockResolvedValueOnce([{ id: 'acc-1', externalId: '67890', enabled: true }])

      await adapter.handleUpdate({
        update_id: 2004,
        message: {
          message_id: 53,
          chat: { id: 67890, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Test' },
          text: '/connection',
          date: Date.now(),
        },
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('connected')
    })

    it('/connection should report not connected when no account', async () => {
      mockLimit.mockResolvedValueOnce([])

      await adapter.handleUpdate({
        update_id: 2004,
        message: {
          message_id: 53,
          chat: { id: 67890, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Test' },
          text: '/connection',
          date: Date.now(),
        },
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('not connected')
    })

    it('/disconnect should delete connected account and confirm', async () => {
      mockWhere.mockReturnValueOnce({
        returning: vi.fn().mockResolvedValue([{ id: 'acc-1' }]),
      })

      await adapter.handleUpdate({
        update_id: 2005,
        message: {
          message_id: 54,
          chat: { id: 67890, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Test' },
          text: '/disconnect',
          date: Date.now(),
        },
      })

      expect(mockDb.delete).toHaveBeenCalled()
      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('Disconnected')
    })

    it('/disconnect with no connection should report nothing found', async () => {
      mockWhere.mockReturnValueOnce({
        returning: vi.fn().mockResolvedValue([]),
      })

      await adapter.handleUpdate({
        update_id: 2006,
        message: {
          message_id: 55,
          chat: { id: 67890, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Test' },
          text: '/disconnect',
          date: Date.now(),
        },
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('No active connection')
    })
  })

  // ─── 3. Notification → Telegram message delivery ───────────────────

  describe('notification → Telegram message delivery', () => {
    function setupProjectLookup(teamId: string | null, ownerId: string) {
      const mockProjectFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ teamId, ownerId }]),
        }),
      })
      mockSelect.mockReturnValueOnce({ from: mockProjectFrom })
    }

    function setupTeamMembers(members: Array<{ userId: string }>) {
      const mockMembersFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(members),
      })
      mockSelect.mockReturnValueOnce({ from: mockMembersFrom })
    }

    function setupConnectedAccounts(accounts: Array<{ externalId: string }>) {
      const mockAccountsFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(accounts),
      })
      mockSelect.mockReturnValueOnce({ from: mockAccountsFrom })
    }

    it('should format and send task.completed to all project members', async () => {
      setupProjectLookup('team-1', 'user-owner')
      setupTeamMembers([{ userId: 'user-owner' }, { userId: 'user-member-1' }])
      setupConnectedAccounts([{ externalId: '111' }, { externalId: '222' }])

      await getSender()({
        type: 'task.completed',
        projectId: 'proj-abc',
        summary: 'Build succeeded',
        astroUrl: 'https://app.astro.dev/project/proj-abc/task/node-1',
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(2)
      expect(sendCalls[0].body.chat_id).toBe('111')
      expect(sendCalls[1].body.chat_id).toBe('222')
      expect(sendCalls[0].body.text).toContain('Task Completed')
      expect(sendCalls[0].body.parse_mode).toBe('HTML')
    })

    it('should send task.failed notification with error icon', async () => {
      setupProjectLookup(null, 'user-solo')
      setupConnectedAccounts([{ externalId: '333' }])

      await getSender()({
        type: 'task.failed',
        projectId: 'proj-def',
        summary: 'OOM killed',
        astroUrl: 'https://app.astro.dev/project/proj-def/task/node-2',
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('Task Failed')
      expect(sendCalls[0].body.text).toContain('OOM killed')
    })

    it('should include View in Astro link', async () => {
      setupProjectLookup(null, 'user-1')
      setupConnectedAccounts([{ externalId: '444' }])

      await getSender()({
        type: 'task.completed',
        projectId: 'proj-link',
        summary: 'Done',
        astroUrl: 'https://app.astro.dev/project/proj-link/task/node-3',
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls[0].body.text).toContain('View in Astro')
      expect(sendCalls[0].body.text).toContain('https://app.astro.dev/project/proj-link/task/node-3')
    })

    it('should not send when no connected accounts found', async () => {
      setupProjectLookup('team-1', 'user-1')
      setupTeamMembers([{ userId: 'user-1' }])
      setupConnectedAccounts([])

      await getSender()({
        type: 'task.completed',
        projectId: 'proj-xyz',
        summary: 'Done',
        astroUrl: 'https://app.astro.dev/x',
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(0)
    })

    it('should not send when project not found', async () => {
      const mockProjectFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      })
      mockSelect.mockReturnValueOnce({ from: mockProjectFrom })

      await getSender()({
        type: 'task.completed',
        projectId: 'nonexistent',
        summary: 'Done',
        astroUrl: 'https://app.astro.dev/x',
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(0)
    })

    it('should show branch.pruned notification with scissors icon', async () => {
      setupProjectLookup(null, 'user-1')
      setupConnectedAccounts([{ externalId: '555' }])

      await getSender()({
        type: 'branch.pruned',
        projectId: 'proj-prune',
        summary: '3 nodes pruned',
        astroUrl: 'https://app.astro.dev/project/proj-prune/plan',
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('Branch Pruned')
    })

    it('should show project.completed notification with party icon', async () => {
      setupProjectLookup(null, 'user-1')
      setupConnectedAccounts([{ externalId: '666' }])

      await getSender()({
        type: 'project.completed',
        projectId: 'proj-done',
        summary: 'All tasks complete',
        astroUrl: 'https://app.astro.dev/project/proj-done/plan',
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('Project Completed')
    })
  })

  // ─── 4. Approval request → inline keyboard → response routing ──────

  describe('approval request → inline keyboard → response routing', () => {

    function setupProjectLookup(teamId: string | null, ownerId: string) {
      const mockProjectFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ teamId, ownerId }]),
        }),
      })
      mockSelect.mockReturnValueOnce({ from: mockProjectFrom })
    }

    function setupConnectedAccounts(accounts: Array<{ externalId: string }>) {
      const mockAccountsFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(accounts),
      })
      mockSelect.mockReturnValueOnce({ from: mockAccountsFrom })
    }

    it('should send approval with approve/reject inline keyboard', async () => {
      setupProjectLookup(null, 'user-1')
      setupConnectedAccounts([{ externalId: '444' }])

      await getSender()({
        type: 'approval.requested',
        projectId: 'proj-appr',
        summary: 'Deploy to production?',
        astroUrl: 'https://app.astro.dev/project/proj-appr/task/node-3',
        metadata: { approvalId: 'appr-001' },
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.text).toContain('Approval Needed')

      const keyboard = sendCalls[0].body.reply_markup as {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>
      }
      expect(keyboard.inline_keyboard).toHaveLength(1)
      expect(keyboard.inline_keyboard[0]).toHaveLength(2)
      expect(keyboard.inline_keyboard[0][0]).toEqual({ text: 'Approve', callback_data: 'approve:appr-001' })
      expect(keyboard.inline_keyboard[0][1]).toEqual({ text: 'Reject', callback_data: 'reject:appr-001' })
    })

    it('should send multi-option approval with per-option buttons', async () => {
      setupProjectLookup(null, 'user-1')
      setupConnectedAccounts([{ externalId: '555' }])

      await getSender()({
        type: 'approval.requested',
        projectId: 'proj-appr',
        summary: 'Choose deployment target',
        astroUrl: 'https://app.astro.dev/x',
        metadata: {
          approvalId: 'appr-002',
          options: ['Staging', 'Production', 'Skip'],
        },
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      const keyboard = sendCalls[0].body.reply_markup as {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>
      }
      expect(keyboard.inline_keyboard).toHaveLength(3)
      expect(keyboard.inline_keyboard[0][0]).toEqual({ text: 'Staging', callback_data: 'option:appr-002:Staging' })
      expect(keyboard.inline_keyboard[1][0]).toEqual({ text: 'Production', callback_data: 'option:appr-002:Production' })
      expect(keyboard.inline_keyboard[2][0]).toEqual({ text: 'Skip', callback_data: 'option:appr-002:Skip' })
    })

    it('should not add keyboard when no approvalId in metadata', async () => {
      setupProjectLookup(null, 'user-1')
      setupConnectedAccounts([{ externalId: '666' }])

      await getSender()({
        type: 'approval.requested',
        projectId: 'proj-appr',
        summary: 'Some approval',
        astroUrl: 'https://app.astro.dev/x',
        metadata: {}, // no approvalId
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.reply_markup).toBeUndefined()
    })

    it('should handle approve callback → dispatch engine + edit message', async () => {
      // Mock identity check: sender (from.id=999) has a connected Astro account
      mockLimit.mockResolvedValueOnce([{ id: 'acc-999' }])

      await adapter.handleUpdate({
        update_id: 4001,
        callback_query: {
          id: 'cbq-001',
          data: 'approve:appr-001',
          from: { id: 999, is_bot: false, first_name: 'Test' },
          message: {
            message_id: 200,
            chat: { id: 444, type: 'private' },
            text: 'Original approval text',
            date: Date.now(),
          },
        },
      })

      expect(mockRespondToApproval).toHaveBeenCalledWith('appr-001', true, undefined)

      const editCalls = fetchCalls.filter(c => c.url.includes('/editMessageText'))
      expect(editCalls).toHaveLength(1)
      expect(editCalls[0].body.text).toContain('Approved')
      expect(editCalls[0].body.message_id).toBe(200)
      expect(editCalls[0].body.chat_id).toBe('444')

      const answerCalls = fetchCalls.filter(c => c.url.includes('/answerCallbackQuery'))
      expect(answerCalls).toHaveLength(1)
      expect(answerCalls[0].body.text).toBe('Approved')
    })

    it('should handle reject callback → dispatch engine', async () => {
      mockLimit.mockResolvedValueOnce([{ id: 'acc-999' }])

      await adapter.handleUpdate({
        update_id: 4002,
        callback_query: {
          id: 'cbq-002',
          data: 'reject:appr-003',
          from: { id: 999, is_bot: false, first_name: 'Test' },
          message: {
            message_id: 201,
            chat: { id: 444, type: 'private' },
            text: 'Approval request',
            date: Date.now(),
          },
        },
      })

      expect(mockRespondToApproval).toHaveBeenCalledWith('appr-003', false, undefined)

      const editCalls = fetchCalls.filter(c => c.url.includes('/editMessageText'))
      expect(editCalls).toHaveLength(1)
      expect(editCalls[0].body.text).toContain('Rejected')
    })

    it('should handle option callback with selected option', async () => {
      mockLimit.mockResolvedValueOnce([{ id: 'acc-999' }])

      await adapter.handleUpdate({
        update_id: 4003,
        callback_query: {
          id: 'cbq-003',
          data: 'option:appr-004:Production',
          from: { id: 999, is_bot: false, first_name: 'Test' },
          message: {
            message_id: 202,
            chat: { id: 444, type: 'private' },
            text: 'Choose target',
            date: Date.now(),
          },
        },
      })

      expect(mockRespondToApproval).toHaveBeenCalledWith('appr-004', true, 'Production')

      const editCalls = fetchCalls.filter(c => c.url.includes('/editMessageText'))
      expect(editCalls[0].body.text).toContain('Approved: Production')
    })

    it('should handle option with colon in value correctly', async () => {
      mockLimit.mockResolvedValueOnce([{ id: 'acc-999' }])

      await adapter.handleUpdate({
        update_id: 4004,
        callback_query: {
          id: 'cbq-004',
          data: 'option:appr-005:env:staging:us-east-1',
          from: { id: 999, is_bot: false, first_name: 'Test' },
          message: {
            message_id: 203,
            chat: { id: 444, type: 'private' },
            text: 'Choose target',
            date: Date.now(),
          },
        },
      })

      expect(mockRespondToApproval).toHaveBeenCalledWith('appr-005', true, 'env:staging:us-east-1')
    })

    it('should handle unknown callback data gracefully', async () => {
      mockLimit.mockResolvedValueOnce([{ id: 'acc-999' }])

      await adapter.handleUpdate({
        update_id: 4005,
        callback_query: {
          id: 'cbq-005',
          data: 'unknown_action:something',
          from: { id: 999, is_bot: false, first_name: 'Test' },
          message: {
            message_id: 204,
            chat: { id: 444, type: 'private' },
            text: 'Some message',
            date: Date.now(),
          },
        },
      })

      expect(mockRespondToApproval).not.toHaveBeenCalled()

      const answerCalls = fetchCalls.filter(c => c.url.includes('/answerCallbackQuery'))
      expect(answerCalls).toHaveLength(1)
      expect(answerCalls[0].body.text).toBe('Unknown action')
    })

    it('should handle expired approval callback gracefully', async () => {
      mockLimit.mockResolvedValueOnce([{ id: 'acc-999' }])
      mockRespondToApproval.mockRejectedValueOnce(new Error('No pending approval found for appr-expired'))

      await adapter.handleUpdate({
        update_id: 4006,
        callback_query: {
          id: 'cbq-006',
          data: 'approve:appr-expired',
          from: { id: 999, is_bot: false, first_name: 'Test' },
          message: {
            message_id: 205,
            chat: { id: 444, type: 'private' },
            text: 'Old approval',
            date: Date.now(),
          },
        },
      })

      const editCalls = fetchCalls.filter(c => c.url.includes('/editMessageText'))
      expect(editCalls).toHaveLength(1)
      expect(editCalls[0].body.text).toContain('Expired or already handled')

      const answerCalls = fetchCalls.filter(c => c.url.includes('/answerCallbackQuery'))
      expect(answerCalls).toHaveLength(1)
      expect(answerCalls[0].body.text).toContain('expired')
    })

    it('should handle callback query without data field', async () => {
      await adapter.handleUpdate({
        update_id: 4007,
        callback_query: {
          id: 'cbq-007',
          // no data field
          from: { id: 999, is_bot: false, first_name: 'Test' },
          message: {
            message_id: 206,
            chat: { id: 444, type: 'private' },
            text: 'Some message',
            date: Date.now(),
          },
        },
      })

      const answerCalls = fetchCalls.filter(c => c.url.includes('/answerCallbackQuery'))
      expect(answerCalls).toHaveLength(1)
      expect(answerCalls[0].body.text).toBe('Invalid request')
    })

    it('should handle generic dispatch error', async () => {
      mockLimit.mockResolvedValueOnce([{ id: 'acc-999' }])
      mockRespondToApproval.mockRejectedValueOnce(new Error('Network timeout'))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await adapter.handleUpdate({
        update_id: 4008,
        callback_query: {
          id: 'cbq-008',
          data: 'approve:appr-fail',
          from: { id: 999, is_bot: false, first_name: 'Test' },
          message: {
            message_id: 207,
            chat: { id: 444, type: 'private' },
            text: 'Approval',
            date: Date.now(),
          },
        },
      })

      const answerCalls = fetchCalls.filter(c => c.url.includes('/answerCallbackQuery'))
      expect(answerCalls).toHaveLength(1)
      expect(answerCalls[0].body.text).toContain('Error: Network timeout')

      consoleSpy.mockRestore()
    })
  })

  // ─── 5. Project mapping via team members fan-out ────────────────────

  describe('project → team → members → chat_id mapping', () => {

    function setupProjectLookup(teamId: string | null, ownerId: string) {
      const mockProjectFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ teamId, ownerId }]),
        }),
      })
      mockSelect.mockReturnValueOnce({ from: mockProjectFrom })
    }

    function setupTeamMembers(members: Array<{ userId: string }>) {
      const mockMembersFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(members),
      })
      mockSelect.mockReturnValueOnce({ from: mockMembersFrom })
    }

    function setupConnectedAccounts(accounts: Array<{ externalId: string }>) {
      const mockAccountsFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(accounts),
      })
      mockSelect.mockReturnValueOnce({ from: mockAccountsFrom })
    }

    it('should fan out to all team members with connected Telegram', async () => {
      setupProjectLookup('team-big', 'user-a')
      setupTeamMembers([{ userId: 'user-a' }, { userId: 'user-b' }, { userId: 'user-c' }])
      setupConnectedAccounts([{ externalId: '1001' }, { externalId: '1002' }])

      await getSender()({
        type: 'task.completed',
        projectId: 'proj-team',
        summary: 'All tests pass',
        astroUrl: 'https://app.astro.dev/x',
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(2)
      expect(sendCalls.map(c => c.body.chat_id)).toEqual(['1001', '1002'])
    })

    it('should always include owner even if not in team members list', async () => {
      setupProjectLookup('team-x', 'owner-special')
      setupTeamMembers([{ userId: 'user-regular' }])
      setupConnectedAccounts([{ externalId: '9001' }])

      await getSender()({
        type: 'task.completed',
        projectId: 'proj-own',
        summary: 'Done',
        astroUrl: 'https://app.astro.dev/x',
      })

      // Verify inArray was called with both users
      const { inArray } = await import('drizzle-orm')
      expect(vi.mocked(inArray)).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(['user-regular', 'owner-special']),
      )
    })

    it('should handle project with no team (solo owner)', async () => {
      setupProjectLookup(null, 'solo-user')
      setupConnectedAccounts([{ externalId: '7777' }])

      await getSender()({
        type: 'task.completed',
        projectId: 'proj-solo',
        summary: 'Solo task done',
        astroUrl: 'https://app.astro.dev/x',
      })

      const sendCalls = fetchCalls.filter(c => c.url.includes('/sendMessage'))
      expect(sendCalls).toHaveLength(1)
      expect(sendCalls[0].body.chat_id).toBe('7777')
    })

    it('should deduplicate owner when already in team members', async () => {
      setupProjectLookup('team-y', 'user-a')
      setupTeamMembers([{ userId: 'user-a' }, { userId: 'user-b' }])
      setupConnectedAccounts([{ externalId: '8001' }])

      await getSender()({
        type: 'task.completed',
        projectId: 'proj-dedup',
        summary: 'Done',
        astroUrl: 'https://app.astro.dev/x',
      })

      // Verify inArray was called with deduplicated list (user-a appears only once)
      const { inArray } = await import('drizzle-orm')
      const calls = vi.mocked(inArray).mock.calls
      const lastCall = calls[calls.length - 1]
      const userIds = lastCall[1] as string[]
      const uniqueIds = [...new Set(userIds)]
      expect(userIds.length).toBe(uniqueIds.length)
    })
  })

  // ─── 6. Envelope creation and bus routing ───────────────────────────

  describe('envelope creation and bus routing', () => {
    it('channel-notification-hook creates correct envelope for task.completed', async () => {
      const { channelNotificationHook } = await import('../../server/lib/events/hooks/channel-notification-hook.js')

      await channelNotificationHook({
        type: 'task.completed',
        projectId: 'proj-envelope',
        nodeId: 'node-1',
        executionId: 'exec-1',
        result: {
          summary: {
            executiveSummary: 'Built and deployed successfully',
            keyFindings: ['All tests pass', 'No regressions'],
          },
          metrics: {
            durationMs: 120000,
            totalCost: 0.42,
            numTurns: 5,
          },
          prUrl: 'https://github.com/org/repo/pull/42',
          prNumber: 42,
        },
        node: { title: 'Build frontend' },
        project: { name: 'Web App' },
      } as any)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.completed',
          projectId: 'proj-envelope',
          astroUrl: expect.stringContaining('/project/proj-envelope/task/node-1'),
          metadata: expect.objectContaining({
            nodeId: 'node-1',
            executionId: 'exec-1',
          }),
        }),
      )

      const notification = mockSendNotification.mock.calls[0][0]
      expect(notification.summary).toContain('Build frontend')
      expect(notification.summary).toContain('Built and deployed successfully')
      expect(notification.summary).toContain('#42')
      expect(notification.summary).toContain('$0.42')
    })

    it('channel-notification-hook creates correct envelope for approval.requested', async () => {
      const { channelNotificationHook } = await import('../../server/lib/events/hooks/channel-notification-hook.js')
      mockSendNotification.mockClear()

      await channelNotificationHook({
        type: 'approval.requested',
        projectId: 'proj-appr-env',
        nodeId: 'node-2',
        approvalId: 'appr-100',
        message: 'Deploy to production?',
        options: ['Yes', 'No', 'Staging only'],
      } as any)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'approval.requested',
          projectId: 'proj-appr-env',
          summary: expect.stringContaining('Deploy to production?'),
          metadata: expect.objectContaining({
            approvalId: 'appr-100',
            options: ['Yes', 'No', 'Staging only'],
          }),
        }),
      )
    })

    it('channel-notification-hook creates correct envelope for task.failed', async () => {
      const { channelNotificationHook } = await import('../../server/lib/events/hooks/channel-notification-hook.js')
      mockSendNotification.mockClear()

      await channelNotificationHook({
        type: 'task.failed',
        projectId: 'proj-fail',
        nodeId: 'node-3',
        executionId: 'exec-3',
        error: 'OOM killed after 30 minutes',
        node: { title: 'Train model' },
        project: { name: 'ML Pipeline' },
      } as any)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.failed',
          projectId: 'proj-fail',
          metadata: expect.objectContaining({
            error: 'OOM killed after 30 minutes',
          }),
        }),
      )

      const notification = mockSendNotification.mock.calls[0][0]
      expect(notification.summary).toContain('Train model')
      expect(notification.summary).toContain('OOM killed')
    })

    it('channel-notification-hook creates envelope for branch.pruned', async () => {
      const { channelNotificationHook } = await import('../../server/lib/events/hooks/channel-notification-hook.js')
      mockSendNotification.mockClear()

      await channelNotificationHook({
        type: 'branch.pruned',
        projectId: 'proj-prune',
        branchNodeId: 'branch-1',
        prunedNodes: ['n1', 'n2', 'n3'],
        reason: 'User requested cancellation',
      } as any)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'branch.pruned',
          projectId: 'proj-prune',
          summary: expect.stringContaining('3 nodes removed'),
          astroUrl: expect.stringContaining('/project/proj-prune/plan'),
        }),
      )
    })

    it('channel-notification-hook creates envelope for project.completed', async () => {
      const { channelNotificationHook } = await import('../../server/lib/events/hooks/channel-notification-hook.js')
      mockSendNotification.mockClear()

      await channelNotificationHook({
        type: 'project.completed',
        projectId: 'proj-done',
        project: { name: 'Astro v2' },
        projectBranch: 'feat/v2',
        projectPrUrl: 'https://github.com/org/repo/pull/100',
        projectPrNumber: 100,
      } as any)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'project.completed',
          projectId: 'proj-done',
          summary: expect.stringContaining('Astro v2'),
        }),
      )

      const notification = mockSendNotification.mock.calls[0][0]
      expect(notification.summary).toContain('#100')
      expect(notification.metadata?.prUrl).toBe('https://github.com/org/repo/pull/100')
    })

    it('channel-notification-hook uses playground URL for playground nodes', async () => {
      const { channelNotificationHook } = await import('../../server/lib/events/hooks/channel-notification-hook.js')
      mockSendNotification.mockClear()

      await channelNotificationHook({
        type: 'task.completed',
        projectId: 'proj-pg',
        nodeId: 'playground-abc',
        executionId: 'exec-pg',
        result: {},
        node: { title: 'Playground session' },
      } as any)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          astroUrl: expect.stringContaining('/playground?projectId=proj-pg'),
        }),
      )
    })

    it('channel-notification-hook does not send for unknown event types', async () => {
      const { channelNotificationHook } = await import('../../server/lib/events/hooks/channel-notification-hook.js')
      mockSendNotification.mockClear()

      await channelNotificationHook({
        type: 'task.started',
        projectId: 'proj-unknown',
        nodeId: 'node-x',
      } as any)

      expect(mockSendNotification).not.toHaveBeenCalled()
    })
  })

  // ─── Adapter lifecycle ──────────────────────────────────────────────

  describe('adapter lifecycle', () => {
    it('should be marked as configured and started', () => {
      expect(adapter.isConfigured).toBe(true)
      expect(adapter.isStarted).toBe(true)
    })

    it('getBotUsername should return the bot username', () => {
      expect(adapter.getBotUsername()).toBe('astro_test_bot')
    })

    it('getBotToken should return the token', () => {
      expect(adapter.getBotToken()).toBe('test-bot-token-123')
    })
  })
})

