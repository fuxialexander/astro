import { create } from "zustand"
import type { Initiative } from "@/types"
import { dataClient } from "@/lib/data-client"

interface InitiativeState {
  initiatives: Initiative[]
  loaded: boolean
  loading: boolean
  error: string | null
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
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const initiatives = await dataClient.listInitiatives()
      set({ initiatives, loaded: true, loading: false })
    } catch (err) {
      set({ initiatives: SEED_INITIATIVES, loaded: true, loading: false, error: err instanceof Error ? err.message : 'Failed to load initiatives' })
    }
  },

  addInitiative: (initiative) => {
    const next = [...get().initiatives, initiative]
    set({ initiatives: next })
    dataClient.createInitiative(initiative).catch(() => {})
  },

  updateInitiative: (id, updates) => {
    const next = get().initiatives.map((i) =>
      i.id === id ? { ...i, ...updates, updatedAt: new Date() } : i
    )
    set({ initiatives: next })
    dataClient.updateInitiative(id, updates).catch(() => {})
  },

  deleteInitiative: (id) => {
    const next = get().initiatives.filter((i) => i.id !== id)
    set({ initiatives: next })
    dataClient.deleteInitiative(id).catch(() => {})
  },
}))
