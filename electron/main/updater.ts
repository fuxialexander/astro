/**
 * Auto-updater skeleton — Phase 5.
 *
 * Wraps `electron-updater`'s autoUpdater with a 1-hour polling interval
 * and graceful failure when no publish channel is configured. The
 * updater is only wired from a packaged app (app.isPackaged); dev runs
 * via `electron:dev` are no-ops.
 *
 * TODO(phase5): configure a real publish provider (GitHub releases or
 * S3) in forge.config.ts once release infrastructure is in place, then
 * remove the "no update server configured" guard below.
 */

import { app } from 'electron'

const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

let started = false

export function setupAutoUpdater(): void {
  if (started) return
  started = true

  if (!app.isPackaged) {
    console.log('[updater] skipping: not a packaged build')
    return
  }

  // Dynamic import so electron-updater is only loaded in packaged builds.
  // Using an async IIFE keeps the public API synchronous. We import via a
  // variable specifier so TypeScript doesn't try to resolve the module at
  // compile time — the real types come from the installed package at
  // runtime in packaged builds.
  void (async () => {
    try {
      const specifier = 'electron-updater'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(/* @vite-ignore */ specifier)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const autoUpdater: any = mod.autoUpdater

      autoUpdater.logger = {
        info: (m: unknown) => console.log('[updater]', m),
        warn: (m: unknown) => console.warn('[updater]', m),
        error: (m: unknown) => console.error('[updater]', m),
        debug: (m: unknown) => console.debug('[updater]', m),
      }

      autoUpdater.on('error', (err: Error) => {
        // A missing publish config manifests as an error here — downgrade
        // to a warning so we don't spam stderr in unreleased builds.
        const msg = err?.message ?? String(err)
        if (msg.includes('No published versions') || msg.includes('404')) {
          console.warn('[updater] no update server configured (yet):', msg)
          return
        }
        console.error('[updater] error:', err)
      })

      autoUpdater.on('update-available', (info: { version?: string }) => {
        console.log('[updater] update available:', info?.version)
      })
      autoUpdater.on('update-not-available', () => {
        console.log('[updater] no update available')
      })
      autoUpdater.on('update-downloaded', (info: { version?: string }) => {
        console.log('[updater] update downloaded:', info?.version)
      })

      const check = async () => {
        try {
          await autoUpdater.checkForUpdatesAndNotify()
        } catch (err) {
          console.warn('[updater] check failed:', err)
        }
      }

      // Kick off the first check immediately, then every hour.
      void check()
      setInterval(check, CHECK_INTERVAL_MS)
    } catch (err) {
      console.warn('[updater] electron-updater not available:', err)
    }
  })()
}
