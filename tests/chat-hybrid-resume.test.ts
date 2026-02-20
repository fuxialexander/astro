/**
 * Chat Hybrid Resume/Fallback Tests
 *
 * Tests the hybrid session resume logic in /api/agent/chat and /api/agent/task-chat:
 * - Pool-based SDK resume (fast path) when provider supports it
 * - Inline history fallback when no pool entry or provider mismatch
 * - Session storage after successful completion
 * - Stale pool entry cleanup on resume failure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'

// ============================================================================
// Mock Setup
// ============================================================================

const testSessions = new Map<string, { abortController: AbortController; providerId?: string; sessionId?: string }>()

vi.mock('../server/lib/session-manager.js', () => ({
  createSession: (sessionId: string, providerId?: string) => {
    const controller = new AbortController()
    testSessions.set(sessionId, { abortController: controller, providerId })
    return controller
  },
  abortSession: (sessionId: string) => {
    const session = testSessions.get(sessionId)
    if (session) {
      session.abortController.abort()
      testSessions.delete(sessionId)
      return true
    }
    return false
  },
  removeSession: (sessionId: string) => {
    testSessions.delete(sessionId)
  },
  getSession: (sessionId: string) => testSessions.get(sessionId),
  updateSession: () => true,
}))

vi.mock('../server/middleware/auth.js', () => ({
  requireAuth: async (_c: unknown, next: () => Promise<void>) => {
    await next()
  },
}))

// Chat session pool mock — track calls for assertions
const mockPool = {
  storeSession: vi.fn(),
  getSession: vi.fn<(key: string) => { sdkSessionId: string; providerId: string; createdAt: number; lastUsedAt: number } | undefined>().mockReturnValue(undefined),
  removeSession: vi.fn(),
}

vi.mock('../server/lib/chat-session-pool.js', () => mockPool)

// Track dispatched tasks to inspect prompt/sessionId/messages
let lastDispatchedTask: Record<string, unknown> | null = null

// Provider stream events to yield
let mockStreamEvents: Array<Record<string, unknown>> = []

// Whether this mock provider supports session resume
let mockSupportsResume = true

// The provider ID to report
let mockProviderId = 'claude-code'

// Whether stream should throw an error
let mockStreamShouldThrow = false

vi.mock('../server/lib/providers/index.js', () => {
  const createMockProvider = () => ({
    get id() { return mockProviderId },
    get name() { return 'Mock Provider' },
    capabilities: () => ({
      availableModels: ['test-model'],
      defaultModel: 'test-model',
      supportsSessionResume: mockSupportsResume,
    }),
    stream: async function* (task: Record<string, unknown>) {
      lastDispatchedTask = task
      if (mockStreamShouldThrow) {
        throw new Error('Resume failed')
      }
      for (const event of mockStreamEvents) {
        yield event
      }
    },
    execute: async () => ({ status: 'success', stdout: '' }),
    cancel: async () => {},
  })

  return {
    providerRegistry: {
      getProvider: () => createMockProvider(),
      getDefaultProvider: () => createMockProvider(),
      getRegisteredProvider: () => {
        const p = createMockProvider()
        return { available: true, provider: p }
      },
      getStatusSummary: () => ({ total: 1, available: 1, installed: 1, authenticated: 1, providers: [] }),
      detectAll: async () => new Map(),
    },
  }
})

vi.mock('../server/lib/prompt-templates.js', () => ({
  buildChatSystemPrompt: () => 'system prompt',
  buildPlanSystemPrompt: () => 'plan system prompt',
  buildTaskChatSystemPrompt: () => 'task chat system prompt',
  buildTaskExecutionPrompt: () => 'execution prompt',
  buildSummaryPrompt: () => 'summary prompt',
  PLAN_GRAPH_SCHEMA: {},
}))

vi.mock('../server/lib/repo-context.js', () => ({
  readRepoContext: () => ({}),
}))

vi.mock('../server/lib/relay-server.js', () => ({
  relayServer: {
    on: () => {},
    off: () => {},
    dispatchTask: () => true,
    cancelTask: () => {},
  },
}))

vi.mock('../server/lib/error-utils.js', () => ({
  errorMessage: (e: Error) => e.message || String(e),
  isAbortError: (e: Error) => e.name === 'AbortError',
}))

// ============================================================================
// Helpers
// ============================================================================

let app: Hono

beforeEach(async () => {
  vi.resetModules()
  testSessions.clear()
  mockStreamEvents = []
  lastDispatchedTask = null
  mockSupportsResume = true
  mockProviderId = 'claude-code'
  mockStreamShouldThrow = false
  mockPool.storeSession.mockClear()
  mockPool.getSession.mockClear()
  mockPool.getSession.mockReturnValue(undefined)
  mockPool.removeSession.mockClear()

  const { agentRoute } = await import('../server/routes/agent.js')
  app = new Hono()
  app.route('/api/agent', agentRoute)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function parseSSEFromResponse(response: Response): Promise<Array<{ event: string; data: string }>> {
  const text = await response.text()
  const events: Array<{ event: string; data: string }> = []
  let currentEvent = ''
  const dataLines: string[] = []

  for (const line of text.split('\n')) {
    if (line.startsWith('event:')) {
      if (currentEvent && dataLines.length > 0) {
        events.push({ event: currentEvent, data: dataLines.join('\n').trim() })
        dataLines.length = 0
      }
      currentEvent = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5))
    } else if (line === '') {
      if (currentEvent && dataLines.length > 0) {
        events.push({ event: currentEvent, data: dataLines.join('\n').trim() })
        dataLines.length = 0
        currentEvent = ''
      }
    }
  }
  if (currentEvent && dataLines.length > 0) {
    events.push({ event: currentEvent, data: dataLines.join('\n').trim() })
  }

  return events
}

// ============================================================================
// /api/agent/chat — Hybrid Resume Tests
// ============================================================================

describe('/api/agent/chat — hybrid resume', () => {
  it('resumes from pool when entry exists and provider matches', async () => {
    mockPool.getSession.mockReturnValue({
      sdkSessionId: 'sdk-session-abc',
      providerId: 'claude-code',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    })

    mockStreamEvents = [
      { type: 'text', text: 'Resumed!' },
      { type: 'result', result: { sessionId: 'sdk-session-abc-new', status: 'success' } },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'follow up',
        projectId: 'proj-1',
        messages: [
          { role: 'user', content: 'First msg' },
          { role: 'assistant', content: 'First reply' },
        ],
      }),
    })

    expect(res.status).toBe(200)
    await parseSSEFromResponse(res)

    // Pool was queried with correct key
    expect(mockPool.getSession).toHaveBeenCalledWith('proj-1:plan-chat')

    // Task was dispatched with pool session ID, not embedded history
    expect(lastDispatchedTask).not.toBeNull()
    expect(lastDispatchedTask!.sessionId).toBe('sdk-session-abc')
    expect(lastDispatchedTask!.prompt).toBe('follow up') // No history prefix
  })

  it('falls back to inline history when pool is empty', async () => {
    mockPool.getSession.mockReturnValue(undefined)

    mockStreamEvents = [
      { type: 'text', text: 'OK' },
      { type: 'result', result: { sessionId: 'new-session', status: 'success' } },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'follow up',
        projectId: 'proj-1',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
        ],
      }),
    })

    expect(res.status).toBe(200)
    await parseSSEFromResponse(res)

    // Task dispatched with embedded history in prompt
    expect(lastDispatchedTask).not.toBeNull()
    expect(lastDispatchedTask!.sessionId).toBeUndefined()
    expect(lastDispatchedTask!.prompt).toContain('Previous conversation:')
    expect(lastDispatchedTask!.prompt).toContain('User: Hello')
    expect(lastDispatchedTask!.prompt).toContain('Assistant: Hi there')
  })

  it('stores session in pool after successful result', async () => {
    mockStreamEvents = [
      { type: 'text', text: 'Done' },
      { type: 'result', result: { sessionId: 'returned-sdk-session', status: 'success' } },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
        projectId: 'proj-42',
      }),
    })

    await parseSSEFromResponse(res)

    // storeSession called with correct args
    expect(mockPool.storeSession).toHaveBeenCalledWith(
      'proj-42:plan-chat',
      'returned-sdk-session',
      'claude-code',
    )
  })

  it('removes stale pool entry on resume failure', async () => {
    mockPool.getSession.mockReturnValue({
      sdkSessionId: 'stale-session',
      providerId: 'claude-code',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    })

    mockStreamShouldThrow = true

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'follow up',
        projectId: 'proj-1',
        messages: [
          { role: 'user', content: 'prev' },
          { role: 'assistant', content: 'prev reply' },
        ],
      }),
    })

    const events = await parseSSEFromResponse(res)

    // Should have an error event
    const errorEvents = events.filter((e) => e.event === 'error')
    expect(errorEvents.length).toBeGreaterThan(0)

    // Stale entry should be removed
    expect(mockPool.removeSession).toHaveBeenCalledWith('proj-1:plan-chat')
  })

  it('falls back to inline history on provider mismatch', async () => {
    // Pool has entry from a different provider
    mockPool.getSession.mockReturnValue({
      sdkSessionId: 'other-session',
      providerId: 'other-provider',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    })

    mockStreamEvents = [
      { type: 'text', text: 'OK' },
      { type: 'result', result: { sessionId: 'new-s', status: 'success' } },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'follow up',
        projectId: 'proj-1',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
      }),
    })

    await parseSSEFromResponse(res)

    // Should have fallen back to inline history
    expect(lastDispatchedTask!.sessionId).toBeUndefined()
    expect(lastDispatchedTask!.prompt).toContain('Previous conversation:')
  })

  it('works normally for first message (no history)', async () => {
    mockStreamEvents = [
      { type: 'text', text: 'Hi!' },
      { type: 'result', result: { sessionId: 'first-session', status: 'success' } },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello world',
        projectId: 'proj-1',
      }),
    })

    expect(res.status).toBe(200)
    await parseSSEFromResponse(res)

    // No pool lookup for first message (no history)
    expect(mockPool.getSession).not.toHaveBeenCalled()

    // Prompt is just the message, no history prefix
    expect(lastDispatchedTask!.prompt).toBe('hello world')
  })

  it('passes messages array when provider does not support resume', async () => {
    mockSupportsResume = false

    mockStreamEvents = [
      { type: 'text', text: 'OK' },
      { type: 'result', result: { sessionId: 's1', status: 'success' } },
    ]

    const history = [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Reply' },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'follow up',
        projectId: 'proj-1',
        messages: history,
      }),
    })

    await parseSSEFromResponse(res)

    // Should not have looked up pool
    expect(mockPool.getSession).not.toHaveBeenCalled()

    // Messages passed directly, prompt unchanged
    expect(lastDispatchedTask!.messages).toEqual(history)
    expect(lastDispatchedTask!.prompt).toBe('follow up')
  })

  it('does not store session when provider does not support resume', async () => {
    mockSupportsResume = false

    mockStreamEvents = [
      { type: 'result', result: { sessionId: 's1', status: 'success' } },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
        projectId: 'proj-1',
      }),
    })

    await parseSSEFromResponse(res)

    expect(mockPool.storeSession).not.toHaveBeenCalled()
  })
})

// ============================================================================
// /api/agent/task-chat — Hybrid Resume Tests
// ============================================================================

describe('/api/agent/task-chat — hybrid resume', () => {
  it('resumes from pool with task-chat key', async () => {
    mockPool.getSession.mockReturnValue({
      sdkSessionId: 'task-sdk-session',
      providerId: 'claude-code',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    })

    mockStreamEvents = [
      { type: 'text', text: 'Resumed task chat' },
      { type: 'result', result: { sessionId: 'task-sdk-session-new', status: 'success' } },
    ]

    const res = await app.request('/api/agent/task-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'help with this task',
        projectId: 'proj-1',
        nodeId: 'node-42',
        taskTitle: 'Test Task',
        taskDescription: 'A test task',
        messages: [
          { role: 'user', content: 'earlier question' },
          { role: 'assistant', content: 'earlier answer' },
        ],
      }),
    })

    expect(res.status).toBe(200)
    await parseSSEFromResponse(res)

    // Pool queried with task-chat key including nodeId
    expect(mockPool.getSession).toHaveBeenCalledWith('proj-1:task-chat:node-42')

    // Dispatched with pool session ID
    expect(lastDispatchedTask!.sessionId).toBe('task-sdk-session')
    expect(lastDispatchedTask!.prompt).toBe('help with this task')
  })

  it('stores session with task-chat key after success', async () => {
    mockStreamEvents = [
      { type: 'result', result: { sessionId: 'task-session-returned', status: 'success' } },
    ]

    const res = await app.request('/api/agent/task-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
        projectId: 'proj-5',
        nodeId: 'node-99',
        taskTitle: 'Task',
        taskDescription: 'Desc',
      }),
    })

    await parseSSEFromResponse(res)

    expect(mockPool.storeSession).toHaveBeenCalledWith(
      'proj-5:task-chat:node-99',
      'task-session-returned',
      'claude-code',
    )
  })

  it('removes stale task-chat pool entry on failure', async () => {
    mockPool.getSession.mockReturnValue({
      sdkSessionId: 'stale-task-session',
      providerId: 'claude-code',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    })

    mockStreamShouldThrow = true

    const res = await app.request('/api/agent/task-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'follow up',
        projectId: 'proj-1',
        nodeId: 'node-7',
        taskTitle: 'Task',
        taskDescription: 'Desc',
        messages: [
          { role: 'user', content: 'prev' },
          { role: 'assistant', content: 'prev reply' },
        ],
      }),
    })

    await parseSSEFromResponse(res)

    expect(mockPool.removeSession).toHaveBeenCalledWith('proj-1:task-chat:node-7')
  })

  it('falls back to inline history when pool empty for task-chat', async () => {
    mockPool.getSession.mockReturnValue(undefined)

    mockStreamEvents = [
      { type: 'result', result: { sessionId: 'new', status: 'success' } },
    ]

    const res = await app.request('/api/agent/task-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'next question',
        projectId: 'proj-1',
        nodeId: 'node-1',
        taskTitle: 'Task',
        taskDescription: 'Desc',
        messages: [
          { role: 'user', content: 'Q1' },
          { role: 'assistant', content: 'A1' },
        ],
      }),
    })

    await parseSSEFromResponse(res)

    expect(lastDispatchedTask!.sessionId).toBeUndefined()
    expect(lastDispatchedTask!.prompt).toContain('Previous conversation:')
    expect(lastDispatchedTask!.prompt).toContain('User: Q1')
  })
})
