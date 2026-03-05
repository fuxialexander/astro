/**
 * Tests for OpenClaw Execution Dispatcher
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────
// vi.hoisted ensures these are available when vi.mock factory runs

const mocks = vi.hoisted(() => ({
  sendRequest: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  isConnected: true,
  relayEmit: vi.fn(),
}))

vi.mock('../../channel/adapters/openclaw-channel.js', () => ({
  openClawChannel: {
    get isConnected() { return mocks.isConnected },
    sendRequest: mocks.sendRequest,
    on: mocks.on,
    off: mocks.off,
    emit: mocks.emit,
  },
}))

vi.mock('../../relay-server.js', () => ({
  relayServer: {
    emit: mocks.relayEmit,
  },
}))

vi.mock('../../machine-registry.js', () => ({
  machineRegistry: {
    registerSimulated: vi.fn(),
    disconnect: vi.fn(),
  },
}))

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  dispatchViaOpenClaw,
  isOpenClawAvailable,
  OPENCLAW_MACHINE_ID,
} from '../openclaw-dispatcher.js'
import type { TaskDispatch } from '../../../types/relay.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides?: Partial<TaskDispatch>): TaskDispatch {
  return {
    taskId: 'test-task-1',
    projectId: 'proj-1',
    nodeId: 'node-1',
    title: 'Test Task',
    description: 'Do the thing',
    prompt: 'Execute the task',
    ...overrides,
  } as TaskDispatch
}

function getGatewayHandler(): (frame: unknown) => void {
  const call = mocks.on.mock.calls.find((c: unknown[]) => c[0] === 'gateway-event')
  if (!call) throw new Error('gateway-event handler not registered')
  return call[1] as (frame: unknown) => void
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OpenClaw Execution Dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isConnected = true
    mocks.sendRequest.mockResolvedValue({})
  })

  describe('isOpenClawAvailable', () => {
    it('should return true when adapter is connected', () => {
      mocks.isConnected = true
      expect(isOpenClawAvailable()).toBe(true)
    })

    it('should return false when adapter is not connected', () => {
      mocks.isConnected = false
      expect(isOpenClawAvailable()).toBe(false)
    })
  })

  describe('OPENCLAW_MACHINE_ID', () => {
    it('should be a constant string', () => {
      expect(OPENCLAW_MACHINE_ID).toBe('openclaw-gateway')
    })
  })

  describe('dispatchViaOpenClaw', () => {
    it('should return false when gateway is not connected', async () => {
      mocks.isConnected = false
      const result = await dispatchViaOpenClaw(makeTask())
      expect(result).toBe(false)
      expect(mocks.sendRequest).not.toHaveBeenCalled()
    })

    it('should send task.dispatch request to gateway', async () => {
      const result = await dispatchViaOpenClaw(makeTask())
      expect(result).toBe(true)
      expect(mocks.sendRequest).toHaveBeenCalledWith('task.dispatch', expect.objectContaining({
        taskId: 'test-task-1',
        projectId: 'proj-1',
        nodeId: 'node-1',
        prompt: 'Execute the task',
        provider: 'openclaw',
      }))
    })

    it('should register gateway-event and disconnected listeners', async () => {
      await dispatchViaOpenClaw(makeTask())
      expect(mocks.on).toHaveBeenCalledWith('gateway-event', expect.any(Function))
      expect(mocks.on).toHaveBeenCalledWith('disconnected', expect.any(Function))
    })

    it('should build prompt from parts when no prompt provided', async () => {
      await dispatchViaOpenClaw(makeTask({
        prompt: undefined,
        visionDoc: 'Vision doc content',
        title: 'My Task',
        description: 'Task description',
        dependencies: ['Dep output 1'],
      }))

      const params = mocks.sendRequest.mock.calls[0][1]
      expect(params.prompt).toContain('Vision doc content')
      expect(params.prompt).toContain('My Task')
      expect(params.prompt).toContain('Dep output 1')
    })

    it('should forward optional fields when present', async () => {
      await dispatchViaOpenClaw(makeTask({
        systemPrompt: 'System prompt',
        deliveryMode: 'pr',
        model: 'claude-opus-4-20250514',
        maxTurns: 50,
      }))

      expect(mocks.sendRequest).toHaveBeenCalledWith('task.dispatch', expect.objectContaining({
        systemPrompt: 'System prompt',
        deliveryMode: 'pr',
        model: 'claude-opus-4-20250514',
        maxTurns: 50,
      }))
    })

    it('should return false and clean up on sendRequest failure', async () => {
      mocks.sendRequest.mockRejectedValue(new Error('Gateway error'))
      const result = await dispatchViaOpenClaw(makeTask())
      expect(result).toBe(false)
      expect(mocks.off).toHaveBeenCalledWith('gateway-event', expect.any(Function))
      expect(mocks.off).toHaveBeenCalledWith('disconnected', expect.any(Function))
    })

    it('should translate task.text events to relay format', async () => {
      await dispatchViaOpenClaw(makeTask())
      const handler = getGatewayHandler()
      handler({ type: 'event', event: 'task.text', payload: { taskId: 'test-task-1', text: 'Hello' } })
      expect(mocks.relayEmit).toHaveBeenCalledWith('task:text', { taskId: 'test-task-1', text: 'Hello' })
    })

    it('should translate task.tool_use events', async () => {
      await dispatchViaOpenClaw(makeTask())
      const handler = getGatewayHandler()
      handler({ type: 'event', event: 'task.tool_use', payload: { taskId: 'test-task-1', toolName: 'Read', toolInput: { path: '/foo' } } })
      expect(mocks.relayEmit).toHaveBeenCalledWith('task:tool_trace', {
        taskId: 'test-task-1', toolName: 'Read', toolInput: { path: '/foo' },
      })
    })

    it('should translate task.tool_result events', async () => {
      await dispatchViaOpenClaw(makeTask())
      const handler = getGatewayHandler()
      handler({ type: 'event', event: 'task.tool_result', payload: { taskId: 'test-task-1', toolName: 'Read', result: 'file contents', success: true } })
      expect(mocks.relayEmit).toHaveBeenCalledWith('task:tool_trace', {
        taskId: 'test-task-1', toolName: 'Read', toolResult: 'file contents', success: true,
      })
    })

    it('should translate task.result events and clean up listener', async () => {
      await dispatchViaOpenClaw(makeTask())
      const handler = getGatewayHandler()
      handler({ type: 'event', event: 'task.result', payload: { taskId: 'test-task-1', status: 'completed', output: 'Done', branchName: 'feat/x' } })

      expect(mocks.relayEmit).toHaveBeenCalledWith('task:result', {
        taskId: 'test-task-1',
        result: expect.objectContaining({ status: 'completed', output: 'Done', branchName: 'feat/x' }),
      })
      expect(mocks.off).toHaveBeenCalledWith('gateway-event', handler)
    })

    it('should translate task.error events to result with error status', async () => {
      await dispatchViaOpenClaw(makeTask())
      const handler = getGatewayHandler()
      handler({ type: 'event', event: 'task.error', payload: { taskId: 'test-task-1', error: 'Broke' } })

      expect(mocks.relayEmit).toHaveBeenCalledWith('task:result', {
        taskId: 'test-task-1',
        result: expect.objectContaining({ status: 'error', error: 'Broke' }),
      })
    })

    it('should ignore events for other tasks', async () => {
      await dispatchViaOpenClaw(makeTask())
      const handler = getGatewayHandler()
      handler({ type: 'event', event: 'task.text', payload: { taskId: 'other-task', text: 'Not for us' } })
      expect(mocks.relayEmit).not.toHaveBeenCalled()
    })

    it('should emit machine:disconnected on adapter disconnect', async () => {
      await dispatchViaOpenClaw(makeTask())
      const disconnectHandler = mocks.on.mock.calls.find((c: unknown[]) => c[0] === 'disconnected')![1]
      disconnectHandler()
      expect(mocks.relayEmit).toHaveBeenCalledWith('machine:disconnected', OPENCLAW_MACHINE_ID)
    })

    it('should translate task.file_change events', async () => {
      await dispatchViaOpenClaw(makeTask())
      const handler = getGatewayHandler()
      handler({ type: 'event', event: 'task.file_change', payload: { taskId: 'test-task-1', path: '/src/app.ts', action: 'modified', linesAdded: 10, linesRemoved: 3 } })

      expect(mocks.relayEmit).toHaveBeenCalledWith('task:file_change', {
        taskId: 'test-task-1', path: '/src/app.ts', action: 'modified', linesAdded: 10, linesRemoved: 3,
      })
    })

    it('should translate task.session_init events', async () => {
      await dispatchViaOpenClaw(makeTask())
      const handler = getGatewayHandler()
      handler({ type: 'event', event: 'task.session_init', payload: { taskId: 'test-task-1', sessionId: 'sess-1', model: 'claude-opus-4' } })

      expect(mocks.relayEmit).toHaveBeenCalledWith('task:session_init', {
        taskId: 'test-task-1', sessionId: 'sess-1', model: 'claude-opus-4',
      })
    })

    it('should translate task.progress events', async () => {
      await dispatchViaOpenClaw(makeTask())
      const handler = getGatewayHandler()
      handler({ type: 'event', event: 'task.progress', payload: { taskId: 'test-task-1', message: 'Working...', progress: 50 } })

      expect(mocks.relayEmit).toHaveBeenCalledWith('task:progress', {
        taskId: 'test-task-1', message: 'Working...', progress: 50,
      })
    })

    it('should translate task.approval_request events', async () => {
      await dispatchViaOpenClaw(makeTask())
      const handler = getGatewayHandler()
      handler({ type: 'event', event: 'task.approval_request', payload: { taskId: 'test-task-1', requestId: 'req-1', question: 'Proceed?', options: ['yes', 'no'] } })

      expect(mocks.relayEmit).toHaveBeenCalledWith('task:approval_request', {
        taskId: 'test-task-1', requestId: 'req-1', question: 'Proceed?', options: ['yes', 'no'], machineId: OPENCLAW_MACHINE_ID,
      })
    })
  })
})
