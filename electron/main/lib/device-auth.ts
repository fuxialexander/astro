/**
 * Device Authorization Grant (RFC 8628) HTTP wrapper.
 *
 * Pure HTTP client — no UI, no electron dependencies. The orchestrator layer
 * decides when to open the browser and where to persist tokens. Each function
 * here calls exactly one of the three relay endpoints used by the desktop
 * onboarding flow:
 *   POST /api/device/authorize  → start (returns deviceCode + userCode)
 *   POST /api/device/token      → poll (authorization_pending / success)
 *   POST /api/device/register   → register this machine (authed)
 */

import { app } from 'electron'

export interface AuthorizeResponse {
  deviceCode: string
  userCode: string
  verificationUriComplete: string
  expiresIn: number
  interval?: number
}

export interface TokenSuccess {
  kind: 'success'
  accessToken: string
  refreshToken: string
  wsToken?: string
}

export interface TokenPending {
  kind: 'pending'
}

export interface TokenSlowDown {
  kind: 'slow-down'
}

export interface TokenError {
  kind: 'error'
  error: 'access_denied' | 'expired_token' | 'invalid_grant' | 'unknown'
  message: string
}

export type TokenResponse = TokenSuccess | TokenPending | TokenSlowDown | TokenError

export interface MachineInfoForRegister {
  machineId: string
  hostname: string
  name: string
  platform: string
  providers: string[]
  resources: { cpus: number; totalMemBytes: number }
}

export interface RegisterResponse {
  machineId: string
  apiUrl?: string
  relayUrl?: string
  wsToken?: string
  /** Returned when the server issues a fresh, machine-scoped token bundle.
   * Required for register-on-behalf of remote SSH hosts so the remote agent
   * has its own credentials independent of the local user's session. */
  accessToken?: string
  refreshToken?: string
}

/**
 * Resolve the API base URL. Env override wins. Otherwise use prod URL when
 * packaged, dev URL otherwise.
 */
export function resolveApiBase(): string {
  if (process.env.ASTRO_API_URL && process.env.ASTRO_API_URL.length > 0) {
    return process.env.ASTRO_API_URL
  }
  try {
    if (app.isPackaged) return 'https://api.astroanywhere.com'
  } catch {
    // app may not be ready in non-electron test contexts
  }
  return 'http://localhost:3001'
}

export async function startDeviceAuth(opts: {
  hostname: string
  platform: string
}): Promise<AuthorizeResponse> {
  const res = await fetch(`${resolveApiBase()}/api/device/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scopes: ['machine:connect', 'machine:execute', 'machine:read'],
      machineInfo: { hostname: opts.hostname, platform: opts.platform },
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`device/authorize failed: ${res.status} ${text}`)
  }
  const json = (await res.json()) as Record<string, unknown>
  // Tolerate snake_case from server.
  const deviceCode = (json.deviceCode ?? json.device_code) as string
  const userCode = (json.userCode ?? json.user_code) as string
  const verificationUriComplete = (json.verificationUriComplete ??
    json.verification_uri_complete ??
    json.verificationUri ??
    json.verification_uri) as string
  const expiresIn = Number(json.expiresIn ?? json.expires_in ?? 600)
  const interval = json.interval !== undefined ? Number(json.interval) : 5
  if (!deviceCode || !userCode || !verificationUriComplete) {
    throw new Error(`device/authorize: malformed response: ${JSON.stringify(json)}`)
  }
  return { deviceCode, userCode, verificationUriComplete, expiresIn, interval }
}

export async function pollDeviceToken(userCode: string): Promise<TokenResponse> {
  let res: Response
  try {
    res = await fetch(`${resolveApiBase()}/api/device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userCode,
        grantType: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
  } catch (err) {
    return {
      kind: 'error',
      error: 'unknown',
      message: `network error: ${(err as Error).message ?? String(err)}`,
    }
  }

  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    json = {}
  }
  const errCode = (json.error ?? json.errorCode) as string | undefined

  if (res.ok && (json.accessToken || json.access_token)) {
    return {
      kind: 'success',
      accessToken: (json.accessToken ?? json.access_token) as string,
      refreshToken: (json.refreshToken ?? json.refresh_token ?? '') as string,
      wsToken: (json.wsToken ?? json.ws_token) as string | undefined,
    }
  }

  if (errCode === 'authorization_pending') return { kind: 'pending' }
  if (errCode === 'slow_down') return { kind: 'slow-down' }
  if (errCode === 'access_denied') {
    return { kind: 'error', error: 'access_denied', message: 'User denied the request.' }
  }
  if (errCode === 'expired_token') {
    return { kind: 'error', error: 'expired_token', message: 'Code expired.' }
  }
  if (errCode === 'invalid_grant') {
    return { kind: 'error', error: 'invalid_grant', message: 'Invalid grant.' }
  }
  return {
    kind: 'error',
    error: 'unknown',
    message: typeof errCode === 'string' ? errCode : `unexpected status ${res.status}`,
  }
}

export async function registerMachine(
  accessToken: string,
  info: MachineInfoForRegister
): Promise<RegisterResponse> {
  const res = await fetch(`${resolveApiBase()}/api/device/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ machineInfo: info }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`device/register failed: ${res.status} ${text}`)
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return {
    machineId: ((json.machineId ?? json.machine_id) as string | undefined) ?? info.machineId,
    apiUrl: (json.apiUrl ?? json.api_url) as string | undefined,
    relayUrl: (json.relayUrl ?? json.relay_url) as string | undefined,
    wsToken: (json.wsToken ?? json.ws_token) as string | undefined,
    accessToken: (json.accessToken ?? json.access_token) as string | undefined,
    refreshToken: (json.refreshToken ?? json.refresh_token) as string | undefined,
  }
}
