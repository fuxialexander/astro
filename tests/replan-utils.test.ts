/**
 * Unit tests for replan-utils.ts — extractLessonsFromPlan and buildPreviousPlanSummary.
 *
 * Tests status mapping (success, failure, partial, not_executed),
 * milestone filtering, execution output mapping, and summary formatting.
 *
 * Run with: npx vitest run tests/replan-utils.test.ts
 */

import { describe, it, expect } from 'vitest'
import { extractLessonsFromPlan, buildPreviousPlanSummary } from '../src/lib/replan-utils'
import type { PlanNode, PlanEdge } from '../packages/core/src/types'

// ─── Helpers ──────────────────────────────────────────────────────────

const now = new Date()

function makeNode(overrides: Partial<PlanNode> & { id: string; title: string }): PlanNode {
  return {
    projectId: 'proj-1',
    type: 'task',
    description: '',
    status: 'planned',
    parentId: null,
    dependencies: [],
    verification: 'auto',
    position: { x: 0, y: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeEdge(source: string, target: string, type: 'dependency' | 'branch' = 'dependency'): PlanEdge {
  return { id: `${source}-${target}`, source, target, type }
}

// ─── extractLessonsFromPlan ───────────────────────────────────────────

describe('extractLessonsFromPlan', () => {
  it('maps completed status to success', () => {
    const nodes = [
      makeNode({ id: '1', title: 'Task A', description: 'Do A', status: 'completed', executionOutput: 'Done!' }),
    ]
    const lessons = extractLessonsFromPlan(nodes)
    expect(lessons).toHaveLength(1)
    expect(lessons[0]).toEqual({
      taskTitle: 'Task A',
      taskDescription: 'Do A',
      status: 'success',
      executionSummary: 'Done!',
    })
  })

  it('maps auto_verified status to success', () => {
    const nodes = [
      makeNode({ id: '1', title: 'Task B', description: 'Do B', status: 'auto_verified', executionOutput: 'Tests passed' }),
    ]
    const lessons = extractLessonsFromPlan(nodes)
    expect(lessons[0].status).toBe('success')
    expect(lessons[0].executionSummary).toBe('Tests passed')
  })

  it('maps nodes with executionError to failure', () => {
    const nodes = [
      makeNode({ id: '1', title: 'Task C', description: 'Do C', status: 'in_progress', executionError: 'Build failed' }),
    ]
    const lessons = extractLessonsFromPlan(nodes)
    expect(lessons[0].status).toBe('failure')
  })

  it('maps nodes with executionId but not completed to partial', () => {
    const nodes = [
      makeNode({ id: '1', title: 'Task D', description: 'Do D', status: 'in_progress', executionId: 'exec-123' }),
    ]
    const lessons = extractLessonsFromPlan(nodes)
    expect(lessons[0].status).toBe('partial')
  })

  it('maps nodes with no execution state to not_executed', () => {
    const nodes = [
      makeNode({ id: '1', title: 'Task E', description: 'Do E', status: 'planned' }),
    ]
    const lessons = extractLessonsFromPlan(nodes)
    expect(lessons[0].status).toBe('not_executed')
  })

  it('filters out milestone nodes', () => {
    const nodes = [
      makeNode({ id: '1', title: 'Milestone 1', type: 'milestone' }),
      makeNode({ id: '2', title: 'Task F', type: 'task', status: 'completed' }),
    ]
    const lessons = extractLessonsFromPlan(nodes)
    expect(lessons).toHaveLength(1)
    expect(lessons[0].taskTitle).toBe('Task F')
  })

  it('maps executionOutput to executionSummary', () => {
    const nodes = [
      makeNode({ id: '1', title: 'Task G', description: 'Do G', status: 'completed', executionOutput: 'Summary text' }),
    ]
    const lessons = extractLessonsFromPlan(nodes)
    expect(lessons[0].executionSummary).toBe('Summary text')
  })

  it('sets executionSummary to undefined when executionOutput is absent', () => {
    const nodes = [
      makeNode({ id: '1', title: 'Task H', description: 'Do H', status: 'completed' }),
    ]
    const lessons = extractLessonsFromPlan(nodes)
    expect(lessons[0].executionSummary).toBeUndefined()
  })

  it('returns empty array for empty input', () => {
    expect(extractLessonsFromPlan([])).toEqual([])
  })

  it('returns empty array when all nodes are milestones', () => {
    const nodes = [
      makeNode({ id: '1', title: 'M1', type: 'milestone' }),
      makeNode({ id: '2', title: 'M2', type: 'milestone' }),
    ]
    expect(extractLessonsFromPlan(nodes)).toEqual([])
  })

  it('handles all four statuses in a single call', () => {
    const nodes = [
      makeNode({ id: '1', title: 'Success', status: 'completed' }),
      makeNode({ id: '2', title: 'Failed', status: 'in_progress', executionError: 'err' }),
      makeNode({ id: '3', title: 'Partial', status: 'dispatched', executionId: 'ex1' }),
      makeNode({ id: '4', title: 'Not run', status: 'planned' }),
    ]
    const lessons = extractLessonsFromPlan(nodes)
    expect(lessons.map((l) => l.status)).toEqual(['success', 'failure', 'partial', 'not_executed'])
  })

  it('prefers failure over partial when both executionError and executionId are present', () => {
    const nodes = [
      makeNode({ id: '1', title: 'ErrAndId', status: 'in_progress', executionId: 'ex1', executionError: 'crashed' }),
    ]
    const lessons = extractLessonsFromPlan(nodes)
    expect(lessons[0].status).toBe('failure')
  })
})

// ─── buildPreviousPlanSummary ─────────────────────────────────────────

describe('buildPreviousPlanSummary', () => {
  it('includes task counts', () => {
    const nodes = [
      makeNode({ id: '1', title: 'Task 1', status: 'completed' }),
      makeNode({ id: '2', title: 'Task 2', status: 'planned' }),
    ]
    const summary = buildPreviousPlanSummary(nodes, [])
    expect(summary).toContain('**Total tasks:** 2')
    expect(summary).toContain('**Completed:** 1')
  })

  it('groups tasks under their milestone', () => {
    const nodes = [
      makeNode({ id: 'm1', title: 'Phase 1', type: 'milestone' }),
      makeNode({ id: 't1', title: 'Setup', milestoneId: 'm1', status: 'completed' }),
      makeNode({ id: 't2', title: 'Build', milestoneId: 'm1', status: 'planned' }),
    ]
    const summary = buildPreviousPlanSummary(nodes, [])
    expect(summary).toContain('### Phase 1')
    expect(summary).toContain('**Setup**')
    expect(summary).toContain('**Build**')
  })

  it('shows unassigned tasks when milestoneId is undefined', () => {
    const nodes = [
      makeNode({ id: 't1', title: 'Standalone Task', status: 'planned' }),
    ]
    const summary = buildPreviousPlanSummary(nodes, [])
    expect(summary).toContain('### Unassigned Tasks')
    expect(summary).toContain('**Standalone Task**')
  })

  it('includes dependency structure', () => {
    const nodes = [
      makeNode({ id: 't1', title: 'First' }),
      makeNode({ id: 't2', title: 'Second' }),
    ]
    const edges = [makeEdge('t1', 't2')]
    const summary = buildPreviousPlanSummary(nodes, edges)
    expect(summary).toContain('### Dependencies')
    expect(summary).toContain('First \u2192 Second')
  })

  it('uses status icons correctly', () => {
    const nodes = [
      makeNode({ id: '1', title: 'Done', status: 'completed' }),
      makeNode({ id: '2', title: 'Errored', status: 'in_progress', executionError: 'fail' }),
      makeNode({ id: '3', title: 'Partial', status: 'dispatched', executionId: 'ex' }),
      makeNode({ id: '4', title: 'Planned', status: 'planned' }),
    ]
    const summary = buildPreviousPlanSummary(nodes, [])
    expect(summary).toContain('\u2705 **Done**')
    expect(summary).toContain('\u274C **Errored**')
    expect(summary).toContain('\u26A0\uFE0F **Partial**')
    expect(summary).toContain('\u2B1C **Planned**')
  })

  it('returns summary for empty nodes array', () => {
    const summary = buildPreviousPlanSummary([], [])
    expect(summary).toContain('**Total tasks:** 0')
    expect(summary).toContain('**Completed:** 0')
  })

  it('excludes milestones from task counts', () => {
    const nodes = [
      makeNode({ id: 'm1', title: 'Milestone', type: 'milestone' }),
      makeNode({ id: 't1', title: 'Real Task', type: 'task', status: 'completed' }),
    ]
    const summary = buildPreviousPlanSummary(nodes, [])
    expect(summary).toContain('**Total tasks:** 1')
    expect(summary).toContain('**Completed:** 1')
  })

  it('omits dependencies section when no dependency edges exist', () => {
    const nodes = [makeNode({ id: 't1', title: 'Solo' })]
    const summary = buildPreviousPlanSummary(nodes, [])
    expect(summary).not.toContain('### Dependencies')
  })

  it('ignores branch edges in dependency listing', () => {
    const nodes = [
      makeNode({ id: 't1', title: 'A' }),
      makeNode({ id: 't2', title: 'B' }),
    ]
    const edges = [makeEdge('t1', 't2', 'branch')]
    const summary = buildPreviousPlanSummary(nodes, edges)
    expect(summary).not.toContain('### Dependencies')
  })

  it('handles milestoneId referencing a non-existent milestone', () => {
    const nodes = [
      makeNode({ id: 't1', title: 'Orphan', milestoneId: 'missing-milestone' }),
    ]
    const summary = buildPreviousPlanSummary(nodes, [])
    // Should still render without crashing — falls back to showing the ID
    expect(summary).toContain('### Milestone: missing-milestone')
    expect(summary).toContain('**Orphan**')
  })
})
