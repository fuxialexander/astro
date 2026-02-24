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
  ChevronRight,
  Home,
  Loader2,
  AlertCircle,
  ArrowUp,
  RefreshCw,
  FileText,
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

/** Fetch directory listing from the API */
async function fetchDirectoryList(
  machineId: string,
  path: string
): Promise<{ path: string; entries: DirectoryEntry[]; error?: string; homeDirectory?: string }> {
  const token = await getAccessToken()
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  }
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

  // Refs
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load directory contents
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
          setEntries([])
        } else {
          setPath(result.path)
          setInputPath(result.path)
          setEntries(result.entries)

          if (result.homeDirectory) {
            setHomeDirectory(result.homeDirectory)
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

  // Parse path into breadcrumb segments
  const breadcrumbs = path.split("/").filter(Boolean)
  const directories = entries.filter((e) => e.isDirectory)
  const files = entries.filter((e) => !e.isDirectory)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
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
        <div className="flex items-center gap-1 text-sm overflow-x-auto py-1">
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

          <div className="flex items-center gap-0.5 overflow-x-auto">
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

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 ml-auto shrink-0"
            onClick={() => loadDirectory(path)}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>

        {/* Directory listing */}
        <div
          ref={listRef}
          className="flex-1 min-h-[300px] max-h-[400px] overflow-y-auto border rounded-lg bg-background"
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
              <Button variant="outline" size="sm" onClick={() => loadDirectory(path)}>
                Retry
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 p-4">
              <FolderOpen className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">This directory is empty</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
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
