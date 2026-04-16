/**
 * Electron main process entry.
 *
 * Phase 1 scope: boot app, start the server utilityProcess (Hono + relay +
 * PGlite + dispatch engine) via the supervisor, then create the main window
 * pointed at the Vite dev server (dev) or built `dist/index.html` (prod).
 * No IPC and no workers yet — Phase 2 adds those.
 *
 * Architectural rules (see /Users/xf2217/.claude/plans/piped-sleeping-robin.md):
 *   - Main process is thin. Coordination + window lifecycle only.
 *   - All windows: contextIsolation + sandbox + nodeIntegration:false.
 *   - CSP installed via webRequest headers (see ./security/csp.ts).
 */

import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { installCSP } from './security/csp.js'
import { registerPluginProtocol } from './security/plugin-protocol.js'
import { installWebviewGuard } from './security/webview-guard.js'
import { createMainWindow } from './windows/main-window.js'
import { windowRegistry } from './windows/registry.js'
import { serverSupervisor } from './services/supervisor.js'
import { registerAllChannels } from './ipc/channels/index.js'
import * as pluginLoader from './plugin/loader.js'
import { setupAutoUpdater } from './updater.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Single-instance lock — running a second copy focuses the existing window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const main = windowRegistry.get('main')
    if (main) {
      if (main.isMinimized()) main.restore()
      main.focus()
    }
  })
}

// Pin secure webPreferences on every <webview> attached anywhere in the app.
// Must run before any window is created so the listener catches the very
// first webContents (the main window itself).
installWebviewGuard()

app.whenReady().then(async () => {
  installCSP()
  registerPluginProtocol()

  // Register every typed IPC channel before any window can call `invoke`.
  // Safe to do before the supervisor — handlers that depend on it
  // (`server:*`) read its status lazily.
  registerAllChannels()

  // Boot the server utilityProcess BEFORE the main window so the renderer
  // never sees a flash of "API offline". The supervisor blocks until
  // /api/health responds.
  try {
    await serverSupervisor.start()
  } catch (err) {
    console.error('[electron-main] server failed to start:', err)
    // Fail-fast: don't show a broken main window. Quit and let the user
    // see the error in logs (Phase 2 will show a real error dialog).
    app.exit(1)
    return
  }

  await createMainWindow({ preloadDir: path.join(__dirname, '../preload') })

  // Auto-updater — no-op in dev, polls every hour in packaged builds.
  setupAutoUpdater()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow({ preloadDir: path.join(__dirname, '../preload') })
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Critical: stop the server cleanly before quit so PGlite releases its
// data-dir lockfile. will-quit fires after windows are closed but before
// the process exits, and event.preventDefault() lets us await async work.
let cleanedUp = false
app.on('will-quit', (event) => {
  if (cleanedUp) return
  event.preventDefault()
  void Promise.allSettled([
    serverSupervisor.stop(),
    pluginLoader.shutdownAllPlugins(),
  ]).finally(() => {
    cleanedUp = true
    app.quit()
  })
})

// Surface unhandled errors instead of swallowing them.
process.on('uncaughtException', (err) => {
  console.error('[electron-main] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[electron-main] unhandledRejection:', reason)
})
