/**
 * Server-side error handling utilities.
 *
 * Consolidates the repeated `e instanceof Error ? e.message : 'Unknown error'`
 * pattern used 35+ times across route handlers and provider adapters.
 */

/** Extract a human-readable message from an unknown caught value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

/** Check if an error is an AbortError (from AbortController). */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
