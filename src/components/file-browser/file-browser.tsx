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

import { useState, useCallback, useRef } from "react"
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
import { useToastStore } from "@/stores/toast-store"
import { useFileBrowser, type DirectoryEntry } from "./use-file-browser"
import { FileActionsMenu } from "./file-actions-menu"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FileBrowserProps {
  machineId: string
  machineName?: string
  machineHostname?: string
  workingDirectory: string
  editorType?: EditorType
  onClose?: () => void
  /** When true, renders without fixed width/border (for Sheet embedding) */
  embedded?: boolean
  /** Callback when a file is selected (e.g., from FileChangeBlock linking) */
  onFileSelect?: (path: string) => void
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
  editorType: initialEditorType = "cursor",
  onClose,
  embedded = false,
  onFileSelect,
}: FileBrowserProps) {
  const [activeEditor, setActiveEditor] = useState<EditorType>(initialEditorType)
  const [useLocal, setUseLocal] = useState(true)
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addToast = useToastStore((s) => s.add)

  const machine = { name: machineName, hostname: machineHostname }

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
    uploadFile,
    handleKeyDown: hookKeyDown,
    breadcrumbs,
    entries,
  } = useFileBrowser({ machineId, workingDirectory })

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
    // Default: open in editor
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

  const handleEntryClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      navigateTo(entry.path)
    } else {
      handleFileClick(entry)
    }
  }

  // -----------------------------------------------------------------------
  // Upload handlers
  // -----------------------------------------------------------------------

  const handleUploadFiles = async (fileList: FileList) => {
    if (fileList.length === 0) return

    setUploading(true)
    let successCount = 0
    let errorCount = 0

    for (const file of Array.from(fileList)) {
      const result = await uploadFile(file)
      if (result.success) {
        successCount++
      } else {
        errorCount++
        addToast({
          type: "error",
          title: `Failed to upload ${file.name}`,
          description: result.error,
        })
      }
    }

    setUploading(false)

    if (successCount > 0) {
      addToast({
        type: "success",
        title: `Uploaded ${successCount} file${successCount > 1 ? "s" : ""}`,
      })
    }
    if (errorCount > 0 && successCount > 0) {
      addToast({
        type: "warning",
        title: `${errorCount} file${errorCount > 1 ? "s" : ""} failed to upload`,
      })
    }
  }

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
        embedded ? "w-full" : "w-[280px] border-l border-border"
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
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
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border shrink-0">
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
            className="h-6 w-6"
            onClick={toggleHiddenFiles}
            title={showHiddenFiles ? "Hide hidden files" : "Show hidden files"}
          >
            {showHiddenFiles ? (
              <EyeOff className="h-3 w-3" />
            ) : (
              <Eye className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleUploadClick}
            disabled={uploading}
            title="Upload files"
          >
            <Upload className={cn("h-3 w-3", uploading && "animate-pulse")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={refresh}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClose}
              title="Close"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {/* Breadcrumbs */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 text-[11px] overflow-x-auto border-b border-border shrink-0">
        <button
          onClick={goHome}
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
                {index > 0 && (
                  <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                )}
                <button
                  onClick={() =>
                    navigateTo("/" + breadcrumbs.slice(0, actualIndex + 1).join("/"))
                  }
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

        {/* Embedded mode: extra controls in breadcrumb bar */}
        {embedded && (
          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={toggleHiddenFiles}
              title={showHiddenFiles ? "Hide hidden files" : "Show hidden files"}
            >
              {showHiddenFiles ? (
                <EyeOff className="h-2.5 w-2.5" />
              ) : (
                <Eye className="h-2.5 w-2.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handleUploadClick}
              disabled={uploading}
              title="Upload files"
            >
              <Upload className={cn("h-2.5 w-2.5", uploading && "animate-pulse")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={refresh}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={cn("h-2.5 w-2.5", loading && "animate-spin")} />
            </Button>
          </div>
        )}
      </div>

      {/* Preview indicator */}
      {previewPath && (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border text-[11px] shrink-0">
          <Eye className="h-3 w-3 text-muted-foreground" />
          <span className="truncate text-muted-foreground">
            {previewPath.split("/").pop()}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 ml-auto"
            onClick={() => setPreviewPath(null)}
          >
            <X className="h-2.5 w-2.5" />
          </Button>
        </div>
      )}

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
                className={cn(
                  "group w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors",
                  selectedIndex === index && "bg-primary/10"
                )}
              >
                <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-xs truncate flex-1">{entry.name}</span>
              </button>
            ))}

            {/* Files */}
            {files.map((entry, index) => {
              const entryIndex = directories.length + index
              const FileIcon = getFileIcon(entry.name)
              return (
                <button
                  key={entry.path}
                  data-entry-index={entryIndex}
                  onClick={() => handleEntryClick(entry)}
                  className={cn(
                    "group w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors",
                    selectedIndex === entryIndex && "bg-primary/10"
                  )}
                >
                  <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs truncate flex-1 text-muted-foreground">
                    {entry.name}
                  </span>
                  <FileActionsMenu
                    filePath={entry.path}
                    machineId={machineId}
                    machine={machine}
                    useLocal={useLocal}
                    onPreview={setPreviewPath}
                  />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Upload progress overlay */}
      {uploading && (
        <div className="absolute bottom-0 left-0 right-0 bg-background/80 border-t border-border px-3 py-2 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">Uploading...</span>
        </div>
      )}
    </div>
  )
}
