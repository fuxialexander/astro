/**
 * FileBrowser — tree view of project files with git status.
 *
 * Loads the file tree via invoke('list_dir') from Rust.
 * Shows git status indicators and supports file search via ripgrep.
 * Listens for fs-change events to auto-refresh the tree.
 */
import { useEffect, useCallback, useRef } from 'react'
import {
  FolderTree,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

import { cn } from '@desktop/lib/utils'
import { listDir, watchDir, unwatchDir } from '@desktop/lib/tauri-bridge'
import { useFileStore } from '@desktop/stores/file-store'
import type { FileNode, GitFileStatus } from '@desktop/stores/file-store'
import type { FileEntry, WatcherEvent } from '@desktop/types'
import { FileTreeNode } from '@desktop/components/files/FileTreeNode'

interface FileBrowserProps {
  rootPath: string | null
  onFileSelect?: (path: string) => void
}

/** Recursively build a sorted FileNode tree from flat entries. */
async function buildTree(
  path: string,
  gitStatusMap: Record<string, GitFileStatus>,
): Promise<FileNode[]> {
  try {
    const entries = await listDir(path)
    const nodes: FileNode[] = entries
      .filter((e: FileEntry) => !e.name.startsWith('.') || e.name === '.env.example')
      .map((e: FileEntry) => ({
        path: e.path,
        name: e.name,
        isDir: e.isDir,
        children: e.isDir ? [] : undefined,
        gitStatus: gitStatusMap[e.path],
        expanded: false,
      }))

    // Sort: directories first, then alphabetical
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1
      if (!a.isDir && b.isDir) return 1
      return a.name.localeCompare(b.name)
    })

    return nodes
  } catch {
    return []
  }
}

export function FileBrowser({ rootPath, onFileSelect }: FileBrowserProps) {
  const {
    tree,
    loading,
    searchQuery,
    searchResults,
    selectedFile,
    gitStatusMap,
    setTree,
    setLoading,
    setError,
    setSearchQuery,
    setSearchResults,
    setSelectedFile,
    toggleExpanded,
    setGitStatusMap,
    setRootPath,
  } = useFileStore()

  const watcherIdRef = useRef<string | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load git status map from Rust git_status command
  // Rust returns { staged: string[], modified: string[], untracked: string[], branch: string }
  const loadGitStatus = useCallback(async () => {
    if (!rootPath) return
    try {
      const result = await invoke<{
        staged: string[]
        modified: string[]
        untracked: string[]
        branch: string
      }>('git_status', { repoPath: rootPath })

      // Convert structured git status to a flat file → status map
      const typed: Record<string, GitFileStatus> = {}
      for (const file of result.staged) {
        typed[file] = 'staged'
      }
      for (const file of result.modified) {
        // Don't overwrite 'staged' if both staged and modified
        if (!typed[file]) typed[file] = 'modified'
      }
      for (const file of result.untracked) {
        typed[file] = 'untracked'
      }
      setGitStatusMap(typed)
      return typed
    } catch {
      return {}
    }
  }, [rootPath, setGitStatusMap])

  // Load the file tree
  const loadTree = useCallback(async () => {
    if (!rootPath) {
      setTree([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      const statusMap = (await loadGitStatus()) ?? {}
      const nodes = await buildTree(rootPath, statusMap)
      setTree(nodes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file tree')
    } finally {
      setLoading(false)
    }
  }, [rootPath, setTree, setLoading, setError, loadGitStatus])

  // Initialize when rootPath changes
  useEffect(() => {
    setRootPath(rootPath)
    void loadTree()
  }, [rootPath, setRootPath, loadTree])

  // Set up file watcher
  useEffect(() => {
    if (!rootPath) return

    let cancelled = false

    const startWatcher = async () => {
      try {
        const id = await watchDir(rootPath)
        if (!cancelled) {
          watcherIdRef.current = id
        }
      } catch {
        // Watcher not available — no auto-refresh
      }
    }

    void startWatcher()

    return () => {
      cancelled = true
      if (watcherIdRef.current) {
        void unwatchDir(watcherIdRef.current)
        watcherIdRef.current = null
      }
    }
  }, [rootPath])

  // Listen for fs-change events to auto-refresh
  useEffect(() => {
    const unlisten = listen<WatcherEvent>('fs-change', () => {
      void loadTree()
    })

    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [loadTree])

  // Handle file search with debounce
  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query)

      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }

      if (!query.trim()) {
        setSearchResults([])
        return
      }

      searchTimerRef.current = setTimeout(async () => {
        if (!rootPath) return
        try {
          const results = await invoke<Array<{ path: string; line: number; text: string }>>('search_files', {
            path: rootPath,
            pattern: query.trim(),
          })
          // Deduplicate by file path
          const uniquePaths = [...new Set(results.map((r) => r.path))]
          setSearchResults(
            uniquePaths.map((p: string) => ({
              path: p,
              name: p.split('/').pop() ?? p,
              isDir: false,
            })),
          )
        } catch {
          setSearchResults([])
        }
      }, 200)
    },
    [rootPath, setSearchQuery, setSearchResults],
  )

  // Handle selecting a file
  const handleFileSelect = useCallback(
    (path: string) => {
      setSelectedFile(path)
      onFileSelect?.(path)
    },
    [setSelectedFile, onFileSelect],
  )

  // Handle expanding/collapsing directories
  const handleToggle = useCallback(
    async (path: string) => {
      // If the node has no children loaded yet, load them
      const findNode = (nodes: FileNode[]): FileNode | undefined => {
        for (const n of nodes) {
          if (n.path === path) return n
          if (n.children) {
            const found = findNode(n.children)
            if (found) return found
          }
        }
        return undefined
      }

      const node = findNode(tree)
      if (node?.isDir && (!node.children || node.children.length === 0) && !node.expanded) {
        // Load children on first expand
        const children = await buildTree(path, gitStatusMap)
        // Update the tree with the loaded children
        const updateChildren = (nodes: FileNode[]): FileNode[] =>
          nodes.map((n) => {
            if (n.path === path) {
              return { ...n, children, expanded: true }
            }
            if (n.children) {
              return { ...n, children: updateChildren(n.children) }
            }
            return n
          })
        setTree(updateChildren(tree))
        return
      }

      toggleExpanded(path)
    },
    [tree, gitStatusMap, setTree, toggleExpanded],
  )

  const showSearch = searchQuery.trim().length > 0

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-3 py-2 flex-shrink-0">
        <FolderTree className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground select-none flex-1">
          Files
        </span>
        <button
          onClick={() => void loadTree()}
          disabled={loading}
          className={cn(
            'p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted',
            'transition-colors duration-100',
            loading && 'animate-spin',
          )}
          title="Refresh file tree"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────────── */}
      <div className="px-2 pb-1.5 flex-shrink-0">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted">
          <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search files..."
            className={cn(
              'flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground',
              'outline-none border-none min-w-0',
            )}
          />
        </div>
      </div>

      {/* ── Tree / Search Results ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1 scrollbar-hide">
        {loading && tree.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            Loading files...
          </div>
        ) : !rootPath ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            No project directory
          </div>
        ) : showSearch ? (
          // Search results
          <div className="flex flex-col gap-0.5">
            {searchResults.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No files found
              </p>
            ) : (
              searchResults.map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedPath={selectedFile}
                  onSelect={handleFileSelect}
                  onToggle={handleToggle}
                />
              ))
            )}
          </div>
        ) : (
          // Tree view
          <div className="flex flex-col">
            {tree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedFile}
                onSelect={handleFileSelect}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Re-export for sidebar section usage
export { ChevronDown, ChevronRight }
