/**
 * Active Tasks — Streaming Session Inclusion Tests
 *
 * Verifies that the Active Tasks page includes streaming playground/chat
 * sessions that are tracked in streamingSessions but NOT in the execution
 * store. This was the root cause of the sidebar badge showing "1" while
 * the active tasks page showed nothing.
 */
import { describe, it, expect } from 'vitest'

// ============================================================================
// Minimal types mirroring the active-tasks.tsx logic
// ============================================================================

interface ActiveTask {
  nodeId: string
  projectId: string
  title: string
  status: 'running' | 'pending' | 'generating'
  startedAt?: Date
}

interface Execution {
  status: 'running' | 'pending' | 'success' | 'failure' | 'cancelled'
  projectId?: string
  executionId?: string
  startedAt?: Date
  machineId?: string
  providerId?: string
}

interface Session {
  id: string
  type: 'project-chat' | 'task-chat' | 'execution' | 'steer'
  projectId: string
  title?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  updatedAt: Date
}

interface Project {
  id: string
  name: string
}

/**
 * Replicates the core logic of active-tasks.tsx's useMemo that builds
 * the grouped task list from executions + streaming sessions.
 */
function buildActiveTaskList(
  executions: Map<string, Execution>,
  streamingSessions: Set<string>,
  allSessions: Map<string, Session>,
  projects: Project[],
): { taskMap: Map<string, ActiveTask[]>; totalCount: number } {
  const taskMap = new Map<string, ActiveTask[]>()
  const addedNodeIds = new Set<string>()

  // 1. Add active executions
  for (const [nodeId, exec] of executions) {
    if (exec.status !== 'pending' && exec.status !== 'running') continue
    const projectId = exec.projectId
    if (!projectId) continue

    const isPlayground = nodeId.startsWith('playground-')
    const title = isPlayground
      ? (projects.find((p) => p.id === projectId)?.name || 'Playground Session')
      : `Task ${nodeId.slice(0, 8)}`

    const list = taskMap.get(projectId) || []
    list.push({
      nodeId,
      projectId,
      title,
      status: exec.status === 'running' ? 'running' : 'pending',
      startedAt: exec.startedAt,
    })
    taskMap.set(projectId, list)
    addedNodeIds.add(nodeId)
  }

  // 2. Add streaming sessions not already covered by executions
  for (const sessionId of streamingSessions) {
    const session = allSessions.get(sessionId)
    if (!session?.projectId) continue

    const isPlayground = session.type === 'task-chat'
    const stableNodeId = isPlayground
      ? `playground-${session.projectId}`
      : `chat-${sessionId}`

    if (addedNodeIds.has(stableNodeId) || addedNodeIds.has(sessionId)) continue

    const proj = projects.find((p) => p.id === session.projectId)
    const title = session.title
      || session.messages.find((m) => m.role === 'user')?.content.slice(0, 50)
      || proj?.name
      || 'Chat Session'

    const list = taskMap.get(session.projectId) || []
    list.push({
      nodeId: stableNodeId,
      projectId: session.projectId,
      title: isPlayground ? title : `Chat: ${title}`,
      status: 'running',
      startedAt: session.updatedAt,
    })
    taskMap.set(session.projectId, list)
  }

  let count = 0
  for (const tasks of taskMap.values()) count += tasks.length
  return { taskMap, totalCount: count }
}

// ============================================================================
// Tests
// ============================================================================

