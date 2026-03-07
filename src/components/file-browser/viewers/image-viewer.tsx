/**
 * ImageViewer — Renders images fetched with auth headers via blob URL
 */

import { ImageOff, Loader2 } from "lucide-react"
import { useAuthenticatedContent } from "./use-authenticated-content"
import { cn } from "@/lib/utils"

interface ImageViewerProps {
  machineId: string
  filePath: string
  className?: string
}

export function ImageViewer({ machineId, filePath, className }: ImageViewerProps) {
  const { blobUrl, loading, error } = useAuthenticatedContent(machineId, filePath, "blob")
  const filename = filePath.split("/").pop() ?? "image"

  return (
    <div className={cn("flex items-center justify-center h-full w-full p-4", className)}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {error ? (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <ImageOff className="h-8 w-8" />
          <p className="text-xs">Failed to load image</p>
        </div>
      ) : blobUrl ? (
        <img
          src={blobUrl}
          alt={filename}
          className="max-w-full max-h-full object-contain rounded"
        />
      ) : null}
    </div>
  )
}
