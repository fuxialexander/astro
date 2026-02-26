/**
 * Safety Prompt Response Tests
 *
 * Tests the respondToSafetyPrompt method's machine resolution logic:
 *   1. Normal path: node exists → execution store → machineId
 *   2. Refinement path: no node exists → fallback to first connected machine
 *   3. No machines at all → prompt removed from map, no stuck dialog
 *   4. API error → prompt removed from map, error re-thrown
 *   5. Prompt always removed from map regardless of outcome
 *
 * These test the pure logic extracted from realtime-store.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Types mirroring the store
// ============================================================================

interface MachineEntry {
  machineId: string
  name: string
  connectionStatus: string
}

interface PlanNode {
  id: string
  executionId?: string
}

interface Execution {
  machineId?: string
}

interface SafetyPrompt {
  taskId: string
  safetyTier: string
  warning?: string
  options: Array<{ id: string; label: string; description?: string }>
}

// ============================================================================
// Extracted logic under test
// ============================================================================

/**
 * Simulates the machine resolution logic from respondToSafetyPrompt.
 * This is the core logic that was buggy: it used to return early when
 * no plan node existed, leaving the dialog stuck.
 */
function resolveMachineId(
  taskId: string,
  nodes: PlanNode[],
  getExecution: (nodeId: string) => Execution | undefined,
  machines: Map<string, MachineEntry>,
): string | undefined {
  // Step 1: Try to find via plan node → execution store
  const node = nodes.find((n) => n.executionId === taskId)
  if (node) {
    const execution = getExecution(node.id)
    if (execution?.machineId) return execution.machineId
  }

  // Step 2: Fallback to first connected machine
  if (machines.size > 0) {
    return machines.values().next().value?.machineId
  }

  return undefined
}

/**
 * Simulates the full respondToSafetyPrompt flow, including prompt removal.
 */
async function respondToSafetyPrompt(
  taskId: string,
  decision: string,
  nodes: PlanNode[],
  getExecution: (nodeId: string) => Execution | undefined,
  machines: Map<string, MachineEntry>,
  safetyPrompts: Map<string, SafetyPrompt>,
  fetchFn: (machineId: string, taskId: string, decision: string) => Promise<{ ok: boolean; status: number }>,
): Promise<{ promptRemoved: boolean; machineId?: string; error?: string }> {
  const machineId = resolveMachineId(taskId, nodes, getExecution, machines)

  if (!machineId) {
    // Always remove from map
    safetyPrompts.delete(taskId)
    return { promptRemoved: true }
  }

  try {
    const response = await fetchFn(machineId, taskId, decision)
    if (!response.ok) {
      throw new Error(`Failed to send safety decision: ${response.status}`)
    }
  } catch (error) {
    // Still remove from map on error
    safetyPrompts.delete(taskId)
    return { promptRemoved: true, machineId, error: (error as Error).message }
  }

  // Success path
  safetyPrompts.delete(taskId)
  return { promptRemoved: true, machineId }
}

// ============================================================================
// Tests
// ============================================================================

