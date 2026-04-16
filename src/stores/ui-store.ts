import { create } from "zustand"
import type { CommandItem, CommandHistory } from "@/types"
import { isDesktop } from "@/lib/desktop-detect"
import { PANEL_META } from "@/components/panes/panel-meta"

export type RightPanelKind = 'chat' | 'plan-graph' | 'file-browser' | 'git' | 'terminal'
const ALL_RIGHT_PANELS: RightPanelKind[] = ['chat', 'plan-graph', 'file-browser', 'git', 'terminal']

function loadRightPanelStack(): RightPanelKind[] {
  try {
    const stored = localStorage.getItem("astro-right-panel-stack")
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    const desktop = isDesktop()
    return parsed.filter((k): k is RightPanelKind =>
      typeof k === 'string'
      && (ALL_RIGHT_PANELS as string[]).includes(k)
      && (desktop || !PANEL_META[k as RightPanelKind]?.desktopOnly),
    )
  } catch {
    return []
  }
}

interface UIState {
  sidebarCollapsed: boolean
  sidebarWidth: number
  isSidebarResizing: boolean
  setIsSidebarResizing: (v: boolean) => void
  dockviewVisible: boolean
  dockviewWidth: number
  rightPanelStack: RightPanelKind[]
  chatPanelPosition: "bottom" | "right"
  chatPanelVisible: boolean
  commandPaletteOpen: boolean
  commandHistory: CommandHistory[]
  commandBreadcrumbs: CommandItem[]
  selectedCommands: string[]
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setDockviewVisible: (visible: boolean) => void
  toggleDockviewVisible: () => void
  setDockviewWidth: (width: number) => void
  toggleRightPanel: (kind: RightPanelKind) => void
  closeRightPanel: (kind: RightPanelKind) => void
  clearRightPanels: () => void
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

function persistRightPanelStack(stack: RightPanelKind[]): void {
  try { localStorage.setItem("astro-right-panel-stack", JSON.stringify(stack)) } catch { /* localStorage unavailable */ }
}

export const useUIStore = create<UIState>((set, get) => ({
  isSidebarResizing: false,
  setIsSidebarResizing: (v) => set({ isSidebarResizing: v }),
  sidebarCollapsed: false,
  sidebarWidth: (() => {
    try {
      const stored = localStorage.getItem("astro-sidebar-width")
      if (!stored) return 260
      const n = Number(stored)
      return Number.isFinite(n) ? Math.max(200, Math.min(480, n)) : 260
    } catch { return 260 /* localStorage unavailable */ }
  })(),
  dockviewVisible: (() => {
    try {
      return localStorage.getItem("astro-dockview-visible") === "1"
    } catch { return false }
  })(),
  dockviewWidth: (() => {
    try {
      const stored = localStorage.getItem("astro-dockview-width")
      if (!stored) return 420
      const n = Number(stored)
      return Number.isFinite(n) ? Math.max(320, Math.min(1600, n)) : 420
    } catch { return 420 }
  })(),
  rightPanelStack: loadRightPanelStack(),
  chatPanelPosition: "right",
  chatPanelVisible: true,
  commandPaletteOpen: false,
  commandHistory: [],
  commandBreadcrumbs: [],
  selectedCommands: [],

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setSidebarWidth: (width: number) => {
    const clamped = Math.max(200, Math.min(480, width))
    set({ sidebarWidth: clamped })
    try { localStorage.setItem("astro-sidebar-width", String(clamped)) } catch { /* localStorage unavailable */ }
  },

  setDockviewVisible: (visible) => {
    set({ dockviewVisible: visible })
    try { localStorage.setItem("astro-dockview-visible", visible ? "1" : "0") } catch { /* localStorage unavailable */ }
  },

  toggleDockviewVisible: () => {
    const next = !get().dockviewVisible
    set({ dockviewVisible: next })
    try { localStorage.setItem("astro-dockview-visible", next ? "1" : "0") } catch { /* localStorage unavailable */ }
  },

  setDockviewWidth: (width: number) => {
    const clamped = Math.max(320, Math.min(1600, width))
    set({ dockviewWidth: clamped })
    try { localStorage.setItem("astro-dockview-width", String(clamped)) } catch { /* localStorage unavailable */ }
  },

  toggleRightPanel: (kind) => {
    const { rightPanelStack } = get()
    const next = rightPanelStack.includes(kind)
      ? rightPanelStack.filter((k) => k !== kind)
      : [...rightPanelStack, kind]
    set({ rightPanelStack: next })
    persistRightPanelStack(next)
  },

  closeRightPanel: (kind) => {
    const { rightPanelStack } = get()
    if (!rightPanelStack.includes(kind)) return
    const next = rightPanelStack.filter((k) => k !== kind)
    set({ rightPanelStack: next })
    persistRightPanelStack(next)
  },

  clearRightPanels: () => {
    set({ rightPanelStack: [] })
    persistRightPanelStack([])
  },

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