describe('Active Tasks: streaming sessions included', () => {
  it('includes streaming playground session when no execution exists', () => {
    const executions = new Map<string, Execution>()
    const streamingSessions = new Set(['session-1'])
    const allSessions = new Map<string, Session>([
      ['session-1', {
        id: 'session-1',
        type: 'task-chat',
        projectId: 'proj-1',
        title: 'Debug auth flow',
        messages: [{ role: 'user', content: 'Fix the login bug' }],
        updatedAt: new Date(),
      }],
    ])
    const projects: Project[] = [{ id: 'proj-1', name: 'My Project' }]

    const { taskMap, totalCount } = buildActiveTaskList(
      executions, streamingSessions, allSessions, projects,
    )

    expect(totalCount).toBe(1)
    const tasks = taskMap.get('proj-1')!
    expect(tasks).toHaveLength(1)
    expect(tasks[0].nodeId).toBe('playground-proj-1')
    expect(tasks[0].title).toBe('Debug auth flow')
    expect(tasks[0].status).toBe('running')
  })

  it('does NOT double-count when execution already exists for same playground', () => {
    const executions = new Map<string, Execution>([
      ['playground-proj-1', {
        status: 'running',
        projectId: 'proj-1',
        startedAt: new Date(),
      }],
    ])
    const streamingSessions = new Set(['session-1'])
    const allSessions = new Map<string, Session>([
      ['session-1', {
        id: 'session-1',
        type: 'task-chat',
        projectId: 'proj-1',
        messages: [],
        updatedAt: new Date(),
      }],
    ])
    const projects: Project[] = [{ id: 'proj-1', name: 'My Project' }]

    const { totalCount } = buildActiveTaskList(
      executions, streamingSessions, allSessions, projects,
    )

    // Should be 1, not 2
    expect(totalCount).toBe(1)
  })

  it('includes project-chat streaming session', () => {
    const executions = new Map<string, Execution>()
    const streamingSessions = new Set(['chat-session-1'])
    const allSessions = new Map<string, Session>([
      ['chat-session-1', {
        id: 'chat-session-1',
        type: 'project-chat',
        projectId: 'proj-1',
        messages: [{ role: 'user', content: 'Refactor the module structure' }],
        updatedAt: new Date(),
      }],
    ])
    const projects: Project[] = [{ id: 'proj-1', name: 'Refactor Project' }]

    const { taskMap, totalCount } = buildActiveTaskList(
      executions, streamingSessions, allSessions, projects,
    )

    expect(totalCount).toBe(1)
    const tasks = taskMap.get('proj-1')!
    expect(tasks[0].title).toBe('Chat: Refactor the module structure')
  })

  it('uses session.title when available', () => {
    const executions = new Map<string, Execution>()
    const streamingSessions = new Set(['s1'])
    const allSessions = new Map<string, Session>([
      ['s1', {
        id: 's1',
        type: 'task-chat',
        projectId: 'p1',
        title: 'Custom Title',
        messages: [{ role: 'user', content: 'This is a long message that should not be used' }],
        updatedAt: new Date(),
      }],
    ])

    const { taskMap } = buildActiveTaskList(
      executions, streamingSessions, allSessions, [],
    )

    expect(taskMap.get('p1')![0].title).toBe('Custom Title')
  })

  it('falls back to first user message when no title', () => {
    const executions = new Map<string, Execution>()
    const streamingSessions = new Set(['s1'])
    const allSessions = new Map<string, Session>([
      ['s1', {
        id: 's1',
        type: 'task-chat',
        projectId: 'p1',
        messages: [{ role: 'user', content: 'Help me debug the API' }],
        updatedAt: new Date(),
      }],
    ])

    const { taskMap } = buildActiveTaskList(
      executions, streamingSessions, allSessions, [],
    )

    expect(taskMap.get('p1')![0].title).toBe('Help me debug the API')
  })

  it('falls back to project name when no title and no messages', () => {
    const executions = new Map<string, Execution>()
    const streamingSessions = new Set(['s1'])
    const allSessions = new Map<string, Session>([
      ['s1', {
        id: 's1',
        type: 'task-chat',
        projectId: 'p1',
        messages: [],
        updatedAt: new Date(),
      }],
    ])
    const projects: Project[] = [{ id: 'p1', name: 'My Playground' }]

    const { taskMap } = buildActiveTaskList(
      executions, streamingSessions, allSessions, projects,
    )

    expect(taskMap.get('p1')![0].title).toBe('My Playground')
  })

  it('falls back to "Chat Session" when nothing else available', () => {
    const executions = new Map<string, Execution>()
    const streamingSessions = new Set(['s1'])
    const allSessions = new Map<string, Session>([
      ['s1', {
        id: 's1',
        type: 'task-chat',
        projectId: 'p1',
        messages: [],
        updatedAt: new Date(),
      }],
    ])

    const { taskMap } = buildActiveTaskList(
      executions, streamingSessions, allSessions, [],
    )

    expect(taskMap.get('p1')![0].title).toBe('Chat Session')
  })

  it('handles multiple streaming sessions across projects', () => {
    const executions = new Map<string, Execution>()
    const streamingSessions = new Set(['s1', 's2'])
    const allSessions = new Map<string, Session>([
      ['s1', {
        id: 's1',
        type: 'task-chat',
        projectId: 'p1',
        title: 'Session A',
        messages: [],
        updatedAt: new Date(),
      }],
      ['s2', {
        id: 's2',
        type: 'task-chat',
        projectId: 'p2',
        title: 'Session B',
        messages: [],
        updatedAt: new Date(),
      }],
    ])

    const { totalCount, taskMap } = buildActiveTaskList(
      executions, streamingSessions, allSessions, [],
    )

    expect(totalCount).toBe(2)
    expect(taskMap.get('p1')!).toHaveLength(1)
    expect(taskMap.get('p2')!).toHaveLength(1)
  })

  it('mixes executions and streaming sessions correctly', () => {
    const executions = new Map<string, Execution>([
      ['task-node-1', {
        status: 'running',
        projectId: 'p1',
        startedAt: new Date(),
      }],
    ])
    const streamingSessions = new Set(['s1'])
    const allSessions = new Map<string, Session>([
      ['s1', {
        id: 's1',
        type: 'task-chat',
        projectId: 'p1',
        title: 'Playground Chat',
        messages: [],
        updatedAt: new Date(),
      }],
    ])

    const { totalCount, taskMap } = buildActiveTaskList(
      executions, streamingSessions, allSessions, [],
    )

    // Both the execution and the streaming session should appear
    expect(totalCount).toBe(2)
    expect(taskMap.get('p1')!).toHaveLength(2)
  })

  it('skips sessions without projectId', () => {
    const executions = new Map<string, Execution>()
    const streamingSessions = new Set(['s1'])
    const allSessions = new Map<string, Session>([
      ['s1', {
        id: 's1',
        type: 'task-chat',
        projectId: '', // empty
        messages: [],
        updatedAt: new Date(),
      }],
    ])

    const { totalCount } = buildActiveTaskList(
      executions, streamingSessions, allSessions, [],
    )

    expect(totalCount).toBe(0)
  })

  it('skips completed executions', () => {
    const executions = new Map<string, Execution>([
      ['playground-p1', { status: 'success', projectId: 'p1' }],
      ['task-1', { status: 'failure', projectId: 'p1' }],
    ])

    const { totalCount } = buildActiveTaskList(
      executions, new Set(), new Map(), [],
    )

    expect(totalCount).toBe(0)
  })
})
