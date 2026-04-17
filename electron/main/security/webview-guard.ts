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

const APP_ORIGIN = (() => {
  try {
    return new URL(process.env.ASTRO_APP_URL ?? 'https://astroanywhere.com').origin
  } catch {
    return 'https://astroanywhere.com'
  }
})()

// Any URL that can appear in a Supabase/Google/GitHub OAuth redirect chain.
// Keep broad — Google in particular routes through several subdomains
// (accounts, myaccount, ogs, ssl, lh3, oauth2, play, youtube) during consent.
function isOAuthHost(u: URL): boolean {
  const h = u.host
  return (
    /\.supabase\.co$/.test(h) ||
    /(^|\.)google\.com$/.test(h) ||
    /\.googleusercontent\.com$/.test(h) ||
    /(^|\.)gstatic\.com$/.test(h) ||
    /(^|\.)googleapis\.com$/.test(h) ||
    h === 'github.com' ||
    /\.github\.com$/.test(h) ||
    /\.githubusercontent\.com$/.test(h)
  )
}

// Google (and some other OAuth providers) refuse sign-in from user agents
// that advertise "Electron/<ver>" — their RFC 8252 enforcement treats those
// as embedded webviews. Strip that token so the Chromium build underneath
// looks like stock Chrome to the provider.
//
// Trade-off: services that legitimately want to know we're Electron (for
// feature detection or telemetry) lose that signal. window.astro.platform
// still identifies us to first-party code, which is what we care about.
// If that breaks a specific integration, gate this behind an env var.
function patchUserAgent(contents: import('electron').WebContents): void {
  const ua = contents.getUserAgent()
  const clean = ua
    .replace(/\s?Electron\/[\d.]+/i, '')
    .replace(/\s?astro\/[\d.]+/i, '')
  if (clean !== ua) contents.setUserAgent(clean)
}

export function installWebviewGuard(): void {
  app.on('web-contents-created', (_event, contents) => {
    patchUserAgent(contents)
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

    // OAuth popups (Google / GitHub / Supabase) must stay inside the Electron
    // app so the session lands in the same partition as the main window.
    // Anything else (marketing links, docs, issue tracker) punts to the user's
    // default browser via shell.openExternal.
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const u = new URL(url)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return { action: 'deny' }
        }
        if (isOAuthHost(u) || u.origin === APP_ORIGIN) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 500,
              height: 700,
              autoHideMenuBar: true,
              webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
              },
            },
          }
        }
        void shell.openExternal(url)
      } catch {
        // ignore malformed URL
      }
      return { action: 'deny' }
    })

    // Block in-process navigation away from the app's own origins. The
    // packaged app loads https://astroanywhere.com directly (thin shell over
    // the prod web app), so in-origin navigation there must be allowed —
    // otherwise client-side redirects like window.location.href = '/landing/'
    // escape to the user's default browser. External links are still punted
    // to shell.openExternal.
    contents.on('will-navigate', (event, url) => {
      try {
        const u = new URL(url)
        const isDevServer = u.host === 'localhost:5173' || u.host === '127.0.0.1:5173'
        const isFile = u.protocol === 'file:'
        const isPlugin = u.protocol === 'astro-plugin:'
        const isAppOrigin = u.origin === APP_ORIGIN
        // OAuth redirect chain (Supabase → Google/GitHub → callback) must
        // stay in the Electron window so the returned session is written to
        // the app's partition rather than Safari's.
        if (!isDevServer && !isFile && !isPlugin && !isAppOrigin && !isOAuthHost(u)) {
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
