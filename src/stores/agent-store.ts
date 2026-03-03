import { create } from "zustand"
import { escapeHtml } from "@/lib/html-utils"
import { generatePlan, fetchStreamingEventsCatchUp } from "@/lib/api-client"
import { applyPlanFromText } from "@/lib/plan-extraction"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { PlanNode, PlanEdge, Project } from "@/types"

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
  /** Per-turn stable ID used as persistId for chat SSE event storage */
  streamId?: string
  /** Last seen sequence number for targeted catch-up queries (initially 0) */
  lastSeq?: number
}

interface RepoKeyFiles {
  claudeMd?: string
  readmeMd?: string
  packageInfo?: string
}

interface GitState {
  currentBranch: string
  targetBranch: string
  isDirty: boolean
  dirtyDetails?: { staged: number; unstaged: number; untracked: number }
}

interface RepoContext {
  workingDirectory: string
  fileTree?: string[]
  keyFiles?: RepoKeyFiles
  targetMachineId?: string
  gitState?: GitState
}

interface AgentState {
  sessions: Map<string, GenerationSession>
  loaded: boolean
  load: () => Promise<void>
  startGeneration: (projectId: string, projectName: string, description: string, visionDoc?: string, repoContext?: RepoContext) => Promise<void>
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
          // Serialize the plan data to text so applyPlanFromText can extract it
          const planText = JSON.stringify(planData)
          const result = applyPlanFromText(projectId, planText, `catchup-${session.streamId}`)
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
        catchUpText += typeof event.data === 'string' ? event.data : String(event.data)
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
        // Create a placeholder session if setGenerationPhase is called before startGeneration
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

