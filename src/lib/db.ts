import { get, set, clear } from "idb-keyval"

/**
 * IndexedDB storage utilities for local-only mode
 *
 * IMPORTANT: IndexedDB mode is designed for single-user development only.
 * It does NOT provide multi-tenancy isolation. All data is stored in the same
 * browser database without user-specific namespacing.
 *
 * For multi-user production deployments, use Supabase mode which provides
 * proper authentication and row-level security (RLS).
 *
 * User Switching Warning:
 * If you switch users in auth (e.g., dev mode), you should clear IndexedDB
 * manually to avoid data leakage between "users". This is by design - IndexedDB
 * mode assumes a single local user.
 */

// Track current user ID to detect user switches
let currentUserId: string | null = null

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
