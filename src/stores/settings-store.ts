import { create } from "zustand"
import { apiUrl } from "@/lib/api-url"
import { dataClient } from "@/lib/data-client"

interface SettingsState {
  model: string
  defaultProvider: string // '' = auto/first available
  connectionStatus: "connected" | "disconnected" | "checking"
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
  checkConnection: () => Promise<void>
  setModel: (model: string) => void
  setDefaultProvider: (provider: string) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  model: "claude-sonnet-4-5-20250929",
  defaultProvider: "",
  connectionStatus: "disconnected",
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const settings = await dataClient.getSettings()
      if (settings.model || settings.defaultProvider) {
        set({
          model: settings.model || get().model,
          defaultProvider: settings.defaultProvider || "",
          loaded: true,
          loading: false,
        })
      } else {
        set({ loaded: true, loading: false })
      }
    } catch (err) {
      set({ loaded: true, loading: false, error: err instanceof Error ? err.message : 'Failed to load settings' })
    }
    // Check connection on load
    get().checkConnection()
  },

  checkConnection: async () => {
    set({ connectionStatus: "checking" })
    try {
      const res = await fetch(apiUrl("/api/health"))
      if (!res.ok) throw new Error("Backend unreachable")
      const data = await res.json()
      set({ connectionStatus: data.authenticated ? "connected" : "disconnected" })
    } catch {
      set({ connectionStatus: "disconnected" })
    }
  },

  setModel: (model) => {
    set({ model })
    dataClient.updateSettings({ model }).catch(() => {})
  },

  setDefaultProvider: (defaultProvider) => {
    set({ defaultProvider })
    dataClient.updateSettings({ defaultProvider }).catch(() => {})
  },
}))
