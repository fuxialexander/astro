/**
 * Chat Session Flow Tests
 *
 * Tests the end-to-end flow of project chat sessions:
 * - Session creation, message adding, streaming append
 * - Session switching, deletion, active tracking
 * - Provider session ID management
 * - Edge cases: concurrent sends, missing sessions, stale refs
 *
 * Uses a minimal in-memory session store (same logic as the Zustand store)
 * to test without browser or React.
 */
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// Minimal Session Store (mirrors session-store.ts logic without Zustand/React)
// ============================================================================

interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  appliedMutations?: unknown
}

interface Session {
  id: string
  type: 'project-chat' | 'task-chat' | 'execution' | 'steer'
  status: 'active' | 'streaming' | 'completed' | 'error' | 'cancelled'
  projectId: string
  nodeId?: string
  providerSessionId?: string
  title?: string
  messages: SessionMessage[]
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
}

class TestSessionStore {
  sessions = new Map<string, Session>()
  activeSessionIds = new Map<string, string>()
  private idCounter = 0

  createSession(params: { type: Session['type']; projectId: string; nodeId?: string }): Session {
    const id = `session-${++this.idCounter}`
    const now = new Date()
    const session: Session = {
      id,
      type: params.type,
      status: 'active',
      projectId: params.projectId,
      nodeId: params.nodeId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    this.sessions.set(id, session)
    return session
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  getSessionsForProject(projectId: string, type?: Session['type']): Session[] {
    const result: Session[] = []
    for (const session of this.sessions.values()) {
      if (session.projectId === projectId && (!type || session.type === type)) {
        result.push(session)
      }
    }
    return result.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  getActiveSessionId(projectId: string, type: Session['type']): string | undefined {
    return this.activeSessionIds.get(`${projectId}:${type}`)
  }

  setActiveSessionId(projectId: string, type: Session['type'], sessionId: string): void {
    this.activeSessionIds.set(`${projectId}:${type}`, sessionId)
  }

  clearActiveSessionId(projectId: string, type: Session['type']): void {
    this.activeSessionIds.delete(`${projectId}:${type}`)
  }

  addMessage(sessionId: string, message: Omit<SessionMessage, 'id' | 'timestamp'>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const newMessage: SessionMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
    }

    const updated = {
      ...session,
      messages: [...session.messages, newMessage],
      updatedAt: new Date(),
    }
    this.sessions.set(sessionId, updated)
  }

  appendToLastAssistantMessage(sessionId: string, chunk: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.messages.length === 0) return

    const lastMessage = session.messages[session.messages.length - 1]
    if (lastMessage.role !== 'assistant') return

    const updatedMessages = [...session.messages]
    updatedMessages[updatedMessages.length - 1] = {
      ...lastMessage,
      content: lastMessage.content + chunk,
    }

    this.sessions.set(sessionId, {
      ...session,
      messages: updatedMessages,
      updatedAt: new Date(),
    })
  }

  updateLastAssistantMessage(
    sessionId: string,
    content: string,
    appliedMutations?: unknown,
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.messages.length === 0) return

    const lastMessage = session.messages[session.messages.length - 1]
    if (lastMessage.role !== 'assistant') return

    const updatedMessages = [...session.messages]
    updatedMessages[updatedMessages.length - 1] = {
      ...lastMessage,
      content,
      ...(appliedMutations ? { appliedMutations } : {}),
    }

    this.sessions.set(sessionId, {
      ...session,
      messages: updatedMessages,
      updatedAt: new Date(),
    })
  }

