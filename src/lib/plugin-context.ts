/**
 * Plugin Context Factory
 *
 * Creates a PluginContext for each plugin with namespaced storage,
 * read-only store access, and event subscription.
 */

import { loadState, saveState } from "@/lib/db"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useSessionStore } from "@/stores/session-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { PluginContext, PluginEvent, PluginStorage } from "@/types/plugin"

/** Simple event bus for plugin events */
class PluginEventBus {
  private handlers = new Set<(event: PluginEvent) => void>()

  subscribe(handler: (event: PluginEvent) => void): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  emit(event: PluginEvent) {
    for (const handler of this.handlers) {
      try {
        handler(event)
      } catch (err) {
        console.error("[PluginEventBus] Handler error:", err)
      }
    }
  }
}

/** Singleton event bus shared across all plugins */
export const pluginEventBus = new PluginEventBus()

/** Create namespaced IndexedDB storage for a plugin */
function createPluginStorage(pluginId: string): PluginStorage {
  const prefix = `plugin-${pluginId}-`
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return loadState<T>(`${prefix}${key}`)
    },
    async set<T>(key: string, value: T): Promise<void> {
      await saveState(`${prefix}${key}`, value)
    },
  }
}

/**
 * Create a PluginContext for a specific plugin
 */
export function createPluginContext(
  pluginId: string,
  config: Record<string, unknown>,
  updateConfig: (config: Record<string, unknown>) => void
): PluginContext {
  return {
    stores: {
      getProjects: () => useProjectStore.getState().projects,
      getPlanNodes: () => usePlanStore.getState().nodes,
      getSessions: () => Array.from(useSessionStore.getState().sessions.values()),
      getSettings: () => {
        const s = useSettingsStore.getState()
        return { model: s.model, connectionStatus: s.connectionStatus }
      },
    },
    config,
    updateConfig,
    storage: createPluginStorage(pluginId),
    onEvent: (handler) => pluginEventBus.subscribe(handler),
  }
}
