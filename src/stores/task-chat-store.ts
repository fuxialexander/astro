import { create } from "zustand"
import { loadState, saveState } from "@/lib/db"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase-client"

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

/** Sync a session to Supabase (fire-and-forget) */
function syncSessionToSupabase(session: TaskChatSession) {
  const supabase = getSupabase()
  if (!supabase || !isSupabaseConfigured()) return

  supabase.auth.getUser().then(({ data: { user } }) => {
    if (!user) return

    // Upsert session
    supabase
      .from("task_chat_sessions")
      .upsert({
        node_id: session.nodeId,
        project_id: session.projectId,
        user_id: user.id,
        session_id: session.sessionId || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "node_id,user_id" })
      .select("id")
      .single()
      .then(({ data: sessionRow }) => {
        if (!sessionRow) return

        // Upsert latest messages (only sync the last message to avoid conflicts)
        const lastMsg = session.messages[session.messages.length - 1]
        if (lastMsg) {
          supabase
            .from("task_chat_messages")
            .upsert({
              id: lastMsg.id,
              session_id: sessionRow.id,
              role: lastMsg.role,
              content: lastMsg.content,
              created_at: lastMsg.timestamp.toISOString(),
            }, { onConflict: "id" })
            .then()
        }
      })
  })
}

export const useTaskChatStore = create<TaskChatState>((set, get) => ({
  sessions: new Map(),
  loaded: false,

  load: async () => {
    const supabase = getSupabase()

    if (supabase && isSupabaseConfigured()) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: sessionRows } = await supabase
          .from("task_chat_sessions")
          .select("*, task_chat_messages(*)")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })

        if (sessionRows && sessionRows.length > 0) {
          const sessions = new Map<string, TaskChatSession>()
          for (const row of sessionRows) {
            const messages: TaskChatMessage[] = (row.task_chat_messages || [])
              .sort((a: { created_at: string }, b: { created_at: string }) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              )
              .map((m: { id: string; role: string; content: string; created_at: string }) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                timestamp: new Date(m.created_at),
              }))

            sessions.set(row.node_id, {
              nodeId: row.node_id,
              projectId: row.project_id,
              sessionId: row.session_id || undefined,
              messages,
              createdAt: new Date(row.created_at),
              updatedAt: new Date(row.updated_at),
            })
          }
          set({ sessions, loaded: true })
          await saveState("nexus-task-chats", serializeSessions(sessions))
          return
        }
      }
    }

    // Fallback to IndexedDB
    const saved = await loadState<Record<string, TaskChatSession>>("nexus-task-chats")
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
    saveState("nexus-task-chats", serializeSessions(sessions))
    syncSessionToSupabase(session)

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
    saveState("nexus-task-chats", serializeSessions(sessions))
    syncSessionToSupabase(updatedSession)
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
    saveState("nexus-task-chats", serializeSessions(sessions))
    syncSessionToSupabase(updatedSession)
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
    // Note: We don't save on every chunk to avoid excessive writes
    // The final message will be saved when done
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
    saveState("nexus-task-chats", serializeSessions(sessions))
    syncSessionToSupabase(updatedSession)
  },

  clearSession: (nodeId) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(nodeId)
    sessions.delete(nodeId)
    set({ sessions })
    saveState("nexus-task-chats", serializeSessions(sessions))

    // Delete from Supabase
    if (session) {
      const supabase = getSupabase()
      if (supabase && isSupabaseConfigured()) {
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user) {
            supabase
              .from("task_chat_sessions")
              .delete()
              .eq("node_id", nodeId)
              .eq("user_id", user.id)
              .then()
          }
        })
      }
    }
  },
}))
