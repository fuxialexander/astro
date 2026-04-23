import { create } from 'zustand'
import { apiUrl } from '@/lib/api-url'
import { authHeaders } from '@/lib/auth-headers'

export type RemoteComputeProvider = 'astro-cloud' | 'daytona' | 'aws' | 'gcp' | 'runloop'
export type RemoteComputeStatus = 'provisioning' | 'active' | 'scaling' | 'terminating' | 'terminated' | 'failed'

export interface RemoteComputePool {
  id: string
  provider: RemoteComputeProvider
  status: RemoteComputeStatus
  desiredRunners: number
  activeRunners: number
  resourceProfile: { cpu?: number; memoryGb?: number; gpu?: number; ttlMinutes?: number }
  costMetadata: { estimatedHourlyCostUsd?: number }
  providerMetadata: Record<string, unknown>
  error?: string
  expiresAt?: string
  createdAt: string
}

export interface ProviderDetection {
  detected: boolean | null
  source: 'connected-accounts' | 'local-credentials' | 'pool-history'
}

export interface DetectResult {
  isDesktop: boolean
  providers: {
    daytona: ProviderDetection
    aws: ProviderDetection
    gcp: ProviderDetection
  }
}

export interface CreatePoolParams {
  provider: RemoteComputeProvider
  accountId?: string
  desiredRunners: number
  resourceProfile: { cpu?: number; memoryGb?: number; gpu?: number; ttlMinutes?: number }
  limits?: { maxEstimatedHourlyCostUsd?: number }
}

interface RemoteComputeState {
  pools: RemoteComputePool[]
  loading: boolean
  loaded: boolean
  error: string | null
  detection: DetectResult | null
  detectionLoaded: boolean
  load: () => Promise<void>
  detect: () => Promise<void>
  createPool: (params: CreatePoolParams) => Promise<RemoteComputePool>
  scalePool: (id: string, desiredRunners: number) => Promise<void>
  terminatePool: (id: string) => Promise<void>
}

async function getHeaders(json = false): Promise<Record<string, string>> {
  const h = await authHeaders()
  if (json) h['Content-Type'] = 'application/json'
  return h
}

export const useRemoteComputeStore = create<RemoteComputeState>((set, get) => ({
  pools: [],
  loading: false,
  loaded: false,
  error: null,
  detection: null,
  detectionLoaded: false,

  detect: async () => {
    try {
      const res = await fetch(apiUrl('/api/remote-compute/detect'), { headers: await getHeaders() })
      if (!res.ok) return
      const data = await res.json() as DetectResult
      set({ detection: data, detectionLoaded: true })
    } catch {
      set({ detectionLoaded: true })
    }
  },

  load: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const res = await fetch(apiUrl('/api/remote-compute/pools'), { headers: await getHeaders() })
      if (!res.ok) throw new Error('Failed to load compute pools')
      const { pools } = await res.json() as { pools: RemoteComputePool[] }
      set({ pools, loading: false, loaded: true })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error', loading: false, loaded: true })
    }
  },

  createPool: async (params: CreatePoolParams) => {
    const res = await fetch(apiUrl('/api/remote-compute/pools'), {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify(params),
    })
    const data = await res.json() as { pool: RemoteComputePool; error?: string }
    if (!res.ok) throw new Error(data.error ?? 'Failed to create pool')
    set((s) => ({ pools: [data.pool, ...s.pools] }))
    return data.pool
  },

  scalePool: async (id: string, desiredRunners: number) => {
    const res = await fetch(apiUrl(`/api/remote-compute/pools/${id}/scale`), {
      method: 'PATCH',
      headers: await getHeaders(true),
      body: JSON.stringify({ desiredRunners }),
    })
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      throw new Error(data.error ?? 'Failed to scale pool')
    }
    set((s) => ({
      pools: s.pools.map((p) => p.id === id ? { ...p, desiredRunners, status: 'scaling' } : p),
    }))
  },

  terminatePool: async (id: string) => {
    const res = await fetch(apiUrl(`/api/remote-compute/pools/${id}`), {
      method: 'DELETE',
      headers: await getHeaders(),
    })
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      throw new Error(data.error ?? 'Failed to terminate pool')
    }
    set((s) => ({
      pools: s.pools.map((p) => p.id === id ? { ...p, status: 'terminating' } : p),
    }))
  },
}))
