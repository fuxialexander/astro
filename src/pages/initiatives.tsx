import { useMemo, useState, useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router"
import {
  Target,
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  Folder,
  Check,
  Search,
  X,
  ListFilter,
  TrendingUp,
  Activity,
  CalendarDays,
  UserRound,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import { FilterSelect } from "@/components/views/filter-select"
import { ItemListView, type ListColumn, type ListGroup, type BatchAction } from "@/components/views/item-list-view"
import { ColorIconBadge } from "@/components/color-icon-picker"
import { ColorIconPicker } from "@/components/color-icon-picker"
import { InlineRenameInput } from "@/components/inline-rename-input"
import { useInitiativeStore } from "@/stores/initiative-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { useActivityStore } from "@/stores/activity-store"
import { formatShortDate, isOverdue } from "@/lib/date-utils"
import { DEFAULT_INITIATIVE_ICON, getRandomColor } from "@/lib/color-icon-utils"
import { OnboardingHint } from "@/components/onboarding-hint"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useTeamStore } from "@/stores/team-store"
import type { Initiative, Project } from "@/types"

const statusConfig: Record<
  Initiative["status"],
  { label: string; variant: "default" | "success" | "warning" | "destructive" }
> = {
  active: { label: "Active", variant: "success" },
  on_hold: { label: "On hold", variant: "warning" },
  completed: { label: "Completed", variant: "default" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

const healthConfig: Record<string, { label: string; dotClass: string; textClass: string }> = {
  on_track: { label: "On track", dotClass: "bg-success", textClass: "text-success" },
  at_risk: { label: "At risk", dotClass: "bg-warning", textClass: "text-warning" },
  off_track: { label: "Off track", dotClass: "bg-error", textClass: "text-error" },
}

// --- Display config for initiative project list ---
const initiativeProjectsDisplayConfig: DisplayPopoverConfig = {
  viewKey: "initiative-projects",
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "status", label: "Status" },
    { value: "health", label: "Health" },
  ],
  orderByOptions: [
    { value: "name", label: "Name" },
    { value: "targetDate", label: "Target date" },
    { value: "progress", label: "Progress" },
    { value: "health", label: "Health" },
  ],
  propertyOptions: [
    { value: "status", label: "Status" },
    { value: "health", label: "Health" },
    { value: "progress", label: "Progress" },
    { value: "targetDate", label: "Target date" },
  ],
}

// --- Initiative Progress (sidebar) ---
function InitiativeProgress({ projects }: { projects: Project[] }) {
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])

  const { total, pct } = useMemo(() => {
    const projectIds = new Set(projects.map((p) => p.id))
    const tasks = nodes.filter((n) => projectIds.has(n.projectId) && n.type !== "milestone")
    const done = tasks.filter((n) => n.status === "completed" || n.status === "auto_verified")
    return {
      total: tasks.length,
      completed: done.length,
      pct: tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0,
    }
  }, [nodes, projects])

  if (total === 0) return null

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-border overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{pct}%</span>
    </div>
  )
}

