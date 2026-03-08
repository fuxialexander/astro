/**
 * useFileBrowser — Hook extracting directory navigation logic
 *
 * Provides directory listing, navigation (breadcrumbs, keyboard),
 * upload, and preview state management for reuse across file browser UIs.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirectoryEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink?: boolean
}

export interface UseFileBrowserOptions {
  machineId: string
  workingDirectory: string
  /** Hide dotfiles / dot-directories by default */
  showHiddenFiles?: boolean
}

export interface UseFileBrowserReturn {
  // State
  path: string
  entries: DirectoryEntry[]
  directories: DirectoryEntry[]
  files: DirectoryEntry[]
  loading: boolean
  error: string | null
  selectedIndex: number
  showHiddenFiles: boolean
  previewPath: string | null

  // Refs
  listRef: React.RefObject<HTMLDivElement | null>

  // Navigation
  navigateTo: (targetPath: string) => void
  goUp: () => void
  goHome: () => void
  refresh: () => void
  setSelectedIndex: (index: number) => void
  toggleHiddenFiles: () => void

  // Preview
  setPreviewPath: (path: string | null) => void

  // Upload
  uploadFile: (file: File, destinationDir?: string) => Promise<{ success: boolean; path?: string; error?: string }>

  // Keyboard handler
  handleKeyDown: (e: React.KeyboardEvent) => void

  // Breadcrumbs
  breadcrumbs: string[]
}

// ---------------------------------------------------------------------------
// Directory listing API
// ---------------------------------------------------------------------------

async function fetchDirectoryList(
  machineId: string,
  path: string
): Promise<{ path: string; entries: DirectoryEntry[]; error?: string; homeDirectory?: string }> {
  const token = await getAccessToken()
  const headers: HeadersInit = { "Content-Type": "application/json" }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const params = new URLSearchParams({ machineId, path })
  const response = await fetch(apiUrl(`/api/fs/directories?${params}`), { headers })

  if (!response.ok) {
    throw new Error(`Failed to fetch directory listing: ${response.statusText}`)
  }

  return response.json()
}

// ---------------------------------------------------------------------------
// Upload API
// ---------------------------------------------------------------------------

async function uploadFileToMachine(
  machineId: string,
  destinationPath: string,
  file: File
): Promise<{ success: boolean; path?: string; size?: number; error?: string }> {
  const token = await getAccessToken()
  const headers: HeadersInit = {}
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const formData = new FormData()
  formData.append("machineId", machineId)
  formData.append("destinationPath", destinationPath)
  formData.append("file", file)
  formData.append("overwrite", "false")

  const response = await fetch(apiUrl("/api/fs/content"), {
    method: "POST",
    headers,
    body: formData,
  })

  if (!response.ok && response.status !== 409) {
    throw new Error(`Upload failed: ${response.statusText}`)
  }

  return response.json()
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFileBrowser({
  machineId,
  workingDirectory,
  showHiddenFiles: initialShowHidden = false,
}: UseFileBrowserOptions): UseFileBrowserReturn {
  const [path, setPath] = useState(workingDirectory)
  const [allEntries, setAllEntries] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
  const [showHiddenFiles, setShowHiddenFiles] = useState(initialShowHidden)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter hidden files
  const entries = showHiddenFiles
    ? allEntries
    : allEntries.filter((e) => !e.name.startsWith("."))

  const directories = entries.filter((e) => e.isDirectory)
  const files = entries.filter((e) => !e.isDirectory)

  const loadDirectory = useCallback(
    async (targetPath: string) => {
      if (!machineId) return

      setLoading(true)
      setError(null)
      setSelectedIndex(-1)

      try {
        const result = await fetchDirectoryList(machineId, targetPath)
        if (result.error) {
          setError(result.error)
          setAllEntries([])
        } else {
          setPath(result.path)
          setAllEntries(result.entries)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load directory")
        setAllEntries([])
      } finally {
        setLoading(false)
      }
    },
    [machineId]
  )

  useEffect(() => {
    if (machineId && workingDirectory) {
      loadDirectory(workingDirectory)
    }
  }, [machineId, workingDirectory, loadDirectory])

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[data-entry-index]")
      const selectedItem = items[selectedIndex]
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: "nearest" })
      }
    }
  }, [selectedIndex])

  const navigateTo = useCallback(
    (targetPath: string) => {
      loadDirectory(targetPath)
    },
    [loadDirectory]
  )

  const goUp = useCallback(() => {
    const parts = path.split("/").filter(Boolean)
    if (parts.length <= 1) {
      navigateTo("/")
    } else {
      parts.pop()
      navigateTo("/" + parts.join("/"))
    }
  }, [path, navigateTo])

  const goHome = useCallback(() => {
    navigateTo(workingDirectory)
  }, [workingDirectory, navigateTo])

  const refresh = useCallback(() => {
    loadDirectory(path)
  }, [path, loadDirectory])

  const toggleHiddenFiles = useCallback(() => {
    setShowHiddenFiles((prev) => !prev)
    setSelectedIndex(-1)
  }, [])

  const uploadFile = useCallback(
    async (file: File, destinationDir?: string) => {
      const dir = destinationDir || path
      const destinationPath = `${dir.replace(/\/$/, "")}/${file.name}`

      try {
        const result = await uploadFileToMachine(machineId, destinationPath, file)
        // Refresh directory after upload
        if (result.success) {
          loadDirectory(path)
        }
        return result
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Upload failed",
        }
      }
    },
    [machineId, path, loadDirectory]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, entries.length - 1))
          break
        case "ArrowUp":
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, -1))
          break
        case "Enter":
          e.preventDefault()
          if (selectedIndex >= 0 && selectedIndex < entries.length) {
            const entry = entries[selectedIndex]
            if (entry.isDirectory) {
              navigateTo(entry.path)
            }
          }
          break
        case "Backspace":
          e.preventDefault()
          goUp()
          break
      }
    },
    [entries, selectedIndex, navigateTo, goUp]
  )

  const breadcrumbs = path.split("/").filter(Boolean)

  return {
    path,
    entries,
    directories,
    files,
    loading,
    error,
    selectedIndex,
    showHiddenFiles,
    previewPath,
    listRef,
    navigateTo,
    goUp,
    goHome,
    refresh,
    setSelectedIndex,
    toggleHiddenFiles,
    setPreviewPath,
    uploadFile,
    handleKeyDown,
    breadcrumbs,
  }
}
