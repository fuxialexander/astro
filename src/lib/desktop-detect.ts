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
    platform?: { isElectron?: boolean; hostname?: string }
  }
}

export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as AstroWindow
  return Boolean(w.astro?.platform?.isElectron)
}

/**
 * Hostname of the machine running the Electron shell (via preload).
 * Empty string when not in desktop mode.
 */
export function desktopHostname(): string {
  if (typeof window === 'undefined') return ''
  const w = window as unknown as AstroWindow
  return w.astro?.platform?.hostname ?? ''
}

/**
 * Heuristic: is `machineHostname` the same machine Electron is running on?
 * Compares the raw hostname and also the short name (pre-first-dot) since
 * registeredMachines often stores `laptop.local` while `os.hostname()`
 * returns `laptop`.
 *
 * NOTE: this is a best-effort check. Two machines with the same short name
 * on the same network (e.g. two laptops both called `studio`) will register
 * as equal and skip the SSH step even though the workdir isn't really here.
 * If that becomes a concern we should move to comparing a machine-generated
 * UUID exposed through the preload instead of a raw hostname.
 */
export function isLocalDesktopHost(machineHostname: string | undefined): boolean {
  if (!machineHostname) return false
  const here = desktopHostname()
  if (!here) return false
  const norm = (h: string) => h.trim().toLowerCase().split('.')[0]
  return norm(here) === norm(machineHostname)
}
