/**
 * FileBrowser — desktop file tree pane backed by the Electron desktop bridge.
 *
 * Ported from the legacy Tauri shell. This version routes through
 * `desktopBridge.fs.listDir`, `desktopBridge.git.status`, and
 * `desktopBridge.watcher.subscribe` — all gated behind `isDesktop()`.
 *
 * Search: routes through the `fs:search` IPC channel, which walks the tree
 * on the main process with a prune-list. Falls back to a client-side filter
 * over the loaded tree on error (e.g. permission denied).
 *
 * Quick Look: Space or double-click on any file opens a full-screen preview
 * overlay without navigating away from the tree.
 */
import { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import { Search, RefreshCw } from 'lucide-react'

import { cn } from '@/lib/utils'
import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge, type GitStatus, type FsEntry } from '@/lib/desktop-bridge'
import {
  useDesktopFileStore,
  type FileNode,
  type GitFileStatus,
} from '@/stores/desktop-file-store'
import { FileTreeNode } from './FileTreeNode'
import { QuickLook } from './QuickLook'

interface FileBrowserProps {
  rootPath: string | null
  onFileSelect?: (path: string) => void
}

/** Map an Electron `GitStatus.files[]` entry to the legacy GitFileStatus enum. */
function gitChangeStatus(s: GitStatus['files'][number]): GitFileStatus {
  if (s.status === 'conflicted') return 'conflict'
  if (s.staged) return 'staged'
  return s.status as GitFileStatus
}

