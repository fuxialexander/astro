/**
 * Unified Session Store
 *
 * Single source of truth for all session data: plan chat, task chat,
 * steer messages, and execution sessions. Replaces the fragmented
 * task-chat-store and plan chat useState.
 */

import { create } from "zustand"
import { loadState, saveState } from "@/lib/db"
import type {
  Session,
  SessionType,
  SessionStatus,
  SessionMessage,
  ExecutionSummary,
  SteerMessage,
  TaskActivityEvent,
  ToolTrace,
  FileChange,
  UsageMetrics,
} from "@/types"

interface SessionState {
  sessions: Map<string, Session>
  loaded: boolean

  // Lifecycle
  load: () => Promise<void>

  // CRUD
  createSession: (params: {
    type: SessionType
    projectId: string
    nodeId?: string
    providerId?: string
    model?: string
    metadata?: Record<string, unknown>
  }) => Session
  getSession: (sessionId: string) => Session | undefined
  getSessionsForNode: (nodeId: string, type?: SessionType) => Session[]
  getSessionsForProject: (projectId: string, type?: SessionType) => Session[]

  // Message ops
  addMessage: (sessionId: string, message: Omit<SessionMessage, "id" | "timestamp">) => void
  appendToLastAssistantMessage: (sessionId: string, chunk: string) => void
  updateLastAssistantMessage: (sessionId: string, content: string, appliedMutations?: SessionMessage["appliedMutations"]) => void

  // Session state
  setProviderSessionId: (sessionId: string, providerSessionId: string) => void
  setStatus: (sessionId: string, status: SessionStatus) => void
  setSummary: (sessionId: string, summary: ExecutionSummary) => void
  setMetrics: (sessionId: string, metrics: UsageMetrics) => void

  // Activity events (for execution sessions)
  addActivityEvent: (sessionId: string, event: TaskActivityEvent) => void
  addToolTrace: (sessionId: string, trace: ToolTrace) => void
  addFileChange: (sessionId: string, change: FileChange) => void
  setStreamText: (sessionId: string, text: string) => void
  appendStreamText: (sessionId: string, chunk: string) => void

  // Steer ops
  addSteerMessage: (sessionId: string, message: string, interrupted?: boolean) => void
  updateSteerMessage: (sessionId: string, index: number, update: { accepted?: boolean; ackMessage?: string }) => void

  // Cleanup
  deleteSession: (sessionId: string) => void
  clearSessionsForNode: (nodeId: string) => void
}

function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Debounced persistence to avoid thrashing during streaming
let saveTimeout: ReturnType<typeof setTimeout> | null = null
function debouncedSave(sessions: Map<string, Session>) {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => {
    saveState("nexus-sessions", serializeSessions(sessions))
  }, 500)
}

function immediateSave(sessions: Map<string, Session>) {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveState("nexus-sessions", serializeSessions(sessions))
}

function serializeSessions(sessions: Map<string, Session>): Record<string, Session> {
  const obj: Record<string, Session> = {}
  sessions.forEach((session, key) => {
    obj[key] = session
  })
  return obj
}

function deserializeSessions(obj: Record<string, Session>): Map<string, Session> {
  const map = new Map<string, Session>()
  Object.entries(obj).forEach(([key, session]) => {
    map.set(key, {
      ...session,
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(session.updatedAt),
      completedAt: session.completedAt ? new Date(session.completedAt) : undefined,
      messages: (session.messages || []).map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
      steerMessages: (session.steerMessages || []).map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
      activityEvents: (session.activityEvents || []).map((e) => ({
        ...e,
        timestamp: new Date(e.timestamp),
      })) as TaskActivityEvent[],
      toolTraces: (session.toolTraces || []).map((t) => ({
        ...t,
        timestamp: new Date(t.timestamp),
      })),
      fileChanges: (session.fileChanges || []).map((f) => ({
        ...f,
        timestamp: new Date(f.timestamp),
      })),
    })
  })
  return map
}

