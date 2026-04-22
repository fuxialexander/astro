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
import { autoUpdater } from 'electron-updater'
import { windowRegistry } from './windows/registry.js'

const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

let started = false
let _autoUpdater: typeof autoUpdater | null = null

export function setupAutoUpdater(): void {
  if (started) return
  started = true

  if (!app.isPackaged) {
    console.log('[updater] skipping: not a packaged build')
    return
  }

  try {
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
}

export function installUpdate(): void {
  if (!_autoUpdater) {
    console.warn('[updater] installUpdate called before autoUpdater was ready')
    return
  }
  _autoUpdater.quitAndInstall()
}

export type UpdateCheckResult =
  | { status: 'up-to-date' }
  | { status: 'available'; version: string }
  | { status: 'downloaded'; version: string }
  | { status: 'unavailable'; reason: string }

export async function checkForUpdatesManual(): Promise<UpdateCheckResult> {
  if (!_autoUpdater) {
    return { status: 'unavailable', reason: 'Not a packaged build' }
  }
  return new Promise((resolve) => {
    const onNotAvailable = () => {
      cleanup()
      resolve({ status: 'up-to-date' })
    }
    const onAvailable = (info: { version?: string }) => {
      cleanup()
      resolve({ status: 'available', version: info?.version ?? 'unknown' })
    }
    const onDownloaded = (info: { version?: string }) => {
      cleanup()
      resolve({ status: 'downloaded', version: info?.version ?? 'unknown' })
    }
    const onError = (err: Error) => {
      cleanup()
      resolve({ status: 'unavailable', reason: err?.message ?? String(err) })
    }
    const cleanup = () => {
      _autoUpdater.removeListener('update-not-available', onNotAvailable)
      _autoUpdater.removeListener('update-available', onAvailable)
      _autoUpdater.removeListener('update-downloaded', onDownloaded)
      _autoUpdater.removeListener('error', onError)
    }
    _autoUpdater.once('update-not-available', onNotAvailable)
    _autoUpdater.once('update-available', onAvailable)
    _autoUpdater.once('update-downloaded', onDownloaded)
    _autoUpdater.once('error', onError)
    void _autoUpdater.checkForUpdates().catch((err: unknown) => {
      cleanup()
      resolve({ status: 'unavailable', reason: String(err) })
    })
  })
}
