/**
 * Chat store — messages, sessions, streaming state.
 *
 * Manages chat threads for the active project. Each session holds
 * an ordered list of messages and streaming metadata.
 */
import { create } from 'zustand'
import { api, getBaseUrl } from '@desktop/lib/api-client'

// ── Types ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  /** Tool use/result blocks embedded in this message */
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

export interface ChatSession {
  id: string
  projectId: string
  title: string
  createdAt: string
  updatedAt: string
}

interface ChatState {
  // Sessions
  sessions: ChatSession[]
  activeSessionId: string | null
  sessionsLoading: boolean

  // Messages
  messages: ChatMessage[]
  messagesLoading: boolean

  // Streaming
  isStreaming: boolean
  streamText: string
  streamToolBlocks: ToolBlock[]

  // Actions
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
  streamText: '',
  streamToolBlocks: [],

  loadSessions: async (projectId: string) => {
    set({ sessionsLoading: true })
    try {
      const data = await api.get<ChatSession[]>(
        `/api/data/chat-sessions?projectId=${projectId}`,
      )
      set({ sessions: data ?? [], sessionsLoading: false })
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
      const session = await api.post<ChatSession>('/api/data/chat-sessions', {
        projectId,
      })
      if (session) {
        set((s) => ({
          sessions: [session, ...s.sessions],
          activeSessionId: session.id,
          messages: [],
        }))
      }
      return session ?? null
    } catch {
      return null
    }
  },

  loadMessages: async (sessionId: string) => {
    set({ messagesLoading: true })
    try {
      const data = await api.get<ChatMessage[]>(
        `/api/data/chat-messages?sessionId=${sessionId}`,
      )
      set({ messages: data ?? [], messagesLoading: false })
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

    set((s) => ({
      messages: [...s.messages, userMsg],
      isStreaming: true,
      streamText: '',
      streamToolBlocks: [],
    }))

    // Fire off the chat request — SSE response handled by use-stream-events hook
    const url = `${getBaseUrl()}/api/agent/chat`
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: content }),
    }).catch(() => {
      set({ isStreaming: false })
    })
  },

  appendStreamChunk: (chunk: string) => {
    set((s) => ({ streamText: s.streamText + chunk }))
  },

  appendToolBlock: (block: ToolBlock) => {
    set((s) => ({ streamToolBlocks: [...s.streamToolBlocks, block] }))
  },

  finalizeStream: () => {
    const { streamText, streamToolBlocks } = get()
    if (streamText || streamToolBlocks.length > 0) {
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: streamText,
        timestamp: new Date().toISOString(),
        toolBlocks: streamToolBlocks.length > 0 ? streamToolBlocks : undefined,
      }
      set((s) => ({
        messages: [...s.messages, assistantMsg],
        isStreaming: false,
        streamText: '',
        streamToolBlocks: [],
      }))
    } else {
      set({ isStreaming: false })
    }
  },

  clearStream: () => {
    set({ isStreaming: false, streamText: '', streamToolBlocks: [] })
  },
}))
