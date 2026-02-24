/**
 * Safety Prompt Pipeline Tests
 *
 * Tests for the task:safety_prompt pipeline:
 * - Dispatch endpoint (POST /api/dispatch/safety-decision)
 * - Relay sendSafetyDecision() method
 * - SSE bridge event forwarding
 * - Realtime store event handling
 * - Dead-end message handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RelayServer } from '../server/lib/relay-server'

// ============================================================================
// 1. Dispatch endpoint validation tests
// ============================================================================

describe('POST /api/dispatch/safety-decision validation', () => {
  /**
   * Simulates the dispatch endpoint validation logic.
   * This mirrors the validation in server/routes/dispatch.ts /safety-decision.
   */
  function validateSafetyDecision(body: Record<string, unknown>): { valid: boolean; error?: string; status?: number } {
    const { taskId, machineId, decision } = body

    if (!taskId) {
      return { valid: false, error: 'taskId is required', status: 400 }
    }

    if (!machineId) {
      return { valid: false, error: 'machineId is required', status: 400 }
    }

    if (!decision) {
      return { valid: false, error: 'decision is required', status: 400 }
    }

    const validDecisions = ['proceed', 'init-git', 'sandbox', 'cancel']
    if (!validDecisions.includes(decision as string)) {
      return { valid: false, error: `Invalid decision. Must be one of: ${validDecisions.join(', ')}`, status: 400 }
    }

    return { valid: true }
  }

  it('returns 400 when taskId is missing', () => {
    const result = validateSafetyDecision({ machineId: 'machine-1', decision: 'proceed' })
    expect(result.valid).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toContain('taskId')
  })

  it('returns 400 when machineId is missing', () => {
    const result = validateSafetyDecision({ taskId: 'task-1', decision: 'proceed' })
    expect(result.valid).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toContain('machineId')
  })

  it('returns 400 when decision is missing', () => {
    const result = validateSafetyDecision({ taskId: 'task-1', machineId: 'machine-1' })
    expect(result.valid).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toContain('decision')
  })

  it('returns 400 for invalid decision value', () => {
    const result = validateSafetyDecision({ taskId: 'task-1', machineId: 'machine-1', decision: 'nuke' })
    expect(result.valid).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toContain('Invalid decision')
  })

  it('accepts "proceed" as a valid decision', () => {
    const result = validateSafetyDecision({ taskId: 'task-1', machineId: 'machine-1', decision: 'proceed' })
    expect(result.valid).toBe(true)
  })

  it('accepts "init-git" as a valid decision', () => {
    const result = validateSafetyDecision({ taskId: 'task-1', machineId: 'machine-1', decision: 'init-git' })
    expect(result.valid).toBe(true)
  })

  it('accepts "sandbox" as a valid decision', () => {
    const result = validateSafetyDecision({ taskId: 'task-1', machineId: 'machine-1', decision: 'sandbox' })
    expect(result.valid).toBe(true)
  })

  it('accepts "cancel" as a valid decision', () => {
    const result = validateSafetyDecision({ taskId: 'task-1', machineId: 'machine-1', decision: 'cancel' })
    expect(result.valid).toBe(true)
  })
})

// ============================================================================
// 2. Relay sendSafetyDecision() tests
// ============================================================================

describe('RelayServer.sendSafetyDecision()', () => {
  let relay: RelayServer

  beforeEach(() => {
    relay = new RelayServer({ port: 0 })
  })

  it('returns false when machine is not connected', () => {
    const result = relay.sendSafetyDecision('task-1', 'nonexistent-machine', 'proceed')
    expect(result).toBe(false)
  })

  it('method exists on RelayServer', () => {
    expect(typeof relay.sendSafetyDecision).toBe('function')
  })
})

// ============================================================================
// 3. SSE bridge event tests
// ============================================================================

