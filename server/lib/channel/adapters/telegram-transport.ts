/**
 * Telegram Transport
 *
 * Low-level HTTP client for the Telegram Bot API with resilience features:
 *   - Fallback IPs when the primary host is unreachable (best-effort; see note)
 *   - Sticky last-working target to avoid thrashing
 *   - Optional HTTPS/HTTP proxy support via undici.ProxyAgent
 *   - Configurable connect/read timeouts via env
 *   - Flood control handling for HTTP 429 (parameters.retry_after)
 *   - Exponential backoff for transient network errors and 5xx
 *
 * This module never throws; on final failure it returns
 * `{ ok: false, description: '...' }` so callers can handle uniformly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UndiciProxyAgentCtor = new (opts: string | { uri: string }) => any

export interface TelegramApiResponse {
  ok: boolean
  description?: string
  result?: unknown
  error_code?: number
  parameters?: {
    retry_after?: number
    migrate_to_chat_id?: number
  }
}

const PRIMARY_HOST = 'api.telegram.org'

// Errors we consider transient for the purposes of fallback/retry.
const TRANSIENT_NET_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

// Module-level sticky target — the last host (primary or fallback IP) that
// succeeded. We try it first on subsequent calls.
let stickyHost: string = PRIMARY_HOST
// Track which targets we've already warned about to avoid log spam.
const warnedTargets = new Set<string>()

// Lazily-loaded proxy dispatcher (undici ProxyAgent).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedDispatcher: any | null | undefined = undefined

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function parseAllowedIPs(): string[] {
  const raw = process.env.TELEGRAM_FALLBACK_IPS
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function connectTimeoutMs(): number {
  return envInt('TELEGRAM_HTTP_CONNECT_TIMEOUT', 10) * 1000
}

function readTimeoutMs(): number {
  return envInt('TELEGRAM_HTTP_READ_TIMEOUT', 20) * 1000
}

function totalTimeoutMs(): number {
  return connectTimeoutMs() + readTimeoutMs()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDispatcher(): Promise<any | null> {
  if (cachedDispatcher !== undefined) return cachedDispatcher
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  if (!proxyUrl) {
    cachedDispatcher = null
    return null
  }
  try {
    const undici = await import('undici')
    const ProxyAgent = (undici as unknown as { ProxyAgent: UndiciProxyAgentCtor }).ProxyAgent
    cachedDispatcher = new ProxyAgent(proxyUrl)
    return cachedDispatcher
  } catch {
    cachedDispatcher = null
    return null
  }
}

function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; cause?: { code?: string }; name?: string; message?: string }
  if (e.code && TRANSIENT_NET_CODES.has(e.code)) return true
  if (e.cause && e.cause.code && TRANSIENT_NET_CODES.has(e.cause.code)) return true
  if (e.name === 'AbortError') return true
  if (e.message && /fetch failed|network|socket|timeout/i.test(e.message)) return true
  return false
}

function warnOnce(target: string, message: string): void {
  if (warnedTargets.has(target)) return
  warnedTargets.add(target)
  console.warn(`[telegram-transport] ${message}`)
}

/**
 * Build the list of target hosts to try, in order, for a given request.
 * Sticky host is always first; primary and fallbacks follow (dedup).
 */
function buildTargets(): string[] {
  const targets: string[] = []
  targets.push(stickyHost)
  if (!targets.includes(PRIMARY_HOST)) targets.push(PRIMARY_HOST)
  for (const ip of parseAllowedIPs()) {
    if (!targets.includes(ip)) targets.push(ip)
  }
  return targets
}

/**
 * Rewrite the URL so the hostname is `host` while preserving path + query.
 * When `host` is an IP, the request goes to that IP; we also inject a
 * `Host: api.telegram.org` header so the server can route virtual hosts.
 *
 * NOTE: pure fetch (undici) cannot preserve TLS SNI for a custom IP —
 * TLS will use the URL hostname (the IP) for SNI, and the cert check
 * will likely fail. This IP fallback is therefore best-effort and is
 * primarily intended for container setups where /etc/hosts is overridden
 * to point `api.telegram.org` at a reachable IP. When that's the case,
 * operators should put `api.telegram.org` itself in the hosts file and
 * leave TELEGRAM_FALLBACK_IPS empty.
 */
