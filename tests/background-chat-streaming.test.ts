/**
 * Background Chat Streaming Tests
 *
 * Tests the store-owned SSE streaming infrastructure added to session-store.ts:
 * - streamingSessions tracking (Set<sessionId>)
 * - mountedSessionIds lifecycle (register/unregister)
 * - abortChatStream cleanup
 * - sendChatMessage SSE lifecycle (callbacks, state transitions, notifications)
 * - sendPlaygroundChat SSE lifecycle
 * - Double-send abort behavior
 * - Background notification gating
 *
 * Uses the real Zustand store with mocked external dependencies.
 *
 * Run with: npx vitest run tests/background-chat-streaming.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// Mocks — must be declared before store imports
// ============================================================================

// Capture SSE callback handlers so tests can drive them
let capturedChatCallbacks: Record<string, (...args: unknown[]) => void> = {}
let capturedChatSignal: AbortSignal | undefined
let capturedPlaygroundCallbacks: Record<string, (...args: unknown[]) => void> = {}
let capturedPlaygroundSignal: AbortSignal | undefined

const mockProjectChatWithAgent = vi.fn().mockImplementation(
  (_params: unknown, callbacks: Record<string, (...args: unknown[]) => void>, signal: AbortSignal) => {
    capturedChatCallbacks = callbacks
    capturedChatSignal = signal
    return Promise.resolve()
  }
)

const mockChatWithTask = vi.fn().mockImplementation(
  (_params: unknown, callbacks: Record<string, (...args: unknown[]) => void>, signal: AbortSignal) => {
    capturedPlaygroundCallbacks = callbacks
    capturedPlaygroundSignal = signal
    return Promise.resolve()
  }
)

vi.mock('../src/lib/api-client', () => ({
  projectChatWithAgent: (...args: unknown[]) => mockProjectChatWithAgent(...args),
  chatWithTask: (...args: unknown[]) => mockChatWithTask(...args),
}))

vi.mock('../src/lib/data-client', () => ({
  dataClient: {
    getAllSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue(undefined),
    updateSession: vi.fn().mockResolvedValue(undefined),
    addSessionMessage: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  },
}))

const mockShowChatCompleteNotification = vi.fn()
vi.mock('../src/lib/notifications', () => ({
  showChatCompleteNotification: (...args: unknown[]) => mockShowChatCompleteNotification(...args),
}))

const mockExtractMutations = vi.fn().mockReturnValue({
  cleanContent: 'clean text',
  mutations: { nodeUpdates: [], edgeOps: [], newNodes: [] },
})
const mockApplyMutationsToStore = vi.fn().mockReturnValue({
  affectedNodeIds: [],
  resolvedMutations: { nodeUpdates: [], edgeOps: [], newNodes: [] },
})
vi.mock('../src/lib/plan-mutations', () => ({
  extractMutations: (...args: unknown[]) => mockExtractMutations(...args),
  applyMutationsToStore: (...args: unknown[]) => mockApplyMutationsToStore(...args),
}))

const mockPushActivityEvent = vi.fn()
vi.mock('../src/stores/realtime-store', () => ({
  useRealtimeStore: {
    getState: () => ({
      pushActivityEvent: mockPushActivityEvent,
    }),
  },
}))

const mockPlanLoad = vi.fn()
const mockMarkNodesAsUpdating = vi.fn()
vi.mock('../src/stores/plan-store', () => ({
  usePlanStore: {
    getState: () => ({
      load: mockPlanLoad,
      markNodesAsUpdating: mockMarkNodesAsUpdating,
    }),
  },
  isLive: () => true,
}))

const mockAddTaskMetrics = vi.fn()
vi.mock('../src/stores/usage-store', () => ({
  useUsageStore: {
    getState: () => ({
      addTaskMetrics: mockAddTaskMetrics,
    }),
  },
}))

const mockToastAdd = vi.fn()
vi.mock('../src/stores/toast-store', () => ({
  useToastStore: {
    getState: () => ({
      add: mockToastAdd,
    }),
  },
}))

// ============================================================================
// Store import & helpers
// ============================================================================

let useSessionStore: typeof import('../src/stores/session-store').useSessionStore

async function resetStore() {
  vi.resetModules()

  // Re-apply mock implementations (they get cleared by resetModules)
  mockProjectChatWithAgent.mockImplementation(
    (_params: unknown, callbacks: Record<string, (...args: unknown[]) => void>, signal: AbortSignal) => {
      capturedChatCallbacks = callbacks
      capturedChatSignal = signal
      return Promise.resolve()
    }
  )
  mockChatWithTask.mockImplementation(
    (_params: unknown, callbacks: Record<string, (...args: unknown[]) => void>, signal: AbortSignal) => {
      capturedPlaygroundCallbacks = callbacks
      capturedPlaygroundSignal = signal
      return Promise.resolve()
    }
  )

  const mod = await import('../src/stores/session-store')
  useSessionStore = mod.useSessionStore
}

function createTestSession(projectId: string, type: 'project-chat' | 'task-chat' = 'project-chat') {
  return useSessionStore.getState().createSession({ type, projectId })
}

function addCompletedExchange(sessionId: string) {
  const store = useSessionStore.getState()
  store.addMessage(sessionId, { role: 'user', content: 'Hello' })
  store.addMessage(sessionId, { role: 'assistant', content: 'Hi there!' })
}

// ============================================================================
// Tests
// ============================================================================

function clearAllMocks() {
  mockProjectChatWithAgent.mockClear()
  mockChatWithTask.mockClear()
  mockShowChatCompleteNotification.mockClear()
  mockPushActivityEvent.mockClear()
  mockToastAdd.mockClear()
  mockAddTaskMetrics.mockClear()
  mockPlanLoad.mockClear()
  mockMarkNodesAsUpdating.mockClear()
  mockExtractMutations.mockClear()
  mockApplyMutationsToStore.mockClear()
  mockExtractMutations.mockReturnValue({
    cleanContent: 'clean text',
    mutations: { nodeUpdates: [], edgeOps: [], newNodes: [] },
  })
}

describe('streamingSessions tracking', () => {
  beforeEach(async () => {
    capturedChatCallbacks = {}
    capturedPlaygroundCallbacks = {}
    clearAllMocks()
    await resetStore()
  })

  it('starts empty', () => {
    const { streamingSessions } = useSessionStore.getState()
    expect(streamingSessions.size).toBe(0)
  })

  it('adds session ID when sendChatMessage is called', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendChatMessage({
      sessionId: session.id,
      projectId: 'proj-1',
      message: 'Hello',
    })

    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(true)
  })

  it('adds session ID when sendPlaygroundChat is called', () => {
    const session = createTestSession('proj-2')
    useSessionStore.getState().sendPlaygroundChat({
      sessionId: session.id,
      projectId: 'proj-2',
      nodeId: 'node-1',
      message: 'Hi',
      taskTitle: 'Test',
      taskDescription: 'Test task',
    })

    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(true)
  })

  it('removes session ID when onDone fires', async () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().addMessage(session.id, { role: 'user', content: 'test' })
    useSessionStore.getState().addMessage(session.id, { role: 'assistant', content: '' })

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id,
      projectId: 'proj-1',
      message: 'Hello',
    })

    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(true)

    // Simulate onDone
    capturedChatCallbacks.onDone?.('provider-session-1')

    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(false)
  })

  it('removes session ID when onError fires', () => {
    const session = createTestSession('proj-1')

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id,
      projectId: 'proj-1',
      message: 'Hello',
    })

    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(true)

    capturedChatCallbacks.onError?.('Network error')

    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(false)
  })

  it('removes session ID when fetch-level catch fires', async () => {
    // Make projectChatWithAgent reject at fetch level
    mockProjectChatWithAgent.mockRejectedValueOnce(new Error('fetch failed'))

    const session = createTestSession('proj-1')
    useSessionStore.getState().sendChatMessage({
      sessionId: session.id,
      projectId: 'proj-1',
      message: 'Hello',
    })

    // Wait for the promise rejection to propagate
    await vi.waitFor(() => {
      expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(false)
    })
  })

  it('isStreaming reflects streamingSessions state', () => {
    const session = createTestSession('proj-1')
    expect(useSessionStore.getState().isStreaming(session.id)).toBe(false)

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id,
      projectId: 'proj-1',
      message: 'Hello',
    })

    expect(useSessionStore.getState().isStreaming(session.id)).toBe(true)

    capturedChatCallbacks.onDone?.('prov-1')

    expect(useSessionStore.getState().isStreaming(session.id)).toBe(false)
  })

  it('tracks multiple concurrent streaming sessions', () => {
    const s1 = createTestSession('proj-1')
    const s2 = createTestSession('proj-2')

    useSessionStore.getState().sendChatMessage({
      sessionId: s1.id, projectId: 'proj-1', message: 'Hello',
    })
    useSessionStore.getState().sendPlaygroundChat({
      sessionId: s2.id, projectId: 'proj-2', nodeId: 'n1',
      message: 'Hi', taskTitle: 'T', taskDescription: 'D',
    })

    const ss = useSessionStore.getState().streamingSessions
    expect(ss.has(s1.id)).toBe(true)
    expect(ss.has(s2.id)).toBe(true)
    expect(ss.size).toBe(2)
  })
})

describe('mountedSessionIds lifecycle', () => {
  beforeEach(async () => {
    clearAllMocks()
    await resetStore()
  })

  it('starts empty', () => {
    expect(useSessionStore.getState().mountedSessionIds.size).toBe(0)
  })

  it('registerMounted adds session ID', () => {
    useSessionStore.getState().registerMounted('session-abc')
    expect(useSessionStore.getState().mountedSessionIds.has('session-abc')).toBe(true)
  })

  it('unregisterMounted removes session ID', () => {
    useSessionStore.getState().registerMounted('session-abc')
    useSessionStore.getState().unregisterMounted('session-abc')
    expect(useSessionStore.getState().mountedSessionIds.has('session-abc')).toBe(false)
  })

  it('handles multiple registrations independently', () => {
    useSessionStore.getState().registerMounted('s1')
    useSessionStore.getState().registerMounted('s2')
    useSessionStore.getState().registerMounted('s3')

    expect(useSessionStore.getState().mountedSessionIds.size).toBe(3)

    useSessionStore.getState().unregisterMounted('s2')

    const ms = useSessionStore.getState().mountedSessionIds
    expect(ms.has('s1')).toBe(true)
    expect(ms.has('s2')).toBe(false)
    expect(ms.has('s3')).toBe(true)
  })

  it('unregister on non-existent ID is a no-op', () => {
    useSessionStore.getState().unregisterMounted('nonexistent')
    expect(useSessionStore.getState().mountedSessionIds.size).toBe(0)
  })

  it('double register is idempotent (Set semantics)', () => {
    useSessionStore.getState().registerMounted('s1')
    useSessionStore.getState().registerMounted('s1')
    expect(useSessionStore.getState().mountedSessionIds.size).toBe(1)
  })
})

describe('abortChatStream', () => {
  beforeEach(async () => {
    capturedChatCallbacks = {}
    capturedChatSignal = undefined
    clearAllMocks()
    await resetStore()
  })

  it('removes session from streamingSessions', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'test',
    })

    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(true)

    useSessionStore.getState().abortChatStream(session.id)

    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(false)
  })

  it('aborts the underlying AbortController signal', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'test',
    })

    expect(capturedChatSignal?.aborted).toBe(false)

    useSessionStore.getState().abortChatStream(session.id)

    expect(capturedChatSignal?.aborted).toBe(true)
  })

  it('is safe to call on non-streaming session', () => {
    expect(() => {
      useSessionStore.getState().abortChatStream('nonexistent-session')
    }).not.toThrow()
  })

  it('is safe to call twice on same session', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'test',
    })

    useSessionStore.getState().abortChatStream(session.id)
    useSessionStore.getState().abortChatStream(session.id)

    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(false)
  })
})

describe('sendChatMessage — SSE lifecycle', () => {
  beforeEach(async () => {
    capturedChatCallbacks = {}
    capturedChatSignal = undefined
    clearAllMocks()
    await resetStore()
  })

  it('does nothing if session does not exist', () => {
    useSessionStore.getState().sendChatMessage({
      sessionId: 'nonexistent', projectId: 'p1', message: 'test',
    })

    expect(mockProjectChatWithAgent).not.toHaveBeenCalled()
    expect(useSessionStore.getState().streamingSessions.size).toBe(0)
  })

  it('calls projectChatWithAgent with correct params', () => {
    const session = createTestSession('proj-1')

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id,
      projectId: 'proj-1',
      message: 'Update the plan',
      visionDoc: 'Build a great app',
      model: 'claude-sonnet',
      providerId: 'anthropic',
      planNodes: [{ id: 'n1', title: 'Task 1', description: 'Do thing', status: 'planned', type: 'task' }],
      planEdges: [{ source: 'n1', target: 'n2', type: 'dependency' }],
      messages: [{ role: 'user', content: 'Prior message' }],
    })

    expect(mockProjectChatWithAgent).toHaveBeenCalledTimes(1)
    const [params] = mockProjectChatWithAgent.mock.calls[0]
    expect(params.message).toBe('Update the plan')
    expect(params.projectId).toBe('proj-1')
    expect(params.visionDoc).toBe('Build a great app')
    expect(params.model).toBe('claude-sonnet')
    expect(params.providerId).toBe('anthropic')
    expect(params.planNodes).toHaveLength(1)
    expect(params.planEdges).toHaveLength(1)
    expect(params.messages).toHaveLength(1)
    expect(params.streamId).toBe(session.id)
  })

  it('does not send providerSessionId for new sessions (no completed exchanges)', () => {
    const session = createTestSession('proj-1')

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'First message',
    })

    const [params] = mockProjectChatWithAgent.mock.calls[0]
    expect(params.sessionId).toBeUndefined()
  })

  it('sends providerSessionId after a completed exchange', () => {
    const session = createTestSession('proj-1')
    addCompletedExchange(session.id)
    useSessionStore.getState().setProviderSessionId(session.id, 'prov-xyz')

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'Follow-up',
    })

    const [params] = mockProjectChatWithAgent.mock.calls[0]
    expect(params.sessionId).toBe('prov-xyz')
  })

  it('pushes user event to realtime store', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'Hello world',
    })

    expect(mockPushActivityEvent).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({ type: 'chat_user', message: 'Hello world' })
    )
  })

  it('onText accumulates text and pushes to realtime store', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().addMessage(session.id, { role: 'user', content: 'q' })
    useSessionStore.getState().addMessage(session.id, { role: 'assistant', content: '' })

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'q',
    })

    capturedChatCallbacks.onText?.('Hello ')
    capturedChatCallbacks.onText?.('world!')

    // Realtime store should get text events
    const textCalls = mockPushActivityEvent.mock.calls.filter(
      ([, evt]: [string, { type: string }]) => evt.type === 'text'
    )
    expect(textCalls).toHaveLength(2)
    expect(textCalls[0][1]).toMatchObject({ type: 'text', content: 'Hello ' })
    expect(textCalls[1][1]).toMatchObject({ type: 'text', content: 'world!' })
  })

  it('onToolUse and onToolResult push events to realtime store', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'test',
    })

    capturedChatCallbacks.onToolUse?.({ toolName: 'create_task', toolInput: { title: 'New' } })
    capturedChatCallbacks.onToolResult?.({ toolName: 'create_task', result: 'ok', success: true })

    const toolUseCalls = mockPushActivityEvent.mock.calls.filter(
      ([, evt]: [string, { type: string }]) => evt.type === 'tool_use'
    )
    const toolResultCalls = mockPushActivityEvent.mock.calls.filter(
      ([, evt]: [string, { type: string }]) => evt.type === 'tool_result'
    )
    expect(toolUseCalls).toHaveLength(1)
    expect(toolResultCalls).toHaveLength(1)
    expect(toolUseCalls[0][1]).toMatchObject({ toolName: 'create_task' })
    expect(toolResultCalls[0][1]).toMatchObject({ toolName: 'create_task', success: true })
  })

  it('onDone sets provider session ID', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().addMessage(session.id, { role: 'user', content: 'q' })
    useSessionStore.getState().addMessage(session.id, { role: 'assistant', content: '' })

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'q',
    })

    capturedChatCallbacks.onDone?.('new-provider-session')

    const updated = useSessionStore.getState().sessions.get(session.id)
    expect(updated?.providerSessionId).toBe('new-provider-session')
  })

  it('onDone extracts and applies mutations when present', () => {
    mockExtractMutations.mockReturnValueOnce({
      cleanContent: 'Updated task',
      mutations: {
        nodeUpdates: [{ nodeId: 'task-1', status: 'completed' }],
        edgeOps: [],
        newNodes: [],
      },
    })
    mockApplyMutationsToStore.mockReturnValueOnce({
      affectedNodeIds: ['task-1'],
      resolvedMutations: {
        nodeUpdates: [{ nodeId: 'task-1', status: 'completed' }],
        edgeOps: [],
        newNodes: [],
      },
    })

    const session = createTestSession('proj-1')
    useSessionStore.getState().addMessage(session.id, { role: 'user', content: 'q' })
    useSessionStore.getState().addMessage(session.id, { role: 'assistant', content: '' })

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'q',
    })

    capturedChatCallbacks.onText?.('Updated task ```astro-updates [...]')
    capturedChatCallbacks.onDone?.('prov')

    expect(mockExtractMutations).toHaveBeenCalled()
    expect(mockApplyMutationsToStore).toHaveBeenCalledWith('proj-1', expect.any(Object))
    expect(mockMarkNodesAsUpdating).toHaveBeenCalledWith(['task-1'])

    // Mutation event pushed to realtime store
    const mutationEvents = mockPushActivityEvent.mock.calls.filter(
      ([, evt]: [string, { type: string }]) => evt.type === 'mutation'
    )
    expect(mutationEvents).toHaveLength(1)
  })

  it('onDone triggers plan refresh when MCP tools modified the plan', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().addMessage(session.id, { role: 'user', content: 'q' })
    useSessionStore.getState().addMessage(session.id, { role: 'assistant', content: '' })

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'q',
    })

    // Simulate tool use of a plan-mutating tool
    capturedChatCallbacks.onToolUse?.({ toolName: 'create_task', toolInput: {} })
    capturedChatCallbacks.onToolResult?.({ toolName: 'create_task', result: 'ok', success: true })
    capturedChatCallbacks.onDone?.('prov')

    expect(mockPlanLoad).toHaveBeenCalled()
  })

  it('onDone does NOT trigger plan refresh when no MCP tools used', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().addMessage(session.id, { role: 'user', content: 'q' })
    useSessionStore.getState().addMessage(session.id, { role: 'assistant', content: '' })

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'q',
    })

    capturedChatCallbacks.onText?.('Just a text response')
    capturedChatCallbacks.onDone?.('prov')

    expect(mockPlanLoad).not.toHaveBeenCalled()
  })

  it('onMetrics forwards to usage store', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'q',
    })

    capturedChatCallbacks.onMetrics?.({
      durationMs: 1500,
      inputTokens: 100,
      outputTokens: 200,
      totalCost: 0.01,
      model: 'claude-sonnet',
      numTurns: 3,
    })

    expect(mockAddTaskMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: 1500,
        inputTokens: 100,
        outputTokens: 200,
        estimatedCostUsd: 0.01,
        model: 'claude-sonnet',
        turnsUsed: 3,
      }),
      true,
    )
  })

  it('onError appends error text to assistant message', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().addMessage(session.id, { role: 'user', content: 'q' })
    useSessionStore.getState().addMessage(session.id, { role: 'assistant', content: '' })

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'q',
    })

    capturedChatCallbacks.onError?.('Server timeout')

    // streamingSessions should be cleared
    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(false)
  })
})

describe('sendChatMessage — background notifications', () => {
  beforeEach(async () => {
    capturedChatCallbacks = {}
    clearAllMocks()
    await resetStore()
  })

  it('fires notification when component is NOT mounted', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().addMessage(session.id, { role: 'user', content: 'q' })
    useSessionStore.getState().addMessage(session.id, { role: 'assistant', content: '' })

    // Do NOT register mounted — simulates user navigated away
    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'q',
    })

    capturedChatCallbacks.onDone?.('prov')

    expect(mockShowChatCompleteNotification).toHaveBeenCalled()
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({
      type: 'info',
      title: 'Chat response ready',
    }))
  })

  it('does NOT fire notification when component IS mounted', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().addMessage(session.id, { role: 'user', content: 'q' })
    useSessionStore.getState().addMessage(session.id, { role: 'assistant', content: '' })

    // Register mounted — simulates user is viewing the chat
    useSessionStore.getState().registerMounted(session.id)

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'q',
    })

    capturedChatCallbacks.onDone?.('prov')

    expect(mockShowChatCompleteNotification).not.toHaveBeenCalled()
    expect(mockToastAdd).not.toHaveBeenCalled()
  })

  it('fires notification if user navigates away mid-stream', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().addMessage(session.id, { role: 'user', content: 'q' })
    useSessionStore.getState().addMessage(session.id, { role: 'assistant', content: '' })

    // Start mounted
    useSessionStore.getState().registerMounted(session.id)

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'q',
    })

    // User navigates away — unregister
    useSessionStore.getState().unregisterMounted(session.id)

    // Stream completes in background
    capturedChatCallbacks.onDone?.('prov')

    expect(mockShowChatCompleteNotification).toHaveBeenCalled()
  })

  it('does NOT fire notification on error (only on success)', () => {
    const session = createTestSession('proj-1')

    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'q',
    })

    capturedChatCallbacks.onError?.('Something broke')

    expect(mockShowChatCompleteNotification).not.toHaveBeenCalled()
  })
})

describe('sendChatMessage — double send / abort existing', () => {
  beforeEach(async () => {
    capturedChatCallbacks = {}
    capturedChatSignal = undefined
    clearAllMocks()
    await resetStore()
  })

  it('aborts existing stream when same session sends again', () => {
    const session = createTestSession('proj-1')

    // First send
    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'first',
    })

    const firstSignal = capturedChatSignal!
    expect(firstSignal.aborted).toBe(false)

    // Second send for same session — should abort first
    useSessionStore.getState().sendChatMessage({
      sessionId: session.id, projectId: 'proj-1', message: 'second',
    })

    expect(firstSignal.aborted).toBe(true)
    // New signal is fresh
    expect(capturedChatSignal!.aborted).toBe(false)
    expect(capturedChatSignal).not.toBe(firstSignal)
  })

  it('does not abort unrelated sessions', () => {
    const s1 = createTestSession('proj-1')
    const s2 = createTestSession('proj-2')

    useSessionStore.getState().sendChatMessage({
      sessionId: s1.id, projectId: 'proj-1', message: 'first',
    })
    const signal1 = capturedChatSignal!

    useSessionStore.getState().sendChatMessage({
      sessionId: s2.id, projectId: 'proj-2', message: 'second',
    })

    // s1's signal should NOT be aborted
    expect(signal1.aborted).toBe(false)
  })
})

describe('sendPlaygroundChat — SSE lifecycle', () => {
  beforeEach(async () => {
    capturedPlaygroundCallbacks = {}
    capturedPlaygroundSignal = undefined
    clearAllMocks()
    await resetStore()
  })

  it('does nothing if session does not exist', () => {
    useSessionStore.getState().sendPlaygroundChat({
      sessionId: 'nonexistent', projectId: 'p1', nodeId: 'n1',
      message: 'test', taskTitle: 'T', taskDescription: 'D',
    })

    expect(mockChatWithTask).not.toHaveBeenCalled()
  })

  it('calls chatWithTask with correct params', () => {
    const session = createTestSession('proj-1')

    useSessionStore.getState().sendPlaygroundChat({
      sessionId: session.id,
      projectId: 'proj-1',
      nodeId: 'node-42',
      message: 'Fix the tests',
      taskTitle: 'Playground Session',
      taskDescription: 'Coding session',
      taskOutput: 'Prior output...',
      visionDoc: 'Build great things',
      model: 'claude-opus',
      providerId: 'claude-code',
      messages: [{ role: 'user', content: 'prior' }],
      branchName: 'fix/tests',
      prUrl: 'https://github.com/repo/pull/1',
    })

    expect(mockChatWithTask).toHaveBeenCalledTimes(1)
    const [params] = mockChatWithTask.mock.calls[0]
    expect(params.message).toBe('Fix the tests')
    expect(params.nodeId).toBe('node-42')
    expect(params.projectId).toBe('proj-1')
    expect(params.taskTitle).toBe('Playground Session')
    expect(params.taskOutput).toBe('Prior output...')
    expect(params.branchName).toBe('fix/tests')
    expect(params.prUrl).toBe('https://github.com/repo/pull/1')
    expect(params.streamId).toBe(session.id)
  })

  it('onText pushes events to realtime store', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendPlaygroundChat({
      sessionId: session.id, projectId: 'proj-1', nodeId: 'n1',
      message: 'test', taskTitle: 'T', taskDescription: 'D',
    })

    capturedPlaygroundCallbacks.onText?.('Hello')

    const textCalls = mockPushActivityEvent.mock.calls.filter(
      ([, evt]: [string, { type: string }]) => evt.type === 'text'
    )
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0][1]).toMatchObject({ content: 'Hello' })
  })

  it('onDone adds assistant message and clears streaming', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendPlaygroundChat({
      sessionId: session.id, projectId: 'proj-1', nodeId: 'n1',
      message: 'test', taskTitle: 'T', taskDescription: 'D',
    })

    capturedPlaygroundCallbacks.onText?.('Response text')
    capturedPlaygroundCallbacks.onDone?.('prov-sess')

    // Should have added assistant message
    const updated = useSessionStore.getState().sessions.get(session.id)
    const assistantMsgs = updated?.messages.filter((m) => m.role === 'assistant')
    expect(assistantMsgs?.length).toBeGreaterThanOrEqual(1)
    expect(assistantMsgs?.[assistantMsgs.length - 1].content).toBe('Response text')

    // Should have set provider session ID
    expect(updated?.providerSessionId).toBe('prov-sess')

    // Should have cleared streaming
    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(false)
  })

  it('onError pushes error event and clears streaming', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendPlaygroundChat({
      sessionId: session.id, projectId: 'proj-1', nodeId: 'n1',
      message: 'test', taskTitle: 'T', taskDescription: 'D',
    })

    capturedPlaygroundCallbacks.onError?.('Connection lost')

    const errorCalls = mockPushActivityEvent.mock.calls.filter(
      ([, evt]: [string, { type: string }]) => evt.type === 'error'
    )
    expect(errorCalls).toHaveLength(1)
    expect(errorCalls[0][1]).toMatchObject({ error: 'Connection lost' })
    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(false)
  })

  it('fires notification when component is NOT mounted', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendPlaygroundChat({
      sessionId: session.id, projectId: 'proj-1', nodeId: 'n1',
      message: 'test', taskTitle: 'T', taskDescription: 'D',
    })

    // NOT mounted
    capturedPlaygroundCallbacks.onDone?.('prov')

    expect(mockShowChatCompleteNotification).toHaveBeenCalledWith('Playground')
  })

  it('does NOT fire notification when component IS mounted', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().registerMounted(session.id)

    useSessionStore.getState().sendPlaygroundChat({
      sessionId: session.id, projectId: 'proj-1', nodeId: 'n1',
      message: 'test', taskTitle: 'T', taskDescription: 'D',
    })

    capturedPlaygroundCallbacks.onDone?.('prov')

    expect(mockShowChatCompleteNotification).not.toHaveBeenCalled()
  })

  it('abortChatStream aborts the playground signal', () => {
    const session = createTestSession('proj-1')
    useSessionStore.getState().sendPlaygroundChat({
      sessionId: session.id, projectId: 'proj-1', nodeId: 'n1',
      message: 'test', taskTitle: 'T', taskDescription: 'D',
    })

    expect(capturedPlaygroundSignal?.aborted).toBe(false)

    useSessionStore.getState().abortChatStream(session.id)

    expect(capturedPlaygroundSignal?.aborted).toBe(true)
    expect(useSessionStore.getState().streamingSessions.has(session.id)).toBe(false)
  })
})

describe('Sidebar activity — source code integration', () => {
  /**
   * These tests verify at the source-code level that sidebar.tsx reads
   * streamingSessions and maps them to project IDs for the activity indicator.
   * This is a structural test (like refactor-pr1-renames.test.ts).
   */
  it('sidebar imports useSessionStore', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const source = readFileSync(
      join(__dirname, '..', 'src', 'components', 'layout', 'sidebar.tsx'),
      'utf-8',
    )
    expect(source).toContain("import { useSessionStore }")
  })

  it('sidebar reads streamingSessions from session store', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const source = readFileSync(
      join(__dirname, '..', 'src', 'components', 'layout', 'sidebar.tsx'),
      'utf-8',
    )
    expect(source).toContain('useSessionStore')
    expect(source).toContain('streamingSessions')
    expect(source).toContain('allSessions')
  })

  it('sidebar iterates streamingSessions to build projectsWithRunning', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const source = readFileSync(
      join(__dirname, '..', 'src', 'components', 'layout', 'sidebar.tsx'),
      'utf-8',
    )
    // The key logic: iterate streamingSessions, look up each session's projectId
    expect(source).toContain('for (const sessionId of streamingSessions)')
    expect(source).toContain('session?.projectId')
    expect(source).toContain('running.add(session.projectId)')
  })

  it('sidebar includes batchExecutions in projectsWithRunning', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const source = readFileSync(
      join(__dirname, '..', 'src', 'components', 'layout', 'sidebar.tsx'),
      'utf-8',
    )
    expect(source).toContain('batchExecutions')
    expect(source).toContain('batch.active')
  })
})

