/**
 * Shared test setup and helpers for CLI integration tests.
 *
 * Integration tests auto-skip when the local API server is not running.
 * Start the server with `npm run dev:local` before running these tests.
 */

const SERVER_URL = 'http://localhost:3001'

/**
 * Check if the API server is reachable.
 */
export async function isServerAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Get the server URL for tests.
 */
export function getTestServerUrl(): string {
  return SERVER_URL
}

/**
 * Conditional describe that skips the block if the server is not available.
 * Usage: describeIfServer('my tests', () => { ... })
 */
let _serverAvailable: boolean | null = null

export async function checkServer(): Promise<boolean> {
  if (_serverAvailable === null) {
    _serverAvailable = await isServerAvailable()
  }
  return _serverAvailable
}
