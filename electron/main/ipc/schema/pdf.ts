/**
 * PDF channel schemas. Replaces the Tauri pdf_commands.rs surface used by
 * src/lib/pdf-downloader.ts. Downloads use Electron session.downloadURL
 * (which respects the global cookie jar / proxy / CSP) and write to the
 * userData/references directory by default.
 */

import { z } from 'zod'

export const download = {
  req: z.object({
    url: z.string().url(),
    /** Filename (basename only). If null, derived from URL. */
    filename: z.string().nullable().default(null),
    /** Subdirectory under the references root. */
    subdir: z.string().default('pdfs'),
    /** Per-request timeout in ms. */
    timeoutMs: z.number().int().positive().default(60_000),
  }),
  res: z.object({
    path: z.string(),
    bytes: z.number(),
  }),
}

export const channels = {
  'pdf:download': download,
} as const
