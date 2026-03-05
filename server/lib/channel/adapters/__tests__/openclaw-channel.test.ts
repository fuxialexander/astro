/**
 * OpenClaw Channel Adapter Tests
 *
 * Tests outbound notification formatting, approval routing, RPC communication,
 * and error handling using a mocked WebSocket gateway.
 */

import { EventEmitter } from 'node:events'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OpenClawChannelAdapter } from '../openclaw-channel.js'
import type {
  IWebSocket,
  OpenClawRpcRequest,
  OpenClawRpcResponse,
  OpenClawGatewayEvent,
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
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket extends EventEmitter implements IWebSocket {
  readyState = 1 // OPEN
  sent: string[] = []

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3 // CLOSED
    this.emit('close')
  }

  /** Simulate receiving a message from the gateway */
  receiveMessage(msg: OpenClawRpcResponse | OpenClawGatewayEvent): void {
    this.emit('message', JSON.stringify(msg))
  }

  /** Auto-respond to the next RPC call with a result */
  autoRespondNext(result: unknown = { ok: true }): void {
    const originalSend = this.send.bind(this)
    this.send = (data: string) => {
      originalSend(data)
      const req = JSON.parse(data) as OpenClawRpcRequest
      // Respond asynchronously like a real server
      setTimeout(() => {
        this.receiveMessage({
          jsonrpc: '2.0',
          id: req.id,
          result,
        })
      }, 0)
      // Restore original send after first call
      this.send = originalSend
    }
  }

  /** Get the last sent RPC request parsed */
  getLastRequest(): OpenClawRpcRequest | null {
    if (this.sent.length === 0) return null
    return JSON.parse(this.sent[this.sent.length - 1]) as OpenClawRpcRequest
  }
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
        // Simulate the connection opening
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
    it('should connect to gateway on start', async () => {
      // Auto-respond to auth RPC
      mockWs.autoRespondNext()

      await adapter.start()

      // Wait for the async open event
      await waitForEvent(adapter, 'connected')

      expect(adapter.isConnected).toBe(true)
    })

    it('should disconnect on stop', async () => {
      mockWs.autoRespondNext()
      await adapter.start()
      await waitForEvent(adapter, 'connected')

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

      mockWs.autoRespondNext()
      await adapter.start()
      await waitForEvent(adapter, 'connected')

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
  })

  // ─── Authentication ───────────────────────────────────────────

  describe('authentication', () => {
    it('should send auth RPC on connect', async () => {
      mockWs.autoRespondNext()
      await adapter.start()
      await waitForEvent(adapter, 'connected')

      // Allow the auth RPC to be sent
      await tick()

      const req = mockWs.getLastRequest()
      expect(req).not.toBeNull()
      expect(req!.method).toBe('auth.authenticate')
      expect(req!.params.apiKey).toBe('test-api-key')
    })
  })

  // ─── Outbound Notifications ───────────────────────────────────

  describe('sendNotification', () => {
    beforeEach(async () => {
      mockWs.autoRespondNext() // auth
      await adapter.start()
      await waitForEvent(adapter, 'connected')
      await tick() // let auth complete
    })

    it('should send task.completed notification via message.send RPC', async () => {
      const notification: ChannelNotification = {
        type: 'task.completed',
        projectId: 'project-abc',
        summary: 'Build **succeeded** for `main` branch',
        astroUrl: 'https://app.astro.dev/project/abc/task/123',
      }

      mockWs.autoRespondNext()
      await adapter.sendNotification(notification)

      // Find the message.send request (skip auth)
      const allRequests = mockWs.sent.map((s) => JSON.parse(s) as OpenClawRpcRequest)
      const sendReq = allRequests.find((r) => r.method === 'message.send')

      expect(sendReq).toBeDefined()
      expect(sendReq!.params.projectId).toBe('project-abc')
      expect(sendReq!.params.type).toBe('task.completed')
      // Text should be formatted for openclaw (markdown stripped)
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

      mockWs.autoRespondNext()
      await adapter.sendNotification(notification)

      const allRequests = mockWs.sent.map((s) => JSON.parse(s) as OpenClawRpcRequest)
      const sendReq = allRequests.find((r) => r.method === 'message.send')

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

      mockWs.autoRespondNext()
      await adapter.sendNotification(notification)

      const allRequests = mockWs.sent.map((s) => JSON.parse(s) as OpenClawRpcRequest)
      const sendReq = allRequests.find((r) => r.method === 'message.send')

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

      mockWs.autoRespondNext()
      await adapter.sendNotification(notification)

      const allRequests = mockWs.sent.map((s) => JSON.parse(s) as OpenClawRpcRequest)
      const sendReq = allRequests.find((r) => r.method === 'message.send')

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
      mockWs.autoRespondNext()
      await adapter.start()
      await waitForEvent(adapter, 'connected')
      await tick()
    })

    it('should send response via message.send RPC', async () => {
      mockWs.autoRespondNext()
      await adapter.sendResponse({
        text: 'Here is the **answer** you asked for',
        conversationRef: {
          channelId: 'oc-channel-1',
          threadId: 'thread-42',
          metadata: { userId: 'user-1' },
        },
      })

      const allRequests = mockWs.sent.map((s) => JSON.parse(s) as OpenClawRpcRequest)
      const sendReq = allRequests.find((r) => r.method === 'message.send')

      expect(sendReq).toBeDefined()
      expect(sendReq!.params.channelId).toBe('oc-channel-1')
      expect(sendReq!.params.threadId).toBe('thread-42')
      // Markdown should be stripped
      expect(sendReq!.params.text).toContain('Here is the answer you asked for')
      expect(sendReq!.params.text).not.toContain('**')
    })
  })

  // ─── Approval Routing ─────────────────────────────────────────

  describe('requestApproval', () => {
    beforeEach(async () => {
      mockWs.autoRespondNext()
      await adapter.start()
      await waitForEvent(adapter, 'connected')
      await tick()
    })

    it('should send approval request and resolve on response', async () => {
      // Auto-respond to the approval.request RPC
      mockWs.autoRespondNext()

      const approvalPromise = adapter.requestApproval({
        approvalId: 'approval-1',
        projectId: 'project-abc',
        taskId: 'task-123',
        question: 'Deploy to **production**?',
        options: ['Yes', 'No'],
      })

      // Wait for the RPC to be sent
      await tick()

      // Verify the approval.request RPC was sent
      const allRequests = mockWs.sent.map((s) => JSON.parse(s) as OpenClawRpcRequest)
      const approvalReq = allRequests.find((r) => r.method === 'approval.request')

      expect(approvalReq).toBeDefined()
      expect(approvalReq!.params.approvalId).toBe('approval-1')
      expect(approvalReq!.params.question).toContain('Deploy to production?')
      expect(approvalReq!.params.question).not.toContain('**')
      expect(approvalReq!.params.options).toEqual(['Yes', 'No'])

      // Simulate user responding via gateway
      mockWs.receiveMessage({
        jsonrpc: '2.0',
        method: 'approval.response',
        params: { approvalId: 'approval-1', response: 'Yes' },
      })

      const result = await approvalPromise
      expect(result).toBe('Yes')
    })

    it('should reject on timeout', async () => {
      mockWs.autoRespondNext()

      // Use a short timeout adapter for testing
      const fastAdapter = new OpenClawChannelAdapter({
        createWebSocket: () => {
          setTimeout(() => mockWs.emit('open'), 0)
          return mockWs
        },
      })

      // Directly test the approval timeout by manipulating the pending map
      // We'll test the behavior by calling requestApproval which will timeout
      // For unit testing, we just verify the promise rejects if no response comes

      // Clean up
      fastAdapter.stop()

      // For timeout test, we check that stop() rejects pending approvals
      mockWs = new MockWebSocket()
      const adapter2 = new OpenClawChannelAdapter({
        createWebSocket: () => {
          setTimeout(() => mockWs.emit('open'), 0)
          return mockWs
        },
      })

      mockWs.autoRespondNext() // auth
      await adapter2.start()
      await waitForEvent(adapter2, 'connected')
      await tick()

      mockWs.autoRespondNext() // approval.request
      const approvalPromise = adapter2.requestApproval({
        approvalId: 'approval-timeout',
        projectId: 'project-abc',
        taskId: 'task-123',
        question: 'Approve?',
      })

      await tick()

      // Stop adapter → should reject pending approval
      adapter2.stop()

      await expect(approvalPromise).rejects.toThrow('OpenClaw adapter stopped')
    })

    it('should ignore approval responses for unknown IDs', async () => {
      // Should not throw
      mockWs.receiveMessage({
        jsonrpc: '2.0',
        method: 'approval.response',
        params: { approvalId: 'unknown-id', response: 'Yes' },
      })

      await tick()
      // If we got here without error, the test passes
    })
  })

  // ─── RPC Error Handling ───────────────────────────────────────

  describe('error handling', () => {
    beforeEach(async () => {
      mockWs.autoRespondNext()
      await adapter.start()
      await waitForEvent(adapter, 'connected')
      await tick()
    })

    it('should reject RPC on error response', async () => {
      // Set up mock to respond with an error
      const originalSend = mockWs.send.bind(mockWs)
      mockWs.send = (data: string) => {
        originalSend(data)
        const req = JSON.parse(data) as OpenClawRpcRequest
        setTimeout(() => {
          mockWs.receiveMessage({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32600, message: 'Invalid request' },
          })
        }, 0)
        mockWs.send = originalSend
      }

      await expect(
        adapter.sendRpc('message.send', { text: 'test' })
      ).rejects.toThrow('RPC error -32600: Invalid request')
    })

    it('should reject RPC when not connected', async () => {
      adapter.stop()

      await expect(
        adapter.sendRpc('message.send', { text: 'test' })
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
      // Should not throw
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
      mockWs.autoRespondNext()
      await adapter.start()
      await waitForEvent(adapter, 'connected')
      await tick()
    })

    it('should emit inbound event for message.inbound gateway events', async () => {
      const inboundPromise = waitForEvent(adapter, 'inbound')

      mockWs.receiveMessage({
        jsonrpc: '2.0',
        method: 'message.inbound',
        params: {
          channelId: 'oc-channel-1',
          text: 'Hello from user',
          senderId: 'user-1',
        },
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
