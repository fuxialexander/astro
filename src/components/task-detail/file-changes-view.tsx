import { useState, useMemo, useEffect } from "react"
import { ChevronDown, ChevronRight, FilePlus, FileEdit, FileX, Plus, Minus, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { buildFileUrlSync } from "@/lib/path-utils"
import { useMachinesStore } from "@/stores/machines-store"
import { Badge } from "@/components/ui/badge"

interface FileChange {
  path: string
  action: string
  linesAdded?: number
  linesRemoved?: number
  diff?: string
  timestamp: Date
}

interface FileChangesViewProps {
  changes: FileChange[]
  machineId?: string
}

const actionConfig: Record<string, { icon: typeof FileEdit; color: string; label: string }> = {
  created: { icon: FilePlus, color: "text-green-500", label: "Created" },
  modified: { icon: FileEdit, color: "text-blue-500", label: "Modified" },
  deleted: { icon: FileX, color: "text-red-500", label: "Deleted" },
}

// Parse hunk header to extract line numbers: @@ -oldStart,oldCount +newStart,newCount @@
function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const match = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
  if (!match) return null
  return { oldStart: parseInt(match[1], 10), newStart: parseInt(match[2], 10) }
}

function DiffRenderer({ diff }: { diff: string }) {
  const lines = diff.split("\n")
  let oldLine = 0
  let newLine = 0

  return (
    <div className="border-t border-border bg-muted/30 overflow-auto max-h-[400px]">
      <table className="w-full font-mono text-xs leading-relaxed border-collapse">
        <tbody>
          {lines.map((line, i) => {
            const isHunk = line.startsWith("@@")
            const isAdd = line.startsWith("+") && !line.startsWith("+++")
            const isDel = line.startsWith("-") && !line.startsWith("---")
            const isHeader = line.startsWith("+++") || line.startsWith("---")

            if (isHunk) {
              const parsed = parseHunkHeader(line)
              if (parsed) {
                oldLine = parsed.oldStart
                newLine = parsed.newStart
              }
            }

            let oldNum = ""
            let newNum = ""
            if (!isHunk && !isHeader) {
              if (isAdd) {
                newNum = String(newLine++)
              } else if (isDel) {
                oldNum = String(oldLine++)
              } else {
                oldNum = String(oldLine++)
                newNum = String(newLine++)
              }
            }

            return (
              <tr
                key={i}
                className={cn(
                  isAdd && "bg-green-500/10",
                  isDel && "bg-red-500/10",
                  isHunk && "bg-blue-500/5",
                )}
              >
                <td className="w-10 pr-1 text-right text-muted-foreground/50 select-none align-top border-r border-border/50 px-1">
                  {oldNum}
                </td>
                <td className="w-10 pr-1 text-right text-muted-foreground/50 select-none align-top border-r border-border/50 px-1">
                  {newNum}
                </td>
                <td className={cn(
                  "pl-2 pr-4 whitespace-pre-wrap break-all",
                  isAdd && "text-green-700 dark:text-green-400",
                  isDel && "text-red-700 dark:text-red-400",
                  isHunk && "text-blue-500 font-semibold py-1",
                  isHeader && "text-muted-foreground",
                )}>
                  {line}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FileChangeItem({ change, machineId, useLocalUrls, useVSCode }: { change: FileChange; machineId?: string; useLocalUrls: boolean; useVSCode: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const config = actionConfig[change.action] || actionConfig.modified
  const Icon = config.icon

  const registeredMachines = useMachinesStore((s) => s.machines)
  const machine = machineId
    ? registeredMachines.find((m) => m.id === machineId || m.name === machineId)
    : undefined

  // Build file URL for editor integration
  const editorType = useVSCode ? 'vscode' : 'cursor'
  const forceLocal = useLocalUrls ? true : 'remote' as const
  const fileUrl = useMemo(
    () => buildFileUrlSync(change.path, undefined, machine, forceLocal, editorType),
    [change.path, machine, forceLocal, editorType]
  )

  // Extract filename from path
  const parts = change.path.split("/")
  const filename = parts.pop() || change.path
  const directory = parts.join("/")

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 w-full px-4 py-3 hover:bg-muted/50 transition-colors">
        <Icon className={cn("h-4 w-4 shrink-0", config.color)} />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium">{filename}</span>
            {directory && (
              <span className="text-xs text-muted-foreground truncate">{directory}/</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground font-mono truncate" title={change.path}>
            {change.path}
          </span>
          {fileUrl && (
            <span className="text-[10px] text-muted-foreground/70 font-mono truncate break-all" title={fileUrl}>
              {fileUrl}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {change.linesAdded != null && change.linesAdded > 0 && (
            <span className="flex items-center gap-0.5 text-xs font-mono text-green-600">
              <Plus className="h-3 w-3" />{change.linesAdded}
            </span>
          )}
          {change.linesRemoved != null && change.linesRemoved > 0 && (
            <span className="flex items-center gap-0.5 text-xs font-mono text-red-600">
              <Minus className="h-3 w-3" />{change.linesRemoved}
            </span>
          )}
          {fileUrl && (
            <a
              href={fileUrl}
              onClick={(e) => { e.stopPropagation(); window.open(fileUrl, '_self') }}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 hover:bg-primary/20 transition-colors h-6"
              title="Open in editor"
            >
              <ExternalLink className="h-3 w-3 text-primary" />
              <span className="text-[10px] font-medium text-primary">Open</span>
            </a>
          )}
          {change.diff && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="hover:bg-muted rounded p-1 transition-colors"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      </div>

      {expanded && change.diff && (
        <DiffRenderer diff={change.diff} />
      )}
    </div>
  )
}

export function FileChangesView({ changes, machineId }: FileChangesViewProps) {
  const [useLocalUrls, setUseLocalUrls] = useState(true)
  const [useVSCode, setUseVSCode] = useState(false)

  // Ensure machines are loaded for editor URL generation
  const machines = useMachinesStore((s) => s.machines)
  const fetchMachines = useMachinesStore((s) => s.fetchMachines)
  useEffect(() => {
    if (machines.length === 0) {
      fetchMachines()
    }
  }, [machines.length, fetchMachines])

  if (changes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No file changes recorded
      </div>
    )
  }

  // Summary
  const created = changes.filter((c) => c.action === "created").length
  const modified = changes.filter((c) => c.action === "modified").length
  const deleted = changes.filter((c) => c.action === "deleted").length
  const totalAdded = changes.reduce((sum, c) => sum + (c.linesAdded || 0), 0)
  const totalRemoved = changes.reduce((sum, c) => sum + (c.linesRemoved || 0), 0)

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Summary and Editor Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{changes.length} file{changes.length !== 1 ? "s" : ""} changed</span>
          {created > 0 && <span className="text-green-600">{created} created</span>}
          {modified > 0 && <span className="text-blue-600">{modified} modified</span>}
          {deleted > 0 && <span className="text-red-600">{deleted} deleted</span>}
          <span className="text-green-600 font-mono">+{totalAdded}</span>
          <span className="text-red-600 font-mono">-{totalRemoved}</span>
        </div>

        {/* Editor Controls */}
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-muted transition-colors text-[10px] h-6 px-2"
            onClick={() => setUseLocalUrls(!useLocalUrls)}
          >
            {useLocalUrls ? "Local" : "Remote"}
          </Badge>
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-muted transition-colors text-[10px] h-6 px-2"
            onClick={() => setUseVSCode(!useVSCode)}
          >
            {useVSCode ? "VSCode" : "Cursor"}
          </Badge>
        </div>
      </div>

      {/* File list */}
      <div className="flex flex-col gap-2">
        {changes.map((change, i) => (
          <FileChangeItem key={i} change={change} machineId={machineId} useLocalUrls={useLocalUrls} useVSCode={useVSCode} />
        ))}
      </div>
    </div>
  )
}
