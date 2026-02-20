import { create } from "zustand"
import { loadState, saveState } from "@/lib/db"
import type {
  PluginManifest,
  PluginEntry,
  PluginPersistData,
  PluginContributions,
  AstroPlugin,
  SidebarItemContribution,
  CommandItemContribution,
  RouteContribution,
  ThemeContribution,
  SignalContribution,
  NodeMetadataFieldContribution,
} from "@/types/plugin"

const IDB_KEY = "astro-plugins"

interface PluginStore {
  plugins: Map<string, PluginEntry>
  loaded: boolean

  // Lifecycle
  load: () => Promise<void>
  registerPlugin: (manifest: PluginManifest, config?: Record<string, unknown>, source?: string) => void
  unregisterPlugin: (id: string) => void
  enablePlugin: (id: string) => void
  disablePlugin: (id: string) => void
  updatePluginConfig: (id: string, config: Record<string, unknown>) => void
  setPluginInstance: (id: string, instance: AstroPlugin, contributions: PluginContributions) => void
  setPluginError: (id: string, error: string) => void

  // Contribution accessors
  getAllSidebarItems: () => SidebarItemContribution[]
  getAllCommands: () => CommandItemContribution[]
  getAllRoutes: () => RouteContribution[]
  getAllThemes: () => ThemeContribution[]
  getAllSignals: () => SignalContribution[]
  getAllNodeMetadataFields: () => NodeMetadataFieldContribution[]
}

/** Serialize plugin map to persistable array (strips runtime-only fields) */
function serializePlugins(plugins: Map<string, PluginEntry>): PluginPersistData[] {
  const result: PluginPersistData[] = []
  for (const [, entry] of plugins) {
    result.push({
      id: entry.manifest.id,
      manifest: entry.manifest,
      enabled: entry.enabled,
      config: entry.config,
    })
  }
  return result
}

/** Deserialize persisted array back to plugin map (without runtime fields) */
function deserializePlugins(data: PluginPersistData[]): Map<string, PluginEntry> {
  const map = new Map<string, PluginEntry>()
  for (const item of data) {
    map.set(item.id, {
      manifest: item.manifest,
      enabled: item.enabled,
      config: item.config,
    })
  }
  return map
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  plugins: new Map(),
  loaded: false,

  load: async () => {
    try {
      const stored = await loadState<PluginPersistData[]>(IDB_KEY)
      if (stored && Array.isArray(stored)) {
        set({ plugins: deserializePlugins(stored), loaded: true })
      } else {
        set({ loaded: true })
      }
    } catch (error) {
      console.error("[PluginStore] Failed to load:", error)
      set({ loaded: true })
    }
  },

  registerPlugin: (manifest, config = {}) => {
    const plugins = new Map(get().plugins)
    plugins.set(manifest.id, {
      manifest,
      enabled: true,
      config,
    })
    set({ plugins })
    saveState(IDB_KEY, serializePlugins(plugins))
  },

  unregisterPlugin: (id) => {
    const plugins = new Map(get().plugins)
    plugins.delete(id)
    set({ plugins })
    saveState(IDB_KEY, serializePlugins(plugins))
  },

  enablePlugin: (id) => {
    const plugins = new Map(get().plugins)
    const entry = plugins.get(id)
    if (entry) {
      plugins.set(id, { ...entry, enabled: true })
      set({ plugins })
      saveState(IDB_KEY, serializePlugins(plugins))
    }
  },

  disablePlugin: (id) => {
    const plugins = new Map(get().plugins)
    const entry = plugins.get(id)
    if (entry) {
      plugins.set(id, { ...entry, enabled: false, instance: undefined, contributions: undefined })
      set({ plugins })
      saveState(IDB_KEY, serializePlugins(plugins))
    }
  },

  updatePluginConfig: (id, config) => {
    const plugins = new Map(get().plugins)
    const entry = plugins.get(id)
    if (entry) {
      plugins.set(id, { ...entry, config })
      set({ plugins })
      saveState(IDB_KEY, serializePlugins(plugins))
    }
  },

  setPluginInstance: (id, instance, contributions) => {
    const plugins = new Map(get().plugins)
    const entry = plugins.get(id)
    if (entry) {
      plugins.set(id, { ...entry, instance, contributions, error: undefined })
      set({ plugins })
      // Don't persist runtime-only data
    }
  },

  setPluginError: (id, error) => {
    const plugins = new Map(get().plugins)
    const entry = plugins.get(id)
    if (entry) {
      plugins.set(id, { ...entry, error, instance: undefined, contributions: undefined })
      set({ plugins })
    }
  },

  // Contribution accessors - gather from all enabled plugins with contributions
  getAllSidebarItems: () => {
    const items: SidebarItemContribution[] = []
    for (const [, entry] of get().plugins) {
      if (entry.enabled && entry.contributions?.sidebarItems) {
        items.push(...entry.contributions.sidebarItems)
      }
    }
    return items
  },

  getAllCommands: () => {
    const commands: CommandItemContribution[] = []
    for (const [, entry] of get().plugins) {
      if (entry.enabled && entry.contributions?.commands) {
        commands.push(...entry.contributions.commands)
      }
    }
    return commands
  },

  getAllRoutes: () => {
    const routes: RouteContribution[] = []
    for (const [, entry] of get().plugins) {
      if (entry.enabled && entry.contributions?.routes) {
        routes.push(...entry.contributions.routes)
      }
    }
    return routes
  },

  getAllThemes: () => {
    const themes: ThemeContribution[] = []
    for (const [, entry] of get().plugins) {
      if (entry.enabled && entry.contributions?.themes) {
        themes.push(...entry.contributions.themes)
      }
    }
    return themes
  },

  getAllSignals: () => {
    const signals: SignalContribution[] = []
    for (const [, entry] of get().plugins) {
      if (entry.enabled && entry.contributions?.signals) {
        signals.push(...entry.contributions.signals)
      }
    }
    return signals
  },

  getAllNodeMetadataFields: () => {
    const fields: NodeMetadataFieldContribution[] = []
    for (const [, entry] of get().plugins) {
      if (entry.enabled && entry.contributions?.nodeMetadataFields) {
        fields.push(...entry.contributions.nodeMetadataFields)
      }
    }
    return fields
  },
}))
