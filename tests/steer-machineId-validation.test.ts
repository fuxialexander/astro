/**
 * Tests for steer machineId validation and resolution logic.
 *
 * Verifies:
 * 1. Backend steer schema validation (machineId min(1), missing fields, valid payload)
 * 2. Frontend canSteer guard (machineId required alongside running/success+session)
 * 3. MachineId resolution fallback (prop → execution store → realtime taskStreams)
 *
 * All tests are pure-function / unit tests — no server or DB required.
 *
 * Run with: npx vitest run tests/steer-machineId-validation.test.ts
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// ─── Backend steer schema ────────────────────────────────────────────────────
//
// Mirrors the Zod schema defined in server/routes/dispatch.ts.
// machineId: z.string().min(1) — empty string must fail.

const steerSchema = z.object({
  taskId: z.string().min(1),
  machineId: z.string().min(1),
  message: z.string().min(1).max(50000),
  action: z.enum(['guidance', 'redirect', 'pause', 'resume']).optional(),
  interrupt: z.boolean().optional(),
  sessionId: z.string().max(100).optional(),
  branchName: z.string().max(500).optional(),
})

// Helper: derive the validation error response the backend would return
function parseSteer(raw: unknown): { success: true; data: z.infer<typeof steerSchema> } | { success: false; error: string; status: 400 } {
  const parsed = steerSchema.safeParse(raw)
  if (!parsed.success) {
    const missing = parsed.error.issues.map(i => i.path.join('.')).join(', ')
    return {
      success: false,
      error: `Validation failed: ${missing} — taskId, machineId, and message are required`,
      status: 400,
    }
  }
  return { success: true, data: parsed.data }
}

// ─── Frontend canSteer derivation ────────────────────────────────────────────
//
// Mirrors the expression in unified-activity-view.tsx:
//   const canSteer = (isRunning || (execution?.status === "success" && !!execution?.sessionId)) && !!machineId

function canSteer(
  isRunning: boolean,
  executionStatus: string | undefined,
  sessionId: string | undefined,
  machineId: string | undefined,
): boolean {
  return (isRunning || (executionStatus === 'success' && !!sessionId)) && !!machineId
}

// ─── MachineId resolution ────────────────────────────────────────────────────
//
// Mirrors the multi-source resolution in:
//   - unified-activity-view.tsx handleSteer()
//   - execution-store.ts steerPlanGeneration() / steerPlaygroundSession()
//
// Resolution order:
//   1. prop (explicit machineId passed to component)
//   2. execution store (execution.machineId for the node)
//   3. realtime taskStreams (taskStreams.get(executionId)?.machineId)

function resolveMachineId(
  propMachineId: string | undefined,
  executionStoreMachineId: string | undefined,
  taskStreamMachineId: string | undefined,
): string | undefined {
  return propMachineId || executionStoreMachineId || taskStreamMachineId
}

// Mirrors the steerPlanGeneration / steerPlaygroundSession result
function steerResult(
  executionId: string | undefined,
  machineId: string | undefined,
): { success: boolean; error?: 'no-machine' | 'send-failed' } {
  if (!executionId || !machineId) {
    return { success: false, error: 'no-machine' }
  }
  // Actual network call would follow; we simulate the successful path here
  return { success: true }
}

// ═══════════════════════════════════════════════════════════════════════════

describe('backend steer schema — machineId validation', () => {
  describe('invalid payloads that should return 400', () => {
    it('rejects empty string machineId with descriptive error', () => {
      const result = parseSteer({ taskId: 'task-1', machineId: '', message: 'guide me' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.status).toBe(400)
        expect(result.error).toContain('machineId')
        expect(result.error).toContain('Validation failed')
      }
    })

    it('rejects missing machineId field', () => {
      const result = parseSteer({ taskId: 'task-1', message: 'guide me' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.status).toBe(400)
        expect(result.error).toContain('machineId')
      }
    })

    it('rejects missing taskId', () => {
      const result = parseSteer({ machineId: 'machine-1', message: 'guide me' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.status).toBe(400)
        expect(result.error).toContain('taskId')
      }
    })

    it('rejects missing message', () => {
      const result = parseSteer({ taskId: 'task-1', machineId: 'machine-1' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.status).toBe(400)
        expect(result.error).toContain('message')
      }
    })

    it('rejects empty taskId', () => {
      const result = parseSteer({ taskId: '', machineId: 'machine-1', message: 'go' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.status).toBe(400)
      }
    })

    it('rejects empty message', () => {
      const result = parseSteer({ taskId: 'task-1', machineId: 'machine-1', message: '' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.status).toBe(400)
      }
    })

    it('rejects completely empty object', () => {
      const result = parseSteer({})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.status).toBe(400)
        expect(result.error).toContain('Validation failed')
      }
    })
  })

  describe('valid payloads that should pass', () => {
    it('accepts minimal valid payload', () => {
      const result = parseSteer({ taskId: 'task-abc', machineId: 'machine-hpc-01', message: 'add error handling' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.taskId).toBe('task-abc')
        expect(result.data.machineId).toBe('machine-hpc-01')
        expect(result.data.message).toBe('add error handling')
      }
    })

    it('accepts payload with all optional fields', () => {
      const result = parseSteer({
        taskId: 'task-1',
        machineId: 'machine-1',
        message: 'resume this',
        action: 'guidance',
        interrupt: true,
        sessionId: 'session-xyz',
        branchName: 'feat/resume',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.action).toBe('guidance')
        expect(result.data.interrupt).toBe(true)
        expect(result.data.sessionId).toBe('session-xyz')
        expect(result.data.branchName).toBe('feat/resume')
      }
    })

    it('accepts machineId with a single character (min(1) boundary)', () => {
      const result = parseSteer({ taskId: 'task-1', machineId: 'x', message: 'steer' })
      expect(result.success).toBe(true)
    })

    it('accepts all valid action enum values', () => {
      const actions = ['guidance', 'redirect', 'pause', 'resume'] as const
      for (const action of actions) {
        const result = parseSteer({ taskId: 'task-1', machineId: 'machine-1', message: 'steer', action })
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.action).toBe(action)
        }
      }
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════

describe('frontend canSteer guard', () => {
  describe('machineId is required for canSteer', () => {
    it('returns false when machineId is undefined even if running', () => {
      expect(canSteer(true, 'running', undefined, undefined)).toBe(false)
    })

    it('returns false when machineId is empty string even if running', () => {
      expect(canSteer(true, 'running', undefined, '')).toBe(false)
    })

    it('returns false when machineId is undefined and task completed with session', () => {
      expect(canSteer(false, 'success', 'session-123', undefined)).toBe(false)
    })

    it('returns false when machineId is empty string and task completed with session', () => {
      expect(canSteer(false, 'success', 'session-123', '')).toBe(false)
    })
  })

  describe('canSteer is true when machineId is present and task is running', () => {
    it('allows steer on running task with machineId', () => {
      expect(canSteer(true, 'running', undefined, 'machine-1')).toBe(true)
    })

    it('allows steer on running task even without sessionId', () => {
      expect(canSteer(true, undefined, undefined, 'machine-hpc-01')).toBe(true)
    })

    it('allows steer on running task with both sessionId and machineId', () => {
      expect(canSteer(true, 'running', 'session-abc', 'machine-local')).toBe(true)
    })
  })

  describe('canSteer is true when machineId is present and task succeeded with session', () => {
    it('allows steer on success + sessionId + machineId', () => {
      expect(canSteer(false, 'success', 'session-xyz', 'machine-1')).toBe(true)
    })

    it('allows steer on completed local task with session and machineId', () => {
      expect(canSteer(false, 'success', 'session-local-123', 'machine-local')).toBe(true)
    })

    it('allows steer on completed remote task with session and machineId', () => {
      expect(canSteer(false, 'success', 'session-remote-456', 'machine-hpc-07')).toBe(true)
    })
  })

  describe('canSteer is false for non-running, non-success statuses', () => {
    it('disallows steer on failed task even with machineId and session', () => {
      expect(canSteer(false, 'failure', 'session-123', 'machine-1')).toBe(false)
    })

    it('disallows steer on planned task', () => {
      expect(canSteer(false, 'planned', undefined, 'machine-1')).toBe(false)
    })

    it('disallows steer on dispatched task', () => {
      expect(canSteer(false, 'dispatched', undefined, 'machine-1')).toBe(false)
    })

    it('disallows steer on pruned task', () => {
      expect(canSteer(false, 'pruned', undefined, 'machine-1')).toBe(false)
    })

    it('disallows steer on success without session even with machineId', () => {
      expect(canSteer(false, 'success', undefined, 'machine-1')).toBe(false)
    })

    it('disallows steer on success with empty session even with machineId', () => {
      expect(canSteer(false, 'success', '', 'machine-1')).toBe(false)
    })

    it('disallows steer when no execution status', () => {
      expect(canSteer(false, undefined, undefined, 'machine-1')).toBe(false)
    })
  })

  describe('canSteer truth table (machineId-aware)', () => {
    const cases: Array<{
      label: string
      isRunning: boolean
      status: string | undefined
      sessionId: string | undefined
      machineId: string | undefined
      expected: boolean
    }> = [
      // machineId present → follows original canSteer logic
      { label: 'running + machineId', isRunning: true, status: 'running', sessionId: undefined, machineId: 'mid', expected: true },
      { label: 'success + session + machineId', isRunning: false, status: 'success', sessionId: 'sid', machineId: 'mid', expected: true },

      // machineId absent → always false regardless of other conditions
      { label: 'running, machineId undefined', isRunning: true, status: 'running', sessionId: undefined, machineId: undefined, expected: false },
      { label: 'running, machineId empty', isRunning: true, status: 'running', sessionId: 'sid', machineId: '', expected: false },
      { label: 'success + session, machineId undefined', isRunning: false, status: 'success', sessionId: 'sid', machineId: undefined, expected: false },

      // non-running non-success — machineId irrelevant
      { label: 'failure + session + machineId', isRunning: false, status: 'failure', sessionId: 'sid', machineId: 'mid', expected: false },
      { label: 'planned + machineId', isRunning: false, status: 'planned', sessionId: undefined, machineId: 'mid', expected: false },
      { label: 'no execution, no machineId', isRunning: false, status: undefined, sessionId: undefined, machineId: undefined, expected: false },
    ]

    for (const { label, isRunning, status, sessionId, machineId: mid, expected } of cases) {
      it(label, () => {
        expect(canSteer(isRunning, status, sessionId, mid)).toBe(expected)
      })
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════

describe('machineId resolution fallback', () => {
  describe('resolves from props first', () => {
    it('returns prop machineId when all sources are available', () => {
      expect(resolveMachineId('prop-machine', 'exec-machine', 'stream-machine')).toBe('prop-machine')
    })

    it('returns prop machineId when only prop is set', () => {
      expect(resolveMachineId('prop-machine', undefined, undefined)).toBe('prop-machine')
    })

    it('returns prop machineId when execution store is empty', () => {
      expect(resolveMachineId('prop-machine', undefined, 'stream-machine')).toBe('prop-machine')
    })
  })

  describe('falls back to execution store when prop is missing', () => {
    it('resolves from execution store when prop is undefined', () => {
      expect(resolveMachineId(undefined, 'exec-machine', undefined)).toBe('exec-machine')
    })

    it('resolves from execution store when prop is empty string', () => {
      // Empty string is falsy → falls through to next source
      expect(resolveMachineId('', 'exec-machine', 'stream-machine')).toBe('exec-machine')
    })

    it('resolves from execution store even when taskStream also has value', () => {
      expect(resolveMachineId(undefined, 'exec-machine', 'stream-machine')).toBe('exec-machine')
    })
  })

  describe('falls back to taskStream when prop and execution store are missing', () => {
    it('resolves from taskStream when prop and exec store are undefined', () => {
      expect(resolveMachineId(undefined, undefined, 'stream-machine')).toBe('stream-machine')
    })

    it('resolves from taskStream when prop is empty and exec store is undefined', () => {
      expect(resolveMachineId('', undefined, 'stream-machine')).toBe('stream-machine')
    })
  })

  describe('returns undefined when all sources are empty', () => {
    it('returns undefined when all sources are undefined', () => {
      expect(resolveMachineId(undefined, undefined, undefined)).toBeUndefined()
    })

    it('returns undefined (falsy) when all sources are empty strings', () => {
      // All empty strings are falsy → undefined coerced via || chain
      const result = resolveMachineId('', '', '')
      expect(result).toBeFalsy()
    })
  })

  describe('steerResult returns no-machine error when resolution fails', () => {
    it('returns no-machine error when executionId is missing', () => {
      const result = steerResult(undefined, 'machine-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('no-machine')
    })

    it('returns no-machine error when machineId is missing', () => {
      const result = steerResult('exec-123', undefined)
      expect(result.success).toBe(false)
      expect(result.error).toBe('no-machine')
    })

    it('returns no-machine error when both executionId and machineId are missing', () => {
      const result = steerResult(undefined, undefined)
      expect(result.success).toBe(false)
      expect(result.error).toBe('no-machine')
    })

    it('returns success when both executionId and machineId are present', () => {
      const result = steerResult('exec-abc', 'machine-hpc-01')
      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })
  })

  describe('resolution scenarios matching real execution flows', () => {
    it('plan-generation: machineId in execution entry (normal path)', () => {
      // execution.machineId is set after session_init fires
      const machineId = resolveMachineId(
        undefined,           // no prop in steerPlanGeneration
        'machine-local',     // execution.machineId from the store
        undefined,           // taskStream not checked since exec has it
      )
      expect(machineId).toBe('machine-local')
    })

    it('plan-generation: machineId from taskStream (race condition — session_init delayed)', () => {
      // execution.machineId not yet set, but taskStreams already knows the machine
      const machineId = resolveMachineId(
        undefined,           // no prop
        undefined,           // execution.machineId not yet populated
        'machine-relay-07',  // taskStreams.get(executionId)?.machineId
      )
      expect(machineId).toBe('machine-relay-07')
    })

    it('unified-activity-view: prop takes priority over store sources', () => {
      // Component receives explicit machineId prop from parent
      const machineId = resolveMachineId(
        'machine-from-props',
        'machine-from-exec',
        'machine-from-stream',
      )
      expect(machineId).toBe('machine-from-props')
    })

    it('no machine connected at all → no-machine error', () => {
      const machineId = resolveMachineId(undefined, undefined, undefined)
      const result = steerResult('exec-456', machineId)
      expect(result.success).toBe(false)
      expect(result.error).toBe('no-machine')
    })
  })
})
