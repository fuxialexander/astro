import { create } from "zustand"
import { dataClient } from "@/lib/data-client"

export type ActivityType =
  | "task.created"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "task.deleted"
  | "task.bulk_deleted"
  | "task.bulk_executed"
  | "task.bulk_reset"
  | "project.created"
  | "project.updated"
  | "milestone.created"
  | "milestone.updated"
  | "milestone.deleted"
  | "vision.updated"
  | "repo.configured"
  | "plan.refined"

export type Activity = {
  id: string
  projectId: string
  type: ActivityType
  title: string
  description?: string
  userId?: string
  nodeId?: string // For task-related activities
  timestamp: Date
  metadata?: Record<string, unknown>
}

type ActivityStore = {
  activities: Activity[]
  loaded: boolean
  /** True only after a full global loadActivities() — not set by loadForProject */
  globallyLoaded: boolean
  loading: boolean
  error: string | null
  loadActivities: () => Promise<void>
  /** Load activities for a single project (merges into global store) */
  loadForProject: (projectId: string) => Promise<void>
  addActivity: (activity: Omit<Activity, "id" | "timestamp">) => void
  getProjectActivities: (projectId: string, limit?: number) => Activity[]
  clearProjectActivities: (projectId: string) => void
}

const MAX_ACTIVITIES = 1000 // Keep last 1000 activities

export const useActivityStore = create<ActivityStore>((set, get) => ({
  activities: [],
  loaded: false,
  globallyLoaded: false,
  loading: false,
  error: null,

  loadActivities: async () => {
    set({ loading: true, error: null })
    try {
      const activities = await dataClient.listActivities()
      set({ activities, loaded: true, globallyLoaded: true, loading: false })
    } catch (err) {
      set({ loaded: true, globallyLoaded: true, loading: false, error: err instanceof Error ? err.message : 'Failed to load activities' })
    }
  },

  loadForProject: async (projectId: string) => {
    // Skip if we already loaded all data globally
    if (get().globallyLoaded) return
    try {
      const activities = await dataClient.listActivities(projectId)
      // Re-check after await: a concurrent global load() may have completed
      if (get().globallyLoaded) return
      set((state) => {
        // Merge: remove existing for this project, add fresh
        const others = state.activities.filter((a) => a.projectId !== projectId)
        return { activities: [...activities, ...others].slice(0, 1000), loaded: true }
      })
    } catch (err) {
      console.error('[activity-store] loadForProject failed:', err)
      set({ loaded: true })
    }
  },

  addActivity: (activity) => {
    const newActivity: Activity = {
      ...activity,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    }

    set((state) => {
      // Add new activity and keep only the last MAX_ACTIVITIES
      const updated = [newActivity, ...state.activities].slice(0, MAX_ACTIVITIES)
      return { activities: updated }
    })

    // Fire-and-forget: sync to server
    dataClient.createActivity({
      id: newActivity.id,
      projectId: newActivity.projectId,
      type: newActivity.type,
      title: newActivity.title,
      description: newActivity.description,
      nodeId: newActivity.nodeId,
      metadata: newActivity.metadata,
    }).catch(() => {})
  },

  getProjectActivities: (projectId, limit = 10) => {
    return get()
      .activities.filter((a) => a.projectId === projectId)
      .slice(0, limit)
  },

  clearProjectActivities: (projectId) => {
    set((state) => {
      const filtered = state.activities.filter((a) => a.projectId !== projectId)
      return { activities: filtered }
    })

    // Fire-and-forget: sync to server
    dataClient.clearProjectActivities(projectId).catch(() => {})
  },
}))
