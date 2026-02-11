import { create } from "zustand"
import type { UsageMetrics } from "@/types"
import { loadState, saveState } from "@/lib/db"
import { dataClient } from "@/lib/data-client"

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

      // Sync incremental usage to API
      dataClient.incrementUsage({
        totalCostUsd: metrics.estimatedCostUsd ?? 0,
        totalInputTokens: metrics.inputTokens ?? 0,
        totalOutputTokens: metrics.outputTokens ?? 0,
        tasksCompleted: success ? 1 : 0,
        tasksFailed: success ? 0 : 1,
      }).catch(() => {})

      return { sessionMetrics: updated }
    })
  },

  reset: () => {
    const fresh = { ...defaultMetrics }
    saveState(STORAGE_KEY, fresh)
    set({ sessionMetrics: fresh })
  },

  load: async () => {
    try {
      const metrics = await dataClient.getTodayUsage()
      if (metrics) {
        set({ sessionMetrics: metrics, loaded: true })
        saveState(STORAGE_KEY, metrics)
        return
      }
    } catch {
      // API unavailable
    }

    // Fallback to IndexedDB
    const stored = await loadState<SessionMetrics>(STORAGE_KEY)
    if (stored) {
      set({ sessionMetrics: stored, loaded: true })
    } else {
      set({ loaded: true })
    }
  },
}))
