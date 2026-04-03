/**
 * Project store — fetches and caches the project list from the backend.
 * Calls GET /api/data/projects (slim mode).
 */
import { create } from 'zustand'
import { api } from '@desktop/lib/api-client'
import type { Project } from '@desktop/types'

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  currentProject: Project | null
  loading: boolean
  error: string | null

  loadProjects: () => Promise<void>
  createProject: (name: string) => Promise<Project | null>
  updateProject: (id: string, patch: Partial<Pick<Project, 'workingDirectory' | 'defaultMachineId' | 'name' | 'repository'>>) => Promise<void>
  setCurrentProject: (project: Project | null) => void
  setActiveProject: (id: string | null) => void
  getProject: (id: string) => Project | undefined
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  currentProject: null,
  loading: false,
  error: null,

  loadProjects: async () => {
    set({ loading: true, error: null })
    try {
      const data = await api.get<Project[]>('/api/data/projects')
      set({ projects: data ?? [], loading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load projects',
        loading: false,
      })
    }
  },

  createProject: async (name: string) => {
    try {
      const project = await api.post<Project>('/api/data/projects', { name: name.trim() })
      if (project) {
        set((s) => ({ projects: [project, ...s.projects] }))
      }
      return project ?? null
    } catch {
      return null
    }
  },

  updateProject: async (id, patch) => {
    try {
      await api.patch(`/api/data/projects/${id}`, patch)
      set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }))
    } catch {
      // ignore
    }
  },

  setCurrentProject: (currentProject) => set({ currentProject }),
  setActiveProject: (id) => set({ activeProjectId: id }),

  getProject: (id) => get().projects.find((p) => p.id === id),
}))
