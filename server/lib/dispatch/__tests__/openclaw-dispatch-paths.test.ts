/**
 * OpenClaw Dispatch Path Selection Tests
 *
 * Tests the logic that determines which dispatch path to use:
 * - Path A: relay → agent-runner (when machineId is a regular machine)
 * - Path B: direct gateway (when machineId is OPENCLAW_MACHINE_ID and gateway is connected)
 *
 * Also tests the end-to-end event flow: gateway frame → relay event emission → SSE-compatible shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendRequest: vi.fn(),
  adapterOn: vi.fn(),
  adapterOff: vi.fn(),
  adapterEmit: vi.fn(),
  isConnected: true,
  relayEmit: vi.fn(),
  relayDispatchTask: vi.fn(),
  registerSimulated: vi.fn(),
  disconnect: vi.fn(),
}))

vi.mock('../../channel/adapters/openclaw-channel.js', () => ({
  openClawChannel: {
    get isConnected() { return mocks.isConnected },
    sendRequest: mocks.sendRequest,
    on: mocks.adapterOn,
    off: mocks.adapterOff,
    emit: mocks.adapterEmit,
  },
}))

vi.mock('../../relay-server.js', () => ({
  relayServer: {
    emit: mocks.relayEmit,
    dispatchTask: mocks.relayDispatchTask,
  },
}))

vi.mock('../../machine-registry.js', () => ({
  machineRegistry: {
    registerSimulated: mocks.registerSimulated,
    disconnect: mocks.disconnect,
  },
}))

import {
  dispatchViaOpenClaw,
  isOpenClawAvailable,
  OPENCLAW_MACHINE_ID,
} from '../openclaw-dispatcher.js'
import { relayServer } from '../../relay-server.js'
import type { TaskDispatch } from '../../../types/relay.js'

function makeTask(overrides?: Partial<TaskDispatch>): TaskDispatch {
  return {
    taskId: 'task-123',
    projectId: 'proj-1',
    nodeId: 'node-1',
    title: 'Test Task',
    description: 'Do the thing',
    prompt: 'Execute this task',
    ...overrides,
  } as TaskDispatch
}

describe('Dispatch path selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isConnected = true
    mocks.sendRequest.mockResolvedValue({})
    mocks.relayDispatchTask.mockReturnValue(true)
  })

  describe('Path B: direct gateway dispatch', () => {
    it('should be selected when machineId matches OPENCLAW_MACHINE_ID and gateway is connected', async () => {
      const machineId = OPENCLAW_MACHINE_ID
      const task = makeTask()

      // Simulate what the dispatch route does:
      const useOpenClaw = machineId === OPENCLAW_MACHINE_ID && isOpenClawAvailable()
      expect(useOpenClaw).toBe(true)

      const dispatched = await dispatchViaOpenClaw(task)
      expect(dispatched).toBe(true)
      expect(mocks.sendRequest).toHaveBeenCalledWith('task.dispatch', expect.any(Object))
      // Should NOT have called relay dispatch
      expect(mocks.relayDispatchTask).not.toHaveBeenCalled()
    })

    it('should NOT be selected when gateway is disconnected', () => {
      mocks.isConnected = false
      const machineId = OPENCLAW_MACHINE_ID
      const useOpenClaw = machineId === OPENCLAW_MACHINE_ID && isOpenClawAvailable()
      expect(useOpenClaw).toBe(false)
    })
  })

  describe('Path A: relay dispatch (agent-runner)', () => {
    it('should be selected when machineId is a regular machine', () => {
      const machineId = 'my-laptop-abc123'
      const task = makeTask()

      // Simulate what the dispatch route does:
      const useOpenClaw = machineId === OPENCLAW_MACHINE_ID && isOpenClawAvailable()
      expect(useOpenClaw).toBe(false)

      // Would use relayServer.dispatchTask() instead
      const dispatched = relayServer.dispatchTask(task, machineId, 'user-1')
      expect(dispatched).toBe(true)
      expect(mocks.relayDispatchTask).toHaveBeenCalledWith(task, machineId, 'user-1')
      expect(mocks.sendRequest).not.toHaveBeenCalled()
    })
  })

  describe('End-to-end event flow (Path B)', () => {
    it('should translate a full task lifecycle from gateway events to relay events', async () => {
      const task = makeTask()
      await dispatchViaOpenClaw(task)

      const handler = mocks.adapterOn.mock.calls.find((c: unknown[]) => c[0] === 'gateway-event')![1] as (f: unknown) => void

      // 1. session_init
      handler({ type: 'event', event: 'task.session_init', payload: { taskId: 'task-123', sessionId: 's1', model: 'claude-opus-4' } })
      expect(mocks.relayEmit).toHaveBeenCalledWith('task:session_init', { taskId: 'task-123', sessionId: 's1', model: 'claude-opus-4' })

      // 2. text streaming
      handler({ type: 'event', event: 'task.text', payload: { taskId: 'task-123', text: 'Analyzing...' } })
      expect(mocks.relayEmit).toHaveBeenCalledWith('task:text', { taskId: 'task-123', text: 'Analyzing...' })

      // 3. tool_use
      handler({ type: 'event', event: 'task.tool_use', payload: { taskId: 'task-123', toolName: 'Bash', toolInput: { command: 'ls' } } })
      expect(mocks.relayEmit).toHaveBeenCalledWith('task:tool_trace', { taskId: 'task-123', toolName: 'Bash', toolInput: { command: 'ls' } })

      // 4. tool_result
      handler({ type: 'event', event: 'task.tool_result', payload: { taskId: 'task-123', toolName: 'Bash', result: 'file1.ts\nfile2.ts', success: true } })
      expect(mocks.relayEmit).toHaveBeenCalledWith('task:tool_trace', { taskId: 'task-123', toolName: 'Bash', toolResult: 'file1.ts\nfile2.ts', success: true })

      // 5. file_change
      handler({ type: 'event', event: 'task.file_change', payload: { taskId: 'task-123', path: '/src/app.ts', action: 'modified', linesAdded: 5, linesRemoved: 2 } })
      expect(mocks.relayEmit).toHaveBeenCalledWith('task:file_change', { taskId: 'task-123', path: '/src/app.ts', action: 'modified', linesAdded: 5, linesRemoved: 2 })

      // 6. progress
      handler({ type: 'event', event: 'task.progress', payload: { taskId: 'task-123', message: 'Almost done', progress: 90 } })
      expect(mocks.relayEmit).toHaveBeenCalledWith('task:progress', { taskId: 'task-123', message: 'Almost done', progress: 90 })

      // 7. result (final)
      handler({ type: 'event', event: 'task.result', payload: { taskId: 'task-123', status: 'completed', output: 'All done', branchName: 'feat/openclaw' } })
      expect(mocks.relayEmit).toHaveBeenCalledWith('task:result', {
        taskId: 'task-123',
        result: expect.objectContaining({ status: 'completed', output: 'All done', branchName: 'feat/openclaw' }),
      })

      // Verify total: 7 relay emissions for the full lifecycle
      expect(mocks.relayEmit).toHaveBeenCalledTimes(7)
    })

    it('should handle error mid-execution and clean up', async () => {
      await dispatchViaOpenClaw(makeTask())
      const handler = mocks.adapterOn.mock.calls.find((c: unknown[]) => c[0] === 'gateway-event')![1] as (f: unknown) => void

      // Some text first
      handler({ type: 'event', event: 'task.text', payload: { taskId: 'task-123', text: 'Starting...' } })
      // Then error
      handler({ type: 'event', event: 'task.error', payload: { taskId: 'task-123', error: 'Process killed' } })

      expect(mocks.relayEmit).toHaveBeenCalledWith('task:result', {
        taskId: 'task-123',
        result: expect.objectContaining({ status: 'error', error: 'Process killed' }),
      })
      // Should have cleaned up gateway-event listener
      expect(mocks.adapterOff).toHaveBeenCalledWith('gateway-event', handler)
    })
  })
})
