import { create } from "zustand"
import { loadState, saveState } from "@/lib/db"
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

  // Lifecycle
  load: () => Promise<void>

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

function serializeSessions(sessions: Map<string, TaskChatSession>): Record<string, TaskChatSession> {
  const obj: Record<string, TaskChatSession> = {}
  sessions.forEach((session, key) => {
    obj[key] = session
  })
  return obj
}

function deserializeSessions(obj: Record<string, TaskChatSession>): Map<string, TaskChatSession> {
  const map = new Map<string, TaskChatSession>()
  Object.entries(obj).forEach(([key, session]) => {
    map.set(key, {
      ...session,
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(session.updatedAt),
      messages: session.messages.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
    })
  })
  return map
}

export const useTaskChatStore = create<TaskChatState>((set, get) => ({
  sessions: new Map(),
  loaded: false,

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
        set({ sessions, loaded: true })
        saveState("astro-task-chats", serializeSessions(sessions))
        return
      }
    } catch {
      // API unavailable
    }

    // Fallback to IndexedDB
    const saved = await loadState<Record<string, TaskChatSession>>("astro-task-chats")
    if (saved) {
      set({ sessions: deserializeSessions(saved), loaded: true })
    } else {
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
    saveState("astro-task-chats", serializeSessions(sessions))
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
    saveState("astro-task-chats", serializeSessions(sessions))
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
    saveState("astro-task-chats", serializeSessions(sessions))
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
    saveState("astro-task-chats", serializeSessions(sessions))
    dataClient.updateChatSessionId(nodeId, sessionId).catch(() => {})
  },

  clearSession: (nodeId) => {
    const sessions = new Map(get().sessions)
    sessions.delete(nodeId)
    set({ sessions })
    saveState("astro-task-chats", serializeSessions(sessions))
    dataClient.deleteChatSession(nodeId).catch(() => {})
  },
}))
