import { create } from "zustand"
import { dataClient } from "@/lib/data-client"

export interface TaskChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

export interface TaskChatSession {
  nodeId: string
  projectId: string
  sessionId?: string // For multi-turn conversation continuity
  messages: TaskChatMessage[]
  createdAt: Date
  updatedAt: Date
}

interface TaskChatState {
  sessions: Map<string, TaskChatSession>
  loaded: boolean
  /** True only after a full global load() — not set by loadForProject */
  globallyLoaded: boolean

  // Lifecycle
  load: () => Promise<void>
  /** Load chat sessions for a single project (merges into global store) */
  loadForProject: (projectId: string) => Promise<void>

  // Session management
  getSession: (nodeId: string) => TaskChatSession | undefined
  getOrCreateSession: (nodeId: string, projectId: string) => TaskChatSession

  // Message management
  addMessage: (nodeId: string, message: Omit<TaskChatMessage, "id" | "timestamp">) => void
  updateLastAssistantMessage: (nodeId: string, content: string) => void
  appendToLastAssistantMessage: (nodeId: string, chunk: string) => void

  // Session state
  setSessionId: (nodeId: string, sessionId: string) => void
  clearSession: (nodeId: string) => void
}

function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}


export const useTaskChatStore = create<TaskChatState>((set, get) => ({
  sessions: new Map(),
  loaded: false,
  globallyLoaded: false,

  load: async () => {
    try {
      const chats = await dataClient.getAllChats()
      if (chats && Object.keys(chats).length > 0) {
        const sessions = new Map<string, TaskChatSession>()
        for (const [nodeId, entry] of Object.entries(chats)) {
          sessions.set(nodeId, {
            ...entry.session,
            messages: entry.messages,
          })
        }
        set({ sessions, loaded: true, globallyLoaded: true })
        return
      }
    } catch {
      // API unavailable
    }

    set({ loaded: true, globallyLoaded: true })
  },

  loadForProject: async (projectId: string) => {
    // Skip if we already loaded all data globally
    if (get().globallyLoaded) return
    try {
      const chats = await dataClient.getAllChats(projectId)
      // Re-check after await: a concurrent global load() may have completed
      if (get().globallyLoaded) return
      if (chats && Object.keys(chats).length > 0) {
        const sessions = new Map(get().sessions)
        for (const [nodeId, entry] of Object.entries(chats)) {
          sessions.set(nodeId, {
            ...entry.session,
            messages: entry.messages,
          })
        }
        set({ sessions, loaded: true })
      } else {
        set({ loaded: true })
      }
    } catch (err) {
      console.error('[task-chat-store] loadForProject failed:', err)
      set({ loaded: true })
    }
  },

  getSession: (nodeId) => {
    return get().sessions.get(nodeId)
  },

  getOrCreateSession: (nodeId, projectId) => {
    const existing = get().sessions.get(nodeId)
    if (existing) return existing

    const session: TaskChatSession = {
      nodeId,
      projectId,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const sessions = new Map(get().sessions)
    sessions.set(nodeId, session)
    set({ sessions })
    dataClient.createChatSession(nodeId, projectId).catch(() => {})

    return session
  },

  addMessage: (nodeId, message) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(nodeId)
    if (!session) return

    const newMessage: TaskChatMessage = {
      ...message,
      id: createMessageId(),
      timestamp: new Date(),
    }

    const updatedSession = {
      ...session,
      messages: [...session.messages, newMessage],
      updatedAt: new Date(),
    }

    sessions.set(nodeId, updatedSession)
    set({ sessions })
    dataClient.addChatMessage(nodeId, newMessage).catch(() => {})
  },

  updateLastAssistantMessage: (nodeId, content) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(nodeId)
    if (!session || session.messages.length === 0) return

    const lastMessage = session.messages[session.messages.length - 1]
    if (lastMessage.role !== "assistant") return

    const updatedMessages = [...session.messages]
    updatedMessages[updatedMessages.length - 1] = {
      ...lastMessage,
      content,
    }

    const updatedSession = {
      ...session,
      messages: updatedMessages,
      updatedAt: new Date(),
    }

    sessions.set(nodeId, updatedSession)
    set({ sessions })
    dataClient.addChatMessage(nodeId, updatedMessages[updatedMessages.length - 1]).catch(() => {})
  },

  appendToLastAssistantMessage: (nodeId, chunk) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(nodeId)
    if (!session || session.messages.length === 0) return

    const lastMessage = session.messages[session.messages.length - 1]
    if (lastMessage.role !== "assistant") return

    const updatedMessages = [...session.messages]
    updatedMessages[updatedMessages.length - 1] = {
      ...lastMessage,
      content: lastMessage.content + chunk,
    }

    const updatedSession = {
      ...session,
      messages: updatedMessages,
      updatedAt: new Date(),
    }

    sessions.set(nodeId, updatedSession)
    set({ sessions })
    // No API call during streaming — performance. Final message saved via updateLastAssistantMessage
  },

  setSessionId: (nodeId, sessionId) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(nodeId)
    if (!session) return

    const updatedSession = {
      ...session,
      sessionId,
      updatedAt: new Date(),
    }

    sessions.set(nodeId, updatedSession)
    set({ sessions })
    dataClient.updateChatSessionId(nodeId, sessionId).catch(() => {})
  },

  clearSession: (nodeId) => {
    const sessions = new Map(get().sessions)
    sessions.delete(nodeId)
    set({ sessions })
    dataClient.deleteChatSession(nodeId).catch(() => {})
  },
}))
