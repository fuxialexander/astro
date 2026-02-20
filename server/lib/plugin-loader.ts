/**
 * Server Plugin Loader
 *
 * Discovers and loads plugins from the server/plugins/ directory.
 * Each plugin is a directory with an index.ts/js that default-exports
 * an AstroServerPlugin.
 */

import { readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import type {
  AstroServerPlugin,
  ServerPluginContext,
  ServerPluginContributions,
  ServerPluginEntry,
} from '../types/plugin.js'
import { signalProcessor } from './signal-processor.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Discover and load all server plugins from server/plugins/
 */
export async function loadServerPlugins(): Promise<Map<string, ServerPluginEntry>> {
  const entries = new Map<string, ServerPluginEntry>()
  const pluginsDir = join(__dirname, '..', 'plugins')

  if (!existsSync(pluginsDir)) {
    console.log('[plugin-loader] No server/plugins/ directory found, skipping')
    return entries
  }

  const dirs = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())

  for (const dir of dirs) {
    const indexPath = join(pluginsDir, dir.name, 'index.js')
    if (!existsSync(indexPath)) {
      console.warn(`[plugin-loader] Plugin ${dir.name} has no index.js, skipping`)
      continue
    }

    try {
      const mod = await import(indexPath)
      const plugin: AstroServerPlugin = mod.default ?? mod
      if (!plugin.manifest?.id) {
        console.warn(`[plugin-loader] Plugin ${dir.name} has no manifest.id, skipping`)
        continue
      }
      entries.set(plugin.manifest.id, { manifest: plugin.manifest })
      console.log(`[plugin-loader] Discovered plugin: ${plugin.manifest.id} v${plugin.manifest.version}`)
    } catch (err) {
      console.error(`[plugin-loader] Failed to load plugin ${dir.name}:`, err)
      entries.set(dir.name, {
        manifest: { id: dir.name, name: dir.name, version: '0.0.0', capabilities: [] },
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return entries
}

/**
 * Activate a single server plugin with error isolation
 */
export async function activateServerPlugin(
  plugin: AstroServerPlugin,
  context: ServerPluginContext
): Promise<ServerPluginContributions> {
  try {
    return await plugin.activate(context)
  } catch (err) {
    console.error(`[plugin-loader] Failed to activate plugin ${plugin.manifest.id}:`, err)
    throw err
  }
}

/**
 * Load, activate, and mount all channel plugins into the Hono app.
 *
 * For each discovered plugin:
 *  - Import the plugin module
 *  - Activate it with a minimal context
 *  - Mount contributed routes at /api/plugins/{pluginId}/
 *  - Register contributed signalEvaluators with signalProcessor
 *
 * Returns the number of successfully activated plugins.
 */
export async function loadAndActivateChannelPlugins(app: Hono): Promise<number> {
  const entries = await loadServerPlugins()
  let activated = 0

  const pluginsDir = join(__dirname, '..', 'plugins')

  for (const [pluginId, entry] of entries) {
    if (entry.error) {
      console.warn(`[plugin-loader] Skipping errored plugin ${pluginId}`)
      continue
    }

    const indexPath = join(pluginsDir, pluginId, 'index.js')
    if (!existsSync(indexPath)) {
      continue
    }

    try {
      const mod = await import(indexPath)
      const plugin: AstroServerPlugin = mod.default ?? mod

      // Build a minimal activation context from env vars
      const context: ServerPluginContext = {
        eventTransport: null,
        providerRegistry: null,
        config: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([k]) => k.startsWith('ASTRO_') || k.startsWith('PLUGIN_'))
          ),
        },
      }

      const contributions = await activateServerPlugin(plugin, context)
      entry.contributions = contributions

      // Mount contributed routes
      if (contributions.routes) {
        app.route(`/api/plugins/${pluginId}`, contributions.routes)
        console.log(`[plugin-loader] Mounted routes for ${pluginId} at /api/plugins/${pluginId}/`)
      }

      // Register contributed signal evaluators
      if (contributions.signalEvaluators) {
        for (const { type, evaluator } of contributions.signalEvaluators) {
          signalProcessor.registerEvaluator(type, evaluator)
          console.log(`[plugin-loader] Registered signal evaluator '${type}' from ${pluginId}`)
        }
      }

      activated++
    } catch (err) {
      console.error(`[plugin-loader] Failed to activate plugin ${pluginId}:`, err)
    }
  }

  return activated
}
