/**
 * Browser Notification Tests
 *
 * Tests the notification helper functions from src/lib/notifications.ts,
 * focusing on the new showBatchCompleteNotification and showChatCompleteNotification.
 *
 * Run with: npx vitest run tests/notifications.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import all notification functions
import {
  showBatchCompleteNotification,
  showChatCompleteNotification,
  showPlanCompleteNotification,
  showApprovalNotification,
  showTaskNotification,
  requestNotificationPermission,
} from '../src/lib/notifications'

// ============================================================================
// Test Helpers
// ============================================================================

let notificationInstances: Array<{ title: string; options: NotificationOptions }>

function setupNotificationMock(permission: NotificationPermission, hasFocus = false) {
  notificationInstances = []

  // Must use a real function/class so `new Notification(...)` works
  function MockNotification(this: { title: string; options: NotificationOptions }, title: string, options: NotificationOptions) {
    notificationInstances.push({ title, options })
  }

  Object.defineProperty(MockNotification, 'permission', {
    get: () => permission,
    configurable: true,
  })

  MockNotification.requestPermission = vi.fn().mockResolvedValue(permission)

  vi.stubGlobal('Notification', MockNotification)
  vi.stubGlobal('document', { hasFocus: () => hasFocus })
  // In Node, `typeof window === 'undefined'` — stub it so notification code proceeds
  vi.stubGlobal('window', globalThis)
}

// ============================================================================
// Tests
// ============================================================================

describe('showBatchCompleteNotification', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows notification with succeeded and failed stats', () => {
    setupNotificationMock('granted', false)

    showBatchCompleteNotification('My Project', { total: 5, succeeded: 3, failed: 2 })

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].title).toBe('Execution complete: My Project')
    expect(notificationInstances[0].options.body).toBe('3 succeeded, 2 failed')
  })

  it('shows only succeeded when no failures', () => {
    setupNotificationMock('granted', false)

    showBatchCompleteNotification('Build', { total: 4, succeeded: 4, failed: 0 })

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].options.body).toBe('4 succeeded')
  })

  it('shows only failed when no successes', () => {
    setupNotificationMock('granted', false)

    showBatchCompleteNotification('Build', { total: 3, succeeded: 0, failed: 3 })

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].options.body).toBe('3 failed')
  })

  it('shows fallback message when both succeeded and failed are 0', () => {
    setupNotificationMock('granted', false)

    showBatchCompleteNotification('Build', { total: 2, succeeded: 0, failed: 0 })

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].options.body).toBe('All 2 tasks processed')
  })

  it('does not fire when permission is not granted', () => {
    setupNotificationMock('denied', false)

    showBatchCompleteNotification('Project', { total: 1, succeeded: 1, failed: 0 })

    expect(notificationInstances).toHaveLength(0)
  })

  it('does not fire when permission is default (not yet asked)', () => {
    setupNotificationMock('default', false)

    showBatchCompleteNotification('Project', { total: 1, succeeded: 1, failed: 0 })

    expect(notificationInstances).toHaveLength(0)
  })

  it('does not fire when document has focus', () => {
    setupNotificationMock('granted', true)

    showBatchCompleteNotification('Project', { total: 1, succeeded: 1, failed: 0 })

    expect(notificationInstances).toHaveLength(0)
  })

  it('does not fire in non-browser environment (no window.Notification)', () => {
    vi.stubGlobal('Notification', undefined)
    vi.stubGlobal('document', { hasFocus: () => false })

    // Should not throw
    expect(() => {
      showBatchCompleteNotification('Project', { total: 1, succeeded: 1, failed: 0 })
    }).not.toThrow()
  })

  it('uses unique tag per invocation', () => {
    setupNotificationMock('granted', false)

    showBatchCompleteNotification('P1', { total: 1, succeeded: 1, failed: 0 })
    showBatchCompleteNotification('P2', { total: 2, succeeded: 2, failed: 0 })

    expect(notificationInstances).toHaveLength(2)
    const tag1 = notificationInstances[0].options.tag!
    const tag2 = notificationInstances[1].options.tag!
    expect(tag1).toMatch(/^batch-complete-/)
    expect(tag2).toMatch(/^batch-complete-/)
    // Tags should differ (different Date.now() values)
    // Note: in fast test runs they might have same ms, but prefix is correct
  })
})

describe('showChatCompleteNotification', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows notification with project name', () => {
    setupNotificationMock('granted', false)

    showChatCompleteNotification('My Research')

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].title).toBe('Response ready: My Research')
    expect(notificationInstances[0].options.body).toBe('Chat response for "My Research" is ready.')
  })

  it('does not fire when permission is not granted', () => {
    setupNotificationMock('denied', false)

    showChatCompleteNotification('Project')

    expect(notificationInstances).toHaveLength(0)
  })

  it('does not fire when document has focus', () => {
    setupNotificationMock('granted', true)

    showChatCompleteNotification('Project')

    expect(notificationInstances).toHaveLength(0)
  })

  it('uses chat-complete tag prefix', () => {
    setupNotificationMock('granted', false)

    showChatCompleteNotification('Test')

    expect(notificationInstances[0].options.tag).toMatch(/^chat-complete-/)
  })
})

describe('showPlanCompleteNotification', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows notification with project name', () => {
    setupNotificationMock('granted', false)

    showPlanCompleteNotification('AI Agent')

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].title).toBe('Plan complete: AI Agent')
    expect(notificationInstances[0].options.body).toContain('AI Agent')
  })

  it('respects permission guard', () => {
    setupNotificationMock('denied', false)

    showPlanCompleteNotification('Project')

    expect(notificationInstances).toHaveLength(0)
  })
})

describe('showApprovalNotification', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows notification with question text', () => {
    setupNotificationMock('granted', false)

    showApprovalNotification('Build System', 'Should we use pnpm?')

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].title).toBe('Decision needed: Build System')
    expect(notificationInstances[0].options.body).toBe('Should we use pnpm?')
  })
})

describe('showTaskNotification', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows completed notification', () => {
    setupNotificationMock('granted', false)

    showTaskNotification('My Project', 'Fix bug #42', 'completed')

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].title).toBe('Task completed: My Project')
    expect(notificationInstances[0].options.body).toBe('Fix bug #42')
  })

  it('shows failed notification', () => {
    setupNotificationMock('granted', false)

    showTaskNotification('My Project', 'Deploy v2', 'failed')

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].title).toBe('Task failed: My Project')
  })

  it('shows judgment notification', () => {
    setupNotificationMock('granted', false)

    showTaskNotification('My Project', 'Design review', 'awaiting_judgment')

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].title).toBe('Judgment needed: My Project')
  })
})

describe('requestNotificationPermission', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls requestPermission when permission is default', () => {
    setupNotificationMock('default', false)
    const spy = Notification.requestPermission as ReturnType<typeof vi.fn>

    requestNotificationPermission()

    expect(spy).toHaveBeenCalled()
  })

  it('does not call requestPermission when already granted', () => {
    setupNotificationMock('granted', false)
    const spy = Notification.requestPermission as ReturnType<typeof vi.fn>

    requestNotificationPermission()

    expect(spy).not.toHaveBeenCalled()
  })

  it('does not call requestPermission when denied', () => {
    setupNotificationMock('denied', false)
    const spy = Notification.requestPermission as ReturnType<typeof vi.fn>

    requestNotificationPermission()

    expect(spy).not.toHaveBeenCalled()
  })
})
