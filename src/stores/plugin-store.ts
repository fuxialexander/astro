import { create } from "zustand"
import type {
  PluginManifest,
  PluginEntry,
  PluginContributions,
  AstroPlugin,
  SidebarItemContribution,
  CommandItemContribution,
  RouteContribution,
  ThemeContribution,
  SignalContribution,
  NodeMetadataFieldContribution,
} from "@/types/plugin"

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

export const usePluginStore = create<PluginStore>((set, get) => ({
  plugins: new Map(),
  loaded: false,

  load: async () => {
    set({ loaded: true })
  },

  registerPlugin: (manifest, config = {}) => {
    const plugins = new Map(get().plugins)
    plugins.set(manifest.id, {
      manifest,
      enabled: true,
      config,
    })
    set({ plugins })
  },

  unregisterPlugin: (id) => {
    const plugins = new Map(get().plugins)
    plugins.delete(id)
    set({ plugins })
  },

  enablePlugin: (id) => {
    const plugins = new Map(get().plugins)
    const entry = plugins.get(id)
    if (entry) {
      plugins.set(id, { ...entry, enabled: true })
      set({ plugins })
    }
  },

  disablePlugin: (id) => {
    const plugins = new Map(get().plugins)
    const entry = plugins.get(id)
    if (entry) {
      // Call deactivate() on the instance before clearing it
      entry.instance?.deactivate?.().catch((err) => {
        console.warn(`[PluginStore] deactivate() failed for "${id}":`, err)
      })
      plugins.set(id, { ...entry, enabled: false, instance: undefined, contributions: undefined })
      set({ plugins })
    }
  },

  updatePluginConfig: (id, config) => {
    const plugins = new Map(get().plugins)
    const entry = plugins.get(id)
    if (entry) {
      plugins.set(id, { ...entry, config })
      set({ plugins })
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
