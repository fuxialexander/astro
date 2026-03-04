/**
 * MarkdownViewer — Renders markdown files using the existing MarkdownRenderer
 */

import { useState, useEffect } from "react"
import { Loader2, AlertCircle } from "lucide-react"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { cn } from "@/lib/utils"
import { apiUrl } from "@/lib/api-url"

interface MarkdownViewerProps {
  machineId: string
  filePath: string
  className?: string
}

export function MarkdownViewer({ machineId, filePath, className }: MarkdownViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchContent() {
      setLoading(true)
      setError(null)
      setContent(null)

      try {
        const params = new URLSearchParams({ machineId, path: filePath })
        const response = await fetch(apiUrl(`/api/fs/content?${params.toString()}`))

        if (!response.ok) {
          throw new Error(`Failed to load file (${response.status})`)
        }

        const text = await response.text()
        if (!cancelled) {
          setContent(text)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load file")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchContent()
    return () => { cancelled = true }
  }, [machineId, filePath])

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full gap-2", className)}>
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-xs text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className={cn("h-full w-full overflow-auto p-4", className)}>
      <MarkdownRenderer content={content ?? ""} className="text-sm" />
    </div>
  )
}
