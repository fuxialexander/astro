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
import { projectChatWithAgent, chatWithTask, generateTitle, type ChatPlanNodeContext, type ChatPlanEdgeContext } from "@/lib/api-client"
import { usePlanStore } from "./plan-store"
import { useExecutionStore } from "./execution-store"
import { useProjectStore } from "./project-store"
import { useRealtimeStore } from "./realtime-store"
import { watchStream } from "@/lib/stream-watcher"
import { useToastStore } from "./toast-store"
import { showChatCompleteNotification } from "@/lib/notifications"
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

// ─── Infrastructure Error Detection ─────────────────────────────────
// Infrastructure/connection errors (network failures, timeouts) are shown
// as blue operational messages rather than alarming red error blocks.
const INFRA_ERROR_PATTERNS = [
  /failed to fetch/i,
  /load failed/i,             // Safari's version of "Failed to fetch"
  /request timed out/i,
  /connection (failed|refused|reset|closed)/i,
  /network\s*(error|request failed)/i,
  /fetch failed/i,
  /econnrefused/i,
  /econnreset/i,
  /etimedout/i,
]

function isInfrastructureError(error: string): boolean {
  return INFRA_ERROR_PATTERNS.some((p) => p.test(error))
}

// ─── Module-Level Streaming Infrastructure ──────────────────────────
// AbortControllers and streaming state live outside React so they
// survive component unmounts (same pattern as execution-store.ts).
const chatAbortControllers = new Map<string, AbortController>()

// Queue of pending chat messages per session (sessionId → params[]).
// Lives outside React so it survives component unmounts.
// When a message is sent while already streaming, it is queued here
// and automatically drained when the current stream completes.
type QueuedChatMessage =
  | { kind: 'project'; params: SendChatMessageParams }
  | { kind: 'playground'; params: SendPlaygroundChatParams }
const chatMessageQueues = new Map<string, QueuedChatMessage[]>()

/** Set a chat stream's status in the realtime-store so periodic catch-up polling activates. */
function setChatStreamStatus(streamId: string, status: string) {
  useRealtimeStore.setState((state) => {
    const streams = new Map(state.taskStreams)
    const existing = streams.get(streamId) || {
      taskId: streamId, stdout: '', progress: 0,
      toolTraces: [], fileChanges: [], steerMessages: [], activityEvents: [],
    }
    streams.set(streamId, { ...existing, status })
    return { taskStreams: streams }
  })
}

