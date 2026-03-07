/**
 * PdfViewer — Renders PDFs fetched with auth headers via blob URL
 */

import { FileText, Loader2, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuthenticatedContent } from "./use-authenticated-content"
import { downloadFile } from "../download-utils"
import { cn } from "@/lib/utils"

interface PdfViewerProps {
  machineId: string
  filePath: string
  className?: string
}

export function PdfViewer({ machineId, filePath, className }: PdfViewerProps) {
  const { blobUrl, loading, error } = useAuthenticatedContent(machineId, filePath, "blob")

  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full gap-3 p-4", className)}>
        <FileText className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Unable to preview PDF</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadFile(machineId, filePath).catch(() => {})}
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download instead
        </Button>
      </div>
    )
  }

  return (
    <div className={cn("relative h-full w-full", className)}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {blobUrl && (
        <embed
          src={blobUrl}
          type="application/pdf"
          className="h-full w-full"
        />
      )}
    </div>
  )
}
