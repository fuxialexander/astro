/**
 * Auto-updater — wraps electron-updater with hourly polling and renderer
 * notification. When an update is downloaded the main window receives an
 * `updater:ready` push so the renderer can show a "Restart to update" banner.
 *
 * Flow:
 *   1. checkForUpdatesAndNotify() runs on startup + every hour
 *   2. On update-downloaded  → win.webContents.send('updater:ready', { version })
 *   3. Renderer shows banner → user clicks "Restart" → invoke('updater:install')
 *   4. installUpdate()       → autoUpdater.quitAndInstall()
 */

import { app } from 'electron'
import { windowRegistry } from './windows/registry.js'

const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

let started = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _autoUpdater: any = null

export function setupAutoUpdater(): void {
  if (started) return
  started = true

  if (!app.isPackaged) {
    console.log('[updater] skipping: not a packaged build')
    return
  }

  void (async () => {
    try {
      const specifier = 'electron-updater'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(/* @vite-ignore */ specifier)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const autoUpdater: any = mod.autoUpdater
      _autoUpdater = autoUpdater

      autoUpdater.logger = {
        info: (m: unknown) => console.log('[updater]', m),
        warn: (m: unknown) => console.warn('[updater]', m),
        error: (m: unknown) => console.error('[updater]', m),
        debug: (m: unknown) => console.debug('[updater]', m),
      }

      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true

      autoUpdater.on('error', (err: Error) => {
        const msg = err?.message ?? String(err)
        if (msg.includes('No published versions') || msg.includes('404')) {
          console.warn('[updater] no releases found yet:', msg)
          return
        }
        console.error('[updater] error:', err)
      })

      autoUpdater.on('update-available', (info: { version?: string }) => {
        console.log('[updater] update available:', info?.version)
      })

      autoUpdater.on('update-not-available', () => {
        console.log('[updater] up to date')
      })

      autoUpdater.on('update-downloaded', (info: { version?: string }) => {
        const version = info?.version ?? 'unknown'
        console.log('[updater] update downloaded:', version)
        const win = windowRegistry.get('main')
        win?.webContents.send('updater:ready', { version })
      })

      const check = async () => {
        try {
          await autoUpdater.checkForUpdatesAndNotify()
        } catch (err) {
          console.warn('[updater] check failed:', err)
        }
      }

      void check()
      setInterval(check, CHECK_INTERVAL_MS)
    } catch (err) {
      console.warn('[updater] electron-updater not available:', err)
    }
  })()
}

export function installUpdate(): void {
  if (!_autoUpdater) {
    console.warn('[updater] installUpdate called before autoUpdater was ready')
    return
  }
  _autoUpdater.quitAndInstall()
}
