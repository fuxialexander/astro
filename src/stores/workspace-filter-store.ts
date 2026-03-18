import { create } from "zustand"
import { persist } from "zustand/middleware"

interface WorkspaceFilterState {
  workspaceFilter: 'all' | (string & {})
  setWorkspaceFilter: (filter: string) => void
}

export const useWorkspaceFilterStore = create<WorkspaceFilterState>()(
  persist(
    (set) => ({
      workspaceFilter: 'all',
      setWorkspaceFilter: (filter: string) => set({ workspaceFilter: filter }),
    }),
    { name: 'astro-workspace-filter' }
  )
)
