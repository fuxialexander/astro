/**
 * API URL shim for Tauri desktop.
 *
 * Routes API calls through the same base URL configured in the desktop
 * api-client (localStorage override or default).
 */
import { getBaseUrl } from '@desktop/lib/api-client'

export const API_BASE_URL = getBaseUrl()

export function apiUrl(path: string): string {
  return `${getBaseUrl()}${path}`
}
