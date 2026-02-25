/**
 * Fuzzy search hook using Fuse.js.
 * Indexes all cached entities from stores.
 */
import { useEffect, useCallback } from 'react'
import Fuse from 'fuse.js'
import { useSearchStore, type SearchItem } from '../stores/search-store.js'
import { useProjectsStore } from '../stores/projects-store.js'
import { usePlanStore } from '../stores/plan-store.js'
import { useMachinesStore } from '../stores/machines-store.js'

let fuseInstance: Fuse<SearchItem> | null = null

export function useFuzzySearch() {
  const projects = useProjectsStore((s) => s.projects)
  const nodes = usePlanStore((s) => s.nodes)
  const machines = useMachinesStore((s) => s.machines)
  const { setItems, setResults, query } = useSearchStore()

  // Rebuild index when data changes
  useEffect(() => {
    const items: SearchItem[] = [
      ...projects.map((p) => ({
        type: 'project' as const,
        id: p.id,
        title: p.name,
        subtitle: p.description,
        status: p.status,
      })),
      ...nodes.filter((n) => !n.deletedAt).map((n) => ({
        type: 'task' as const,
        id: n.id,
        title: n.title,
        subtitle: n.description,
        status: n.status,
      })),
      ...machines.filter((m) => !m.isRevoked).map((m) => ({
        type: 'machine' as const,
        id: m.id,
        title: m.name,
        subtitle: `${m.platform} - ${m.hostname}`,
        status: m.isConnected ? 'connected' : 'disconnected',
      })),
    ]
    setItems(items)
    fuseInstance = new Fuse(items, {
      keys: ['title', 'subtitle', 'id'],
      threshold: 0.4,
      includeScore: true,
    })
  }, [projects, nodes, machines, setItems])

  const search = useCallback((q: string) => {
    if (!q || !fuseInstance) {
      setResults([])
      return
    }
    const results = fuseInstance.search(q, { limit: 20 })
    setResults(results.map((r) => r.item))
  }, [setResults])

  // Auto-search when query changes
  useEffect(() => {
    search(query)
  }, [query, search])

  return { search }
}
