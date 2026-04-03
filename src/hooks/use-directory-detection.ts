import { useState, useEffect, useRef, useCallback } from 'react'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'
import type { RemoteType, DeliveryMode } from '@/types'

export interface DetectionResult {
  path: string
  exists: boolean
  isGit: boolean
  remoteUrl?: string
  remoteType: RemoteType
  baseBranch?: string
  currentBranch?: string
  isDirty?: boolean
  dirtyDetails?: {
    staged: number
    unstaged: number
    untracked: number
  }
  suggestedDeliveryMode: DeliveryMode
  dirSizeMB?: number | null
}

/**
 * Debounced hook that calls GET /api/repo/detect as the user types a directory path.
 * Returns detection info for inline feedback in the project creation form.
 *
 * Requires machineId — detection runs on the connected machine via relay.
 * Returns null/empty when no machineId is provided.
 */
export function useDirectoryDetection(path: string, machineId?: string, delay = 300) {
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [isDetecting, setIsDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const trimmed = path.trim()

    // Clear detection if path is empty, too short, or no machine connected
    if (!trimmed || trimmed.length < 2 || !machineId) {
      setDetection(null)
      setIsDetecting(false)
      setError(null)
      return
    }

    setIsDetecting(true)
    setError(null)

    const timer = setTimeout(async () => {
      // Abort any in-flight request
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      // Single immediate retry (no delay) for transient errors
      for (let attempt = 0; attempt <= 1; attempt++) {
        if (controller.signal.aborted) return

        try {
          const headers: Record<string, string> = {}
          const token = await getAccessToken()
          if (token) headers['Authorization'] = `Bearer ${token}`
          const res = await fetch(
            apiUrl(`/api/repo/detect?path=${encodeURIComponent(trimmed)}&machineId=${encodeURIComponent(machineId)}`),
            { signal: controller.signal, headers },
          )

          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data.error || 'Detection failed')
          }

          const data = await res.json()

          // Retry once on transient errors (no delay)
          if (data.error && attempt === 0) {
            const transient = /not connected|timed? ?out|unavailable/i.test(data.error)
            if (transient) continue
          }

          if (!controller.signal.aborted) {
            setDetection({ path: trimmed, ...data })
            setIsDetecting(false)
          }
          return
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return
          if (attempt === 0) continue
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : 'Detection failed')
            setDetection(null)
            setIsDetecting(false)
          }
        }
      }
    }, delay)

    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [path, machineId, delay, refreshKey])

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  return { detection, isDetecting, error, refresh }
}
