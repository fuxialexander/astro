/**
 * About window (Phase 5).
 *
 * A tiny modal-ish BrowserWindow showing app name, version, Electron
 * version, Chromium version, Node version, and license. It's not a real
 * OS modal — Electron's `parent` + `modal: true` disables interaction
 * with the parent while it's open, which is what we want.
 *
 * Content is a minimal React renderer under `electron/renderers/about_window/`.
 * Version data is passed through the preload bridge via `getVersions()`,
 * not via IPC, because it's static and cheap.
 *
 * Security: contextIsolation + sandbox + nodeIntegration:false + webSecurity:true.
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { windowRegistry } from './registry.js'

let versionsHandlerRegistered = false
function registerVersionsHandlerOnce(): void {
  if (versionsHandlerRegistered) return
  versionsHandlerRegistered = true
  ipcMain.handle('about:get-versions', () => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node ?? 'unknown',
    v8: process.versions.v8 ?? 'unknown',
  }))
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173'

export interface CreateAboutWindowOptions {
  preloadDir: string
}

export async function showAboutWindow(
  options: CreateAboutWindowOptions
): Promise<BrowserWindow> {
  registerVersionsHandlerOnce()

  const existing = windowRegistry.get('about')
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return existing
  }

  const parent = windowRegistry.get('main')

  const win = new BrowserWindow({
    width: 420,
    height: 320,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: `About ${app.getName()}`,
    parent,
    modal: Boolean(parent),
    show: false,
    backgroundColor: '#0C0C0E',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(options.preloadDir, 'about.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  windowRegistry.register('about', win)

  win.once('ready-to-show', () => {
    win.show()
  })

  if (isDev) {
    await win.loadURL(`${DEV_SERVER_URL}/electron/renderers/about_window/index.html`)
  } else {
    const indexPath = path.join(__dirname, '../../renderers/about_window/index.html')
    await win.loadFile(indexPath)
  }

  return win
}
