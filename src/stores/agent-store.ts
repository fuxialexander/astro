import { create } from "zustand"
import { generatePlan } from "@/lib/api-client"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { PlanNode, PlanEdge } from "@/types"

export type GenerationPhase = 'idle' | 'repo_setup' | 'generating'

interface RepoContext {
  workingDirectory: string
  fileTree?: string[]
}

interface AgentState {
  isGenerating: boolean
  generationPhase: GenerationPhase
  streamText: string
  error: string | null
  setGenerationPhase: (phase: GenerationPhase) => void
  startGeneration: (projectId: string, description: string, visionDoc?: string, repoContext?: RepoContext) => Promise<void>
  abort: () => void
  clearState: () => void
}

let currentAbortController: AbortController | null = null

export const useAgentStore = create<AgentState>((set, get) => ({
  isGenerating: false,
  generationPhase: 'idle',
  streamText: "",
  error: null,

  setGenerationPhase: (phase) => {
    set({ generationPhase: phase })
  },

  startGeneration: async (projectId, description, visionDoc, repoContext) => {
    if (get().isGenerating) return

    currentAbortController = new AbortController()
    set({ isGenerating: true, generationPhase: 'generating', streamText: "", error: null })

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
        },
        {
          onText: (text) => {
            set((s) => ({ streamText: s.streamText + text }))
          },
          onPlanResult: (result) => {
            const now = new Date()
            const nodes: PlanNode[] = result.nodes.map((n) => ({
              id: n.id,
              projectId,
              type: n.type,
              title: n.title,
              description: n.description,
              status: n.status,
              parentId: n.parentId,
              dependencies: n.dependencies,
              environment: n.environment || "local",
              verification: n.verification,
              position: n.position,
              startDate: n.startDate,
              endDate: n.endDate,
              priority: n.priority as PlanNode["priority"],
              estimate: n.estimate as PlanNode["estimate"],
              dueDate: n.dueDate,
              milestoneId: n.milestoneId,
              createdAt: now,
              updatedAt: now,
            }))

            const edges: PlanEdge[] = result.edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              type: e.type,
            }))

            usePlanStore.getState().setProjectPlan(projectId, nodes, edges)

            // Update the project name if Claude suggested one
            if (result.projectName) {
              useProjectStore.getState().updateProject(projectId, { name: result.projectName })
            }
          },
          onError: (error) => {
            set({ error })
          },
          onDone: () => {
            set({ isGenerating: false })
          },
        },
        currentAbortController.signal,
      )
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        // User cancelled — not an error
      } else {
        const msg = e instanceof Error ? e.message : "unknown error"
        set({ error: msg })
      }
    } finally {
      // Always ensure generating state is cleared
      set({ isGenerating: false, generationPhase: 'idle' })
    }
  },

  abort: () => {
    currentAbortController?.abort()
    currentAbortController = null
    set({ isGenerating: false, generationPhase: 'idle' })
  },

  clearState: () => {
    set({ isGenerating: false, generationPhase: 'idle', streamText: "", error: null })
  },
}))
