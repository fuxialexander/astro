/**
 * Machines Store
 *
 * Manages registered machines for the current user.
 * Uses the same auth pattern as data-client.ts — works in both local and server mode.
 */

import { create } from 'zustand'
import { getAccessToken } from '@/lib/supabase-client'
import { apiUrl } from '@/lib/api-url'
import { getActiveTeamId } from '@/lib/api-client'
import { useRealtimeStore } from './realtime-store'

export interface ProviderConfig {
  provider: string
  apiKey?: string
  defaultModel?: string
  enabled: boolean
  settings?: Record<string, unknown>
}

export interface RegisteredMachine {
  id: string
  name: string
  hostname: string
  platform: string
  providers: string[]
  providerConfigs?: ProviderConfig[]
  defaultInstructionId?: string | null
  registeredAt: string
  lastSeenAt: string
  isConnected: boolean
  isRevoked: boolean
  teamId?: string | null
  teamIds?: string[]
  userId?: string
}

interface MachinesState {
  machines: RegisteredMachine[]
  teamMachines: RegisteredMachine[]
  loading: boolean
  error: string | null

  // Actions
  fetchMachines: () => Promise<void>
  fetchTeamMachines: () => Promise<void>
  revokeMachine: (machineId: string) => Promise<boolean>
  renameMachine: (machineId: string, name: string) => Promise<boolean>
  updateMachineProviderConfigs: (machineId: string, configs: ProviderConfig[]) => Promise<boolean>
  updateMachineStatus: (machineId: string, isConnected: boolean) => void
  shareMachine: (machineId: string, shared: boolean) => Promise<boolean>
}

/**
 * Build auth headers for device API calls.
 * In server mode, includes the Supabase access token.
 * In local mode, the server's requireAuth middleware uses the fixed local user.
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  const token = await getAccessToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const teamId = getActiveTeamId()
  if (teamId) {
    headers['X-Team-Id'] = teamId
  }
  return headers
}

export const useMachinesStore = create<MachinesState>((set) => ({
  machines: [],
  teamMachines: [],
  loading: false,
  error: null,

  fetchMachines: async () => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl('/api/device/machines'), { headers })

      if (!response.ok) {
        throw new Error('Failed to fetch machines')
      }
      const data = await response.json()
      const machines = data.machines || []
      set({ machines, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error', loading: false })
    }
  },

  fetchTeamMachines: async () => {
    try {
      const teamId = getActiveTeamId()
      if (!teamId) {
        set({ teamMachines: [] })
        return
      }
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl(`/api/device/team-machines?teamId=${encodeURIComponent(teamId)}`), { headers })
      if (!response.ok) throw new Error('Failed to fetch team machines')
      const data = await response.json()
      set({ teamMachines: data.machines || [] })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  },

  shareMachine: async (machineId: string, shared: boolean): Promise<boolean> => {
    try {
      const teamId = getActiveTeamId()
      if (shared && !teamId) {
        throw new Error('Select a workspace before sharing a machine')
      }
      const headers = await getAuthHeaders()
      headers['Content-Type'] = 'application/json'
      const response = await fetch(apiUrl(`/api/device/machines/${machineId}/share`), {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ shared, teamId: shared ? teamId : null }),
      })
      if (!response.ok) throw new Error('Failed to update machine sharing')
      const data = await response.json()
      // Update local state — reflect new teamIds
      const teamIds = (data.teamIds as string[]) ?? []
      set((state) => ({
        machines: state.machines.map((m) =>
          m.id === machineId ? { ...m, teamId: teamIds[0] ?? null, teamIds } : m
        ),
      }))
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
      return false
    }
  },

  revokeMachine: async (machineId: string): Promise<boolean> => {
    try {
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl(`/api/device/machines/${machineId}`), {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        throw new Error('Failed to revoke machine')
      }
      // Remove from local state
      set((state) => {
        const nextMachines = state.machines.filter((m) => m.id !== machineId)
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
      const headers = await getAuthHeaders()
      headers['Content-Type'] = 'application/json'

      const response = await fetch(apiUrl(`/api/device/machines/${machineId}`), {
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

  updateMachineProviderConfigs: async (machineId: string, configs: ProviderConfig[]): Promise<boolean> => {
    try {
      const headers = await getAuthHeaders()
      headers['Content-Type'] = 'application/json'

      const response = await fetch(apiUrl(`/api/device/machines/${machineId}`), {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ providerConfigs: configs }),
      })
      if (!response.ok) {
        throw new Error('Failed to update provider configs')
      }
      // Update local state
      set((state) => {
        const nextMachines = state.machines.map((m) =>
          m.id === machineId ? { ...m, providerConfigs: configs } : m
        )
        return { machines: nextMachines }
      })
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
      return { machines: nextMachines }
    })
  },
}))
