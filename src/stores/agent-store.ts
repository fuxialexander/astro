import { create } from "zustand"
import { fetchStreamingEventsCatchUp } from "@/lib/api-client"
import { applyPlanFromText } from "@/lib/plan-extraction"
import { usePlanStore } from "@/stores/plan-store"
import { useToastStore } from "@/stores/toast-store"

export type GenerationPhase = 'idle' | 'repo_setup' | 'generating' | 'interactive_planning'

/**
 * Generation session lifecycle:
 *   active → generated  (plan ready, awaiting user acknowledgment)
 *   active → error      (generation failed)
 *   generated → removed (user clicks "View plan" or auto-cleanup after 7 days)
 *   error → removed     (auto-cleanup after 5 minutes)
 */
export type GenerationStatus = 'active' | 'generated' | 'completed' | 'error'

export interface GenerationSession {
  projectId: string
  projectName: string
  phase: GenerationPhase
  status: GenerationStatus
  streamText: string
  error: string | null
  startedAt: number
  completedAt: number | null
  /** Stable persistence ID for streaming events (format: `gen-${projectId}`, no timestamp) */
  streamId?: string
  /** Last sequence number received from SSE stream — used as cursor for catch-up queries */
  lastSeq: number
  /** Whether a plan_result event was received during this session's stream */
  planReceived?: boolean
  executionId?: string        // For interactive plan sessions
  isInteractive?: boolean     // True for interactive plan sessions
  pendingApprovals?: number   // Count of unanswered approval requests
}

interface AgentState {
  sessions: Map<string, GenerationSession>
  loaded: boolean
  load: () => Promise<void>
  setGenerationPhase: (projectId: string, phase: GenerationPhase) => void
  abort: (projectId: string) => void
  dismissSession: (projectId: string) => void
  markPlanViewed: (projectId: string) => void
  startInteractiveSession: (projectId: string, projectName: string, executionId: string) => void
  updateInteractiveSession: (projectId: string, updates: Partial<Pick<GenerationSession, 'streamText' | 'status' | 'error' | 'pendingApprovals' | 'streamId' | 'lastSeq'>>) => void
  /** Attempt catch-up for a session whose stream ended without a plan_result */
  attemptCatchUp: (projectId: string) => Promise<boolean>
}

const abortControllers = new Map<string, AbortController>()

// localStorage key for persisting "generated" sessions across page refresh
const GENERATED_SESSIONS_KEY = "astro:generated-sessions"

function persistGeneratedSessions(sessions: Map<string, GenerationSession>): void {
  try {
    const generated: Record<string, GenerationSession> = {}
    for (const [projectId, session] of sessions) {
      if (session.status === "generated") {
        generated[projectId] = session
      }
    }
    if (Object.keys(generated).length > 0) {
      localStorage.setItem(GENERATED_SESSIONS_KEY, JSON.stringify(generated))
    } else {
      localStorage.removeItem(GENERATED_SESSIONS_KEY)
    }
  } catch {
    // localStorage may be unavailable
  }
}

function isValidSession(v: unknown): v is GenerationSession {
  if (!v || typeof v !== "object") return false
  const s = v as Record<string, unknown>
  return typeof s.projectId === "string" &&
    typeof s.status === "string" &&
    typeof s.startedAt === "number"
}

function restoreGeneratedSessions(): Map<string, GenerationSession> {
  const sessions = new Map<string, GenerationSession>()
  try {
    const raw = localStorage.getItem(GENERATED_SESSIONS_KEY)
    if (raw) {
      const now = Date.now()
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const [projectId, value] of Object.entries(parsed)) {
        if (!isValidSession(value)) continue
        // Only restore "generated" sessions that haven't expired (7-day TTL)
        if (value.status === "generated") {
          const age = value.completedAt ? now - value.completedAt : 0
          if (age <= GENERATED_SESSION_TTL_MS) {
            sessions.set(projectId, value)
          }
        }
      }
    }
  } catch {
    // localStorage may be unavailable or corrupted
  }
  return sessions
}

// Cleanup timer for completed sessions
let cleanupTimer: ReturnType<typeof setInterval> | null = null
const CLEANUP_INTERVAL_MS = 60_000 // 1 minute
const COMPLETED_SESSION_TTL_MS = 5 * 60_000 // 5 minutes
const GENERATED_SESSION_TTL_MS = 7 * 24 * 60 * 60_000 // 7 days
const MAX_SESSIONS = 10

function updateSession(
  sessions: Map<string, GenerationSession>,
  projectId: string,
  updates: Partial<GenerationSession>,
): Map<string, GenerationSession> {
  const next = new Map(sessions)
  const existing = next.get(projectId)
  if (existing) {
    next.set(projectId, { ...existing, ...updates })
  }
  return next
}

