/**
 * FileActionsMenu — Context menu for per-file actions
 *
 * Actions: Preview, Download, Open in Cursor, Open in VSCode, Copy Path
 */

import { useState } from "react"
import {
  Eye,
  Download,
  ExternalLink,
  Copy,
  MoreHorizontal,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { buildFileUrlSync } from "@/lib/path-utils"
import { useToastStore } from "@/stores/toast-store"
import { downloadFile } from "./download-utils"

interface FileActionsMenuProps {
  /** Absolute file path */
  filePath: string
  /** Machine ID for API calls */
  machineId: string
  /** Machine info for editor URLs */
  machine?: { name?: string; hostname?: string }
  /** Whether the user toggled local mode */
  useLocal?: boolean
  /** Callback to preview the file */
  onPreview?: (path: string) => void
  /** Triggered via right-click context */
  triggerType?: "button" | "context"
  /** Prevent row click when menu opens */
  onOpenChange?: (open: boolean) => void
}

export function FileActionsMenu({
  filePath,
  machineId,
  machine,
  useLocal = true,
  onPreview,
  triggerType = "button",
  onOpenChange,
}: FileActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const addToast = useToastStore((s) => s.add)

  const forceLocal = useLocal ? true : ("remote" as const)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  const handlePreview = () => {
    onPreview?.(filePath)
    setOpen(false)
  }

  const handleDownload = async () => {
    try {
      await downloadFile(machineId, filePath)
    } catch {
      addToast({ type: "error", title: "Download failed" })
    }
    setOpen(false)
  }

  const handleOpenInEditor = (editor: "cursor" | "vscode") => {
    const url = buildFileUrlSync(
      filePath,
      undefined,
      machine as Parameters<typeof buildFileUrlSync>[2],
      forceLocal,
      editor
    )
    if (url) {
      window.open(url, "_blank")
    }
    setOpen(false)
  }

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(filePath)
      addToast({ type: "success", title: "Path copied to clipboard" })
    } catch {
      addToast({ type: "error", title: "Failed to copy path" })
    }
    setOpen(false)
  }

  const handleCopyEditorLink = async (editor: "cursor" | "vscode") => {
    const url = buildFileUrlSync(
      filePath,
      undefined,
      machine as Parameters<typeof buildFileUrlSync>[2],
      forceLocal,
      editor
    )
    if (url) {
      try {
        await navigator.clipboard.writeText(url)
        addToast({
          type: "success",
          title: `${editor === "cursor" ? "Cursor" : "VSCode"} link copied`,
        })
      } catch {
        addToast({ type: "error", title: "Failed to copy link" })
      }
    }
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        {triggerType === "button" ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        ) : (
          <span className="sr-only">File actions</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {onPreview && (
          <DropdownMenuItem onClick={handlePreview}>
            <Eye className="h-3.5 w-3.5 mr-2" />
            <span className="text-xs">Preview</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleDownload}>
          <Download className="h-3.5 w-3.5 mr-2" />
          <span className="text-xs">Download</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
          Open in editor
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => handleOpenInEditor("cursor")}>
          <ExternalLink className="h-3.5 w-3.5 mr-2" />
          <span className="text-xs">Cursor</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleOpenInEditor("vscode")}>
          <ExternalLink className="h-3.5 w-3.5 mr-2" />
          <span className="text-xs">VSCode</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
          Copy
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={handleCopyPath}>
          <Copy className="h-3.5 w-3.5 mr-2" />
          <span className="text-xs">Copy path</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleCopyEditorLink("cursor")}>
          <Copy className="h-3.5 w-3.5 mr-2" />
          <span className="text-xs">Copy Cursor link</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleCopyEditorLink("vscode")}>
          <Copy className="h-3.5 w-3.5 mr-2" />
          <span className="text-xs">Copy VSCode link</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
