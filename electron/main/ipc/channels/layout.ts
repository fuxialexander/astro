/**
 * Layout persistence channel handlers.
 *
 * Stores JSON values on disk under `userData/layouts/<key>.json`. Keys are
 * sanitized so callers can't escape the layouts directory (slashes, dots,
 * colons all become underscores). Missing files resolve to `null` rather
 * than throwing — the renderer treats missing as "no saved layout".
 */

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/layout.js'

function layoutsDir(): string {
  return path.join(app.getPath('userData'), 'layouts')
}

/** Strip path separators and control chars so `key` can't escape the dir. */
function sanitizeKey(key: string): string {
  const cleaned = key.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!cleaned) throw new Error('layout key must be non-empty after sanitization')
  return cleaned
}

function fileFor(key: string): string {
  return path.join(layoutsDir(), `${sanitizeKey(key)}.json`)
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(layoutsDir(), { recursive: true })
}

export function registerLayoutChannels(): void {
  defineHandler('layout:load', schema.load, async (req) => {
    try {
      const file = fileFor(req.key)
      const raw = await fs.readFile(file, 'utf8')
      return { value: JSON.parse(raw) as unknown }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { value: null }
      }
      throw err
    }
  })

  defineHandler('layout:save', schema.save, async (req) => {
    await ensureDir()
    const file = fileFor(req.key)
    const tmp = `${file}.tmp`
    // Write through a temp file so a crash mid-write can't corrupt the saved
    // layout — the renderer re-reads on startup and a partial file would
    // silently fall back to defaults.
    await fs.writeFile(tmp, JSON.stringify(req.value), 'utf8')
    await fs.rename(tmp, file)
    return { ok: true as const }
  })
}
