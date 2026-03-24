/**
 * API URL Configuration
 *
 * Centralizes API base URL logic for development and production:
 * - Development: use relative URLs (Vite proxy → localhost:3001)
 * - Production: use Fly.io backend URL directly (bypass Cloudflare for SSE)
 * - Tauri (desktop app): always use http://localhost:3001 (local sidecar)
 */

import { isTauri, getTauriApiUrl } from './tauri-detect'

/**
 * Get the API base URL.
 * - Tauri: http://localhost:3001 (local sidecar)
 * - Development: empty string (use relative URLs)
 * - Production: Fly.io backend URL from environment variable
 */
export const API_BASE_URL = isTauri()
  ? getTauriApiUrl()
  : (import.meta.env.VITE_API_BASE_URL || '')

/**
 * Build a full API URL from a path.
 * @param path - API path (e.g., "/api/health")
 * @returns Full URL (e.g., "https://astro-backend.fly.dev/api/health" in prod)
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`
}
