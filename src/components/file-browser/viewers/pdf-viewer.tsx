/**
 * PdfViewer — Renders PDFs using native browser embed
 *
 * Falls back to a download card if the browser doesn't support embedded PDFs.
 */

import { useState } from "react"
import { FileText, Loader2 } from "lucide-react"
import { buildContentUrl } from "../file-type-utils"
import { cn } from "@/lib/utils"

interface PdfViewerProps {
  machineId: string
  filePath: string
  className?: string
}

export function PdfViewer({ machineId, filePath, className }: PdfViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const src = buildContentUrl(machineId, filePath)
  const filename = filePath.split("/").pop() ?? "document.pdf"

  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full gap-3 p-4", className)}>
        <FileText className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Unable to preview PDF</p>
        <a
          href={buildContentUrl(machineId, filePath, true)}
          download={filename}
          className="text-xs text-primary hover:underline"
        >
          Download instead
        </a>
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
      <embed
        src={src}
        type="application/pdf"
        className="h-full w-full"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false)
          setError(true)
        }}
      />
    </div>
  )
}
