/**
 * Unified Session Store
 *
 * Single source of truth for all session data: project chat, task chat,
 * steer messages, and execution sessions. Replaces the fragmented
 * task-chat-store and project chat useState.
 *
 * Key actions:
 * - createSession: Create a new session
 * - createNewSession: Create a fresh session while marking existing sessions as completed
 */

import { create } from "zustand"
import { dataClient } from "@/lib/data-client"
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
  // Track active session per project+type combination (e.g. "projectId:project-chat" -> sessionId)
  activeSessionIds: Map<string, string>

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
  createNewSession: (params: {
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

  // Active session tracking
  getActiveSessionId: (projectId: string, type: SessionType) => string | undefined
  setActiveSessionId: (projectId: string, type: SessionType, sessionId: string) => void
  clearActiveSessionId: (projectId: string, type: SessionType) => void

  // Message ops
  addMessage: (sessionId: string, message: Omit<SessionMessage, "id" | "timestamp">) => void
  appendToLastAssistantMessage: (sessionId: string, chunk: string) => void
  updateLastAssistantMessage: (sessionId: string, content: string, appliedMutations?: SessionMessage["appliedMutations"]) => void
  truncateAfterMessage: (sessionId: string, messageId: string) => string | undefined

  // Session state
  setProviderSessionId: (sessionId: string, providerSessionId: string) => void
  setStatus: (sessionId: string, status: SessionStatus) => void
  setSummary: (sessionId: string, summary: ExecutionSummary) => void
  setMetrics: (sessionId: string, metrics: UsageMetrics) => void
  renameSession: (sessionId: string, title: string) => void

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

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  loaded: false,
  activeSessionIds: new Map(),

  load: async () => {
    try {
      const apiSessions = await dataClient.getAllSessions()
      if (apiSessions && apiSessions.length > 0) {
        const sessions = new Map<string, Session>()
        for (const session of apiSessions) {
          sessions.set(session.id, session)
        }
        set({ sessions, loaded: true })
        return
      }
    } catch {
      // API unavailable
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
    // Fire-and-forget API call — log failures so FK violations are visible
    dataClient.createSession(session).catch((err) => {
      console.error('[session-store] Failed to persist session:', session.id, err)
    })
    return session
  },

  createNewSession: (params) => {
    // Mark existing sessions of the same type for this project/node as completed
    const sessions = new Map(get().sessions)
    for (const [id, session] of sessions) {
      const matchesProject = session.projectId === params.projectId
      const matchesNode = params.nodeId ? session.nodeId === params.nodeId : !session.nodeId
      const matchesType = session.type === params.type

      if (matchesProject && matchesNode && matchesType && session.status === "active") {
        const updated = {
          ...session,
          status: "completed" as const,
          updatedAt: new Date(),
          completedAt: new Date(),
        }
        sessions.set(id, updated)
        // Fire-and-forget API call to update old session
        dataClient.updateSession(id, {
          status: updated.status,
          updatedAt: updated.updatedAt,
          completedAt: updated.completedAt
        }).catch(() => {})
      }
    }
    set({ sessions })

    // Create the new session using the existing createSession logic
    return get().createSession(params)
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

  getActiveSessionId: (projectId, type) => {
    const key = `${projectId}:${type}`
    return get().activeSessionIds.get(key)
  },

  setActiveSessionId: (projectId, type, sessionId) => {
    const key = `${projectId}:${type}`
    const activeSessionIds = new Map(get().activeSessionIds)
    activeSessionIds.set(key, sessionId)
    set({ activeSessionIds })
  },

  clearActiveSessionId: (projectId, type) => {
    const key = `${projectId}:${type}`
    const activeSessionIds = new Map(get().activeSessionIds)
    activeSessionIds.delete(key)
    set({ activeSessionIds })
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

    // Fire-and-forget API call
    dataClient.addSessionMessage(sessionId, newMessage).catch(() => {})
  },

  appendToLastAssistantMessage: (() => {
    // Throttled state updates: buffer incoming chunks and flush to Zustand
    // at most every 50ms. Prevents React re-rendering on every single token
    // which causes the "delay then bulk text" stutter during fast streaming.
    const pendingChunks = new Map<string, string>()
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = () => {
      flushTimer = null
      const entries = Array.from(pendingChunks.entries())
      pendingChunks.clear()
      if (entries.length === 0) return

      const sessions = new Map(get().sessions)
      for (const [sid, buffered] of entries) {
        const session = sessions.get(sid)
        if (!session || session.messages.length === 0) continue
        const lastMessage = session.messages[session.messages.length - 1]
        if (lastMessage.role !== "assistant") continue

        const updatedMessages = [...session.messages]
        updatedMessages[updatedMessages.length - 1] = {
          ...lastMessage,
          content: lastMessage.content + buffered,
        }
        sessions.set(sid, { ...session, messages: updatedMessages, updatedAt: new Date() })
      }
      set({ sessions })
    }

    return (sessionId: string, chunk: string) => {
      const existing = pendingChunks.get(sessionId) || ''
      pendingChunks.set(sessionId, existing + chunk)
      if (!flushTimer) {
        flushTimer = setTimeout(flush, 50)
      }
    }
  })(),

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

    const updated = {
      ...session,
      messages: updatedMessages,
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, { messages: updatedMessages, updatedAt: updated.updatedAt }).catch(() => {})
  },

  truncateAfterMessage: (sessionId, messageId) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return undefined

    const idx = session.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return undefined

    // Keep messages up to but not including the target message
    const truncatedMessages = session.messages.slice(0, idx)
    const removedMessage = session.messages[idx]

    const updated = {
      ...session,
      messages: truncatedMessages,
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, { messages: truncatedMessages, updatedAt: updated.updatedAt }).catch(() => {})

    return removedMessage.content
  },

  setProviderSessionId: (sessionId, providerSessionId) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const updated = {
      ...session,
      providerSessionId,
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, { providerSessionId, updatedAt: updated.updatedAt }).catch(() => {})
  },

  setStatus: (sessionId, status) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const updated = {
      ...session,
      status,
      updatedAt: new Date(),
      ...(status === "completed" || status === "error" || status === "cancelled"
        ? { completedAt: new Date() }
        : {}),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, { status, updatedAt: updated.updatedAt, completedAt: updated.completedAt }).catch(() => {})
  },

  setSummary: (sessionId, summary) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const updated = {
      ...session,
      summary,
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, { summary, updatedAt: updated.updatedAt }).catch(() => {})
  },

  setMetrics: (sessionId, metrics) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const updated = {
      ...session,
      metrics,
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call (debounced in memory, but API call is immediate)
    dataClient.updateSession(sessionId, { metrics, updatedAt: updated.updatedAt }).catch(() => {})
  },

  renameSession: (sessionId, title) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const updated = {
      ...session,
      title,
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, { title, updatedAt: updated.updatedAt }).catch(() => {})
  },

  addActivityEvent: (sessionId, event) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const updated = {
      ...session,
      activityEvents: [...(session.activityEvents || []), event],
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, { activityEvents: updated.activityEvents, updatedAt: updated.updatedAt }).catch(() => {})
  },

  addToolTrace: (sessionId, trace) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const updated = {
      ...session,
      toolTraces: [...(session.toolTraces || []), trace],
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, { toolTraces: updated.toolTraces, updatedAt: updated.updatedAt }).catch(() => {})
  },

  addFileChange: (sessionId, change) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const updated = {
      ...session,
      fileChanges: [...(session.fileChanges || []), change],
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, { fileChanges: updated.fileChanges, updatedAt: updated.updatedAt }).catch(() => {})
  },

  setStreamText: (sessionId, text) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const updated = {
      ...session,
      streamText: text,
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, { streamText: text, updatedAt: updated.updatedAt }).catch(() => {})
  },

  appendStreamText: (sessionId, chunk) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const updated = {
      ...session,
      streamText: (session.streamText || "") + chunk,
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // No API call during streaming for performance - final state saved via setStreamText
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

    const updated = {
      ...session,
      steerMessages: [...(session.steerMessages || []), steerMsg],
      activityEvents: [
        ...(session.activityEvents || []),
        { type: "steer" as const, message, interrupted, timestamp: new Date() },
      ],
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, {
      steerMessages: updated.steerMessages,
      activityEvents: updated.activityEvents,
      updatedAt: updated.updatedAt
    }).catch(() => {})
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

    const updated = {
      ...session,
      steerMessages: updatedSteers,
      activityEvents: updatedEvents as TaskActivityEvent[],
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.updateSession(sessionId, {
      steerMessages: updated.steerMessages,
      activityEvents: updated.activityEvents,
      updatedAt: updated.updatedAt
    }).catch(() => {})
  },

  deleteSession: (sessionId) => {
    const sessions = new Map(get().sessions)
    sessions.delete(sessionId)
    set({ sessions })

    // Fire-and-forget API call
    dataClient.deleteSession(sessionId).catch(() => {})
  },

  clearSessionsForNode: (nodeId) => {
    const sessions = new Map(get().sessions)
    const idsToDelete: string[] = []
    for (const [id, session] of sessions) {
      if (session.nodeId === nodeId) {
        sessions.delete(id)
        idsToDelete.push(id)
      }
    }

    // Also clear activeSessionIds that reference deleted sessions
    const activeSessionIds = new Map(get().activeSessionIds)
    const deletedSet = new Set(idsToDelete)
    for (const [key, sessionId] of activeSessionIds) {
      if (deletedSet.has(sessionId)) {
        activeSessionIds.delete(key)
      }
    }

    set({ sessions, activeSessionIds })

    // Fire-and-forget API calls
    for (const id of idsToDelete) {
      dataClient.deleteSession(id).catch(() => {})
    }
  },
}))

/**
 * Get display title for a session
 * Priority: custom title > first user message preview > date fallback
 */
export function getSessionTitle(session: Session): string {
  // Check for custom title (set via renameSession)
  if (session.title) {
    return session.title
  }

  // Legacy: check metadata.title
  if (session.metadata?.title && typeof session.metadata.title === "string") {
    return session.metadata.title
  }

  // Auto-generate from first user message
  const firstUserMsg = session.messages.find((m) => m.role === "user")
  if (firstUserMsg?.content) {
    const preview = firstUserMsg.content.slice(0, 50)
    return preview.length < firstUserMsg.content.length ? `${preview}...` : preview
  }

  // Fallback to timestamp-based name
  return `Session ${session.createdAt.toLocaleDateString()}`
}
