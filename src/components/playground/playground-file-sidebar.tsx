/**
 * Playground File Sidebar
 *
 * Inline file explorer panel adapted from RemotePathBrowser.
 * Browses directories on a remote machine starting from workingDirectory.
 */

import { useState, useEffect, useCallback, useRef } from "react"
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
  X,
  ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"
import { buildFileUrlSync } from "@/lib/path-utils"

interface DirectoryEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink?: boolean
}

interface PlaygroundFileSidebarProps {
  machineId: string
  machineName?: string
  machineHostname?: string
  workingDirectory: string
  editorType?: 'cursor' | 'vscode'
  onClose: () => void
}

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

export function PlaygroundFileSidebar({
  machineId,
  machineName,
  machineHostname,
  workingDirectory,
  editorType = 'cursor',
  onClose,
}: PlaygroundFileSidebarProps) {
  const [path, setPath] = useState(workingDirectory)
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
  const listRef = useRef<HTMLDivElement>(null)

  const machine = { name: machineName, hostname: machineHostname }

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
          setEntries(result.entries)
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

  useEffect(() => {
    if (machineId && workingDirectory) {
      loadDirectory(workingDirectory)
    }
  }, [machineId, workingDirectory, loadDirectory])

  const navigateTo = (targetPath: string) => {
    loadDirectory(targetPath)
  }

  const goUp = () => {
    const parts = path.split("/").filter(Boolean)
    if (parts.length <= 1) {
      navigateTo("/")
    } else {
      parts.pop()
      navigateTo("/" + parts.join("/"))
    }
  }

  const handleEntryClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      navigateTo(entry.path)
    } else {
      // Open file in editor
      const url = buildFileUrlSync(entry.path, undefined, machine, false, editorType)
      if (url) {
        window.open(url, '_blank')
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const allEntries = entries
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, allEntries.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, -1))
        break
      case "Enter":
        e.preventDefault()
        if (selectedIndex >= 0 && selectedIndex < allEntries.length) {
          handleEntryClick(allEntries[selectedIndex])
        }
        break
      case "Backspace":
        e.preventDefault()
        goUp()
        break
    }
  }

  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[data-entry-index]")
      const selectedItem = items[selectedIndex]
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: "nearest" })
      }
    }
  }, [selectedIndex])

  const breadcrumbs = path.split("/").filter(Boolean)
  const directories = entries.filter((e) => e.isDirectory)
  const files = entries.filter((e) => !e.isDirectory)

  const openCurrentInEditor = () => {
    const url = buildFileUrlSync(path, undefined, machine, false, editorType)
    if (url) {
      window.open(url, '_blank')
    }
  }

  return (
    <div className="flex flex-col h-full w-[280px] border-l border-border bg-background shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Folder className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-medium truncate flex-1">Files</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={openCurrentInEditor}
          title="Open in editor"
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => loadDirectory(path)}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClose}
          title="Close"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 text-[11px] overflow-x-auto border-b border-border shrink-0">
        <button
          onClick={() => navigateTo(workingDirectory)}
          className="px-1 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
          title="Go to working directory"
        >
          <Home className="h-3 w-3" />
        </button>
        {path !== "/" && (
          <button
            onClick={goUp}
            className="px-1 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
        )}
        <div className="flex items-center gap-0 overflow-x-auto">
          {breadcrumbs.slice(-3).map((segment, index) => {
            const fullIndex = breadcrumbs.length - 3 + index
            const actualIndex = Math.max(0, fullIndex)
            return (
              <div key={`${actualIndex}-${segment}`} className="flex items-center shrink-0">
                {index > 0 && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />}
                <button
                  onClick={() => navigateTo("/" + breadcrumbs.slice(0, actualIndex + 1).join("/"))}
                  className={cn(
                    "px-1 py-0.5 rounded hover:bg-muted transition-colors truncate max-w-[80px]",
                    actualIndex === breadcrumbs.length - 1
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {segment}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* File listing */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 p-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-xs text-destructive text-center">{error}</p>
            <Button variant="outline" size="sm" onClick={() => loadDirectory(path)}>
              Retry
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 p-3">
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Empty directory</p>
          </div>
        ) : (
          <div>
            {directories.map((entry, index) => (
              <button
                key={entry.path}
                data-entry-index={index}
                onClick={() => handleEntryClick(entry)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors",
                  selectedIndex === index && "bg-primary/10"
                )}
              >
                <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-xs truncate">{entry.name}</span>
              </button>
            ))}
            {files.map((entry, index) => (
              <button
                key={entry.path}
                data-entry-index={directories.length + index}
                onClick={() => handleEntryClick(entry)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors",
                  selectedIndex === directories.length + index && "bg-primary/10"
                )}
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs truncate text-muted-foreground">{entry.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
