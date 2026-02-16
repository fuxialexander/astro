/**
 * Machines Store
 *
 * Manages registered machines for the current user.
 */

import { create } from 'zustand'
import { getSupabase } from '@/lib/supabase-client'
import { loadState, saveState } from '@/lib/db'

export interface RegisteredMachine {
  id: string
  name: string
  hostname: string
  platform: string
  environmentType: 'local' | 'remote' | 'hpc' | 'cloud'
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
  fetchMachines: () => Promise<void>
  revokeMachine: (machineId: string) => Promise<boolean>
  renameMachine: (machineId: string, name: string) => Promise<boolean>
}

export const useMachinesStore = create<MachinesState>((set) => ({
  machines: [],
  loading: false,
  error: null,

  fetchMachines: async () => {
    set({ loading: true, error: null })
    try {
      // Get auth token from Supabase session
      const supabase = getSupabase()
      if (!supabase) {
        // No Supabase configured — fall back to IndexedDB cache
        const cached = await loadState<RegisteredMachine[]>('nexus-machines')
        if (cached) {
          set({
            machines: cached.map((m) => ({
              ...m,
              registeredAt: m.registeredAt,
              lastSeenAt: m.lastSeenAt,
            })),
            loading: false,
          })
        } else {
          set({ machines: [], loading: false })
        }
        return
      }
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.access_token) {
        throw new Error('Not authenticated')
      }

      const response = await fetch('/api/device/machines', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      })
      if (!response.ok) {
        throw new Error('Failed to fetch machines')
      }
      const data = await response.json()
      const machines = data.machines || []
      set({ machines, loading: false })
      // Update IndexedDB cache for offline fallback
      saveState('nexus-machines', machines)
    } catch (err) {
      // API unavailable — fall back to IndexedDB cache
      const cached = await loadState<RegisteredMachine[]>('nexus-machines')
      if (cached) {
        set({
          machines: cached.map((m) => ({
            ...m,
            registeredAt: m.registeredAt,
            lastSeenAt: m.lastSeenAt,
          })),
          loading: false,
          error: null, // Clear error on successful cache fallback
        })
      } else {
        set({ error: err instanceof Error ? err.message : 'Unknown error', loading: false })
      }
    }
  },

  revokeMachine: async (machineId: string): Promise<boolean> => {
    try {
      const supabase = getSupabase()
      if (!supabase) {
        console.warn('Cannot revoke machine: Supabase not configured')
        return false
      }
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.access_token) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`/api/device/machines/${machineId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      })
      if (!response.ok) {
        throw new Error('Failed to revoke machine')
      }
      // Remove from local state
      set((state) => {
        const nextMachines = state.machines.filter((m) => m.id !== machineId)
        // Update IndexedDB cache
        saveState('nexus-machines', nextMachines)
        return { machines: nextMachines }
      })
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
      return false
    }
  },

  renameMachine: async (machineId: string, name: string): Promise<boolean> => {
    try {
      const supabase = getSupabase()
      if (!supabase) {
        console.warn('Cannot rename machine: Supabase not configured')
        return false
      }
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.access_token) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`/api/device/machines/${machineId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) {
        throw new Error('Failed to rename machine')
      }
      // Update local state
      set((state) => {
        const nextMachines = state.machines.map((m) =>
          m.id === machineId ? { ...m, name } : m
        )
        // Update IndexedDB cache
        saveState('nexus-machines', nextMachines)
        return { machines: nextMachines }
      })
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
      return false
    }
  },
}))
