/**
 * CodeViewer — Renders code files with syntax highlighting
 *
 * Uses the existing rehype-highlight infrastructure (via MarkdownRenderer)
 * wrapped in a code block. Fetches file content from the API and renders
 * with proper language detection.
 */

import { useState, useEffect, useMemo } from "react"
import { Loader2, AlertCircle } from "lucide-react"
import { getLanguageFromExtension } from "../file-type-utils"
import { cn } from "@/lib/utils"
import { apiUrl } from "@/lib/api-url"

interface CodeViewerProps {
  machineId: string
  filePath: string
  className?: string
}

export function CodeViewer({ machineId, filePath, className }: CodeViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const language = useMemo(() => getLanguageFromExtension(filePath), [filePath])
  const filename = filePath.split("/").pop() ?? "file"

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
    <div className={cn("h-full w-full overflow-auto", className)}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border text-[11px] text-muted-foreground sticky top-0">
        <span className="font-mono truncate">{filename}</span>
        <span className="shrink-0 ml-2">{language}</span>
      </div>
      <pre className="p-3 text-xs font-mono overflow-x-auto">
        <code className={`language-${language}`}>
          {content}
        </code>
      </pre>
    </div>
  )
}
