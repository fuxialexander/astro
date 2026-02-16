import { create } from "zustand"
import { get as idbGet, set as idbSet } from "idb-keyval"
import { getSupabase, shouldUseSupabase } from "@/lib/supabase-client"

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
}

const defaultItems: SidebarItem[] = [
  { id: "tasks", to: "/", icon: "CheckSquare", label: "Tasks", visible: true, protected: true },
  { id: "projects", to: "/projects", icon: "GitBranch", label: "Projects", visible: true, protected: false },
  { id: "environments", to: "/environments", icon: "Terminal", label: "Environments", visible: true, protected: true },
  { id: "dashboard", to: "/dashboard", icon: "Radio", label: "Dashboard", visible: false, protected: false },
  { id: "initiatives", to: "/initiatives", icon: "Target", label: "Initiatives", visible: false, protected: false },
  { id: "agents", to: "/agents", icon: "Cpu", label: "Agents", visible: false, protected: false },
]

export const useSidebarStore = create<SidebarStore>((set, get) => ({
  items: defaultItems,
  isEditing: false,
  loaded: false,

  load: async () => {
    try {
      let stored: SidebarItem[] | null | undefined = null

      // Try Supabase first (multi-device sync)
      const supabase = getSupabase()
      if (supabase && shouldUseSupabase()) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data, error } = await supabase
            .from("user_profiles")
            .select("sidebar_config")
            .eq("id", user.id)
            .single()

          if (!error && data?.sidebar_config) {
            stored = data.sidebar_config as SidebarItem[]
          }
        }
      }

      // Fallback to IndexedDB (local-only mode or no Supabase data)
      if (!stored) {
        stored = await idbGet<SidebarItem[]>("sidebar-items")
      }

      if (stored) {
        // Merge stored items with defaults (in case new items were added)
        const merged = defaultItems.map((defaultItem) => {
          const storedItem = stored!.find((s) => s.id === defaultItem.id)
          return storedItem || defaultItem
        })
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
      await idbSet("sidebar-items", items)

      // Save to Supabase (multi-device sync)
      const supabase = getSupabase()
      if (supabase && shouldUseSupabase()) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { error } = await supabase
            .from("user_profiles")
            .update({ sidebar_config: items })
            .eq("id", user.id)

          if (error) {
            console.error("[SidebarStore] Failed to save to Supabase:", error)
          }
        }
      }
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
    const supabase = getSupabase()
    if (!supabase || !shouldUseSupabase()) {
      return () => {} // No-op in IndexedDB-only mode
    }

    // Get current user ID synchronously if possible
    let userId: string | undefined
    supabase.auth.getUser().then((r) => {
      userId = r.data.user?.id
    })

    const channel = supabase
      .channel("sidebar-config-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "user_profiles",
        },
        (payload: { new: { id: string; sidebar_config: unknown } }) => {
          // Only process updates for the current user
          if (payload.new.id === userId) {
            const newConfig = payload.new.sidebar_config as SidebarItem[] | null
            if (newConfig) {
              // Merge with defaults to handle new items
              const merged = defaultItems.map((defaultItem) => {
                const storedItem = newConfig.find((s) => s.id === defaultItem.id)
                return storedItem || defaultItem
              })
              set({ items: merged })
              // Also save to IndexedDB for offline access
              idbSet("sidebar-items", merged).catch(console.error)
            }
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  },
}))
