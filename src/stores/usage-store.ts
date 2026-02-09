import { create } from "zustand"
import type { UsageMetrics } from "@/types"
import { loadState, saveState } from "@/lib/db"

const STORAGE_KEY = "nexus-usage-metrics"

export interface SessionMetrics {
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  tasksCompleted: number
  tasksFailed: number
}

interface UsageState {
  sessionMetrics: SessionMetrics
  loaded: boolean

  // Actions
  addTaskMetrics: (metrics: UsageMetrics, success: boolean) => void
  reset: () => void
  load: () => Promise<void>
}

const defaultMetrics: SessionMetrics = {
  totalCostUsd: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  tasksCompleted: 0,
  tasksFailed: 0,
}

export const useUsageStore = create<UsageState>((set) => ({
  sessionMetrics: { ...defaultMetrics },
  loaded: false,

  addTaskMetrics: (metrics: UsageMetrics, success: boolean) => {
    set((state) => {
      const updated: SessionMetrics = {
        totalCostUsd: state.sessionMetrics.totalCostUsd + (metrics.estimatedCostUsd ?? 0),
        totalInputTokens: state.sessionMetrics.totalInputTokens + (metrics.inputTokens ?? 0),
        totalOutputTokens: state.sessionMetrics.totalOutputTokens + (metrics.outputTokens ?? 0),
        tasksCompleted: state.sessionMetrics.tasksCompleted + (success ? 1 : 0),
        tasksFailed: state.sessionMetrics.tasksFailed + (success ? 0 : 1),
      }
      saveState(STORAGE_KEY, updated)
      return { sessionMetrics: updated }
    })
  },

  reset: () => {
    const fresh = { ...defaultMetrics }
    saveState(STORAGE_KEY, fresh)
    set({ sessionMetrics: fresh })
  },

  load: async () => {
    const stored = await loadState<SessionMetrics>(STORAGE_KEY)
    if (stored) {
      set({ sessionMetrics: stored, loaded: true })
    } else {
      set({ loaded: true })
    }
  },
}))
