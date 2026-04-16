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

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "connect-src 'self' http://127.0.0.1:3001 ws://127.0.0.1:3002 https://api.astroanywhere.com wss://api.astroanywhere.com https://api.unpaywall.org https://api.zotero.org https://api.crossref.org https://fonts.googleapis.com https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
].join('; ')

const DEV_CSP = [
  "default-src 'self' http://localhost:5173 ws://localhost:5173",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173",
  "style-src 'self' 'unsafe-inline' http://localhost:5173 https://fonts.googleapis.com",
  "connect-src 'self' http://localhost:5173 ws://localhost:5173 http://127.0.0.1:3001 ws://127.0.0.1:3002 http://localhost:3001 ws://localhost:3002 https://api.astroanywhere.com wss://api.astroanywhere.com https://api.unpaywall.org https://api.zotero.org https://api.crossref.org https://fonts.googleapis.com https://fonts.gstatic.com",
  "img-src 'self' data: blob: https: http://localhost:5173",
  "font-src 'self' data: https://fonts.gstatic.com",
].join('; ')

export function installCSP(): void {
  const csp = isDev ? DEV_CSP : PROD_CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}