/** Drain the next queued message for a session. Called after onComplete/onError. */
function drainChatQueue(sid: string, get: () => SessionState, set: (partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void) {
  const queue = chatMessageQueues.get(sid)
  if (!queue || queue.length === 0) return
  const [next, ...rest] = queue
  if (rest.length > 0) {
    chatMessageQueues.set(sid, rest)
  } else {
    chatMessageQueues.delete(sid)
  }
  set((state) => {
    const d = new Map(state.chatQueueDepths)
    const newDepth = (d.get(sid) || 1) - 1
    if (newDepth <= 0) d.delete(sid); else d.set(sid, newDepth)
    return { chatQueueDepths: d }
  })
  // Defer to avoid re-entering the same onComplete callback stack
  queueMicrotask(() => {
    if (next.kind === 'project') {
      get().sendChatMessage({ ...next.params, _fromQueue: true })
    } else {
      get().sendPlaygroundChat({ ...next.params, _fromQueue: true })
    }
  })
}

// Plan-mutating MCP tools that should trigger a plan refresh
const PLAN_MUTATING_TOOLS = new Set(["create_task", "update_task", "delete_task", "create_dependency", "Bash"])

/** Parameters for sendChatMessage (project chat / replan) */
export interface SendChatMessageParams {
  sessionId: string
  projectId: string
  message: string
  visionDoc?: string
  model?: string
  providerId?: string
  planNodes?: ChatPlanNodeContext[]
  planEdges?: ChatPlanEdgeContext[]
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Blob IDs for attached images (multimodal chat) */
  imageRefs?: string[]
  /** Override pathway mode when reusing /api/agent/project-chat */
  taskType?: 'plan' | 'execution'
  /** @internal Set by queue drain — skips duplicate chat_user event push */
  _fromQueue?: boolean
}

/** Parameters for sendPlaygroundChat (playground post-completion chat) */
export interface SendPlaygroundChatParams {
  sessionId: string
  projectId: string
  nodeId: string
  message: string
  taskTitle: string
  taskDescription: string
  taskOutput?: string
  visionDoc?: string
  model?: string
  providerId?: string
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  branchName?: string
  prUrl?: string
  /** Blob IDs for attached images (multimodal chat) */
  imageRefs?: string[]
  /** @internal Set by queue drain — skips duplicate chat_user event push */
  _fromQueue?: boolean
}

interface SessionState {
  sessions: Map<string, Session>
  loaded: boolean
  // Track active session per project+type combination (e.g. "projectId:project-chat" -> sessionId)
  activeSessionIds: Map<string, string>
  // Session IDs currently streaming (store-owned SSE connections)
  streamingSessions: Set<string>
  // Session IDs whose components are currently mounted
  mountedSessionIds: Set<string>
  // Reactive queue depth per session for UI indicators
  chatQueueDepths: Map<string, number>

  // Lifecycle
  load: () => Promise<void>
  ensureFullSession: (sessionId: string) => Promise<Session | undefined>

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
  getOrCreateSession: (params: {
    type: SessionType
    projectId: string
    nodeId?: string
    providerId?: string
    model?: string
    metadata?: Record<string, unknown>
  }) => Session

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
  setProviderSessionId: (sessionId: string, providerSessionId: string, providerId?: string) => void
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

  // Store-owned chat streaming (with unified message queue)
  sendChatMessage: (params: SendChatMessageParams) => void
  sendPlaygroundChat: (params: SendPlaygroundChatParams) => void
  abortChatStream: (sessionId: string) => void
  isStreaming: (sessionId: string) => boolean
  getChatQueueDepth: (sessionId: string) => number
  registerMounted: (sessionId: string) => void
  unregisterMounted: (sessionId: string) => void

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

// Deduplicates concurrent ensureFullSession calls for the same sessionId
const inFlightSessionFetches = new Map<string, Promise<Session | undefined>>()

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  loaded: false,
  activeSessionIds: new Map(),
  streamingSessions: new Set(),
  mountedSessionIds: new Set(),
  chatQueueDepths: new Map(),

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

  ensureFullSession: async (sessionId: string) => {
    const existing = get().sessions.get(sessionId)
    // If already has messages loaded (either from streaming or from a prior fetch), skip
    if (existing && existing.messages.length > 0) return existing

    // Deduplicate concurrent fetches for the same session
    const inFlight = inFlightSessionFetches.get(sessionId)
    if (inFlight) return inFlight

    const fetchPromise = (async () => {
      try {
        const full = await dataClient.getSession(sessionId)
        if (full) {
          const sessions = new Map(get().sessions)
          sessions.set(sessionId, full)
          set({ sessions })
          return full
        }
      } catch {
        // API unavailable — return existing stub
      }
      return existing
    })()

    inFlightSessionFetches.set(sessionId, fetchPromise)
    try {
      return await fetchPromise
    } finally {
      inFlightSessionFetches.delete(sessionId)
    }
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
    return result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  },

  getSessionsForProject: (projectId, type?) => {
    const result: Session[] = []
    for (const session of get().sessions.values()) {
      if (session.projectId === projectId && (!type || session.type === type)) {
        result.push(session)
      }
    }
    return result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  },

  getOrCreateSession: (params) => {
    // Atomically find an existing session matching projectId + type (+ nodeId), or create one.
    // This prevents duplicate sessions when multiple components mount simultaneously.
    for (const session of get().sessions.values()) {
      if (
        session.projectId === params.projectId &&
        session.type === params.type &&
        session.status === "active" &&
        (params.nodeId ? session.nodeId === params.nodeId : !session.nodeId)
      ) {
        return session
      }
    }
    return get().createSession(params)
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

  setProviderSessionId: (sessionId, providerSessionId, providerId?) => {
    const sessions = new Map(get().sessions)
    const session = sessions.get(sessionId)
    if (!session) return

    const updated = {
      ...session,
      providerSessionId,
      ...(providerId !== undefined && { providerId }),
      updatedAt: new Date(),
    }

    sessions.set(sessionId, updated)
    set({ sessions })

    // Fire-and-forget API call
    const updates: Record<string, unknown> = { providerSessionId, updatedAt: updated.updatedAt }
    if (providerId !== undefined) updates.providerId = providerId
    dataClient.updateSession(sessionId, updates).catch(() => {})
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
    // No DB write — activity events are persisted via streaming_events table.
    // Sending the full accumulated JSONB array on every event caused O(n²) egress.
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
    // No DB write — tool traces are persisted via streaming_events table.
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
    // No DB write — file changes are persisted via streaming_events table.
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
    // No DB write — steer messages are persisted via streaming_events / realtime-store.
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
    // No DB write — steer messages are persisted via streaming_events / realtime-store.
  },

  // ─── Store-owned chat streaming (with unified message queue) ─────

  getChatQueueDepth: (sessionId) => {
    return get().chatQueueDepths.get(sessionId) || 0
  },

  sendChatMessage: (params) => {
    const { sessionId: sid, projectId, message, visionDoc, model, providerId, planNodes, planEdges, messages, imageRefs, taskType, _fromQueue } = params
    const session = get().sessions.get(sid)
    if (!session) return

    // If already streaming, enqueue and show queued user message in feed
    if (get().streamingSessions.has(sid)) {
      const queue = chatMessageQueues.get(sid) || []
      chatMessageQueues.set(sid, [...queue, { kind: 'project', params }])
      useRealtimeStore.getState().pushActivityEvent(sid, {
        type: 'chat_user',
        message,
        queued: true,
        timestamp: new Date(),
      })
      set((state) => {
        const d = new Map(state.chatQueueDepths)
        d.set(sid, (d.get(sid) || 0) + 1)
        return { chatQueueDepths: d }
      })
      return
    }

    // Mark streaming
    set((state) => {
      const ss = new Set(state.streamingSessions)
      ss.add(sid)
      return { streamingSessions: ss }
    })

    // Abort any existing stream for this session
    const existing = chatAbortControllers.get(sid)
    if (existing) existing.abort()
    const abortController = new AbortController()
    chatAbortControllers.set(sid, abortController)

    // Track raw text outside React state for synchronous access in onDone
    let rawAssistantText = ""
    let needsPlanRefresh = false

    // Suppress YOLO batch cascading while chat mutations are in flight.
    // Set unconditionally — a batch may start while the chat is still streaming.
    // The guard in triggerBatchWave checks the flag; this just ensures it's set.
    useExecutionStore.getState().setChatMutationActive(projectId, true)

    // json-render: yaml-spec fences are parsed from rawAssistantText in onDone.
    // During streaming, text passes through normally (including yaml-spec fences
    // which render as code blocks). On completion, we extract specs and emit
    // json_render_spec events. This avoids complex chunk-level fence detection.

    // Push user event to realtime store (skip if from queue — already pushed with queued indicator)
    if (!_fromQueue) {
      useRealtimeStore.getState().pushActivityEvent(sid, {
        type: 'chat_user',
        message,
        timestamp: new Date(),
      })
    }

    // Mark chat stream as running so periodic catch-up polling activates
    setChatStreamStatus(sid, 'running')

    // System message: request received
    useRealtimeStore.getState().pushActivityEvent(sid, {
      type: 'system_message',
      message: 'Astro received your request. Connecting to agent…',
      timestamp: new Date(),
    })

    // Only send providerSessionId if session has completed exchanges
    // and the provider hasn't changed (resume on a different provider would fail)
    const hasCompletedExchange = session.messages.some(
      (m) => m.role === "assistant" && m.content.length > 0
    )
    const providerUnchanged = !session.providerId || session.providerId === providerId

    // Determine if we can resume the provider session.
    // A valid resume requires a real provider session ID (not the frontend session ID).
    const canResume = hasCompletedExchange && providerUnchanged &&
      session.providerSessionId && session.providerSessionId !== sid
    const resumeId = canResume ? session.providerSessionId : undefined

    // Always send messages so the agent runner has conversation context for fallback
    // if the resume fails (e.g. Codex session expired, different machine).
    // The agent runner only uses messages when falling back to fresh execution.

    // Subscribe to stream events via the global SSE bus (Phase 3.4: POST + subscribe)
    const unwatchStream = watchStream(sid, {
      onTextChunk: (chunk) => {
        rawAssistantText += chunk
        get().appendToLastAssistantMessage(sid, chunk)
      },
      onToolUse: (toolName) => {
        if (PLAN_MUTATING_TOOLS.has(toolName)) needsPlanRefresh = true
      },
      onToolResult: (toolName) => {
        if (PLAN_MUTATING_TOOLS.has(toolName)) needsPlanRefresh = true
      },
      onComplete: async (info) => {
        if (info.sessionId) {
          get().setProviderSessionId(sid, info.sessionId, providerId)
        }

        // Refresh plan from server if Bash/MCP tools modified the plan
        if (needsPlanRefresh) {
          await usePlanStore.getState().load()

          // Push a plan_result event so the user sees an updated graph in the activity feed
          const updatedNodes = usePlanStore.getState().nodes.filter((n) => n.projectId === projectId)
          const updatedEdgeSet = new Set(updatedNodes.map((n) => n.id))
          const updatedEdges = usePlanStore.getState().edges.filter(
            (e) => updatedEdgeSet.has(e.source) || updatedEdgeSet.has(e.target)
          )
          const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
          useRealtimeStore.getState().pushActivityEvent(sid, {
            type: 'plan_result',
            nodes: updatedNodes.map((n) => ({ id: n.id, title: n.title, type: n.type, status: n.status })),
            edges: updatedEdges.map((e) => ({ source: e.source, target: e.target })),
            projectName: project?.name ?? '',
            timestamp: new Date(),
          })

          // Warn user if YOLO batch is active — tasks created via CLI won't auto-dispatch
          if (useExecutionStore.getState().isBatchActive(projectId)) {
            useToastStore.getState().add({
              type: 'info',
              title: 'Plan updated from chat',
              description: 'New tasks were created while auto-execution is active. They will not be auto-dispatched — review and dispatch manually if needed.',
              duration: 8000,
            })
          }
        }

        get().updateLastAssistantMessage(sid, rawAssistantText)

        // Push "completed" operational event (blue status line)
        useRealtimeStore.getState().pushActivityEvent(sid, {
          type: 'operational',
          message: 'Agent runner finished processing',
          source: 'astro',
          timestamp: new Date(),
        })

        // Clear chat mutation flag and streaming state
        useExecutionStore.getState().setChatMutationActive(projectId, false)
        setChatStreamStatus(sid, 'completed')
        chatAbortControllers.delete(sid)
        set((state) => {
          const ss = new Set(state.streamingSessions)
          ss.delete(sid)
          return { streamingSessions: ss }
        })

        // Auto-generate title after first conversation round completes.
        const updatedSession = get().sessions.get(sid)
        const isFirstExchange = updatedSession && !updatedSession.title &&
          rawAssistantText.length > 0 &&
          updatedSession.messages.filter((m) => m.role === 'assistant' && m.content.length > 0).length <= 1
        if (isFirstExchange && message.length > 0) {
          const titleInput = message.length > 200
            ? message.slice(0, 200)
            : `${message}\n---\n${rawAssistantText.slice(0, 300)}`
          generateTitle(titleInput).then((aiTitle) => {
            if (aiTitle) get().renameSession(sid, aiTitle)
          }).catch(() => {}) // silent — auto-generated title is optional
        }

        // Notify if component is not mounted
        if (!get().mountedSessionIds.has(sid)) {
          const proj = get().sessions.get(sid)
          const projectName = proj?.metadata?.projectName as string || "Project"
          showChatCompleteNotification(projectName)
          useToastStore.getState().add({
            type: "info",
            title: "Chat response ready",
            description: `Response for "${projectName}" is ready.`,
          })
        }

        // Drain next queued message (unified queue)
        drainChatQueue(sid, get, set)
      },
      onError: (error) => {
        if (isInfrastructureError(error)) {
          useRealtimeStore.getState().pushActivityEvent(sid, {
            type: 'operational',
            message: error,
            source: 'astro',
            timestamp: new Date(),
          })
        } else {
          get().appendToLastAssistantMessage(sid, `\nError: ${error}`)
          useRealtimeStore.getState().pushActivityEvent(sid, {
            type: 'error',
            error,
            timestamp: new Date(),
          })
        }
        useExecutionStore.getState().setChatMutationActive(projectId, false)
        setChatStreamStatus(sid, 'error')
        chatAbortControllers.delete(sid)
        set((state) => {
          const ss = new Set(state.streamingSessions)
          ss.delete(sid)
          return { streamingSessions: ss }
        })

        // Drain next queued message even on error (avoid permanently blocked queue)
        drainChatQueue(sid, get, set)
      },
    })

    // Fire-and-forget — POST returns JSON, events arrive via global SSE bus
    projectChatWithAgent(
      {
        message,
        sessionId: resumeId,
        streamId: sid,
        projectId,
        visionDoc,
        model,
        providerId,
        planNodes,
        planEdges,
        messages,
        imageRefs,
        taskType: taskType || (session.type === 'plan-generation' ? 'plan' : undefined),
      },
      abortController.signal,
    ).catch((err) => {
      unwatchStream()
      // Fetch-level error — infrastructure errors (network failures, timeouts) show
      // as blue operational text; server errors (503, 500) stay red.
      // Guard: if this controller was replaced by a newer stream, skip cleanup
      // to avoid clearing the newer stream's state (race on rapid re-send).
      const isAbort = err?.name === 'AbortError'
      const isStale = chatAbortControllers.get(sid) !== abortController
      if (!isAbort && !isStale) {
        const errorMsg = err?.message || 'Connection failed'
        if (isInfrastructureError(errorMsg)) {
          useRealtimeStore.getState().pushActivityEvent(sid, {
            type: 'operational',
            message: errorMsg,
            source: 'astro',
            timestamp: new Date(),
          })
        } else {
          get().appendToLastAssistantMessage(sid, `\nError: ${errorMsg}`)
          useRealtimeStore.getState().pushActivityEvent(sid, {
            type: 'error',
            error: errorMsg,
            timestamp: new Date(),
          })
        }
      }
      if (!isStale) {
        useExecutionStore.getState().setChatMutationActive(projectId, false)
        setChatStreamStatus(sid, 'error')
        chatAbortControllers.delete(sid)
        set((state) => {
          const ss = new Set(state.streamingSessions)
          ss.delete(sid)
          return { streamingSessions: ss }
        })
        drainChatQueue(sid, get, set)
      }
    })
  },

  sendPlaygroundChat: (params) => {
    const { sessionId: sid, projectId, nodeId, message, taskTitle, taskDescription, taskOutput, visionDoc, model, providerId, messages, branchName, prUrl, imageRefs, _fromQueue } = params
    const session = get().sessions.get(sid)
    if (!session) return

    // If already streaming, enqueue and show queued user message in feed
    if (get().streamingSessions.has(sid)) {
      const queue = chatMessageQueues.get(sid) || []
      chatMessageQueues.set(sid, [...queue, { kind: 'playground', params }])
      useRealtimeStore.getState().pushActivityEvent(sid, {
        type: 'chat_user',
        message,
        queued: true,
        timestamp: new Date(),
      })
      set((state) => {
        const d = new Map(state.chatQueueDepths)
        d.set(sid, (d.get(sid) || 0) + 1)
        return { chatQueueDepths: d }
      })
      return
    }

    // Mark streaming
    set((state) => {
      const ss = new Set(state.streamingSessions)
      ss.add(sid)
      return { streamingSessions: ss }
    })

    // Abort any existing stream for this session
    const existing = chatAbortControllers.get(sid)
    if (existing) existing.abort()
    const abortController = new AbortController()
    chatAbortControllers.set(sid, abortController)

    // Track raw text outside React state for synchronous access in onDone
    let rawAssistantText = ""

    // Push user event (skip if from queue — already pushed with queued indicator)
    if (!_fromQueue) {
      useRealtimeStore.getState().pushActivityEvent(sid, {
        type: 'chat_user',
        message,
        timestamp: new Date(),
      })
      // Add to dashboard activity feed
      const preview = message.length > 60 ? message.slice(0, 57) + '...' : message
      useRealtimeStore.getState().addActivityEntry('chat', `Follow-up: ${preview}`)
    }

    // Mark chat stream as running so periodic catch-up polling activates
    setChatStreamStatus(sid, 'running')

    // System message: request received
    useRealtimeStore.getState().pushActivityEvent(sid, {
      type: 'system_message',
      message: 'Astro received your request. Connecting to agent…',
      timestamp: new Date(),
    })

    // Determine if we should resume a provider session.
    // A valid resume requires: (1) a completed assistant exchange, AND
    // (2) a real provider session ID (not the frontend session ID which would
    // be stored if the agent-runner never emitted session_init).
    const hasCompletedExchange = session.messages.some(
      (m) => m.role === "assistant" && m.content.length > 0
    )
    const providerUnchanged = !session.providerId || session.providerId === providerId
    const hasRealProviderSession = !!(
      hasCompletedExchange &&
      providerUnchanged &&
      session.providerSessionId &&
      session.providerSessionId !== sid
    )

    // Always send messages so the agent runner has conversation context for fallback
    // if the resume fails (e.g. Codex session expired). The agent runner only uses
    // messages when falling back to fresh execution, not during the resume itself.
    const resumeSessionId = hasRealProviderSession ? session.providerSessionId : undefined

    // Subscribe to stream events via the global SSE bus (Phase 3.4: POST + subscribe)
    const unwatchStream = watchStream(sid, {
      onTextChunk: (chunk) => {
        rawAssistantText += chunk
        get().appendToLastAssistantMessage(sid, chunk)
      },
      onComplete: (info) => {
        if (info.sessionId) get().setProviderSessionId(sid, info.sessionId, providerId)

        // Finalize the assistant message
        const currentSession = get().sessions.get(sid)
        const lastMsg = currentSession?.messages[currentSession.messages.length - 1]
        if (lastMsg?.role === 'assistant') {
          if (rawAssistantText.length > 0) {
            get().updateLastAssistantMessage(sid, rawAssistantText)
          }
        } else if (rawAssistantText.length > 0) {
          get().addMessage(sid, { role: "assistant", content: rawAssistantText })
        }

        // Push "completed" operational event (blue status line)
        useRealtimeStore.getState().pushActivityEvent(sid, {
          type: 'operational',
          message: 'Agent runner finished processing',
          source: 'astro',
          timestamp: new Date(),
        })

        setChatStreamStatus(sid, 'completed')
        chatAbortControllers.delete(sid)
        set((state) => {
          const ss = new Set(state.streamingSessions)
          ss.delete(sid)
          return { streamingSessions: ss }
        })

        // Auto-generate title after first conversation round completes.
        const updatedSession = get().sessions.get(sid)
        const isFirstExchange = updatedSession && !updatedSession.title &&
          rawAssistantText.length > 0 &&
          updatedSession.messages.filter((m) => m.role === 'assistant' && m.content.length > 0).length <= 1
        if (isFirstExchange && message.length > 0) {
          const projectBefore = useProjectStore.getState().projects.find((p) => p.id === projectId)
          const projectNameBefore = projectBefore?.name
          const titleInput = message.length > 200
            ? message.slice(0, 200)
            : `${message}\n---\n${rawAssistantText.slice(0, 300)}`
          generateTitle(titleInput).then((aiTitle) => {
            if (aiTitle) {
              get().renameSession(sid, aiTitle)
              const projectNow = useProjectStore.getState().projects.find((p) => p.id === projectId)
              if (projectNow && projectNow.name === projectNameBefore) {
                useProjectStore.getState().updateProject(projectId, { name: aiTitle })
              }
            }
          }).catch(() => {})
        }

        // Notify if component is not mounted
        if (!get().mountedSessionIds.has(sid)) {
          showChatCompleteNotification("Playground")
        }

        // Drain next queued message (unified queue)
        drainChatQueue(sid, get, set)
      },
      onError: (error) => {
        if (isInfrastructureError(error)) {
          useRealtimeStore.getState().pushActivityEvent(sid, {
            type: 'operational',
            message: error,
            source: 'astro',
            timestamp: new Date(),
          })
        } else {
          get().appendToLastAssistantMessage(sid, `\nError: ${error}`)
          useRealtimeStore.getState().pushActivityEvent(sid, {
            type: 'error',
            error,
            timestamp: new Date(),
          })
        }
        setChatStreamStatus(sid, 'error')
        chatAbortControllers.delete(sid)
        set((state) => {
          const ss = new Set(state.streamingSessions)
          ss.delete(sid)
          return { streamingSessions: ss }
        })

        // Drain next queued message even on error (avoid permanently blocked queue)
        drainChatQueue(sid, get, set)
      },
    })

    // Fire-and-forget — POST returns JSON, events arrive via global SSE bus
    chatWithTask(
      {
        message,
        sessionId: resumeSessionId,
        streamId: sid,
        nodeId,
        projectId,
        taskTitle,
        taskDescription,
        taskOutput,
        visionDoc,
        model,
        providerId,
        messages,
        branchName,
        prUrl,
        imageRefs,
      },
      abortController.signal,
    ).catch((err) => {
      unwatchStream()
      const isAbort = err?.name === 'AbortError'
      const isStale = chatAbortControllers.get(sid) !== abortController
      if (!isAbort && !isStale) {
        const errorMsg = err?.message || 'Connection failed'
        if (isInfrastructureError(errorMsg)) {
          useRealtimeStore.getState().pushActivityEvent(sid, {
            type: 'operational',
            message: errorMsg,
            source: 'astro',
            timestamp: new Date(),
          })
        } else {
          get().appendToLastAssistantMessage(sid, `\nError: ${errorMsg}`)
          useRealtimeStore.getState().pushActivityEvent(sid, {
            type: 'error',
            error: errorMsg,
            timestamp: new Date(),
          })
        }
      }
      if (!isStale) {
        setChatStreamStatus(sid, 'error')
        chatAbortControllers.delete(sid)
        set((state) => {
          const ss = new Set(state.streamingSessions)
          ss.delete(sid)
          return { streamingSessions: ss }
        })
        drainChatQueue(sid, get, set)
      }
    })
  },

  abortChatStream: (sessionId) => {
    const controller = chatAbortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      chatAbortControllers.delete(sessionId)
    }
    // Mark stream as aborted so periodic catch-up polling stops
    setChatStreamStatus(sessionId, 'aborted')
    // Clear chat mutation flag for the session's project (if any)
    const session = get().sessions.get(sessionId)
    if (session?.projectId) {
      useExecutionStore.getState().setChatMutationActive(session.projectId, false)
    }
    // Clear the message queue so stale queued messages don't fire after abort
    chatMessageQueues.delete(sessionId)

    // Clean up empty assistant placeholder left by abort
    const sessions = new Map(get().sessions)
    const currentSession = sessions.get(sessionId)
    if (currentSession) {
      const msgs = currentSession.messages
      if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant' && !msgs[msgs.length - 1].content) {
        sessions.set(sessionId, { ...currentSession, messages: msgs.slice(0, -1), updatedAt: new Date() })
      }
    }

    set((state) => {
      const ss = new Set(state.streamingSessions)
      ss.delete(sessionId)
      const d = new Map(state.chatQueueDepths)
      d.delete(sessionId)
      return { streamingSessions: ss, chatQueueDepths: d, sessions }
    })
  },

  isStreaming: (sessionId) => {
    return get().streamingSessions.has(sessionId)
  },

  registerMounted: (sessionId) => {
    set((state) => {
      const ms = new Set(state.mountedSessionIds)
      ms.add(sessionId)
      return { mountedSessionIds: ms }
    })
  },

  unregisterMounted: (sessionId) => {
    set((state) => {
      const ms = new Set(state.mountedSessionIds)
      ms.delete(sessionId)
      return { mountedSessionIds: ms }
    })
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

  // Use titlePreview from lightweight list endpoint (avoids needing full messages)
  if (session.titlePreview) {
    const preview = session.titlePreview.slice(0, 50)
    return preview.length < session.titlePreview.length ? `${preview}...` : preview
  }

  // Auto-generate from first user message (available when full session is loaded)
  const firstUserMsg = session.messages.find((m) => m.role === "user")
  if (firstUserMsg?.content) {
    const preview = firstUserMsg.content.slice(0, 50)
    return preview.length < firstUserMsg.content.length ? `${preview}...` : preview
  }

  // Fallback to timestamp-based name
  return `Session ${session.createdAt.toLocaleDateString()}`
}