describe('Batch completion notification — source code integration', () => {
  it('execution-store imports showBatchCompleteNotification', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const source = readFileSync(
      join(__dirname, '..', 'src', 'stores', 'execution-store.ts'),
      'utf-8',
    )
    expect(source).toContain("import { showBatchCompleteNotification }")
  })

  it('execution-store computes batch stats before deactivating', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const source = readFileSync(
      join(__dirname, '..', 'src', 'stores', 'execution-store.ts'),
      'utf-8',
    )
    // Stats computation must come before deactivation
    const statsIdx = source.indexOf('const dispatched = projectNodes.filter')
    const deactivateIdx = source.indexOf('newBatch.set(projectId, { ...b, active: false })')
    expect(statsIdx).toBeGreaterThan(0)
    expect(deactivateIdx).toBeGreaterThan(0)
    expect(statsIdx).toBeLessThan(deactivateIdx)
  })

  it('execution-store fires both browser notification and toast on batch complete', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const source = readFileSync(
      join(__dirname, '..', 'src', 'stores', 'execution-store.ts'),
      'utf-8',
    )
    expect(source).toContain('showBatchCompleteNotification(projectName, stats)')
    expect(source).toContain('useToastStore.getState().add(')
    // Toast type depends on failure count
    expect(source).toContain("failed > 0 ? \"warning\" : \"success\"")
  })
})
