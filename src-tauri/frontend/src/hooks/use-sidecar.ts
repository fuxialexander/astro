/**
 * useSidecar — polls the backend API health endpoint until healthy.
 *
 * In desktop mode, the app connects to an existing Astro backend rather
 * than managing its own sidecar process. The backend URL is read from
 * localStorage (key: "astro-desktop-api-url") with a fallback to
 * localhost:3001 (local dev) or the production API.
 *
 * Returns { ready, error, status } so the app shell can show
 * a splash screen until the backend is reachable.
 */
import { useEffect, useRef, useState } from 'react'
import { setBaseUrl, getBaseUrl } from '@desktop/lib/api-client'
import type { SidecarStatus } from '@desktop/types'

const POLL_INTERVAL_MS = 500
const MAX_RETRIES = 60 // 30 seconds max

/** Candidate URLs to try in order if no saved URL is found. */
const CANDIDATE_URLS = [
  'https://api.astroanywhere.com', // production (default)
  'http://localhost:3001',         // local npm run dev
]

export interface UseSidecarResult {
  ready: boolean
  error: string | null
  status: SidecarStatus | null
}

async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

export function useSidecar(): UseSidecarResult {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<SidecarStatus | null>(null)
  const retriesRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (cancelled) return

      // On first attempt, discover the right URL to use
      if (retriesRef.current === 0) {
        const saved = localStorage.getItem('astro-desktop-api-url')
        if (saved) {
          setBaseUrl(saved)
        }
      }

      const currentUrl = getBaseUrl()
      const healthy = await checkHealth(currentUrl)

      if (cancelled) return

      if (healthy) {
        setStatus({ running: true })
        setReady(true)
        return
      }

      // On first failure, try candidate URLs before giving up
      if (retriesRef.current === 0) {
        for (const url of CANDIDATE_URLS) {
          if (url === currentUrl) continue
          const ok = await checkHealth(url)
          if (ok) {
            setBaseUrl(url)
            localStorage.setItem('astro-desktop-api-url', url)
            setStatus({ running: true })
            setReady(true)
            return
          }
        }
      }

      retriesRef.current++
      if (retriesRef.current >= MAX_RETRIES) {
        if (!cancelled) {
          setError(
            `Cannot reach Astro backend at ${currentUrl}.\n` +
            `Make sure the server is running (npm run dev) or configure the API URL in settings.`
          )
        }
        return
      }

      timer = setTimeout(poll, POLL_INTERVAL_MS)
    }

    void poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return { ready, error, status }
}
