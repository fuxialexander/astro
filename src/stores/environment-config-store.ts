import { create } from 'zustand'
import type { EnvironmentConfig } from '@/types'
import { dataClient } from '@/lib/data-client'

interface EnvironmentConfigStore {
  configs: EnvironmentConfig[]
  loaded: boolean

  load(): Promise<void>
  getForBackend(backendId: string, machineId?: string): EnvironmentConfig | undefined
  upsert(backendId: string, machineId: string | undefined, customContext: string, displayName?: string): Promise<EnvironmentConfig>
  remove(id: string): Promise<void>
}

export const useEnvironmentConfigStore = create<EnvironmentConfigStore>((set, get) => ({
  configs: [],
  loaded: false,

  async load() {
    try {
      const configs = await dataClient.getEnvironmentConfigs()
      set({ configs, loaded: true })
    } catch (err) {
      console.warn('[environment-config-store] Failed to load configs:', err)
      set({ loaded: true })
    }
  },

  getForBackend(backendId: string, machineId?: string) {
    return get().configs.find(
      (c) => c.backendId === backendId && (c.machineId ?? undefined) === machineId
    )
  },

  async upsert(backendId, machineId, customContext, displayName) {
    const config = await dataClient.upsertEnvironmentConfig({
      backendId,
      machineId,
      customContext,
      displayName,
    })
    set((state) => {
      const existing = state.configs.findIndex((c) => c.id === config.id)
      if (existing >= 0) {
        const updated = [...state.configs]
        updated[existing] = config
        return { configs: updated }
      }
      return { configs: [...state.configs, config] }
    })
    return config
  },

  async remove(id) {
    await dataClient.deleteEnvironmentConfig(id)
    set((state) => ({
      configs: state.configs.filter((c) => c.id !== id),
    }))
  },
}))
