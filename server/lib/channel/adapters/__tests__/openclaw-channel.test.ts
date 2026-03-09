/**
 * OpenClaw Channel Adapter Tests — Relay-Routed Architecture
 *
 * Tests the relay-routed adapter that sends notifications, responses, and
 * approval requests through the relay to an agent runner with OpenClaw provider.
 */

import { EventEmitter } from 'node:events'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OpenClawChannelAdapter } from '../openclaw-channel.js'
import type { ChannelNotification } from '../../channel-types.js'

// ---------------------------------------------------------------------------
// Mock relay server
// ---------------------------------------------------------------------------

const mockRelayServer = new EventEmitter() as EventEmitter & {
  findOpenClawMachine: ReturnType<typeof vi.fn>
  sendChannelNotification: ReturnType<typeof vi.fn>
  sendChannelResponse: ReturnType<typeof vi.fn>
  sendChannelApprovalRequest: ReturnType<typeof vi.fn>
}
mockRelayServer.findOpenClawMachine = vi.fn().mockReturnValue('machine-1')
mockRelayServer.sendChannelNotification = vi.fn().mockReturnValue(true)
mockRelayServer.sendChannelResponse = vi.fn().mockReturnValue(true)
mockRelayServer.sendChannelApprovalRequest = vi.fn().mockReturnValue(true)
// Raise maxListeners to avoid warning from multiple test starts
mockRelayServer.setMaxListeners(50)

vi.mock('../../../relay-server.js', () => ({
  relayServer: mockRelayServer,
}))

vi.mock('../../channel-router.js', () => ({
  channelRouter: {
    registerNotificationSender: vi.fn(),
    registerResponseSender: vi.fn(),
    registerGlobalNotificationSender: vi.fn(),
    routeMessage: vi.fn().mockResolvedValue({
      text: 'response',
      conversationRef: { channelId: 'ch-1' },
    }),
  },
}))

