/**
 * Plugin host channel handlers.
 *
 * Phase 4: real wiring to the per-plugin utilityProcess loader. Discovery
 * runs lazily on first list call so the rest of main boot stays fast.
 */

import { defineHandler } from '../registry.js'
import * as schema from '../schema/plugin.js'
import * as loader from '../../plugin/loader.js'

let discovered = false
async function ensureDiscovered(): Promise<void> {
  if (discovered) return
  discovered = true
  await loader.discoverPlugins()
}

export function registerPluginChannels(): void {
  defineHandler('plugin:list', schema.list, async () => {
    await ensureDiscovered()
    return { plugins: loader.listPlugins() }
  })

  defineHandler('plugin:enable', schema.enable, async (req) => {
    await ensureDiscovered()
    await loader.enablePlugin(req.id)
    return { ok: true as const }
  })

  defineHandler('plugin:disable', schema.disable, async (req) => {
    await ensureDiscovered()
    await loader.disablePlugin(req.id)
    return { ok: true as const }
  })

  defineHandler('plugin:install', schema.install, async (req) => {
    await ensureDiscovered()
    const id = await loader.installPlugin(req.sourcePath)
    return { id }
  })

  defineHandler('plugin:uninstall', schema.uninstall, async (req) => {
    await ensureDiscovered()
    await loader.uninstallPlugin(req.id)
    return { ok: true as const }
  })
}
