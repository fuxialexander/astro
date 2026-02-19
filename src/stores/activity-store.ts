import { create } from "zustand"
import { get as getIdb, set as setIdb } from "idb-keyval"

export type ActivityType =
  | "task.created"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "task.deleted"
  | "task.bulk_deleted"
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
      const stored = await getIdb<Activity[]>(ACTIVITY_STORE_KEY)
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
      setIdb(ACTIVITY_STORE_KEY, updated).catch((err) =>
        console.error("Failed to persist activities:", err)
      )
      return { activities: updated }
    })
  },

  getProjectActivities: (projectId, limit = 10) => {
    return get()
      .activities.filter((a) => a.projectId === projectId)
      .slice(0, limit)
  },

  clearProjectActivities: (projectId) => {
    set((state) => {
      const filtered = state.activities.filter((a) => a.projectId !== projectId)
      setIdb(ACTIVITY_STORE_KEY, filtered).catch((err) =>
        console.error("Failed to persist activities:", err)
      )
      return { activities: filtered }
    })
  },
}))
