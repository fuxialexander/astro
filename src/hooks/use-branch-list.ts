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
  const [isCheckingOut, setIsCheckingOut] = useState(false)
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

  const checkoutBranch = useCallback(async (path: string, machineId: string, branch: string, stash?: boolean): Promise<{ success: boolean; error?: string }> => {
    setIsCheckingOut(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = await getAccessToken()
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(apiUrl('/api/repo/checkout'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ path, machineId, branch, ...(stash && { stash }) }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Checkout failed' }
      }
      // Re-fetch branches to update current marker
      await fetchBranches(path, machineId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Checkout failed' }
    } finally {
      setIsCheckingOut(false)
    }
  }, [fetchBranches])

  const createBranch = useCallback(async (path: string, machineId: string, branch: string): Promise<{ success: boolean; error?: string }> => {
    setIsCheckingOut(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = await getAccessToken()
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(apiUrl('/api/repo/create-branch'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ path, machineId, branch }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Create branch failed' }
      }
      await fetchBranches(path, machineId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Create branch failed' }
    } finally {
      setIsCheckingOut(false)
    }
  }, [fetchBranches])

  return { branches, isLoading, isCheckingOut, error, fetchBranches, fetchGitHubBranches, checkoutBranch, createBranch }
}