describe('resolveMachineId', () => {
  it('resolves via plan node → execution store (normal execution)', () => {
    const nodes: PlanNode[] = [{ id: 'node-1', executionId: 'exec-123' }]
    const getExecution = (nodeId: string) =>
      nodeId === 'node-1' ? { machineId: 'machine-A' } : undefined
    const machines = new Map<string, MachineEntry>()

    const result = resolveMachineId('exec-123', nodes, getExecution, machines)
    expect(result).toBe('machine-A')
  })

  it('falls back to first connected machine when no plan node exists (refinement task)', () => {
    const nodes: PlanNode[] = [] // No nodes — this is a refine-xxx task
    const getExecution = () => undefined
    const machines = new Map<string, MachineEntry>([
      ['m1', { machineId: 'm1', name: 'My Laptop', connectionStatus: 'connected' }],
    ])

    const result = resolveMachineId('refine-abc123', nodes, getExecution, machines)
    expect(result).toBe('m1')
  })

  it('falls back to first machine when node exists but has no execution', () => {
    const nodes: PlanNode[] = [{ id: 'node-1', executionId: 'exec-123' }]
    const getExecution = () => undefined // No execution record
    const machines = new Map<string, MachineEntry>([
      ['m1', { machineId: 'm1', name: 'Machine 1', connectionStatus: 'connected' }],
    ])

    const result = resolveMachineId('exec-123', nodes, getExecution, machines)
    expect(result).toBe('m1')
  })

  it('falls back to first machine when execution has no machineId', () => {
    const nodes: PlanNode[] = [{ id: 'node-1', executionId: 'exec-123' }]
    const getExecution = () => ({ machineId: undefined })
    const machines = new Map<string, MachineEntry>([
      ['m1', { machineId: 'm1', name: 'Machine 1', connectionStatus: 'connected' }],
    ])

    const result = resolveMachineId('exec-123', nodes, getExecution, machines)
    expect(result).toBe('m1')
  })

  it('returns undefined when no nodes and no machines', () => {
    const result = resolveMachineId(
      'refine-orphan',
      [],
      () => undefined,
      new Map(),
    )
    expect(result).toBeUndefined()
  })

  it('picks the first machine from the map when multiple are connected', () => {
    const machines = new Map<string, MachineEntry>([
      ['first', { machineId: 'first', name: 'First', connectionStatus: 'connected' }],
      ['second', { machineId: 'second', name: 'Second', connectionStatus: 'connected' }],
    ])

    const result = resolveMachineId('refine-abc', [], () => undefined, machines)
    expect(result).toBe('first')
  })

  it('does not match nodes with different executionIds', () => {
    const nodes: PlanNode[] = [{ id: 'node-1', executionId: 'exec-different' }]
    const getExecution = () => ({ machineId: 'machine-A' })
    const machines = new Map<string, MachineEntry>()

    // Looking for 'exec-123' but node has 'exec-different'
    const result = resolveMachineId('exec-123', nodes, getExecution, machines)
    expect(result).toBeUndefined()
  })

  it('handles nodes without executionId gracefully', () => {
    const nodes: PlanNode[] = [{ id: 'node-1' }] // No executionId field
    const getExecution = () => ({ machineId: 'machine-A' })
    const machines = new Map<string, MachineEntry>([
      ['m1', { machineId: 'm1', name: 'Machine 1', connectionStatus: 'connected' }],
    ])

    const result = resolveMachineId('exec-123', nodes, getExecution, machines)
    // Should fall through to machine fallback since no node matches
    expect(result).toBe('m1')
  })
})

