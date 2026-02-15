import { create } from "zustand"
import type { CommandItem, CommandHistory } from "@/types"
import { get as idbGet, set as idbSet } from "idb-keyval"

interface UIState {
  sidebarCollapsed: boolean
  commandPaletteOpen: boolean
  commandHistory: CommandHistory[]
  commandBreadcrumbs: CommandItem[]
  selectedCommands: string[]
  toggleSidebar: () => void
  setCommandPaletteOpen: (open: boolean) => void
  addCommandToHistory: (commandId: string) => Promise<void>
  loadCommandHistory: () => Promise<void>
  setCommandBreadcrumbs: (breadcrumbs: CommandItem[]) => void
  setSelectedCommands: (ids: string[]) => void
  toggleCommandSelection: (id: string) => void
  clearCommandSelection: () => void
}

const COMMAND_HISTORY_KEY = "nexus:command-history"

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  commandPaletteOpen: false,
  commandHistory: [],
  commandBreadcrumbs: [],
  selectedCommands: [],

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  addCommandToHistory: async (commandId: string) => {
    const { commandHistory } = get()
    const existing = commandHistory.find((h) => h.commandId === commandId)

    let newHistory: CommandHistory[]
    if (existing) {
      // Update frequency and timestamp
      newHistory = commandHistory.map((h) =>
        h.commandId === commandId
          ? { ...h, executedAt: new Date(), frequency: h.frequency + 1 }
          : h
      )
    } else {
      // Add new entry
      newHistory = [
        ...commandHistory,
        { commandId, executedAt: new Date(), frequency: 1 },
      ]
    }

    // Keep only last 100 items, sorted by recency
    newHistory = newHistory
      .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())
      .slice(0, 100)

    set({ commandHistory: newHistory })
    await idbSet(COMMAND_HISTORY_KEY, newHistory)
  },

  loadCommandHistory: async () => {
    try {
      const history = await idbGet<CommandHistory[]>(COMMAND_HISTORY_KEY)
      if (history) {
        // Rehydrate dates
        const rehydrated = history.map((h) => ({
          ...h,
          executedAt: new Date(h.executedAt),
        }))
        set({ commandHistory: rehydrated })
      }
    } catch (error) {
      console.error("Failed to load command history:", error)
    }
  },

  setCommandBreadcrumbs: (breadcrumbs) => set({ commandBreadcrumbs: breadcrumbs }),

  setSelectedCommands: (ids) => set({ selectedCommands: ids }),

  toggleCommandSelection: (id) => {
    const { selectedCommands } = get()
    if (selectedCommands.includes(id)) {
      set({ selectedCommands: selectedCommands.filter((i) => i !== id) })
    } else {
      set({ selectedCommands: [...selectedCommands, id] })
    }
  },

  clearCommandSelection: () => set({ selectedCommands: [] }),
}))
