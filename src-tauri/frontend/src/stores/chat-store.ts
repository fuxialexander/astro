/**
 * Chat store — messages, sessions, streaming state.
 *
 * Manages chat threads (sessions) for the active project.
 * Sessions are stored in /api/data/sessions (type='project-chat').
 * Messages are embedded as JSONB in the session record.
 * Sending a message POSTs to /api/agent/project-chat.
 */
import { create } from 'zustand'
import { api, getBaseUrl } from '@desktop/lib/api-client'

// ── Types ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  toolBlocks?: ToolBlock[]
}

export interface ToolBlock {
  id: string
  type: 'tool_use' | 'tool_result'
  toolName: string
  input?: unknown
  output?: string
  isError?: boolean
}

/** Ordered content block for interleaved text + tools during streaming */
export type StreamBlock =
  | { kind: 'text'; content: string }
  | { kind: 'tool'; block: ToolBlock }

export interface ChatSession {
  id: string
  projectId: string
  title: string
  createdAt: string
  updatedAt: string
}

// Shape returned by GET /api/data/sessions
interface SessionRecord {
  id: string
  type: string
  projectId: string
  title?: string | null
  titlePreview?: string | null
  createdAt: string
  updatedAt: string
  messages?: ChatMessage[]
}

interface ChatState {
  sessions: ChatSession[]
  activeSessionId: string | null
  sessionsLoading: boolean
  messages: ChatMessage[]
  messagesLoading: boolean
  isStreaming: boolean
  /** Ordered stream blocks — text and tools interleaved in arrival order */
  streamBlocks: StreamBlock[]

  loadSessions: (projectId: string) => Promise<void>
  setActiveSession: (sessionId: string | null) => void
  createSession: (projectId: string) => Promise<ChatSession | null>
  loadMessages: (sessionId: string) => Promise<void>
  sendMessage: (sessionId: string, content: string) => void
  appendStreamChunk: (chunk: string) => void
  appendToolBlock: (block: ToolBlock) => void
  finalizeStream: () => void
  clearStream: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  sessionsLoading: false,
  messages: [],
  messagesLoading: false,
  isStreaming: false,
  streamBlocks: [],

  loadSessions: async (projectId: string) => {
    set({ sessionsLoading: true })
    try {
      // GET /api/data/sessions returns all sessions for the user — filter client-side
      const data = await api.get<SessionRecord[]>('/api/data/sessions')
      const chatSessions: ChatSession[] = (data ?? [])
        .filter((s) => s.projectId === projectId && s.type === 'project-chat')
        .map((s) => ({
          id: s.id,
          projectId: s.projectId,
          title: s.title || s.titlePreview || 'Chat',
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }))
      set({ sessions: chatSessions, sessionsLoading: false })
    } catch {
      set({ sessionsLoading: false })
    }
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId, messages: [] })
    if (sessionId) {
      get().loadMessages(sessionId)
    }
  },

  createSession: async (projectId: string) => {
    try {
      const id = crypto.randomUUID()
      await api.post('/api/data/sessions', {
        id,
        projectId,
        type: 'project-chat',
        status: 'active',
        title: 'New chat',
      })
      const session: ChatSession = {
        id,
        projectId,
        title: 'New chat',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      set((s) => ({
        sessions: [session, ...s.sessions],
        activeSessionId: id,
        messages: [],
      }))
      return session
    } catch {
      return null
    }
  },

  loadMessages: async (sessionId: string) => {
    set({ messagesLoading: true })
    try {
      // Messages are embedded in the session record
      const data = await api.get<SessionRecord>(`/api/data/sessions/${sessionId}`)
      set({ messages: data?.messages ?? [], messagesLoading: false })
    } catch {
      set({ messagesLoading: false })
    }
  },

  sendMessage: (sessionId: string, content: string) => {
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    }

    const currentMessages = get().messages
    set({
      messages: [...currentMessages, userMsg],
      isStreaming: true,
      streamBlocks: [],
    })

    // Find the projectId from the active session
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) {
      set({ isStreaming: false })
      return
    }

    // Build conversation history for the agent (last 20 messages, no tool blocks)
    const history = [...currentMessages, userMsg]
      .slice(-20)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    // POST to /api/agent/project-chat — SSE events flow back via /api/events?projectId=
    const url = `${getBaseUrl()}/api/agent/project-chat`
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: content,
        projectId: session.projectId,
        streamId: sessionId,   // stable routing key for SSE events
        messages: history,
      }),
    }).catch(() => {
      set({ isStreaming: false })
    })
  },

  appendStreamChunk: (chunk: string) => {
    set((s) => {
      const blocks = [...s.streamBlocks]
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'text') {
        blocks[blocks.length - 1] = { kind: 'text', content: last.content + chunk }
      } else {
        blocks.push({ kind: 'text', content: chunk })
      }
      return { streamBlocks: blocks }
    })
  },

  appendToolBlock: (block: ToolBlock) => {
    set((s) => ({ streamBlocks: [...s.streamBlocks, { kind: 'tool', block }] }))
  },

  finalizeStream: () => {
    const { streamBlocks, messages, activeSessionId } = get()
    if (streamBlocks.length > 0) {
      const fullText = streamBlocks
        .filter((b): b is Extract<StreamBlock, { kind: 'text' }> => b.kind === 'text')
        .map((b) => b.content)
        .join('')
      const toolBlocks = streamBlocks
        .filter((b): b is Extract<StreamBlock, { kind: 'tool' }> => b.kind === 'tool')
        .map((b) => b.block)
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: fullText,
        timestamp: new Date().toISOString(),
        toolBlocks: toolBlocks.length > 0 ? toolBlocks : undefined,
      }
      const updatedMessages = [...messages, assistantMsg]
      set({ messages: updatedMessages, isStreaming: false, streamBlocks: [] })

      // Persist updated messages to the session record
      if (activeSessionId) {
        void api.patch(`/api/data/sessions/${activeSessionId}`, {
          messages: updatedMessages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          })),
        })
      }
    } else {
      set({ isStreaming: false })
    }
  },

  clearStream: () => {
    set({ isStreaming: false, streamBlocks: [] })
  },
}))
