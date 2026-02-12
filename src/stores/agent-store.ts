import { create } from "zustand"
import { generatePlan } from "@/lib/api-client"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
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
  startGeneration: (projectId: string, projectName: string, description: string, visionDoc?: string, repoContext?: RepoContext) => Promise<void>
  setGenerationPhase: (projectId: string, phase: GenerationPhase) => void
  abort: (projectId: string) => void
  dismissSession: (projectId: string) => void
}

const abortControllers = new Map<string, AbortController>()

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

export const useAgentStore = create<AgentState>((set, get) => ({
  sessions: new Map(),

  setGenerationPhase: (projectId, phase) => {
    set((s) => {
      const existing = s.sessions.get(projectId)
      if (!existing) {
        // Create a placeholder session if setGenerationPhase is called before startGeneration
        const next = new Map(s.sessions)
        next.set(projectId, {
          projectId,
          projectName: "",
          phase,
          status: "active",
          streamText: "",
          error: null,
          startedAt: Date.now(),
          completedAt: null,
        })
        return { sessions: next }
      }
      return { sessions: updateSession(s.sessions, projectId, { phase }) }
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
      const next = new Map(s.sessions)
      next.set(projectId, {
        projectId,
        projectName,
        phase: "generating",
        status: "active",
        streamText: "",
        error: null,
        startedAt: Date.now(),
        completedAt: null,
      })
      return { sessions: next }
    })

    const model = useSettingsStore.getState().model

    try {
      await generatePlan(
        {
          description,
          visionDoc,
          projectId,
          model,
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
              return { sessions: updateSession(s.sessions, projectId, { streamText: session.streamText + text }) }
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

            usePlanStore.getState().setProjectPlan(projectId, nodes, edges)
            // Auto-layout the generated graph
            usePlanStore.getState().reorganizeProject(projectId)

            if (result.projectName) {
              useProjectStore.getState().updateProject(projectId, { name: result.projectName })
            }
          },
          onError: (error) => {
            console.error(`[plan-gen] Error for ${projectId}:`, error)
            set((s) => ({
              sessions: updateSession(s.sessions, projectId, { error, status: "error", completedAt: Date.now() }),
            }))
          },
          onDone: () => {
            console.log(`[plan-gen] Generation completed for ${projectId}`)
            set((s) => {
              const session = s.sessions.get(projectId)
              // Only mark completed if not already in error state
              if (session?.status === "error") return s
              return {
                sessions: updateSession(s.sessions, projectId, {
                  status: "completed",
                  phase: "idle",
                  completedAt: Date.now(),
                }),
              }
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
        set((s) => ({
          sessions: updateSession(s.sessions, projectId, { error: msg, status: "error", completedAt: Date.now() }),
        }))
      }
    } finally {
      abortControllers.delete(projectId)
      // Ensure session is finalized if still active
      set((s) => {
        const session = s.sessions.get(projectId)
        if (session?.status === "active") {
          return {
            sessions: updateSession(s.sessions, projectId, {
              status: "completed",
              phase: "idle",
              completedAt: Date.now(),
            }),
          }
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
      const next = new Map(s.sessions)
      next.delete(projectId)
      return { sessions: next }
    })
  },
}))
