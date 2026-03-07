/**
 * MarkdownViewer — Renders markdown files using the existing MarkdownRenderer
 */

import { Loader2, AlertCircle } from "lucide-react"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { useAuthenticatedContent } from "./use-authenticated-content"
import { cn } from "@/lib/utils"

interface MarkdownViewerProps {
  machineId: string
  filePath: string
  className?: string
}

export function MarkdownViewer({ machineId, filePath, className }: MarkdownViewerProps) {
  const { text: content, loading, error } = useAuthenticatedContent(machineId, filePath, "text")

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