// --- Activity Heatmap Strip ---
function ActivityHeatStrip({ projectIds }: { projectIds: string[] }) {
  const activities = useActivityStore((s) => s.activities)

  const { dailyCounts, weekTotal, todayTotal, maxCount } = useMemo(() => {
    const idSet = new Set(projectIds)
    const now = new Date()
    const days: { date: string; count: number; label: string }[] = []

    // Build last 14 days
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const dayLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      days.push({ date: dateStr, count: 0, label: dayLabel })
    }

    // Count activities per day
    const relevant = activities.filter((a) => idSet.has(a.projectId))
    for (const a of relevant) {
      const aDate = new Date(a.timestamp).toISOString().slice(0, 10)
      const day = days.find((d) => d.date === aDate)
      if (day) day.count++
    }

    const todayStr = now.toISOString().slice(0, 10)
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - 7)
    const weekAgoStr = weekAgo.toISOString().slice(0, 10)

    return {
      dailyCounts: days,
      weekTotal: days.filter((d) => d.date >= weekAgoStr).reduce((sum, d) => sum + d.count, 0),
      todayTotal: days.find((d) => d.date === todayStr)?.count ?? 0,
      maxCount: Math.max(1, ...days.map((d) => d.count)),
    }
  }, [activities, projectIds])

  return (
    <div className="flex items-center gap-4">
      {/* Sparkline bars */}
      <div className="flex items-end gap-[3px] h-[28px]">
        {dailyCounts.map((day) => {
          const height = day.count > 0 ? Math.max(4, Math.round((day.count / maxCount) * 28)) : 2
          const isToday = day === dailyCounts[dailyCounts.length - 1]
          return (
            <Tooltip key={day.date}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "w-[6px] rounded-sm transition-all",
                    day.count === 0
                      ? "bg-border"
                      : isToday
                        ? "bg-primary"
                        : "bg-primary/50",
                  )}
                  style={{ height: `${height}px` }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <span className="font-medium">{day.count}</span> change{day.count !== 1 ? "s" : ""} &middot;{" "}
                {day.label}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Today</span>
          <span className="font-semibold tabular-nums">{todayTotal}</span>
        </div>
        <div className="h-3 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">This week</span>
          <span className="font-semibold tabular-nums">{weekTotal}</span>
        </div>
      </div>
    </div>
  )
}

// --- Batch Project Picker (inline, with checkboxes) ---
function ProjectBatchPicker({
  initiativeId,
  onClose,
}: {
  initiativeId: string
  onClose: () => void
}) {
  const projects = useProjectStore((s) => s.projects)
  const updateProject = useProjectStore((s) => s.updateProject)
  const initiatives = useInitiativeStore((s) => s.initiatives)
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const liveNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const [search, setSearch] = useState("")

  const activeProjects = useMemo(
    () => {
      const idsWithNodes = new Set(liveNodes.map((n) => n.projectId))
      return projects.filter((p) => p.status === "active" && idsWithNodes.has(p.id))
    },
    [projects, liveNodes],
  )

  const filtered = useMemo(() => {
    if (!search) return activeProjects
    const q = search.toLowerCase()
    return activeProjects.filter((p) => p.name.toLowerCase().includes(q))
  }, [activeProjects, search])

  const toggle = useCallback(
    (projectId: string, currentInitiativeId?: string) => {
      updateProject(projectId, {
        initiativeId: currentInitiativeId === initiativeId ? undefined : initiativeId,
      })
    },
    [initiativeId, updateProject],
  )

  return (
    <div className="flex flex-col border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50"
          autoFocus
        />
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-[240px] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No projects found</p>
        ) : (
          filtered.map((project) => {
            const isAssigned = project.initiativeId === initiativeId
            const otherInitiative =
              project.initiativeId && project.initiativeId !== initiativeId
                ? initiatives.find((i) => i.id === project.initiativeId)
                : null

            return (
              <button
                key={project.id}
                type="button"
                onClick={() => toggle(project.id, project.initiativeId)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors cursor-pointer",
                  isAssigned && "bg-primary/5",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-center h-4 w-4 rounded border shrink-0 transition-colors",
                    isAssigned ? "bg-primary border-primary" : "border-border",
                  )}
                >
                  {isAssigned && <Check className="h-3 w-3 text-primary-foreground" />}
                </div>
                <span className="flex-1 text-sm truncate">{project.name}</span>
                {otherInitiative && (
                  <span className="text-[10px] text-muted-foreground shrink-0">in {otherInitiative.name}</span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function InitiativeSummaryStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Folder
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

// --- Column definitions for initiative project list ---
function getProjectColumns(
  renamingProjectId: string | null,
  setRenamingProjectId: (id: string | null) => void,
  handleRename: (id: string, name: string) => void,
  validateName: (name: string) => string | null,
  progressMap: Record<string, number>,
): ListColumn<Project>[] {
  return [
    {
      id: "name",
      label: "Name",
      width: "flex-1",
      sortKey: "name",
      render: (p) => (
        <div className="flex items-center gap-2.5 min-w-0 w-full">
          <ColorIconBadge color={p.color} icon={p.icon} type="project" />
          {renamingProjectId === p.id ? (
            <InlineRenameInput
              value={p.name}
              onSave={(newName) => handleRename(p.id, newName)}
              onCancel={() => setRenamingProjectId(null)}
              validate={validateName}
              className="flex-1"
            />
          ) : (
            <Link
              to={`/project/${p.id}`}
              onDoubleClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setRenamingProjectId(p.id)
              }}
              onClick={(e) => e.stopPropagation()}
              className="text-sm truncate flex-1 hover:underline group/name"
            >
              {p.name}
              <Pencil
                className="h-3 w-3 ml-1.5 inline-block opacity-0 group-hover/name:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setRenamingProjectId(p.id)
                }}
              />
            </Link>
          )}
        </div>
      ),
    },
    {
      id: "status",
      label: "Status",
      width: "w-[100px]",
      render: (p) => (
        <Badge variant="success" className="text-xs">
          {p.status === "active" ? "Active" : "Archived"}
        </Badge>
      ),
    },
    {
      id: "health",
      label: "Health",
      width: "w-[100px]",
      sortKey: "health",
      render: (p) => {
        const health = healthConfig[p.health ?? "on_track"]
        return (
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${health.dotClass}`} />
            <span className={`text-xs ${health.textClass}`}>{health.label}</span>
          </div>
        )
      },
    },
    {
      id: "progress",
      label: "Progress",
      width: "w-[100px]",
      sortKey: "progress",
      render: (p) => {
        const pct = progressMap[p.id] ?? 0
        return (
          <div className="flex items-center gap-2">
            <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  pct >= 95 ? "bg-success" : pct > 0 ? "bg-primary" : "",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
          </div>
        )
      },
    },
    {
      id: "targetDate",
      label: "Target date",
      width: "w-[100px]",
      sortKey: "targetDate",
      render: (p) => {
        const pct = progressMap[p.id] ?? 0
        return (
          <span
            className={cn(
              "text-xs",
              isOverdue(p.targetDate, pct >= 100 ? "completed" : "planned") ? "text-error" : "text-muted-foreground",
            )}
          >
            {formatShortDate(p.targetDate) || "\u2014"}
          </span>
        )
      },
    },
  ]
}

export default function InitiativesPage() {
  const { t } = useTranslation('initiatives')
  const navigate = useNavigate()
  const { initiatives, addInitiative, updateInitiative, deleteInitiative } = useInitiativeStore()
  const { projects, updateProject, deleteProject } = useProjectStore()
  const activeTeamId = useTeamStore((s) => s.activeTeamId)
  const teamMemberCount = useTeamStore((s) => (activeTeamId ? (s.teamMembers[activeTeamId]?.length ?? 0) : 0))
  const isSoloWorkspace = teamMemberCount <= 1
  const teamMembers = useTeamStore((s) => activeTeamId ? s.teamMembers[activeTeamId] ?? [] : [])
  const [showDialog, setShowDialog] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState("all")
  const [healthFilter, setHealthFilter] = useState("all")
  const displaySettings = useDisplaySettingsStore((s) => s.get("initiative-projects"))
  const updateDisplaySettings = useDisplaySettingsStore((s) => s.update)
  const [formData, setFormData] = useState<Partial<Initiative>>({
    name: "",
    description: "",
    goal: "",
    status: "active",
    startDate: "",
    targetDate: "",
    lead: "",
    color: "#3b82f6",
  })

  const projectsByInitiative = useMemo(() => {
    const map = new Map<string, Project[]>()
    projects.forEach((p) => {
      if (p.initiativeId) {
        const list = map.get(p.initiativeId) || []
        list.push(p)
        map.set(p.initiativeId, list)
      }
    })
    return map
  }, [projects])

  const sortedInitiatives = useMemo(() => {
    return [...initiatives].sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1
      if (a.status !== "active" && b.status === "active") return 1
      return a.name.localeCompare(b.name)
    })
  }, [initiatives])

  const resolvedSelectedId = useMemo(() => {
    if (selectedId && initiatives.some((i) => i.id === selectedId)) return selectedId
    return sortedInitiatives[0]?.id ?? null
  }, [initiatives, selectedId, sortedInitiatives])

  const selected = resolvedSelectedId ? initiatives.find((i) => i.id === resolvedSelectedId) ?? null : null
  const selectedProjects = useMemo(
    () => (selected ? projectsByInitiative.get(selected.id) ?? [] : []),
    [selected, projectsByInitiative],
  )
  const selectedProjectIds = useMemo(() => selectedProjects.map((p) => p.id), [selectedProjects])

  // Calculate live progress from plan nodes (same logic as sidebar / project-overview)
  const rawNodes = usePlanStore((s) => s.nodes)
  const allNodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const progressMap = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of projects) {
      const tasks = allNodes.filter((n) => n.projectId === p.id && n.type !== "milestone")
      if (tasks.length === 0) {
        map[p.id] = 0
        continue
      }
      const completed = tasks.filter((n) => n.status === "completed" || n.status === "auto_verified")
      map[p.id] = Math.round((completed.length / tasks.length) * 100)
    }
    return map
  }, [projects, allNodes])

  useEffect(() => {
    if (resolvedSelectedId !== selectedId) {
      setSelectedId(resolvedSelectedId)
    }
  }, [resolvedSelectedId, selectedId])

  useEffect(() => {
    setShowProjectPicker(false)
  }, [resolvedSelectedId])

  const leadLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const member of teamMembers) {
      map.set(member.userId, member.user?.name || member.user?.email || member.userId)
    }
    return map
  }, [teamMembers])

  const activeInitiativeCount = useMemo(
    () => initiatives.filter((initiative) => initiative.status === "active").length,
    [initiatives],
  )

  const assignedProjectCount = useMemo(
    () => projects.filter((project) => project.initiativeId).length,
    [projects],
  )

  const selectedSummary = useMemo(() => {
    if (!selected) return null

    const selectedProjectIdSet = new Set(selectedProjects.map((project) => project.id))
    const tasks = allNodes.filter((node) => selectedProjectIdSet.has(node.projectId) && node.type !== "milestone")
    const completedTasks = tasks.filter((node) => node.status === "completed" || node.status === "auto_verified")
    const completedProjects = selectedProjects.filter((project) => (progressMap[project.id] ?? 0) >= 100).length
    const overdueProjects = selectedProjects.filter((project) =>
      isOverdue(project.targetDate, (progressMap[project.id] ?? 0) >= 100 ? "completed" : "planned"),
    ).length

    return {
      projectCount: selectedProjects.length,
      activeProjectCount: selectedProjects.filter((project) => project.status === "active").length,
      completedProjectCount: completedProjects,
      overdueProjectCount: overdueProjects,
      progressPct: tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0,
      leadLabel: selected.lead ? (leadLabels.get(selected.lead) ?? selected.lead) : "Unassigned",
      targetDateLabel: selected.targetDate ? formatShortDate(selected.targetDate) : "No target date",
    }
  }, [allNodes, leadLabels, progressMap, selected, selectedProjects])

  // Sort and filter projects for the list view
  const sortedFilteredProjects = useMemo(() => {
    let filtered = displaySettings.showCompleted
      ? selectedProjects
      : selectedProjects.filter((p) => (progressMap[p.id] ?? 0) < 100)

    if (statusFilter !== "all") {
      filtered = filtered.filter((p) => p.status === statusFilter)
    }
    if (healthFilter !== "all") {
      filtered = filtered.filter((p) => p.health === healthFilter)
    }

    const sorted = [...filtered]
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    sorted.sort((a, b) => {
      switch (displaySettings.orderBy) {
        case "name":
          return dir * a.name.localeCompare(b.name)
        case "targetDate": {
          const da = a.targetDate ?? ""
          const db = b.targetDate ?? ""
          return dir * da.localeCompare(db)
        }
        case "progress":
          return dir * ((progressMap[a.id] ?? 0) - (progressMap[b.id] ?? 0))
        case "health": {
          const order = { on_track: 0, at_risk: 1, off_track: 2 }
          return dir * ((order[a.health ?? "on_track"] ?? 0) - (order[b.health ?? "on_track"] ?? 0))
        }
        default:
          return 0
      }
    })
    return sorted
  }, [selectedProjects, displaySettings, statusFilter, healthFilter, progressMap])

  // Group projects for list view
  const listGroups = useMemo((): ListGroup<Project>[] => {
    if (displaySettings.groupBy === "none") {
      return [{ key: "all", label: "All Projects", items: sortedFilteredProjects }]
    }
    const grouped = sortedFilteredProjects.reduce<Record<string, Project[]>>((acc, p) => {
      let group: string
      switch (displaySettings.groupBy) {
        case "status":
          group = p.status === "active" ? "Active" : "Archived"
          break
        case "health":
          group = healthConfig[p.health ?? "on_track"]?.label ?? "On track"
          break
        default:
          group = "All Projects"
      }
      ;(acc[group] ??= []).push(p)
      return acc
    }, {})
    return Object.entries(grouped).map(([label, items]) => ({
      key: label,
      label,
      icon: <Folder className="h-4 w-4 text-muted-foreground" />,
      items,
    }))
  }, [sortedFilteredProjects, displaySettings.groupBy])

  const handleOpenDialog = (initiative?: Initiative) => {
    if (initiative) {
      setEditingId(initiative.id)
      setFormData(initiative)
    } else {
      setEditingId(null)
      setFormData({
        name: "",
        description: "",
        goal: "",
        status: "active",
        startDate: "",
        targetDate: "",
        lead: "",
        color: getRandomColor(),
        icon: DEFAULT_INITIATIVE_ICON,
      })
    }
    setShowDialog(true)
  }

  const handleSave = () => {
    if (!formData.name?.trim()) return

    if (editingId) {
      updateInitiative(editingId, formData)
    } else {
      const newInitiative: Initiative = {
        id: crypto.randomUUID(),
        name: formData.name,
        description: formData.description || "",
        teamId: activeTeamId || useTeamStore.getState().getPersonalTeamId(),
        goal: formData.goal,
        status: formData.status || "active",
        startDate: formData.startDate,
        targetDate: formData.targetDate,
        lead: formData.lead,
        color: formData.color || getRandomColor(),
        icon: formData.icon || DEFAULT_INITIATIVE_ICON,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      addInitiative(newInitiative)
      setSelectedId(newInitiative.id)
    }
    setShowDialog(false)
  }

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setDeleteConfirmId(id)
  }

  const handleDeleteConfirm = () => {
    if (!deleteConfirmId) return
    // Unassign projects from this initiative
    projects.forEach((p) => {
      if (p.initiativeId === deleteConfirmId) {
        updateProject(p.id, { initiativeId: undefined })
      }
    })
    deleteInitiative(deleteConfirmId)
    if (selectedId === deleteConfirmId) setSelectedId(null)
    setDeleteConfirmId(null)
  }

  const handleSort = useCallback(
    (sortKey: string) => {
      if (displaySettings.orderBy === sortKey) {
        updateDisplaySettings("initiative-projects", {
          orderDirection: displaySettings.orderDirection === "asc" ? "desc" : "asc",
        })
      } else {
        updateDisplaySettings("initiative-projects", { orderBy: sortKey, orderDirection: "asc" })
      }
    },
    [displaySettings.orderBy, displaySettings.orderDirection, updateDisplaySettings],
  )

  const handleProjectRename = useCallback(
    (projectId: string, newName: string) => {
      updateProject(projectId, { name: newName })
      setRenamingProjectId(null)
    },
    [updateProject],
  )

  const validateProjectName = useCallback(
    (name: string): string | null => {
      if (!name.trim()) return "Project name cannot be empty"
      if (name.length > 100) return "Project name is too long (max 100 characters)"
      const isDuplicate = projects.some(
        (p) => p.id !== renamingProjectId && p.name.toLowerCase() === name.toLowerCase(),
      )
      if (isDuplicate) return "A project with this name already exists"
      return null
    },
    [projects, renamingProjectId],
  )

  const projectBatchActions: BatchAction[] = useMemo(
    () => [
      {
        id: "unassign",
        label: "Unassign",
        icon: <X className="h-3.5 w-3.5" />,
        variant: "default",
        onAction: (ids) => {
          for (const id of ids) updateProject(id, { initiativeId: undefined })
        },
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-3.5 w-3.5" />,
        variant: "destructive",
        onAction: (ids) => {
          for (const id of ids) deleteProject(id)
        },
      },
    ],
    [updateProject, deleteProject],
  )

  const projectColumns = useMemo(
    () => getProjectColumns(renamingProjectId, setRenamingProjectId, handleProjectRename, validateProjectName, progressMap),
    [renamingProjectId, validateProjectName, handleProjectRename, progressMap],
  )

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <div className="flex items-center gap-3">
          <Target className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-primary font-semibold">{t('title')}</h1>
          {initiatives.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {initiatives.length}
            </Badge>
          )}
        </div>
        <Button onClick={() => handleOpenDialog()} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          {t('new')}
        </Button>
      </div>

      {sortedInitiatives.length === 0 ? (
        <div className="flex-1 overflow-auto p-6">
          <OnboardingHint hintId="initiatives-intro" icon={Target} className="mb-3">
            Initiatives group related projects under a shared objective, timeline, and owner.
          </OnboardingHint>
          <EmptyState
            icon={Target}
            title="No initiatives yet"
            description="Create your first initiative to organize projects around a shared outcome."
            action={{
              label: "New Initiative",
              onClick: () => handleOpenDialog(),
            }}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto bg-muted/20">
          <div className="flex min-h-full flex-col gap-5 p-4 sm:p-6 xl:flex-row">
            <aside className="w-full shrink-0 xl:w-[320px] xl:min-w-[320px]">
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-4">
                  <div>
                    <p className="text-sm font-semibold">All initiatives</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {activeInitiativeCount} active · {assignedProjectCount} assigned projects
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {sortedInitiatives.length}
                  </Badge>
                </div>

                <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
                  {sortedInitiatives.map((initiative) => {
                    const initiativeProjects = projectsByInitiative.get(initiative.id) || []
                    const isSelected = resolvedSelectedId === initiative.id

                    return (
                      <div
                        key={initiative.id}
                        className={cn(
                          "group relative border-b border-border/60 last:border-b-0",
                          isSelected ? "bg-accent/60" : "hover:bg-muted/40",
                        )}
                      >
                        <div className="flex items-start gap-3 px-4 py-4">
                          <button
                            type="button"
                            onClick={() => setSelectedId(initiative.id)}
                            className="flex min-w-0 flex-1 items-start gap-3 text-left cursor-pointer"
                          >
                            <ColorIconBadge color={initiative.color} icon={initiative.icon} type="initiative" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className={cn("truncate text-sm", isSelected ? "font-semibold" : "font-medium")}>
                                  {initiative.name}
                                </span>
                                <Badge
                                  variant={statusConfig[initiative.status].variant}
                                  className="h-4 shrink-0 px-1 py-0 text-[9px]"
                                >
                                  {statusConfig[initiative.status].label}
                                </Badge>
                              </div>

                              {(initiative.goal || initiative.description) && (
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                  {initiative.goal || initiative.description}
                                </p>
                              )}

                              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                                <span>
                                  {initiativeProjects.length} project{initiativeProjects.length !== 1 ? "s" : ""}
                                </span>
                                {initiative.targetDate && (
                                  <>
                                    <span>&middot;</span>
                                    <span>{formatShortDate(initiative.targetDate)}</span>
                                  </>
                                )}
                              </div>

                              <div className="mt-3">
                                <InitiativeProgress projects={initiativeProjects} />
                              </div>
                            </div>
                          </button>

                          <div
                            className={cn(
                              "flex shrink-0 items-center gap-0.5 transition-opacity",
                              isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            )}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleOpenDialog(initiative)
                              }}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                              title="Edit initiative"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteClick(e, initiative.id)}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                              title="Delete initiative"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </aside>

            <section className="flex min-h-[520px] min-w-0 flex-1 flex-col gap-4">
              {selected && selectedSummary && (
                <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                  <div className="flex flex-col gap-5 p-5 sm:p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-start gap-4">
                          <ColorIconBadge color={selected.color} icon={selected.icon} type="initiative" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-2xl font-primary font-semibold tracking-tight">{selected.name}</h2>
                              <Badge variant={statusConfig[selected.status].variant}>
                                {statusConfig[selected.status].label}
                              </Badge>
                            </div>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                              {selected.goal || selected.description || "A shared initiative for coordinating related projects."}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                                <Folder className="h-3.5 w-3.5" />
                                {selectedSummary.projectCount} project{selectedSummary.projectCount !== 1 ? "s" : ""}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                                <CalendarDays className="h-3.5 w-3.5" />
                                {selectedSummary.targetDateLabel}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                                <UserRound className="h-3.5 w-3.5" />
                                {selectedSummary.leadLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleOpenDialog(selected)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" />
                          Edit Initiative
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <InitiativeSummaryStat
                        icon={Folder}
                        label="Active projects"
                        value={String(selectedSummary.activeProjectCount)}
                        hint={`${selectedSummary.projectCount} total`}
                      />
                      <InitiativeSummaryStat
                        icon={CheckCircle2}
                        label="Completed projects"
                        value={String(selectedSummary.completedProjectCount)}
                        hint={`${selectedSummary.progressPct}% task progress`}
                      />
                      <InitiativeSummaryStat
                        icon={AlertTriangle}
                        label="Overdue projects"
                        value={String(selectedSummary.overdueProjectCount)}
                        hint={selectedSummary.overdueProjectCount > 0 ? "Needs attention" : "Everything on schedule"}
                      />
                      <InitiativeSummaryStat
                        icon={Activity}
                        label="Delivery progress"
                        value={`${selectedSummary.progressPct}%`}
                        hint="Based on live plan tasks"
                      />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium">Overall progress</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Roll-up of live tasks across all projects in this initiative
                            </p>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-semibold tabular-nums">{selectedSummary.progressPct}%</div>
                            <div className="text-xs text-muted-foreground">
                              {selectedSummary.completedProjectCount} of {selectedSummary.projectCount} projects complete
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 h-2 overflow-hidden rounded-full bg-border">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${selectedSummary.progressPct}%` }}
                          />
                        </div>
                      </div>

                      <div className="rounded-xl border border-border/70 bg-background px-4 py-3">
                        <ActivityHeatStrip projectIds={selectedProjectIds} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold">Projects</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selected?.name ? `Projects currently mapped to ${selected.name}` : "Projects in this initiative"}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => setShowProjectPicker(!showProjectPicker)}
                    >
                      {showProjectPicker ? (
                        "Done"
                      ) : (
                        <>
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          Add Projects
                        </>
                      )}
                    </Button>
                    <DisplayPopover config={initiativeProjectsDisplayConfig} />
                  </div>
                </div>

                {showProjectPicker && selected && (
                  <div className="border-b border-border/70 px-4 py-4 sm:px-6">
                    <ProjectBatchPicker initiativeId={selected.id} onClose={() => setShowProjectPicker(false)} />
                  </div>
                )}

                <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3 shrink-0 sm:px-6">
                  <div className="flex items-center gap-2 shrink-0">
                    <ListFilter className="h-4 w-4 text-muted-foreground" />
                    <span className="hidden text-sm font-medium text-muted-foreground sm:inline">Filter</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <FilterSelect
                      label="Status"
                      value={statusFilter}
                      options={[
                        { value: "all", label: "All statuses" },
                        { value: "active", label: "Active" },
                        { value: "archived", label: "Archived" },
                      ]}
                      onChange={setStatusFilter}
                    />
                    <FilterSelect
                      label="Health"
                      value={healthFilter}
                      options={[
                        { value: "all", label: "All health" },
                        { value: "on_track", label: "On track" },
                        { value: "at_risk", label: "At risk" },
                        { value: "off_track", label: "Off track" },
                      ]}
                      onChange={setHealthFilter}
                    />
                  </div>
                </div>

                {selectedProjects.length === 0 ? (
                  <div className="flex-1 overflow-auto">
                    <EmptyState
                      icon={Folder}
                      title="No projects in this initiative"
                      description='Add existing projects to this initiative using the "Add Projects" button above.'
                      action={{
                        label: "Add Projects",
                        onClick: () => setShowProjectPicker(true),
                      }}
                      className="h-full"
                    />
                  </div>
                ) : (
                  <ItemListView
                    columns={projectColumns}
                    groups={listGroups}
                    visibleColumns={displaySettings.visibleProperties}
                    onItemClick={(p) => navigate(`/project/${p.id}/graph`)}
                    getItemId={(p) => p.id}
                    batchActions={projectBatchActions}
                    sortColumn={displaySettings.orderBy}
                    sortDirection={displaySettings.orderDirection}
                    onSort={handleSort}
                    emptyState={
                      <EmptyState
                        icon={ListFilter}
                        title="No matching projects"
                        description="Try widening your filters or clearing them to see the rest of this initiative."
                        action={{
                          label: "Clear Filters",
                          onClick: () => {
                            setStatusFilter("all")
                            setHealthFilter("all")
                          },
                        }}
                      />
                    }
                    renderMobileItem={(p) => {
                      const health = healthConfig[p.health ?? "on_track"]
                      const pct = progressMap[p.id] ?? 0
                      return (
                        <button
                          onClick={() => navigate(`/project/${p.id}/graph`)}
                          className="w-full flex items-center gap-3.5 rounded-2xl bg-card p-4 transition-all shadow-sm hover:shadow-md border border-border text-left"
                        >
                          <ColorIconBadge color={p.color} icon={p.icon} type="project" />
                          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                            <h3 className="font-semibold text-base truncate">{p.name}</h3>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className={cn("flex items-center gap-1", health.textClass)}>
                                <span className={cn("h-1.5 w-1.5 rounded-full", health.dotClass)} />
                                {health.label}
                              </span>
                              <span className="text-muted-foreground/40">&middot;</span>
                              <span>{pct}%</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  pct >= 95 ? "bg-success" : pct > 0 ? "bg-primary" : "",
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                        </button>
                      )
                    }}
                  />
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Initiative" : "New Initiative"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update the initiative details below." : "Create a new initiative to group related projects."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Platform Development, Q1 Research"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description || ""}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Brief overview..."
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="goal">Goal</Label>
              <Textarea
                id="goal"
                value={formData.goal || ""}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setFormData({ ...formData, goal: e.target.value })
                }
                placeholder="What is the target outcome?"
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status || "active"}
                onValueChange={(value) => setFormData({ ...formData, status: value as Initiative["status"] })}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on_hold">On hold</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Appearance</Label>
              <ColorIconPicker
                color={formData.color}
                icon={formData.icon}
                type="initiative"
                onColorChange={(color) => setFormData({ ...formData, color })}
                onIconChange={(icon) => setFormData({ ...formData, icon })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate || ""}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="targetDate">Target Date</Label>
                <Input
                  id="targetDate"
                  type="date"
                  value={formData.targetDate || ""}
                  onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                />
              </div>
            </div>

            {!isSoloWorkspace && (
              <div className="grid gap-2">
                <Label htmlFor="lead">Lead</Label>
                <select
                  id="lead"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={formData.lead || ""}
                  onChange={(e) => setFormData({ ...formData, lead: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {teamMembers.map((m) => {
                    const label = m.user?.name || m.user?.email || m.userId
                    return (
                      <option key={m.userId} value={m.userId}>
                        {label}
                      </option>
                    )
                  })}
                </select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!formData.name?.trim()}>
              {editingId ? "Save Changes" : "Create Initiative"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Initiative</DialogTitle>
            <DialogDescription>
              This will delete the initiative. Projects will not be deleted, only unassigned from it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
