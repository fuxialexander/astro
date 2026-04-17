/**
 * Main window factory. Loads the existing src/main.tsx SPA — in dev via the
 * Vite dev server (port 5173), in prod from the Vite-built dist/index.html.
 *
 * No new HTML wrapper is created for the main window: we deliberately reuse
 * the same `index.html` + `src/main.tsx` entry point that the web build uses,
 * so the Electron and web targets ship the same React tree.
 *
 * webPreferences match the security baseline from the migration plan
 * (contextIsolation + sandbox + nodeIntegration:false).
 */

import { app, BrowserWindow } from 'electron'
import { windowRegistry } from './registry.js'
import { streamBroker } from '../ipc/broker.js'

const isDev = !app.isPackaged
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173'
const PROD_APP_URL = process.env.ASTRO_APP_URL ?? 'https://astroanywhere.com'

export interface CreateMainWindowOptions {
  preloadDir: string
}

export async function createMainWindow(options: CreateMainWindowOptions): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 640,
    minHeight: 480,
    show: false, // show after first paint to avoid white flash
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
    vibrancy: 'under-window',
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(options.preloadDir, 'main.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true, // Phase 4: plugin UIs render in <webview> panels
    },
  })

  windowRegistry.register('main', win)

  // Hand the renderer a MessagePort for high-frequency stream subscriptions.
  // Must be done after the webContents is loaded, otherwise postMessage
  // queues against a dead frame. did-finish-load is the safest hook.
  win.webContents.once('did-finish-load', () => {
    streamBroker.attachWindow(win.webContents)
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  if (isDev) {
    await win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Packaged app is a thin shell over the production web app — HTTPS origin
    // is required for WebAuthn/passkeys and lets the page talk to the remote
    // Supabase and Fly backend normally. The preload still exposes window.astro,
    // so isDesktop() returns true and desktop-only panes (terminal/file/git)
    // light up for the remote page.
    await win.loadURL(PROD_APP_URL)
    if (process.env.ASTRO_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  }

  return win
}
