/**
 * Machine Instructions Store
 *
 * Manages machine instruction documents — shared markdown docs that tell
 * AI agents how to run computation on specific environments.
 * CRUD via /api/machine-instructions.
 */

import { create } from 'zustand'
import { getAccessToken } from '@/lib/supabase-client'
import { apiUrl } from '@/lib/api-url'
import { useMachinesStore } from '@/stores/machines-store'
import type { MachineInstruction } from '@/types'

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = await getAccessToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v
  if (typeof v === 'string' || typeof v === 'number') return new Date(v)
  return new Date()
}

function mapInstruction(row: Record<string, unknown>): MachineInstruction {
  return {
    id: row.id as string,
    ownerId: row.ownerId as string ?? row.owner_id as string ?? '',
    teamId: (row.teamId ?? row.team_id ?? null) as string | null,
    name: row.name as string,
    content: row.content as string ?? '',
    tags: (row.tags as string[]) ?? [],
    source: (row.source as 'user' | 'auto') ?? 'user',
    createdAt: toDate(row.createdAt ?? row.created_at),
    updatedAt: toDate(row.updatedAt ?? row.updated_at),
  }
}

export interface MachineInstructionPreset {
  id: string
  name: string
  description: string
  content: string
}

interface MachineInstructionState {
  instructions: MachineInstruction[]
  presets: MachineInstructionPreset[]
  loaded: boolean
  loading: boolean

  load: () => Promise<void>
  create: (params: { name: string; content?: string; tags?: string[] }) => Promise<MachineInstruction>
  update: (id: string, patch: { name?: string; content?: string; tags?: string[] }) => Promise<MachineInstruction>
  remove: (id: string) => Promise<void>
  assignToMachine: (machineId: string, instructionId: string | null) => Promise<void>
}

export const useMachineInstructionStore = create<MachineInstructionState>((set, get) => ({
  instructions: [],
  presets: [],
  loaded: false,
  loading: false,

  async load() {
    if (get().loading) return
    set({ loading: true })
    try {
      const headers = await authHeaders()
      const [instrRes, presetsRes] = await Promise.all([
        fetch(apiUrl('/api/machine-instructions'), { headers }),
        fetch(apiUrl('/api/machine-instructions/presets'), { headers }),
      ])
      if (!instrRes.ok) throw new Error(`${instrRes.status} ${instrRes.statusText}`)
      const data = await instrRes.json()
      const instructions = (data.instructions as Record<string, unknown>[]).map(mapInstruction)
      let presets: MachineInstructionPreset[] = []
      if (presetsRes.ok) {
        const presetsData = await presetsRes.json()
        presets = (presetsData.presets ?? []) as MachineInstructionPreset[]
      }
      set({ instructions, presets, loaded: true, loading: false })
    } catch (err) {
      console.warn('[machine-instruction-store] Failed to load:', err)
      set({ loaded: false, loading: false })
    }
  },

  async create(params) {
    const headers = await authHeaders()
    const res = await fetch(apiUrl('/api/machine-instructions'), {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as Record<string, string>).error ?? `${res.status}`)
    }
    const row = await res.json()
    const instruction = mapInstruction(row as Record<string, unknown>)
    set((state) => ({ instructions: [...state.instructions, instruction] }))
    return instruction
  },

  async update(id, patch) {
    const headers = await authHeaders()
    const res = await fetch(apiUrl(`/api/machine-instructions/${id}`), {
      method: 'PUT',
      headers,
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as Record<string, string>).error ?? `${res.status}`)
    }
    const row = await res.json()
    const updated = mapInstruction(row as Record<string, unknown>)
    set((state) => ({
      instructions: state.instructions.map((i) => i.id === id ? updated : i),
    }))
    return updated
  },

  async remove(id) {
    const headers = await authHeaders()
    const res = await fetch(apiUrl(`/api/machine-instructions/${id}`), {
      method: 'DELETE',
      headers,
    })
    if (!res.ok) throw new Error(`${res.status}`)
    set((state) => ({
      instructions: state.instructions.filter((i) => i.id !== id),
    }))
    // Clear stale defaultInstructionId on any machines that referenced this instruction
    useMachinesStore.setState((state) => ({
      machines: state.machines.map((m) =>
        m.defaultInstructionId === id ? { ...m, defaultInstructionId: null } : m
      ),
    }))
  },

  async assignToMachine(machineId, instructionId) {
    const headers = await authHeaders()
    const res = await fetch(apiUrl(`/api/machine-instructions/assign/${machineId}`), {
      method: 'PUT',
      headers,
      body: JSON.stringify({ instructionId }),
    })
    if (!res.ok) throw new Error(`${res.status}`)
    // Optimistically update the machines store so the picker reflects the change
    useMachinesStore.setState((state) => ({
      machines: state.machines.map((m) =>
        m.id === machineId ? { ...m, defaultInstructionId: instructionId } : m
      ),
    }))
  },
}))
