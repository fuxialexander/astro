/**
 * OpenClaw Channel Adapter Tests
 *
 * Tests outbound notification formatting, approval routing, request/response
 * communication, and the challenge-response handshake using a mocked WebSocket gateway.
 */

import { EventEmitter } from 'node:events'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OpenClawChannelAdapter } from '../openclaw-channel.js'
import type {
  IWebSocket,
  OpenClawRequestFrame,
  OpenClawResponseFrame,
  OpenClawEventFrame,
} from '../openclaw-channel.js'
import type { ChannelNotification } from '../../channel-types.js'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('../../channel-config-manager.js', () => ({
  channelConfigManager: {
    getConfigsForChannel: vi.fn().mockResolvedValue([
      {
        userId: 'env',
        accountId: 'env-openclaw',
        channel: 'openclaw',
        credentials: {
          gatewayUrl: 'ws://localhost:4000',
          apiKey: 'test-api-key',
        },
        mappings: { 'oc-channel-1': 'project-abc' },
        settings: {},
      },
    ]),
  },
}))

vi.mock('../../channel-router.js', () => ({
  channelRouter: {
    registerNotificationSender: vi.fn(),
    registerResponseSender: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Mock WebSocket — simulates the OpenClaw gateway protocol
// ---------------------------------------------------------------------------

class MockWebSocket extends EventEmitter implements IWebSocket {
  readyState = 1 // OPEN
  sent: string[] = []

  send(data: string): void {
    this._baseSend(data)
  }

  close(): void {
    this.readyState = 3 // CLOSED
    this.emit('close')
  }

  /** Send a connect.challenge event to start the handshake */
  sendChallenge(nonce = 'test-nonce-123'): void {
    const frame: OpenClawEventFrame = {
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce },
    }
    this.emit('message', JSON.stringify(frame))
  }

  /** Send an event frame to the adapter */
  sendEvent(event: string, payload: Record<string, unknown>): void {
    const frame: OpenClawEventFrame = {
      type: 'event',
      event,
      payload,
    }
    this.emit('message', JSON.stringify(frame))
  }

  /** Send a response frame to the adapter */
  sendResponse(id: string, ok: boolean, payloadOrError?: Record<string, unknown>): void {
    const frame: OpenClawResponseFrame = ok
      ? { type: 'res', id, ok: true, payload: payloadOrError ?? {} }
      : { type: 'res', id, ok: false, error: { code: -1, message: (payloadOrError as { message?: string })?.message ?? 'error', ...(payloadOrError ?? {}) } }
    this.emit('message', JSON.stringify(frame))
  }

  /** Auto-respond to requests with a successful response */
  autoRespondToRequests(): void {
    this._autoRespond = true
  }

  /** Stop auto-responding to requests */
  stopAutoRespond(): void {
    this._autoRespond = false
  }

  private _autoRespond = false
  private _baseSend(data: string): void {
    this.sent.push(data)
    if (this._autoRespond) {
      const parsed = JSON.parse(data)
      if (parsed.type === 'req') {
        setTimeout(() => {
          this.sendResponse(parsed.id, true, { ok: true })
        }, 0)
      }
    }
  }

  /** Get the last sent request frame parsed */
  getLastRequest(): OpenClawRequestFrame | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const parsed = JSON.parse(this.sent[i])
      if (parsed.type === 'req') return parsed as OpenClawRequestFrame
    }
    return null
  }

  /** Get all sent request frames */
  getAllRequests(): OpenClawRequestFrame[] {
    return this.sent
      .map((s) => JSON.parse(s))
      .filter((f: { type: string }) => f.type === 'req') as OpenClawRequestFrame[]
  }
}

// ---------------------------------------------------------------------------
// Helper: start adapter with full handshake
// ---------------------------------------------------------------------------

async function startWithHandshake(
  adapter: OpenClawChannelAdapter,
  mockWs: MockWebSocket
): Promise<void> {
  // Auto-respond to the connect request
  mockWs.autoRespondToRequests()

  await adapter.start()

  // Gateway sends challenge after WS opens
  await tick()
  mockWs.sendChallenge()

  // Wait for the adapter to complete the handshake
  await waitForEvent(adapter, 'connected')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenClawChannelAdapter', () => {
  let adapter: OpenClawChannelAdapter
  let mockWs: MockWebSocket

  beforeEach(() => {
    mockWs = new MockWebSocket()

    adapter = new OpenClawChannelAdapter({
      createWebSocket: () => {
        // Simulate the WS opening
        setTimeout(() => mockWs.emit('open'), 0)
        return mockWs
      },
    })
  })

  afterEach(() => {
    adapter.stop()
  })

  // ─── Lifecycle ────────────────────────────────────────────────

  describe('start/stop', () => {
    it('should connect to gateway on start after challenge-response', async () => {
      await startWithHandshake(adapter, mockWs)
      expect(adapter.isConnected).toBe(true)
    })

    it('should send connect request with protocol v3 and auth token', async () => {
      await startWithHandshake(adapter, mockWs)

      const connectReq = mockWs.getAllRequests().find((r) => r.method === 'connect')
      expect(connectReq).toBeDefined()
      expect(connectReq!.params.minProtocol).toBe(3)
      expect(connectReq!.params.maxProtocol).toBe(3)

      const auth = connectReq!.params.auth as Record<string, unknown>
      expect(auth.token).toBe('test-api-key')

      const client = connectReq!.params.client as Record<string, unknown>
      expect(client.id).toBe('astro')
      expect(client.mode).toBe('backend')
    })

    it('should disconnect on stop', async () => {
      await startWithHandshake(adapter, mockWs)
      adapter.stop()
      expect(adapter.isConnected).toBe(false)
    })

    it('should not start if no config is found', async () => {
      const { channelConfigManager } = await import('../../channel-config-manager.js')
      vi.mocked(channelConfigManager.getConfigsForChannel).mockResolvedValueOnce([])

      const noConfigAdapter = new OpenClawChannelAdapter({
        createWebSocket: () => mockWs,
      })

      await noConfigAdapter.start()
      expect(noConfigAdapter.isConnected).toBe(false)

      noConfigAdapter.stop()
    })

    it('should register notification and response senders on start', async () => {
      const { channelRouter } = await import('../../channel-router.js')

      await startWithHandshake(adapter, mockWs)

      expect(channelRouter.registerNotificationSender).toHaveBeenCalledWith(
        'project-abc',
        'openclaw',
        expect.any(Function)
      )
      expect(channelRouter.registerResponseSender).toHaveBeenCalledWith(
        'openclaw',
        expect.any(Function)
      )
    })

    it('should not be connected before challenge is received', async () => {
      mockWs.autoRespondToRequests()
      await adapter.start()
      await tick()
      // WS is open but no challenge yet → not authenticated
      expect(adapter.isConnected).toBe(false)
    })
  })

  // ─── Outbound Notifications ───────────────────────────────────

  describe('sendNotification', () => {
    beforeEach(async () => {
      await startWithHandshake(adapter, mockWs)
    })

    it('should send task.completed notification via message.send request', async () => {
      const notification: ChannelNotification = {
        type: 'task.completed',
        projectId: 'project-abc',
        summary: 'Build **succeeded** for `main` branch',
        astroUrl: 'https://app.astro.dev/project/abc/task/123',
      }

      mockWs.autoRespondToRequests()
      await adapter.sendNotification(notification)

      const allRequests = mockWs.getAllRequests()
      const sendReq = allRequests.find((r) => r.method === 'message.send')

      expect(sendReq).toBeDefined()
      expect(sendReq!.params.projectId).toBe('project-abc')
      expect(sendReq!.params.type).toBe('task.completed')
      expect(sendReq!.params.text).toContain('[Completed]')
      expect(sendReq!.params.text).toContain('Build succeeded for main branch')
      expect(sendReq!.params.text).not.toContain('**')
      expect(sendReq!.params.text).not.toContain('`')
    })

    it('should send task.failed notification with correct prefix', async () => {
      const notification: ChannelNotification = {
        type: 'task.failed',
        projectId: 'project-abc',
        summary: 'Deployment failed: timeout',
        astroUrl: 'https://app.astro.dev/project/abc/task/456',
      }

      mockWs.autoRespondToRequests()
      await adapter.sendNotification(notification)

      const sendReq = mockWs.getAllRequests().find((r) => r.method === 'message.send')
      expect(sendReq!.params.text).toContain('[Failed]')
      expect(sendReq!.params.text).toContain('Deployment failed: timeout')
    })

    it('should send approval.requested notification with correct prefix', async () => {
      const notification: ChannelNotification = {
        type: 'approval.requested',
        projectId: 'project-abc',
        summary: 'Review needed for production deploy',
        astroUrl: 'https://app.astro.dev/project/abc/task/789',
      }

      mockWs.autoRespondToRequests()
      await adapter.sendNotification(notification)

      const sendReq = mockWs.getAllRequests().find((r) => r.method === 'message.send')
      expect(sendReq!.params.text).toContain('[Approval Needed]')
    })

    it('should include metadata in notification', async () => {
      const notification: ChannelNotification = {
        type: 'task.completed',
        projectId: 'project-abc',
        summary: 'Done',
        astroUrl: 'https://app.astro.dev/x',
        metadata: { taskId: 'task-999' },
      }

      mockWs.autoRespondToRequests()
      await adapter.sendNotification(notification)

      const sendReq = mockWs.getAllRequests().find((r) => r.method === 'message.send')
      expect(sendReq!.params.metadata).toEqual(
        expect.objectContaining({
          astroUrl: 'https://app.astro.dev/x',
          notificationType: 'task.completed',
          taskId: 'task-999',
        })
      )
    })
  })

  // ─── Outbound Responses ───────────────────────────────────────

  describe('sendResponse', () => {
    beforeEach(async () => {
      await startWithHandshake(adapter, mockWs)
    })

    it('should send response via message.send request', async () => {
      mockWs.autoRespondToRequests()
      await adapter.sendResponse({
        text: 'Here is the **answer** you asked for',
        conversationRef: {
          channelId: 'oc-channel-1',
          threadId: 'thread-42',
          metadata: { userId: 'user-1' },
        },
      })

      const sendReq = mockWs.getAllRequests().find((r) => r.method === 'message.send')
      expect(sendReq).toBeDefined()
      expect(sendReq!.params.channelId).toBe('oc-channel-1')
      expect(sendReq!.params.threadId).toBe('thread-42')
      expect(sendReq!.params.text).toContain('Here is the answer you asked for')
      expect(sendReq!.params.text).not.toContain('**')
    })
  })

  // ─── Approval Routing ─────────────────────────────────────────

  describe('requestApproval', () => {
    beforeEach(async () => {
      await startWithHandshake(adapter, mockWs)
    })

    it('should send approval request and resolve on response', async () => {
      mockWs.autoRespondToRequests()

      const approvalPromise = adapter.requestApproval({
        approvalId: 'approval-1',
        projectId: 'project-abc',
        taskId: 'task-123',
        question: 'Deploy to **production**?',
        options: ['Yes', 'No'],
      })

      await tick()

      const approvalReq = mockWs.getAllRequests().find((r) => r.method === 'approval.request')
      expect(approvalReq).toBeDefined()
      expect(approvalReq!.params.approvalId).toBe('approval-1')
      expect(approvalReq!.params.question).toContain('Deploy to production?')
      expect(approvalReq!.params.question).not.toContain('**')
      expect(approvalReq!.params.options).toEqual(['Yes', 'No'])

      // Simulate user responding via gateway event
      mockWs.sendEvent('approval.response', {
        approvalId: 'approval-1',
        response: 'Yes',
      })

      const result = await approvalPromise
      expect(result).toBe('Yes')
    })

    it('should reject on stop (simulating timeout)', async () => {
      mockWs = new MockWebSocket()
      const adapter2 = new OpenClawChannelAdapter({
        createWebSocket: () => {
          setTimeout(() => mockWs.emit('open'), 0)
          return mockWs
        },
      })

      await startWithHandshake(adapter2, mockWs)

      mockWs.autoRespondToRequests()
      const approvalPromise = adapter2.requestApproval({
        approvalId: 'approval-timeout',
        projectId: 'project-abc',
        taskId: 'task-123',
        question: 'Approve?',
      })

      await tick()

      adapter2.stop()

      await expect(approvalPromise).rejects.toThrow('OpenClaw adapter stopped')
    })

    it('should ignore approval responses for unknown IDs', async () => {
      mockWs.sendEvent('approval.response', {
        approvalId: 'unknown-id',
        response: 'Yes',
      })

      await tick()
      // No error thrown
    })
  })

  // ─── Error Handling ───────────────────────────────────────────

  describe('error handling', () => {
    beforeEach(async () => {
      await startWithHandshake(adapter, mockWs)
    })

    it('should reject request on error response', async () => {
      // Stop auto-responding so we can send a custom error
      mockWs.stopAutoRespond()
      mockWs.send = (data: string) => {
        mockWs.sent.push(data)
        const parsed = JSON.parse(data)
        if (parsed.type === 'req') {
          setTimeout(() => {
            mockWs.sendResponse(parsed.id, false, { code: -32600, message: 'Invalid request' })
          }, 0)
        }
      }

      await expect(
        adapter.sendRequest('message.send', { text: 'test' })
      ).rejects.toThrow('Invalid request')
    })

    it('should reject request when not connected', async () => {
      adapter.stop()

      await expect(
        adapter.sendRequest('message.send', { text: 'test' })
      ).rejects.toThrow('OpenClaw gateway not connected')
    })

    it('should reject notification when not connected', async () => {
      adapter.stop()

      await expect(
        adapter.sendNotification({
          type: 'task.completed',
          projectId: 'project-abc',
          summary: 'Done',
          astroUrl: 'https://app.astro.dev/x',
        })
      ).rejects.toThrow('OpenClaw gateway not connected')
    })

    it('should handle non-JSON messages gracefully', async () => {
      mockWs.emit('message', 'not json at all')
      await tick()
    })

    it('should emit error on WebSocket error', async () => {
      const errorPromise = waitForEvent(adapter, 'error')
      mockWs.emit('error', new Error('connection reset'))
      const err = await errorPromise
      expect(err).toBeInstanceOf(Error)
    })
  })

  // ─── Inbound Messages ─────────────────────────────────────────

  describe('inbound messages', () => {
    beforeEach(async () => {
      await startWithHandshake(adapter, mockWs)
    })

    it('should emit inbound event for message.inbound gateway events', async () => {
      const inboundPromise = waitForEvent(adapter, 'inbound')

      mockWs.sendEvent('message.inbound', {
        channelId: 'oc-channel-1',
        text: 'Hello from user',
        senderId: 'user-1',
      })

      const params = await inboundPromise
      expect(params).toEqual({
        channelId: 'oc-channel-1',
        text: 'Hello from user',
        senderId: 'user-1',
      })
    })
  })
})

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

function waitForEvent(emitter: EventEmitter, event: string, timeoutMs = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for event "${event}"`))
    }, timeoutMs)

    emitter.once(event, (...args: unknown[]) => {
      clearTimeout(timeout)
      resolve(args[0])
    })
  })
}
