import { create } from "zustand"
import { loadState, saveState } from "@/lib/db"
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
  loadActivities: () => Promise<void>
  addActivity: (activity: Omit<Activity, "id" | "timestamp">) => void
  getProjectActivities: (projectId: string, limit?: number) => Activity[]
  clearProjectActivities: (projectId: string) => void
}

const ACTIVITY_STORE_KEY = "astro:activities"
const MAX_ACTIVITIES = 1000 // Keep last 1000 activities

export const useActivityStore = create<ActivityStore>((set, get) => ({
  activities: [],
  loaded: false,

  loadActivities: async () => {
    try {
      // Try loading from API first (server mode)
      const activities = await dataClient.listActivities()
      set({ activities, loaded: true })
      // Cache to IndexedDB
      saveState(ACTIVITY_STORE_KEY, activities)
      return
    } catch {
      // API unavailable — fall back to IndexedDB
    }

    try {
      const stored = await loadState<Activity[]>(ACTIVITY_STORE_KEY)
      if (stored) {
        // Reconstruct Date objects
        const activities = stored.map((a) => ({
          ...a,
          timestamp: new Date(a.timestamp),
        }))
        set({ activities, loaded: true })
      } else {
        set({ loaded: true })
      }
    } catch (err) {
      console.error("Failed to load activities:", err)
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
      // Persist to IndexedDB
      saveState(ACTIVITY_STORE_KEY, updated)
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
      saveState(ACTIVITY_STORE_KEY, filtered)
      return { activities: filtered }
    })

    // Fire-and-forget: sync to server
    dataClient.clearProjectActivities(projectId).catch(() => {})
  },
}))
