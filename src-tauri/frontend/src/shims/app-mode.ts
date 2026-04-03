/**
 * App mode shim for Tauri desktop.
 *
 * The desktop app always talks to a backend server (local or remote),
 * so it behaves like "server mode" for UI purposes — showing machine
 * selectors, provider dropdowns, etc.
 */

export type AppMode = 'local' | 'server'

export function getAppMode(): AppMode {
  return 'server'
}

export function isLocalMode(): boolean {
  return false
}

export function isServerMode(): boolean {
  return true
}
