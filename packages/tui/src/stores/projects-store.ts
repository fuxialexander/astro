/**
 * Projects list store. Loaded via AstroClient.
 */
import { create } from 'zustand'
import type { Project } from '../client-adapter.js'

export interface ProjectsState {
  projects: Project[]
  loading: boolean
  error: string | null
}

export interface ProjectsActions {
  setProjects: (projects: Project[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useProjectsStore = create<ProjectsState & ProjectsActions>((set) => ({
  projects: [],
  loading: false,
  error: null,

  setProjects: (projects) => set({ projects, loading: false, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
}))
