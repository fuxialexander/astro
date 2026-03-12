/**
 * Playground Chat Multi-Turn Tests
 *
 * Tests for three bugs in playground chat flow:
 * 1. Duplicate conversation context on session resume
 * 2. Streaming events not reaching the UI (activeDispatchStreams suppression)
 * 3. Stale closure when reading session state
 *
 * These tests verify the fix at three layers:
 * - Session store logic (message suppression on resume)
 * - Server route logic (defense-in-depth duplicate guard)
 * - Streaming callback behavior (events pushed to realtime store)
 */
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// Minimal stores to test logic without Zustand/React/Browser
// ============================================================================

interface SessionMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Session {
  id: string
  providerSessionId?: string
  providerId?: string
  messages: SessionMessage[]
}

interface ActivityEvent {
  type: string
  content?: string
  toolName?: string
  timestamp: Date
}

/** Simulates the session store's resume decision logic (from session-store.ts) */
function computeResumeParams(
  session: Session,
  newMessage: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  providerId?: string,
) {
  const hasCompletedExchange = session.messages.some(
    (m) => m.role === 'assistant' && m.content.length > 0
  )
  const providerUnchanged = !session.providerId || session.providerId === providerId

  // A valid resume requires a real provider session ID (not the frontend session ID)
  const canResume =
    hasCompletedExchange &&
    providerUnchanged &&
    !!session.providerSessionId &&
    session.providerSessionId !== session.id
  const resumeId = canResume ? session.providerSessionId : undefined

  // When resuming, don't send messages (session already has conversation context)
  const conversationMessages = resumeId ? undefined : messages

  return { resumeId, conversationMessages }
}

/** Simulates server-side defense-in-depth check (from agent.ts) */
function serverResolveParams(
  existingSessionId: string | undefined,
  historyMessages: Array<{ role: string; content: string }> | undefined,
) {
  const resolvedResumeId = existingSessionId || undefined
  const resolvedMessages = resolvedResumeId ? undefined : historyMessages
  return { resolvedResumeId, resolvedMessages }
}

/** Simulates building history from fresh store state (from playground.tsx) */
function buildFreshHistory(
  allMessages: SessionMessage[],
  includesNewExchange: boolean,
) {
  const msgs = includesNewExchange
    ? allMessages.slice(0, -2) // Remove just-added user msg + empty assistant placeholder
    : allMessages
  return msgs
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content.length > 0))
    .map((m) => ({ role: m.role, content: m.content }))
}

// ============================================================================
// Bug 1: Duplicate conversation context on resume
// ============================================================================

