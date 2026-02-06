/**
 * Machines Store
 *
 * Manages registered machines for the current user.
 */

import { create } from 'zustand'

export interface RegisteredMachine {
  id: string
  name: string
  hostname: string
  platform: string
  environmentType: 'local' | 'hpc' | 'cloud'
  providers: string[]
  registeredAt: string
  lastSeenAt: string
  isConnected: boolean
  isRevoked: boolean
}

interface MachinesState {
  machines: RegisteredMachine[]
  loading: boolean
  error: string | null

  // Actions
  fetchMachines: (userId: string) => Promise<void>
  revokeMachine: (machineId: string) => Promise<boolean>
  renameMachine: (machineId: string, name: string) => Promise<boolean>
}

export const useMachinesStore = create<MachinesState>((set) => ({
  machines: [],
  loading: false,
  error: null,

  fetchMachines: async (userId: string) => {
    set({ loading: true, error: null })
    try {
      const response = await fetch(`/api/device/machines?userId=${encodeURIComponent(userId)}`)
      if (!response.ok) {
        throw new Error('Failed to fetch machines')
      }
      const data = await response.json()
      set({ machines: data.machines || [], loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error', loading: false })
    }
  },

  revokeMachine: async (machineId: string) => {
    try {
      const response = await fetch(`/api/device/machines/${machineId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error('Failed to revoke machine')
      }
      // Remove from local state
      set((state) => ({
        machines: state.machines.filter((m) => m.id !== machineId),
      }))
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
      return false
    }
  },

  renameMachine: async (machineId: string, name: string) => {
    try {
      const response = await fetch(`/api/device/machines/${machineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) {
        throw new Error('Failed to rename machine')
      }
      // Update local state
      set((state) => ({
        machines: state.machines.map((m) =>
          m.id === machineId ? { ...m, name } : m
        ),
      }))
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
      return false
    }
  },
}))
