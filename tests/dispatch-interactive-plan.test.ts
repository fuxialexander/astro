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

// Mock relay server BEFORE imports to capture dispatch calls
import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'

// Create mock dispatchTask function
const mockDispatchTask = vi.fn()

// Mock the relay server module
vi.mock('../server/lib/relay-server.js', () => {
  // Create a minimal EventEmitter-like object
  const createMockRelayServer = () => {
    const listeners = new Map<string, Set<Function>>()
    return {
      dispatchTask: (...args: any[]) => mockDispatchTask(...args),
      on: vi.fn((event: string, handler: Function) => {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event)!.add(handler)
      }),
      off: vi.fn((event: string, handler: Function) => {
        listeners.get(event)?.delete(handler)
      }),
      emit: vi.fn((event: string, ...args: any[]) => {
        const handlers = listeners.get(event)
        if (handlers) handlers.forEach(h => h(...args))
      }),
    }
  }

  return {
    relayServer: createMockRelayServer(),
  }
})

// Mock machine registry to return a fake machine for non-dryRun tests
vi.mock('../server/lib/machine-registry.js', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>
  return {
    ...original,
    machineRegistry: {
      findBestMachine: vi.fn(() => ({
        machineId: 'test-machine-001',
        providerId: 'claude-code',
        providerType: 'claude-code',
        status: 'connected',
      })),
      get: vi.fn(() => ({
        machineId: 'test-machine-001',
        providerId: 'claude-code',
        providerType: 'claude-code',
        status: 'connected',
      })),
      getAll: vi.fn(() => []),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    },
  }
})

import { setupTestServer, postJson, db } from './helpers/test-server.js'
import { projects, skills } from '../server/lib/db/schema.js'

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

  it('dispatched task includes skill prompt injection in relay payload', async () => {
    // Seed a test skill directly into DB and sync the skill-manager
    await db.insert(skills).values({
      name: 'test-dispatch-skill',
      version: '1.0.0',
      description: 'Test skill for dispatch injection',
      instructions: 'UNIQUE_SKILL_MARKER: Use this test workflow',
      source: 'builtin',
      enabled: true,
      allowedTools: ['Bash'],
      tags: ['test'],
    })

    // Sync the in-memory skill-manager so dispatch picks up the skill
    const { syncSkillsFromDb } = await import('../server/lib/db/bootstrap-skills.js')
    const { skillManager } = await import('../server/lib/skill-manager.js')
    await syncSkillsFromDb(skillManager)

    const res = await postJson('/api/dispatch/task', {
      ...getBaseBody(),
      isInteractivePlan: false,
      deliveryMode: 'direct',
      dryRun: false,
    })

    expect(res.status).toBe(200)
    expect(mockDispatchTask).toHaveBeenCalledTimes(1)

    const taskPayload = mockDispatchTask.mock.calls[0][0]
    // Skills are injected into the relay `prompt` field (assembled from promptParts)
    // for regular task dispatch, not in `systemPrompt` (which is only set for interactive plans)
    expect(taskPayload.prompt).toContain('UNIQUE_SKILL_MARKER')
    expect(taskPayload.prompt).toContain('test-dispatch-skill')

    // Clean up test skill
    const { eq } = await import('drizzle-orm')
    await db.delete(skills).where(eq(skills.name, 'test-dispatch-skill'))
    await syncSkillsFromDb(skillManager)
  })
})
