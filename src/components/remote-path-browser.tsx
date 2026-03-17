/**
 * Remote Path Browser
 *
 * A component for browsing and selecting directories on a remote machine.
 * Similar to VS Code's Remote-SSH folder selection experience.
 *
 * Features:
 * - Navigate directories starting from user's home directory
 * - Paste absolute paths directly
 * - Breadcrumb navigation
 * - Keyboard navigation support
 */

import { useState, useEffect, useCallback, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  Home,
  Loader2,
  AlertCircle,
  ArrowUp,
  RefreshCw,
  FileText,
  Check,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"

/** Directory entry returned from the API */
interface DirectoryEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink?: boolean
}

/** Props for the RemotePathBrowser component */
interface RemotePathBrowserProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
  /** ID of the machine to browse */
  machineId: string
  /** Name of the machine (for display) */
  machineName?: string
  /** Currently selected path */
  currentPath?: string
  /** Callback when a path is selected */
  onSelect: (path: string) => void
}

/** Fetch directory listing from the API with a single immediate retry */
async function fetchDirectoryList(
  machineId: string,
  path: string,
  noCache = false,
): Promise<{ path: string; entries: DirectoryEntry[]; error?: string; homeDirectory?: string }> {
  const token = await getAccessToken()
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  // Single immediate retry for transient errors (no delay)
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const params = new URLSearchParams({ machineId, path })
      if (noCache) params.set("noCache", "1")
      const response = await fetch(apiUrl(`/api/fs/directories?${params}`), { headers })

      if (!response.ok) {
        throw new Error(`Failed to fetch directory listing: ${response.statusText}`)
      }

      const result = await response.json()

      // Retry once on transient errors (no delay)
      if (result.error && attempt === 0) {
        const transient = /not connected|timed? ?out|unavailable/i.test(result.error)
        if (transient) continue
      }

      return result
    } catch (err) {
      if (attempt === 0) continue
      throw err
    }
  }

  throw new Error("Failed to fetch directory listing after retry")
}

/** Create a directory on a remote machine */
async function createRemoteDirectory(
  machineId: string,
  parentPath: string,
  name: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  const token = await getAccessToken()
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(apiUrl("/api/fs/directories"), {
    method: "POST",
    headers,
    body: JSON.stringify({ machineId, path: parentPath, name }),
  })

  return response.json()
}

/** Client-side navigation cache — avoids network for previously visited dirs */
const CLIENT_CACHE_TTL_MS = 60_000 // 60 seconds

interface ClientCacheEntry {
  path: string
  entries: DirectoryEntry[]
  homeDirectory?: string
  expiresAt: number
}

