/**
 * Active Tasks — Tests for deriveActiveTasks()
 *
 * Tests the real deriveActiveTasks function from src/lib/active-tasks.ts,
 * verifying streaming session inclusion, per-project dedup, idle retention,
 * and terminal session filtering.
 */
import { describe, it, expect } from 'vitest'
import { deriveActiveTasks } from '../src/lib/active-tasks'
import type { Session, TaskExecution, Project, PlanNode } from '../src/types'

// ============================================================================
// Helpers to build minimal test objects
// ============================================================================

function makeSession(overrides: Partial<Session> & { id: string; projectId: string }): Session {
  return {
    type: 'project-chat',
    status: 'active',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeExecution(overrides: Partial<TaskExecution> & { nodeId: string; projectId: string }): TaskExecution {
  return {
    executionId: `exec-${overrides.nodeId}`,
    status: 'running',
    streamText: '',
    startedAt: new Date(),
    toolTraces: [],
    fileChanges: [],
    activityEvents: [],
    ...overrides,
  }
}

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    description: '',
    visionDoc: '',
    status: 'active',
    teamId: 'team-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Project
}

/** Default params for deriveActiveTasks with empty collections */
function defaultParams() {
  return {
    executions: new Map<string, TaskExecution>(),
    rawNodes: [] as PlanNode[],
    liveNodes: [] as PlanNode[],
    nodesLoaded: true,
    projects: [] as Project[],
    projectsLoaded: true,
    streamingSessions: new Set<string>(),
    allSessions: new Map<string, Session>(),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('deriveActiveTasks: streaming sessions', () => {
  it('includes streaming project-chat session when no execution exists', () => {
    const session = makeSession({
      id: 'session-1',
      projectId: 'proj-1',
      type: 'project-chat',
      title: 'Debug auth flow',
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      streamingSessions: new Set(['session-1']),
      allSessions: new Map([['session-1', session]]),
    })

    expect(result.activeCount).toBe(1)
    const tasks = result.groupedTasks.get('proj-1')!
    expect(tasks).toHaveLength(1)
    expect(tasks[0].nodeId).toBe('playground-proj-1')
    expect(tasks[0].title).toBe('Playground Chat: Debug auth flow')
    expect(tasks[0].status).toBe('running')
  })

  it('does NOT double-count when execution already exists for same playground', () => {
    const exec = makeExecution({ nodeId: 'playground-proj-1', projectId: 'proj-1' })
    const session = makeSession({ id: 'session-1', projectId: 'proj-1', type: 'project-chat' })
    const project = makeProject('proj-1', 'My Project')

    const result = deriveActiveTasks({
      ...defaultParams(),
      executions: new Map([['playground-proj-1', exec]]),
      projects: [project],
      streamingSessions: new Set(['session-1']),
      allSessions: new Map([['session-1', session]]),
    })

    // Should be 1 (execution), not 2
    expect(result.activeCount).toBe(1)
  })

  it('uses session.title for streaming project-chat', () => {
    const session = makeSession({
      id: 's1',
      projectId: 'p1',
      type: 'project-chat',
      title: 'Custom Title',
      messages: [{ id: 'm1', role: 'user', content: 'ignored when title exists', timestamp: new Date() }],
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      streamingSessions: new Set(['s1']),
      allSessions: new Map([['s1', session]]),
    })

    expect(result.groupedTasks.get('p1')![0].title).toBe('Playground Chat: Custom Title')
  })

  it('falls back to first user message when no title', () => {
    const session = makeSession({
      id: 's1',
      projectId: 'p1',
      type: 'project-chat',
      messages: [{ id: 'm1', role: 'user', content: 'Help me debug the API', timestamp: new Date() }],
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      streamingSessions: new Set(['s1']),
      allSessions: new Map([['s1', session]]),
    })

    expect(result.groupedTasks.get('p1')![0].title).toBe('Playground Chat: Help me debug the API')
  })

  it('shows "Playground Chat" when nothing else available', () => {
    const session = makeSession({
      id: 's1',
      projectId: 'p1',
      type: 'project-chat',
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      streamingSessions: new Set(['s1']),
      allSessions: new Map([['s1', session]]),
    })

    expect(result.groupedTasks.get('p1')![0].title).toBe('Playground Chat')
  })

  it('handles multiple streaming sessions across projects', () => {
    const s1 = makeSession({ id: 's1', projectId: 'p1', type: 'project-chat', title: 'A' })
    const s2 = makeSession({ id: 's2', projectId: 'p2', type: 'project-chat', title: 'B' })

    const result = deriveActiveTasks({
      ...defaultParams(),
      streamingSessions: new Set(['s1', 's2']),
      allSessions: new Map([['s1', s1], ['s2', s2]]),
    })

    expect(result.activeCount).toBe(2)
    expect(result.groupedTasks.get('p1')!).toHaveLength(1)
    expect(result.groupedTasks.get('p2')!).toHaveLength(1)
  })

  it('mixes executions and streaming sessions correctly', () => {
    const exec = makeExecution({ nodeId: 'task-node-1', projectId: 'p1' })
    const session = makeSession({ id: 's1', projectId: 'p1', type: 'project-chat', title: 'Chat' })
    // Provide a raw node so the execution isn't skipped as "unknown node"
    const rawNode = {
      id: 'task-node-1', projectId: 'p1', title: 'Build feature',
      description: '', type: 'task', status: 'in_progress',
      dependencies: [], position: { x: 0, y: 0 },
      createdAt: new Date(), updatedAt: new Date(),
    } as PlanNode

    const result = deriveActiveTasks({
      ...defaultParams(),
      executions: new Map([['task-node-1', exec]]),
      rawNodes: [rawNode],
      streamingSessions: new Set(['s1']),
      allSessions: new Map([['s1', session]]),
    })

    // Both the execution and the streaming session should appear
    expect(result.activeCount).toBe(2)
    expect(result.groupedTasks.get('p1')!).toHaveLength(2)
  })

  it('skips sessions without projectId', () => {
    const session = makeSession({ id: 's1', projectId: '' })

    const result = deriveActiveTasks({
      ...defaultParams(),
      streamingSessions: new Set(['s1']),
      allSessions: new Map([['s1', session]]),
    })

    expect(result.activeCount).toBe(0)
  })

  it('skips completed executions', () => {
    const exec1 = makeExecution({ nodeId: 'playground-p1', projectId: 'p1', status: 'success' })
    const exec2 = makeExecution({ nodeId: 'task-1', projectId: 'p1', status: 'failure' })

    const result = deriveActiveTasks({
      ...defaultParams(),
      executions: new Map([['playground-p1', exec1], ['task-1', exec2]]),
    })

    expect(result.activeCount).toBe(0)
  })
})

describe('deriveActiveTasks: per-project dedup', () => {
  it('collapses multiple project-chat sessions for same project into one entry', () => {
    const s1 = makeSession({
      id: 'session-1',
      projectId: 'proj-1',
      type: 'project-chat',
      title: 'First chat',
      messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: new Date() }],
    })
    const s2 = makeSession({
      id: 'session-2',
      projectId: 'proj-1',
      type: 'project-chat',
      title: 'Second chat',
      messages: [{ id: 'm2', role: 'user', content: 'world', timestamp: new Date() }],
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      streamingSessions: new Set(['session-1', 'session-2']),
      allSessions: new Map([['session-1', s1], ['session-2', s2]]),
    })

    // Only one entry per project
    expect(result.activeCount).toBe(1)
    expect(result.groupedTasks.get('proj-1')!).toHaveLength(1)
    // First session wins (iteration order of Set)
    expect(result.groupedTasks.get('proj-1')![0].nodeId).toBe('playground-proj-1')
  })

  it('collapses idle project-chat sessions per project', () => {
    const now = new Date()
    const s1 = makeSession({
      id: 'session-1',
      projectId: 'proj-1',
      type: 'project-chat',
      title: 'Idle chat 1',
      messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: now }],
      updatedAt: now,
    })
    const s2 = makeSession({
      id: 'session-2',
      projectId: 'proj-1',
      type: 'project-chat',
      title: 'Idle chat 2',
      messages: [{ id: 'm2', role: 'user', content: 'world', timestamp: now }],
      updatedAt: now,
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      allSessions: new Map([['session-1', s1], ['session-2', s2]]),
    })

    // One idle entry per project
    expect(result.activeCount).toBe(1)
    expect(result.groupedTasks.get('proj-1')![0].status).toBe('idle')
  })
})

