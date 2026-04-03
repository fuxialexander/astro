/**
 * HTTP client for the Astro backend API.
 *
 * Wraps fetch() with a configurable base URL (defaults to localhost:3001).
 * The desktop app talks to the same backend as the web app.
 */

const DEFAULT_BASE_URL = 'https://api.astroanywhere.com'

let baseUrl = DEFAULT_BASE_URL

/** Update the backend base URL (e.g., from settings or env). */
export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/$/, '') // strip trailing slash
}

/** Get the current backend base URL. */
export function getBaseUrl(): string {
  return baseUrl
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /** Team ID header for multi-tenant requests */
  teamId?: string
}

/**
 * Make an API request to the Astro backend.
 *
 * @param path - API path (e.g., '/api/data/projects')
 * @param options - Fetch options with typed body
 * @returns Parsed JSON response
 * @throws Error with status code and message on failure
 */
export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { body, teamId, headers: extraHeaders, ...fetchOptions } = options

  const headers = new Headers(extraHeaders)
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  if (teamId) {
    headers.set('X-Team-Id', teamId)
  }

  const url = `${baseUrl}${path}`

  const response = await fetch(url, {
    ...fetchOptions,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new ApiError(response.status, errorText, url)
  }

  // Handle empty responses (204, etc.)
  const contentType = response.headers.get('content-type')
  if (response.status === 204 || !contentType?.includes('application/json')) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export class ApiError extends Error {
  readonly status: number
  readonly body: string
  readonly url: string

  constructor(status: number, body: string, url: string) {
    super(`API ${status}: ${body} (${url})`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.url = url
  }
}

// ── Convenience methods ──────────────────────────────────────────────

export const api = {
  get<T = unknown>(path: string, options?: ApiRequestOptions) {
    return apiRequest<T>(path, { ...options, method: 'GET' })
  },

  post<T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) {
    return apiRequest<T>(path, { ...options, method: 'POST', body })
  },

  put<T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) {
    return apiRequest<T>(path, { ...options, method: 'PUT', body })
  },

  patch<T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) {
    return apiRequest<T>(path, { ...options, method: 'PATCH', body })
  },

  delete<T = unknown>(path: string, options?: ApiRequestOptions) {
    return apiRequest<T>(path, { ...options, method: 'DELETE' })
  },
}

// ── SSE helper ───────────────────────────────────────────────────────

/**
 * Open a Server-Sent Events connection to the backend.
 * Returns an EventSource that the caller must close.
 */
export function openSSE(path: string): EventSource {
  return new EventSource(`${baseUrl}${path}`)
}
