/**
 * Hook: useSyncHealth
 *
 * Fetches and auto-refreshes GitHub sync health data for a project.
 */

import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'
import type { SyncHealthData } from '@/components/github-sync-health'

export function useSyncHealth(projectId: string | undefined) {
  const [data, setData] = useState<SyncHealthData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const headers: Record<string, string> = {}
      const token = await getAccessToken()
      if (token) headers['Authorization'] = `Bearer ${token}`

      const params = new URLSearchParams({ projectId })
      const res = await fetch(apiUrl(`/api/github/sync-health?${params}`), { headers })
      if (!res.ok) throw new Error('Failed to fetch sync health')
      const json = await res.json() as SyncHealthData
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    fetchHealth()
    // Auto-refresh every 60s
    const interval = setInterval(fetchHealth, 60_000)
    return () => clearInterval(interval)
  }, [fetchHealth, projectId])

  return { data, loading, error, refresh: fetchHealth }
}
