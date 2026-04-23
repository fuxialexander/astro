/**
 * PDF channel handler. Downloads a URL to a file under
 * <userData>/references/<subdir>/<filename>. Replaces the Tauri
 * pdf_commands.rs surface used by src/lib/pdf-downloader.ts.
 *
 * Phase 2A: simple fetch-based download. Phase 5 may switch to
 * session.downloadURL for cookie-jar / proxy / progress events.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/pdf.js'

function safeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200)
}

function deriveFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() ?? 'document.pdf'
    return safeFilename(last.includes('.') ? last : `${last}.pdf`)
  } catch {
    return 'document.pdf'
  }
}

export function registerPdfChannels(): void {
  defineHandler('pdf:download', schema.download, async (req) => {
    const filename = safeFilename(req.filename ?? deriveFilenameFromUrl(req.url))
    const dir = path.join(app.getPath('userData'), 'references', req.subdir)
    await fsp.mkdir(dir, { recursive: true })
    const dest = path.join(dir, filename)

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs)
    let bytes = 0
    try {
      const res = await fetch(req.url, {
        headers: req.headers,
        signal: ctrl.signal,
      })
      if (!res.ok) {
        throw new Error(`pdf download failed: ${res.status} ${res.statusText}`)
      }
      const buf = Buffer.from(await res.arrayBuffer())
      bytes = buf.length
      await fsp.writeFile(dest, buf)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`pdf download timed out after ${req.timeoutMs}ms`)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
    return { path: dest, bytes }
  })
}
