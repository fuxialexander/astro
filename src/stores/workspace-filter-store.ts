import { create } from "zustand"

interface WorkspaceFilterState {
  workspaceFilter: 'all' | 'personal' | (string & {})
  setWorkspaceFilter: (filter: string) => void
}

export const useWorkspaceFilterStore = create<WorkspaceFilterState>((set) => ({
  workspaceFilter: 'all',
  setWorkspaceFilter: (filter: string) => set({ workspaceFilter: filter }),
}))
