import { describe, it, expect, vi, beforeEach } from 'vitest'

const setProjectPlan = vi.fn()
const reorganizeProject = vi.fn()
const updateProject = vi.fn()

// Mock Zustand stores before importing the module under test
vi.mock('@/stores/plan-store', () => ({
  usePlanStore: {
    getState: () => ({
      nodes: [],
      edges: [],
      setProjectPlan,
      reorganizeProject,
    }),
  },
}))
vi.mock('@/stores/project-store', () => ({
  useProjectStore: {
    getState: () => ({
      projects: [],
      updateProject,
    }),
  },
}))

import { applyPlanFromText, clearPlanFingerprint } from '../src/lib/plan-extraction'
import type { PlanJsonResult } from '@astro/core'

describe('applyPlanFromText idempotency', () => {
  const projectId = 'test-project-id'

  beforeEach(() => {
    clearPlanFingerprint(projectId)
    clearPlanFingerprint('project-a')
    clearPlanFingerprint('project-b')
    vi.clearAllMocks()
  })

  const makePlan = (nodeCount: number): PlanJsonResult => ({
    projectName: 'Test Project',
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: i === 0 ? 'm1' : `n${i}`,
      type: i === 0 ? 'milestone' : 'task',
      title: `Node ${i + 1}`,
      description: `Description ${i + 1}`,
      status: 'planned',
      dependencies: [],
      ...(i > 0 ? { milestoneId: 'm1' } : {}),
    })),
    edges: [],
  })

  it('applies a plan on first call', () => {
    const plan = makePlan(3)
    const result = applyPlanFromText(projectId, '', undefined, undefined, plan)

    expect(result.applied).toBe(true)
    expect(result.nodeCount).toBe(3)
    expect(setProjectPlan).toHaveBeenCalledTimes(1)
  })

  it('skips duplicate application of identical plan', () => {
    const plan = makePlan(3)

    const result1 = applyPlanFromText(projectId, '', undefined, undefined, plan)
    expect(result1.applied).toBe(true)
    expect(setProjectPlan).toHaveBeenCalledTimes(1)

    // Second call with same plan — should be skipped
    const result2 = applyPlanFromText(projectId, '', undefined, undefined, plan)
    expect(result2.applied).toBe(true)
    expect(result2.nodeCount).toBe(3)
    // setProjectPlan should NOT be called again
    expect(setProjectPlan).toHaveBeenCalledTimes(1)
  })

  it('applies a different plan after the first', () => {
    const plan1 = makePlan(3)
    const plan2 = makePlan(5)

    applyPlanFromText(projectId, '', undefined, undefined, plan1)
    expect(setProjectPlan).toHaveBeenCalledTimes(1)

    const result2 = applyPlanFromText(projectId, '', undefined, undefined, plan2)
    expect(result2.applied).toBe(true)
    expect(result2.nodeCount).toBe(5)
    expect(setProjectPlan).toHaveBeenCalledTimes(2)
  })

  it('allows re-application after clearPlanFingerprint', () => {
    const plan = makePlan(3)

    applyPlanFromText(projectId, '', undefined, undefined, plan)
    expect(setProjectPlan).toHaveBeenCalledTimes(1)

    clearPlanFingerprint(projectId)

    applyPlanFromText(projectId, '', undefined, undefined, plan)
    expect(setProjectPlan).toHaveBeenCalledTimes(2)
  })

  it('tracks fingerprints per project independently', () => {
    const plan = makePlan(3)

    applyPlanFromText('project-a', '', undefined, undefined, plan)
    applyPlanFromText('project-b', '', undefined, undefined, plan)
    expect(setProjectPlan).toHaveBeenCalledTimes(2)

    // Duplicate for project-a — skipped
    applyPlanFromText('project-a', '', undefined, undefined, plan)
    expect(setProjectPlan).toHaveBeenCalledTimes(2)

    // Different plan for project-a — applied
    const plan2 = makePlan(4)
    applyPlanFromText('project-a', '', undefined, undefined, plan2)
    expect(setProjectPlan).toHaveBeenCalledTimes(3)
  })

  it('returns correct nodeCount even when skipping duplicate', () => {
    const plan = makePlan(7)

    const result1 = applyPlanFromText(projectId, '', undefined, undefined, plan)
    expect(result1.nodeCount).toBe(7)

    const result2 = applyPlanFromText(projectId, '', undefined, undefined, plan)
    expect(result2.nodeCount).toBe(7)
    expect(result2.applied).toBe(true)
  })
})
