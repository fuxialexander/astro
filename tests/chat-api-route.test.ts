/**
 * Chat API Route Tests
 *
 * Tests the /api/agent/chat backend route without needing a browser.
 * Uses Hono's built-in test client and mocks the provider layer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'

// ============================================================================
// Mock Provider & Session Manager
// ============================================================================

// In-memory session map for testing
const testSessions = new Map<string, { abortController: AbortController; providerId?: string }>()

// Mock session-manager functions
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

// Mock auth middleware
vi.mock('../server/middleware/auth.js', () => ({
  requireAuth: async (_c: unknown, next: () => Promise<void>) => {
    await next()
  },
}))

// Track what provider.stream yields
let mockStreamEvents: Array<{ type: string; text?: string; error?: string; result?: Record<string, unknown>; reason?: string }> = []

// Mock provider registry
vi.mock('../server/lib/providers/index.js', () => {
  const mockProvider = {
    id: 'test-provider',
    name: 'Test Provider',
    capabilities: () => ({
      availableModels: ['test-model'],
      defaultModel: 'test-model',
    }),
    stream: async function* () {
      for (const event of mockStreamEvents) {
        yield event
      }
    },
    execute: async () => ({ status: 'success', stdout: '' }),
    cancel: async () => {},
  }

  return {
    providerRegistry: {
      getProvider: () => mockProvider,
      getDefaultProvider: () => mockProvider,
      getRegisteredProvider: () => ({ available: true, provider: mockProvider }),
      getStatusSummary: () => ({ total: 1, available: 1, installed: 1, authenticated: 1, providers: [] }),
      detectAll: async () => new Map(),
    },
    // Re-export types (not really needed for tests but avoids errors)
  }
})

// Mock prompt templates
vi.mock('../server/lib/prompt-templates.js', () => ({
  buildChatSystemPrompt: () => 'system prompt',
  buildPlanSystemPrompt: () => 'plan system prompt',
  buildTaskChatSystemPrompt: () => 'task chat system prompt',
  buildTaskExecutionPrompt: () => 'execution prompt',
  buildSummaryPrompt: () => 'summary prompt',
  PLAN_GRAPH_SCHEMA: {},
}))

// Mock repo context
vi.mock('../server/lib/repo-context.js', () => ({
  readRepoContext: () => ({}),
}))

// Mock relay server
vi.mock('../server/lib/relay-server.js', () => ({
  relayServer: {
    on: () => {},
    off: () => {},
    dispatchTask: () => true,
    cancelTask: () => {},
  },
}))

// Mock error utils
vi.mock('../server/lib/error-utils.js', () => ({
  errorMessage: (e: Error) => e.message || String(e),
  isAbortError: (e: Error) => e.name === 'AbortError',
}))

// ============================================================================
// Test Setup
// ============================================================================

let app: Hono

beforeEach(async () => {
  testSessions.clear()
  mockStreamEvents = []

  // Dynamically import the agent route (after mocks are set up)
  const { agentRoute } = await import('../server/routes/agent.js')
  app = new Hono()
  app.route('/api/agent', agentRoute)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Helper to parse SSE from response body
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
  // Flush remaining
  if (currentEvent && dataLines.length > 0) {
    events.push({ event: currentEvent, data: dataLines.join('\n').trim() })
  }

  return events
}

// ============================================================================
// Tests
// ============================================================================

describe('/api/agent/chat', () => {
  it('validates required fields', async () => {
    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid input')
  })

  it('requires message field', async () => {
    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'p1' }),
    })

    expect(res.status).toBe(400)
  })

  it('requires projectId field', async () => {
    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    })

    expect(res.status).toBe(400)
  })

  it('streams text events for a simple chat', async () => {
    mockStreamEvents = [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'there!' },
      { type: 'result', result: { sessionId: 'test-session', status: 'success' } },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Hi',
        projectId: 'proj-1',
      }),
    })

    expect(res.status).toBe(200)

    const events = await parseSSEFromResponse(res)

    // Should have text + text + done
    const textEvents = events.filter((e) => e.event === 'text')
    expect(textEvents).toHaveLength(2)
    expect(textEvents[0].data).toBe('Hello')
    expect(textEvents[1].data).toBe('there!')

    const doneEvents = events.filter((e) => e.event === 'done')
    expect(doneEvents).toHaveLength(1)
    const doneData = JSON.parse(doneEvents[0].data)
    expect(doneData.providerId).toBe('test-provider')
  })

  it('handles error events from provider', async () => {
    mockStreamEvents = [
      { type: 'error', error: 'Provider failed' },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'test error',
        projectId: 'proj-1',
      }),
    })

    expect(res.status).toBe(200) // SSE streams always return 200
    const events = await parseSSEFromResponse(res)
    const errorEvents = events.filter((e) => e.event === 'error')
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].data).toBe('Provider failed')
  })

  it('handles aborted events', async () => {
    mockStreamEvents = [
      { type: 'aborted', reason: 'User cancelled' },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'test abort',
        projectId: 'proj-1',
      }),
    })

    const events = await parseSSEFromResponse(res)
    const abortedEvents = events.filter((e) => e.event === 'aborted')
    expect(abortedEvents).toHaveLength(1)
  })

  it('accepts optional sessionId for multi-turn', async () => {
    mockStreamEvents = [
      { type: 'text', text: 'Continuing...' },
      { type: 'result', result: { sessionId: 'resumed-session', status: 'success' } },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'follow up',
        sessionId: 'existing-session-123',
        projectId: 'proj-1',
      }),
    })

    expect(res.status).toBe(200)
    const events = await parseSSEFromResponse(res)
    expect(events.some((e) => e.event === 'text')).toBe(true)
  })

  it('accepts message history', async () => {
    mockStreamEvents = [
      { type: 'text', text: 'Got it' },
      { type: 'result', result: { sessionId: 's1', status: 'success' } },
    ]

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'And also...',
        projectId: 'proj-1',
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First reply' },
        ],
      }),
    })

    expect(res.status).toBe(200)
  })

  it('cleans up session after completion', async () => {
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

    // Must consume the response body to complete the SSE stream,
    // which triggers the finally block that calls removeSession
    await res.text()

    // Session should be cleaned up (removeSession called in finally)
    expect(testSessions.size).toBe(0)
  })

  it('enforces message length limits', async () => {
    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'x'.repeat(50001), // exceeds 50000 limit
        projectId: 'proj-1',
      }),
    })

    expect(res.status).toBe(400)
  })

  it('enforces message history limits', async () => {
    const tooManyMessages = Array.from({ length: 101 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
    }))

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
        projectId: 'proj-1',
        messages: tooManyMessages,
      }),
    })

    expect(res.status).toBe(400)
  })
})

describe('/api/agent/abort', () => {
  it('aborts an active session', async () => {
    // Create a session first
    testSessions.set('test-abort', {
      abortController: new AbortController(),
      providerId: 'test-provider',
    })

    const res = await app.request('/api/agent/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'test-abort' }),
    })

    const body = await res.json()
    expect(body.aborted).toBe(true)
  })

  it('returns false for non-existent session', async () => {
    const res = await app.request('/api/agent/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'no-such' }),
    })

    const body = await res.json()
    expect(body.aborted).toBe(false)
  })

  it('requires sessionId or taskId', async () => {
    const res = await app.request('/api/agent/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
  })
})

describe('/api/agent/providers', () => {
  it('returns provider status', async () => {
    const res = await app.request('/api/agent/providers')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('available')
  })
})
