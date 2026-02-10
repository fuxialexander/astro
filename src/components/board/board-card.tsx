import { useState } from "react"
import { useDraggable } from "@dnd-kit/core"
import {
  Calendar,
  Check,
  Circle,
  CheckCircle2,
  Eye,
  Folder,
  Loader,
  Scissors,
  Send,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { PRIORITY_CONFIG, ESTIMATES } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { formatShortDate, isOverdue } from "@/lib/view-utils"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import type { PlanNode, Priority, Estimate } from "@/types"

/* ── Picker option ── */
interface PickerOption {
  id: string
  label: string
  icon?: LucideIcon
  iconColor?: string
  shortcut?: string
}

/* ── Priority options (Linear-style: no priority first) ── */
const PRIORITY_OPTIONS: PickerOption[] = [
  { id: "none", label: "No priority", icon: PRIORITY_CONFIG.none.icon, iconColor: PRIORITY_CONFIG.none.color, shortcut: "0" },
  { id: "urgent", label: "Urgent", icon: PRIORITY_CONFIG.urgent.icon, iconColor: PRIORITY_CONFIG.urgent.color, shortcut: "1" },
  { id: "high", label: "High", icon: PRIORITY_CONFIG.high.icon, iconColor: PRIORITY_CONFIG.high.color, shortcut: "2" },
  { id: "medium", label: "Medium", icon: PRIORITY_CONFIG.medium.icon, iconColor: PRIORITY_CONFIG.medium.color, shortcut: "3" },
  { id: "low", label: "Low", icon: PRIORITY_CONFIG.low.icon, iconColor: PRIORITY_CONFIG.low.color, shortcut: "4" },
]

/* ── Estimate options ── */
const ESTIMATE_OPTIONS: PickerOption[] = ESTIMATES.map((e) => ({ id: e, label: e }))

/* ── Status options ── */
const STATUS_OPTIONS: PickerOption[] = [
  { id: "planned", label: "Planned", icon: Circle, iconColor: "text-muted-foreground" },
  { id: "dispatched", label: "Dispatched", icon: Send, iconColor: "text-blue-500" },
  { id: "in_progress", label: "In Progress", icon: Loader, iconColor: "text-blue-500" },
  { id: "auto_verified", label: "Auto Verified", icon: CheckCircle2, iconColor: "text-green-500" },
  { id: "awaiting_judgment", label: "Needs Review", icon: Eye, iconColor: "text-amber-500" },
  { id: "completed", label: "Completed", icon: CheckCircle2, iconColor: "text-green-500" },
  { id: "pruned", label: "Pruned", icon: Scissors, iconColor: "text-muted-foreground" },
]

/* ── Property picker popover ── */
function PropertyPicker({
  value,
  options,
  title,
  disabled,
  onSelect,
  children,
}: {
  value: string | undefined
  options: PickerOption[]
  title: string
  disabled?: boolean
  onSelect: (id: string) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  if (disabled) return <span className="inline-flex items-center">{children}</span>

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-sm p-0.5 -m-0.5 hover:bg-muted transition-colors cursor-pointer"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-48 p-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{title}</p>
        {options.map((opt) => {
          const Icon = opt.icon
          const selected = value === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer",
                "hover:bg-accent transition-colors",
                selected && "bg-accent/50"
              )}
              onClick={() => { onSelect(opt.id); setOpen(false) }}
            >
              {Icon && <Icon className={cn("h-4 w-4 shrink-0", opt.iconColor)} />}
              <span className="flex-1 text-left">{opt.label}</span>
              {selected && <Check className="h-3.5 w-3.5 text-foreground" />}
              {opt.shortcut && <kbd className="text-[10px] text-muted-foreground">{opt.shortcut}</kbd>}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

/* ── Board card ── */
interface BoardCardProps {
  node: PlanNode
  visibleProperties: string[]
  projectName?: string
  onNodeSelect?: (node: PlanNode) => void
  onNodeUpdate?: (id: string, updates: Partial<PlanNode>) => void
}

export function BoardCard({ node, visibleProperties, projectName, onNodeSelect, onNodeUpdate }: BoardCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: node.id })

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
      {...listeners}
      onClick={(e) => {
        e.stopPropagation()
        onNodeSelect?.(node)
      }}
      className={cn(
        "rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm cursor-grab active:cursor-grabbing transition-shadow",
        "hover:shadow-md",
        isDragging && "opacity-0"
      )}
    >
      <div>
        <p className={cn(
          "text-sm font-medium truncate",
          node.status === "pruned" && "line-through opacity-50"
        )}>
          {node.title}
        </p>

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
              isOverdue(node.dueDate, node.status) ? "text-red-500" : "text-muted-foreground"
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
        </div>
      </div>
    </div>
  )
}
