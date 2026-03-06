import { create } from "zustand"
import type { CommandItem, CommandHistory } from "@/types"

interface UIState {
  sidebarCollapsed: boolean
  chatPanelPosition: "bottom" | "right"
  chatPanelVisible: boolean
  commandPaletteOpen: boolean
  commandHistory: CommandHistory[]
  commandBreadcrumbs: CommandItem[]
  selectedCommands: string[]
  toggleSidebar: () => void
  toggleChatPanelPosition: () => void
  setChatPanelVisible: (visible: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
  addCommandToHistory: (commandId: string) => Promise<void>
  loadCommandHistory: () => Promise<void>
  setCommandBreadcrumbs: (breadcrumbs: CommandItem[]) => void
  setSelectedCommands: (ids: string[]) => void
  toggleCommandSelection: (id: string) => void
  clearCommandSelection: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  chatPanelPosition: "bottom",
  chatPanelVisible: true,
  commandPaletteOpen: false,
  commandHistory: [],
  commandBreadcrumbs: [],
  selectedCommands: [],

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  toggleChatPanelPosition: () =>
    set((s) => ({ chatPanelPosition: s.chatPanelPosition === "bottom" ? "right" : "bottom" })),

  setChatPanelVisible: (visible) => set({ chatPanelVisible: visible }),

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
  },

  loadCommandHistory: async () => {
    // Command history is now in-memory only (non-critical ephemeral data)
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
