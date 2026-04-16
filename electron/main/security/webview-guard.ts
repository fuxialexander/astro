/**
 * Pin secure webPreferences on every <webview> tag attached to any window,
 * and apply defense-in-depth navigation guards to every top-level webContents.
 *
 * The main window enables `webviewTag: true` so plugin panes can host
 * isolated content in <webview> elements. Without a `will-attach-webview`
 * listener, the renderer can set attributes on the <webview> tag (nodeIntegration,
 * disablewebsecurity, preload, etc.) that downgrade the security baseline.
 * This module enforces sandbox + contextIsolation + nodeIntegration:false on
 * every attach, strips any preload, and denies new-window navigation by
 * default. Block any non-https/astro-plugin: src so a compromised renderer
 * can't load file:// or arbitrary http://.
 *
 * The `will-navigate` and `setWindowOpenHandler` hooks are intentionally
 * installed on every webContents (main window, about window, template window,
 * detached pane windows, plugin <webview> contents). The behavior is the same
 * everywhere: in-process navigation stays within the app shell (file://,
 * dev server, astro-plugin://); external http(s) links open in the user's
 * default browser via shell.openExternal; everything else is denied. If a
 * future child window needs different behavior, carve out an exception here
 * rather than removing the global guard — "fail closed" is the policy.
 */

import { app, shell } from 'electron'

const ALLOWED_SCHEMES = new Set(['https:', 'astro-plugin:'])
// Dev-only: the Vite dev server is reachable on http://localhost:5173, and a
// plugin author experimenting locally may want to embed a dev-server asset in
// a <webview>. Restricted to localhost hosts and only when the main window
// itself was loaded from the dev server.
const DEV_HOSTS = new Set(['localhost', '127.0.0.1'])
const isDev = !!process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL

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

      // Reject src schemes outside the allowlist. In dev, additionally allow
      // http://localhost:*|127.0.0.1:* so plugin authors can point a webview
      // at a local dev server without tripping the guard.
      try {
        const url = new URL(params.src)
        const isAllowedScheme = ALLOWED_SCHEMES.has(url.protocol)
        const isDevHttp = isDev && url.protocol === 'http:' && DEV_HOSTS.has(url.hostname)
        if (!isAllowedScheme && !isDevHttp) {
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
    //
    // Production frontend origins (astroanywhere.com) are intentionally NOT
    // allowed here: the packaged app is a file:// shell and must stay on that
    // shell. An in-process navigation to astroanywhere.com would replace the
    // app with the web frontend and lose the main-process bridge. External
    // links (OAuth callbacks, marketing links) are opened in the user's
    // browser via shell.openExternal below.
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