describe('Bug 1: No duplicate conversation context on session resume', () => {
  describe('Client-side (session-store)', () => {
    it('first turn: sends messages, no resumeId', () => {
      const session: Session = {
        id: 'frontend-session-1',
        messages: [],
      }

      const { resumeId, conversationMessages } = computeResumeParams(
        session,
        'Hello world',
        [], // no history on first turn
        'claude-code',
      )

      expect(resumeId).toBeUndefined()
      expect(conversationMessages).toEqual([])
    })

    it('second turn: sends resumeId, suppresses messages', () => {
      const session: Session = {
        id: 'frontend-session-1',
        providerSessionId: 'provider-abc-123', // real provider session from turn 1
        providerId: 'claude-code',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there! How can I help?' },
        ],
      }

      const historyMessages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there! How can I help?' },
      ]

      const { resumeId, conversationMessages } = computeResumeParams(
        session,
        'Follow up question',
        historyMessages,
        'claude-code',
      )

      // Should resume
      expect(resumeId).toBe('provider-abc-123')
      // Messages MUST be undefined — the resumed session already has them
      expect(conversationMessages).toBeUndefined()
    })

    it('does NOT resume when providerSessionId === frontendSessionId (fallback ID)', () => {
      const session: Session = {
        id: 'frontend-session-1',
        providerSessionId: 'frontend-session-1', // same as session.id — not a real provider session
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Response' },
        ],
      }

      const { resumeId, conversationMessages } = computeResumeParams(
        session,
        'Second message',
        [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Response' }],
      )

      // Should NOT resume since providerSessionId is just the frontend ID
      expect(resumeId).toBeUndefined()
      // Messages should be sent since we're not resuming
      expect(conversationMessages).toBeDefined()
      expect(conversationMessages).toHaveLength(2)
    })

    it('does NOT resume when provider changed', () => {
      const session: Session = {
        id: 'frontend-session-1',
        providerSessionId: 'provider-abc',
        providerId: 'claude-code',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Response' },
        ],
      }

      const { resumeId, conversationMessages } = computeResumeParams(
        session,
        'Second message',
        [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Response' }],
        'codex', // different provider!
      )

      // Should NOT resume because provider changed
      expect(resumeId).toBeUndefined()
      expect(conversationMessages).toBeDefined()
    })

    it('does NOT resume when assistant messages are all empty', () => {
      const session: Session = {
        id: 'frontend-session-1',
        providerSessionId: 'provider-abc',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: '' }, // empty — no completed exchange
        ],
      }

      const { resumeId } = computeResumeParams(
        session,
        'Second message',
        [{ role: 'user', content: 'Hello' }],
      )

      expect(resumeId).toBeUndefined()
    })

    it('multi-turn: 3rd turn still suppresses messages', () => {
      const session: Session = {
        id: 'frontend-session-1',
        providerSessionId: 'provider-abc',
        messages: [
          { role: 'user', content: 'Turn 1' },
          { role: 'assistant', content: 'Reply 1' },
          { role: 'user', content: 'Turn 2' },
          { role: 'assistant', content: 'Reply 2' },
        ],
      }

      const fullHistory = session.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))

      const { resumeId, conversationMessages } = computeResumeParams(
        session,
        'Turn 3',
        fullHistory,
      )

      expect(resumeId).toBe('provider-abc')
      expect(conversationMessages).toBeUndefined()
    })
  })

  describe('Server-side (agent.ts defense-in-depth)', () => {
    it('suppresses messages when existingSessionId is present', () => {
      const { resolvedResumeId, resolvedMessages } = serverResolveParams(
        'provider-session-xyz',
        [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
      )

      expect(resolvedResumeId).toBe('provider-session-xyz')
      expect(resolvedMessages).toBeUndefined()
    })

    it('sends messages when no existingSessionId', () => {
      const msgs = [{ role: 'user', content: 'First message' }]

      const { resolvedResumeId, resolvedMessages } = serverResolveParams(
        undefined,
        msgs,
      )

      expect(resolvedResumeId).toBeUndefined()
      expect(resolvedMessages).toEqual(msgs)
    })

    it('treats empty string sessionId as no session', () => {
      const msgs = [{ role: 'user', content: 'Hello' }]

      const { resolvedResumeId, resolvedMessages } = serverResolveParams(
        '', // empty string
        msgs,
      )

      expect(resolvedResumeId).toBeUndefined()
      expect(resolvedMessages).toEqual(msgs)
    })

    it('handles undefined messages gracefully', () => {
      const { resolvedResumeId, resolvedMessages } = serverResolveParams(
        undefined,
        undefined,
      )

      expect(resolvedResumeId).toBeUndefined()
      expect(resolvedMessages).toBeUndefined()
    })
  })
})

// ============================================================================
// Bug 2: Streaming events reaching the UI
// ============================================================================

