import { create } from "zustand"
import { loadState, saveState } from "@/lib/db"
import { dataClient } from "@/lib/data-client"

interface SettingsState {
  model: string
  connectionStatus: "connected" | "disconnected" | "checking"
  loaded: boolean
  load: () => Promise<void>
  checkConnection: () => Promise<void>
  setModel: (model: string) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  model: "claude-sonnet-4-5-20250929",
  connectionStatus: "disconnected",
  loaded: false,

  load: async () => {
    try {
      const settings = await dataClient.getSettings()
      if (settings.model) {
        set({ model: settings.model, loaded: true })
        saveState("nexus-settings", { model: settings.model })
      } else {
        set({ loaded: true })
      }
    } catch {
      // API unavailable — fall back to IndexedDB
      const saved = await loadState<{ model: string }>("nexus-settings")
      if (saved) {
        set({ model: saved.model, loaded: true })
      } else {
        set({ loaded: true })
      }
    }
    // Check connection on load
    get().checkConnection()
  },

  checkConnection: async () => {
    set({ connectionStatus: "checking" })
    try {
      const res = await fetch("/api/health")
      if (!res.ok) throw new Error("Backend unreachable")
      const data = await res.json()
      set({ connectionStatus: data.authenticated ? "connected" : "disconnected" })
    } catch {
      set({ connectionStatus: "disconnected" })
    }
  },

  setModel: (model) => {
    set({ model })
    saveState("nexus-settings", { model })
    dataClient.updateSettings({ model }).catch(() => {})
  },
}))
