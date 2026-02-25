/**
 * Core TUI state: mode, focus, selection, connection status.
 */
import { create } from 'zustand'
import type { VimMode } from '../lib/vim-state-machine.js'

export type PanelId = 'projects' | 'plan' | 'machines' | 'output'

const PANEL_ORDER: PanelId[] = ['projects', 'plan', 'machines', 'output']

export interface TuiState {
  // Vim mode
  mode: VimMode
  commandBuffer: string
  searchQuery: string
  pendingKeys: string

  // Panel focus
  focusedPanel: PanelId
  panelOrder: PanelId[]

  // Selection
  selectedProjectId: string | null
  selectedNodeId: string | null
  selectedMachineId: string | null
  selectedExecutionId: string | null

  // Scroll positions per panel
  scrollIndex: Record<PanelId, number>

  // Overlay state
  showHelp: boolean
  showSearch: boolean
  showDetail: boolean
  detailType: 'project' | 'node' | 'machine' | 'execution' | null
  detailId: string | null

  // Connection
  connected: boolean
  machineCount: number
  todayCost: number

  // Error
  lastError: string | null
}

export interface TuiActions {
  setMode: (mode: VimMode) => void
  setCommandBuffer: (buf: string) => void
  setSearchQuery: (q: string) => void
  setPendingKeys: (keys: string) => void

  focusPanel: (panel: PanelId) => void
  focusNext: () => void
  focusPrev: () => void
  focusByIndex: (idx: number) => void

  setSelectedProject: (id: string | null) => void
  setSelectedNode: (id: string | null) => void
  setSelectedMachine: (id: string | null) => void
  setSelectedExecution: (id: string | null) => void

  scrollUp: (panel?: PanelId) => void
  scrollDown: (panel?: PanelId, max?: number) => void
  scrollToTop: (panel?: PanelId) => void
  scrollToBottom: (panel?: PanelId, max?: number) => void
  pageUp: (panel?: PanelId, pageSize?: number) => void
  pageDown: (panel?: PanelId, max?: number, pageSize?: number) => void

  toggleHelp: () => void
  toggleSearch: () => void
  openDetail: (type: 'project' | 'node' | 'machine' | 'execution', id: string) => void
  closeDetail: () => void
  closeOverlays: () => void

  setConnected: (v: boolean) => void
  setMachineCount: (n: number) => void
  setTodayCost: (n: number) => void
  setLastError: (e: string | null) => void
}

export const useTuiStore = create<TuiState & TuiActions>((set, get) => ({
  mode: 'normal',
  commandBuffer: '',
  searchQuery: '',
  pendingKeys: '',

  focusedPanel: 'projects',
  panelOrder: PANEL_ORDER,

  selectedProjectId: null,
  selectedNodeId: null,
  selectedMachineId: null,
  selectedExecutionId: null,

  scrollIndex: { projects: 0, plan: 0, machines: 0, output: 0 },

  showHelp: false,
  showSearch: false,
  showDetail: false,
  detailType: null,
  detailId: null,

  connected: false,
  machineCount: 0,
  todayCost: 0,

  lastError: null,

  setMode: (mode) => set({ mode }),
  setCommandBuffer: (commandBuffer) => set({ commandBuffer }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setPendingKeys: (pendingKeys) => set({ pendingKeys }),

  focusPanel: (panel) => set({ focusedPanel: panel }),
  focusNext: () => {
    const { focusedPanel, panelOrder } = get()
    const idx = panelOrder.indexOf(focusedPanel)
    set({ focusedPanel: panelOrder[(idx + 1) % panelOrder.length] })
  },
  focusPrev: () => {
    const { focusedPanel, panelOrder } = get()
    const idx = panelOrder.indexOf(focusedPanel)
    set({ focusedPanel: panelOrder[(idx - 1 + panelOrder.length) % panelOrder.length] })
  },
  focusByIndex: (idx) => {
    const { panelOrder } = get()
    if (idx >= 0 && idx < panelOrder.length) {
      set({ focusedPanel: panelOrder[idx] })
    }
  },

  setSelectedProject: (selectedProjectId) => set({ selectedProjectId }),
  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  setSelectedMachine: (selectedMachineId) => set({ selectedMachineId }),
  setSelectedExecution: (selectedExecutionId) => set({ selectedExecutionId }),

  scrollUp: (panel) => {
    const p = panel ?? get().focusedPanel
    set((s) => ({
      scrollIndex: { ...s.scrollIndex, [p]: Math.max(0, s.scrollIndex[p] - 1) },
    }))
  },
  scrollDown: (panel, max) => {
    const p = panel ?? get().focusedPanel
    set((s) => ({
      scrollIndex: {
        ...s.scrollIndex,
        [p]: max != null ? Math.min(max - 1, s.scrollIndex[p] + 1) : s.scrollIndex[p] + 1,
      },
    }))
  },
  scrollToTop: (panel) => {
    const p = panel ?? get().focusedPanel
    set((s) => ({
      scrollIndex: { ...s.scrollIndex, [p]: 0 },
    }))
  },
  scrollToBottom: (panel, max) => {
    const p = panel ?? get().focusedPanel
    if (max != null && max > 0) {
      set((s) => ({
        scrollIndex: { ...s.scrollIndex, [p]: max - 1 },
      }))
    }
  },
  pageUp: (panel, pageSize = 10) => {
    const p = panel ?? get().focusedPanel
    set((s) => ({
      scrollIndex: { ...s.scrollIndex, [p]: Math.max(0, s.scrollIndex[p] - pageSize) },
    }))
  },
  pageDown: (panel, max, pageSize = 10) => {
    const p = panel ?? get().focusedPanel
    set((s) => ({
      scrollIndex: {
        ...s.scrollIndex,
        [p]: max != null ? Math.min(max - 1, s.scrollIndex[p] + pageSize) : s.scrollIndex[p] + pageSize,
      },
    }))
  },

  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp, showSearch: false })),
  toggleSearch: () => set((s) => ({ showSearch: !s.showSearch, showHelp: false })),
  openDetail: (type, id) => set({ showDetail: true, detailType: type, detailId: id, showHelp: false, showSearch: false }),
  closeDetail: () => set({ showDetail: false, detailType: null, detailId: null }),
  closeOverlays: () => set({ showHelp: false, showSearch: false, showDetail: false, detailType: null, detailId: null }),

  setConnected: (connected) => set({ connected }),
  setMachineCount: (machineCount) => set({ machineCount }),
  setTodayCost: (todayCost) => set({ todayCost }),
  setLastError: (lastError) => set({ lastError }),
}))
