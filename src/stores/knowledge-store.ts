import { create } from "zustand"
import { dataClient } from "@/lib/data-client"

export type KnowledgeEntry = {
  id: string
  projectId: string
  key: string
  value: string
  sourceNodeId?: string
  sourceTaskTitle?: string
  milestoneId?: string
  createdAt: Date
  updatedAt: Date
}

type KnowledgeStore = {
  /** Entries keyed by projectId */
  entriesByProject: Record<string, KnowledgeEntry[]>
  loading: Record<string, boolean>
  error: Record<string, string | null>
  loadKnowledge: (projectId: string) => Promise<void>
  deleteKnowledge: (projectId: string, id: string) => Promise<void>
  getProjectKnowledge: (projectId: string) => KnowledgeEntry[]
}

export const useKnowledgeStore = create<KnowledgeStore>((set, get) => ({
  entriesByProject: {},
  loading: {},
  error: {},

  loadKnowledge: async (projectId: string) => {
    if (get().loading[projectId]) return
    set((s) => ({
      loading: { ...s.loading, [projectId]: true },
      error: { ...s.error, [projectId]: null },
    }))
    try {
      const entries = await dataClient.listKnowledge(projectId)
      set((s) => ({
        entriesByProject: { ...s.entriesByProject, [projectId]: entries },
        loading: { ...s.loading, [projectId]: false },
      }))
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [projectId]: false },
        error: { ...s.error, [projectId]: err instanceof Error ? err.message : "Failed to load knowledge" },
      }))
    }
  },

  deleteKnowledge: async (projectId: string, id: string) => {
    // Optimistic delete
    set((s) => ({
      entriesByProject: {
        ...s.entriesByProject,
        [projectId]: (s.entriesByProject[projectId] ?? []).filter((e) => e.id !== id),
      },
    }))
    try {
      await dataClient.deleteKnowledge(id)
    } catch (err) {
      // Reload on failure to restore state
      console.error("[knowledge-store] Failed to delete:", err)
      get().loadKnowledge(projectId)
    }
  },

  getProjectKnowledge: (projectId: string) => {
    return get().entriesByProject[projectId] ?? []
  },
}))
