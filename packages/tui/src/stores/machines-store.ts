/**
 * Machines store. Updated via SSE events + polling.
 */
import { create } from 'zustand'
import type { Machine } from '../client-adapter.js'

export interface MachinesState {
  machines: Machine[]
  loading: boolean
  error: string | null
}

export interface MachinesActions {
  setMachines: (machines: Machine[]) => void
  updateMachine: (id: string, patch: Partial<Machine>) => void
  removeMachine: (id: string) => void
  addMachine: (machine: Machine) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useMachinesStore = create<MachinesState & MachinesActions>((set, get) => ({
  machines: [],
  loading: false,
  error: null,

  setMachines: (machines) => set({ machines, loading: false, error: null }),

  updateMachine: (id, patch) => {
    set((s) => ({
      machines: s.machines.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }))
  },

  removeMachine: (id) => {
    set((s) => ({ machines: s.machines.filter((m) => m.id !== id) }))
  },

  addMachine: (machine) => {
    const { machines } = get()
    const existing = machines.findIndex((m) => m.id === machine.id)
    if (existing >= 0) {
      set({ machines: machines.map((m, i) => (i === existing ? machine : m)) })
    } else {
      set({ machines: [...machines, machine] })
    }
  },

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
}))
