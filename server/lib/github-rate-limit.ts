/**
 * GitHub API Rate Limit Utilities
 *
 * Parses rate limit headers from GitHub API responses and provides
 * a fetch wrapper that throws descriptive errors on rate-limit responses.
 */

export interface RateLimitInfo {
  remaining: number
  resetAt: Date
  retryAfterMs: number
}

/**
 * Parse GitHub rate limit headers from a response.
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
  const remaining = headers.get('x-ratelimit-remaining')
  const reset = headers.get('x-ratelimit-reset')
  const retryAfter = headers.get('retry-after')

  if (remaining === null && reset === null) return null

  const resetEpoch = reset ? parseInt(reset, 10) * 1000 : Date.now()
  const resetAt = new Date(resetEpoch)
  const retryAfterMs = retryAfter
    ? parseInt(retryAfter, 10) * 1000
    : Math.max(0, resetEpoch - Date.now())

  return {
    remaining: remaining ? parseInt(remaining, 10) : 0,
    resetAt,
    retryAfterMs,
  }
}

/**
 * Wraps `fetch()` to inspect 403/429 responses for rate limiting
 * and throw a descriptive error with retry-after information.
 */
// Proactive rate limit tracking: abort batch before hitting hard limit.
// Shared across all calls in this process — resets when limit resets.
let rateLimitRemaining: number | null = null
let rateLimitResetAt: number = 0

const RATE_LIMIT_LOW_WATERMARK = 50

/** Check if we're approaching the rate limit and should abort. */
export function isRateLimitLow(): boolean {
  if (rateLimitRemaining === null) return false
  if (Date.now() > rateLimitResetAt) {
    // Reset window has passed — clear stale tracking
    rateLimitRemaining = null
    return false
  }
  return rateLimitRemaining < RATE_LIMIT_LOW_WATERMARK
}

export async function fetchWithRateLimit(url: string, init?: RequestInit): Promise<Response> {
  // Proactive check: abort early if we know the rate limit is nearly exhausted
  if (isRateLimitLow()) {
    const resetDate = new Date(rateLimitResetAt)
    const retrySeconds = Math.ceil(Math.max(0, rateLimitResetAt - Date.now()) / 1000)
    throw new Error(
      `GitHub API rate limit low (${rateLimitRemaining} remaining). ` +
      `Resets at ${resetDate.toISOString()} (retry after ${retrySeconds}s)`
    )
  }

  const response = await fetch(url, init)

  // Track rate limit from every successful response
  const remainingHeader = response.headers.get('x-ratelimit-remaining')
  const resetHeader = response.headers.get('x-ratelimit-reset')
  if (remainingHeader !== null) {
    rateLimitRemaining = parseInt(remainingHeader, 10)
  }
  if (resetHeader !== null) {
    rateLimitResetAt = parseInt(resetHeader, 10) * 1000
  }

  // Detect revoked/expired tokens — surface a clear reconnection message
  if (response.status === 401) {
    const body = await response.text()
    if (body.includes('Bad credentials') || body.includes('token') || body.includes('authentication')) {
      throw new Error(
        'GitHub token is invalid or revoked. Please reconnect your GitHub account in Settings.'
      )
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  if (response.status === 403 || response.status === 429) {
    const rateInfo = parseRateLimitHeaders(response.headers)
    if (rateInfo && rateInfo.remaining === 0) {
      const retrySeconds = Math.ceil(rateInfo.retryAfterMs / 1000)
      throw new Error(
        `GitHub API rate limit exceeded. Resets at ${rateInfo.resetAt.toISOString()} ` +
        `(retry after ${retrySeconds}s)`
      )
    }

    // Check if it's a secondary rate limit (abuse detection)
    const body = await response.text()
    if (body.includes('rate limit') || body.includes('abuse detection')) {
      const retryAfter = response.headers.get('retry-after')
      const waitSec = retryAfter ? parseInt(retryAfter, 10) : 60
      throw new Error(
        `GitHub API secondary rate limit hit. Retry after ${waitSec}s`
      )
    }

    // Not a rate limit issue, create a new response with the consumed body
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  return response
}