vi.mock('../../channel-formatter.js', () => ({
  formatForChannel: vi.fn((text: string) => text.replace(/\*\*/g, '').replace(/`/g, '')),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenClawChannelAdapter (relay-routed)', () => {
  let adapter: OpenClawChannelAdapter

  beforeEach(() => {
    adapter = new OpenClawChannelAdapter()
    mockRelayServer.findOpenClawMachine.mockReturnValue('machine-1')
    mockRelayServer.sendChannelNotification.mockReturnValue(true)
    mockRelayServer.sendChannelResponse.mockReturnValue(true)
    mockRelayServer.sendChannelApprovalRequest.mockReturnValue(true)
  })

  afterEach(() => {
    adapter.stop()
    mockRelayServer.removeAllListeners('channel:notification_ack')
    mockRelayServer.removeAllListeners('channel:response_ack')
    mockRelayServer.removeAllListeners('channel:approval_response')
    mockRelayServer.removeAllListeners('channel:inbound')
  })

  // ─── Lifecycle ────────────────────────────────────────────────

  describe('start/stop', () => {
    it('should start successfully', async () => {
      await adapter.start()
      expect(adapter.isConnected).toBe(true)
    })

    it('should register response sender on start', async () => {
      const { channelRouter } = await import('../../channel-router.js')
      await adapter.start()
      expect(channelRouter.registerResponseSender).toHaveBeenCalledWith(
        'openclaw',
        expect.any(Function),
      )
    })

    it('should not be connected after stop', async () => {
      await adapter.start()
      adapter.stop()
      expect(adapter.isConnected).toBe(false)
    })
  })

  // ─── Outbound Notifications ───────────────────────────────────

  describe('sendNotification', () => {
    beforeEach(async () => {
      await adapter.start()
    })

    it('should send notification via relay to openclaw machine', async () => {
      const notification: ChannelNotification = {
        type: 'task.completed',
        projectId: 'project-abc',
        summary: 'Build **succeeded**',
        astroUrl: 'https://app.astro.dev/x',
      }

      // Auto-ack the notification
      const notifPromise = adapter.sendNotification(notification)
      await tick()
      mockRelayServer.emit('channel:notification_ack', {
        correlationId: mockRelayServer.sendChannelNotification.mock.calls[0][1],
        success: true,
      })
      await notifPromise

      expect(mockRelayServer.sendChannelNotification).toHaveBeenCalledWith(
        'machine-1',
        expect.any(String),
        expect.objectContaining({
          type: 'task.completed',
          projectId: 'project-abc',
          summary: 'Build succeeded',
        }),
      )
    })

    it('should log warning when no OpenClaw machine available', async () => {
      mockRelayServer.findOpenClawMachine.mockReturnValue(null)
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const notification: ChannelNotification = {
        type: 'task.completed',
        projectId: 'project-abc',
        summary: 'Done',
        astroUrl: 'https://app.astro.dev/x',
      }

      await adapter.sendNotification(notification)

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No OpenClaw machine available'),
      )
      consoleSpy.mockRestore()
    })
  })

  // ─── Outbound Responses ───────────────────────────────────────

  describe('sendResponse', () => {
    beforeEach(async () => {
      await adapter.start()
    })

    it('should send response via relay', async () => {
      const responsePromise = adapter.sendResponse({
        text: 'Here is the **answer**',
        conversationRef: {
          channelId: 'oc-channel-1',
          threadId: 'thread-42',
        },
      })

      await tick()
      mockRelayServer.emit('channel:response_ack', {
        correlationId: mockRelayServer.sendChannelResponse.mock.calls[0][1],
        success: true,
      })
      await responsePromise

      expect(mockRelayServer.sendChannelResponse).toHaveBeenCalledWith(
        'machine-1',
        expect.any(String),
        expect.objectContaining({
          text: 'Here is the answer',
          channelId: 'oc-channel-1',
          threadId: 'thread-42',
        }),
      )
    })
  })

  // ─── Approval Routing ─────────────────────────────────────────

  describe('requestApproval', () => {
    beforeEach(async () => {
      await adapter.start()
    })

    it('should send approval request via relay and resolve on response', async () => {
      const approvalPromise = adapter.requestApproval({
        approvalId: 'approval-1',
        projectId: 'project-abc',
        taskId: 'task-123',
        question: 'Deploy to **production**?',
        options: ['Yes', 'No'],
      })

      await tick()

      expect(mockRelayServer.sendChannelApprovalRequest).toHaveBeenCalledWith(
        'machine-1',
        expect.any(String),
        expect.objectContaining({
          approvalId: 'approval-1',
          question: 'Deploy to production?',
          options: ['Yes', 'No'],
        }),
      )

      // Simulate user responding
      mockRelayServer.emit('channel:approval_response', {
        correlationId: mockRelayServer.sendChannelApprovalRequest.mock.calls[0][1],
        approvalId: 'approval-1',
        response: 'Yes',
      })

      const result = await approvalPromise
      expect(result).toBe('Yes')
    })

    it('should reject when no OpenClaw machine available', async () => {
      mockRelayServer.findOpenClawMachine.mockReturnValue(null)

      await expect(
        adapter.requestApproval({
          approvalId: 'approval-2',
          projectId: 'project-abc',
          taskId: 'task-456',
          question: 'Approve?',
        }),
      ).rejects.toThrow('No OpenClaw machine available')
    })

    it('should reject pending approvals on stop', async () => {
      const approvalPromise = adapter.requestApproval({
        approvalId: 'approval-timeout',
        projectId: 'project-abc',
        taskId: 'task-789',
        question: 'Approve?',
      })

      await tick()
      adapter.stop()

      await expect(approvalPromise).rejects.toThrow('OpenClaw adapter stopped')
    })
  })

  // ─── Inbound Messages ──────────────────────────────────────────

  describe('inbound messages', () => {
    it('should route inbound messages from relay to channel router', async () => {
      const { channelRouter } = await import('../../channel-router.js')
      await adapter.start()

      // Simulate an inbound message from an agent runner
      mockRelayServer.emit('channel:inbound', {
        sourceMessageId: 'msg-1',
        text: 'Hello from OpenClaw',
        senderId: 'user-1',
        senderName: 'Alice',
        channelId: 'oc-channel-1',
      })

      await tick()

      expect(channelRouter.routeMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'openclaw',
          text: 'Hello from OpenClaw',
          sender: { id: 'user-1', name: 'Alice' },
        }),
      )
    })
  })
})
