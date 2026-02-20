import { useEffect, useRef, type ReactNode } from "react"
import { usePluginStore } from "@/stores/plugin-store"
import { useSidebarStore } from "@/stores/sidebar-store"
import { useTheme } from "@/components/theme-provider"
import { createPluginContext } from "@/lib/plugin-context"
import type { AstroPlugin, PluginContributions } from "@/types/plugin"

// Built-in plugins bundled with Astro
import gtdPlugin from "@/plugins/gtd-workflow"
import exampleThemePlugin from "@/plugins/example-theme"

const BUILTIN_PLUGINS: AstroPlugin[] = [
  gtdPlugin,
  exampleThemePlugin,
]

interface Props {
  children: ReactNode
}

/**
 * PluginLoader registers built-in plugins, activates enabled plugins,
 * and bridges their contributions to the sidebar store and theme provider.
 */
export function PluginLoader({ children }: Props) {
  const plugins = usePluginStore((s) => s.plugins)
  const registerPlugin = usePluginStore((s) => s.registerPlugin)
  const setPluginInstance = usePluginStore((s) => s.setPluginInstance)
  const setPluginError = usePluginStore((s) => s.setPluginError)
  const updatePluginConfig = usePluginStore((s) => s.updatePluginConfig)
  const registerExternalItem = useSidebarStore((s) => s.registerExternalItem)
  const unregisterExternalItem = useSidebarStore((s) => s.unregisterExternalItem)
  const { registerTheme, unregisterTheme } = useTheme()
  const builtinRegisteredRef = useRef(false)
  // Track which plugins have been bridged to sidebar/theme
  const bridgedPluginsRef = useRef(new Set<string>())

  // Register and activate built-in plugins on first mount
  useEffect(() => {
    if (builtinRegisteredRef.current) return
    builtinRegisteredRef.current = true

    for (const plugin of BUILTIN_PLUGINS) {
      const existing = plugins.get(plugin.manifest.id)
      if (!existing) {
        registerPlugin(plugin.manifest)
      }
      if (existing && !existing.enabled) continue
      if (existing?.contributions) continue // Already activated

      const context = createPluginContext(
        plugin.manifest.id,
        existing?.config ?? {},
        (config) => updatePluginConfig(plugin.manifest.id, config)
      )
      plugin.activate(context)
        .then((contributions) => {
          setPluginInstance(plugin.manifest.id, plugin, contributions)
        })
        .catch((error) => {
          console.error(`[PluginLoader] Failed to activate built-in plugin "${plugin.manifest.id}":`, error)
          setPluginError(plugin.manifest.id, error instanceof Error ? error.message : String(error))
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync plugin contributions to sidebar and theme provider.
  // Runs whenever plugins map changes (activation, enable/disable).
  useEffect(() => {
    const bridged = bridgedPluginsRef.current

    for (const [id, entry] of plugins) {
      const shouldBridge = entry.enabled && entry.contributions
      const isBridged = bridged.has(id)

      if (shouldBridge && !isBridged) {
        // Bridge new contributions
        bridgeContributions(id, entry.contributions!)
        bridged.add(id)
      } else if (!shouldBridge && isBridged) {
        // Unbridge removed/disabled contributions
        unbridgeContributions(id, entry.contributions)
        bridged.delete(id)
      }
    }

    // Clean up plugins that were removed from the map entirely
    for (const id of bridged) {
      if (!plugins.has(id)) {
        unbridgeContributions(id)
        bridged.delete(id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins])

  // Activate user-installed (non-builtin) plugins that have instances
  useEffect(() => {
    const builtinIds = new Set(BUILTIN_PLUGINS.map((p) => p.manifest.id))

    for (const [id, entry] of plugins) {
      if (builtinIds.has(id)) continue
      if (!entry.enabled) continue
      if (!entry.instance) continue
      if (entry.contributions) continue

      const context = createPluginContext(
        id,
        entry.config,
        (config) => updatePluginConfig(id, config)
      )

      entry.instance
        .activate(context)
        .then((contributions) => {
          setPluginInstance(id, entry.instance!, contributions)
        })
        .catch((error) => {
          console.error(`[PluginLoader] Failed to activate plugin "${id}":`, error)
          setPluginError(id, error instanceof Error ? error.message : String(error))
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins])

  function bridgeContributions(pluginId: string, contributions: PluginContributions) {
    if (contributions.sidebarItems) {
      for (const item of contributions.sidebarItems) {
        registerExternalItem({
          id: `${pluginId}:${item.id}`,
          to: item.to,
          icon: item.icon,
          label: item.label,
          visible: item.defaultVisible ?? true,
          protected: false,
        })
      }
    }
    if (contributions.themes) {
      for (const theme of contributions.themes) {
        registerTheme(theme)
      }
    }
  }

  function unbridgeContributions(pluginId: string, contributions?: PluginContributions) {
    if (contributions?.sidebarItems) {
      for (const item of contributions.sidebarItems) {
        unregisterExternalItem(`${pluginId}:${item.id}`)
      }
    }
    if (contributions?.themes) {
      for (const theme of contributions.themes) {
        unregisterTheme(theme.id)
      }
    }
  }

  return <>{children}</>
}
