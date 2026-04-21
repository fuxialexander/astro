import { useMemo, useState, useCallback, useEffect } from "react"
import { useNavigate } from "react-router"
import { FlaskConical, MessageSquare, Trash2, AlertCircle, CheckCircle2, Clock, Loader2, XCircle, Plus, Monitor, FolderGit2, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FilterPopover, FilterRow } from "@/components/views/filter-popover"
import { ItemListView, type ListColumn, type ListGroup, type BatchAction } from "@/components/views/item-list-view"
import { useProjectStore } from "@/stores/project-store"
import { useSessionStore } from "@/stores/session-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useToastStore } from "@/stores/toast-store"
import { useScheduleStore } from "@/stores/schedule-store"
import { ScheduleForm } from "@/components/schedule/schedule-form"
import { cn } from "@/lib/utils"
import { formatShortDate } from "@/lib/date-utils"
import type { Project, Session, SessionStatus } from "@/types"

// ─── Row model ────────────────────────────────────────────────────────────────

type PlaygroundRow = { kind: "playground"; project: Project; sessionStatus: SessionStatus | null }
type ProjectChatRow = { kind: "project-chat"; session: Session; project: Project }
type SessionRow = PlaygroundRow | ProjectChatRow

function rowId(row: SessionRow): string {
  return row.kind === "playground" ? row.project.id : row.session.id
}

function rowName(row: SessionRow): string {
  return row.kind === "playground"
    ? row.project.name
    : (row.session.title || row.session.titlePreview || "Untitled chat")
}

function rowStatus(row: SessionRow): SessionStatus | null {
  return row.kind === "playground" ? row.sessionStatus : row.session.status
}

function rowUpdatedAt(row: SessionRow): string {
  const val = row.kind === "playground" ? row.project.updatedAt : row.session.updatedAt
  if (!val) return ""
  return val instanceof Date ? val.toISOString() : String(val)
}

function rowCreatedAt(row: SessionRow): string {
  const val = row.kind === "playground" ? row.project.createdAt : row.session.createdAt
  if (!val) return ""
  return val instanceof Date ? val.toISOString() : String(val)
}

// ─── Session status per playground project ─────────────────────────────────

function useSessionStatusPerProject(projectIds: string[]): Map<string, SessionStatus | null> {
  const sessions = useSessionStore((s) => s.sessions)
  return useMemo(() => {
    const map = new Map<string, SessionStatus | null>()
    for (const id of projectIds) {
      const projectSessions = [...sessions.values()].filter((s) => s.projectId === id)
      if (projectSessions.length === 0) {
        map.set(id, null)
        continue
      }
      const latest = projectSessions.reduce((a, b) =>
        new Date(b.updatedAt ?? 0).getTime() > new Date(a.updatedAt ?? 0).getTime() ? b : a
      )
      map.set(id, latest.status ?? null)
    }
    return map
  }, [sessions, projectIds])
}

// ─── Status badge ──────────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; icon: typeof Clock; className: string }> = {
  active:    { label: "Active",     icon: Clock,        className: "text-info" },
  streaming: { label: "Streaming",  icon: Loader2,      className: "text-primary animate-spin" },
  completed: { label: "Completed",  icon: CheckCircle2, className: "text-success" },
  error:     { label: "Error",      icon: AlertCircle,  className: "text-destructive" },
  cancelled: { label: "Cancelled",  icon: XCircle,      className: "text-muted-foreground" },
}

function SessionStatusBadge({ status }: { status: SessionStatus | null | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground/50">—</span>
  const cfg = statusConfig[status]
  if (!cfg) return <span className="text-xs text-muted-foreground">{status}</span>
  const Icon = cfg.icon
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.className)} />
      <span className={cn("text-xs", cfg.className)}>{cfg.label}</span>
    </div>
  )
}

// ─── Columns ──────────────────────────────────────────────────────────────

