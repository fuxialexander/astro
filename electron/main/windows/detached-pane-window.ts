/**
 * Detached pane window factory.
 *
 * When a user drags a pane tab out of the dockview host, the main process
 * spawns one of these windows and hands it the pane kind + state via URL
 * fragment. The renderer route `/panes/detached` reads the params and
 * mounts a single pane with no dockview wrapper.
 *
 * Security matches the main window: contextIsolation + sandbox +
 * nodeIntegration:false + webSecurity:true. We reuse the `main` preload
 * so the detached window gets the same `window.astro` bridge as the host.
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { windowRegistry } from './registry.js'
import { streamBroker } from '../ipc/broker.js'

const isDev = !app.isPackaged
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173'

export interface CreateDetachedPaneWindowOptions {
  preloadDir: string
  paneKind: string
  paneId: string
  paneTitle: string
  paneState: unknown
}

let detachedCounter = 0

export async function createDetachedPaneWindow(
  options: CreateDetachedPaneWindowOptions,
): Promise<{ window: BrowserWindow; windowId: string }> {
  const windowId = `detached:${options.paneId}:${++detachedCounter}`

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 320,
    minHeight: 240,
    show: false,
    title: options.paneTitle || 'Astro — Detached Pane',
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(options.preloadDir, 'main.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  windowRegistry.register(windowId, win)

  win.webContents.once('did-finish-load', () => {
    streamBroker.attachWindow(win.webContents)
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  // Encode pane state into base64 to keep the URL clean and avoid
  // escaping issues with nested JSON quotes. The renderer decodes it
  // back in src/pages/panes-detached.tsx.
  const stateJson = JSON.stringify({
    id: options.paneId,
    title: options.paneTitle,
    state: options.paneState,
  })
  const stateParam = Buffer.from(stateJson, 'utf8').toString('base64')
  const search = `astroDetached=1&kind=${encodeURIComponent(options.paneKind)}&state=${encodeURIComponent(stateParam)}`

  if (isDev) {
    await win.loadURL(`${DEV_SERVER_URL}/?${search}`)
  } else {
    // Packaged app is a thin shell over the production web app — detached
    // panes load the same remote origin so the React tree (with the bridged
    // preload) runs against the same session as the main window.
    const base = process.env.ASTRO_APP_URL ?? 'https://astroanywhere.com'
    await win.loadURL(`${base}/?${search}`)
  }

  return { window: win, windowId }
}
