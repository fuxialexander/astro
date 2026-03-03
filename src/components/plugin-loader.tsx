import { useEffect, useRef, type ReactNode } from "react"
import { usePluginStore } from "@/stores/plugin-store"
import { useSkillStore } from "@/stores/skill-store"
import { useSidebarStore } from "@/stores/sidebar-store"
import { useTheme } from "@/components/theme-provider"
import { createPluginContext } from "@/lib/plugin-context"
import { API_BASE_URL } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"
import type { AstroPlugin, PluginContributions } from "@/types/plugin"

// Built-in plugins bundled with Astro
import gtdPlugin from "@/plugins/gtd-workflow"
import exampleThemePlugin from "@/plugins/example-theme"
import celltypePlugin from "@/plugins/celltype"

const BUILTIN_PLUGINS: AstroPlugin[] = [
  gtdPlugin,
  exampleThemePlugin,
  celltypePlugin,
]

/**
 * Sync plugin-contributed skills to the server's skill manager.
 * This makes them available for prompt injection in plan generation and dispatch.
 */
async function syncSkillsToServer(skills: PluginContributions['skills']) {
  if (!skills || skills.length === 0) return
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = await getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    await fetch(`${API_BASE_URL}/api/skills/register`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ skills }),
    })
  } catch {
    // Server may not be reachable yet during startup — skills will load on next page load
  }
}

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
  const addSkill = useSkillStore((s) => s.addSkill)
  const removeSkill = useSkillStore((s) => s.removeSkill)
  const registerExternalItem = useSidebarStore((s) => s.registerExternalItem)
  const unregisterExternalItem = useSidebarStore((s) => s.unregisterExternalItem)
  const { registerTheme, unregisterTheme } = useTheme()
  const builtinRegisteredRef = useRef(false)
  // Track which plugins have been bridged AND what contributions were bridged
  // so we can properly unregister even after contributions are cleared from the store
  const bridgedRef = useRef(new Map<string, PluginContributions>())
  // Track plugins currently being activated to prevent double-activation
  const activatingRef = useRef(new Set<string>())

  // Phase 1: Register built-in plugin manifests (one-time)
  useEffect(() => {
    if (builtinRegisteredRef.current) return
    builtinRegisteredRef.current = true

    for (const plugin of BUILTIN_PLUGINS) {
      if (!plugins.has(plugin.manifest.id)) {
        registerPlugin(plugin.manifest)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Phase 2: Activate enabled plugins that need activation (builtins + user plugins)
  useEffect(() => {
    for (const [id, entry] of plugins) {
      if (!entry.enabled) continue
      if (entry.contributions) continue // Already activated
      if (activatingRef.current.has(id)) continue // Currently activating

      // Resolve the plugin module: builtin or user-installed instance
      const builtinPlugin = BUILTIN_PLUGINS.find((p) => p.manifest.id === id)
      const pluginModule = builtinPlugin ?? entry.instance
      if (!pluginModule) continue

      activatingRef.current.add(id)
      const context = createPluginContext(
        id,
        entry.config,
        (config) => updatePluginConfig(id, config)
      )

      pluginModule
        .activate(context)
        .then((contributions) => {
          setPluginInstance(id, pluginModule, contributions)
        })
        .catch((error) => {
          console.error(`[PluginLoader] Failed to activate plugin "${id}":`, error)
          setPluginError(id, error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          activatingRef.current.delete(id)
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins])

  // Phase 3: Bridge contributions to sidebar and theme provider.
  // Uses bridgedRef Map to remember what was bridged for proper cleanup.
  useEffect(() => {
    const bridged = bridgedRef.current

    for (const [id, entry] of plugins) {
      const shouldBridge = entry.enabled && entry.contributions
      const wasBridged = bridged.has(id)

      if (shouldBridge && !wasBridged) {
        // Bridge new contributions
        bridgeContributions(id, entry.contributions!)
        bridged.set(id, entry.contributions!)
      } else if (!shouldBridge && wasBridged) {
        // Unbridge using the remembered contributions (not the cleared entry)
        unbridgeContributions(id, bridged.get(id)!)
        bridged.delete(id)
      }
    }

    // Clean up plugins that were removed from the map entirely
    for (const [id, contributions] of bridged) {
      if (!plugins.has(id)) {
        unbridgeContributions(id, contributions)
        bridged.delete(id)
      }
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
    // Bridge plugin skills to the skill store and sync to the server.
    // Only add skills that don't already exist in the store (loaded from DB by DataLoader).
    // Without this check, every page refresh would try to POST duplicate skills, causing 409s.
    // IMPORTANT: Wait for skill store to be loaded first — if skills haven't loaded from DB
    // yet, findByName returns nothing and ALL skills pass the filter, causing duplicate 409s.
    if (contributions.skills && contributions.skills.length > 0) {
      const processSkills = () => {
        const { findByName } = useSkillStore.getState()
        const newSkills = contributions.skills!.filter(skill => !findByName(skill.name))
        for (const skill of newSkills) {
          addSkill(skill)
        }
        // Sync all plugin skills to server (idempotent endpoint) for prompt injection.
        // Done inside the loaded gate so client and server state stay consistent.
        syncSkillsToServer(contributions.skills!).catch((err) => {
          console.warn(`[PluginLoader] Failed to sync skills for plugin "${pluginId}":`, err)
        })
      }

      const { loaded } = useSkillStore.getState()
      if (loaded) {
        processSkills()
      } else {
        // Skills arrived before store loaded from DB. Subscribe and process once ready.
        // The subscription auto-cleans up after firing.
        const unsub = useSkillStore.subscribe((state) => {
          if (state.loaded) {
            unsub()
            processSkills()
          }
        })
      }
    }
  }

  function unbridgeContributions(pluginId: string, contributions: PluginContributions) {
    if (contributions.sidebarItems) {
      for (const item of contributions.sidebarItems) {
        unregisterExternalItem(`${pluginId}:${item.id}`)
      }
    }
    if (contributions.themes) {
      for (const theme of contributions.themes) {
        unregisterTheme(theme.id)
      }
    }
    if (contributions.skills) {
      for (const skill of contributions.skills) {
        removeSkill(skill.name)
      }
    }
  }

  return <>{children}</>
}
