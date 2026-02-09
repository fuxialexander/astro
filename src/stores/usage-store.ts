import { create } from "zustand"
import type { UsageMetrics } from "@/types"
import { loadState, saveState } from "@/lib/db"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase-client"

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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
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

      // Sync to Supabase usage_metrics (daily aggregate)
      const supabase = getSupabase()
      if (supabase && isSupabaseConfigured()) {
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user) {
            supabase.rpc("increment_usage_metrics", {
              p_user_id: user.id,
              p_session_date: todayKey(),
              p_cost: metrics.estimatedCostUsd ?? 0,
              p_input_tokens: metrics.inputTokens ?? 0,
              p_output_tokens: metrics.outputTokens ?? 0,
              p_completed: success ? 1 : 0,
              p_failed: success ? 0 : 1,
            }).then()
          }
        })
      }

      return { sessionMetrics: updated }
    })
  },

  reset: () => {
    const fresh = { ...defaultMetrics }
    saveState(STORAGE_KEY, fresh)
    set({ sessionMetrics: fresh })
  },

  load: async () => {
    const supabase = getSupabase()

    if (supabase && isSupabaseConfigured()) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from("usage_metrics")
          .select("*")
          .eq("user_id", user.id)
          .eq("session_date", todayKey())
          .single()

        if (data) {
          const metrics: SessionMetrics = {
            totalCostUsd: data.total_cost_usd as number,
            totalInputTokens: data.total_input_tokens as number,
            totalOutputTokens: data.total_output_tokens as number,
            tasksCompleted: data.tasks_completed as number,
            tasksFailed: data.tasks_failed as number,
          }
          set({ sessionMetrics: metrics, loaded: true })
          await saveState(STORAGE_KEY, metrics)
          return
        }
      }
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