// Migration: convert old task-chat-store data to session format
function migrateTaskChatData(
  oldData: Record<string, {
    nodeId: string
    projectId: string
    sessionId?: string
    messages: Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: Date }>
    createdAt: Date
    updatedAt: Date
  }>
): Map<string, Session> {
  const sessions = new Map<string, Session>()
  for (const [nodeId, chat] of Object.entries(oldData)) {
    if (!chat.messages || chat.messages.length === 0) continue
    const sessionId = createSessionId()
    sessions.set(sessionId, {
      id: sessionId,
      type: "task-chat",
      status: "completed",
      projectId: chat.projectId,
      nodeId,
      providerSessionId: chat.sessionId,
      messages: chat.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.timestamp),
      })),
      createdAt: new Date(chat.createdAt),
      updatedAt: new Date(chat.updatedAt),
    })
  }
  return sessions
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  loaded: false,

  load: async () => {
    // Try loading session store data
    const saved = await loadState<Record<string, Session>>("nexus-sessions")
    if (saved && Object.keys(saved).length > 0) {
      set({ sessions: deserializeSessions(saved), loaded: true })
      return
    }

    // Migration: check for old task-chat-store data
    const oldChats = await loadState<Record<string, unknown>>("nexus-task-chats")
    if (oldChats && Object.keys(oldChats).length > 0) {
      const migrated = migrateTaskChatData(oldChats as Parameters<typeof migrateTaskChatData>[0])
      set({ sessions: migrated, loaded: true })
      immediateSave(migrated)
      return
    }

    set({ loaded: true })
  },

  createSession: (params) => {
    const id = createSessionId()
    const now = new Date()
    const session: Session = {
      id,
      type: params.type,
      status: "active",
      projectId: params.projectId,
      nodeId: params.nodeId,
      providerId: params.providerId,
      model: params.model,
      messages: [],
      steerMessages: [],
      activityEvents: [],
      toolTraces: [],
      fileChanges: [],
      streamText: "",
      metadata: params.metadata,
      createdAt: now,
      updatedAt: now,
    }
    const sessions = new Map(get().sessions)
    sessions.set(id, session)
    set({ sessions })
    immediateSave(sessions)
    return session
  },

  getSession: (sessionId) => {
    return get().sessions.get(sessionId)
  },

  getSessionsForNode: (nodeId, type?) => {
    const result: Session[] = []
    for (const session of get().sessions.values()) {
      if (session.nodeId === nodeId && (!type || session.type === type)) {
        result.push(session)
      }
    }
    return result.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  },

  getSessionsForProject: (projectId, type?) => {
    const result: Session[] = []
    for (const session of get().sessions.values()) {
      if (session.projectId === projectId && (!type || session.type === type)) {
        result.push(session)
      }
    }
    return result.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  },

  addMessage: (sessionId, message) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const newMessage: SessionMessage = {
      ...message,
      id: createMessageId(),
      timestamp: new Date(),
    }

    const updated = {
      ...session,
      messages: [...session.messages, newMessage],
      updatedAt: new Date(),
    }
    sessions.set(sessionId, updated)
    set({ sessions })
    immediateSave(sessions)
  },

  appendToLastAssistantMessage: (sessionId, chunk) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session || session.messages.length === 0) return

    const lastMessage = session.messages[session.messages.length - 1]
    if (lastMessage.role !== "assistant") return

    const updatedMessages = [...session.messages]
    updatedMessages[updatedMessages.length - 1] = {
      ...lastMessage,
      content: lastMessage.content + chunk,
    }

    sessions.set(sessionId, {
      ...session,
      messages: updatedMessages,
      updatedAt: new Date(),
    })
    set({ sessions })
    // Debounce during streaming for performance
    debouncedSave(sessions)
  },

  updateLastAssistantMessage: (sessionId, content, appliedMutations?) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session || session.messages.length === 0) return

    const lastMessage = session.messages[session.messages.length - 1]
    if (lastMessage.role !== "assistant") return

    const updatedMessages = [...session.messages]
    updatedMessages[updatedMessages.length - 1] = {
      ...lastMessage,
      content,
      ...(appliedMutations ? { appliedMutations } : {}),
    }

    sessions.set(sessionId, {
      ...session,
      messages: updatedMessages,
      updatedAt: new Date(),
    })
    set({ sessions })
    immediateSave(sessions)
  },

  setProviderSessionId: (sessionId, providerSessionId) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    sessions.set(sessionId, {
      ...session,
      providerSessionId,
      updatedAt: new Date(),
    })
    set({ sessions })
    immediateSave(sessions)
  },

  setStatus: (sessionId, status) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    sessions.set(sessionId, {
      ...session,
      status,
      updatedAt: new Date(),
      ...(status === "completed" || status === "error" || status === "cancelled"
        ? { completedAt: new Date() }
        : {}),
    })
    set({ sessions })
    immediateSave(sessions)
  },

  setSummary: (sessionId, summary) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    sessions.set(sessionId, {
      ...session,
      summary,
      updatedAt: new Date(),
    })
    set({ sessions })
    immediateSave(sessions)
  },

  setMetrics: (sessionId, metrics) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    sessions.set(sessionId, {
      ...session,
      metrics,
      updatedAt: new Date(),
    })
    set({ sessions })
    debouncedSave(sessions)
  },

  addActivityEvent: (sessionId, event) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    sessions.set(sessionId, {
      ...session,
      activityEvents: [...(session.activityEvents || []), event],
      updatedAt: new Date(),
    })
    set({ sessions })
    debouncedSave(sessions)
  },

  addToolTrace: (sessionId, trace) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    sessions.set(sessionId, {
      ...session,
      toolTraces: [...(session.toolTraces || []), trace],
      updatedAt: new Date(),
    })
    set({ sessions })
    debouncedSave(sessions)
  },

  addFileChange: (sessionId, change) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    sessions.set(sessionId, {
      ...session,
      fileChanges: [...(session.fileChanges || []), change],
      updatedAt: new Date(),
    })
    set({ sessions })
    debouncedSave(sessions)
  },

  setStreamText: (sessionId, text) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    sessions.set(sessionId, {
      ...session,
      streamText: text,
      updatedAt: new Date(),
    })
    set({ sessions })
    debouncedSave(sessions)
  },

  appendStreamText: (sessionId, chunk) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    sessions.set(sessionId, {
      ...session,
      streamText: (session.streamText || "") + chunk,
      updatedAt: new Date(),
    })
    set({ sessions })
    debouncedSave(sessions)
  },

  addSteerMessage: (sessionId, message, interrupted?) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const steerMsg: SteerMessage = {
      message,
      interrupted,
      timestamp: new Date(),
    }

    sessions.set(sessionId, {
      ...session,
      steerMessages: [...(session.steerMessages || []), steerMsg],
      activityEvents: [
        ...(session.activityEvents || []),
        { type: "steer" as const, message, interrupted, timestamp: new Date() },
      ],
      updatedAt: new Date(),
    })
    set({ sessions })
    immediateSave(sessions)
  },

  updateSteerMessage: (sessionId, index, update) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session || !session.steerMessages || !session.steerMessages[index]) return

    const updatedSteers = [...session.steerMessages]
    updatedSteers[index] = { ...updatedSteers[index], ...update }

    // Update matching activity event
    let steerCount = 0
    const updatedEvents = (session.activityEvents || []).map((e) => {
      if (e.type === "steer") {
        if (steerCount === index) {
          steerCount++
          return { ...e, ...update }
        }
        steerCount++
      }
      return e
    })

    sessions.set(sessionId, {
      ...session,
      steerMessages: updatedSteers,
      activityEvents: updatedEvents as TaskActivityEvent[],
      updatedAt: new Date(),
    })
    set({ sessions })
    immediateSave(sessions)
  },

  deleteSession: (sessionId) => {
    const sessions = new Map(get().sessions)
    sessions.delete(sessionId)
    set({ sessions })
    immediateSave(sessions)
  },

  clearSessionsForNode: (nodeId) => {
    const sessions = new Map(get().sessions)
    for (const [id, session] of sessions) {
      if (session.nodeId === nodeId) {
        sessions.delete(id)
      }
    }
    set({ sessions })
    immediateSave(sessions)
  },
}))
