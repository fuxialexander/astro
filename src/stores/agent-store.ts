import { create } from "zustand"
import { generatePlan } from "@/lib/api-client"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import { loadState, saveState } from "@/lib/db"
import type { PlanNode, PlanEdge } from "@/types"

export type GenerationPhase = 'idle' | 'repo_setup' | 'generating'
export type GenerationStatus = 'active' | 'completed' | 'error'

export interface GenerationSession {
  projectId: string
  projectName: string
  phase: GenerationPhase
  status: GenerationStatus
  streamText: string
  error: string | null
  startedAt: number
  completedAt: number | null
}

interface SerializedSession {
  projectId: string
  projectName: string
  phase: GenerationPhase
  status: GenerationStatus
  streamText: string
  error: string | null
  startedAt: string
  completedAt: string | null
}

interface RepoKeyFiles {
  claudeMd?: string
  readmeMd?: string
  packageInfo?: string
}

interface RepoContext {
  workingDirectory: string
  fileTree?: string[]
  keyFiles?: RepoKeyFiles
  targetMachineId?: string
}

interface AgentState {
  sessions: Map<string, GenerationSession>
  loaded: boolean
  load: () => Promise<void>
  startGeneration: (projectId: string, projectName: string, description: string, visionDoc?: string, repoContext?: RepoContext) => Promise<void>
  setGenerationPhase: (projectId: string, phase: GenerationPhase) => void
  abort: (projectId: string) => void
  dismissSession: (projectId: string) => void
}

const abortControllers = new Map<string, AbortController>()

// Debounce timer for persistence
let persistTimer: ReturnType<typeof setTimeout> | null = null
const PERSIST_DEBOUNCE_MS = 500

// Cleanup timer for completed sessions
let cleanupTimer: ReturnType<typeof setInterval> | null = null
const CLEANUP_INTERVAL_MS = 60_000 // 1 minute
const COMPLETED_SESSION_TTL_MS = 5 * 60_000 // 5 minutes
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

async function persistSessions(sessions: Map<string, GenerationSession>): Promise<void> {
  const serialized: SerializedSession[] = Array.from(sessions.values()).map((session) => ({
    ...session,
    startedAt: new Date(session.startedAt).toISOString(),
    completedAt: session.completedAt ? new Date(session.completedAt).toISOString() : null,
  }))
  await saveState("nexus-agent-sessions", serialized)
}

function debouncedPersist(sessions: Map<string, GenerationSession>): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistSessions(sessions).catch((err) => {
      console.error("[agent-store] Failed to persist sessions:", err)
    })
  }, PERSIST_DEBOUNCE_MS)
}