function cleanupOldSessions(sessions: Map<string, GenerationSession>): Map<string, GenerationSession> {
  const now = Date.now()
  const next = new Map(sessions)

  // Remove completed/error sessions older than TTL, and generated sessions older than 7 days
  for (const [projectId, session] of next.entries()) {
    if (session.status === "active") continue
    if (!session.completedAt) continue
    const age = now - session.completedAt
    const ttl = session.status === "generated" ? GENERATED_SESSION_TTL_MS : COMPLETED_SESSION_TTL_MS
    if (age > ttl) {
      console.log(`[agent-store] Cleaning up old ${session.status} session for ${projectId}`)
      next.delete(projectId)
    }
  }

  // Keep only last MAX_SESSIONS sessions (sort by startedAt, keep newest)
  if (next.size > MAX_SESSIONS) {
    const sorted = Array.from(next.entries()).sort((a, b) => b[1].startedAt - a[1].startedAt)
    const toKeep = sorted.slice(0, MAX_SESSIONS)
    next.clear()
    toKeep.forEach(([id, session]) => next.set(id, session))
    console.log(`[agent-store] Trimmed sessions from ${sessions.size} to ${MAX_SESSIONS}`)
  }

  return next
}

function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

function startCleanupTimer(get: () => AgentState, set: (fn: (s: AgentState) => Partial<AgentState>) => void): void {
  if (cleanupTimer) return

  cleanupTimer = setInterval(() => {
    const { sessions } = get()
    const cleaned = cleanupOldSessions(sessions)

    if (cleaned.size !== sessions.size) {
      set(() => ({ sessions: cleaned }))
    }
  }, CLEANUP_INTERVAL_MS)
}

/**
 * Attempt to recover a plan from the backend's streaming_events table.
 *
 * Called when a plan generation stream ends without receiving a `plan_result`
 * (due to SSE disconnect, network error, or tab backgrounding). Queries the
 * backend for events persisted after `lastSeq`, rebuilds `streamText` from
 * text events, and re-runs plan JSON extraction to recover the plan if the
 * backend already completed generation.
 *
 * @returns true if a plan was recovered and applied
 */
async function performCatchUp(
  projectId: string,
  get: () => AgentState,
  set: (fn: (s: AgentState) => Partial<AgentState>) => void,
): Promise<boolean> {
  const session = get().sessions.get(projectId)
  if (!session?.streamId) {
    console.log(`[plan-gen] No streamId for ${projectId}, skipping catch-up`)
    return false
  }

  console.log(`[plan-gen] Attempting catch-up for ${projectId} (streamId=${session.streamId}, lastSeq=${session.lastSeq})`)

  try {
    const { events, lastSeq: newLastSeq } = await fetchStreamingEventsCatchUp(
      [session.streamId],
      session.lastSeq,
    )

    // Update lastSeq regardless of whether we find a plan
    if (newLastSeq > session.lastSeq) {
      set((s) => ({
        sessions: updateSession(s.sessions, projectId, { lastSeq: newLastSeq }),
      }))
    }

    if (events.length === 0) {
      console.log(`[plan-gen] No catch-up events for ${projectId}`)
      return false
    }

    console.log(`[plan-gen] Caught up ${events.length} event(s) for ${projectId}`)

    // Check for a plan_result event directly (most reliable recovery path)
    for (const event of events) {
      if (event.eventType === 'plan_result') {
        try {
          const planData = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
          const result = applyPlanFromText(projectId, '', `catchup-${session.streamId}`, false, planData)
          if (result.applied) {
            console.log(`[plan-gen] Catch-up recovered plan from plan_result event for ${projectId}: ${result.nodeCount} nodes`)
            set((s) => ({
              sessions: updateSession(s.sessions, projectId, {
                planReceived: true,
                status: 'generated',
                error: null,
                phase: 'idle',
                completedAt: Date.now(),
              }),
            }))
            // Persist to localStorage so the session survives another refresh
            const updatedSessions = get().sessions
            persistGeneratedSessions(updatedSessions)
            useToastStore.getState().add({
              type: "success",
              title: "Plan ready",
              description: `Plan recovered — ${result.nodeCount} tasks. Review and start execution.`,
            })
            return true
          }
        } catch {
          console.warn(`[plan-gen] Failed to parse plan_result event data for ${projectId}`)
        }
      }
    }

    // Fallback: rebuild streamText from text events and try plan extraction
    let catchUpText = ''
    for (const event of events) {
      if (event.eventType === 'text') {
        // streaming-event-log persists text as { text: "..." }
        const d = event.data as Record<string, unknown> | string
        catchUpText += typeof d === 'string' ? d : ((d as Record<string, unknown>)?.text as string) || ''
      }
    }

    if (!catchUpText) {
      console.log(`[plan-gen] No text events in catch-up for ${projectId}`)
      return false
    }

    // Combine with existing streamText (events before the disconnect)
    const fullText = (session.streamText || '') + catchUpText

    // Update streamText in session
    set((s) => ({
      sessions: updateSession(s.sessions, projectId, { streamText: fullText }),
    }))

    // Try to extract plan from the full rebuilt text
    const result = applyPlanFromText(projectId, fullText, `catchup-text-${session.streamId}`)
    if (result.applied) {
      console.log(`[plan-gen] Catch-up recovered plan from text for ${projectId}: ${result.nodeCount} nodes`)
      set((s) => ({
        sessions: updateSession(s.sessions, projectId, {
          planReceived: true,
          status: 'generated',
          error: null,
          phase: 'idle',
          completedAt: Date.now(),
        }),
      }))
      // Persist to localStorage
      const updatedSessions = get().sessions
      persistGeneratedSessions(updatedSessions)
      return true
    }

    console.log(`[plan-gen] Catch-up could not extract plan from ${fullText.length} chars of text for ${projectId}`)
    return false
  } catch (error) {
    console.error(`[plan-gen] Catch-up failed for ${projectId}:`, error)
    return false
  }
}