function getColumns(
  machines: { id: string; name?: string | null }[],
  scheduledProjectIds: Set<string>,
): ListColumn<SessionRow>[] {
  return [
    {
      id: "name",
      label: "Name",
      width: "flex-1",
      sortKey: "name",
      render: (row) => {
        const isPlayground = row.kind === "playground"
        const Icon = isPlayground ? FlaskConical : MessageSquare
        const projectId = row.kind === "playground" ? row.project.id : row.project.id
        const isScheduled = scheduledProjectIds.has(projectId)
        return (
          <div className="flex items-center gap-2.5 min-w-0 w-full">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm truncate min-w-0 flex-1">{rowName(row)}</span>
            {isScheduled && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0 gap-1">
                <Calendar className="h-2.5 w-2.5" />
                scheduled
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      id: "status",
      label: "Status",
      width: "w-[130px]",
      render: (row) => <SessionStatusBadge status={rowStatus(row)} />,
    },
    {
      id: "project",
      label: "Project",
      width: "w-[160px]",
      render: (row) => {
        if (row.kind === "playground") return <span className="text-xs text-muted-foreground/50">—</span>
        return (
          <span className="text-xs text-muted-foreground truncate max-w-full">
            {row.project.name}
          </span>
        )
      },
    },
    {
      id: "machine",
      label: "Machine",
      width: "w-[130px]",
      render: (row) => {
        const { project } = row
        const machineId = project.defaultMachineId
        const machine = machineId ? machines.find((m) => m.id === machineId) : machines.length === 1 ? machines[0] : undefined
        if (!machine) return <span className="text-xs text-muted-foreground/50">—</span>
        return (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
            <Monitor className="h-3 w-3 shrink-0" />
            <span className="truncate">{machine.name || "unknown"}</span>
          </div>
        )
      },
    },
    {
      id: "workdir",
      label: "Workdir",
      width: "w-[150px]",
      render: (row) => {
        const { project } = row
        const workdirPath = project.workingDirectory || project.repository || ""
        if (!workdirPath) return <span className="text-xs text-muted-foreground/50">—</span>
        const folderName = workdirPath.split("/").filter(Boolean).at(-1) ?? workdirPath
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono cursor-default min-w-0">
                <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{folderName}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>{workdirPath}</TooltipContent>
          </Tooltip>
        )
      },
    },
    {
      id: "updatedAt",
      label: "Last active",
      width: "w-[110px]",
      sortKey: "updatedAt",
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {formatShortDate(rowUpdatedAt(row))}
        </span>
      ),
    },
    {
      id: "createdAt",
      label: "Created",
      width: "w-[110px]",
      sortKey: "createdAt",
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {formatShortDate(rowCreatedAt(row))}
        </span>
      ),
    },
  ]
}

// ─── Page ──────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "active" | "streaming" | "completed" | "error" | "cancelled"

