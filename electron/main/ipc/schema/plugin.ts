/**
 * Plugin host channel schemas. Phase 4 spawns a utilityProcess per plugin;
 * Phase 2A only stubs the surface so the bridge has it ready.
 */

import { z } from 'zod'

const pluginManifestSummary = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  state: z.enum(['installed', 'running', 'crashed', 'disabled']),
})

export const list = {
  req: z.object({}),
  res: z.object({ plugins: z.array(pluginManifestSummary) }),
}

export const enable = {
  req: z.object({ id: z.string() }),
  res: z.object({ ok: z.literal(true) }),
}

export const disable = {
  req: z.object({ id: z.string() }),
  res: z.object({ ok: z.literal(true) }),
}

export const install = {
  req: z.object({
    /** Local directory containing manifest.json + plugin code. */
    sourcePath: z.string(),
  }),
  res: z.object({ id: z.string() }),
}

export const uninstall = {
  req: z.object({ id: z.string() }),
  res: z.object({ ok: z.literal(true) }),
}

export const channels = {
  'plugin:list': list,
  'plugin:enable': enable,
  'plugin:disable': disable,
  'plugin:install': install,
  'plugin:uninstall': uninstall,
} as const
