import { create } from "zustand"
import { loadState, saveState } from "@/lib/db"
import { dataClient } from "@/lib/data-client"

export interface SidebarItem {
  id: string
  to: string
  icon: string
  label: string
  visible: boolean
  protected: boolean // Cannot be removed
}

interface SidebarStore {
  items: SidebarItem[]
  externalItems: SidebarItem[]
  isEditing: boolean
  loaded: boolean
  load: () => Promise<void>
  save: () => Promise<void>
  setEditing: (editing: boolean) => void
  toggleItemVisibility: (itemId: string) => void
  reorderItems: (startIndex: number, endIndex: number) => void
  resetToDefault: () => void
  subscribeToChanges: () => () => void
  syncWithProjectCount: () => void
  registerExternalItem: (item: SidebarItem) => void
  unregisterExternalItem: (itemId: string) => void
}

const defaultItems: SidebarItem[] = [
  { id: "tasks", to: "/", icon: "CheckSquare", label: "Tasks", visible: true, protected: true },
  { id: "projects", to: "/projects", icon: "GitBranch", label: "Projects", visible: true, protected: false },
  { id: "environments", to: "/environments", icon: "Terminal", label: "Environments", visible: true, protected: true },
  { id: "workflows", to: "/workflows", icon: "BookOpen", label: "Workflows", visible: true, protected: false },
  { id: "dashboard", to: "/dashboard", icon: "Radio", label: "Dashboard", visible: false, protected: false },
  { id: "initiatives", to: "/initiatives", icon: "Target", label: "Initiatives", visible: false, protected: false },
  { id: "agents", to: "/agents", icon: "Cpu", label: "Agents", visible: false, protected: false },
]

function mergeWithDefaults(stored: SidebarItem[]): SidebarItem[] {
  return defaultItems.map((defaultItem) => {
    const storedItem = stored.find((s) => s.id === defaultItem.id)
    if (storedItem) {
      // Protected items (like Tasks) must always be visible
      if (defaultItem.protected) {
        return { ...storedItem, visible: true }
      }
      return storedItem
    }
    return defaultItem
  })
}

export const useSidebarStore = create<SidebarStore>((set, get) => ({
  items: defaultItems,
  externalItems: [],
  isEditing: false,
  loaded: false,

  load: async () => {
    try {
      // Try API first (server mode) — extract sidebarConfig from profile
      const profile = await dataClient.getProfile()
      if (profile?.sidebarConfig) {
        const merged = mergeWithDefaults(profile.sidebarConfig)
        set({ items: merged, loaded: true })
        // Cache to IndexedDB
        saveState("sidebar-items", merged)
        return
      }
    } catch {
      // API unavailable — fall back to IndexedDB
    }

    try {
      const stored = await loadState<SidebarItem[]>("sidebar-items")
      if (stored) {
        const merged = mergeWithDefaults(stored)
        set({ items: merged, loaded: true })
      } else {
        set({ loaded: true })
      }
    } catch (error) {
      console.error("[SidebarStore] Failed to load:", error)
      set({ loaded: true })
    }
  },

  save: async () => {
    try {
      const items = get().items

      // Save to IndexedDB (always, for offline access)
      saveState("sidebar-items", items)

      // Fire-and-forget: sync to server via profile update
      dataClient.updateProfile({ sidebarConfig: items }).catch(() => {})
    } catch (error) {
      console.error("[SidebarStore] Failed to save:", error)
    }
  },

  setEditing: (editing: boolean) => {
    set({ isEditing: editing })
  },

  toggleItemVisibility: (itemId: string) => {
    const items = get().items.map((item) =>
      item.id === itemId ? { ...item, visible: !item.visible } : item
    )
    set({ items })
    get().save()
  },

  reorderItems: (startIndex: number, endIndex: number) => {
    const items = [...get().items]
    const [removed] = items.splice(startIndex, 1)
    items.splice(endIndex, 0, removed)
    set({ items })
    get().save()
  },

  resetToDefault: () => {
    set({ items: defaultItems })
    get().save()
  },

  subscribeToChanges: () => {
    // Realtime sync for sidebar config is handled by realtime-sync.ts
    // which propagates user_profiles changes to this store
    return () => {}
  },

  syncWithProjectCount: () => {
    // Tasks is always visible (it's the home route)
  },

  registerExternalItem: (item: SidebarItem) => {
    const existing = get().externalItems
    if (existing.some((i) => i.id === item.id)) return // Deduplicate
    set({ externalItems: [...existing, item] })
  },

  unregisterExternalItem: (itemId: string) => {
    const externalItems = get().externalItems.filter((i) => i.id !== itemId)
    set({ externalItems })
  },
}))

// Export mergeWithDefaults for use in realtime-sync
export { mergeWithDefaults, defaultItems as sidebarDefaults }
