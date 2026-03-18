import { create } from "zustand"
import type { Project } from "@/types"
import { dataClient } from "@/lib/data-client"
import { usePlanStore } from "@/stores/plan-store"
import { useToastStore } from "@/stores/toast-store"

interface ProjectState {
  projects: Project[]
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
  /** Load projects from ALL user's teams (for cross-team views). */
  loadAllTeams: () => Promise<void>
  addProject: (project: Project) => Promise<void>
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

  loadAllTeams: async () => {
    set({ loading: true, error: null })
    try {
      const fetched = await dataClient.listProjects({ allTeams: true })
      // Merge with current store: prefer local version when it's newer (pending optimistic update).
      const currentMap = new Map(get().projects.map((p) => [p.id, p]))
      const merged = fetched.map((p) => {
        const local = currentMap.get(p.id)
        if (local && local.updatedAt > p.updatedAt) return local
        return p
      })
      // Preserve any locally-created projects not yet returned by the server.
      for (const p of get().projects) {
        if (!fetched.find((f) => f.id === p.id)) merged.push(p)
      }
      set({ projects: merged, loaded: true, loading: false })
    } catch (err) {
      set({ projects: SEED_PROJECTS, loaded: true, loading: false, error: err instanceof Error ? err.message : 'Failed to load projects' })
    }
  },

  addProject: async (project) => {
    // Number is assigned server-side — add optimistically without number
    const now = new Date()
    const withDefaults = {
      ...project,
      status: project.status ?? 'active' as const,
      createdAt: project.createdAt ?? now,
      updatedAt: project.updatedAt ?? now,
    }
    const next = [...get().projects, withDefaults]
    set({ projects: next })
    try {
      const created = await dataClient.createProject(withDefaults)
      // Merge server-assigned number into local project
      if (created.number != null) {
        const updated = get().projects.map((p) =>
          p.id === project.id ? { ...p, number: created.number } : p
        )
        set({ projects: updated })
      }
    } catch (err) {
      // Roll back optimistic update
      set({ projects: get().projects.filter((p) => p.id !== project.id) })
      console.error('[project-store] Failed to sync project to backend:', err)
      useToastStore.getState().add({ type: 'error', title: 'Failed to save project', description: 'Project may be lost on refresh. Check your connection.' })
      throw err
    }
  },

  updateProject: (id, updates) => {
    const prev = get().projects
    const next = prev.map((p) =>
      p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
    )
    set({ projects: next })
    dataClient.updateProject(id, updates).catch((err) => {
      console.error('[project-store] Failed to sync project update:', err)
      // Roll back optimistic update so the UI reflects the real server state
      set({ projects: prev })
      useToastStore.getState().add({ type: 'error', title: 'Failed to save project', description: String(err) })
    })
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
    dataClient.deleteProject(id).catch((err) => {
      console.error('[project-store] Failed to sync project deletion:', err)
    })
    // Clean up all plan nodes and edges for this project
    usePlanStore.getState().removeProjectPlan(id)
  },
}))
