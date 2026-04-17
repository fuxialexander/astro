/**
 * Content-Security-Policy installer.
 *
 * Ported from the legacy Tauri shell, plus the extra origins required when
 * running against the Vite dev server in dev mode (HMR websocket, Tailwind
 * injected styles, font CDNs preconnected by index.html).
 *
 * In Phase 1+ this is extended with the local server origin (127.0.0.1:3001)
 * once the server utilityProcess starts binding.
 */

import { app, session } from 'electron'

const isDev = !app.isPackaged

// Packaged renderer loads https://astroanywhere.com. The prod site needs to
// talk to Supabase (auth), Cloudflare Insights (analytics), and a few
// research APIs the app links out to. Keep frame-ancestors/object-src locked
// down; open up connect-src/script-src enough for the real app to work.
const PROD_CSP = [
  "default-src 'self' https://astroanywhere.com",
  "script-src 'self' 'unsafe-inline' https://astroanywhere.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://astroanywhere.com https://fonts.googleapis.com",
  "connect-src 'self' https://astroanywhere.com https://*.astroanywhere.com wss://*.astroanywhere.com https://*.supabase.co wss://*.supabase.co https://cloudflareinsights.com https://*.cloudflareinsights.com https://api.unpaywall.org https://api.zotero.org https://api.crossref.org https://fonts.googleapis.com https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://astroanywhere.com https://*.astroanywhere.com",
].join('; ')

const DEV_CSP = [
  "default-src 'self' http://localhost:5173 ws://localhost:5173",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173",
  "style-src 'self' 'unsafe-inline' http://localhost:5173 https://fonts.googleapis.com",
  "connect-src 'self' http://localhost:5173 ws://localhost:5173 http://127.0.0.1:3001 ws://127.0.0.1:3002 http://localhost:3001 ws://localhost:3002 https://api.astroanywhere.com wss://api.astroanywhere.com https://api.unpaywall.org https://api.zotero.org https://api.crossref.org https://fonts.googleapis.com https://fonts.gstatic.com",
  "img-src 'self' data: blob: https: http://localhost:5173",
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const APP_ORIGIN = (() => {
  try {
    return new URL(process.env.ASTRO_APP_URL ?? 'https://astroanywhere.com').origin
  } catch {
    return 'https://astroanywhere.com'
  }
})()

export function installCSP(): void {
  const csp = isDev ? DEV_CSP : PROD_CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Only attach our CSP to responses from the app's own origin. Third-party
    // origins (Google/Supabase/GitHub OAuth pages) must keep their own CSP —
    // overwriting it breaks their sign-in flows.
    let shouldAttach = false
    try {
      const u = new URL(details.url)
      shouldAttach = u.origin === APP_ORIGIN || u.protocol === 'file:'
    } catch {
      // malformed URL — skip injection rather than corrupt headers
    }
    if (!shouldAttach) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}
