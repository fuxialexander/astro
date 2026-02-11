import { create } from "zustand"
import type { Project } from "@/types"
import { loadState, saveState } from "@/lib/db"
import { dataClient } from "@/lib/data-client"

interface ProjectState {
  projects: Project[]
  loaded: boolean
  load: () => Promise<void>
  addProject: (project: Project) => void
  updateProject: (id: string, updates: Partial<Project>) => void
  updateFileTree: (id: string, files: string[]) => void
  deleteProject: (id: string) => void
}

// Empty seed — new users start with no projects and create their first via /projects/new
const SEED_PROJECTS: Project[] = []

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loaded: false,

  load: async () => {
    try {
      const projects = await dataClient.listProjects()
      set({ projects, loaded: true })
      // Update IndexedDB cache for offline fallback
      saveState("nexus-projects", projects)
    } catch {
      // API unavailable — fall back to IndexedDB cache
      const saved = await loadState<Project[]>("nexus-projects")
      if (saved) {
        set({ projects: saved.map(p => ({ ...p, createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) })), loaded: true })
      } else {
        set({ projects: SEED_PROJECTS, loaded: true })
      }
    }
  },

  addProject: (project) => {
    const next = [...get().projects, project]
    set({ projects: next })
    saveState("nexus-projects", next)
    dataClient.createProject(project).catch(() => {})
  },

  updateProject: (id, updates) => {
    const next = get().projects.map((p) =>
      p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
    )
    set({ projects: next })
    saveState("nexus-projects", next)
    dataClient.updateProject(id, updates).catch(() => {})
  },

  updateFileTree: (id, files) => {
    const next = get().projects.map((p) =>
      p.id === id ? { ...p, fileTree: files, fileTreeUpdatedAt: new Date().toISOString(), updatedAt: new Date() } : p
    )
    set({ projects: next })
    saveState("nexus-projects", next)
    // fileTree stays in IndexedDB only — too large for API
  },

  deleteProject: (id) => {
    const next = get().projects.filter((p) => p.id !== id)
    set({ projects: next })
    saveState("nexus-projects", next)
    dataClient.deleteProject(id).catch(() => {})
  },
}))