  startGeneration: async (projectId, projectName, description, visionDoc, repoContext) => {
    // Guard: only skip if already in the 'generating' phase (not 'repo_setup' placeholder)
    const existing = get().sessions.get(projectId)
    if (existing?.status === "active" && existing.phase === "generating") {
      console.log(`[plan-gen] Already generating for project ${projectId}, skipping`)
      return
    }

    console.log(`[plan-gen] Starting generation for project "${projectName}" (${projectId})`)

    const controller = new AbortController()
    abortControllers.set(projectId, controller)

    // Compute stable streamId for event persistence (no timestamp — survives reconnect)
    const streamId = `gen-${projectId}`

    // Track whether onDone was received (to detect stream abort)
    let doneReceived = false

    // Initialize or update the session
    set((s) => {
      const sessions = new Map(s.sessions)
      sessions.set(projectId, {
        projectId,
        projectName,
        phase: "generating",
        status: "active",
        streamText: "",
        error: null,
        startedAt: Date.now(),
        completedAt: null,
        streamId,
        lastSeq: 0,
        planReceived: false,
      })
      return { sessions }
    })

    const { defaultProvider, getModelForProvider } = useSettingsStore.getState()
    const effectiveModel = getModelForProvider(defaultProvider || undefined)

    try {
      await generatePlan(
        {
          description,
          visionDoc,
          projectId,
          streamId,
          model: effectiveModel,
          providerId: defaultProvider || undefined,
          workingDirectory: repoContext?.workingDirectory,
          fileTree: repoContext?.fileTree,
          keyFiles: repoContext?.keyFiles,
          targetMachineId: repoContext?.targetMachineId,
          gitState: repoContext?.gitState,
        },
        {
          onText: (text) => {
            set((s) => {
              const session = s.sessions.get(projectId)
              if (!session) return s
              if (!session.streamText) {
                console.log(`[plan-gen] First stream chunk received for ${projectId}`)
              }
              const sessions = updateSession(s.sessions, projectId, { streamText: session.streamText + text })
              return { sessions }
            })
          },
          onId: (id) => {
            // Track last sequence number for catch-up cursor
            const seq = parseInt(id, 10)
            if (!isNaN(seq)) {
              set((s) => {
                const session = s.sessions.get(projectId)
                if (!session || seq <= session.lastSeq) return s
                const sessions = updateSession(s.sessions, projectId, { lastSeq: seq })
                return { sessions }
              })
            }
          },
          onPlanResult: (result) => {
            console.log(`[plan-gen] Plan result received for ${projectId}: ${result.nodes.length} nodes, ${result.edges.length} edges`)

            // Mark plan as received before processing
            set((s) => ({
              sessions: updateSession(s.sessions, projectId, { planReceived: true }),
            }))

            // Map AI-generated short IDs (n1, n2, etc.) to proper UUIDs for consistency
            // with manually created tasks which use crypto.randomUUID()
            const idMap = new Map<string, string>()
            const resolveId = (aiId: string): string => {
              let uuid = idMap.get(aiId)
              if (!uuid) {
                uuid = crypto.randomUUID()
                idMap.set(aiId, uuid)
              }
              return uuid
            }

            const now = new Date()
            const nodes: PlanNode[] = result.nodes.map((n) => ({
              id: resolveId(n.id),
              projectId,
              type: n.type,
              title: n.title,
              description: n.description,
              content: n.description ? `<p>${escapeHtml(n.description)}</p>` : '',
              status: n.status,
              parentId: n.parentId ? resolveId(n.parentId) : null,
              dependencies: n.dependencies.map(resolveId),
              verification: n.verification,
              position: n.position,
              startDate: n.startDate,
              endDate: n.endDate,
              priority: n.priority as PlanNode["priority"],
              estimate: n.estimate as PlanNode["estimate"],
              dueDate: n.dueDate,
              labelIds: n.labelIds,
              milestoneId: n.milestoneId ? resolveId(n.milestoneId) : n.milestoneId,
              createdAt: now,
              updatedAt: now,
            }))

            const edges: PlanEdge[] = result.edges.map((e) => ({
              id: crypto.randomUUID(),
              source: resolveId(e.source),
              target: resolveId(e.target),
              type: e.type,
            }))

            // Post-process: auto-infer milestoneId for tasks missing it.
            // Walk backwards from each milestone through the dependency graph
            // to assign tasks that contribute toward it.
            const milestoneIds = new Set(nodes.filter((n) => n.type === "milestone").map((n) => n.id))
            const tasksWithoutMilestone = nodes.filter((n) => n.type !== "milestone" && !n.milestoneId)

            if (milestoneIds.size > 0 && tasksWithoutMilestone.length > 0) {
              // Build reverse adjacency: for each node, which nodes does it feed into (downstream)
              const downstreamOf = new Map<string, Set<string>>()
              for (const edge of edges) {
                let targets = downstreamOf.get(edge.source)
                if (!targets) { targets = new Set(); downstreamOf.set(edge.source, targets) }
                targets.add(edge.target)
              }
              // Also use dependencies as reverse edges (dependency X means edge X → this node)
              const upstreamOf = new Map<string, Set<string>>()
              for (const node of nodes) {
                for (const dep of node.dependencies) {
                  let sources = upstreamOf.get(node.id)
                  if (!sources) { sources = new Set(); upstreamOf.set(node.id, sources) }
                  sources.add(dep)
                }
              }

              // For each milestone, BFS backwards through dependencies to find contributing tasks
              for (const milestone of nodes.filter((n) => n.type === "milestone")) {
                const visited = new Set<string>()
                const queue = [...milestone.dependencies]
                while (queue.length > 0) {
                  const current = queue.shift()!
                  if (visited.has(current)) continue
                  visited.add(current)

                  const node = nodes.find((n) => n.id === current)
                  if (!node || node.type === "milestone") continue

                  // Assign milestoneId if not already set
                  if (!node.milestoneId) {
                    node.milestoneId = milestone.id
                  }

                  // Continue tracing upstream through this node's dependencies
                  for (const dep of node.dependencies) {
                    if (!visited.has(dep)) queue.push(dep)
                  }
                }
              }

              const assigned = tasksWithoutMilestone.filter((n) => n.milestoneId).length
              if (assigned > 0) {
                console.log(`[plan-gen] Auto-assigned milestoneId for ${assigned} task(s) from dependency graph`)
              }
            }

            console.log(`[plan-gen] Calling setProjectPlan for ${projectId} with ${nodes.length} nodes, ${edges.length} edges`)
            usePlanStore.getState().setProjectPlan(projectId, nodes, edges)
            // Auto-layout the generated graph
            usePlanStore.getState().reorganizeProject(projectId)
            console.log(`[plan-gen] Plan stored and layout applied for ${projectId}`)

            // Update project name and auto-assign machine if not set
            const projectUpdates: Partial<Project> = {}
            if (result.projectName) projectUpdates.name = result.projectName
            if (repoContext?.targetMachineId) {
              const currentProject = useProjectStore.getState().projects.find((p) => p.id === projectId)
              if (!currentProject?.defaultMachineId) {
                projectUpdates.defaultMachineId = repoContext.targetMachineId
              }
            }
            if (Object.keys(projectUpdates).length > 0) {
              useProjectStore.getState().updateProject(projectId, projectUpdates)
            }
          },
          onError: (error) => {
            console.error(`[plan-gen] Error for ${projectId}:`, error)
            set((s) => {
              const sessions = updateSession(s.sessions, projectId, { error, status: "error", completedAt: Date.now() })
              return { sessions }
            })
          },
          onDone: () => {
            doneReceived = true
            console.log(`[plan-gen] Generation completed for ${projectId}`)
            set((s) => {
              const session = s.sessions.get(projectId)
              // Only mark generated if not already in error state
              if (session?.status === "error") return s
              const sessions = updateSession(s.sessions, projectId, {
                status: "generated",
                phase: "idle",
                completedAt: Date.now(),
              })
              // Persist "generated" sessions to localStorage for page refresh survival
              persistGeneratedSessions(sessions)
              return { sessions }
            })
          },
        },
        controller.signal,
      )
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        console.log(`[plan-gen] Generation aborted for ${projectId}`)
        // User explicitly aborted — don't attempt catch-up
        return
      } else {
        const msg = e instanceof Error ? e.message : "unknown error"
        console.error(`[plan-gen] Generation failed for ${projectId}:`, msg)
        set((s) => {
          const sessions = updateSession(s.sessions, projectId, { error: msg, status: "error", completedAt: Date.now() })
          return { sessions }
        })
      }
    } finally {
      abortControllers.delete(projectId)

      // Attempt catch-up if the stream ended without receiving a plan_result.
      // This covers: onError (status=error), stream abort (stream ended without done event),
      // and network errors (caught in the catch block above).
      const sessionAfterStream = get().sessions.get(projectId)
      if (sessionAfterStream && !sessionAfterStream.planReceived && sessionAfterStream.streamId) {
        const streamAborted = !doneReceived && sessionAfterStream.status !== 'error'
        if (sessionAfterStream.status === 'error' || streamAborted) {
          console.log(`[plan-gen] Stream ended without plan_result for ${projectId} (status=${sessionAfterStream.status}, doneReceived=${doneReceived}) — attempting catch-up`)
          try {
            const recovered = await performCatchUp(projectId, get, set)
            if (recovered) {
              console.log(`[plan-gen] Catch-up successfully recovered plan for ${projectId}`)
            } else {
              console.log(`[plan-gen] Catch-up did not recover plan for ${projectId}`)
            }
          } catch (catchUpErr) {
            console.error(`[plan-gen] Catch-up error for ${projectId}:`, catchUpErr)
          }
        }
      }

      // Ensure session is finalized if still active (stream ended without done/error/catch-up)
      set((s) => {
        const session = s.sessions.get(projectId)
        if (session?.status === "active") {
          const finalStatus = session.planReceived ? "generated" : "error"
          const sessions = updateSession(s.sessions, projectId, {
            status: finalStatus,
            error: session.planReceived ? null : (session.error || "Stream ended without receiving plan result"),
            phase: "idle",
            completedAt: Date.now(),
          })
          // Persist "generated" sessions to localStorage for page refresh survival
          persistGeneratedSessions(sessions)
          return { sessions }
        }
        return s
      })
    }
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
        lastSeq: 0,
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
