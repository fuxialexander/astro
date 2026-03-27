/**
 * FileBrowser — Shared file browser component
 *
 * Replaces/upgrades PlaygroundFileSidebar with:
 * - Directory navigation with breadcrumbs + keyboard nav
 * - Per-file context menu (preview, download, copy link)
 * - Upload button + drag-and-drop zone
 * - File type icons
 * - Preview panel state management
 * - Hidden file filtering
 */

import { useState, useCallback, useRef, useEffect, type MouseEvent as ReactMouseEvent } from "react"
import {
  Folder,
  FolderOpen,
  ChevronRight,
  Home,
  Loader2,
  AlertCircle,
  ArrowUp,
  RefreshCw,
  X,
  Upload,
  Eye,
  EyeOff,
  Download,
  FileText,
  FileCode,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileSpreadsheet,
  File,
  FileJson,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { EditorOpenControls, type EditorType } from "@/components/ui/editor-open-controls"
import { cn } from "@/lib/utils"
import { buildFileUrlSync } from "@/lib/path-utils"
import { useFileBrowser, type DirectoryEntry } from "./use-file-browser"
import { FileActionsMenu } from "./file-actions-menu"
import { useFileUpload } from "./use-file-upload"
import { UploadManager } from "./upload-manager"
import { FilePreview } from "./file-preview"
import { getFileCategory } from "./file-type-utils"
import { downloadFile } from "./download-utils"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FileBrowserProps {
  machineId: string
  machineName?: string
  machineHostname?: string
  workingDirectory: string
  /** Directory to fall back to if workingDirectory does not exist */
  fallbackDirectory?: string
  editorType?: EditorType
  onClose?: () => void
  /** When true, renders without fixed width/border (for Sheet embedding) */
  embedded?: boolean
  /** Callback when a file is selected (e.g., from FileChangeBlock linking) */
  onFileSelect?: (path: string) => void
  /** When set, navigates to the parent directory and previews the file */
  initialFilePath?: string | null
}

// ---------------------------------------------------------------------------
// File icon mapping
// ---------------------------------------------------------------------------

const EXT_ICON_MAP: Record<string, typeof FileText> = {
  // Code
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  py: FileCode,
  rb: FileCode,
  go: FileCode,
  rs: FileCode,
  java: FileCode,
  c: FileCode,
  cpp: FileCode,
  h: FileCode,
  hpp: FileCode,
  css: FileCode,
  scss: FileCode,
  html: FileCode,
  xml: FileCode,
  yaml: FileCode,
  yml: FileCode,
  toml: FileCode,
  sh: FileCode,
  bash: FileCode,
  zsh: FileCode,
  sql: FileCode,
  vue: FileCode,
  svelte: FileCode,
  // JSON
  json: FileJson,
  jsonc: FileJson,
  // Images
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  webp: FileImage,
  ico: FileImage,
  bmp: FileImage,
  // Video
  mp4: FileVideo,
  mov: FileVideo,
  avi: FileVideo,
  mkv: FileVideo,
  webm: FileVideo,
  // Audio
  mp3: FileAudio,
  wav: FileAudio,
  flac: FileAudio,
  ogg: FileAudio,
  aac: FileAudio,
  // Archives
  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  bz2: FileArchive,
  "7z": FileArchive,
  rar: FileArchive,
  // Spreadsheet / data
  csv: FileSpreadsheet,
  tsv: FileSpreadsheet,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  // Documents
  md: FileText,
  txt: FileText,
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  rst: FileText,
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  return EXT_ICON_MAP[ext] ?? File
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileBrowser({
  machineId,
  machineName,
  machineHostname,
  workingDirectory,
  fallbackDirectory,
  editorType: initialEditorType = "cursor",
  onClose,
  embedded = false,
  onFileSelect,
  initialFilePath,
}: FileBrowserProps) {
  const [activeEditor, setActiveEditor] = useState<EditorType>(initialEditorType)
  const [useLocal, setUseLocal] = useState(true)
  const [isDragOver, setIsDragOver] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [menuOpenIndex, setMenuOpenIndex] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const machine = { name: machineName, hostname: machineHostname }

  // Resizable width (desktop non-embedded only)
  const [fileBrowserWidth, setFileBrowserWidth] = useState(() => {
    try {
      const stored = localStorage.getItem("astro-file-browser-width")
      if (!stored) return 360
      const n = Number(stored)
      return Number.isFinite(n) ? Math.max(200, Math.min(600, n)) : 360
    } catch { return 360 }
  })
  const isResizing = useRef(false)

  const onResizeMouseDown = useCallback((e: ReactMouseEvent) => {
    if (embedded) return
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    // The file browser is on the right edge — dragging left increases width
    const startX = e.clientX
    const startWidth = fileBrowserWidth

    const onMouseMove = (ev: globalThis.MouseEvent) => {
      if (!isResizing.current) return
      const delta = startX - ev.clientX
      const newWidth = Math.max(200, Math.min(600, startWidth + delta))
      setFileBrowserWidth(newWidth)
    }

    const onMouseUp = () => {
      isResizing.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [embedded, fileBrowserWidth])

  // Persist width on change (debounced via the mouseup handler above, but also on unmount)
  useEffect(() => {
    if (!embedded) {
      try { localStorage.setItem("astro-file-browser-width", String(fileBrowserWidth)) } catch { /* */ }
    }
  }, [fileBrowserWidth, embedded])

  const {
    path,
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
    toggleHiddenFiles,
    setPreviewPath,
    handleKeyDown: hookKeyDown,
    breadcrumbs,
    entries,
  } = useFileBrowser({ machineId, workingDirectory, fallbackDirectory })

  // Navigate to initialFilePath when provided
  useEffect(() => {
    if (!initialFilePath) return
    const parentDir = initialFilePath.substring(0, initialFilePath.lastIndexOf('/'))
    if (parentDir) navigateTo(parentDir)
    setPreviewPath(initialFilePath)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only trigger on initialFilePath change
  }, [initialFilePath])

  // File upload with validation, progress, and overwrite detection
  const {
    uploads,
    isUploading,
    startUpload,
    cancelUpload,
    retryUpload,
    dismissUpload,
    clearCompleted,
    overwritePending,
    confirmOverwrite,
    rejectOverwrite,
    validationErrors,
    dismissValidationError,
  } = useFileUpload({
    machineId,
    currentPath: path,
    currentEntries: entries,
    onRefresh: refresh,
  })

  // Extend keyboard handler to open files on Enter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && selectedIndex >= 0 && selectedIndex < entries.length) {
        const entry = entries[selectedIndex]
        if (!entry.isDirectory) {
          e.preventDefault()
          handleFileClick(entry)
          return
        }
      }
      hookKeyDown(e)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIndex, entries, hookKeyDown]
  )

  const handleFileClick = (entry: DirectoryEntry) => {
    if (onFileSelect) {
      onFileSelect(entry.path)
      return
    }
    // Image/PDF/markdown/code files → preview instead of opening editor
    const category = getFileCategory(entry.name)
    if (category !== "download-only") {
      setPreviewPath(entry.path)
      return
    }
    // Fallback: open in editor for unsupported preview types
    const forceLocal = useLocal ? true : ("remote" as const)
    const url = buildFileUrlSync(
      entry.path,
      undefined,
      machine as Parameters<typeof buildFileUrlSync>[2],
      forceLocal,
      activeEditor
    )
    if (url) {
      window.open(url, "_blank")
    }
  }

  const handleNavigate = useCallback(
    (targetPath: string) => {
      setPreviewPath(null)
      navigateTo(targetPath)
    },
    [navigateTo, setPreviewPath]
  )

  const handleGoUp = useCallback(() => {
    setPreviewPath(null)
    goUp()
  }, [goUp, setPreviewPath])

  const handleGoHome = useCallback(() => {
    setPreviewPath(null)
    goHome()
  }, [goHome, setPreviewPath])

  const handleEntryClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      handleNavigate(entry.path)
    } else {
      handleFileClick(entry)
    }
  }

  // -----------------------------------------------------------------------
  // Upload handlers
  // -----------------------------------------------------------------------

  const handleUploadFiles = useCallback(
    (fileList: FileList) => {
      if (fileList.length === 0) return
      startUpload(Array.from(fileList))
    },
    [startUpload]
  )

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleUploadFiles(e.target.files)
      // Reset input so re-selecting the same file works
      e.target.value = ""
    }
  }

  // -----------------------------------------------------------------------
  // Drag and drop
  // -----------------------------------------------------------------------

  const dragCounter = useRef(0)

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setIsDragOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragOver(false)

    if (e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files)
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-background shrink-0 relative",
        embedded ? "w-full" : "border-l border-border"
      )}
      style={embedded ? undefined : { width: fileBrowserWidth }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Resize handle on the left edge (desktop only) */}
      {!embedded && (
        <div
          onMouseDown={onResizeMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
        />
      )}
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/5 border-2 border-dashed border-primary rounded-md pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-primary" />
            <p className="text-sm font-medium text-primary">Drop files to upload</p>
          </div>
        </div>
      )}

      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Header */}
      {!embedded && (
        <div className="flex items-center gap-1.5 px-2 py-2 md:py-1.5 border-b border-border shrink-0">
          <EditorOpenControls
            path={path}
            machine={machine}
            defaultEditor={initialEditorType}
            onEditorChange={setActiveEditor}
            onLocalChange={setUseLocal}
          />
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:h-6 md:w-6"
            onClick={handleUploadClick}
            disabled={isUploading}
            title="Upload files"
          >
            <Upload className={cn("h-4 w-4 md:h-3 md:w-3", isUploading && "animate-pulse")} />
          </Button>
          <Button
            variant={showHiddenFiles ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 md:h-6 md:w-6"
            onClick={toggleHiddenFiles}
            title={showHiddenFiles ? "Hide hidden files" : "Show hidden files"}
          >
            {showHiddenFiles ? (
              <EyeOff className="h-4 w-4 md:h-3 md:w-3" />
            ) : (
              <Eye className="h-4 w-4 md:h-3 md:w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:h-6 md:w-6"
            onClick={refresh}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={cn("h-4 w-4 md:h-3 md:w-3", loading && "animate-spin")} />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 md:h-6 md:w-6"
              onClick={onClose}
              title="Close"
            >
              <X className="h-4 w-4 md:h-3 md:w-3" />
            </Button>
          )}
        </div>
      )}

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 px-2 py-2 md:py-1.5 text-xs md:text-[11px] overflow-x-auto border-b border-border bg-muted/40 shrink-0">
        <button
          onClick={handleGoHome}
          className="p-1 rounded hover:bg-accent text-foreground/60 hover:text-foreground shrink-0"
          title="Go to working directory"
        >
          <Home className="h-3.5 w-3.5 md:h-3 md:w-3" />
        </button>
        {path !== "/" && (
          <button
            onClick={handleGoUp}
            className="p-1 rounded hover:bg-accent text-foreground/60 hover:text-foreground shrink-0"
          >
            <ArrowUp className="h-3.5 w-3.5 md:h-3 md:w-3" />
          </button>
        )}
        <div className="flex items-center gap-0 overflow-x-auto min-w-0">
          {breadcrumbs.slice(-3).map((segment, index) => {
            const fullIndex = breadcrumbs.length - 3 + index
            const actualIndex = Math.max(0, fullIndex)
            return (
              <div key={`${actualIndex}-${segment}`} className="flex items-center shrink-0">
                {index > 0 && (
                  <ChevronRight className="h-3 w-3 md:h-2.5 md:w-2.5 text-foreground/40" />
                )}
                <button
                  onClick={() =>
                    handleNavigate("/" + breadcrumbs.slice(0, actualIndex + 1).join("/"))
                  }
                  className={cn(
                    "px-1.5 py-0.5 rounded hover:bg-accent truncate max-w-[100px] md:max-w-[80px]",
                    actualIndex === breadcrumbs.length - 1
                      ? "text-foreground font-medium"
                      : "text-foreground/60 hover:text-foreground"
                  )}
                >
                  {segment}
                </button>
              </div>
            )
          })}
        </div>

        {/* Embedded mode: extra controls in breadcrumb bar */}
        {embedded && (
          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 md:h-5 md:w-5"
              onClick={handleUploadClick}
              disabled={isUploading}
              title="Upload files"
            >
              <Upload className={cn("h-3.5 w-3.5 md:h-2.5 md:w-2.5", isUploading && "animate-pulse")} />
            </Button>
            <Button
              variant={showHiddenFiles ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7 md:h-5 md:w-5"
              onClick={toggleHiddenFiles}
              title={showHiddenFiles ? "Hide hidden files" : "Show hidden files"}
            >
              {showHiddenFiles ? (
                <EyeOff className="h-3.5 w-3.5 md:h-2.5 md:w-2.5" />
              ) : (
                <Eye className="h-3.5 w-3.5 md:h-2.5 md:w-2.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 md:h-5 md:w-5"
              onClick={refresh}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 md:h-2.5 md:w-2.5", loading && "animate-spin")} />
            </Button>
          </div>
        )}
      </div>

      {/* Preview panel — replaces file listing when active */}
      {previewPath && (
        <FilePreview
          machineId={machineId}
          filePath={previewPath}
          onClose={() => setPreviewPath(null)}
          className="flex-1 min-h-0"
        />
      )}

      {/* File listing — hidden when preview is active */}
      <div
        ref={listRef}
        className={cn("flex-1 overflow-y-auto", previewPath && "hidden")}
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
            <Button variant="outline" size="sm" onClick={refresh}>
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
            {/* Directories */}
            {directories.map((entry, index) => (
              <button
                key={entry.path}
                data-entry-index={index}
                onClick={() => handleEntryClick(entry)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                className={cn(
                  "w-full flex items-center gap-2.5 md:gap-2 px-3 py-2.5 md:py-1.5 text-left active:bg-accent",
                  selectedIndex === index && "bg-primary/10",
                  hoveredIndex === index && "bg-accent"
                )}
              >
                <Folder className="h-4 w-4 md:h-3.5 md:w-3.5 text-primary shrink-0" />
                <span className="text-sm md:text-xs truncate flex-1">{entry.name}</span>
              </button>
            ))}

            {/* Files */}
            {files.map((entry, index) => {
              const entryIndex = directories.length + index
              const isHovered = hoveredIndex === entryIndex
              const FileIcon = getFileIcon(entry.name)
              return (
                <div
                  key={entry.path}
                  role="button"
                  tabIndex={0}
                  data-entry-index={entryIndex}
                  onClick={() => handleEntryClick(entry)}
                  onMouseEnter={() => setHoveredIndex(entryIndex)}
                  onMouseLeave={() => {
                    if (menuOpenIndex !== entryIndex) setHoveredIndex(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      handleEntryClick(entry)
                    }
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 md:gap-2 px-3 py-2.5 md:py-1.5 text-left active:bg-accent cursor-pointer",
                    selectedIndex === entryIndex && "bg-primary/10",
                    isHovered && "bg-accent"
                  )}
                >
                  <FileIcon className="h-4 w-4 md:h-3.5 md:w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm md:text-xs truncate flex-1 text-muted-foreground">
                    {entry.name}
                  </span>
                  {/* Desktop: action buttons visible on hover */}
                  {isHovered && (
                    <div className="hidden md:flex items-center gap-0.5 shrink-0">
                      <button
                        className="p-0.5 rounded hover:bg-muted"
                        title="Preview"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPreviewPath(entry.path)
                        }}
                      >
                        <Eye className="h-3 w-3 text-muted-foreground" />
                      </button>
                      <button
                        className="p-0.5 rounded hover:bg-muted"
                        title="Download"
                        onClick={(e) => {
                          e.stopPropagation()
                          downloadFile(machineId, entry.path)
                        }}
                      >
                        <Download className="h-3 w-3 text-muted-foreground" />
                      </button>
                      <FileActionsMenu
                        filePath={entry.path}
                        machineId={machineId}
                        machine={machine}
                        useLocal={useLocal}
                        onPreview={setPreviewPath}
                        onOpenChange={(open) => {
                          setMenuOpenIndex(open ? entryIndex : null)
                          if (!open) setHoveredIndex(null)
                        }}
                      />
                    </div>
                  )}
                  {/* Mobile: always-visible three-dot menu */}
                  <div className="flex md:hidden shrink-0">
                    <FileActionsMenu
                      filePath={entry.path}
                      machineId={machineId}
                      machine={machine}
                      useLocal={useLocal}
                      onPreview={setPreviewPath}
                      onOpenChange={(open) => {
                        setMenuOpenIndex(open ? entryIndex : null)
                        if (!open) setHoveredIndex(null)
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Upload progress overlay */}
      <UploadManager
        uploads={uploads}
        overwritePending={overwritePending}
        validationErrors={validationErrors}
        onCancel={cancelUpload}
        onRetry={retryUpload}
        onDismiss={dismissUpload}
        onClearCompleted={clearCompleted}
        onConfirmOverwrite={confirmOverwrite}
        onRejectOverwrite={rejectOverwrite}
        onDismissValidationError={dismissValidationError}
      />
    </div>
  )
}
