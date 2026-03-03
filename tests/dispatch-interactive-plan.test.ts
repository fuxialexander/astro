/**
 * Tests for interactive plan dispatch payload construction.
 *
 * Verifies that isInteractivePlan correctly overrides deliveryMode and useWorktree
 * to prevent unwanted PR creation during plan chat sessions.
 *
 * This is a regression test for the fix in PR #363.
 *
 * Background: The dispatch route (server/routes/dispatch.ts:856) spreads overrides
 * when isInteractivePlan is true. This test verifies that the overrides are applied
 * correctly by mocking relayServer.dispatchTask and inspecting the payload.
 */

// Mock relay server and machine registry BEFORE imports to capture dispatch calls
import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'

// Create mock dispatchTask function
const mockDispatchTask = vi.fn()

// Mock the relay server module
vi.mock('../server/lib/relay-server.js', () => {
  // Create a minimal EventEmitter-like object
  type Listener = (...args: unknown[]) => void
  const createMockRelayServer = () => {
    const listeners = new Map<string, Set<Listener>>()
    return {
      dispatchTask: (...args: unknown[]) => mockDispatchTask(...args),
      on: vi.fn((event: string, handler: Listener) => {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event)!.add(handler)
      }),
      off: vi.fn((event: string, handler: Listener) => {
        listeners.get(event)?.delete(handler)
      }),
      emit: vi.fn((event: string, ...args: unknown[]) => {
        const handlers = listeners.get(event)
        if (handlers) handlers.forEach(h => h(...args))
      }),
    }
  }

  return {
    relayServer: createMockRelayServer(),
  }
})

// Mock the machine registry to return a fake machine so dispatch doesn't 400
vi.mock('../server/lib/machine-registry.js', () => {
  const fakeMachine = {
    machineId: 'test-machine-001',
    connectionStatus: 'connected',
    providers: [{ type: 'claude-code', status: 'available', currentTasks: 0, maxConcurrentTasks: 1 }],
    load: { cpuPercent: 0, activeTasks: 0 },
    userId: '00000000-0000-0000-0000-000000000001',
  }

  return {
    machineRegistry: {
      findBestMachine: vi.fn(() => fakeMachine),
      get: vi.fn(() => fakeMachine),
      register: vi.fn(),
      unregister: vi.fn(),
      getAll: vi.fn(() => [fakeMachine]),
    },
  }
})

import { setupTestServer, postJson, db } from './helpers/test-server.js'
import { projects } from '../server/lib/db/schema.js'

beforeAll(async () => {
  await setupTestServer()
})

beforeEach(() => {
  mockDispatchTask.mockClear()
  // Mock to return true (task dispatched successfully)
  mockDispatchTask.mockReturnValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Interactive plan dispatch overrides', { timeout: 30_000 }, () => {
  let projectId: string

  beforeEach(async () => {
    // Clean slate
    await db.delete(projects)

    // Create project for dispatch tests
    const res = await postJson('/api/data/projects', {
      name: 'Interactive Plan Test Project',
      description: 'Testing interactive plan dispatch overrides',
      source: { localPath: '/tmp/test-interactive-plan' },
    })
    const body = await res.json()
    projectId = body.id
  })

  const getBaseBody = () => ({
    nodeId: 'plan-test-1',
    projectId,
    title: 'Interactive plan session',
    description: 'Test interactive planning',
    workingDirectory: '/tmp/test-interactive-plan',
  })

  it('isInteractivePlan overrides deliveryMode and useWorktree', async () => {
    // Post with isInteractivePlan=true and conflicting values that should be overridden
    const res = await postJson('/api/dispatch/task', {
      ...getBaseBody(),
      isInteractivePlan: true,
      deliveryMode: 'pr', // Should be overridden to 'direct'
      useWorktree: true, // Should be overridden to false
      dryRun: false, // Don't use dryRun so we trigger the actual dispatch
    })

    expect(res.status).toBe(200)

    // Verify relayServer.dispatchTask was called
    expect(mockDispatchTask).toHaveBeenCalledTimes(1)

    // Extract the task payload (first argument)
    const taskPayload = mockDispatchTask.mock.calls[0][0]

    // Verify the overrides were applied
    expect(taskPayload.type).toBe('plan')
    expect(taskPayload.useWorktree).toBe(false)
    expect(taskPayload.deliveryMode).toBe('direct')
  })

  it('isInteractivePlan overrides default deliveryMode', async () => {
    // Post with isInteractivePlan=true without specifying deliveryMode
    // Default is 'pr' (line 847), should be overridden to 'direct'
    const res = await postJson('/api/dispatch/task', {
      ...getBaseBody(),
      isInteractivePlan: true,
      dryRun: false,
    })

    expect(res.status).toBe(200)
    expect(mockDispatchTask).toHaveBeenCalledTimes(1)

    const taskPayload = mockDispatchTask.mock.calls[0][0]
    expect(taskPayload.deliveryMode).toBe('direct')
    expect(taskPayload.useWorktree).toBe(false)
    expect(taskPayload.type).toBe('plan')
  })

  it('non-interactive dispatch respects explicit deliveryMode', async () => {
    // Verify that without isInteractivePlan, deliveryMode is not overridden
    const res = await postJson('/api/dispatch/task', {
      ...getBaseBody(),
      isInteractivePlan: false,
      deliveryMode: 'pr',
      dryRun: false,
    })

    expect(res.status).toBe(200)
    expect(mockDispatchTask).toHaveBeenCalledTimes(1)

    const taskPayload = mockDispatchTask.mock.calls[0][0]
    expect(taskPayload.deliveryMode).toBe('pr')
    expect(taskPayload.type).toBeUndefined() // Should not have type='plan'
  })

  it('validates dryRun still works with isInteractivePlan', async () => {
    // Verify dryRun short-circuits before dispatch
    const res = await postJson('/api/dispatch/task', {
      ...getBaseBody(),
      isInteractivePlan: true,
      dryRun: true,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.dryRun).toBe(true)

    // relayServer.dispatchTask should NOT be called with dryRun
    expect(mockDispatchTask).not.toHaveBeenCalled()
  })
})