describe('Bug 2: Streaming callbacks push events to realtime store', () => {
  let realtimeEvents: ActivityEvent[]

  // Simulates the realtime store's pushActivityEvent
  function pushActivityEvent(event: ActivityEvent) {
    realtimeEvents.push(event)
  }

  beforeEach(() => {
    realtimeEvents = []
  })

  it('onText callback pushes text events and updates assistant message', () => {
    let rawAssistantText = ''
    let assistantContent = ''

    // Simulate the fixed onText callback
    function onText(chunk: string) {
      rawAssistantText += chunk
      assistantContent += chunk // simulates appendToLastAssistantMessage
      pushActivityEvent({
        type: 'text',
        content: chunk,
        timestamp: new Date(),
      })
    }

    onText('Hello ')
    onText('world!')

    expect(rawAssistantText).toBe('Hello world!')
    expect(assistantContent).toBe('Hello world!')
    expect(realtimeEvents).toHaveLength(2)
    expect(realtimeEvents[0]).toMatchObject({ type: 'text', content: 'Hello ' })
    expect(realtimeEvents[1]).toMatchObject({ type: 'text', content: 'world!' })
  })

  it('onToolUse callback pushes tool_use events', () => {
    function onToolUse(data: { toolName: string; toolInput: unknown }) {
      pushActivityEvent({
        type: 'tool_use',
        toolName: data.toolName,
        timestamp: new Date(),
      })
    }

    onToolUse({ toolName: 'Read', toolInput: { file: 'test.ts' } })
    onToolUse({ toolName: 'Edit', toolInput: { file: 'test.ts' } })

    expect(realtimeEvents).toHaveLength(2)
    expect(realtimeEvents[0]).toMatchObject({ type: 'tool_use', toolName: 'Read' })
    expect(realtimeEvents[1]).toMatchObject({ type: 'tool_use', toolName: 'Edit' })
  })

  it('onToolResult callback pushes tool_result events', () => {
    function onToolResult(data: { toolName: string; result: string; success: boolean }) {
      pushActivityEvent({
        type: 'tool_result',
        toolName: data.toolName,
        timestamp: new Date(),
      })
    }

    onToolResult({ toolName: 'Read', result: 'file contents...', success: true })

    expect(realtimeEvents).toHaveLength(1)
    expect(realtimeEvents[0]).toMatchObject({ type: 'tool_result', toolName: 'Read' })
  })

  it('complete streaming sequence produces correct event order', () => {
    let rawText = ''
    let assistantContent = ''

    function onText(chunk: string) {
      rawText += chunk
      assistantContent += chunk
      pushActivityEvent({ type: 'text', content: chunk, timestamp: new Date() })
    }
    function onToolUse(data: { toolName: string; toolInput: unknown }) {
      pushActivityEvent({ type: 'tool_use', toolName: data.toolName, timestamp: new Date() })
    }
    function onToolResult(data: { toolName: string; result: string; success: boolean }) {
      pushActivityEvent({ type: 'tool_result', toolName: data.toolName, timestamp: new Date() })
    }

    // Simulate a typical streaming sequence
    onText("Let me read that file. ")
    onToolUse({ toolName: 'Read', toolInput: { file: 'src/main.ts' } })
    onToolResult({ toolName: 'Read', result: 'contents', success: true })
    onText("I see the issue. ")
    onToolUse({ toolName: 'Edit', toolInput: { file: 'src/main.ts' } })
    onToolResult({ toolName: 'Edit', result: 'edited', success: true })
    onText("Fixed!")

    expect(realtimeEvents).toHaveLength(7)
    expect(realtimeEvents.map((e) => e.type)).toEqual([
      'text', 'tool_use', 'tool_result', 'text', 'tool_use', 'tool_result', 'text',
    ])
    expect(rawText).toBe("Let me read that file. I see the issue. Fixed!")
    expect(assistantContent).toBe("Let me read that file. I see the issue. Fixed!")
  })
})

// ============================================================================
// Bug 3: Fresh store reads (stale closure prevention)
// ============================================================================

