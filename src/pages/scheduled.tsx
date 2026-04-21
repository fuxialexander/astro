import { useState, useMemo, useCallback } from "react"
import { useNavigate } from "react-router"
import {
  Calendar, Play, Trash2, Pencil, Loader2,
  FlaskConical, CheckSquare, ChevronDown, ChevronRight,
  ArrowRight, Circle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { useScheduleStore } from "@/stores/schedule-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useToastStore } from "@/stores/toast-store"
import { ScheduleForm } from "@/components/schedule/schedule-form"
import { RunHistory } from "@/components/schedule/run-history"
import { cn } from "@/lib/utils"
import { formatShortDate } from "@/lib/date-utils"
import type { Schedule } from "@/types"

// ── Human-readable cron description ──────────────────────────────

function describeCron(expr: string, timezone: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr

  const [minPart, hourPart, domPart, , dowPart] = parts
  const tz = timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone

  const fmt12 = (h: number, m: number) => {
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  const hour = parseInt(hourPart, 10)
  const minute = parseInt(minPart, 10)

  // Hourly
  if ((hourPart === '*' || hourPart.startsWith('*/')) && domPart === '*' && dowPart === '*') {
    const interval = hourPart === '*' ? 1 : parseInt(hourPart.slice(2), 10)
    return interval === 1 ? 'Every hour' : `Every ${interval} hours`
  }

  // Daily
  if (domPart === '*' && dowPart === '*' && !isNaN(hour) && !isNaN(minute)) {
    return `Daily ${fmt12(hour, minute)} ${tz}`
  }

  // Weekly
  if (domPart === '*' && dowPart !== '*' && !isNaN(hour) && !isNaN(minute)) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const days = dowPart.split(',').map(n => dayNames[parseInt(n, 10)] ?? '?').join(', ')
    return `${days} ${fmt12(hour, minute)} ${tz}`
  }

  // Monthly
  if (domPart !== '*' && dowPart === '*' && !isNaN(hour) && !isNaN(minute)) {
    const dom = parseInt(domPart, 10)
    return `Monthly ${ordinal(dom)} at ${fmt12(hour, minute)} ${tz}`
  }

  return expr
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

// ── Row ────────────────────────────────────────────────────────────

function ScheduleRow({
  schedule,
  projectName,
  nodeName,
  isExpanded,
  isEditing,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onDelete,
  onToggle,
  onTrigger,
}: {
  schedule: Schedule
  projectName: string
  nodeName?: string
  isExpanded: boolean
  isEditing: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
  onToggle: () => void
  onTrigger: () => Promise<void>
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [triggering, setTriggering] = useState(false)

  const handleDelete = useCallback(() => {
    if (confirmDelete) { onDelete(); setConfirmDelete(false) }
    else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000) }
  }, [confirmDelete, onDelete])

  const handleTrigger = useCallback(async () => {
    setTriggering(true)
    try { await onTrigger() } finally { setTriggering(false) }
  }, [onTrigger])

  const description = describeCron(schedule.cronExpression, schedule.timezone)

  return (
    <div className={cn(
      "border-b border-border/30 last:border-0 transition-colors",
      isEditing && "bg-muted/20",
    )}>
      {/* Main row */}
      <div className="flex items-center gap-0 h-10 px-4 hover:bg-muted/30 transition-colors group">

        {/* Expand toggle */}
        <button
          onClick={onToggleExpand}
          className="h-10 w-6 flex items-center justify-center shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          {isExpanded
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          }
        </button>

        {/* Status dot */}
        <button
          onClick={onToggle}
          className="h-10 w-6 flex items-center justify-center shrink-0 mr-1"
          title={schedule.enabled ? "Pause" : "Enable"}
        >
          <Circle className={cn(
            "h-2 w-2 transition-colors",
            schedule.enabled ? "fill-primary text-primary" : "fill-muted-foreground/30 text-muted-foreground/30",
          )} />
        </button>

        {/* Name */}
        <button
          className="flex-1 min-w-0 text-left"
          onClick={onToggleExpand}
        >
          <span className="text-sm truncate">{schedule.name}</span>
        </button>

        {/* Description */}
        <div className="w-[200px] shrink-0 hidden md:block">
          <span className="text-xs text-muted-foreground truncate block">{description}</span>
        </div>

        {/* Project / node */}
        <div className="w-[180px] shrink-0 hidden lg:flex items-center gap-1 min-w-0">
          <span className="text-xs text-muted-foreground truncate">{projectName}</span>
          {nodeName && (
            <>
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
              <span className="text-xs text-muted-foreground truncate">{nodeName}</span>
            </>
          )}
        </div>

        {/* Next run */}
        <div className="w-[100px] shrink-0 hidden sm:block">
          {schedule.nextRunAt ? (
            <span className="text-xs text-muted-foreground">
              {formatShortDate(new Date(schedule.nextRunAt).toISOString())}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/30">—</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleTrigger}
                disabled={triggering}
              >
                {triggering
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Play className="h-3 w-3" />
                }
              </Button>
            </TooltipTrigger>
            <TooltipContent>Run now</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
                <Pencil className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7", confirmDelete
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "text-muted-foreground hover:text-destructive"
                )}
                onClick={handleDelete}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{confirmDelete ? "Click to confirm" : "Delete"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Inline edit form */}
      {isEditing && (
        <div className="px-8 pb-4 pt-2 border-t border-border/30">
          <ScheduleForm
            projectId={schedule.projectId}
            scope={schedule.scope}
            nodeId={schedule.nodeId ?? undefined}
            schedule={schedule}
            onSave={onCancelEdit}
            onCancel={onCancelEdit}
          />
        </div>
      )}

      {/* Run history */}
      {isExpanded && !isEditing && (
        <div className="px-8 pb-3 pt-1 border-t border-border/20">
          <RunHistory scheduleId={schedule.id} />
        </div>
      )}
    </div>
  )
}

