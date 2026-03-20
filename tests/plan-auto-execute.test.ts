import { describe, expect, it, vi } from 'vitest'

import { tryAutoExecuteCompletedPlanProject } from '@/lib/plan-auto-execute'

describe('plan auto-execute retry behavior', () => {
  it('does not clear the auto-execute flag when no tasks were dispatchable yet', () => {
    const executeAllProject = vi.fn(() => false)
    const clearAutoExecute = vi.fn()

    const started = tryAutoExecuteCompletedPlanProject('proj-1', {
      hasAutoExecute: true,
      planExecutionStatus: 'success',
      executeAllProject,
      clearAutoExecute,
    })

    expect(started).toBe(false)
    expect(executeAllProject).toHaveBeenCalledWith('proj-1', undefined)
    expect(clearAutoExecute).not.toHaveBeenCalled()
  })

  it('clears the auto-execute flag after dispatch starts successfully', () => {
    const executeAllProject = vi.fn(() => true)
    const clearAutoExecute = vi.fn()
    const options = { preferredProvider: 'codex' }

    const started = tryAutoExecuteCompletedPlanProject('proj-2', {
      hasAutoExecute: true,
      planExecutionStatus: 'success',
      options,
      executeAllProject,
      clearAutoExecute,
    })

    expect(started).toBe(true)
    expect(executeAllProject).toHaveBeenCalledWith('proj-2', options)
    expect(clearAutoExecute).toHaveBeenCalledWith('proj-2')
  })

  it('does nothing until the plan execution itself is successful', () => {
    const executeAllProject = vi.fn(() => true)
    const clearAutoExecute = vi.fn()

    const started = tryAutoExecuteCompletedPlanProject('proj-3', {
      hasAutoExecute: true,
      planExecutionStatus: 'running',
      executeAllProject,
      clearAutoExecute,
    })

    expect(started).toBe(false)
    expect(executeAllProject).not.toHaveBeenCalled()
    expect(clearAutoExecute).not.toHaveBeenCalled()
  })
})