export function Sessions() {
  const allProjects = useProjectStore((s) => s.projects)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const allSessions = useSessionStore((s) => s.sessions)
  const machines = useMachinesStore((s) => s.machines)
  const fetchMachines = useMachinesStore((s) => s.fetchMachines)
  const addToast = useToastStore((s) => s.add)
  const allSchedules = useScheduleStore((s) => s.allSchedules)
  const navigate = useNavigate()

  useEffect(() => { if (machines.length === 0) fetchMachines() }, [machines.length, fetchMachines])

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [orderBy, setOrderBy] = useState<"name" | "updatedAt" | "createdAt">("updatedAt")
  const [orderDir, setOrderDir] = useState<"asc" | "desc">("desc")
  const [scheduleDialogRow, setScheduleDialogRow] = useState<SessionRow | null>(null)

  const playgroundProjects = useMemo(
    () => allProjects.filter((p) => p.projectType === "playground"),
    [allProjects]
  )
  const regularProjects = useMemo(
    () => allProjects.filter((p) => p.projectType !== "playground"),
    [allProjects]
  )

  const projectMap = useMemo(() => {
    const m = new Map<string, Project>()
    for (const p of allProjects) m.set(p.id, p)
    return m
  }, [allProjects])

  const projectIds = useMemo(() => playgroundProjects.map((p) => p.id), [playgroundProjects])
  const sessionStatusMap = useSessionStatusPerProject(projectIds)

  // Build unified rows
  const allRows = useMemo((): SessionRow[] => {
    const rows: SessionRow[] = []

    // Playground rows
    for (const project of playgroundProjects) {
      rows.push({ kind: "playground", project, sessionStatus: sessionStatusMap.get(project.id) ?? null })
    }

    // Project-chat session rows (from non-playground projects)
    const regularProjectIds = new Set(regularProjects.map((p) => p.id))
    for (const session of allSessions.values()) {
      if (session.type !== "project-chat") continue
      const project = projectMap.get(session.projectId)
      if (!project || !regularProjectIds.has(project.id)) continue
      rows.push({ kind: "project-chat", session, project })
    }

    return rows
  }, [playgroundProjects, regularProjects, sessionStatusMap, allSessions, projectMap])

  // Status filter
  const filtered = useMemo(() => {
    if (statusFilter === "all") return allRows
    return allRows.filter((row) => rowStatus(row) === statusFilter)
  }, [allRows, statusFilter])

  // Sort
  const sorted = useMemo(() => {
    const dir = orderDir === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (orderBy) {
        case "name":
          return dir * rowName(a).localeCompare(rowName(b))
        case "createdAt":
          return dir * rowCreatedAt(a).localeCompare(rowCreatedAt(b))
        case "updatedAt":
        default:
          return dir * rowUpdatedAt(a).localeCompare(rowUpdatedAt(b))
      }
    })
  }, [filtered, orderBy, orderDir])

  const listGroups = useMemo((): ListGroup<SessionRow>[] => [
    { key: "all", label: "All Sessions", items: sorted }
  ], [sorted])

  const scheduledProjectIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of allSchedules) {
      if (s.scope === "project") ids.add(s.projectId)
    }
    return ids
  }, [allSchedules])

  const columns = useMemo(() => getColumns(machines, scheduledProjectIds), [machines, scheduledProjectIds])

  const getBatchActions = useCallback((_selectedIds: string[]): BatchAction[] => [
    {
      id: "schedule",
      label: "Schedule",
      icon: <Calendar className="h-3.5 w-3.5" />,
      onAction: (ids) => {
        const id = ids[0]
        const row = allRows.find((r) => rowId(r) === id)
        if (row) setScheduleDialogRow(row)
      },
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: "destructive",
      onAction: (ids) => {
        for (const id of ids) {
          const row = allRows.find((r) => rowId(r) === id)
          if (row?.kind === "playground") deleteProject(row.project.id)
        }
        addToast({ type: "success", title: `${ids.length} session${ids.length > 1 ? "s" : ""} deleted` })
      },
    },
  ], [allRows, deleteProject, addToast])

  const handleClearFailed = useCallback(() => {
    const failed = allRows.filter((row) => {
      const s = rowStatus(row)
      return s === "error" || s === "cancelled"
    })
    if (failed.length === 0) {
      addToast({ type: "info", title: "No failed sessions to clear" })
      return
    }
    for (const row of failed) {
      if (row.kind === "playground") deleteProject(row.project.id)
    }
    addToast({ type: "success", title: `Cleared ${failed.length} failed session${failed.length > 1 ? "s" : ""}` })
  }, [allRows, deleteProject, addToast])

  const handleSort = useCallback((key: string) => {
    if (orderBy === key) {
      setOrderDir((d) => d === "asc" ? "desc" : "asc")
    } else {
      setOrderBy(key as typeof orderBy)
      setOrderDir("desc")
    }
  }, [orderBy])

  const handleRowClick = useCallback((row: SessionRow) => {
    if (row.kind === "playground") {
      navigate(`/playground?projectId=${row.project.id}`)
    } else {
      navigate(`/project/${row.project.id}`)
    }
  }, [navigate])

  const failedCount = useMemo(
    () => allRows.filter((row) => { const s = rowStatus(row); return s === "error" || s === "cancelled" }).length,
    [allRows]
  )

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-6 h-14 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-primary font-semibold">Sessions</h1>
          <Badge variant="secondary" className="text-xs tabular-nums">
            {allRows.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {failedCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearFailed}
                  className="h-8 gap-1.5 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear failed
                  <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">{failedCount}</Badge>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete all errored and cancelled sessions</TooltipContent>
            </Tooltip>
          )}
          <FilterPopover activeCount={statusFilter !== "all" ? 1 : 0}>
            <FilterRow
              label="Status"
              value={statusFilter}
              options={[
                { value: "all", label: "All statuses" },
                { value: "active", label: "Active" },
                { value: "streaming", label: "Streaming" },
                { value: "completed", label: "Completed" },
                { value: "error", label: "Error" },
                { value: "cancelled", label: "Cancelled" },
              ]}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
            />
          </FilterPopover>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/playground")}
                className="h-8 w-8 p-0 rounded-full"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New session</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <FlaskConical className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {statusFilter !== "all" ? "No sessions match this filter" : "No sessions yet"}
            </p>
            {statusFilter === "all" && (
              <Button variant="outline" size="sm" onClick={() => navigate("/playground")}>
                Start a session
              </Button>
            )}
          </div>
        </div>
      ) : (
        <ItemListView
          columns={columns}
          groups={listGroups}
          visibleColumns={["name", "status", "project", "machine", "workdir", "updatedAt", "createdAt"]}
          onItemClick={handleRowClick}
          getItemId={rowId}
          batchActions={getBatchActions}
          sortColumn={orderBy}
          sortDirection={orderDir}
          onSort={handleSort}
        />
      )}

      {/* Schedule dialog */}
      {scheduleDialogRow && (
        <Dialog open onOpenChange={(open) => { if (!open) setScheduleDialogRow(null) }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Schedule session
              </DialogTitle>
            </DialogHeader>
            <ScheduleForm
              projectId={scheduleDialogRow.project.id}
              scope="project"
              onSave={() => setScheduleDialogRow(null)}
              onCancel={() => setScheduleDialogRow(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
