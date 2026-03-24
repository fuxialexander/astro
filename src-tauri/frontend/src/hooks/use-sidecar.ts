/**
 * useSidecar — polls sidecar_status until healthy.
 *
 * Returns { ready, error, status } so the app shell can show
 * a splash screen until the sidecar agent is up.
 */
import { useEffect, useRef, useState } from 'react'
import { getSidecarStatus, startSidecar } from '@desktop/lib/tauri-bridge'
import type { SidecarStatus } from '@desktop/types'

const POLL_INTERVAL_MS = 200
const MAX_RETRIES = 150 // 30 seconds max

export interface UseSidecarResult {
  ready: boolean
  error: string | null
  status: SidecarStatus | null
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

      try {
        const s = await getSidecarStatus()
        if (cancelled) return
        setStatus(s)

        if (s.running) {
          setReady(true)
          return
        }

        // Try to start the sidecar if not running and this is the first few attempts
        if (retriesRef.current === 0 || retriesRef.current === 5) {
          try {
            await startSidecar()
          } catch {
            // Ignore — sidecar might already be starting
          }
        }
      } catch {
        // Sidecar not reachable yet — that's expected during startup
      }

      retriesRef.current++
      if (retriesRef.current >= MAX_RETRIES) {
        if (!cancelled) {
          setError('Sidecar agent failed to start after 30 seconds')
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