// ── Section ────────────────────────────────────────────────────────

function Section({
  label,
  icon: Icon,
  schedules,
  projectsMap,
  nodesMap,
  editingId,
  expandedId,
  onEdit,
  onCancelEdit,
  onToggleExpand,
}: {
  label: string
  icon: typeof Calendar
  schedules: Schedule[]
  projectsMap: Map<string, string>
  nodesMap: Map<string, string>
  editingId: string | null
  expandedId: string | null
  onEdit: (id: string) => void
  onCancelEdit: () => void
  onToggleExpand: (id: string) => void
}) {
  const { deleteSchedule, updateSchedule, triggerSchedule } = useScheduleStore()
  const addToast = useToastStore((s) => s.add)

  if (schedules.length === 0) return null

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 h-8 border-b border-border/30 bg-muted/20">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className="text-[11px] text-muted-foreground/50">{schedules.length}</span>
      </div>

      {schedules.map((schedule) => (
        <ScheduleRow
          key={schedule.id}
          schedule={schedule}
          projectName={projectsMap.get(schedule.projectId) ?? "Unknown"}
          nodeName={schedule.nodeId ? nodesMap.get(schedule.nodeId) : undefined}
          isExpanded={expandedId === schedule.id}
          isEditing={editingId === schedule.id}
          onToggleExpand={() => onToggleExpand(schedule.id)}
          onEdit={() => onEdit(schedule.id)}
          onCancelEdit={onCancelEdit}
          onDelete={() => deleteSchedule(schedule.id)}
          onToggle={() => updateSchedule(schedule.id, { enabled: !schedule.enabled })}
          onTrigger={async () => {
            try {
              await triggerSchedule(schedule.id)
              addToast({ type: "success", title: "Triggered", description: schedule.name })
            } catch (e) {
              addToast({ type: "error", title: "Failed to trigger", description: String(e) })
            }
          }}
        />
      ))}
    </div>
  )
}

// ── Column header ─────────────────────────────────────────────────

function ColHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider", className)}>
      {children}
    </span>
  )
}

// ── Empty state ───────────────────────────────────────────────────

function EmptyState() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-sm w-full space-y-6">
        <div className="text-center space-y-2">
          <Calendar className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <h3 className="text-sm font-medium">No schedules yet</h3>
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            Schedules let tasks and sessions run automatically on a recurring basis — daily, weekly, or on a custom cron.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">How to schedule</p>
          <div className="space-y-3">
            <HowToItem
              icon={CheckSquare}
              title="Schedule a task"
              description="Open a task, then click the clock icon in the bottom workdir bar to set a recurring schedule."
              action="Go to Projects"
              onAction={() => navigate("/projects")}
            />
            <HowToItem
              icon={FlaskConical}
              title="Schedule a session"
              description="In Sessions, select a row and choose Schedule from the batch actions."
              action="Go to Sessions"
              onAction={() => navigate("/sessions")}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function HowToItem({
  icon: Icon,
  title,
  description,
  action,
  onAction,
}: {
  icon: typeof Calendar
  title: string
  description: string
  action: string
  onAction: () => void
}) {
  return (
    <div className="flex gap-3 p-3 rounded-lg border border-border/40 bg-card/50">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{description}</p>
        <button
          onClick={onAction}
          className="text-[11px] text-primary hover:underline underline-offset-2 flex items-center gap-1 mt-1"
        >
          {action}
          <ArrowRight className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────

export function Scheduled() {
  const allSchedules = useScheduleStore((s) => s.allSchedules)
  const allLoaded = useScheduleStore((s) => s.allLoaded)
  const projects = useProjectStore((s) => s.projects)
  const planNodes = usePlanStore((s) => s.nodes)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const projectsMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of projects) m.set(p.id, p.name)
    return m
  }, [projects])

  const nodesMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const n of planNodes) m.set(n.id, n.title)
    return m
  }, [planNodes])

  const taskSchedules = useMemo(() => allSchedules.filter((s) => s.scope === "node"), [allSchedules])
  const sessionSchedules = useMemo(() => allSchedules.filter((s) => s.scope === "project"), [allSchedules])

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
    setEditingId(null)
  }, [])

  const handleEdit = useCallback((id: string) => {
    setEditingId(id)
    setExpandedId(null)
  }, [])

  if (!allLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-6 h-14 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-primary font-semibold">Scheduled</h1>
          {allSchedules.length > 0 && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {allSchedules.length}
            </Badge>
          )}
        </div>
      </div>

      {allSchedules.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Column headers */}
          <div className="flex items-center gap-0 h-8 px-4 border-b border-border/30 bg-muted/10 sticky top-0 z-10">
            <div className="w-6 shrink-0" />
            <div className="w-6 shrink-0 mr-1" />
            <ColHeader className="flex-1">Name</ColHeader>
            <ColHeader className="w-[200px] shrink-0 hidden md:block">Frequency</ColHeader>
            <ColHeader className="w-[180px] shrink-0 hidden lg:block">Project</ColHeader>
            <ColHeader className="w-[100px] shrink-0 hidden sm:block">Next run</ColHeader>
            <div className="w-[84px] shrink-0" />
          </div>

          <Section
            label="Tasks"
            icon={CheckSquare}
            schedules={taskSchedules}
            projectsMap={projectsMap}
            nodesMap={nodesMap}
            editingId={editingId}
            expandedId={expandedId}
            onEdit={handleEdit}
            onCancelEdit={() => setEditingId(null)}
            onToggleExpand={handleToggleExpand}
          />
          <Section
            label="Sessions & Projects"
            icon={FlaskConical}
            schedules={sessionSchedules}
            projectsMap={projectsMap}
            nodesMap={nodesMap}
            editingId={editingId}
            expandedId={expandedId}
            onEdit={handleEdit}
            onCancelEdit={() => setEditingId(null)}
            onToggleExpand={handleToggleExpand}
          />
        </div>
      )}
    </div>
  )
}
