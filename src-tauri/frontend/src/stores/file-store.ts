/**
 * File store — project file tree with git status.
 * Loads data via Tauri IPC (listDir, git_status).
 */
import { create } from 'zustand'

export type GitFileStatus =
  | 'modified'
  | 'staged'
  | 'untracked'
  | 'deleted'
  | 'renamed'
  | 'conflict'
  | 'clean'

export interface FileNode {
  path: string
  name: string
  isDir: boolean
  children?: FileNode[]
  gitStatus?: GitFileStatus
  expanded?: boolean
}

interface FileState {
  rootPath: string | null
  tree: FileNode[]
  loading: boolean
  error: string | null
  searchQuery: string
  searchResults: FileNode[]
  selectedFile: string | null
  gitStatusMap: Record<string, GitFileStatus>

  setRootPath: (path: string | null) => void
  setTree: (tree: FileNode[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setSearchQuery: (query: string) => void
  setSearchResults: (results: FileNode[]) => void
  setSelectedFile: (path: string | null) => void
  toggleExpanded: (path: string) => void
  setGitStatusMap: (map: Record<string, GitFileStatus>) => void
}

function toggleNodeExpanded(nodes: FileNode[], targetPath: string): FileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, expanded: !node.expanded }
    }
    if (node.children) {
      return { ...node, children: toggleNodeExpanded(node.children, targetPath) }
    }
    return node
  })
}

export const useFileStore = create<FileState>()((set) => ({
  rootPath: null,
  tree: [],
  loading: false,
  error: null,
  searchQuery: '',
  searchResults: [],
  selectedFile: null,
  gitStatusMap: {},

  setRootPath: (rootPath) => set({ rootPath }),
  setTree: (tree) => set({ tree }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  toggleExpanded: (path) =>
    set((s) => ({ tree: toggleNodeExpanded(s.tree, path) })),
  setGitStatusMap: (gitStatusMap) => set({ gitStatusMap }),
}))