  setProviderSessionId(sessionId: string, providerSessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    this.sessions.set(sessionId, {
      ...session,
      providerSessionId,
      updatedAt: new Date(),
    })
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  renameSession(sessionId: string, title: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.set(sessionId, { ...session, title, updatedAt: new Date() })
  }
}

// ============================================================================
// Tests
// ============================================================================

let store: TestSessionStore

beforeEach(() => {
  store = new TestSessionStore()
})

describe('Session Lifecycle', () => {
  it('creates a project-chat session', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'proj-1' })

    expect(session.type).toBe('project-chat')
    expect(session.projectId).toBe('proj-1')
    expect(session.status).toBe('active')
    expect(session.messages).toHaveLength(0)
  })

  it('tracks active session per project+type', () => {
    const s1 = store.createSession({ type: 'project-chat', projectId: 'proj-1' })
    store.setActiveSessionId('proj-1', 'project-chat', s1.id)

    expect(store.getActiveSessionId('proj-1', 'project-chat')).toBe(s1.id)
    expect(store.getActiveSessionId('proj-2', 'project-chat')).toBeUndefined()
  })

  it('isolates sessions by project and type', () => {
    store.createSession({ type: 'project-chat', projectId: 'proj-1' })
    store.createSession({ type: 'task-chat', projectId: 'proj-1' })
    store.createSession({ type: 'project-chat', projectId: 'proj-2' })

    expect(store.getSessionsForProject('proj-1', 'project-chat')).toHaveLength(1)
    expect(store.getSessionsForProject('proj-1', 'task-chat')).toHaveLength(1)
    expect(store.getSessionsForProject('proj-1')).toHaveLength(2)
    expect(store.getSessionsForProject('proj-2')).toHaveLength(1)
  })
})

describe('Message Flow', () => {
  it('adds user and assistant messages', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })

    store.addMessage(session.id, { role: 'user', content: 'Hello' })
    store.addMessage(session.id, { role: 'assistant', content: '' })

    const updated = store.getSession(session.id)!
    expect(updated.messages).toHaveLength(2)
    expect(updated.messages[0].role).toBe('user')
    expect(updated.messages[0].content).toBe('Hello')
    expect(updated.messages[1].role).toBe('assistant')
    expect(updated.messages[1].content).toBe('')
  })

  it('appends chunks to last assistant message', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.addMessage(session.id, { role: 'user', content: 'Hello' })
    store.addMessage(session.id, { role: 'assistant', content: '' })

    store.appendToLastAssistantMessage(session.id, 'I can ')
    store.appendToLastAssistantMessage(session.id, 'help ')
    store.appendToLastAssistantMessage(session.id, 'with that.')

    const updated = store.getSession(session.id)!
    expect(updated.messages[1].content).toBe('I can help with that.')
  })

  it('does not append if last message is not assistant', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.addMessage(session.id, { role: 'user', content: 'Hello' })

    store.appendToLastAssistantMessage(session.id, 'should be ignored')

    const updated = store.getSession(session.id)!
    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0].content).toBe('Hello')
  })

  it('does not append to deleted session', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.addMessage(session.id, { role: 'assistant', content: '' })
    store.deleteSession(session.id)

    // This should silently do nothing (Bug #4 scenario)
    store.appendToLastAssistantMessage(session.id, 'ghost chunk')

    expect(store.getSession(session.id)).toBeUndefined()
  })

  it('updates last assistant message with mutations', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.addMessage(session.id, { role: 'user', content: 'Update task-1' })
    store.addMessage(session.id, { role: 'assistant', content: '' })
    store.appendToLastAssistantMessage(session.id, 'Updated! ```astro-updates...')

    const mutations = { nodeUpdates: [{ nodeId: 'task-1', status: 'completed' }] }
    store.updateLastAssistantMessage(session.id, 'Updated!', mutations)

    const updated = store.getSession(session.id)!
    expect(updated.messages[1].content).toBe('Updated!')
    expect(updated.messages[1].appliedMutations).toEqual(mutations)
  })
})

