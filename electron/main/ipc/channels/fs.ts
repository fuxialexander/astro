/**
 * Filesystem channel handlers — thin wrappers around node:fs/promises.
 * Runs in the main process. The renderer is sandboxed and cannot do FS
 * directly; everything that needs a path goes through here.
 *
 * Note: there is no path-allow-list yet. Phase 4 will gate plugin FS calls
 * via electron/main/plugin/permissions.ts; for now the main app's renderer
 * is trusted (we ship the SPA, not third-party code).
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/fs.js'

const require = createRequire(import.meta.url)

export function registerFsChannels(): void {
  defineHandler('fs:read-file', schema.readFile, async (req) => {
    const buf = await fsp.readFile(req.path)
    return {
      content: req.encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8'),
    }
  })

  defineHandler('fs:write-file', schema.writeFile, async (req) => {
    const data =
      req.encoding === 'base64' ? Buffer.from(req.content, 'base64') : Buffer.from(req.content, 'utf8')
    await fsp.writeFile(req.path, data)
    return { ok: true as const }
  })

  defineHandler('fs:exists', schema.exists, async (req) => {
    try {
      await fsp.access(req.path)
      return { exists: true }
    } catch {
      return { exists: false }
    }
  })

  defineHandler('fs:stat', schema.stat, async (req) => {
    const s = await fsp.stat(req.path)
    return {
      size: s.size,
      mtimeMs: s.mtimeMs,
      ctimeMs: s.ctimeMs,
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
    }
  })

  defineHandler('fs:list-dir', schema.listDir, async (req) => {
    const dirents = await fsp.readdir(req.path, { withFileTypes: true })
    return {
      entries: dirents.map((d) => ({
        name: d.name,
        path: path.join(req.path, d.name),
        isDirectory: d.isDirectory(),
        isFile: d.isFile(),
      })),
    }
  })

  defineHandler('fs:mkdir', schema.mkdir, async (req) => {
    await fsp.mkdir(req.path, { recursive: req.recursive })
    return { ok: true as const }
  })

  defineHandler('fs:rm', schema.rm, async (req) => {
    await fsp.rm(req.path, { recursive: req.recursive, force: req.force })
    return { ok: true as const }
  })

  defineHandler('fs:search', schema.search, async (req) => {
    const limit = req.limit ?? 200
    const needle = req.query.toLowerCase()
    const skip = new Set([
      '.git',
      'node_modules',
      '.astro',
      'dist',
      'build',
      '.next',
      'target',
    ])
    const matches: Array<{
      path: string
      name: string
      type: 'file' | 'directory'
    }> = []

    // Manual recursive walk so we can prune skipped directories and
    // short-circuit once `limit` matches are found. fs.readdir's
    // `recursive:true` option can't do either.
    async function walk(dir: string): Promise<void> {
      if (matches.length >= limit) return
      let dirents: import('node:fs').Dirent[]
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        // Permission errors / vanished dirs — skip silently, continue walk.
        return
      }
      for (const d of dirents) {
        if (matches.length >= limit) return
        if (skip.has(d.name)) continue
        const full = path.join(dir, d.name)
        const isDir = d.isDirectory()
        if (needle.length === 0 || d.name.toLowerCase().includes(needle)) {
          matches.push({
            path: full,
            name: d.name,
            type: isDir ? 'directory' : 'file',
          })
        }
        if (isDir) {
          await walk(full)
        }
      }
    }

    await walk(req.root)
    return { matches }
  })

  defineHandler('fs:search-content', schema.searchContent, (req) => {
    return new Promise((resolve) => {
      // @vscode/ripgrep ships a pre-built rg binary for all platforms.
      // Use createRequire() because the Electron main process runs as ESM.
      let rgBin: string
      try {
        rgBin = (require('@vscode/ripgrep') as { rgPath: string }).rgPath
      } catch {
        resolve({ matches: [], error: 'ripgrep not available' })
        return
      }

      const args = [
        '--json',
        '--max-count', String(req.maxMatchesPerFile ?? 5),
        '--max-filesize', '1M',
        '--glob', '!node_modules',
        '--glob', '!.git',
        '--glob', '!dist',
        '--glob', '!build',
        '--glob', '!.next',
        '--glob', '!target',
      ]
      if (!req.caseSensitive) args.push('--ignore-case')
      args.push(req.pattern, req.root)

      const proc = spawn(rgBin, args)
      const matches: Array<{ path: string; lineNo: number; line: string; matchStart: number; matchEnd: number }> = []
      const limit = req.limit ?? 500
      let buf = ''

      proc.stdout.on('data', (chunk: Buffer) => {
        if (matches.length >= limit) return
        buf += chunk.toString()
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim() || matches.length >= limit) continue
          try {
            const obj = JSON.parse(line) as {
              type: string
              data: {
                path: { text: string }
                line_number: number
                lines: { text: string }
                submatches: Array<{ start: number; end: number }>
              }
            }
            if (obj.type === 'match') {
              const sub = obj.data.submatches[0]
              matches.push({
                path: obj.data.path.text,
                lineNo: obj.data.line_number,
                line: obj.data.lines.text.trimEnd(),
                matchStart: sub?.start ?? 0,
                matchEnd: sub?.end ?? 0,
              })
            }
          } catch { /* skip malformed rg output */ }
        }
      })

      proc.on('close', () => resolve({ matches }))
      proc.on('error', (err) => resolve({ matches: [], error: err.message }))
    })
  })
}
