/**
 * Machines Store
 *
 * Manages registered machines for the current user.
 */

import { create } from 'zustand'
import { getSupabase, shouldUseSupabase } from '@/lib/supabase-client'
import { loadState, saveState, getBrowserUserId } from '@/lib/db'
import { useRealtimeStore } from './realtime-store'

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
  updateMachineStatus: (machineId: string, isConnected: boolean) => void
}

export const useMachinesStore = create<MachinesState>((set) => ({
  machines: [],
  loading: false,
  error: null,

  fetchMachines: async () => {
    set({ loading: true, error: null })
    try {
      const headers: Record<string, string> = {}

      if (shouldUseSupabase()) {
        // Supabase mode: use access token
        const supabase = getSupabase()
        if (!supabase) {
          throw new Error('Supabase not configured')
        }
        const { data: { session } } = await supabase.auth.getSession()

        if (!session?.access_token) {
          throw new Error('Not authenticated')
        }

        headers['Authorization'] = `Bearer ${session.access_token}`
      } else {
        // IndexedDB mode: use browser user ID
        const browserUserId = await getBrowserUserId()
        headers['X-User-Id'] = browserUserId
      }

      const response = await fetch('/api/device/machines', { headers })

      if (!response.ok) {
        throw new Error('Failed to fetch machines')
      }
      const data = await response.json()
      const machines = data.machines || []
      set({ machines, loading: false })
      // Update IndexedDB cache for offline fallback
      saveState('astro-machines', machines)
    } catch (err) {
      // API unavailable — fall back to IndexedDB cache
      const cached = await loadState<RegisteredMachine[]>('astro-machines')
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
      const headers: Record<string, string> = {}

      if (shouldUseSupabase()) {
        const supabase = getSupabase()
        if (!supabase) {
          throw new Error('Supabase not configured')
        }
        const { data: { session } } = await supabase.auth.getSession()

        if (!session?.access_token) {
          throw new Error('Not authenticated')
        }

        headers['Authorization'] = `Bearer ${session.access_token}`
      } else {
        // IndexedDB mode: use browser user ID
        const browserUserId = await getBrowserUserId()
        headers['X-User-Id'] = browserUserId
      }

      const response = await fetch(`/api/device/machines/${machineId}`, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        throw new Error('Failed to revoke machine')
      }
      // Remove from local state
      set((state) => {
        const nextMachines = state.machines.filter((m) => m.id !== machineId)
        // Update IndexedDB cache
        saveState('astro-machines', nextMachines)
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (shouldUseSupabase()) {
        const supabase = getSupabase()
        if (!supabase) {
          throw new Error('Supabase not configured')
        }
        const { data: { session } } = await supabase.auth.getSession()

        if (!session?.access_token) {
          throw new Error('Not authenticated')
        }

        headers['Authorization'] = `Bearer ${session.access_token}`
      } else {
        // IndexedDB mode: use browser user ID
        const browserUserId = await getBrowserUserId()
        headers['X-User-Id'] = browserUserId
      }

      const response = await fetch(`/api/device/machines/${machineId}`, {
        method: 'PATCH',
        headers,
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
        saveState('astro-machines', nextMachines)
        return { machines: nextMachines }
      })
      // Also update the realtime store's live machine entry if connected
      const realtimeState = useRealtimeStore.getState()
      const liveMachine = realtimeState.machines.get(machineId)
      if (liveMachine) {
        const updatedMachines = new Map(realtimeState.machines)
        updatedMachines.set(machineId, { ...liveMachine, name })
        useRealtimeStore.setState({ machines: updatedMachines })
      }
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
      return false
    }
  },

  updateMachineStatus: (machineId: string, isConnected: boolean) => {
    set((state) => {
      const machine = state.machines.find((m) => m.id === machineId)
      if (!machine) return state

      const nextMachines = state.machines.map((m) =>
        m.id === machineId
          ? { ...m, isConnected, lastSeenAt: new Date().toISOString() }
          : m
      )
      // Update IndexedDB cache
      saveState('astro-machines', nextMachines)
      return { machines: nextMachines }
    })
  },
}))
