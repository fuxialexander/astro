import { create } from "zustand"
import type { Project } from "@/types"
import { dataClient } from "@/lib/data-client"
import { usePlanStore } from "@/stores/plan-store"

interface ProjectState {
  projects: Project[]
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
  addProject: (project: Project) => void
  updateProject: (id: string, updates: Partial<Project>) => void
  updateFileTree: (id: string, files: string[], machineId?: string) => void
  deleteProject: (id: string) => void
}

// Empty seed — new users start with no projects and create their first via /projects/new
const SEED_PROJECTS: Project[] = []

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const projects = await dataClient.listProjects()
      set({ projects, loaded: true, loading: false })
    } catch (err) {
      set({ projects: SEED_PROJECTS, loaded: true, loading: false, error: err instanceof Error ? err.message : 'Failed to load projects' })
    }
  },

  addProject: (project) => {
    // Auto-assign display number if not set
    if (project.number == null) {
      const existing = get().projects
      const maxNumber = existing.reduce((max, p) => Math.max(max, p.number ?? 0), 0)
      project = { ...project, number: maxNumber + 1 }
    }
    const next = [...get().projects, project]
    set({ projects: next })
    dataClient.createProject(project).catch(() => {})
  },

  updateProject: (id, updates) => {
    const next = get().projects.map((p) =>
      p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
    )
    set({ projects: next })
    dataClient.updateProject(id, updates).catch(() => {})
  },

  updateFileTree: (id, files, machineId) => {
    const next = get().projects.map((p) =>
      p.id === id ? { ...p, fileTree: files, fileTreeUpdatedAt: new Date().toISOString(), fileTreeMachineId: machineId || 'local', updatedAt: new Date() } : p
    )
    set({ projects: next })
  },

  deleteProject: (id) => {
    const next = get().projects.filter((p) => p.id !== id)
    set({ projects: next })
    dataClient.deleteProject(id).catch(() => {})
    // Clean up all plan nodes and edges for this project
    usePlanStore.getState().removeProjectPlan(id)
  },
}))
