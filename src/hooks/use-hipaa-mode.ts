/**
 * useIsHipaaMode — returns whether the backend is in HIPAA mode.
 *
 * Source of truth is the backend's /api/config endpoint; we fetch once and
 * cache the result in a module-level variable so every consumer sees the
 * same value. The Vite-env flag (VITE_ASTRO_HIPAA_MODE=true) serves as a
 * synchronous bootstrap fallback before the fetch resolves.
 */

import { useEffect, useState } from 'react'
import { isHipaaMode as isHipaaModeEnv } from '@/lib/app-mode'

export interface ServerConfig {
  hipaa: boolean
  mode: 'local' | 'server' | 'hipaa'
}

let cachedConfig: ServerConfig | null = null
let inflight: Promise<ServerConfig> | null = null

export async function fetchServerConfig(): Promise<ServerConfig> {
  if (cachedConfig) return cachedConfig
  if (inflight) return inflight
  inflight = fetch('/api/config')
    .then(async (res) => {
      if (!res.ok) throw new Error(`/api/config responded ${res.status}`)
      const json = (await res.json()) as ServerConfig
      cachedConfig = json
      return json
    })
    .catch((err) => {
      // Fail-safe: on network error, assume env-var value (which defaults to false).
      console.warn('[hipaa] Failed to fetch /api/config, falling back to env:', err)
      const fallback: ServerConfig = {
        hipaa: isHipaaModeEnv(),
        mode: isHipaaModeEnv() ? 'hipaa' : 'server',
      }
      cachedConfig = fallback
      return fallback
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * Simple hook that returns whether the server is in HIPAA mode.
 * Returns the env-var fallback on first render, then updates once the
 * backend config has been fetched.
 */
export function useIsHipaaMode(): boolean {
  const [hipaa, setHipaa] = useState<boolean>(() => cachedConfig?.hipaa ?? isHipaaModeEnv())

  useEffect(() => {
    let cancelled = false
    fetchServerConfig().then((cfg) => {
      if (!cancelled) setHipaa(cfg.hipaa)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return hipaa
}
