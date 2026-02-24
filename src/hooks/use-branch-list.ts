import { useState, useRef, useCallback } from 'react'
import { apiUrl } from '@/lib/api-url'

export interface BranchInfo {
  name: string
  isRemote: boolean
  isCurrent: boolean
  isDefault: boolean
}

export interface BranchListResult {
  branches: BranchInfo[]
  defaultBranch?: string
}

/**
 * Lazy branch list fetcher. Does NOT auto-fetch — call `fetchBranches()` or
 * `fetchGitHubBranches()` manually.
 * Caches results per key (path+machineId or repo fullName).
 */
export function useBranchList() {
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [defaultBranch, setDefaultBranch] = useState<string | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const cacheRef = useRef<Map<string, BranchListResult>>(new Map())

  const applyResult = useCallback((data: BranchListResult, cacheKey: string) => {
    setBranches(data.branches)
    setDefaultBranch(data.defaultBranch)
    cacheRef.current.set(cacheKey, data)
    setIsLoading(false)
  }, [])

  /** Fetch branches from a local/remote directory via relay */
  const fetchBranches = useCallback(async (path: string, machineId: string) => {
    const cacheKey = `relay:${path}:${machineId}`
    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setBranches(cached.branches)
      setDefaultBranch(cached.defaultBranch)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(
        apiUrl(`/api/repo/branches?path=${encodeURIComponent(path)}&machineId=${encodeURIComponent(machineId)}`),
        { signal: controller.signal },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to fetch branches')
      }

      const data: BranchListResult = await res.json()
      if (!controller.signal.aborted) {
        applyResult(data, cacheKey)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to fetch branches')
        setBranches([])
        setIsLoading(false)
      }
    }
  }, [applyResult])

  /** Fetch branches from GitHub API (for connected GitHub repos) */
  const fetchGitHubBranches = useCallback(async (repoFullName: string) => {
    const cacheKey = `github:${repoFullName}`
    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setBranches(cached.branches)
      setDefaultBranch(cached.defaultBranch)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(
        apiUrl(`/api/github/branches/${encodeURIComponent(repoFullName.split('/')[0])}/${encodeURIComponent(repoFullName.split('/')[1])}`),
        { signal: controller.signal },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to fetch branches')
      }

      const data: BranchListResult = await res.json()
      if (!controller.signal.aborted) {
        applyResult(data, cacheKey)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to fetch branches')
        setBranches([])
        setIsLoading(false)
      }
    }
  }, [applyResult])

  const clearCache = useCallback(() => {
    cacheRef.current.clear()
  }, [])

  return { branches, defaultBranch, isLoading, error, fetchBranches, fetchGitHubBranches, clearCache }
}