export function RemotePathBrowser({
  open,
  onOpenChange,
  machineId,
  machineName,
  currentPath,
  onSelect,
}: RemotePathBrowserProps) {
  // State
  const [path, setPath] = useState(currentPath || "~")
  const [inputPath, setInputPath] = useState(currentPath || "")
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [homeDirectory, setHomeDirectory] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)

  // New folder creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Client-side navigation cache (persists across navigations within the dialog)
  const navCacheRef = useRef<Map<string, ClientCacheEntry>>(new Map())

  // Refs
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  const breadcrumbRef = useRef<HTMLDivElement>(null)

  // Load directory contents with client-side cache
  const loadDirectory = useCallback(
    async (targetPath: string, forceRefresh = false) => {
      if (!machineId) return

      // Check client-side cache first (instant, no network)
      if (!forceRefresh) {
        const cached = navCacheRef.current.get(targetPath)
        if (cached && Date.now() < cached.expiresAt) {
          setPath(cached.path)
          setInputPath(cached.path)
          setEntries(cached.entries)
          if (cached.homeDirectory) setHomeDirectory(cached.homeDirectory)
          setError(null)
          setSelectedIndex(-1)
          return
        }
      }

      setLoading(true)
      setError(null)
      setSelectedIndex(-1)

      try {
        const result = await fetchDirectoryList(machineId, targetPath, forceRefresh)

        if (result.error) {
          setError(result.error)
          setEntries([])
        } else {
          setPath(result.path)
          setInputPath(result.path)
          setEntries(result.entries)

          if (result.homeDirectory) {
            setHomeDirectory(result.homeDirectory)
          }

          // Store in client-side cache
          navCacheRef.current.set(targetPath, {
            path: result.path,
            entries: result.entries,
            homeDirectory: result.homeDirectory,
            expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
          })
          // Also cache by resolved path (e.g., "~" → "/Users/foo")
          if (result.path !== targetPath) {
            navCacheRef.current.set(result.path, {
              path: result.path,
              entries: result.entries,
              homeDirectory: result.homeDirectory,
              expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
            })
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load directory")
        setEntries([])
      } finally {
        setLoading(false)
      }
    },
    [machineId]
  )

  // Initial load when dialog opens
  useEffect(() => {
    if (open && machineId) {
      loadDirectory(currentPath || "~")
    }
  }, [open, machineId, currentPath, loadDirectory])

  // Navigate to a directory
  const navigateTo = (targetPath: string) => {
    setIsCreatingFolder(false)
    setNewFolderName("")
    setCreateError(null)
    loadDirectory(targetPath)
  }

  // Go up one level
  const goUp = () => {
    if (path === "/" || path === homeDirectory) return

    // Get parent path
    const parts = path.split("/").filter(Boolean)
    if (parts.length <= 1) {
      navigateTo("/")
    } else {
      parts.pop()
      navigateTo("/" + parts.join("/"))
    }
  }

  // Go to home directory
  const goHome = () => {
    navigateTo("~")
  }

  // Handle input submission (paste/type a path)
  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = inputPath.trim()
    if (trimmed) {
      navigateTo(trimmed)
    }
  }

  // Handle entry click
  const handleEntryClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      navigateTo(entry.path)
    }
  }

  // Handle entry double-click
  const handleEntryDoubleClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      // Select this directory
      onSelect(entry.path)
      onOpenChange(false)
    }
  }

  // Select current directory
  const handleSelectCurrent = () => {
    onSelect(path)
    onOpenChange(false)
  }

  // Start creating a new folder
  const startCreatingFolder = () => {
    setIsCreatingFolder(true)
    setNewFolderName("")
    setCreateError(null)
    // Focus the input after render
    setTimeout(() => newFolderInputRef.current?.focus(), 0)
  }

  // Cancel folder creation
  const cancelCreatingFolder = () => {
    setIsCreatingFolder(false)
    setNewFolderName("")
    setCreateError(null)
  }

  // Confirm folder creation
  const confirmCreateFolder = async () => {
    const trimmed = newFolderName.trim()
    if (!trimmed) return

    setCreating(true)
    setCreateError(null)

    try {
      const result = await createRemoteDirectory(machineId, path, trimmed)
      if (result.success) {
        setIsCreatingFolder(false)
        setNewFolderName("")
        // Invalidate parent cache since a new folder was created
        navCacheRef.current.delete(path)
        // Navigate into the newly created folder so users can create nested folders
        const newPath = result.path || `${path.replace(/\/$/, '')}/${trimmed}`
        loadDirectory(newPath, true)
      } else {
        setCreateError(result.error || "Failed to create folder")
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create folder")
    } finally {
      setCreating(false)
    }
  }

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const directories = entries.filter((e) => e.isDirectory)

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, directories.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, -1))
        break
      case "Enter":
        e.preventDefault()
        if (selectedIndex >= 0 && selectedIndex < directories.length) {
          navigateTo(directories[selectedIndex].path)
        }
        break
      case "Backspace":
        if (inputPath === path || inputPath === "") {
          e.preventDefault()
          goUp()
        }
        break
    }
  }

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

  // Auto-scroll breadcrumb to show the current (rightmost) segment
  useEffect(() => {
    if (breadcrumbRef.current) {
      breadcrumbRef.current.scrollLeft = breadcrumbRef.current.scrollWidth
    }
  }, [path])

  // Parse path into breadcrumb segments
  const breadcrumbs = path.split("/").filter(Boolean)
  const directories = entries.filter((e) => e.isDirectory)
  const files = entries.filter((e) => !e.isDirectory)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5 text-primary" />
            <span>Select Directory</span>
            {machineName && (
              <span className="text-sm font-normal text-muted-foreground">
                on {machineName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Path input */}
        <form onSubmit={handleInputSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            placeholder="Enter or paste an absolute path..."
            className="flex-1 font-mono text-sm"
            onKeyDown={handleKeyDown}
          />
          <Button type="submit" variant="outline" size="icon" disabled={loading}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </form>

        {/* Breadcrumb navigation */}
        <div className="flex items-center gap-1 text-sm overflow-x-auto py-1 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 shrink-0"
            onClick={goHome}
            disabled={loading}
          >
            <Home className="h-4 w-4" />
          </Button>

          {path !== "/" && path !== homeDirectory && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 shrink-0"
              onClick={goUp}
              disabled={loading}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}

          <div ref={breadcrumbRef} className="flex items-center gap-0.5 overflow-x-auto">
            <button
              onClick={() => navigateTo("/")}
              className="px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              /
            </button>
            {breadcrumbs.map((segment, index) => (
              <div key={index} className="flex items-center shrink-0">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <button
                  onClick={() =>
                    navigateTo("/" + breadcrumbs.slice(0, index + 1).join("/"))
                  }
                  className={cn(
                    "px-1.5 py-0.5 rounded hover:bg-muted transition-colors",
                    index === breadcrumbs.length - 1
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {segment}
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={startCreatingFolder}
              disabled={loading || isCreatingFolder}
              title="New Folder"
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => loadDirectory(path, true)}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Directory listing */}
        <div
          ref={listRef}
          className="flex-1 min-h-[280px] max-h-[400px] overflow-y-auto border rounded-lg bg-background"
          onKeyDown={handleKeyDown}
          tabIndex={0}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 p-4">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive text-center">{error}</p>
              <Button variant="outline" size="sm" onClick={() => loadDirectory(path, true)}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* New folder inline input */}
              {isCreatingFolder && (
                <div className="px-3 py-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <Folder className="h-4 w-4 text-primary shrink-0" />
                    <Input
                      ref={newFolderInputRef}
                      value={newFolderName}
                      onChange={(e) => {
                        setNewFolderName(e.target.value)
                        setCreateError(null)
                      }}
                      placeholder="Folder name..."
                      className="h-7 text-sm flex-1"
                      disabled={creating}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          confirmCreateFolder()
                        } else if (e.key === "Escape") {
                          e.preventDefault()
                          cancelCreatingFolder()
                        }
                        e.stopPropagation()
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={confirmCreateFolder}
                      disabled={creating || !newFolderName.trim()}
                    >
                      {creating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={cancelCreatingFolder}
                      disabled={creating}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {createError && (
                    <p className="text-xs text-destructive pl-6">{createError}</p>
                  )}
                </div>
              )}

              {/* Empty state */}
              {entries.length === 0 && !isCreatingFolder && (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <FolderOpen className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">This directory is empty</p>
                </div>
              )}

              {/* Directories first */}
              {directories.map((entry, index) => (
                <button
                  key={entry.path}
                  data-entry-index={index}
                  onClick={() => handleEntryClick(entry)}
                  onDoubleClick={() => handleEntryDoubleClick(entry)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors",
                    selectedIndex === index && "bg-primary/10"
                  )}
                >
                  <Folder className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm truncate">{entry.name}</span>
                  {entry.isSymlink && (
                    <span className="text-xs text-muted-foreground ml-auto">symlink</span>
                  )}
                </button>
              ))}

              {/* Then files (shown but not selectable) */}
              {files.map((entry) => (
                <div
                  key={entry.path}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left opacity-50"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate text-muted-foreground">{entry.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Current selection display */}
        <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-sm">
          <span className="text-muted-foreground shrink-0">Selected:</span>
          <span className="font-mono text-xs truncate flex-1">{path}</span>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSelectCurrent} disabled={loading || !path}>
            Select Folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