describe('Bug 3: Fresh store reads prevent stale closure', () => {
  it('reads fresh session state after adding messages', () => {
    // Simulates the store
    const store = new Map<string, Session>()
    store.set('s1', {
      id: 's1',
      messages: [
        { role: 'user', content: 'Turn 1' },
        { role: 'assistant', content: 'Reply 1' },
      ],
    })

    // Simulate stale closure: capture session before mutation
    const staleSession = store.get('s1')!
    const staleMessages = staleSession.messages

    // Add new messages (like addMessage does)
    const fresh = { ...staleSession, messages: [
      ...staleSession.messages,
      { role: 'user' as const, content: 'Turn 2' },
      { role: 'assistant' as const, content: '' },
    ]}
    store.set('s1', fresh)

    // Stale closure still has old data
    expect(staleMessages).toHaveLength(2)

    // Fresh read gets updated data
    const freshSession = store.get('s1')!
    expect(freshSession.messages).toHaveLength(4)

    // Build history from fresh state (matching the fix in playground.tsx)
    const history = buildFreshHistory(freshSession.messages, true)
    expect(history).toHaveLength(2)
    expect(history[0]).toEqual({ role: 'user', content: 'Turn 1' })
    expect(history[1]).toEqual({ role: 'assistant', content: 'Reply 1' })
  })

  it('buildFreshHistory correctly slices off new exchange', () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
      // New exchange (just added, should be sliced off):
      { role: 'user', content: 'Q3' },
      { role: 'assistant', content: '' }, // empty placeholder
    ]

    const history = buildFreshHistory(messages, true)

    // Should contain Q1, A1, Q2, A2 (not Q3 or empty placeholder)
    expect(history).toHaveLength(4)
    expect(history[3]).toEqual({ role: 'assistant', content: 'A2' })
  })

  it('buildFreshHistory filters empty assistant messages', () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: '' }, // failed/empty response
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
    ]

    // Without new exchange (not slicing off last 2)
    const history = buildFreshHistory(messages, false)

    // Should filter out the empty assistant message
    expect(history).toHaveLength(3)
    expect(history[0]).toEqual({ role: 'user', content: 'Q1' })
    expect(history[1]).toEqual({ role: 'user', content: 'Q2' })
    expect(history[2]).toEqual({ role: 'assistant', content: 'A2' })
  })
})

// ============================================================================
// Integration: onDone finalizes assistant message
// ============================================================================

describe('onDone: assistant message finalization', () => {
  it('updates existing placeholder with final text', () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'streamed partial content' }, // placeholder that was appended to
    ]

    const rawAssistantText = 'Full streamed response here'

    // onDone logic: check if last message is assistant, update it
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role === 'assistant') {
      messages[messages.length - 1] = { ...lastMsg, content: rawAssistantText }
    }

    expect(messages[messages.length - 1].content).toBe('Full streamed response here')
    expect(messages).toHaveLength(2) // no duplicate assistant message added
  })

  it('adds new message when no placeholder exists (backward compat)', () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'Hello' },
    ]

    const rawAssistantText = 'Response text'

    // onDone logic: no assistant placeholder, add new message
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role === 'assistant') {
      messages[messages.length - 1] = { ...lastMsg, content: rawAssistantText }
    } else {
      messages.push({ role: 'assistant', content: rawAssistantText })
    }

    expect(messages).toHaveLength(2)
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Response text' })
  })
})

// ============================================================================
// activeDispatchStreams suppression logic
// ============================================================================

describe('activeDispatchStreams suppression pattern', () => {
  it('demonstrates the suppression mechanism', () => {
    const activeDispatchStreams = new Set<string>()

    // Simulate: chat SSE bridge registers the taskId
    activeDispatchStreams.add('task-123')

    // Global SSE event handler checks before forwarding
    function shouldForwardToGlobalSSE(taskId: string): boolean {
      if (activeDispatchStreams.has(taskId)) return false // suppressed
      return true
    }

    expect(shouldForwardToGlobalSSE('task-123')).toBe(false) // suppressed!
    expect(shouldForwardToGlobalSSE('task-456')).toBe(true) // different task, forwarded

    // This is why the callbacks MUST push to realtime store directly:
    // global SSE won't forward events for tasks with active dispatch streams
  })

  it('cleanup after stream ends restores global SSE forwarding', () => {
    const activeDispatchStreams = new Set<string>()
    activeDispatchStreams.add('task-123')

    expect(activeDispatchStreams.has('task-123')).toBe(true)

    // After stream ends, cleanup removes the task
    activeDispatchStreams.delete('task-123')

    expect(activeDispatchStreams.has('task-123')).toBe(false)
  })
})