function rewriteUrl(originalUrl: string, host: string): string {
  if (host === PRIMARY_HOST) return originalUrl
  try {
    const u = new URL(originalUrl)
    u.hostname = host
    return u.toString()
  } catch {
    return originalUrl
  }
}

async function singleAttempt(
  url: string,
  init: RequestInit,
  host: string,
): Promise<Response> {
  const rewritten = rewriteUrl(url, host)
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), totalTimeoutMs())
  const headers = new Headers(init.headers)
  if (host !== PRIMARY_HOST) {
    headers.set('Host', PRIMARY_HOST)
  }
  const dispatcher = await getDispatcher()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extra: any = {}
  if (dispatcher) extra.dispatcher = dispatcher
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (fetch as any)(rewritten, {
      ...init,
      headers,
      signal: controller.signal,
      ...extra,
    })
    return res as Response
  } finally {
    clearTimeout(t)
  }
}

/**
 * Wrap `fetch` with resilience for Telegram Bot API calls.
 *
 * Returns a parsed `TelegramApiResponse` on success OR a synthetic failure
 * object (`{ ok: false, description }`) on final failure. Never throws.
 */
export async function telegramFetch(
  url: string,
  init: RequestInit = {},
): Promise<TelegramApiResponse> {
  const targets = buildTargets()
  const maxRetries = 3
  const backoffs = [1000, 5000, 20000]

  let lastErrDescription = 'telegram transport: unknown failure'

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (const host of targets) {
      try {
        const res = await singleAttempt(url, init, host)

        // HTTP-level failure path.
        if (!res.ok) {
          // Try to read body as JSON so we can surface error details
          // (429 flood control etc.).
          let parsed: TelegramApiResponse | null = null
          try {
            parsed = (await res.json()) as TelegramApiResponse
          } catch {
            parsed = null
          }

          // 429 flood control: respect retry_after (capped).
          if (res.status === 429 && parsed?.parameters?.retry_after) {
            const waitS = Math.min(parsed.parameters.retry_after, 30)
            await sleep(waitS * 1000)
            // 429 doesn't count against our `maxRetries` for backoff, but
            // we limit to 2 explicit flood retries.
            for (let floodRetry = 0; floodRetry < 2; floodRetry++) {
              try {
                const res2 = await singleAttempt(url, init, host)
                if (res2.ok) {
                  stickyHost = host
                  return (await res2.json()) as TelegramApiResponse
                }
                const parsed2 = (await res2.json().catch(() => null)) as
                  | TelegramApiResponse
                  | null
                if (res2.status === 429 && parsed2?.parameters?.retry_after) {
                  await sleep(Math.min(parsed2.parameters.retry_after, 30) * 1000)
                  continue
                }
                if (parsed2) return parsed2
                break
              } catch (e) {
                lastErrDescription = `telegram transport: flood retry failed: ${(e as Error).message}`
                break
              }
            }
          }

          // 5xx — treat as transient; break to next target / backoff.
          if (res.status >= 500 && res.status < 600) {
            lastErrDescription = `telegram transport: HTTP ${res.status} from ${host}`
            warnOnce(host, `HTTP ${res.status} from ${host}`)
            continue
          }

          // Other 4xx — return the parsed body (real API-level error).
          if (parsed) {
            stickyHost = host
            return parsed
          }
          return {
            ok: false,
            description: `telegram transport: HTTP ${res.status} (no body)`,
          }
        }

        // 2xx — happy path.
        try {
          const json = (await res.json()) as TelegramApiResponse
          stickyHost = host
          return json
        } catch (e) {
          return {
            ok: false,
            description: `telegram transport: invalid JSON response: ${(e as Error).message}`,
          }
        }
      } catch (err) {
        // Network-level failure. Retry with next target.
        if (isTransientError(err)) {
          const msg = (err as Error).message || 'network error'
          lastErrDescription = `telegram transport: ${msg} (${host})`
          warnOnce(host, `network error for ${host}: ${msg}`)
          continue
        }
        // Non-transient error: still try next target, but record it.
        lastErrDescription = `telegram transport: ${(err as Error).message || 'error'} (${host})`
        warnOnce(host, lastErrDescription)
        continue
      }
    }

    // Exhausted all targets for this attempt — back off before next round.
    if (attempt < maxRetries - 1) {
      await sleep(backoffs[attempt])
    }
  }

  return { ok: false, description: lastErrDescription }
}
