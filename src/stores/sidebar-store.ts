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
}

const defaultItems: SidebarItem[] = [
  { id: "tasks", to: "/", icon: "CheckSquare", label: "Tasks", visible: true, protected: true },
  { id: "projects", to: "/projects", icon: "GitBranch", label: "Projects", visible: true, protected: false },
  { id: "environments", to: "/environments", icon: "Terminal", label: "Environments", visible: true, protected: true },
  { id: "dashboard", to: "/dashboard", icon: "Radio", label: "Dashboard", visible: false, protected: false },
  { id: "initiatives", to: "/initiatives", icon: "Target", label: "Initiatives", visible: false, protected: false },
  { id: "agents", to: "/agents", icon: "Cpu", label: "Agents", visible: false, protected: false },
]

/**
 * Merge stored sidebar config with defaults so new items get picked up.
 */
function mergeWithDefaults(stored: SidebarItem[]): SidebarItem[] {
  return defaultItems.map((defaultItem) => {
    const storedItem = stored.find((s) => s.id === defaultItem.id)
    if (storedItem) {
      // Protected items must always be visible
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
  isEditing: false,
  loaded: false,

  load: async () => {
    try {
      // Try API first (server mode)
      const profile = await dataClient.getProfile()
      if (profile?.sidebarConfig) {
        set({ items: mergeWithDefaults(profile.sidebarConfig as SidebarItem[]), loaded: true })
        saveState("sidebar-items", profile.sidebarConfig)
        return
      }
    } catch {
      // API unavailable — fall through to IndexedDB
    }

    // Fallback to IndexedDB
    const stored = await loadState<SidebarItem[]>("sidebar-items")
    if (stored) {
      set({ items: mergeWithDefaults(stored), loaded: true })
    } else {
      set({ loaded: true })
    }
  },

  save: async () => {
    const items = get().items
    // Save to IndexedDB (always, for offline access)
    saveState("sidebar-items", items)
    // Fire-and-forget API call
    dataClient.updateProfile({ sidebarConfig: items } as Partial<import("@/types").UserProfile>).catch(() => {})
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
    // Realtime sync is handled centrally by realtime-sync.ts
    return () => {}
  },

  syncWithProjectCount: () => {
    // Tasks is always visible (it's the home route)
  },
}))

// Export mergeWithDefaults for use in realtime-sync
export { mergeWithDefaults, defaultItems as sidebarDefaults }