describe('deriveActiveTasks: terminal session filtering', () => {
  it('excludes completed sessions from idle retention', () => {
    const session = makeSession({
      id: 's1',
      projectId: 'p1',
      type: 'project-chat',
      status: 'completed',
      messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: new Date() }],
      updatedAt: new Date(), // recent enough for idle retention
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      allSessions: new Map([['s1', session]]),
    })

    expect(result.activeCount).toBe(0)
  })

  it('excludes cancelled sessions from idle retention', () => {
    const session = makeSession({
      id: 's1',
      projectId: 'p1',
      type: 'project-chat',
      status: 'cancelled',
      messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: new Date() }],
      updatedAt: new Date(),
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      allSessions: new Map([['s1', session]]),
    })

    expect(result.activeCount).toBe(0)
  })

  it('includes errored sessions in idle retention', () => {
    const session = makeSession({
      id: 's1',
      projectId: 'p1',
      type: 'project-chat',
      status: 'error',
      messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: new Date() }],
      updatedAt: new Date(),
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      allSessions: new Map([['s1', session]]),
    })

    expect(result.activeCount).toBe(1)
    expect(result.groupedTasks.get('p1')![0].status).toBe('idle')
  })

  it('excludes sessions older than idle retention (1 hour)', () => {
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
    const session = makeSession({
      id: 's1',
      projectId: 'p1',
      type: 'project-chat',
      messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: oldDate }],
      updatedAt: oldDate,
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      allSessions: new Map([['s1', session]]),
    })

    expect(result.activeCount).toBe(0)
  })
})

