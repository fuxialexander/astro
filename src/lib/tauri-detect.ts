/**
 * Tauri Environment Detection
 *
 * Detects whether the app is running inside a Tauri webview (desktop app)
 * and provides helpers for Tauri-specific configuration.
 *
 * Detection methods:
 * 1. `window.__TAURI__` — injected by the Tauri runtime
 * 2. `VITE_TAURI` env var — set during Tauri builds
 */

/**
 * Returns true when running inside a Tauri webview (desktop app).
 * Checks both runtime injection and build-time env var.
 */
export function isTauri(): boolean {
  if (typeof window !== 'undefined' && '__TAURI__' in window) {
    return true
  }
  return import.meta.env.VITE_TAURI === 'true'
}

/**
 * The API base URL used when running inside Tauri.
 * Points to the local sidecar server.
 */
export function getTauriApiUrl(): string {
  return 'http://localhost:3001'
}
