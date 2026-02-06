import { useState } from "react"
import { ChevronDown, ChevronRight, FilePlus, FileEdit, FileX, Plus, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

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
}

const actionConfig: Record<string, { icon: typeof FileEdit; color: string; label: string }> = {
  created: { icon: FilePlus, color: "text-green-500", label: "Created" },
  modified: { icon: FileEdit, color: "text-blue-500", label: "Modified" },
  deleted: { icon: FileX, color: "text-red-500", label: "Deleted" },
}

function FileChangeItem({ change }: { change: FileChange }) {
  const [expanded, setExpanded] = useState(false)
  const config = actionConfig[change.action] || actionConfig.modified
  const Icon = config.icon

  // Extract filename from path
  const parts = change.path.split("/")
  const filename = parts.pop() || change.path
  const directory = parts.join("/")

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <Icon className={cn("h-4 w-4 shrink-0", config.color)} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{filename}</span>
          {directory && (
            <span className="text-xs text-muted-foreground ml-1.5">{directory}/</span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
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
          {change.diff && (
            expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )
          )}
        </div>
      </button>

      {expanded && change.diff && (
        <div className="border-t border-border bg-muted/30 p-4 overflow-auto max-h-[300px]">
          <pre className="font-mono text-xs leading-relaxed">
            {change.diff.split("\n").map((line, i) => (
              <div
                key={i}
                className={cn(
                  "px-2 -mx-2",
                  line.startsWith("+") && !line.startsWith("+++") && "bg-green-500/10 text-green-700",
                  line.startsWith("-") && !line.startsWith("---") && "bg-red-500/10 text-red-700",
                  line.startsWith("@@") && "text-blue-500"
                )}
              >
                {line}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}

export function FileChangesView({ changes }: FileChangesViewProps) {
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
      {/* Summary */}
      <div className="flex items-center gap-4 mb-4 text-sm text-muted-foreground">
        <span>{changes.length} file{changes.length !== 1 ? "s" : ""} changed</span>
        {created > 0 && <span className="text-green-600">{created} created</span>}
        {modified > 0 && <span className="text-blue-600">{modified} modified</span>}
        {deleted > 0 && <span className="text-red-600">{deleted} deleted</span>}
        <span className="text-green-600 font-mono">+{totalAdded}</span>
        <span className="text-red-600 font-mono">-{totalRemoved}</span>
      </div>

      {/* File list */}
      <div className="flex flex-col gap-2">
        {changes.map((change, i) => (
          <FileChangeItem key={i} change={change} />
        ))}
      </div>
    </div>
  )
}