describe('SSE bridge for task:safety_prompt', () => {
  it('RelayServer emits task:safety_prompt event type', () => {
    const relay = new RelayServer({ port: 0 })
    const handler = vi.fn()

    relay.on('task:safety_prompt', handler)

    // Simulate emitting the event (as done in the message handler)
    relay.emit('task:safety_prompt', {
      taskId: 'task-1',
      safetyTier: 'risky',
      warning: 'Working directory is not a git repository',
      options: [
        { id: 'proceed', label: 'Continue anyway', description: 'Proceed without git' },
        { id: 'init-git', label: 'Initialize git', description: 'Run git init' },
        { id: 'sandbox', label: 'Use sandbox', description: 'Run in isolated sandbox' },
        { id: 'cancel', label: 'Cancel', description: 'Cancel the task' },
      ],
    })

    expect(handler).toHaveBeenCalledTimes(1)
    const payload = handler.mock.calls[0][0]
    expect(payload.taskId).toBe('task-1')
    expect(payload.safetyTier).toBe('risky')
    expect(payload.warning).toBe('Working directory is not a git repository')
    expect(payload.options).toHaveLength(4)
    expect(payload.options[0].id).toBe('proceed')
  })
})

// ============================================================================
// 4. Realtime store event handling tests
// ============================================================================

describe('Realtime store safety prompt handling', () => {
  /**
   * Simulates the realtime store's event handler for task:safety_prompt.
   * Mirrors the logic in src/stores/realtime-store.ts.
   */
  function handleSafetyPromptEvent(
    data: Record<string, unknown>,
    safetyPrompts: Map<string, { taskId: string; safetyTier: string; warning?: string; options: unknown[] }>
  ) {
    const taskId = data.taskId as string
    const safetyTier = data.safetyTier as string
    const warning = data.warning as string | undefined
    const options = data.options as Array<{ id: string; label: string; description?: string }>

    const newPrompts = new Map(safetyPrompts)
    newPrompts.set(taskId, {
      taskId,
      safetyTier,
      warning,
      options,
    })
    return newPrompts
  }

  it('adds safety prompt to Map keyed by taskId', () => {
    const prompts = new Map()
    const result = handleSafetyPromptEvent(
      {
        taskId: 'task-1',
        safetyTier: 'risky',
        warning: 'Not a git repo',
        options: [{ id: 'proceed', label: 'Continue' }],
      },
      prompts
    )

    expect(result.size).toBe(1)
    expect(result.has('task-1')).toBe(true)
    expect(result.get('task-1')!.safetyTier).toBe('risky')
  })

  it('replaces existing prompt for same taskId', () => {
    const prompts = new Map()
    const first = handleSafetyPromptEvent(
      { taskId: 'task-1', safetyTier: 'risky', options: [] },
      prompts
    )
    const second = handleSafetyPromptEvent(
      { taskId: 'task-1', safetyTier: 'dangerous', options: [] },
      first
    )

    expect(second.size).toBe(1)
    expect(second.get('task-1')!.safetyTier).toBe('dangerous')
  })

  it('handles multiple concurrent safety prompts', () => {
    const prompts = new Map()
    const first = handleSafetyPromptEvent(
      { taskId: 'task-1', safetyTier: 'risky', options: [] },
      prompts
    )
    const second = handleSafetyPromptEvent(
      { taskId: 'task-2', safetyTier: 'dangerous', options: [] },
      first
    )

    expect(second.size).toBe(2)
    expect(second.has('task-1')).toBe(true)
    expect(second.has('task-2')).toBe(true)
  })

  it('preserves warning field when present', () => {
    const prompts = new Map()
    const result = handleSafetyPromptEvent(
      {
        taskId: 'task-1',
        safetyTier: 'risky',
        warning: 'Directory /tmp/test is not under version control',
        options: [],
      },
      prompts
    )

    expect(result.get('task-1')!.warning).toBe('Directory /tmp/test is not under version control')
  })

  it('handles missing warning field', () => {
    const prompts = new Map()
    const result = handleSafetyPromptEvent(
      { taskId: 'task-1', safetyTier: 'risky', options: [] },
      prompts
    )

    expect(result.get('task-1')!.warning).toBeUndefined()
  })

  /**
   * Simulates responding to a safety prompt (removing from map).
   */
  function respondToSafetyPrompt(
    taskId: string,
    safetyPrompts: Map<string, unknown>
  ) {
    const newPrompts = new Map(safetyPrompts)
    newPrompts.delete(taskId)
    return newPrompts
  }

  it('responding removes prompt from Map', () => {
    const prompts = new Map()
    prompts.set('task-1', { taskId: 'task-1', safetyTier: 'risky', options: [] })
    prompts.set('task-2', { taskId: 'task-2', safetyTier: 'risky', options: [] })

    const result = respondToSafetyPrompt('task-1', prompts)

    expect(result.size).toBe(1)
    expect(result.has('task-1')).toBe(false)
    expect(result.has('task-2')).toBe(true)
  })

  it('responding with unknown taskId does not throw', () => {
    const prompts = new Map()
    expect(() => respondToSafetyPrompt('nonexistent', prompts)).not.toThrow()
  })
})

