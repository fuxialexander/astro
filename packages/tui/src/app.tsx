import React, { useMemo, useCallback } from 'react'
import { MainLayout } from './components/layout/main-layout.js'
import { AstroClient } from './client-adapter.js'
import { useVimMode } from './hooks/use-vim-mode.js'
import { usePolling } from './hooks/use-polling.js'
import { useSSEStream } from './hooks/use-sse-stream.js'
import { useFuzzySearch } from './hooks/use-fuzzy-search.js'
import { useCommandParser } from './hooks/use-command-parser.js'
import { useTuiStore } from './stores/tui-store.js'
import { useProjectsStore } from './stores/projects-store.js'
import { usePlanStore } from './stores/plan-store.js'
import { useSearchStore } from './stores/search-store.js'

interface AppProps {
  serverUrl?: string
}

export function App({ serverUrl }: AppProps) {
  const client = useMemo(() => new AstroClient({ serverUrl }), [serverUrl])

  // Data loading
  const { refreshAll } = usePolling(client)

  // SSE streaming
  useSSEStream(client)

  // Fuzzy search
  useFuzzySearch()

  // Command parser
  const { execute } = useCommandParser(client)

  // Selection handlers
  const onSelect = useCallback(() => {
    const { focusedPanel, scrollIndex } = useTuiStore.getState()

    switch (focusedPanel) {
      case 'projects': {
        const projects = useProjectsStore.getState().projects
        const idx = scrollIndex.projects
        if (projects[idx]) {
          useTuiStore.getState().setSelectedProject(projects[idx].id)
        }
        break
      }
      case 'plan': {
        const treeLines = usePlanStore.getState().treeLines
        const idx = scrollIndex.plan
        const line = treeLines[idx]
        if (line) {
          useTuiStore.getState().setSelectedNode(line.id)
          // Toggle collapse if it has children
          usePlanStore.getState().toggleCollapse(line.id)
        }
        break
      }
      case 'machines': {
        // Could open detail view for selected machine
        break
      }
    }
  }, [])

  const onCommand = useCallback(
    (cmd: string) => {
      execute(cmd)
    },
    [execute],
  )

  const onSearch = useCallback(
    (query: string) => {
      useSearchStore.getState().setQuery(query)
      if (query.length > 0) {
        useSearchStore.getState().open()
      }
    },
    [],
  )

  const onDispatch = useCallback(async () => {
    const nodeId = useTuiStore.getState().selectedNodeId
    const projectId = useTuiStore.getState().selectedProjectId
    if (nodeId && projectId) {
      await execute(`dispatch ${nodeId}`)
    }
  }, [execute])

  const onCancel = useCallback(async () => {
    await execute('cancel')
  }, [execute])

  const onRefresh = useCallback(() => {
    refreshAll()
  }, [refreshAll])

  // Vim mode
  useVimMode({
    onSelect,
    onCommand,
    onSearch,
    onDispatch,
    onCancel,
    onRefresh,
  })

  return <MainLayout />
}
