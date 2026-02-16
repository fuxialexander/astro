import { get, set, clear } from "idb-keyval"

/**
 * IndexedDB storage utilities for local-only mode
 *
 * IMPORTANT: IndexedDB mode is designed for single-user per browser.
 * Each browser generates a unique user ID that persists across sessions.
 * This provides basic user isolation when multiple people use different browsers.
 *
 * For multi-user production deployments with proper authentication,
 * use Supabase mode which provides row-level security (RLS).
 *
 * User Switching Warning:
 * If you switch users in auth (e.g., dev mode), you should clear IndexedDB
 * manually to avoid data leakage between "users".
 */

// Track current user ID to detect user switches
let currentUserId: string | null = null

// Key for storing the persistent browser user ID
const BROWSER_USER_ID_KEY = 'nexus-browser-user-id'

/**
 * Set the current user ID for IndexedDB operations
 * Warns if switching users (which requires manual data clearing)
 */
export function setCurrentUser(userId: string | null) {
  if (currentUserId && userId && currentUserId !== userId) {
    console.warn(
      '[db] ⚠️  User ID changed in IndexedDB mode.',
      'IndexedDB does not provide multi-tenancy isolation.',
      'Clear browser storage to avoid data leakage between users.'
    )
  }
  currentUserId = userId
}

/**
 * Get current user ID (for debugging)
 */
export function getCurrentUser(): string | null {
  return currentUserId
}

/**
 * Get or generate a persistent user ID for this browser.
 * In IndexedDB mode, each browser gets a unique UUID that persists across sessions.
 * This provides basic user isolation when multiple people use different browsers.
 */
export async function getBrowserUserId(): Promise<string> {
  // Try to load existing browser user ID
  const existingId = await get<string>(BROWSER_USER_ID_KEY)

  if (existingId) {
    return existingId
  }

  // Generate a new UUID for this browser using the browser's built-in crypto API
  const newId = crypto.randomUUID()
  await set(BROWSER_USER_ID_KEY, newId)
  console.log('[db] Generated new browser user ID:', newId)

  return newId
}

/**
 * Load state from IndexedDB
 * Keys are NOT prefixed by user ID (single-user design)
 */
export async function loadState<T>(key: string): Promise<T | undefined> {
  return get<T>(key)
}

/**
 * Save state to IndexedDB
 * Keys are NOT prefixed by user ID (single-user design)
 */
export async function saveState<T>(key: string, value: T): Promise<void> {
  await set(key, value)
}

/**
 * Clear all IndexedDB data
 * Use when switching users or resetting state
 */
export async function clearAllData(): Promise<void> {
  await clear()
  console.log('[db] All IndexedDB data cleared')
}
