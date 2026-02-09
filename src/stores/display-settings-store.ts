import { create } from "zustand"
import { loadState, saveState } from "@/lib/db"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase-client"

export type ViewKey = "projects" | "plan-list" | "my-tasks"

export interface DisplaySettings {
  groupBy: string
  orderBy: string
  orderDirection: "asc" | "desc"
  showCompleted: boolean
  visibleProperties: string[]
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
  "plan-list": {
    groupBy: "none",
    orderBy: "name",
    orderDirection: "asc",
    showCompleted: true,
    visibleProperties: ["priority", "status", "dueDate", "estimate", "labels"],
    zoom: "month",
  },
  "my-tasks": {
    groupBy: "project",
    orderBy: "updatedAt",
    orderDirection: "desc",
    showCompleted: false,
    visibleProperties: ["status", "priority", "project", "dueDate", "estimate"],
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

const DB_KEY = "nexus-display-settings"

export const useDisplaySettingsStore = create<DisplaySettingsState>((set, get) => ({
  settings: { ...DEFAULTS },
  loaded: false,

  load: async () => {
    const supabase = getSupabase()

    if (supabase && isSupabaseConfigured()) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from("display_settings")
          .select("*")
          .eq("user_id", user.id)

        if (data && data.length > 0) {
          const merged = { ...DEFAULTS }
          for (const row of data) {
            const key = row.view_key as ViewKey
            if (merged[key]) {
              merged[key] = { ...DEFAULTS[key], ...(row.settings as DisplaySettings) }
            }
          }
          set({ settings: merged, loaded: true })
          await saveState(DB_KEY, merged)
          return
        }
      }
    }

    // Fallback to IndexedDB
    const saved = await loadState<Record<ViewKey, DisplaySettings>>(DB_KEY)
    if (saved) {
      const merged = { ...DEFAULTS }
      for (const key of Object.keys(merged) as ViewKey[]) {
        if (saved[key]) {
          merged[key] = { ...DEFAULTS[key], ...saved[key] }
        }
      }
      set({ settings: merged, loaded: true })
    } else {
      set({ loaded: true })
    }
  },

  get: (view) => get().settings[view] ?? DEFAULTS[view],

  update: (view, partial) => {
    const current = get().settings
    const updated = {
      ...current,
      [view]: { ...current[view], ...partial },
    }
    set({ settings: updated })
    saveState(DB_KEY, updated)

    // Sync to Supabase
    const supabase = getSupabase()
    if (supabase && isSupabaseConfigured()) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          supabase
            .from("display_settings")
            .upsert({
              user_id: user.id,
              view_key: view,
              settings: updated[view],
            }, { onConflict: "user_id,view_key" })
            .then()
        }
      })
    }
  },

  reset: (view) => {
    const current = get().settings
    const updated = { ...current, [view]: { ...DEFAULTS[view] } }
    set({ settings: updated })
    saveState(DB_KEY, updated)

    // Sync to Supabase
    const supabase = getSupabase()
    if (supabase && isSupabaseConfigured()) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          supabase
            .from("display_settings")
            .upsert({
              user_id: user.id,
              view_key: view,
              settings: DEFAULTS[view],
            }, { onConflict: "user_id,view_key" })
            .then()
        }
      })
    }
  },
}))

export { DEFAULTS as DISPLAY_DEFAULTS }