describe('Provider Session ID', () => {
  it('stores provider session ID from done event', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })
    expect(session.providerSessionId).toBeUndefined()

    store.setProviderSessionId(session.id, 'provider-xyz-123')

    const updated = store.getSession(session.id)!
    expect(updated.providerSessionId).toBe('provider-xyz-123')
  })

  it('updates provider session ID on subsequent messages', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })

    store.setProviderSessionId(session.id, 'session-1')
    store.setProviderSessionId(session.id, 'session-2')

    const updated = store.getSession(session.id)!
    expect(updated.providerSessionId).toBe('session-2')
  })

  it('does not crash on non-existent session', () => {
    // Should silently return without error
    store.setProviderSessionId('no-such', 'xyz')
    expect(store.getSession('no-such')).toBeUndefined()
  })
})

describe('Session Switching', () => {
  it('switches between sessions for same project', () => {
    const s1 = store.createSession({ type: 'project-chat', projectId: 'p1' })
    const s2 = store.createSession({ type: 'project-chat', projectId: 'p1' })

    store.setActiveSessionId('p1', 'project-chat', s1.id)
    expect(store.getActiveSessionId('p1', 'project-chat')).toBe(s1.id)

    store.setActiveSessionId('p1', 'project-chat', s2.id)
    expect(store.getActiveSessionId('p1', 'project-chat')).toBe(s2.id)
  })

  it('deleting active session requires fallback', () => {
    const s1 = store.createSession({ type: 'project-chat', projectId: 'p1' })
    const s2 = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.setActiveSessionId('p1', 'project-chat', s1.id)

    // Simulate the ChatPanel delete logic
    store.deleteSession(s1.id)
    const remaining = store.getSessionsForProject('p1', 'project-chat')
    if (remaining.length > 0) {
      store.setActiveSessionId('p1', 'project-chat', remaining[remaining.length - 1].id)
    } else {
      store.clearActiveSessionId('p1', 'project-chat')
    }

    expect(store.getActiveSessionId('p1', 'project-chat')).toBe(s2.id)
  })

  it('deleting the only session clears active ID', () => {
    const s1 = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.setActiveSessionId('p1', 'project-chat', s1.id)

    store.deleteSession(s1.id)
    const remaining = store.getSessionsForProject('p1', 'project-chat')
    if (remaining.length > 0) {
      store.setActiveSessionId('p1', 'project-chat', remaining[remaining.length - 1].id)
    } else {
      store.clearActiveSessionId('p1', 'project-chat')
    }

    expect(store.getActiveSessionId('p1', 'project-chat')).toBeUndefined()
  })
})

describe('Session History Building', () => {
  /**
   * Simulates how ChatPanel builds message history for the API.
   * This tests the critical path where history is built from a session snapshot.
   */
  function buildHistory(session: Session) {
    return session.messages
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content.length > 0))
      .map((m) => ({ role: m.role, content: m.content }))
  }

  it('excludes empty assistant messages from history', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })

    // Simulate first exchange
    store.addMessage(session.id, { role: 'user', content: 'Hi' })
    store.addMessage(session.id, { role: 'assistant', content: 'Hello!' })

    // Simulate second exchange (user + empty assistant placeholder)
    store.addMessage(session.id, { role: 'user', content: 'Next question' })
    store.addMessage(session.id, { role: 'assistant', content: '' })

    const updated = store.getSession(session.id)!
    const history = buildHistory(updated)

    // Should include: user "Hi", assistant "Hello!", user "Next question"
    // Should exclude: empty assistant ""
    expect(history).toHaveLength(3)
    expect(history[0]).toEqual({ role: 'user', content: 'Hi' })
    expect(history[1]).toEqual({ role: 'assistant', content: 'Hello!' })
    expect(history[2]).toEqual({ role: 'user', content: 'Next question' })
  })

  it('uses snapshot to avoid including current exchange', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.addMessage(session.id, { role: 'user', content: 'First' })
    store.addMessage(session.id, { role: 'assistant', content: 'First reply' })

    // Capture snapshot BEFORE adding new messages (like ChatPanel does via ref)
    const snapshot = store.getSession(session.id)!

    // Now add new exchange
    store.addMessage(session.id, { role: 'user', content: 'Second' })
    store.addMessage(session.id, { role: 'assistant', content: '' })

    // Build history from snapshot - should NOT include "Second" and empty assistant
    const history = buildHistory(snapshot)
    expect(history).toHaveLength(2)
    expect(history[0].content).toBe('First')
    expect(history[1].content).toBe('First reply')
  })
})

