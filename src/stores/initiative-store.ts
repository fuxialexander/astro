import { create } from "zustand"
import type { Initiative } from "@/types"
import { loadState, saveState } from "@/lib/db"
import { dataClient } from "@/lib/data-client"

interface InitiativeState {
  initiatives: Initiative[]
  loaded: boolean
  load: () => Promise<void>
  addInitiative: (initiative: Initiative) => void
  updateInitiative: (id: string, updates: Partial<Initiative>) => void
  deleteInitiative: (id: string) => void
}

// Seed data for demo purposes
const SEED_INITIATIVES: Initiative[] = []

export const useInitiativeStore = create<InitiativeState>((set, get) => ({
  initiatives: [],
  loaded: false,

  load: async () => {
    try {
      const initiatives = await dataClient.listInitiatives()
      set({ initiatives, loaded: true })
      // Update IndexedDB cache for offline fallback
      saveState("astro-initiatives", initiatives)
    } catch {
      // API unavailable — fall back to IndexedDB cache
      const saved = await loadState<Initiative[]>("astro-initiatives")
      if (saved) {
        set({
          initiatives: saved.map(i => ({
            ...i,
            createdAt: new Date(i.createdAt),
            updatedAt: new Date(i.updatedAt)
          })),
          loaded: true
        })
      } else {
        set({ initiatives: SEED_INITIATIVES, loaded: true })
      }
    }
  },

  addInitiative: (initiative) => {
    const next = [...get().initiatives, initiative]
    set({ initiatives: next })
    saveState("astro-initiatives", next)
    dataClient.createInitiative(initiative).catch(() => {})
  },

  updateInitiative: (id, updates) => {
    const next = get().initiatives.map((i) =>
      i.id === id ? { ...i, ...updates, updatedAt: new Date() } : i
    )
    set({ initiatives: next })
    saveState("astro-initiatives", next)
    dataClient.updateInitiative(id, updates).catch(() => {})
  },

  deleteInitiative: (id) => {
    const next = get().initiatives.filter((i) => i.id !== id)
    set({ initiatives: next })
    saveState("astro-initiatives", next)
    dataClient.deleteInitiative(id).catch(() => {})
  },
}))
