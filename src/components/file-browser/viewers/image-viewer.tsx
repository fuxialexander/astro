/**
 * ImageViewer — Renders images via the content API endpoint
 */

import { useState } from "react"
import { ImageOff, Loader2 } from "lucide-react"
import { buildContentUrl } from "../file-type-utils"
import { cn } from "@/lib/utils"

interface ImageViewerProps {
  machineId: string
  filePath: string
  className?: string
}

export function ImageViewer({ machineId, filePath, className }: ImageViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const src = buildContentUrl(machineId, filePath)
  const filename = filePath.split("/").pop() ?? "image"

  return (
    <div className={cn("flex items-center justify-center h-full w-full p-4", className)}>
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {error ? (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <ImageOff className="h-8 w-8" />
          <p className="text-xs">Failed to load image</p>
        </div>
      ) : (
        <img
          src={src}
          alt={filename}
          className={cn(
            "max-w-full max-h-full object-contain rounded",
            loading && "opacity-0"
          )}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false)
            setError(true)
          }}
        />
      )}
    </div>
  )
}
