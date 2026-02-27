import { useState, useCallback } from 'react'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'

export interface BranchInfo {
  name: string
  isRemote: boolean
  isCurrent: boolean
  isDefault: boolean
}

export function useBranchList() {
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchBranches = useCallback(async (path: string, machineId: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const headers: Record<string, string> = {}
      const token = await getAccessToken()
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(
        apiUrl(`/api/repo/branches?path=${encodeURIComponent(path)}&machineId=${encodeURIComponent(machineId)}`),
        { headers },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to fetch branches')
      }
      const data = await res.json()
      setBranches(data.branches || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch branches')
      setBranches([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchGitHubBranches = useCallback(async (repository: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const headers: Record<string, string> = {}
      const token = await getAccessToken()
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(
        apiUrl(`/api/github/repos/${encodeURIComponent(repository)}/branches`),
        { headers },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to fetch GitHub branches')
      }
      const data = await res.json()
      // GitHub API returns { name, commit, protected } — normalize to BranchInfo
      const normalized: BranchInfo[] = (data.branches || data || []).map((b: { name: string }) => ({
        name: b.name,
        isRemote: true,
        isCurrent: false,
        isDefault: false,
      }))
      setBranches(normalized)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch GitHub branches')
      setBranches([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { branches, isLoading, error, fetchBranches, fetchGitHubBranches }
}
