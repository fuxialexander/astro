/**
 * Event Transport System Tests
 *
 * Basic verification that the event transport and hooks work correctly.
 */

import { AstroEventTransport } from '../astro-event-transport.js'
import type { AstroEvent, EventHook } from '../types.js'

describe('AstroEventTransport', () => {
  let transport: AstroEventTransport

  beforeEach(() => {
    transport = new AstroEventTransport()
  })

  afterEach(() => {
    transport.removeAllListeners()
  })

  it('should register and list hooks', () => {
    const mockHook: EventHook = async () => {
      // no-op
    }

    transport.registerHook('test-hook', mockHook)
    expect(transport.listHooks()).toEqual(['test-hook'])
  })

  it('should unregister hooks', () => {
    const mockHook: EventHook = async () => {
      // no-op
    }

    transport.registerHook('test-hook', mockHook)
    expect(transport.listHooks()).toEqual(['test-hook'])

    transport.unregisterHook('test-hook')
    expect(transport.listHooks()).toEqual([])
  })

  it('should emit events to hooks', async () => {
    let hookCalled = false
    const mockHook: EventHook = async (event) => {
      hookCalled = true
      expect(event.type).toBe('task.started')
    }

    transport.registerHook('test-hook', mockHook)

    const event: AstroEvent = {
      type: 'task.started',
      taskId: 'test-task',
      nodeId: 'test-node',
      projectId: 'test-project',
      executionId: 'test-exec',
      timestamp: new Date(),
      node: {
        id: 'test-node',
        title: 'Test Task',
        description: 'Test description',
        status: 'planned',
        type: 'task',
        position: { x: 0, y: 0 },
      },
    }

    await transport.emitEvent(event)
    expect(hookCalled).toBe(true)
  })

  it('should isolate hook errors', async () => {
    const errorHook: EventHook = async () => {
      throw new Error('Hook error')
    }

    let normalHookCalled = false
    const normalHook: EventHook = async () => {
      normalHookCalled = true
    }

    transport.registerHook('error-hook', errorHook)
    transport.registerHook('normal-hook', normalHook)

    const event: AstroEvent = {
      type: 'task.started',
      taskId: 'test-task',
      nodeId: 'test-node',
      projectId: 'test-project',
      executionId: 'test-exec',
      timestamp: new Date(),
      node: {
        id: 'test-node',
        title: 'Test Task',
        description: 'Test description',
        status: 'planned',
        type: 'task',
        position: { x: 0, y: 0 },
      },
    }

    // Should not throw despite error in errorHook
    await expect(transport.emitEvent(event)).resolves.not.toThrow()
    expect(normalHookCalled).toBe(true)
  })

  it('should support enable/disable', async () => {
    let hookCalled = false
    const mockHook: EventHook = async () => {
      hookCalled = true
    }

    transport.registerHook('test-hook', mockHook)
    transport.setEnabled(false)

    const event: AstroEvent = {
      type: 'task.started',
      taskId: 'test-task',
      nodeId: 'test-node',
      projectId: 'test-project',
      executionId: 'test-exec',
      timestamp: new Date(),
      node: {
        id: 'test-node',
        title: 'Test Task',
        description: 'Test description',
        status: 'planned',
        type: 'task',
        position: { x: 0, y: 0 },
      },
    }

    await transport.emitEvent(event)
    expect(hookCalled).toBe(false)

    transport.setEnabled(true)
    await transport.emitEvent(event)
    expect(hookCalled).toBe(true)
  })

  it('should provide stats', () => {
    const mockHook: EventHook = async () => {
      // no-op
    }

    transport.registerHook('hook-1', mockHook)
    transport.registerHook('hook-2', mockHook)

    const stats = transport.getStats()
    expect(stats.totalHooks).toBe(2)
    expect(stats.hookNames).toEqual(['hook-1', 'hook-2'])
    expect(stats.enabled).toBe(true)
  })
})
