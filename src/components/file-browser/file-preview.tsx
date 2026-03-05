/**
 * FilePreview — Expandable preview panel that renders file content based on type.
 *
 * Supports two modes:
 * - Sidebar: renders as a split pane alongside the file list (via ResizablePanel)
 * - Expanded: renders as a full-size dialog/drawer for detailed inspection
 *
 * Delegates to type-specific viewers:
 * - ImageViewer for .png, .jpg, .gif, .webp, .svg
 * - PdfViewer for .pdf
 * - CodeViewer for code/text files (.py, .ts, .json, .yaml, etc.)
 * - MarkdownViewer for .md files
 * - DownloadCard as fallback for unsupported types
 */

import { useState, useCallback } from "react"
import { X, Maximize2, Minimize2, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getFileCategory, type FileCategory } from "./file-type-utils"
import { downloadFile } from "./download-utils"
import { ImageViewer } from "./viewers/image-viewer"
import { PdfViewer } from "./viewers/pdf-viewer"
import { CodeViewer } from "./viewers/code-viewer"
import { MarkdownViewer } from "./viewers/markdown-viewer"
import { DownloadCard } from "./viewers/download-card"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FilePreviewProps {
  /** Machine ID for API calls */
  machineId: string
  /** Full path of the file to preview */
  filePath: string
  /** Close the preview panel */
  onClose: () => void
  /** Optional className for the container */
  className?: string
}

// ---------------------------------------------------------------------------
// Viewer dispatcher
// ---------------------------------------------------------------------------

function FileViewerContent({
  machineId,
  filePath,
  category,
}: {
  machineId: string
  filePath: string
  category: FileCategory
}) {
  switch (category) {
    case "image":
      return <ImageViewer machineId={machineId} filePath={filePath} />
    case "pdf":
      return <PdfViewer machineId={machineId} filePath={filePath} />
    case "code":
      return <CodeViewer machineId={machineId} filePath={filePath} />
    case "markdown":
      return <MarkdownViewer machineId={machineId} filePath={filePath} />
    case "download-only":
      return <DownloadCard machineId={machineId} filePath={filePath} />
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilePreview({
  machineId,
  filePath,
  onClose,
  className,
}: FilePreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const filename = filePath.split("/").pop() ?? "file"
  const category = getFileCategory(filename)

  const handleDownload = useCallback(() => {
    downloadFile(machineId, filePath).catch(() => {
      // Download error handled silently — browser will show failure
    })
  }, [machineId, filePath])

  // -----------------------------------------------------------------------
  // Expanded (full-screen overlay) mode
  // -----------------------------------------------------------------------

  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
        <div className="w-[90vw] h-[85vh] bg-background border border-border rounded-lg shadow-xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
            <span className="text-xs font-medium truncate flex-1" title={filePath}>
              {filename}
            </span>
            <span className="text-[10px] text-muted-foreground uppercase">{category}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleDownload}
              title="Download"
            >
              <Download className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setExpanded(false)}
              title="Collapse"
            >
              <Minimize2 className="h-3 w-3" />
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
          {/* Content */}
          <div className="flex-1 overflow-hidden">
            <FileViewerContent machineId={machineId} filePath={filePath} category={category} />
          </div>
        </div>
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Sidebar (split pane) mode
  // -----------------------------------------------------------------------

  return (
    <div className={cn("flex flex-col h-full bg-background overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
        <span className="text-[11px] font-medium truncate flex-1" title={filePath}>
          {filename}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={handleDownload}
          title="Download"
        >
          <Download className="h-2.5 w-2.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => setExpanded(true)}
          title="Expand"
        >
          <Maximize2 className="h-2.5 w-2.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={onClose}
          title="Close preview"
        >
          <X className="h-2.5 w-2.5" />
        </Button>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <FileViewerContent machineId={machineId} filePath={filePath} category={category} />
      </div>
    </div>
  )
}
