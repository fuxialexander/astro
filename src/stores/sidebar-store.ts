import { create } from "zustand"
import { dataClient } from "@/lib/data-client"
import { useUserProfileStore } from "@/stores/user-profile-store"

export interface SidebarItem {
  id: string
  to: string
  icon: string
  label: string
  visible: boolean
  protected: boolean // Cannot be removed
  autoRevealed?: boolean   // system auto-showed this item
  userDismissed?: boolean  // user explicitly dismissed after auto-reveal
  featureFlag?: string     // if set, item hidden when flag is off for the team
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

export interface PinnedSidebarItem {
  id: string
  type: 'project' | 'session'
}

interface SidebarStore {
  items: SidebarItem[]
  externalItems: SidebarItem[]
  pinnedItems: PinnedSidebarItem[]
  collapsedInitiatives: Set<string>
  projectOrder: string[]
  isEditing: boolean
  loaded: boolean
  load: () => Promise<void>
  save: () => Promise<void>
  setEditing: (editing: boolean) => void
  toggleItemVisibility: (itemId: string) => void
  reorderItems: (startIndex: number, endIndex: number) => void
  pinItem: (id: string, type: 'project' | 'session') => void
  unpinItem: (id: string) => void
  reorderPinnedItems: (startIndex: number, endIndex: number) => void
  reorderProjectOrder: (fromId: string, toId: string) => void
  toggleInitiativeCollapse: (initiativeId: string) => void
  resetToDefault: () => void
  subscribeToChanges: () => () => void
  checkAutoReveal: (counts: AutoRevealCounts) => void
  dismissAutoReveal: (itemId: string) => void
  registerExternalItem: (item: SidebarItem) => void
  unregisterExternalItem: (itemId: string) => void
}

const defaultItems: SidebarItem[] = [
  { id: "dashboard", to: "/dashboard", icon: "Inbox", label: "Dashboard", visible: true, protected: true },
  { id: "active", to: "/active", icon: "Activity", label: "Active", visible: true, protected: true },
  { id: "projects", to: "/projects", icon: "Folder", label: "Projects", visible: true, protected: true },
  { id: "environments", to: "/environments", icon: "Server", label: "Environments", visible: true, protected: false },
  { id: "github", to: "/github", icon: "Github", label: "GitHub", visible: true, protected: false },
  { id: "community", to: "/community", icon: "Globe", label: "Community", visible: false, protected: false },
  { id: "tasks", to: "/tasks", icon: "CheckSquare", label: "Tasks", visible: false, protected: false },
  { id: "initiatives", to: "/initiatives", icon: "Target", label: "Initiatives", visible: false, protected: false },
]

function mergeWithDefaults(stored: SidebarItem[]): SidebarItem[] {
  // Preserve the user's custom order by iterating over stored items first.
  // Items that no longer exist in defaults are dropped.
  const merged: SidebarItem[] = stored
    .flatMap((storedItem): SidebarItem[] => {
      const defaultItem = defaultItems.find((d) => d.id === storedItem.id)
      if (!defaultItem) return [] // Item removed from defaults — drop it
      // Always take icon/to/label/protected/featureFlag from defaults (code is source of truth)
      // Keep user preferences: visible, autoRevealed, userDismissed, ordering
      const result: SidebarItem = { ...storedItem, icon: defaultItem.icon, to: defaultItem.to, label: defaultItem.label, protected: defaultItem.protected, featureFlag: defaultItem.featureFlag }
      if (defaultItem.protected) {
        return [{ ...result, visible: true }]
      }
      return [result]
    })

  // Append any new default items that aren't in the stored list yet
  const storedIds = new Set(stored.map((s) => s.id))
  for (const defaultItem of defaultItems) {
    if (!storedIds.has(defaultItem.id)) {
      merged.push(defaultItem)
    }
  }

  // Ensure "active" is always right after "dashboard" (protected position)
  const dashIdx = merged.findIndex((i) => i.id === "dashboard")
  const activeIdx = merged.findIndex((i) => i.id === "active")
  if (dashIdx >= 0 && activeIdx >= 0 && activeIdx !== dashIdx + 1) {
    const [active] = merged.splice(activeIdx, 1)
    merged.splice(dashIdx + 1, 0, active)
  }

  return merged
}

export const useSidebarStore = create<SidebarStore>((set, get) => ({
  items: defaultItems,
  externalItems: [],
  pinnedItems: [],
  collapsedInitiatives: new Set<string>(),
  projectOrder: [],
  isEditing: false,
  loaded: false,

  load: async () => {
    const loadFromProfile = (profile: { sidebarConfig?: SidebarItem[]; pinnedSidebarItems?: PinnedSidebarItem[]; collapsedInitiatives?: string[]; projectOrder?: string[] } | null) => {
      const updates: Partial<SidebarStore> = { loaded: true }
      if (profile?.sidebarConfig) {
        updates.items = mergeWithDefaults(profile.sidebarConfig)
      }
      if (profile?.pinnedSidebarItems) {
        updates.pinnedItems = profile.pinnedSidebarItems
      }
      if (profile?.collapsedInitiatives) {
        updates.collapsedInitiatives = new Set(profile.collapsedInitiatives)
      }
      if (profile?.projectOrder) {
        updates.projectOrder = profile.projectOrder
      }
      set(updates)
    }

    // Try to get from already-loaded user profile store
    const profileState = useUserProfileStore.getState()
    if (profileState.loaded && profileState.profile) {
      loadFromProfile(profileState.profile)
      return
    }

    // Fallback: fetch profile directly
    try {
      const profile = await dataClient.getProfile()
      if (profile) {
        loadFromProfile(profile)
        return
      }
    } catch {
      // API unavailable
    }

    set({ loaded: true })
  },

  save: async () => {
    try {
      const { items, pinnedItems, collapsedInitiatives, projectOrder } = get()
      dataClient.updateProfile({
        sidebarConfig: items,
        pinnedSidebarItems: pinnedItems,
        collapsedInitiatives: Array.from(collapsedInitiatives),
        projectOrder,
      }).catch(() => {})
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

  pinItem: (id: string, type: 'project' | 'session') => {
    const pinnedItems = get().pinnedItems
    if (pinnedItems.some((p) => p.id === id)) return
    set({ pinnedItems: [...pinnedItems, { id, type }] })
    get().save()
  },

  unpinItem: (id: string) => {
    set({ pinnedItems: get().pinnedItems.filter((p) => p.id !== id) })
    get().save()
  },

  reorderPinnedItems: (startIndex: number, endIndex: number) => {
    const pinnedItems = [...get().pinnedItems]
    const [removed] = pinnedItems.splice(startIndex, 1)
    pinnedItems.splice(endIndex, 0, removed)
    set({ pinnedItems })
    get().save()
  },

  reorderProjectOrder: (fromId: string, toId: string) => {
    const order = [...get().projectOrder]
    const fromIdx = order.indexOf(fromId)
    const toIdx = order.indexOf(toId)
    if (fromIdx === -1 || toIdx === -1) return
    const [removed] = order.splice(fromIdx, 1)
    order.splice(toIdx, 0, removed)
    set({ projectOrder: order })
    get().save()
  },

  toggleInitiativeCollapse: (initiativeId: string) => {
    const collapsed = new Set(get().collapsedInitiatives)
    if (collapsed.has(initiativeId)) collapsed.delete(initiativeId)
    else collapsed.add(initiativeId)
    set({ collapsedInitiatives: collapsed })
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
