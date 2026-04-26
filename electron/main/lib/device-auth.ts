/**
 * HTTP wrappers for the device/* relay endpoints used by Electron.
 *
 * Pure HTTP client — no UI, no electron dependencies. Provides:
 *   POST /api/device/pair-init  → callback-style pair (Electron onboarding)
 *   POST /api/device/register   → register a remote machine (SSH installer)
 *
 * The polling-based RFC 8628 flow is no longer used by Electron — the
 * desktop app uses the callback-style /pair flow instead. The /authorize
 * + /token + /device endpoints remain on the server for CLI / agent-runner
 * use cases that genuinely can't receive a deep-link callback.
 */

import { app } from 'electron'

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

export interface PairInitResponse {
  pairToken: string
  pairUrl: string
  expiresIn: number
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

/**
 * Initialize the callback-style pair flow. The desktop app opens the
 * returned pairUrl in the user's browser and waits for the
 * astro://pair/callback deep-link to deliver tokens. Used by
 * ConnectThisMacStep.
 */
export async function startPair(opts: {
  hostname: string
  platform: string
  providers?: string[]
}): Promise<PairInitResponse> {
  const res = await fetch(`${resolveApiBase()}/api/device/pair-init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hostname: opts.hostname,
      platform: opts.platform,
      ...(opts.providers && { providers: opts.providers }),
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`device/pair-init failed: ${res.status} ${text}`)
  }
  const json = (await res.json()) as Record<string, unknown>
  const pairToken = (json.pairToken ?? json.pair_token) as string | undefined
  const pairUrl = (json.pairUrl ?? json.pair_url) as string | undefined
  const expiresIn = (json.expiresIn ?? json.expires_in) as number | undefined
  if (!pairToken || !pairUrl || typeof expiresIn !== 'number') {
    throw new Error('device/pair-init: malformed response')
  }
  return { pairToken, pairUrl, expiresIn }
}
