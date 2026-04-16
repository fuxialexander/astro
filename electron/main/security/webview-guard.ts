/**
 * Pin secure webPreferences on every <webview> tag attached to any window.
 *
 * The main window enables `webviewTag: true` so plugin panes can host
 * isolated content in <webview> elements. Without a `will-attach-webview`
 * listener, the renderer can set attributes on the <webview> tag (nodeIntegration,
 * disablewebsecurity, preload, etc.) that downgrade the security baseline.
 * This module enforces sandbox + contextIsolation + nodeIntegration:false on
 * every attach, strips any preload, and denies new-window navigation by
 * default. Block any non-https/astro-plugin: src so a compromised renderer
 * can't load file:// or arbitrary http://.
 */

import { app, shell } from 'electron'

const ALLOWED_SCHEMES = new Set(['https:', 'astro-plugin:'])

export function installWebviewGuard(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (_e, webPreferences, params) => {
      // Force the security baseline regardless of what the renderer requested.
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInWorker = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.webSecurity = true
      delete webPreferences.preload
      delete (webPreferences as Record<string, unknown>).preloadURL

      // Reject src schemes outside the allowlist.
      try {
        const url = new URL(params.src)
        if (!ALLOWED_SCHEMES.has(url.protocol)) {
          params.src = 'about:blank'
        }
      } catch {
        params.src = 'about:blank'
      }
    })

    // Open new windows in the user's browser, never as a child BrowserWindow.
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const u = new URL(url)
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          void shell.openExternal(url)
        }
      } catch {
        // ignore malformed URL
      }
      return { action: 'deny' }
    })

    // Block in-process navigation away from the app's own origins.
    contents.on('will-navigate', (event, url) => {
      try {
        const u = new URL(url)
        const isDevServer = u.host === 'localhost:5173' || u.host === '127.0.0.1:5173'
        const isFile = u.protocol === 'file:'
        const isPlugin = u.protocol === 'astro-plugin:'
        if (!isDevServer && !isFile && !isPlugin) {
          event.preventDefault()
          if (u.protocol === 'http:' || u.protocol === 'https:') {
            void shell.openExternal(url)
          }
        }
      } catch {
        event.preventDefault()
      }
    })
  })
}
