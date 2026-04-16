/**
 * Template window (Phase 5).
 *
 * This file is a documented scaffold. Copy it when you need to add a new
 * auxiliary window to Astro. See `electron/renderers/template_window/README.md`
 * for a step-by-step.
 *
 * Pattern:
 *   1. Main-process factory (this file) — creates the BrowserWindow with
 *      the security baseline (contextIsolation + sandbox + nodeIntegration:false
 *      + webSecurity:true) and registers it in `windowRegistry`.
 *   2. Preload bridge (`electron/preload/<name>.ts`) — exposes exactly one
 *      `window.astro` namespace via contextBridge, with only the IPC
 *      surface this window needs.
 *   3. Renderer entry (`electron/renderers/<name>/{index.html,main.tsx}`)
 *      — a minimal React app. Keep it small: aux windows should load
 *      instantly and not pull in the full app bundle.
 *   4. IPC schema (`electron/main/ipc/schema/windows.ts`) + handler
 *      (`electron/main/ipc/channels/windows.ts`) — adds a `windows:open-<name>`
 *      channel so the main window can trigger it via `invoke`.
 *   5. Vite input (`electron/vite.renderer.config.ts`) — add your
 *      `index.html` as a rollup input so it ships in the build.
 *
 * Security: contextIsolation + sandbox + nodeIntegration:false + webSecurity:true.
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { windowRegistry } from './registry.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173'

export interface CreateTemplateWindowOptions {
  preloadDir: string
}

export async function showTemplateWindow(
  options: CreateTemplateWindowOptions
): Promise<BrowserWindow> {
  const existing = windowRegistry.get('template')
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return existing
  }

  const win = new BrowserWindow({
    width: 640,
    height: 480,
    show: false,
    backgroundColor: '#0C0C0E',
    title: 'Template Window',
    webPreferences: {
      preload: path.join(options.preloadDir, 'template.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  windowRegistry.register('template', win)

  win.once('ready-to-show', () => {
    win.show()
  })

  if (isDev) {
    await win.loadURL(`${DEV_SERVER_URL}/electron/renderers/template_window/index.html`)
  } else {
    const indexPath = path.join(__dirname, '../../renderers/template_window/index.html')
    await win.loadFile(indexPath)
  }

  return win
}
