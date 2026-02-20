/**
 * Plugin Loader
 *
 * Dynamic plugin loading and validation utilities.
 */

import type { AstroPlugin, PluginManifest, PluginCapability } from "@/types/plugin"

const VALID_CAPABILITIES: PluginCapability[] = [
  'routes', 'sidebar', 'commands', 'theme', 'signals',
  'connectors', 'providers', 'hooks', 'node-metadata', 'store', 'skills',
]

/**
 * Validate a plugin manifest has all required fields
 */
export function validateManifest(manifest: unknown): manifest is PluginManifest {
  if (!manifest || typeof manifest !== "object") return false

  const m = manifest as Record<string, unknown>

  if (typeof m.id !== "string" || !m.id) return false
  if (typeof m.name !== "string" || !m.name) return false
  if (typeof m.version !== "string" || !m.version) return false

  if (!Array.isArray(m.capabilities)) return false
  for (const cap of m.capabilities) {
    if (!VALID_CAPABILITIES.includes(cap as PluginCapability)) {
      console.warn(`[PluginLoader] Unknown capability "${cap}" in plugin "${m.id}"`)
    }
  }

  return true
}

/**
 * Parse a module's default export as an AstroPlugin
 */
export function loadPluginFromModule(module: unknown): AstroPlugin {
  if (!module || typeof module !== "object") {
    throw new Error("Plugin module must be an object")
  }

  // Support both default export and direct export
  const mod = module as Record<string, unknown>
  const plugin = (mod.default ?? mod) as AstroPlugin

  if (!plugin.manifest) {
    throw new Error("Plugin must have a manifest property")
  }

  if (!validateManifest(plugin.manifest)) {
    throw new Error(`Invalid plugin manifest: missing required fields (id, name, version)`)
  }

  if (typeof plugin.activate !== "function") {
    throw new Error("Plugin must have an activate() method")
  }

  if (typeof plugin.deactivate !== "function") {
    throw new Error("Plugin must have a deactivate() method")
  }

  return plugin
}

/**
 * Dynamically load a plugin from a URL
 */
export async function loadPluginFromUrl(url: string): Promise<AstroPlugin> {
  try {
    const module = await import(/* @vite-ignore */ url)
    return loadPluginFromModule(module)
  } catch (error) {
    throw new Error(
      `Failed to load plugin from ${url}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
