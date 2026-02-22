import { create } from "zustand"
import { dataClient } from "@/lib/data-client"

export type ViewKey = "projects" | "projects-timeline" | "plan-list" | "plan-graph" | "my-tasks" | "my-tasks-timeline" | "plan-board" | "my-tasks-board"

export interface DisplaySettings {
  groupBy: string
  orderBy: string
  orderDirection: "asc" | "desc"
  showCompleted: boolean
  visibleProperties: string[]
  columnBy?: "status" | "priority" | "milestone"
  zoom?: "month" | "quarter" | "year"
  showProjectList?: boolean
  showWeekNumbers?: boolean
  showEmptyGroups?: boolean
}

const DEFAULTS: Record<ViewKey, DisplaySettings> = {
  projects: {
    groupBy: "initiative",
    orderBy: "name",
    orderDirection: "asc",
    showCompleted: true,
    visibleProperties: ["status", "health", "progress", "targetDate"],
  },
  "projects-timeline": {
    groupBy: "none",
    orderBy: "name",
    orderDirection: "asc",
    showCompleted: true,
    visibleProperties: [],
    zoom: "month",
  },
  "plan-graph": {
    groupBy: "status",
    orderBy: "name",
    orderDirection: "asc",
    showCompleted: true,
    visibleProperties: [],
  },
  "plan-list": {
    groupBy: "none",
    orderBy: "name",
    orderDirection: "asc",
    showCompleted: true,
    visibleProperties: ["priority", "status", "dueDate", "estimate", "labels", "pr"],
    zoom: "month",
  },
  "my-tasks": {
    groupBy: "project",
    orderBy: "updatedAt",
    orderDirection: "desc",
    showCompleted: false,
    visibleProperties: ["status", "priority", "project", "dueDate", "estimate", "pr"],
  },
  "my-tasks-timeline": {
    groupBy: "none",
    orderBy: "dueDate",
    orderDirection: "asc",
    showCompleted: false,
    visibleProperties: [],
    zoom: "month",
  },
  "plan-board": {
    groupBy: "none",
    orderBy: "priority",
    orderDirection: "asc",
    showCompleted: false,
    columnBy: "status",
    visibleProperties: ["priority", "estimate", "dueDate", "pr"],
  },
  "my-tasks-board": {
    groupBy: "none",
    orderBy: "priority",
    orderDirection: "asc",
    showCompleted: false,
    columnBy: "status",
    visibleProperties: ["priority", "project", "dueDate", "pr"],
  },
}

interface DisplaySettingsState {
  settings: Record<ViewKey, DisplaySettings>
  loaded: boolean
  load: () => Promise<void>
  get: (view: ViewKey) => DisplaySettings
  update: (view: ViewKey, partial: Partial<DisplaySettings>) => void
  reset: (view: ViewKey) => void
}

export const useDisplaySettingsStore = create<DisplaySettingsState>((set, get) => ({
  settings: { ...DEFAULTS },
  loaded: false,

  load: async () => {
    try {
      const fromApi = await dataClient.getDisplaySettings()
      if (fromApi && Object.keys(fromApi).length > 0) {
        const merged = { ...DEFAULTS }
        for (const [key, value] of Object.entries(fromApi)) {
          const viewKey = key as ViewKey
          if (merged[viewKey]) {
            merged[viewKey] = { ...DEFAULTS[viewKey], ...value }
          }
        }
        set({ settings: merged, loaded: true })
        return
      }
    } catch {
      // API unavailable
    }

    set({ loaded: true })
  },

  get: (view) => get().settings[view] ?? DEFAULTS[view],

  update: (view, partial) => {
    const current = get().settings
    const updated = {
      ...current,
      [view]: { ...current[view], ...partial },
    }
    set({ settings: updated })
    dataClient.updateDisplaySetting(view, updated[view]).catch(() => {})
  },

  reset: (view) => {
    const current = get().settings
    const updated = { ...current, [view]: { ...DEFAULTS[view] } }
    set({ settings: updated })
    dataClient.updateDisplaySetting(view, DEFAULTS[view]).catch(() => {})
  },
}))

export { DEFAULTS as DISPLAY_DEFAULTS }
