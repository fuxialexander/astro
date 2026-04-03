/**
 * Layout store — panel sizes, visibility, active panel.
 * Persisted to localStorage under 'astro-desktop-layout'.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ActivePanel = 'sidebar' | 'main' | 'review'

const DEFAULT_SIDEBAR_WIDTH = 280
const DEFAULT_REVIEW_WIDTH = 400
const DEFAULT_TERMINAL_HEIGHT = 260
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 600
const MIN_REVIEW_WIDTH = 200
const MAX_REVIEW_WIDTH = 800
const MIN_TERMINAL_HEIGHT = 120
const MAX_TERMINAL_HEIGHT = 800

interface LayoutState {
  sidebarWidth: number
  reviewWidth: number
  terminalHeight: number
  sidebarOpen: boolean
  reviewOpen: boolean
  terminalOpen: boolean
  activePanel: ActivePanel
  commandPaletteOpen: boolean
  /** Active workspace tab */
  workspaceTab: 'chat' | 'plan'
  /** Diff stats from the active project's working directory */
  diffAdditions: number
  diffDeletions: number

  setSidebarWidth: (w: number) => void
  setReviewWidth: (w: number) => void
  setTerminalHeight: (h: number) => void
  setSidebarOpen: (open: boolean) => void
  setReviewOpen: (open: boolean) => void
  setTerminalOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleReview: () => void
  toggleTerminal: () => void
  setActivePanel: (panel: ActivePanel) => void
  resetPanelSizes: () => void
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  setDiffStats: (additions: number, deletions: number) => void
  setWorkspaceTab: (tab: 'chat' | 'plan') => void
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      reviewWidth: DEFAULT_REVIEW_WIDTH,
      terminalHeight: DEFAULT_TERMINAL_HEIGHT,
      sidebarOpen: true,
      reviewOpen: false,
      terminalOpen: false,
      activePanel: 'main',
      commandPaletteOpen: false,
      workspaceTab: 'chat',
      diffAdditions: 0,
      diffDeletions: 0,

      setSidebarWidth: (w) =>
        set({ sidebarWidth: Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, w)) }),

      setReviewWidth: (w) =>
        set({ reviewWidth: Math.max(MIN_REVIEW_WIDTH, Math.min(MAX_REVIEW_WIDTH, w)) }),

      setTerminalHeight: (h) =>
        set({ terminalHeight: Math.max(MIN_TERMINAL_HEIGHT, Math.min(MAX_TERMINAL_HEIGHT, h)) }),

      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setReviewOpen: (reviewOpen) => set({ reviewOpen }),
      setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleReview: () => set((s) => ({ reviewOpen: !s.reviewOpen })),
      toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
      setActivePanel: (activePanel) => set({ activePanel }),

      resetPanelSizes: () =>
        set({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, reviewWidth: DEFAULT_REVIEW_WIDTH }),

      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      toggleCommandPalette: () =>
        set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      setDiffStats: (diffAdditions, diffDeletions) => set({ diffAdditions, diffDeletions }),
      setWorkspaceTab: (workspaceTab) => set({ workspaceTab }),
    }),
    {
      name: 'astro-desktop-layout',
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        reviewWidth: s.reviewWidth,
        terminalHeight: s.terminalHeight,
        sidebarOpen: s.sidebarOpen,
        reviewOpen: s.reviewOpen,
        terminalOpen: s.terminalOpen,
      }),
    },
  ),
)
