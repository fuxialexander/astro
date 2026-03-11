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
import { projectChatWithAgent, chatWithTask, type ChatPlanNodeContext, type ChatPlanEdgeContext } from "@/lib/api-client"
import { extractMutations, applyMutationsToStore } from "@/lib/plan-mutations"
import { usePlanStore } from "./plan-store"
import { useRealtimeStore } from "./realtime-store"
import { useUsageStore } from "./usage-store"
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

// ─── Module-Level Streaming Infrastructure ──────────────────────────
// AbortControllers and streaming state live outside React so they
// survive component unmounts (same pattern as execution-store.ts).
const chatAbortControllers = new Map<string, AbortController>()

// Plan-mutating MCP tools that should trigger a plan refresh
const PLAN_MUTATING_TOOLS = new Set(["create_task", "update_task", "delete_task", "create_dependency"])

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

  // Store-owned chat streaming
  sendChatMessage: (params: SendChatMessageParams) => void
  sendPlaygroundChat: (params: SendPlaygroundChatParams) => void
  abortChatStream: (sessionId: string) => void
  isStreaming: (sessionId: string) => boolean
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

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  loaded: false,
  activeSessionIds: new Map(),
  streamingSessions: new Set(),
  mountedSessionIds: new Set(),

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

  // ─── Store-owned chat streaming ──────────────────────────────────

  sendChatMessage: (params) => {
    const { sessionId: sid, projectId, message, visionDoc, model, providerId, planNodes, planEdges, messages } = params
    const session = get().sessions.get(sid)
    if (!session) return

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

    // Push user event to realtime store
    useRealtimeStore.getState().pushActivityEvent(sid, {
      type: 'chat_user',
      message,
      timestamp: new Date(),
    })

    // Only send providerSessionId if session has completed exchanges
    // and the provider hasn't changed (resume on a different provider would fail)
    const hasCompletedExchange = session.messages.some(
      (m) => m.role === "assistant" && m.content.length > 0
    )
    const providerUnchanged = !session.providerId || session.providerId === providerId

    // Fire-and-forget — stream runs in background
    projectChatWithAgent(
      {
        message,
        sessionId: (hasCompletedExchange && providerUnchanged) ? session.providerSessionId : undefined,
        streamId: sid,
        projectId,
        visionDoc,
        model,
        providerId,
        planNodes,
        planEdges,
        messages,
      },
      {
        // Text/tool events are NOT pushed to the realtime store here — they
        // arrive via the global SSE → realtime store path (DB-authoritative,
        // multi-device consistent). Pushing here too causes duplicate rendering.
        onText: (chunk) => {
          rawAssistantText += chunk
          get().appendToLastAssistantMessage(sid, chunk)
        },
        onToolUse: (data) => {
          if (PLAN_MUTATING_TOOLS.has(data.toolName)) needsPlanRefresh = true
        },
        onToolResult: (data) => {
          if (PLAN_MUTATING_TOOLS.has(data.toolName)) needsPlanRefresh = true
        },
        onDone: (newProviderSessionId) => {
          if (newProviderSessionId) {
            get().setProviderSessionId(sid, newProviderSessionId, providerId)
          }

          // Refresh plan from server if MCP tools modified the plan
          if (needsPlanRefresh) {
            usePlanStore.getState().load()
          }

          // Extract and apply mutations from raw text
          const { cleanContent, mutations } = extractMutations(rawAssistantText)
          const hasMutations = mutations.nodeUpdates.length > 0 || mutations.edgeOps.length > 0 || mutations.newNodes.length > 0

          if (hasMutations) {
            const { affectedNodeIds, resolvedMutations } = applyMutationsToStore(projectId, mutations)
            if (affectedNodeIds.length > 0) {
              usePlanStore.getState().markNodesAsUpdating(affectedNodeIds)
            }
            useRealtimeStore.getState().pushActivityEvent(sid, {
              type: 'mutation',
              nodeUpdates: resolvedMutations.nodeUpdates,
              edgeOps: resolvedMutations.edgeOps,
              newNodes: resolvedMutations.newNodes,
              timestamp: new Date(),
            })
            get().updateLastAssistantMessage(sid, cleanContent, resolvedMutations)
          } else {
            const looksLikeMutations = /\[\s*\{[^}]*"(?:nodeId|nodeTitle|action|title)"/.test(rawAssistantText)
            if (looksLikeMutations && rawAssistantText.length > 100) {
              console.warn("[session-store] Response contains JSON-like mutation data but no mutations were extracted")
              useToastStore.getState().add({
                type: "warning",
                title: "Plan changes not applied",
                description: "The AI described changes but they weren't in the expected format. Try asking again.",
              })
            }
            get().updateLastAssistantMessage(sid, rawAssistantText)
          }

          // Clear streaming state
          chatAbortControllers.delete(sid)
          set((state) => {
            const ss = new Set(state.streamingSessions)
            ss.delete(sid)
            return { streamingSessions: ss }
          })

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
        },
        onError: (error) => {
          get().appendToLastAssistantMessage(sid, `\nError: ${error}`)
          chatAbortControllers.delete(sid)
          set((state) => {
            const ss = new Set(state.streamingSessions)
            ss.delete(sid)
            return { streamingSessions: ss }
          })
        },
        onCompaction: (data) => {
          useRealtimeStore.getState().pushActivityEvent(sid, {
            type: 'system_message',
            message: `Context compacted: ${data.originalCount} messages → ${data.compactedCount}`,
            timestamp: new Date(),
          })
        },
        onMetrics: (m) => {
          useUsageStore.getState().addTaskMetrics({
            durationMs: m.durationMs,
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            estimatedCostUsd: m.totalCost,
            model: m.model,
            turnsUsed: m.numTurns,
          }, true)
        },
      },
      abortController.signal,
    ).catch(() => {
      // Stream errored at fetch level — clean up
      chatAbortControllers.delete(sid)
      set((state) => {
        const ss = new Set(state.streamingSessions)
        ss.delete(sid)
        return { streamingSessions: ss }
      })
    })
  },

  sendPlaygroundChat: (params) => {
    const { sessionId: sid, projectId, nodeId, message, taskTitle, taskDescription, taskOutput, visionDoc, model, providerId, messages, branchName, prUrl } = params
    const session = get().sessions.get(sid)
    if (!session) return

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

    let rawText = ""

    // Push user event
    useRealtimeStore.getState().pushActivityEvent(sid, {
      type: 'chat_user',
      message,
      timestamp: new Date(),
    })

    const hasCompletedExchange = session.messages.some(
      (m) => m.role === "assistant" && m.content.length > 0
    )

    chatWithTask(
      {
        message,
        sessionId: hasCompletedExchange ? session.providerSessionId : undefined,
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
      },
      {
        // Text/tool events arrive via global SSE → realtime store (DB-authoritative).
        // Only accumulate rawText for session message storage.
        onText: (chunk) => {
          rawText += chunk
        },
        onToolUse: () => {},
        onToolResult: () => {},
        onDone: (newSessionId) => {
          if (newSessionId) get().setProviderSessionId(sid, newSessionId)
          // Store raw text only — tool context is already in taskOutput;
          // appending tool summaries here would pollute conversation history
          // sent to the LLM on subsequent turns
          get().addMessage(sid, { role: "assistant", content: rawText })

          chatAbortControllers.delete(sid)
          set((state) => {
            const ss = new Set(state.streamingSessions)
            ss.delete(sid)
            return { streamingSessions: ss }
          })

          // Notify if component is not mounted
          if (!get().mountedSessionIds.has(sid)) {
            showChatCompleteNotification("Playground")
          }
        },
        onError: (error) => {
          useRealtimeStore.getState().pushActivityEvent(sid, {
            type: 'error',
            error,
            timestamp: new Date(),
          })
          chatAbortControllers.delete(sid)
          set((state) => {
            const ss = new Set(state.streamingSessions)
            ss.delete(sid)
            return { streamingSessions: ss }
          })
        },
        onMetrics: (m) => {
          useUsageStore.getState().addTaskMetrics({
            durationMs: m.durationMs,
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            estimatedCostUsd: m.totalCost,
            model: m.model,
            turnsUsed: m.numTurns,
          }, true)
        },
      },
      abortController.signal,
    ).catch(() => {
      chatAbortControllers.delete(sid)
      set((state) => {
        const ss = new Set(state.streamingSessions)
        ss.delete(sid)
        return { streamingSessions: ss }
      })
    })
  },

  abortChatStream: (sessionId) => {
    const controller = chatAbortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      chatAbortControllers.delete(sessionId)
    }
    set((state) => {
      const ss = new Set(state.streamingSessions)
      ss.delete(sessionId)
      return { streamingSessions: ss }
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

  // Auto-generate from first user message
  const firstUserMsg = session.messages.find((m) => m.role === "user")
  if (firstUserMsg?.content) {
    const preview = firstUserMsg.content.slice(0, 50)
    return preview.length < firstUserMsg.content.length ? `${preview}...` : preview
  }

  // Fallback to timestamp-based name
  return `Session ${session.createdAt.toLocaleDateString()}`
}