describe('Immutable Update Pattern', () => {
  it('addMessage creates new session object (does not mutate in-place)', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })
    const originalMessages = session.messages

    store.addMessage(session.id, { role: 'user', content: 'Hi' })

    // Original session object should be unchanged
    expect(originalMessages).toHaveLength(0)

    // Store should have a new object
    const updated = store.getSession(session.id)!
    expect(updated.messages).toHaveLength(1)
    expect(updated).not.toBe(session)
  })

  it('appendToLastAssistantMessage creates new message array', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.addMessage(session.id, { role: 'assistant', content: '' })

    const beforeAppend = store.getSession(session.id)!
    const beforeMessages = beforeAppend.messages

    store.appendToLastAssistantMessage(session.id, 'chunk')

    const afterAppend = store.getSession(session.id)!
    // Should be a new array
    expect(afterAppend.messages).not.toBe(beforeMessages)
    // Original should be unchanged
    expect(beforeMessages[0].content).toBe('')
    // New should have the chunk
    expect(afterAppend.messages[0].content).toBe('chunk')
  })
})

describe('Concurrent Send Prevention', () => {
  /**
   * Simulates the ChatPanel sendMessage guard against double-send.
   * The `isStreaming` flag should prevent this, but we test the race condition.
   */
  it('second send is blocked while streaming', () => {
    let isStreaming = false
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })

    function sendMessage(text: string): boolean {
      if (!text || isStreaming || !session) return false
      isStreaming = true
      store.addMessage(session.id, { role: 'user', content: text })
      store.addMessage(session.id, { role: 'assistant', content: '' })
      return true
    }

    expect(sendMessage('first')).toBe(true)
    expect(sendMessage('second')).toBe(false) // blocked

    const updated = store.getSession(session.id)!
    expect(updated.messages).toHaveLength(2) // Only first send
    expect(updated.messages[0].content).toBe('first')
  })
})

describe('Session Rename', () => {
  it('renames a session', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.renameSession(session.id, 'My Important Chat')

    const updated = store.getSession(session.id)!
    expect(updated.title).toBe('My Important Chat')
  })
})

