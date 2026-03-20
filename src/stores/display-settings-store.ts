import { create } from "zustand"
import { dataClient } from "@/lib/data-client"

export type ViewKey = "projects" | "projects-timeline" | "plan-list" | "plan-graph" | "my-tasks" | "my-tasks-timeline" | "plan-board" | "my-tasks-board" | "initiative-projects" | "skills"

export interface DisplaySettings {
  groupBy: string
  orderBy: string
  orderDirection: "asc" | "desc"
  showCompleted: boolean
  visibleProperties: string[]
  columnBy?: "status" | "priority" | "milestone"
  zoom?: "day" | "week" | "month" | "quarter" | "year"
  showProjectList?: boolean
  showWeekNumbers?: boolean
  showEmptyGroups?: boolean
  fastEdit?: boolean
}

const DEFAULTS: Record<ViewKey, DisplaySettings> = {
  projects: {
    groupBy: "initiative",
    orderBy: "name",
    orderDirection: "asc",
    showCompleted: true,
    visibleProperties: ["workingDirectory", "progress", "targetDate"],
  },
  "projects-timeline": {
    groupBy: "none",
    orderBy: "name",
    orderDirection: "asc",
    showCompleted: true,
    visibleProperties: [],
    zoom: "day",
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
    orderBy: "number",
    orderDirection: "asc",
    showCompleted: true,
    visibleProperties: ["status", "labels", "pr"],
    zoom: "day",
  },
  "my-tasks": {
    groupBy: "project",
    orderBy: "updatedAt",
    orderDirection: "desc",
    showCompleted: false,
    visibleProperties: ["status", "pr"],
  },
  "my-tasks-timeline": {
    groupBy: "none",
    orderBy: "dueDate",
    orderDirection: "asc",
    showCompleted: false,
    visibleProperties: [],
    zoom: "day",
  },
  "plan-board": {
    groupBy: "none",
    orderBy: "priority",
    orderDirection: "asc",
    showCompleted: false,
    columnBy: "status",
    visibleProperties: ["pr"],
  },
  "my-tasks-board": {
    groupBy: "none",
    orderBy: "priority",
    orderDirection: "asc",
    showCompleted: false,
    columnBy: "status",
    visibleProperties: ["priority", "project", "dueDate", "pr"],
  },
  "initiative-projects": {
    groupBy: "none",
    orderBy: "name",
    orderDirection: "asc",
    showCompleted: true,
    visibleProperties: ["status", "health", "progress", "targetDate"],
  },
  skills: {
    groupBy: "none",
    orderBy: "name",
    orderDirection: "asc",
    showCompleted: true,
    visibleProperties: ["enabled", "category", "source", "tags"],
  },
}

interface DisplaySettingsState {
  settings: Record<ViewKey, DisplaySettings>
  fastEdit: boolean
  loaded: boolean
  load: () => Promise<void>
  get: (view: ViewKey) => DisplaySettings
  update: (view: ViewKey, partial: Partial<DisplaySettings>) => void
  reset: (view: ViewKey) => void
  toggleFastEdit: () => void
}

export const useDisplaySettingsStore = create<DisplaySettingsState>((set, get) => ({
  settings: { ...DEFAULTS },
  fastEdit: false,
  loaded: false,

  load: async () => {
    try {
      const fromApi = await dataClient.getDisplaySettings()
      if (fromApi && Object.keys(fromApi).length > 0) {
        const merged = { ...DEFAULTS }
        // Migrate: read fastEdit from any per-view setting (global since migration)
        let globalFastEdit = false
        for (const [key, value] of Object.entries(fromApi)) {
          if (key === '_global') {
            globalFastEdit = !!(value as unknown as Record<string, unknown>).fastEdit
            continue
          }
          const viewKey = key as ViewKey
          if (merged[viewKey]) {
            const settings = { ...DEFAULTS[viewKey], ...value }
            // Migrate removed "number" orderBy to "dependency"
            if (settings.orderBy === "number") {
              settings.orderBy = "dependency"
            }
            // Remove stale "order" from visibleProperties (now inline in Name column)
            if (settings.visibleProperties?.includes("order")) {
              settings.visibleProperties = settings.visibleProperties.filter((p: string) => p !== "order")
            }
            // Migrate per-view fastEdit to global
            if (settings.fastEdit) {
              globalFastEdit = true
              delete settings.fastEdit
            }
            merged[viewKey] = settings
          }
        }
        set({ settings: merged, fastEdit: globalFastEdit, loaded: true })
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

  toggleFastEdit: () => {
    const next = !get().fastEdit
    set({ fastEdit: next })
    dataClient.updateDisplaySetting('_global' as ViewKey, { fastEdit: next } as unknown as DisplaySettings).catch(() => {})
  },
}))

export { DEFAULTS as DISPLAY_DEFAULTS }
