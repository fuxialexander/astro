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
  loading: boolean
  error: string | null

  loadProjects: () => Promise<void>
  setActiveProject: (id: string | null) => void
  getProject: (id: string) => Project | undefined
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
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

  setActiveProject: (id) => set({ activeProjectId: id }),

  getProject: (id) => get().projects.find((p) => p.id === id),
}))
