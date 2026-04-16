/**
 * Custom `astro-plugin://` protocol handler.
 *
 * Renderer-side plugin panes (`src/components/panes/kinds/plugin-pane.tsx`)
 * load iframes/webviews from `astro-plugin://<pluginId>/<path>` so each
 * plugin has an isolated origin. This module registers the scheme as a
 * privileged standard/secure scheme at import time (required before
 * `app.whenReady`), then installs a handler that serves files out of
 * `<userData>/plugins/<pluginId>/...` with a path-traversal guard.
 */

import { app, net, protocol } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Must run before app.whenReady() — calling at module import time satisfies
// that constraint because electron/main/index.ts imports this file at top.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'astro-plugin',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
])

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wasm': 'application/wasm',
}

function guessMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

export function registerPluginProtocol(): void {
  const pluginsRoot = path.join(app.getPath('userData'), 'plugins')

  protocol.handle('astro-plugin', async (request) => {
    try {
      const url = new URL(request.url)
      const pluginId = url.host
      if (!pluginId) {
        return new Response('missing plugin id', { status: 400 })
      }

      // Strip leading slash and decode.
      const rawPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const pluginDir = path.resolve(pluginsRoot, pluginId)
      const absolute = path.resolve(pluginDir, rawPath || 'index.html')

      // Path traversal guard: resolved path MUST stay inside pluginDir.
      const rel = path.relative(pluginDir, absolute)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return new Response('forbidden', { status: 403 })
      }

      try {
        const stat = await fs.stat(absolute)
        if (!stat.isFile()) {
          return new Response('not found', { status: 404 })
        }
      } catch {
        return new Response('not found', { status: 404 })
      }

      // Prefer net.fetch(file://) so Electron handles streaming + range
      // requests correctly; patch the content-type header based on extension.
      const response = await net.fetch(pathToFileURL(absolute).href)
      const headers = new Headers(response.headers)
      headers.set('content-type', guessMime(absolute))
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch (err) {
      console.error('[plugin-protocol] handler error:', err)
      return new Response('internal error', { status: 500 })
    }
  })
}
