/**
 * Desktop auto-updater wired for Electron Forge + GitHub releases via the
 * official update.electronjs.org service. This intentionally avoids
 * `electron-updater` and its builder-specific `app-update.yml` metadata.
 *
 * Flow:
 *   1. updateElectronApp() configures the built-in Electron autoUpdater
 *   2. Startup check runs immediately, then every hour
 *   3. On update-downloaded → renderer receives `updater:ready`
 *   4. Renderer/menu triggers installUpdate() → autoUpdater.quitAndInstall()
 */

import { app, autoUpdater } from 'electron'
import { updateElectronApp, UpdateSourceType } from 'update-electron-app'
import { windowRegistry } from './windows/registry.js'
const DESKTOP_RELEASE_REPO = 'astro-anywhere/astro-desktop'

let started = false
let updaterConfigured = false
let unavailableReason: string | null = null
let downloadedVersion: string | null = null

function resolveUpdaterAvailability(): string | null {
  if (!app.isPackaged) {
    return 'Not a packaged build'
  }
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return `Auto-update is only supported on macOS and Windows, not ${process.platform}`
  }
  return null
}

function notifyUpdateReady(version: string): void {
  downloadedVersion = version
  const win = windowRegistry.get('main')
  win?.webContents.send('updater:ready', { version })
}

export function setupAutoUpdater(): void {
  if (started) return
  started = true

  unavailableReason = resolveUpdaterAvailability()
  if (unavailableReason) {
    console.log('[updater] skipping:', unavailableReason)
    return
  }

  try {
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: DESKTOP_RELEASE_REPO,
      },
      updateInterval: '1 hour',
      notifyUser: false,
      logger: {
        log: (...args: unknown[]) => console.log('[updater]', ...args),
      },
    })
    updaterConfigured = true

    autoUpdater.on('error', (err) => {
      console.error('[updater] error:', err)
    })

    autoUpdater.on('checking-for-update', () => {
      console.log('[updater] checking for updates')
    })

    autoUpdater.on('update-available', (info) => {
      console.log('[updater] update available:', info?.version)
    })

    autoUpdater.on('update-not-available', () => {
      console.log('[updater] up to date')
    })

    autoUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
      const version = releaseName || downloadedVersion || 'unknown'
      console.log('[updater] update downloaded:', version)
      notifyUpdateReady(version)
    })
  } catch (err) {
    unavailableReason = err instanceof Error ? err.message : String(err)
    updaterConfigured = false
    console.warn('[updater] failed to initialize:', err)
  }
}

export function installUpdate(): void {
  if (!updaterConfigured) {
    console.warn('[updater] installUpdate called before updater was ready')
    return
  }
  autoUpdater.quitAndInstall()
}

export type UpdateCheckResult =
  | { status: 'up-to-date' }
  | { status: 'available'; version: string }
  | { status: 'downloaded'; version: string }
  | { status: 'unavailable'; reason: string }

export async function checkForUpdatesManual(): Promise<UpdateCheckResult> {
  if (!updaterConfigured) {
    return {
      status: 'unavailable',
      reason: unavailableReason ?? 'Auto-updater is not configured',
    }
  }

  if (downloadedVersion) {
    return { status: 'downloaded', version: downloadedVersion }
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
    const onDownloaded = (_event: unknown, _notes: unknown, releaseName?: string) => {
      cleanup()
      const version = releaseName || downloadedVersion || 'unknown'
      resolve({ status: 'downloaded', version })
    }
    const onError = (err: Error) => {
      cleanup()
      resolve({ status: 'unavailable', reason: err?.message ?? String(err) })
    }
    const cleanup = () => {
      autoUpdater.removeListener('update-not-available', onNotAvailable)
      autoUpdater.removeListener('update-available', onAvailable)
      autoUpdater.removeListener('update-downloaded', onDownloaded)
      autoUpdater.removeListener('error', onError)
    }

    autoUpdater.once('update-not-available', onNotAvailable)
    autoUpdater.once('update-available', onAvailable)
    autoUpdater.once('update-downloaded', onDownloaded)
    autoUpdater.once('error', onError)

    try {
      autoUpdater.checkForUpdates()
    } catch (err) {
      cleanup()
      resolve({
        status: 'unavailable',
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