describe('deriveActiveTasks: playground follow-up dedup', () => {
  it('collapses task-chat with playground nodeId into the playground execution entry', () => {
    const exec = makeExecution({ nodeId: 'playground-p1', projectId: 'p1' })
    const session = makeSession({
      id: 's1',
      projectId: 'p1',
      type: 'task-chat',
      nodeId: 'playground-p1',
      title: 'Follow-up question',
    })
    const project = makeProject('p1', 'My Project')

    const result = deriveActiveTasks({
      ...defaultParams(),
      executions: new Map([['playground-p1', exec]]),
      projects: [project],
      streamingSessions: new Set(['s1']),
      allSessions: new Map([['s1', session]]),
    })

    // Should be 1 (execution), NOT 2 — the task-chat session collapses
    expect(result.activeCount).toBe(1)
  })

  it('shows playground task-chat as Playground Chat when no execution exists', () => {
    const session = makeSession({
      id: 's1',
      projectId: 'p1',
      type: 'task-chat',
      nodeId: 'playground-p1',
      title: 'My question',
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      streamingSessions: new Set(['s1']),
      allSessions: new Map([['s1', session]]),
    })

    expect(result.activeCount).toBe(1)
    const tasks = result.groupedTasks.get('p1')!
    expect(tasks[0].nodeId).toBe('playground-p1')
    expect(tasks[0].title).toBe('Playground Chat: My question')
  })
})

describe('deriveActiveTasks: task-chat sessions', () => {
  it('uses followup-{nodeId} for task-chat with nodeId', () => {
    const session = makeSession({
      id: 's1',
      projectId: 'p1',
      type: 'task-chat',
      nodeId: 'node-abc',
      title: 'Fix the bug',
    })

    const result = deriveActiveTasks({
      ...defaultParams(),
      streamingSessions: new Set(['s1']),
      allSessions: new Map([['s1', session]]),
    })

    expect(result.groupedTasks.get('p1')![0].nodeId).toBe('followup-node-abc')
    expect(result.groupedTasks.get('p1')![0].title).toBe('Fix the bug')
  })

  it('shows follow-up title when task node is completed', () => {
    const session = makeSession({
      id: 's1',
      projectId: 'p1',
      type: 'task-chat',
      nodeId: 'node-abc',
    })

    const completedNode: PlanNode = {
      id: 'node-abc',
      projectId: 'p1',
      title: 'Original Task',
      description: '',
      type: 'task',
      status: 'completed',
      dependencies: [],
      position: { x: 0, y: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as PlanNode

    const result = deriveActiveTasks({
      ...defaultParams(),
      rawNodes: [completedNode],
      streamingSessions: new Set(['s1']),
      allSessions: new Map([['s1', session]]),
    })

    expect(result.groupedTasks.get('p1')![0].title).toBe('Follow-up: Original Task')
  })
})
