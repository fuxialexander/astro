/**
 * Layout store — panel sizes, visibility, active panel.
 * Persisted to localStorage under 'astro-desktop-layout'.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ActivePanel = 'sidebar' | 'main' | 'review'

const DEFAULT_SIDEBAR_WIDTH = 280
const DEFAULT_REVIEW_WIDTH = 400
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 600
const MIN_REVIEW_WIDTH = 200
const MAX_REVIEW_WIDTH = 800

interface LayoutState {
  sidebarWidth: number
  reviewWidth: number
  sidebarOpen: boolean
  reviewOpen: boolean
  activePanel: ActivePanel
  commandPaletteOpen: boolean

  setSidebarWidth: (w: number) => void
  setReviewWidth: (w: number) => void
  setSidebarOpen: (open: boolean) => void
  setReviewOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleReview: () => void
  setActivePanel: (panel: ActivePanel) => void
  resetPanelSizes: () => void
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      reviewWidth: DEFAULT_REVIEW_WIDTH,
      sidebarOpen: true,
      reviewOpen: false,
      activePanel: 'main',
      commandPaletteOpen: false,

      setSidebarWidth: (w) =>
        set({ sidebarWidth: Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, w)) }),

      setReviewWidth: (w) =>
        set({ reviewWidth: Math.max(MIN_REVIEW_WIDTH, Math.min(MAX_REVIEW_WIDTH, w)) }),

      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setReviewOpen: (reviewOpen) => set({ reviewOpen }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleReview: () => set((s) => ({ reviewOpen: !s.reviewOpen })),
      setActivePanel: (activePanel) => set({ activePanel }),

      resetPanelSizes: () =>
        set({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, reviewWidth: DEFAULT_REVIEW_WIDTH }),

      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      toggleCommandPalette: () =>
        set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
    }),
    {
      name: 'astro-desktop-layout',
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        reviewWidth: s.reviewWidth,
        sidebarOpen: s.sidebarOpen,
        reviewOpen: s.reviewOpen,
      }),
    },
  ),
)
