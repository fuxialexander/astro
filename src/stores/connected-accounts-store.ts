import { create } from 'zustand'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'

export type ChannelType = 'slack' | 'telegram' | 'github_webhook' | 'linear' | 'openclaw' | 'zotero'

export interface ConnectedAccount {
  id: string
  channel: ChannelType
  label: string
  maskedCredentials: Record<string, unknown>
  mappings: Record<string, string>
  settings: Record<string, unknown>
  externalId?: string
  enabled: boolean
  connectedAt: string
}

interface NewAccountData {
  label: string
  credentials: Record<string, string>
  mappings?: Record<string, string>
  settings?: Record<string, unknown>
}

export interface TestResult {
  success: boolean
  message: string
  details?: Record<string, unknown>
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

interface ConnectedAccountsState {
  accounts: ConnectedAccount[]
  loading: boolean
  error: string | null
  loaded: boolean
  load: () => Promise<void>
  addAccount: (channel: ChannelType, data: NewAccountData) => Promise<void>
  updateAccount: (id: string, data: Partial<{ label: string; mappings: Record<string, string>; settings: Record<string, unknown>; enabled: boolean }>) => Promise<void>
  removeAccount: (id: string) => Promise<void>
  testConnection: (id: string) => Promise<TestResult>
  getAccountsForChannel: (channel: ChannelType) => ConnectedAccount[]
}

export const useConnectedAccountsStore = create<ConnectedAccountsState>((set, get) => ({
  accounts: [],
  loading: false,
  error: null,
  loaded: false,

  load: async () => {
    try {
      set({ loading: true, error: null })

      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/connected-accounts'), { headers })
      if (!res.ok) throw new Error('Failed to load accounts')
      const data = await res.json()
      set({ accounts: data, loaded: true, loading: false })
    } catch (error) {
      set({
        accounts: [],
        loaded: true,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load accounts',
      })
    }
  },

  addAccount: async (channel, data) => {
    try {
      set({ loading: true, error: null })

      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/connected-accounts'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel, ...data }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to add account')
      }
      // Reload to get masked credentials
      set({ loading: false })
      await get().load()
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to add account',
      })
    }
  },

  updateAccount: async (id, data) => {
    try {
      set({ loading: true, error: null })

      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/connected-accounts/${id}`), {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update account')
      set({ loading: false })
      await get().load()
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to update account',
      })
    }
  },

  removeAccount: async (id) => {
    try {
      set({ loading: true, error: null })

      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/connected-accounts/${id}`), {
        method: 'DELETE',
        headers,
      })
      if (!res.ok) throw new Error('Failed to remove account')
      set({ loading: false })
      await get().load()
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to remove account',
      })
    }
  },

  testConnection: async (id) => {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/connected-accounts/${id}/test`), {
        method: 'POST',
        headers,
      })
      if (!res.ok) throw new Error('Test failed')
      return await res.json() as TestResult
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed',
      }
    }
  },

  getAccountsForChannel: (channel) => {
    return get().accounts.filter((a) => a.channel === channel)
  },
}))
