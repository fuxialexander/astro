import { useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronRight, FileCode, FileMinus, FilePlus, FileText, Loader2, Minus, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiUrl } from "@/lib/api-url"
import { authHeaders } from "@/lib/auth-headers"
import { cn } from "@/lib/utils"
import { parsePatch } from "./diff-utils"
import type { PrChangedFile } from "@/types"

interface PrDiffViewerProps {
  projectId: string
  prNumber: number
  className?: string
}

function statusIcon(status: PrChangedFile["status"]) {
  switch (status) {
    case "added":
      return <FilePlus className="h-3.5 w-3.5 text-emerald-500" />
    case "removed":
      return <FileMinus className="h-3.5 w-3.5 text-red-500" />
    case "renamed":
    case "copied":
      return <FileText className="h-3.5 w-3.5 text-blue-400" />
    default:
      return <FileCode className="h-3.5 w-3.5 text-amber-400" />
  }
}

function statusLabel(status: PrChangedFile["status"]): string {
  switch (status) {
    case "added": return "A"
    case "removed": return "D"
    case "modified": return "M"
    case "renamed": return "R"
    case "copied": return "C"
    default: return "~"
  }
}

function statusColor(status: PrChangedFile["status"]): string {
  switch (status) {
    case "added": return "text-emerald-500"
    case "removed": return "text-red-500"
    case "renamed": return "text-blue-400"
    case "copied": return "text-blue-400"
    default: return "text-amber-400"
  }
}

// parsePatch and DiffLine are in ./diff-utils.ts

function DiffBlock({ patch }: { patch: string }) {
  const diffLines = parsePatch(patch)

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-[#0d1117] text-[12px] font-mono leading-[1.6]">
      <table className="w-full border-collapse">
        <tbody>
          {diffLines.map((line, i) => {
            if (line.type === "header") {
              return (
                <tr key={i} className="bg-blue-900/20">
                  <td colSpan={3} className="px-3 py-0.5 text-blue-300/70 select-none">
                    {line.content}
                  </td>
                </tr>
              )
            }

            const bgColor =
              line.type === "add"
                ? "bg-emerald-900/20"
                : line.type === "remove"
                  ? "bg-red-900/20"
                  : ""

            const textColor =
              line.type === "add"
                ? "text-emerald-300"
                : line.type === "remove"
                  ? "text-red-300"
                  : "text-zinc-400"

            const lineNumColor =
              line.type === "add"
                ? "text-emerald-600/60"
                : line.type === "remove"
                  ? "text-red-600/60"
                  : "text-zinc-600"

            return (
              <tr key={i} className={bgColor}>
                <td className={cn("w-[1px] whitespace-nowrap px-2 py-0 text-right select-none", lineNumColor)}>
                  {line.type !== "add" ? line.oldLineNum : ""}
                </td>
                <td className={cn("w-[1px] whitespace-nowrap px-2 py-0 text-right select-none border-r border-border/20", lineNumColor)}>
                  {line.type !== "remove" ? line.newLineNum : ""}
                </td>
                <td className={cn("px-3 py-0 whitespace-pre", textColor)}>
                  <span className={cn("select-none mr-1", line.type === "add" ? "text-emerald-500" : line.type === "remove" ? "text-red-500" : "text-transparent")}>
                    {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                  </span>
                  {line.content}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function PrDiffViewer({ projectId, prNumber, className }: PrDiffViewerProps) {
  const [files, setFiles] = useState<PrChangedFile[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const headers = await authHeaders()
      const response = await fetch(apiUrl(`/api/github/projects/${projectId}/pr/${prNumber}/files`), { headers })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Failed to load PR files" }))
        throw new Error(body.error || "Failed to load PR files")
      }
      const data = await response.json() as { files: PrChangedFile[] }
      setFiles(data.files)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load PR files")
    } finally {
      setLoading(false)
    }
  }, [projectId, prNumber])

  useEffect(() => {
    void load()
  }, [load])

  const toggleFile = useCallback((filename: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(filename)) {
        next.delete(filename)
      } else {
        next.add(filename)
      }
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    if (!files) return
    setExpandedFiles(new Set(files.filter((f) => f.patch).map((f) => f.filename)))
  }, [files])

  const collapseAll = useCallback(() => {
    setExpandedFiles(new Set())
  }, [])

  if (loading && !files) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground p-4", className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading file changes...
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn("text-sm text-destructive/80 p-4", className)}>{error}</div>
    )
  }

  if (!files || files.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground p-4", className)}>No file changes found.</div>
    )
  }

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)
  const filesWithPatch = files.filter((f) => f.patch)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{files.length} file{files.length !== 1 ? "s" : ""} changed</span>
          <span className="flex items-center gap-1 text-emerald-500 font-mono">
            <Plus className="h-3 w-3" />{totalAdditions}
          </span>
          <span className="flex items-center gap-1 text-red-500 font-mono">
            <Minus className="h-3 w-3" />{totalDeletions}
          </span>
        </div>
        {filesWithPatch.length > 0 && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={expandAll} className="h-6 px-2 text-[11px]">
              Expand all
            </Button>
            <Button variant="ghost" size="sm" onClick={collapseAll} className="h-6 px-2 text-[11px]">
              Collapse all
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {files.map((file) => {
          const expanded = expandedFiles.has(file.filename)
          const hasPatch = !!file.patch

          return (
            <div key={file.filename} className="rounded-xl border border-border/60 bg-card/70 overflow-hidden">
              <button
                onClick={() => hasPatch && toggleFile(file.filename)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs",
                  hasPatch && "cursor-pointer hover:bg-muted/30 transition-colors",
                )}
                disabled={!hasPatch}
              >
                {hasPatch ? (
                  expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                  )
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                {statusIcon(file.status)}
                <span className="truncate font-mono text-foreground">{file.filename}</span>
                {file.previousFilename && (
                  <span className="text-muted-foreground/60 truncate">
                    (was {file.previousFilename})
                  </span>
                )}
                <span className={cn("ml-auto shrink-0 font-mono font-semibold text-[10px]", statusColor(file.status))}>
                  {statusLabel(file.status)}
                </span>
                <Badge variant="outline" className="ml-1 shrink-0 text-[10px] font-mono gap-1">
                  <span className="text-emerald-500">+{file.additions}</span>
                  <span className="text-red-500">-{file.deletions}</span>
                </Badge>
              </button>

              {expanded && file.patch && (
                <div className="border-t border-border/40">
                  <DiffBlock patch={file.patch} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
