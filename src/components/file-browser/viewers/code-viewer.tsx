/**
 * CodeViewer — Renders code files with syntax highlighting
 */

import { useMemo } from "react"
import { Loader2, AlertCircle } from "lucide-react"
import { getLanguageFromExtension } from "../file-type-utils"
import { useAuthenticatedContent } from "./use-authenticated-content"
import { cn } from "@/lib/utils"

interface CodeViewerProps {
  machineId: string
  filePath: string
  className?: string
}

export function CodeViewer({ machineId, filePath, className }: CodeViewerProps) {
  const { text: content, loading, error } = useAuthenticatedContent(machineId, filePath, "text")
  const language = useMemo(() => getLanguageFromExtension(filePath), [filePath])
  const filename = filePath.split("/").pop() ?? "file"

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