describe('respondToSafetyPrompt', () => {
  let safetyPrompts: Map<string, SafetyPrompt>
  let mockFetch: ReturnType<typeof vi.fn>

  const samplePrompt: SafetyPrompt = {
    taskId: 'exec-123',
    safetyTier: 'risky',
    warning: 'Working directory is not a git repository',
    options: [
      { id: 'proceed', label: 'Continue anyway' },
      { id: 'cancel', label: 'Cancel' },
    ],
  }

  beforeEach(() => {
    safetyPrompts = new Map([['exec-123', samplePrompt]])
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
  })

  it('removes prompt from map on successful response', async () => {
    const nodes: PlanNode[] = [{ id: 'node-1', executionId: 'exec-123' }]
    const getExecution = () => ({ machineId: 'machine-A' })

    const result = await respondToSafetyPrompt(
      'exec-123', 'proceed',
      nodes, getExecution, new Map(), safetyPrompts, mockFetch,
    )

    expect(result.promptRemoved).toBe(true)
    expect(safetyPrompts.has('exec-123')).toBe(false)
    expect(mockFetch).toHaveBeenCalledWith('machine-A', 'exec-123', 'proceed')
  })

  it('removes prompt from map when no machine is found (no stuck dialog)', async () => {
    const result = await respondToSafetyPrompt(
      'exec-123', 'proceed',
      [], () => undefined, new Map(), safetyPrompts, mockFetch,
    )

    expect(result.promptRemoved).toBe(true)
    expect(safetyPrompts.has('exec-123')).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('removes prompt from map when API returns error (no stuck dialog)', async () => {
    const failFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const machines = new Map<string, MachineEntry>([
      ['m1', { machineId: 'm1', name: 'M1', connectionStatus: 'connected' }],
    ])

    const result = await respondToSafetyPrompt(
      'exec-123', 'proceed',
      [], () => undefined, machines, safetyPrompts, failFetch,
    )

    expect(result.promptRemoved).toBe(true)
    expect(safetyPrompts.has('exec-123')).toBe(false)
    expect(result.error).toContain('500')
  })

  it('removes prompt from map when fetch throws network error', async () => {
    const throwFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    const machines = new Map<string, MachineEntry>([
      ['m1', { machineId: 'm1', name: 'M1', connectionStatus: 'connected' }],
    ])

    const result = await respondToSafetyPrompt(
      'exec-123', 'proceed',
      [], () => undefined, machines, safetyPrompts, throwFetch,
    )

    expect(result.promptRemoved).toBe(true)
    expect(safetyPrompts.has('exec-123')).toBe(false)
    expect(result.error).toBe('Network error')
  })

  it('sends cancel decision via the API', async () => {
    const machines = new Map<string, MachineEntry>([
      ['m1', { machineId: 'm1', name: 'M1', connectionStatus: 'connected' }],
    ])

    await respondToSafetyPrompt(
      'exec-123', 'cancel',
      [], () => undefined, machines, safetyPrompts, mockFetch,
    )

    expect(mockFetch).toHaveBeenCalledWith('m1', 'exec-123', 'cancel')
  })

  it('uses execution machineId over fallback machine', async () => {
    const nodes: PlanNode[] = [{ id: 'node-1', executionId: 'exec-123' }]
    const getExecution = () => ({ machineId: 'correct-machine' })
    const machines = new Map<string, MachineEntry>([
      ['fallback', { machineId: 'fallback', name: 'Fallback', connectionStatus: 'connected' }],
    ])

    await respondToSafetyPrompt(
      'exec-123', 'proceed',
      nodes, getExecution, machines, safetyPrompts, mockFetch,
    )

    expect(mockFetch).toHaveBeenCalledWith('correct-machine', 'exec-123', 'proceed')
  })

  it('handles responding to a prompt not in the map (idempotent)', async () => {
    const emptyPrompts = new Map<string, SafetyPrompt>()
    const machines = new Map<string, MachineEntry>([
      ['m1', { machineId: 'm1', name: 'M1', connectionStatus: 'connected' }],
    ])

    // Should not throw even if prompt is not in the map
    const result = await respondToSafetyPrompt(
      'nonexistent', 'cancel',
      [], () => undefined, machines, emptyPrompts, mockFetch,
    )

    expect(result.promptRemoved).toBe(true)
    expect(emptyPrompts.size).toBe(0)
  })

  it('only removes the targeted prompt, leaves others intact', async () => {
    safetyPrompts.set('other-task', {
      taskId: 'other-task',
      safetyTier: 'risky',
      options: [{ id: 'proceed', label: 'Go' }],
    })
    const machines = new Map<string, MachineEntry>([
      ['m1', { machineId: 'm1', name: 'M1', connectionStatus: 'connected' }],
    ])

    await respondToSafetyPrompt(
      'exec-123', 'proceed',
      [], () => undefined, machines, safetyPrompts, mockFetch,
    )

    expect(safetyPrompts.has('exec-123')).toBe(false)
    expect(safetyPrompts.has('other-task')).toBe(true)
    expect(safetyPrompts.size).toBe(1)
  })
})

// ============================================================================
// Source code verification — the old bug
// ============================================================================

describe('realtime-store.ts source code safety', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/stores/realtime-store.ts'),
    'utf-8'
  )

  it('does NOT have an early return when no plan node is found', () => {
    // The old buggy code had:
    //   if (!node) { console.error(...); return }
    // This left the dialog stuck for refinement tasks.
    // The fix should NOT return early when no node is found.
    const lines = source.split('\n')
    const methodStart = lines.findIndex((l) => l.includes('respondToSafetyPrompt'))
    const methodSection = lines.slice(methodStart, methodStart + 40).join('\n')

    // There should be no `if (!node)` followed by `return`
    expect(methodSection).not.toMatch(/if\s*\(\s*!node\s*\)\s*\{[^}]*return/)
  })

  it('always deletes from safetyPrompts map in the no-machine case', () => {
    expect(source).toContain('No machine found for safety prompt task')
    // After the no-machine error, there should be a map delete
    const noMachineIdx = source.indexOf('No machine found for safety prompt task')
    const afterNoMachine = source.slice(noMachineIdx - 300, noMachineIdx)
    expect(afterNoMachine).toContain('newPrompts.delete(taskId)')
  })

  it('deletes from safetyPrompts map in the catch block', () => {
    // The catch block has console.error('[realtime] Failed to send safety decision')
    // followed by a map delete. Search for the console.error version (in catch block).
    const catchIdx = source.indexOf("console.error('[realtime] Failed to send safety decision")
    expect(catchIdx).toBeGreaterThan(-1)
    const afterCatch = source.slice(catchIdx, catchIdx + 400)
    expect(afterCatch).toContain('newPrompts.delete(taskId)')
  })

  it('resolves machineId from safety prompt event or execution store fallback', () => {
    // machineId now comes from the safety prompt event (set by relay) or execution store
    expect(source).toContain('safetyPrompt?.machineId')
    expect(source).toContain('exec.executionId === taskId && exec.machineId')
  })
})
