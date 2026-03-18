import { useState, useRef, useEffect } from "react"
import { useDraggable } from "@dnd-kit/core"
import {
  Calendar,
  Circle,
  Folder,
  GitPullRequest,
  GitPullRequestCreateArrow,
  GitPullRequestDraft,
} from "lucide-react"
import { PRIORITY_CONFIG, PRIORITY_OPTIONS, ESTIMATE_OPTIONS, STATUS_OPTIONS } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { formatShortDate, isOverdue } from "@/lib/date-utils"
import { PropertyPicker } from "@/components/property-picker"
import type { PlanNode, Priority, Estimate } from "@/types"

/* ── Board card ── */
interface BoardCardProps {
  node: PlanNode
  visibleProperties: string[]
  projectName?: string
  onNodeSelect?: (node: PlanNode) => void
  onNodeUpdate?: (id: string, updates: Partial<PlanNode>) => void
  fastEdit?: boolean
}

export function BoardCard({ node, visibleProperties, projectName, onNodeSelect, onNodeUpdate, fastEdit }: BoardCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: node.id })
  const [editingTitle, setEditingTitle] = useState(false)
  const [editValue, setEditValue] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingTitle) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingTitle])

  const priorityConfig = PRIORITY_CONFIG[(node.priority ?? "none") as Priority]
  const PIcon = priorityConfig.icon
  const editable = !!onNodeUpdate

  const statusOpt = STATUS_OPTIONS.find((s) => s.id === node.status)
  const StatusIcon = statusOpt?.icon ?? Circle

  return (
    <div
      ref={setNodeRef}
      data-card-id={node.id}
      {...attributes}
      {...(fastEdit ? {} : listeners)}
      onClick={(e) => {
        e.stopPropagation()
        if (fastEdit) {
          setEditValue(node.title)
          setEditingTitle(true)
        } else {
          onNodeSelect?.(node)
        }
      }}
      className={cn(
        "rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm transition-shadow",
        fastEdit ? "cursor-text" : "cursor-grab active:cursor-grabbing",
        "hover:shadow-md select-none",
        isDragging && "opacity-0"
      )}
    >
      <div>
        {editingTitle ? (
          <input
            ref={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                const t = editValue.trim()
                if (t && t !== node.title) onNodeUpdate?.(node.id, { title: t })
                setEditingTitle(false)
              } else if (e.key === "Escape") {
                e.preventDefault()
                setEditingTitle(false)
              }
            }}
            onBlur={() => {
              const t = editValue.trim()
              if (t && t !== node.title) onNodeUpdate?.(node.id, { title: t })
              setEditingTitle(false)
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-sm font-medium outline-none"
          />
        ) : (
          <p className={cn(
            "text-sm font-medium truncate",
            node.status === "pruned" && "line-through opacity-50"
          )}>
            {node.title}
          </p>
        )}

        {/* Property row */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {visibleProperties.includes("status") && (
            <PropertyPicker
              value={node.status}
              options={STATUS_OPTIONS}
              title="Set status"
              disabled={!editable}
              onSelect={(id) => onNodeUpdate?.(node.id, { status: id as PlanNode["status"] })}
            >
              <StatusIcon className={cn("h-3.5 w-3.5", statusOpt?.iconColor)} />
            </PropertyPicker>
          )}

          {visibleProperties.includes("priority") && (
            <PropertyPicker
              value={node.priority ?? "none"}
              options={PRIORITY_OPTIONS}
              title="Set priority"
              disabled={!editable}
              onSelect={(id) => onNodeUpdate?.(node.id, { priority: id as Priority })}
            >
              <PIcon className={cn("h-3.5 w-3.5", priorityConfig.color)} />
            </PropertyPicker>
          )}

          {visibleProperties.includes("estimate") && (
            <PropertyPicker
              value={node.estimate}
              options={ESTIMATE_OPTIONS}
              title="Set estimate"
              disabled={!editable}
              onSelect={(id) => onNodeUpdate?.(node.id, { estimate: id as Estimate })}
            >
              <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {node.estimate ?? "—"}
              </span>
            </PropertyPicker>
          )}

          {visibleProperties.includes("dueDate") && node.dueDate && (
            <span className={cn(
              "inline-flex items-center gap-1 text-[11px]",
              isOverdue(node.dueDate, node.status) ? "text-error" : "text-muted-foreground"
            )}>
              <Calendar className="h-3 w-3" />
              {formatShortDate(node.dueDate)}
            </span>
          )}

          {visibleProperties.includes("project") && projectName && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Folder className="h-3 w-3" />
              <span className="truncate max-w-[100px]">{projectName}</span>
            </span>
          )}

          {visibleProperties.includes("pr") && node.prUrl && (
            <a
              href={node.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors"
              title={node.branchName ?? `PR #${node.prNumber}`}
            >
              {node.status === "completed" || node.status === "auto_verified" ? (
                <GitPullRequest className="h-3.5 w-3.5" />
              ) : (
                <GitPullRequestDraft className="h-3.5 w-3.5" />
              )}
              {node.prNumber != null && <span>#{node.prNumber}</span>}
            </a>
          )}

          {/* Auto-PR indicator - shows when autoPr is enabled but no PR exists yet */}
          {visibleProperties.includes("pr") && node.autoPr && !node.prUrl && (
            <span className="inline-flex items-center gap-1 text-[11px] text-info" title="Auto-PR enabled">
              <GitPullRequestCreateArrow className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
