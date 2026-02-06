import { create } from "zustand"
import { generatePlan } from "@/lib/api-client"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { PlanNode, PlanEdge } from "@/types"

interface AgentState {
  isGenerating: boolean
  streamText: string
  error: string | null
  startGeneration: (projectId: string, description: string, visionDoc?: string) => Promise<void>
  abort: () => void
  clearState: () => void
}

let currentAbortController: AbortController | null = null

export const useAgentStore = create<AgentState>((set, get) => ({
  isGenerating: false,
  streamText: "",
  error: null,

  startGeneration: async (projectId, description, visionDoc) => {
    if (get().isGenerating) return

    currentAbortController = new AbortController()
    set({ isGenerating: true, streamText: "", error: null })

    const model = useSettingsStore.getState().model

    try {
      await generatePlan(
        { description, visionDoc, projectId, model },
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
      set({ isGenerating: false })
    }
  },

  abort: () => {
    currentAbortController?.abort()
    currentAbortController = null
    set({ isGenerating: false })
  },

  clearState: () => {
    set({ isGenerating: false, streamText: "", error: null })
  },
}))
