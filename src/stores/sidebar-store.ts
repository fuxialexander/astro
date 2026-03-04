import { create } from "zustand"
import { dataClient } from "@/lib/data-client"

export interface SidebarItem {
  id: string
  to: string
  icon: string
  label: string
  visible: boolean
  protected: boolean // Cannot be removed
  autoRevealed?: boolean   // system auto-showed this item
  userDismissed?: boolean  // user explicitly dismissed after auto-reveal
}

export interface AutoRevealCounts {
  activeProjectCount: number
  activeTaskCount: number
}

const AUTO_REVEAL_THRESHOLDS: Record<string, (c: AutoRevealCounts) => boolean> = {
  tasks:       (c) => c.activeProjectCount > 2,
  initiatives: (c) => c.activeProjectCount > 5,
  active:      (c) => c.activeTaskCount > 5,
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
  checkAutoReveal: (counts: AutoRevealCounts) => void
  dismissAutoReveal: (itemId: string) => void
  registerExternalItem: (item: SidebarItem) => void
  unregisterExternalItem: (itemId: string) => void
}

const defaultItems: SidebarItem[] = [
  { id: "dashboard", to: "/dashboard", icon: "Radio", label: "Dashboard", visible: true, protected: true },
  { id: "plan", to: "/plan", icon: "Sparkles", label: "Plan", visible: true, protected: true },
  { id: "playground", to: "/playground", icon: "FlaskConical", label: "Playground", visible: true, protected: false },
  { id: "projects", to: "/projects", icon: "GitBranch", label: "Projects", visible: true, protected: false },
  { id: "examples", to: "/examples", icon: "BookOpen", label: "Examples", visible: true, protected: false },
  { id: "community", to: "/community", icon: "Globe", label: "Community", visible: true, protected: false },
  { id: "environments", to: "/environments", icon: "Terminal", label: "Environments", visible: true, protected: true },
  { id: "tasks", to: "/tasks", icon: "CheckSquare", label: "Tasks", visible: false, protected: false },
  { id: "active", to: "/active", icon: "Zap", label: "Active", visible: false, protected: false },
  { id: "workflows", to: "/workflows", icon: "BookOpen", label: "Workflows", visible: false, protected: false },
  { id: "initiatives", to: "/initiatives", icon: "Target", label: "Grand Plans", visible: false, protected: false },
  { id: "skills", to: "/skills", icon: "Wrench", label: "Skills", visible: true, protected: false },
]

function mergeWithDefaults(stored: SidebarItem[]): SidebarItem[] {
  return defaultItems.map((defaultItem) => {
    const storedItem = stored.find((s) => s.id === defaultItem.id)
    if (storedItem) {
      // Always take icon/to/label/protected from defaults (code is source of truth)
      // Keep user preferences: visible, autoRevealed, userDismissed, ordering
      const merged = { ...storedItem, icon: defaultItem.icon, to: defaultItem.to, label: defaultItem.label, protected: defaultItem.protected }
      if (defaultItem.protected) {
        return { ...merged, visible: true }
      }
      return merged
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
        return
      }
    } catch {
      // API unavailable
    }

    set({ loaded: true })
  },

  save: async () => {
    try {
      const items = get().items

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
    const items = get().items.map((item) => {
      if (item.id !== itemId) return item
      const nowHidden = item.visible
      return {
        ...item,
        visible: !item.visible,
        // If hiding an auto-revealed item, mark as user-dismissed
        ...(nowHidden && item.autoRevealed ? { userDismissed: true, autoRevealed: false } : {}),
      }
    })
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

  checkAutoReveal: (counts: AutoRevealCounts) => {
    const items = get().items
    let changed = false
    const updated = items.map((item) => {
      const threshold = AUTO_REVEAL_THRESHOLDS[item.id]
      if (!threshold) return item
      if (item.userDismissed) return item
      if (item.visible) return item
      if (!threshold(counts)) return item
      changed = true
      return { ...item, visible: true, autoRevealed: true }
    })
    if (changed) {
      set({ items: updated })
      get().save()
    }
  },

  dismissAutoReveal: (itemId: string) => {
    const items = get().items.map((item) =>
      item.id === itemId
        ? { ...item, visible: false, userDismissed: true, autoRevealed: false }
        : item
    )
    set({ items })
    get().save()
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