export const useAgentStore = create<AgentState>((set, get) => ({
  sessions: new Map(),
  loaded: false,

  load: async () => {
    // Restore "generated" sessions from localStorage so they survive page refresh
    const restored = restoreGeneratedSessions()
    if (restored.size > 0) {
      set((s) => {
        const sessions = new Map(s.sessions)
        for (const [projectId, session] of restored) {
          // Don't overwrite active sessions
          if (!sessions.has(projectId)) {
            sessions.set(projectId, session)
          }
        }
        return { sessions }
      })
      console.log(`[agent-store] Restored ${restored.size} generated session(s) from localStorage`)
    }
    set({ loaded: true })

    // Start cleanup timer
    startCleanupTimer(get, set)

    // Attempt catch-up for any restored sessions that have a streamId but no plan
    // This handles the case where the backend finished while the tab was closed
    for (const [projectId, session] of get().sessions) {
      if (session.streamId && !session.planReceived && session.status !== 'active') {
        // Check if the project already has plan nodes (plan may have been applied before refresh)
        const existingNodes = usePlanStore.getState().nodes.filter(n => n.projectId === projectId)
        if (existingNodes.length === 0) {
          console.log(`[agent-store] Session ${projectId} has streamId but no plan — attempting catch-up`)
          performCatchUp(projectId, get, set).catch((err) => {
            console.error(`[agent-store] Mount-time catch-up failed for ${projectId}:`, err)
          })
        }
      }
    }
  },

  setGenerationPhase: (projectId, phase) => {
    set((s) => {
      const existing = s.sessions.get(projectId)
      let sessions: Map<string, GenerationSession>
      if (!existing) {
        // Create a placeholder session if setGenerationPhase is called before interactive planning starts
        sessions = new Map(s.sessions)
        sessions.set(projectId, {
          projectId,
          projectName: "",
          phase,
          status: "active",
          streamText: "",
          error: null,
          startedAt: Date.now(),
          completedAt: null,
          lastSeq: 0,
        })
      } else {
        sessions = updateSession(s.sessions, projectId, { phase })
      }
      return { sessions }
    })
  },

  abort: (projectId) => {
    console.log(`[plan-gen] Aborting generation for ${projectId}`)
    const controller = abortControllers.get(projectId)
    controller?.abort()
    abortControllers.delete(projectId)
    set((s) => {
      const next = new Map(s.sessions)
      next.delete(projectId)
      return { sessions: next }
    })
  },

  dismissSession: (projectId) => {
    set((s) => {
      const sessions = new Map(s.sessions)
      sessions.delete(projectId)
      persistGeneratedSessions(sessions)
      return { sessions }
    })
  },

  markPlanViewed: (projectId) => {
    // Only dismiss if the session is in "generated" state
    const session = get().sessions.get(projectId)
    if (session?.status === "generated") {
      get().dismissSession(projectId)
    }
  },

  startInteractiveSession: (projectId, projectName, executionId) => {
    set((s) => {
      const sessions = new Map(s.sessions)
      sessions.set(projectId, {
        projectId,
        projectName,
        phase: "interactive_planning",
        status: "active",
        streamText: "",
        error: null,
        startedAt: Date.now(),
        completedAt: null,
        lastSeq: 0,
        executionId,
        isInteractive: true,
        pendingApprovals: 0,
        streamId: `plan-chat-${projectId}-${Date.now()}`,
      })
      return { sessions }
    })

    // Start cleanup timer
    startCleanupTimer(get, set)
  },

  updateInteractiveSession: (projectId, updates) => {
    set((s) => {
      const existing = s.sessions.get(projectId)
      if (!existing || !existing.isInteractive) return s
      const sessions = new Map(s.sessions)
      sessions.set(projectId, {
        ...existing,
        ...updates,
        completedAt: updates.status && updates.status !== "active" ? Date.now() : existing.completedAt,
      })
      return { sessions }
    })
  },

  attemptCatchUp: async (projectId) => {
    return performCatchUp(projectId, get, set)
  },
}))

// Start/stop cleanup timer based on loaded state
if (typeof window !== "undefined") {
  useAgentStore.subscribe((state) => {
    if (state.loaded) {
      startCleanupTimer(useAgentStore.getState, useAgentStore.setState)
    } else {
      stopCleanupTimer()
    }
  })
}
