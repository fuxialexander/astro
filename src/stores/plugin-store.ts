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
import { isDesktop } from "@/lib/desktop-detect"
import { desktopBridge } from "@/lib/desktop-bridge"
import { requestPluginApproval } from "@/components/plugins/PluginApprovalDialog"

interface PluginStore {
  plugins: Map<string, PluginEntry>
  loaded: boolean

  // Lifecycle
  load: () => Promise<void>
  registerPlugin: (manifest: PluginManifest, config?: Record<string, unknown>, source?: string) => void
  unregisterPlugin: (id: string) => void
  enablePlugin: (id: string) => Promise<void>
  disablePlugin: (id: string) => Promise<void>
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

  enablePlugin: async (id) => {
    const plugins = new Map(get().plugins)
    const entry = plugins.get(id)
    if (!entry) return

    // Phase 4B: surface a permission approval dialog before touching the
    // host. The user must explicitly confirm the declared permissions.
    const approved = await requestPluginApproval(entry.manifest)
    if (!approved) {
      console.info(`[PluginStore] user declined to enable "${id}"`)
      return
    }

    // On desktop, ask the Electron plugin host to fork the utilityProcess.
    // Any failure surfaces as a plugin error in the store.
    if (isDesktop()) {
      try {
        await desktopBridge.plugins.enable(id)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[PluginStore] enable failed for "${id}":`, err)
        const next = new Map(get().plugins)
        const current = next.get(id)
        if (current) {
          next.set(id, { ...current, enabled: false, error: message })
          set({ plugins: next })
        }
        return
      }
    }

    const next = new Map(get().plugins)
    const current = next.get(id)
    if (current) {
      next.set(id, { ...current, enabled: true, error: undefined })
      set({ plugins: next })
    }
  },

  disablePlugin: async (id) => {
    const plugins = new Map(get().plugins)
    const entry = plugins.get(id)
    if (!entry) return

    // Call deactivate() on the legacy in-process instance if present.
    try {
      await entry.instance?.deactivate?.()
    } catch (err) {
      console.warn(`[PluginStore] deactivate() failed for "${id}":`, err)
    }

    if (isDesktop()) {
      try {
        await desktopBridge.plugins.disable(id)
      } catch (err) {
        console.warn(`[PluginStore] bridge.disable failed for "${id}":`, err)
      }
    }

    const next = new Map(get().plugins)
    const current = next.get(id)
    if (current) {
      next.set(id, {
        ...current,
        enabled: false,
        instance: undefined,
        contributions: undefined,
      })
      set({ plugins: next })
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
