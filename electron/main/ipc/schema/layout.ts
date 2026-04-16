/**
 * Layout persistence channel schemas.
 *
 * File-backed key/value store for arbitrary renderer-side layout snapshots
 * (dockview pane layout, editor group geometry, etc.). Each key maps to a
 * single JSON file under `app.getPath('userData')/layouts/<key>.json`.
 *
 * This deliberately avoids the database: layouts are per-install UI state,
 * not team-synced data, and shouldn't force a Drizzle migration.
 */

import { z } from 'zod'

export const load = {
  req: z.object({ key: z.string() }),
  res: z.object({ value: z.unknown().nullable() }),
}

export const save = {
  req: z.object({ key: z.string(), value: z.unknown() }),
  res: z.object({ ok: z.literal(true) }),
}

export const channels = {
  'layout:load': load,
  'layout:save': save,
} as const
