/**
 * Runtime check for whether we're running inside the Electron shell.
 *
 * The preload script exposes `window.astro` only when running in the
 * Electron renderer. Web builds (Cloudflare Pages) never have it.
 *
 * Use this to gate desktop-only features: terminal pane, file browser,
 * git pane, native dialogs. Keep the gate cheap — no async, no SSR concerns.
 */

interface AstroWindow {
  astro?: {
    platform?: { isElectron?: boolean }
  }
}

export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as AstroWindow
  return Boolean(w.astro?.platform?.isElectron)
}
