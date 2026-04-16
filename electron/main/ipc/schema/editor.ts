/**
 * External editor channel schemas. Detects an installed editor (VSCode,
 * Cursor, etc.) and opens a path in it, plus a shell.openExternal escape
 * hatch for arbitrary URIs.
 */

import { z } from 'zod'

export const detect = {
  req: z.object({}),
  res: z.object({
    editors: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        command: z.string(),
      })
    ),
  }),
}

export const openInEditor = {
  req: z.object({
    editorId: z.string(),
    path: z.string(),
    line: z.number().int().nonnegative().optional(),
  }),
  res: z.object({ ok: z.literal(true) }),
}

export const openExternal = {
  req: z.object({ url: z.string() }),
  res: z.object({ ok: z.literal(true) }),
}

export const channels = {
  'editor:detect': detect,
  'editor:open': openInEditor,
  'editor:open-external': openExternal,
} as const