function cleanupOldSessions(sessions: Map<string, GenerationSession>): Map<string, GenerationSession> {
  const now = Date.now()
  const next = new Map(sessions)

  // Remove completed/error sessions older than TTL
  for (const [projectId, session] of next.entries()) {
    if (session.status !== "active" && session.completedAt) {
      const age = now - session.completedAt
      if (age > COMPLETED_SESSION_TTL_MS) {
        console.log(`[agent-store] Cleaning up old session for ${projectId}`)
        next.delete(projectId)
      }
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

function startCleanupTimer(get: () => AgentState, set: (fn: (s: AgentState) => Partial<AgentState>) => void): void {
  if (cleanupTimer) return

  cleanupTimer = setInterval(() => {
    const { sessions } = get()
    const cleaned = cleanupOldSessions(sessions)

    if (cleaned.size !== sessions.size) {
      set(() => ({ sessions: cleaned }))
      persistSessions(cleaned).catch((err) => {
        console.error("[agent-store] Failed to persist after cleanup:", err)
      })
    }
  }, CLEANUP_INTERVAL_MS)
}

export const useAgentStore = create<AgentState>((set, get) => ({
  sessions: new Map(),
  loaded: false,

  load: async () => {
    try {
      const stored = await loadState<SerializedSession[]>("nexus-agent-sessions")
      if (!stored || !Array.isArray(stored)) {
        console.log("[agent-store] No sessions to restore")
        set({ loaded: true })
        return
      }

      // Deserialize sessions
      const sessions = new Map<string, GenerationSession>()
      for (const session of stored) {
        // Only restore active sessions for crash recovery
        if (session.status === "active") {
          sessions.set(session.projectId, {
            ...session,
            startedAt: new Date(session.startedAt).getTime(),
            completedAt: session.completedAt ? new Date(session.completedAt).getTime() : null,
          })
        }
      }

      if (sessions.size > 0) {
        console.log(`[agent-store] Restored ${sessions.size} active session(s) from crash recovery`)
      }

      set({ sessions, loaded: true })

      // Start cleanup timer
      startCleanupTimer(get, set)
    } catch (err) {
      console.error("[agent-store] Failed to load sessions:", err)
      set({ loaded: true })
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
        })
      } else {
        sessions = updateSession(s.sessions, projectId, { phase })
      }
      debouncedPersist(sessions)
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
      })
      // Persist immediately when starting generation
      persistSessions(sessions).catch((err) => {
        console.error("[agent-store] Failed to persist on start:", err)
      })
      return { sessions }
    })

    const { model, defaultProvider } = useSettingsStore.getState()

    // Only send the model if no explicit provider is set, or the provider is claude-code.
    // Other providers (e.g. Codex) have their own default models and would fail
    // if given a Claude model name.
    const isClaudeProvider = !defaultProvider || defaultProvider === 'claude-code'
    const effectiveModel = isClaudeProvider ? model : undefined

    try {
      await generatePlan(
        {
          description,
          visionDoc,
          projectId,
          model: effectiveModel,
          providerId: defaultProvider || undefined,
          workingDirectory: repoContext?.workingDirectory,
          fileTree: repoContext?.fileTree,
          keyFiles: repoContext?.keyFiles,
          targetMachineId: repoContext?.targetMachineId,
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
              // Debounced persist for frequent text updates
              debouncedPersist(sessions)
              return { sessions }
            })
          },
          onPlanResult: (result) => {
            console.log(`[plan-gen] Plan result received for ${projectId}: ${result.nodes.length} nodes, ${result.edges.length} edges`)

            // Prefix AI-generated IDs with project ID to ensure global uniqueness
            const prefix = projectId.slice(0, 8)
            const prefixId = (id: string) => id.startsWith(prefix) ? id : `${prefix}-${id}`

            const now = new Date()
            const nodes: PlanNode[] = result.nodes.map((n) => ({
              id: prefixId(n.id),
              projectId,
              type: n.type,
              title: n.title,
              description: n.description,
              status: n.status,
              parentId: n.parentId ? prefixId(n.parentId) : n.parentId,
              dependencies: n.dependencies.map(prefixId),
              environment: n.environment || "local",
              verification: n.verification,
              position: n.position,
              startDate: n.startDate,
              endDate: n.endDate,
              priority: n.priority as PlanNode["priority"],
              estimate: n.estimate as PlanNode["estimate"],
              dueDate: n.dueDate,
              milestoneId: n.milestoneId ? prefixId(n.milestoneId) : n.milestoneId,
              createdAt: now,
              updatedAt: now,
            }))

            const edges: PlanEdge[] = result.edges.map((e) => ({
              id: prefixId(e.id),
              source: prefixId(e.source),
              target: prefixId(e.target),
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

            usePlanStore.getState().setProjectPlan(projectId, nodes, edges)
            // Auto-layout the generated graph
            usePlanStore.getState().reorganizeProject(projectId)

            if (result.projectName) {
              useProjectStore.getState().updateProject(projectId, { name: result.projectName })
            }
          },
          onError: (error) => {
            console.error(`[plan-gen] Error for ${projectId}:`, error)
            set((s) => {
              const sessions = updateSession(s.sessions, projectId, { error, status: "error", completedAt: Date.now() })
              // Persist immediately on error
              persistSessions(sessions).catch((err) => {
                console.error("[agent-store] Failed to persist on error:", err)
              })
              return { sessions }
            })
          },
          onDone: () => {
            console.log(`[plan-gen] Generation completed for ${projectId}`)
            set((s) => {
              const session = s.sessions.get(projectId)
              // Only mark completed if not already in error state
              if (session?.status === "error") return s
              const sessions = updateSession(s.sessions, projectId, {
                status: "completed",
                phase: "idle",
                completedAt: Date.now(),
              })
              // Persist immediately on completion
              persistSessions(sessions).catch((err) => {
                console.error("[agent-store] Failed to persist on completion:", err)
              })
              return { sessions }
            })
          },
        },
        controller.signal,
      )
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        console.log(`[plan-gen] Generation aborted for ${projectId}`)
      } else {
        const msg = e instanceof Error ? e.message : "unknown error"
        console.error(`[plan-gen] Generation failed for ${projectId}:`, msg)
        set((s) => {
          const sessions = updateSession(s.sessions, projectId, { error: msg, status: "error", completedAt: Date.now() })
          // Persist immediately on error
          persistSessions(sessions).catch((err) => {
            console.error("[agent-store] Failed to persist on error:", err)
          })
          return { sessions }
        })
      }
    } finally {
      abortControllers.delete(projectId)
      // Ensure session is finalized if still active
      set((s) => {
        const session = s.sessions.get(projectId)
        if (session?.status === "active") {
          const sessions = updateSession(s.sessions, projectId, {
            status: "completed",
            phase: "idle",
            completedAt: Date.now(),
          })
          // Persist immediately on finalization
          persistSessions(sessions).catch((err) => {
            console.error("[agent-store] Failed to persist on finalization:", err)
          })
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
      // Persist immediately after dismissal
      persistSessions(sessions).catch((err) => {
        console.error("[agent-store] Failed to persist after dismissal:", err)
      })
      return { sessions }
    })
  },
}))

// Start cleanup timer when store is created
if (typeof window !== "undefined") {
  // Only run in browser environment
  useAgentStore.subscribe((state) => {
    if (state.loaded) {
      startCleanupTimer(useAgentStore.getState, useAgentStore.setState)
    }
  })
}