describe('Session Isolation (fresh store read)', () => {
  /**
   * Simulates the fixed sendMessage that reads from getState() instead of a stale ref.
   * After switching sessions, the fresh read should pick up the new active session.
   */
  it('reads fresh session after switch (no stale ref)', () => {
    const s1 = store.createSession({ type: 'project-chat', projectId: 'p1' })
    const s2 = store.createSession({ type: 'project-chat', projectId: 'p1' })

    // Populate s1 with a completed exchange
    store.addMessage(s1.id, { role: 'user', content: 'Hello in s1' })
    store.addMessage(s1.id, { role: 'assistant', content: 'Hi from s1' })
    store.setProviderSessionId(s1.id, 'provider-s1')

    // Set s1 as active
    store.setActiveSessionId('p1', 'project-chat', s1.id)

    // Switch to s2
    store.setActiveSessionId('p1', 'project-chat', s2.id)

    // Simulate the fixed sendMessage: read fresh from store
    const activeId = store.getActiveSessionId('p1', 'project-chat')
    const freshSession = activeId ? store.getSession(activeId) : undefined

    // Should get s2, not s1
    expect(freshSession?.id).toBe(s2.id)
    expect(freshSession?.messages).toHaveLength(0)
    expect(freshSession?.providerSessionId).toBeUndefined()
  })

  it('does not send providerSessionId for new sessions', () => {
    const s1 = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.addMessage(s1.id, { role: 'user', content: 'Hello' })
    store.addMessage(s1.id, { role: 'assistant', content: '' }) // empty placeholder

    const session = store.getSession(s1.id)!

    // Check: no completed exchange yet (assistant content is empty)
    const hasCompletedExchange = session.messages.some(
      (m) => m.role === 'assistant' && m.content.length > 0
    )
    expect(hasCompletedExchange).toBe(false)

    // After assistant responds
    store.appendToLastAssistantMessage(s1.id, 'Hello!')
    store.setProviderSessionId(s1.id, 'provider-abc')

    const updated = store.getSession(s1.id)!
    const hasExchangeNow = updated.messages.some(
      (m) => m.role === 'assistant' && m.content.length > 0
    )
    expect(hasExchangeNow).toBe(true)
    expect(updated.providerSessionId).toBe('provider-abc')
  })

  it('fresh history excludes just-added user message and placeholder', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })

    // First exchange
    store.addMessage(session.id, { role: 'user', content: 'First' })
    store.addMessage(session.id, { role: 'assistant', content: 'First reply' })

    // Simulate sendMessage: add new user msg + empty assistant placeholder
    store.addMessage(session.id, { role: 'user', content: 'Second' })
    store.addMessage(session.id, { role: 'assistant', content: '' })

    // Build history the new way: slice off last 2, filter empty assistants
    const freshSession = store.getSession(session.id)!
    const freshMessages = freshSession.messages
    const historyMessages = freshMessages
      .slice(0, -2)
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content.length > 0))
      .map((m) => ({ role: m.role, content: m.content }))

    expect(historyMessages).toHaveLength(2)
    expect(historyMessages[0]).toEqual({ role: 'user', content: 'First' })
    expect(historyMessages[1]).toEqual({ role: 'assistant', content: 'First reply' })
  })
})

describe('Slash Command Processing', () => {
  /**
   * Simulates the slash command detection logic.
   */
  function isSlashCommand(text: string): boolean {
    return text.trim().startsWith('/')
  }

  function parseSlashCommand(text: string): { command: string; args: string } {
    const trimmed = text.trim()
    const parts = trimmed.split(/\s+/)
    return {
      command: parts[0].toLowerCase(),
      args: parts.slice(1).join(' '),
    }
  }

  it('detects slash commands', () => {
    expect(isSlashCommand('/help')).toBe(true)
    expect(isSlashCommand('/clear')).toBe(true)
    expect(isSlashCommand('/rename My Session')).toBe(true)
    expect(isSlashCommand('hello')).toBe(false)
    expect(isSlashCommand('not a /command')).toBe(false)
  })

  it('parses command and args', () => {
    expect(parseSlashCommand('/help')).toEqual({ command: '/help', args: '' })
    expect(parseSlashCommand('/rename My Session')).toEqual({ command: '/rename', args: 'My Session' })
    expect(parseSlashCommand('/compact')).toEqual({ command: '/compact', args: '' })
  })

  it('/clear creates a new session (simulated)', () => {
    const s1 = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.addMessage(s1.id, { role: 'user', content: 'Hello' })
    store.addMessage(s1.id, { role: 'assistant', content: 'Hi there' })
    store.setActiveSessionId('p1', 'project-chat', s1.id)

    // Simulate /clear: create new session
    const s2 = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.setActiveSessionId('p1', 'project-chat', s2.id)

    const activeId = store.getActiveSessionId('p1', 'project-chat')
    expect(activeId).toBe(s2.id)

    const newSession = store.getSession(s2.id)!
    expect(newSession.messages).toHaveLength(0)

    // Old session still exists
    const oldSession = store.getSession(s1.id)!
    expect(oldSession.messages).toHaveLength(2)
  })

  it('/rename updates session title', () => {
    const session = store.createSession({ type: 'project-chat', projectId: 'p1' })
    store.renameSession(session.id, 'Architecture Discussion')

    const updated = store.getSession(session.id)!
    expect(updated.title).toBe('Architecture Discussion')
  })
})