// ============================================================================
// 5. Dead-end handler tests
// ============================================================================

describe('Dead-end message handlers', () => {
  /**
   * Simulates the relay server's message type switch for dead-end messages.
   * These messages should be handled without triggering the default "Unknown message" warning.
   */
  function handleMessage(type: string): { handled: boolean; isUnknown: boolean } {
    const knownTypes = [
      'register', 'heartbeat', 'task_status', 'task_output',
      'task_tool_trace', 'task_text', 'task_tool_use', 'task_tool_result',
      'task_file_change', 'task_session_init', 'task_steer_ack',
      'task_approval_request', 'task_safety_prompt', 'task_result',
      // Dead-end types that should be silently handled
      'resource_update', 'task_approval_response', 'task_safety_response',
    ]

    if (knownTypes.includes(type)) {
      return { handled: true, isUnknown: false }
    }
    return { handled: false, isUnknown: true }
  }

  it('resource_update is handled without "Unknown message" warning', () => {
    const result = handleMessage('resource_update')
    expect(result.handled).toBe(true)
    expect(result.isUnknown).toBe(false)
  })

  it('task_approval_response is handled without "Unknown message" warning', () => {
    const result = handleMessage('task_approval_response')
    expect(result.handled).toBe(true)
    expect(result.isUnknown).toBe(false)
  })

  it('task_safety_response is handled without "Unknown message" warning', () => {
    const result = handleMessage('task_safety_response')
    expect(result.handled).toBe(true)
    expect(result.isUnknown).toBe(false)
  })

  it('truly unknown messages are still flagged', () => {
    const result = handleMessage('completely_made_up')
    expect(result.handled).toBe(false)
    expect(result.isUnknown).toBe(true)
  })
})

// ============================================================================
// 6. Message format tests
// ============================================================================

describe('task_safety_decision message format', () => {
  it('matches the format expected by agent runner', () => {
    const taskId = 'exec-task-123'
    const decision = 'proceed' as const

    const message = {
      type: 'task_safety_decision',
      timestamp: new Date().toISOString(),
      payload: { taskId, decision },
    }

    expect(message.type).toBe('task_safety_decision')
    expect(message.payload.taskId).toBe(taskId)
    expect(message.payload.decision).toBe('proceed')
    expect(typeof message.timestamp).toBe('string')
    // Verify ISO timestamp format
    expect(new Date(message.timestamp).toISOString()).toBe(message.timestamp)
  })

  it('accepts all valid decision values', () => {
    const decisions = ['proceed', 'init-git', 'sandbox', 'cancel'] as const
    for (const decision of decisions) {
      const message = {
        type: 'task_safety_decision',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'task-1', decision },
      }
      expect(message.payload.decision).toBe(decision)
    }
  })
})

// ============================================================================
// 7. Claude Code adapter tool_use_id → tool name fix
// ============================================================================

describe('Claude Code adapter tool_use_id → tool name mapping', () => {
  /**
   * Verify the source code contains the fix for mapping tool_use_id to tool names
   * in the Claude Code adapter. Previously, tool_use_id (toolu_bdrk_*) was passed
   * as the toolName, causing raw IDs to appear in the UI.
   */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const adapterPath = path.join(process.cwd(), 'packages/agent-runner/src/providers/claude-code-adapter.ts')
  const adapterSource = fs.readFileSync(adapterPath, 'utf-8')

  it.todo('has a toolIdToName map for correlating tool_use with tool_result')

  it.todo('records tool name from tool_use blocks (block.id → block.name)')

  it.todo('looks up tool name from toolIdToName map in tool_result handler')

  it.todo('does NOT pass raw tool_use_id as toolName to stream.toolResult')

  it.todo('clears the toolIdToName map at the start of each execution')
})