async function buildTree(
  path: string,
  gitStatusMap: Record<string, GitFileStatus>,
): Promise<FileNode[]> {
  try {
    const { entries } = await desktopBridge.fs.listDir(path)
    const nodes: FileNode[] = entries
      .filter((e: FsEntry) => !e.name.startsWith('.') || e.name === '.env.example')
      .map((e: FsEntry) => ({
        path: e.path,
        name: e.name,
        isDir: e.isDirectory,
        children: e.isDirectory ? [] : undefined,
        gitStatus: gitStatusMap[e.path],
        expanded: false,
      }))

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

/** Flatten the tree into an ordered list of file paths (excluding dirs). */
function flattenFiles(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (!n.isDir) out.push(n.path)
    if (n.children) flattenFiles(n.children, out)
  }
  return out
}

function flattenTreeForSearch(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    if (!n.isDir) out.push(n)
    if (n.children) flattenTreeForSearch(n.children, out)
  }
  return out
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
  } = useDesktopFileStore()

  const unsubWatcherRef = useRef<(() => Promise<void>) | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Quick Look state ────────────────────────────────────────────────────────
  const [quickLookPath, setQuickLookPath] = useState<string | null>(null)

  /** All file paths visible in the current view (for ← → navigation). */
  const allFilePaths = useMemo<string[]>(() => {
    const showSearch = searchQuery.trim().length > 0
    if (showSearch) return searchResults.filter((n) => !n.isDir).map((n) => n.path)
    return flattenFiles(tree)
  }, [tree, searchResults, searchQuery])

  // ── Git & tree loading ──────────────────────────────────────────────────────
  const loadGitStatus = useCallback(async (): Promise<Record<string, GitFileStatus>> => {
    if (!rootPath || !isDesktop()) return {}
    try {
      const status = await desktopBridge.git.status(rootPath)
      const typed: Record<string, GitFileStatus> = {}
      for (const f of status.files) {
        const abs = `${rootPath.replace(/\/$/, '')}/${f.path}`
        typed[abs] = gitChangeStatus(f)
      }
      setGitStatusMap(typed)
      return typed
    } catch {
      return {}
    }
  }, [rootPath, setGitStatusMap])

  const loadTree = useCallback(async () => {
    if (!rootPath || !isDesktop()) {
      setTree([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      const statusMap = await loadGitStatus()
      const nodes = await buildTree(rootPath, statusMap)
      setTree(nodes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file tree')
    } finally {
      setLoading(false)
    }
  }, [rootPath, setTree, setLoading, setError, loadGitStatus])

  useEffect(() => {
    setRootPath(rootPath)
    void loadTree()
  }, [rootPath, setRootPath, loadTree])

  // File watcher: refresh the tree on any change inside the project root.
  useEffect(() => {
    if (!rootPath || !isDesktop()) return

    let cancelled = false
    void (async () => {
      try {
        const unsub = await desktopBridge.watcher.subscribe(rootPath, () => {
          void loadTree()
        })
        if (cancelled) {
          await unsub()
        } else {
          unsubWatcherRef.current = unsub
        }
      } catch {
        // watcher unavailable — manual refresh still works
      }
    })()

    return () => {
      cancelled = true
      const unsub = unsubWatcherRef.current
      unsubWatcherRef.current = null
      if (unsub) void unsub()
    }
  }, [rootPath, loadTree])

  // ── Search ──────────────────────────────────────────────────────────────────
  const runSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim()
      if (!trimmed) {
        setSearchResults([])
        return
      }
      if (rootPath && isDesktop()) {
        try {
          const { matches } = await desktopBridge.fs.search({
            root: rootPath,
            query: trimmed,
            limit: 200,
          })
          setSearchResults(
            matches.map((m) => ({
              path: m.path,
              name: m.name,
              isDir: m.type === 'directory',
              children: m.type === 'directory' ? [] : undefined,
              gitStatus: gitStatusMap[m.path],
              expanded: false,
            })),
          )
          return
        } catch {
          // fall through to client-side fallback
        }
      }
      const needle = trimmed.toLowerCase()
      const fallback = flattenTreeForSearch(tree)
        .filter(
          (n) =>
            n.name.toLowerCase().includes(needle) ||
            n.path.toLowerCase().includes(needle),
        )
        .slice(0, 200)
      setSearchResults(fallback)
    },
    [rootPath, tree, gitStatusMap, setSearchResults],
  )

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query)
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      searchTimerRef.current = setTimeout(() => void runSearch(query), 150)
    },
    [setSearchQuery, runSearch],
  )

  // ── Selection & Quick Look ──────────────────────────────────────────────────
  const handleFileSelect = useCallback(
    (path: string) => {
      setSelectedFile(path)
      onFileSelect?.(path)
    },
    [setSelectedFile, onFileSelect],
  )

  const handleQuickLook = useCallback((path: string) => {
    setQuickLookPath(path)
  }, [])

  const handleQuickLookClose = useCallback(() => {
    setQuickLookPath(null)
  }, [])

  const handleQuickLookNavigate = useCallback((path: string) => {
    setQuickLookPath(path)
    setSelectedFile(path)
  }, [setSelectedFile])

  // ── Tree expand/collapse ────────────────────────────────────────────────────
  const handleToggle = useCallback(
    async (path: string) => {
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
        const children = await buildTree(path, gitStatusMap)
        const updateChildren = (nodes: FileNode[]): FileNode[] =>
          nodes.map((n) => {
            if (n.path === path) return { ...n, children, expanded: true }
            if (n.children) return { ...n, children: updateChildren(n.children) }
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
    <>
      <div className="flex flex-col h-full min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5 px-2 pt-2 pb-1.5 flex-shrink-0">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted flex-1 min-w-0">
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
          <button
            onClick={() => void loadTree()}
            disabled={loading}
            className={cn(
              'p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted',
              'transition-colors duration-100 flex-shrink-0',
              loading && 'animate-spin',
            )}
            title="Refresh file tree"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-1">
          {loading && tree.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              Loading files...
            </div>
          ) : !rootPath ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              No project directory
            </div>
          ) : showSearch ? (
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
                    onQuickLook={handleQuickLook}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="flex flex-col">
              {tree.map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedPath={selectedFile}
                  onSelect={handleFileSelect}
                  onToggle={handleToggle}
                  onQuickLook={handleQuickLook}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Look portal — rendered outside the pane DOM so it overlays everything */}
      <QuickLook
        filePath={quickLookPath}
        filePaths={allFilePaths}
        onClose={handleQuickLookClose}
        onNavigate={handleQuickLookNavigate}
      />
    </>
  )
}
