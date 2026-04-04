import { useMemo, useState, useCallback, useRef, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router"
import { Folder, ListFilter, Plus, Rocket, FlaskConical, Users, Trash2, Upload, Pencil, Github, ChevronRight, Braces, Archive, ArchiveRestore, Building2, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { ImportPreviewDialog } from "@/components/sharing/import-preview-dialog"
import { GitHubRepoPickerDialog } from "@/components/github-repo-picker-dialog"
import { useGitHubAppStore } from "@/stores/github-app-store"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import { FilterSelect } from "@/components/views/filter-select"
import { ItemListView, type ListColumn, type ListGroup, type BatchAction } from "@/components/views/item-list-view"
import { ItemTimelineView, type TimelineRow } from "@/components/views/item-timeline-view"
import { ColorIconBadge } from "@/components/color-icon-picker"
import { InlineRenameInput } from "@/components/inline-rename-input"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { useInitiativeStore } from "@/stores/initiative-store"
import { useToastStore } from "@/stores/toast-store"
import { useTeamStore } from "@/stores/team-store"
import { useWorkspaceFilterStore } from "@/stores/workspace-filter-store"
import { fmtDate, addDays, isValidDateStr } from "@/lib/timeline-utils"
import { formatShortDate, isOverdue } from "@/lib/date-utils"
import { isServerMode } from "@/lib/app-mode"
import { cn } from "@/lib/utils"
import { getRandomColor, getProjectIconForName } from "@/lib/color-icon-utils"
import { DEFAULT_LABELS } from "@/lib/constants"
import type { Project } from "@/types"

const healthConfig: Record<string, { label: string; dotClass: string; textClass: string }> = {
  on_track: { label: "On track", dotClass: "bg-success", textClass: "text-success" },
  at_risk: { label: "At risk", dotClass: "bg-warning", textClass: "text-warning" },
  off_track: { label: "Off track", dotClass: "bg-error", textClass: "text-error" },
}

const initiativeIcons: Record<string, typeof Rocket> = {
  "Platform Development": Rocket,
  "Research Projects": FlaskConical,
}

const initiativeIconColors: Record<string, string> = {
  "Platform Development": "text-primary",
  "Research Projects": "text-destructive",
}

const projectsDisplayConfig: DisplayPopoverConfig = {
  viewKey: "projects",
  showArchivedToggle: true,
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "initiative", label: "Initiative" },
    { value: "status", label: "Status" },
    { value: "health", label: "Health" },
    { value: "team", label: "Team" },
  ],
  orderByOptions: [
    { value: "name", label: "Name" },
    { value: "targetDate", label: "Target date" },
    { value: "progress", label: "Progress" },
    { value: "health", label: "Health" },
  ],
  propertyOptions: [
    { value: "workingDirectory", label: "Working directory" },
    { value: "status", label: "Status" },
    { value: "health", label: "Health" },
    { value: "progress", label: "Progress" },
    { value: "targetDate", label: "Target date" },
  ],
}

const projectsTimelineDisplayConfig: DisplayPopoverConfig = {
  viewKey: "projects-timeline",
  showArchivedToggle: true,
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "initiative", label: "Initiative" },
    { value: "status", label: "Status" },
    { value: "health", label: "Health" },
    { value: "team", label: "Team" },
  ],
  orderByOptions: [
    { value: "name", label: "Name" },
    { value: "targetDate", label: "Target date" },
    { value: "progress", label: "Progress" },
    { value: "health", label: "Health" },
  ],
  propertyOptions: [],
  showZoom: true,
}

// --- Column definitions for project list ---
// Note: This will be replaced with a function that takes renaming state
function shortenPath(path: string | undefined): string {
  if (!path) return ""
  // Show last 2 segments with ~ prefix: /Users/foo/Documents/repos/my-project → ~/repos/my-project
  const segments = path.replace(/\/$/, "").split("/")
  if (segments.length <= 4) return path
  return "~/" + segments.slice(-2).join("/")
}

function getProjectColumns(
  renamingProjectId: string | null,
  setRenamingProjectId: (id: string | null) => void,
  handleRename: (id: string, name: string) => void,
  validateName: (name: string) => string | null,
  progressMap: Record<string, number>,
  teams?: { id: string; name: string }[],
  onTeamChange?: (projectId: string, teamId: string) => void,
  fastEdit?: boolean,
): ListColumn<Project>[] {
  return [
    {
      id: "name",
      label: "Name",
      width: "flex-1",
      sortKey: "name",
      render: (p) => (
        <div className="flex items-center gap-2.5 min-w-0 w-full">
          <ColorIconBadge
            color={p.color}
            icon={p.icon}
            type="project"
          />
          {renamingProjectId === p.id ? (
            <InlineRenameInput
              value={p.name}
              onSave={(newName) => handleRename(p.id, newName)}
              onCancel={() => setRenamingProjectId(null)}
              validate={validateName}
              className="flex-1"
            />
          ) : fastEdit ? (
            <span
              className="text-sm truncate min-w-0 flex-1 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                setRenamingProjectId(p.id)
              }}
            >
              {p.name}
            </span>
          ) : (
            <Link
              to={`/project/${p.id}`}
              onDoubleClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setRenamingProjectId(p.id)
              }}
              onClick={(e) => e.stopPropagation()}
              className="text-sm truncate hover:underline group/name min-w-0 flex-1"
            >
              {p.name}
              <Pencil className="h-3 w-3 ml-1.5 inline-block opacity-0 group-hover/name:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRenamingProjectId(p.id); }} />
            </Link>
          )}
          {(p.projectType === "github" || p.repository) && (
            <Github className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          )}
        </div>
      ),
    },
    {
      id: "workingDirectory",
      label: "Working directory",
      width: "w-[200px]",
      sortKey: "workingDirectory",
      render: (p) => p.workingDirectory ? (
        <span className="text-xs text-muted-foreground/60 truncate block" title={p.workingDirectory}>
          {shortenPath(p.workingDirectory)}
        </span>
      ) : null,
    },
    {
      id: "status",
    label: "Status",
    width: "w-[100px]",
    render: (p) => (
      <Badge variant={p.status === "active" ? "success" : "secondary"} className="text-xs">
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
                  pct >= 95 ? "bg-success" : pct > 0 ? "bg-primary" : ""
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
          </div>
        )
      },
    },
    ...((teams && teams.length > 1) ? [{
      id: "team",
      label: "Team",
      width: "w-[120px]",
      render: (p: Project) => (
          <select
            className="text-xs bg-transparent border-none outline-none cursor-pointer text-muted-foreground hover:text-foreground truncate max-w-[110px]"
            value={p.teamId}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation()
              onTeamChange?.(p.id, e.target.value)
            }}
          >
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
      ),
    }] as ListColumn<Project>[] : []),
    {
      id: "targetDate",
      label: "Target date",
      width: "w-[100px]",
      sortKey: "targetDate",
      render: (p) => {
        const pct = progressMap[p.id] ?? 0
        return (
          <span className={cn(
            "text-xs",
            isOverdue(p.targetDate, pct >= 100 ? "completed" : "planned")
              ? "text-error"
              : "text-muted-foreground"
          )}>
            {formatShortDate(p.targetDate) || "\u2014"}
          </span>
        )
      },
    },
  ]
}

function getProjectBarColors(project: Project, progressMap: Record<string, number>) {
  const pct = progressMap[project.id] ?? 0
  if (pct >= 95) return { bg: "bg-success/80", progress: "bg-success" }
  switch (project.health) {
    case "off_track": return { bg: "bg-error/80", progress: "bg-error" }
    case "at_risk": return { bg: "bg-warning/80", progress: "bg-warning" }
    default:
      if (pct === 0) return { bg: "bg-slate-300 dark:bg-slate-600", progress: "" }
      return { bg: "bg-info/80", progress: "bg-info" }
  }
}

type ViewTab = "all" | "timeline" | "board"

export function Projects() {
  const { t } = useTranslation('projects')
  const allProjectsRaw = useProjectStore((s) => s.projects)
  // Show all active projects (node-based categorization replaces projectType filter)
  const projects = useMemo(
    () => allProjectsRaw.filter((p) => p.status === 'active'),
    [allProjectsRaw]
  )
  const loadAllTeams = useProjectStore((s) => s.loadAllTeams)
  const loadAllTeamsPlans = usePlanStore((s) => s.loadAllTeams)
  const addProject = useProjectStore((s) => s.addProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const rawAllNodes = usePlanStore((s) => s.nodes)
  const allNodes = useMemo(() => rawAllNodes.filter(isLive), [rawAllNodes])
  const initiatives = useInitiativeStore((s) => s.initiatives)
  const teams = useTeamStore((s) => s.teams)
  const addToast = useToastStore((s) => s.add)
  const navigate = useNavigate()
  const displaySettings = useDisplaySettingsStore((s) => s.get("projects"))
  const updateDisplaySettings = useDisplaySettingsStore((s) => s.update)
  const fastEditSetting = useDisplaySettingsStore((s) => s.fastEdit)
  const toggleFastEdit = useDisplaySettingsStore((s) => s.toggleFastEdit)
  const [viewTab, setViewTab] = useState<ViewTab>("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [healthFilter, setHealthFilter] = useState("all")
  const [initiativeFilter, setInitiativeFilter] = useState("all")
  const workspaceFilter = useWorkspaceFilterStore((s) => s.workspaceFilter)
  const [importBundle, setImportBundle] = useState<import("@/lib/sharing/types").AstroExportBundle | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const createInputRef = useRef<HTMLInputElement>(null)
  const [githubPickerOpen, setGithubPickerOpen] = useState(false)

  // Show help tooltip on first visit
  const [showHelpTip, setShowHelpTip] = useState(() => {
    try { return !localStorage.getItem('astro-projects-help-seen') } catch { return true }
  })
  const dismissHelpTip = useCallback(() => {
    setShowHelpTip(false)
    try { localStorage.setItem('astro-projects-help-seen', '1') } catch { /* noop */ }
  }, [])

  // GitHub App integration
  const githubInstallations = useGitHubAppStore((s) => s.installations)
  const githubConnected = githubInstallations.length > 0

  // Load projects from all teams on mount for cross-team view
  useEffect(() => {
    loadAllTeams()
    loadAllTeamsPlans()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keyboard shortcuts: 'i' to toggle fast edit, 'Escape' to exit, 1-3 to switch views
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'i' && !fastEditSetting) {
        e.preventDefault()
        toggleFastEdit()
      } else if (e.key === 'Escape' && fastEditSetting) {
        toggleFastEdit()
        setRenamingProjectId(null)
      } else {
        const viewMap: Record<string, ViewTab> = { '1': 'all', '2': 'board', '3': 'timeline' }
        const view = viewMap[e.key]
        if (view) { e.preventDefault(); setViewTab(view) }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fastEditSetting, toggleFastEdit])

  // Focus input when inline creation row appears
  useEffect(() => {
    if (creating) {
      requestAnimationFrame(() => createInputRef.current?.focus())
    }
  }, [creating])

  const handleInlineCreate = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) {
      setCreating(false)
      return
    }
    const id = crypto.randomUUID()
    const teamId = workspaceFilter !== 'all'
      ? workspaceFilter
      : useTeamStore.getState().getPersonalTeamId()
    addProject({
      id,
      name: trimmed,
      description: "",
      visionDoc: "",
      status: "active",
      color: getRandomColor(),
      icon: getProjectIconForName(trimmed),
      labels: DEFAULT_LABELS,
      teamId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Project)
    setCreating(false)
    navigate(`/project/${id}`)
  }, [addProject, navigate, workspaceFilter])

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const bundle = JSON.parse(ev.target?.result as string)
        setImportBundle(bundle)
      } catch {
        console.error('[projects] Failed to parse import file')
      }
    }
    reader.readAsText(file)
    // Reset input so same file can be selected again
    e.target.value = ''
  }, [])

  // Helper to get initiative name from ID
  const getInitiativeName = useCallback((initiativeId?: string) => {
    if (!initiativeId) return undefined
    return initiatives.find(i => i.id === initiativeId)?.name
  }, [initiatives])

  const getTeamName = useCallback((teamId?: string) => {
    if (!teamId) return undefined
    return teams.find(t => t.id === teamId)?.name
  }, [teams])

  const getProjectBatchActions = useCallback((selectedIds: string[]): BatchAction[] => {
    const selectedProjects = selectedIds.map(id => projects.find(p => p.id === id)).filter(Boolean)
    const hasActive = selectedProjects.some(p => p!.status === "active")
    const hasArchived = selectedProjects.some(p => p!.status === "archived")
    const actions: BatchAction[] = []
    if (hasActive) {
      actions.push({
        id: "archive",
        label: "Archive",
        icon: <Archive className="h-3.5 w-3.5" />,
        onAction: (ids) => {
          const toArchive = ids.filter(id => {
            const p = projects.find(proj => proj.id === id)
            return p && p.status === "active"
          })
          for (const id of toArchive) updateProject(id, { status: "archived" })
          if (toArchive.length > 0) {
            addToast({ type: "success", title: `${toArchive.length} project${toArchive.length > 1 ? "s" : ""} archived` })
          }
        },
      })
    }
    if (hasArchived) {
      actions.push({
        id: "activate",
        label: "Activate",
        icon: <ArchiveRestore className="h-3.5 w-3.5" />,
        onAction: (ids) => {
          const toActivate = ids.filter(id => {
            const p = projects.find(proj => proj.id === id)
            return p && p.status === "archived"
          })
          for (const id of toActivate) updateProject(id, { status: "active" })
          if (toActivate.length > 0) {
            addToast({ type: "success", title: `${toActivate.length} project${toActivate.length > 1 ? "s" : ""} activated` })
          }
        },
      })
    }
    actions.push({
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: "destructive",
      onAction: (ids) => { for (const id of ids) deleteProject(id) },
    })
    return actions
  }, [deleteProject, updateProject, projects, addToast])

  // Task counts per project (live from plan nodes, same logic as sidebar)
  const projectTaskCounts = useMemo(() => {
    const counts: Record<string, { total: number; completed: number; inProgress: number }> = {}
    for (const p of projects) {
      const nodes = allNodes.filter((n) => n.projectId === p.id && n.type !== "milestone")
      counts[p.id] = {
        total: nodes.length,
        completed: nodes.filter((n) => n.status === "completed" || n.status === "auto_verified").length,
        inProgress: nodes.filter((n) => n.status === "in_progress" || n.status === "dispatched").length,
      }
    }
    return counts
  }, [projects, allNodes])

  // Live progress map derived from task counts
  const progressMap = useMemo(() => {
    const map: Record<string, number> = {}
    for (const [id, counts] of Object.entries(projectTaskCounts)) {
      map[id] = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0
    }
    return map
  }, [projectTaskCounts])

  // Sort projects
  const sortedProjects = useMemo(() => {
    let filtered = displaySettings.showCompleted
      ? projects
      : projects.filter((p) => (progressMap[p.id] ?? 0) < 100)
    if (statusFilter === "all" && !(displaySettings.showArchived ?? true)) {
      filtered = filtered.filter((p) => p.status !== "archived")
    }
    if (statusFilter !== "all") {
      filtered = filtered.filter((p) => p.status === statusFilter)
    }
    if (healthFilter !== "all") {
      filtered = filtered.filter((p) => p.health === healthFilter)
    }
    if (initiativeFilter !== "all") {
      filtered = filtered.filter((p) => p.initiativeId === initiativeFilter)
    }
    if (workspaceFilter !== "all") {
      filtered = filtered.filter((p) => p.teamId === workspaceFilter)
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
        case "workingDirectory":
          return dir * (a.workingDirectory ?? "").localeCompare(b.workingDirectory ?? "")
        default:
          return 0
      }
    })
    return sorted
  }, [projects, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted, displaySettings.showArchived, statusFilter, healthFilter, initiativeFilter, workspaceFilter, progressMap])

  // Group projects for list view
  const listGroups = useMemo((): ListGroup<Project>[] => {
    if (displaySettings.groupBy === "none") {
      return [{ key: "all", label: "All Projects", items: sortedProjects }]
    }
    const includeArchivedGroup = statusFilter === "archived" || (displaySettings.showArchived ?? true)
    // Pre-seed status groups so both Active and Archived always appear
    const seed: Record<string, Project[]> = displaySettings.groupBy === "status"
      ? includeArchivedGroup
        ? { Active: [], Archived: [] }
        : { Active: [] }
      : {}
    const grouped = sortedProjects.reduce<Record<string, Project[]>>((acc, p) => {
      let group: string
      switch (displaySettings.groupBy) {
        case "initiative":
          group = getInitiativeName(p.initiativeId) ?? "Other"
          break
        case "status":
          group = p.status === "active" ? "Active" : "Archived"
          break
        case "health":
          group = healthConfig[p.health ?? "on_track"]?.label ?? "On track"
          break
        case "team":
          group = getTeamName(p.teamId) ?? "Unknown"
          break
        default:
          group = "All Projects"
      }
      ;(acc[group] ??= []).push(p)
      return acc
    }, seed)
    const groups = Object.entries(grouped).map(([label, items]) => {
      const Icon = displaySettings.groupBy === "initiative" ? (initiativeIcons[label] ?? Users)
        : displaySettings.groupBy === "team" ? Building2
        : Folder
      const iconColor = displaySettings.groupBy === "initiative" ? (initiativeIconColors[label] ?? "text-success") : "text-muted-foreground"
      return {
        key: label,
        label,
        icon: <Icon className={`h-4 w-4 ${iconColor}`} />,
        items,
        defaultCollapsed: label === "Archived",
      }
    })
    // When grouped by status, sort Active before Archived
    if (displaySettings.groupBy === "status") {
      const statusOrder: Record<string, number> = { Active: 0, Archived: 1 }
      groups.sort((a, b) => (statusOrder[a.label] ?? 99) - (statusOrder[b.label] ?? 99))
    }
    return groups
  }, [sortedProjects, displaySettings.groupBy, displaySettings.showArchived, getInitiativeName, getTeamName, statusFilter])

  // Timeline-specific settings
  const timelineDisplaySettings = useDisplaySettingsStore((s) => s.get("projects-timeline"))

  // Derive date ranges for projects that lack explicit startDate/targetDate
  // by looking at their plan nodes' startDate/endDate
  const projectDateRanges = useMemo(() => {
    const ranges: Record<string, { startDate: string; targetDate: string }> = {}
    for (const p of projects) {
      if (isValidDateStr(p.startDate) && isValidDateStr(p.targetDate)) {
        ranges[p.id] = { startDate: p.startDate, targetDate: p.targetDate }
        continue
      }
      // Derive from plan nodes
      const projectNodes = allNodes.filter((n) => n.projectId === p.id)
      let minDate: string | undefined
      let maxDate: string | undefined
      for (const n of projectNodes) {
        if (isValidDateStr(n.startDate) && (!minDate || n.startDate < minDate)) minDate = n.startDate
        if (isValidDateStr(n.endDate) && (!maxDate || n.endDate > maxDate)) maxDate = n.endDate
        if (isValidDateStr(n.dueDate) && (!maxDate || n.dueDate > maxDate)) maxDate = n.dueDate
      }
      const today = fmtDate(new Date())
      ranges[p.id] = {
        startDate: p.startDate ?? minDate ?? today,
        targetDate: p.targetDate ?? maxDate ?? fmtDate(addDays(new Date(), 30)),
      }
    }
    return ranges
  }, [projects, allNodes])

  // Sort projects for timeline (uses timeline display settings)
  const timelineSortedProjects = useMemo(() => {
    let filtered = timelineDisplaySettings.showCompleted
      ? projects
      : projects.filter((p) => (progressMap[p.id] ?? 0) < 100)
    if (!(timelineDisplaySettings.showArchived ?? true)) {
      filtered = filtered.filter((p) => p.status !== "archived")
    }
    if (workspaceFilter !== "all") {
      filtered = filtered.filter((p) => p.teamId === workspaceFilter)
    }
    const sorted = [...filtered]
    const dir = timelineDisplaySettings.orderDirection === "asc" ? 1 : -1
    sorted.sort((a, b) => {
      switch (timelineDisplaySettings.orderBy) {
        case "name":
          return dir * a.name.localeCompare(b.name)
        case "targetDate": {
          const da = projectDateRanges[a.id]?.targetDate ?? ""
          const db = projectDateRanges[b.id]?.targetDate ?? ""
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
  }, [projects, projectDateRanges, timelineDisplaySettings.orderBy, timelineDisplaySettings.orderDirection, timelineDisplaySettings.showCompleted, timelineDisplaySettings.showArchived, workspaceFilter, progressMap])

  // Timeline rows (with grouping support)
  const timelineRows = useMemo((): TimelineRow<Project>[] => {
    const makeItemRow = (p: Project): TimelineRow<Project> => {
      const { bg, progress } = getProjectBarColors(p, progressMap)
      const pct = progressMap[p.id] ?? 0
      const dates = projectDateRanges[p.id]
      return {
        kind: "item" as const,
        item: p,
        timeline: {
          id: p.id,
          startDate: dates?.startDate ?? "",
          endDate: dates?.targetDate ?? "",
          barClass: bg,
          progressClass: progress || undefined,
          progressPct: pct,
          label: p.name,
        },
      }
    }

    if (timelineDisplaySettings.groupBy === "none") {
      return timelineSortedProjects.map(makeItemRow)
    }

    // Group projects
    const grouped: Record<string, Project[]> = {}
    for (const p of timelineSortedProjects) {
      let group: string
      switch (timelineDisplaySettings.groupBy) {
        case "initiative":
          group = getInitiativeName(p.initiativeId) ?? "Other"
          break
        case "status":
          group = p.status === "active" ? "Active" : "Archived"
          break
        case "health":
          group = healthConfig[p.health ?? "on_track"]?.label ?? "On track"
          break
        case "team":
          group = getTeamName(p.teamId) ?? "Unknown"
          break
        default:
          group = "All Projects"
      }
      ;(grouped[group] ??= []).push(p)
    }

    const result: TimelineRow<Project>[] = []
    for (const [label, items] of Object.entries(grouped)) {
      result.push({ kind: "header", label, count: items.length })
      for (const p of items) {
        result.push(makeItemRow(p))
      }
    }
    return result
  }, [timelineSortedProjects, projectDateRanges, timelineDisplaySettings.groupBy, getInitiativeName, getTeamName, progressMap])

  const handleSort = useCallback((sortKey: string) => {
    if (displaySettings.orderBy === sortKey) {
      updateDisplaySettings("projects", {
        orderDirection: displaySettings.orderDirection === "asc" ? "desc" : "asc",
      })
    } else {
      updateDisplaySettings("projects", { orderBy: sortKey, orderDirection: "asc" })
    }
  }, [displaySettings.orderBy, displaySettings.orderDirection, updateDisplaySettings])

  const handleProjectRename = useCallback(async (projectId: string, newName: string) => {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return

    const oldName = project.name

    try {
      // Optimistic update
      updateProject(projectId, { name: newName })
      setRenamingProjectId(null)

      // Verify server sync (only in server mode)
      if (isServerMode()) {
        addToast({
          type: "success",
          title: "Project renamed",
          description: `"${oldName}" → "${newName}"`,
        })
      }
    } catch (error) {
      // Revert on error
      updateProject(projectId, { name: oldName })
      addToast({
        type: "error",
        title: "Rename failed",
        description: "Could not rename project. Please try again.",
      })
      console.error("Project rename error:", error)
    }
  }, [projects, updateProject, setRenamingProjectId, addToast])

  const validateProjectName = useCallback((name: string): string | null => {
    if (!name.trim()) {
      return "Project name cannot be empty"
    }
    if (name.length > 100) {
      return "Project name is too long (max 100 characters)"
    }
    // Check for duplicates (excluding current project)
    const isDuplicate = projects.some(
      (p) => p.id !== renamingProjectId && p.name.toLowerCase() === name.toLowerCase()
    )
    if (isDuplicate) {
      return "A project with this name already exists"
    }
    return null
  }, [projects, renamingProjectId])

  const viewAsOptions = [
    { value: "all", label: "List" },
    { value: "timeline", label: "Timeline" },
    { value: "board", label: "Board" },
  ]

  const handleTeamChange = useCallback((projectId: string, teamId: string) => {
    updateProject(projectId, { teamId })
  }, [updateProject])

  const projectColumns = useMemo(
    () => getProjectColumns(renamingProjectId, setRenamingProjectId, handleProjectRename, validateProjectName, progressMap, teams, handleTeamChange, fastEditSetting),
    [renamingProjectId, validateProjectName, handleProjectRename, setRenamingProjectId, progressMap, teams, handleTeamChange, fastEditSetting]
  )

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-primary font-semibold">{t('title')}</h1>
          </div>
          <div className="flex items-center gap-3">
            {githubConnected ? (
              <div className="flex items-center rounded-md border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm hover:bg-muted/50 transition-colors cursor-pointer"
                  title="Import from JSON"
                >
                  <Braces className="h-3.5 w-3.5" />
                </button>
                <div className="w-px h-5 bg-border" />
                <button
                  type="button"
                  onClick={() => setGithubPickerOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm hover:bg-muted/50 transition-colors cursor-pointer"
                  title="Import from GitHub"
                >
                  <Github className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Import</span>
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.astro.json"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button
              variant={fastEditSetting ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5 h-7 px-2"
              onClick={() => toggleFastEdit()}
            >
              <Pencil className={cn("h-3.5 w-3.5", fastEditSetting && "text-primary")} />
              <span className="hidden md:inline">Fast Edit</span>
            </Button>
            <DisplayPopover config={{
              ...(viewTab === "timeline" ? projectsTimelineDisplayConfig : projectsDisplayConfig),
              viewAsOptions,
              activeViewAs: viewTab,
              onViewAsChange: (v) => setViewTab(v as ViewTab),
            }} />
          </div>
        </div>

        {/* Import Preview Dialog */}
        <ImportPreviewDialog
          open={!!importBundle}
          onOpenChange={(open) => { if (!open) setImportBundle(null) }}
          bundle={importBundle}
        />

        {/* GitHub Repo Picker */}
        <GitHubRepoPickerDialog
          open={githubPickerOpen}
          onOpenChange={setGithubPickerOpen}
        />

        {/* Keyboard help tip */}
        {showHelpTip && (
          <div className="flex items-center gap-2 px-3 md:px-6 py-1.5 bg-primary/5 border-b border-primary/10 text-xs text-muted-foreground">
            <span>
              Press <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">I</kbd> to toggle fast edit,{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">Enter</kbd> to confirm,{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">Esc</kbd> to exit.{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">1</kbd>{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">2</kbd>{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[11px]">3</kbd> to switch views
            </span>
            <button
              type="button"
              onClick={dismissHelpTip}
              className="ml-auto text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Filter Bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 sm:px-6 py-3 shrink-0 relative z-10">
          <div className="flex items-center gap-2 shrink-0">
            <ListFilter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground hidden sm:inline">Filter</span>
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
            <FilterSelect
              label="Initiative"
              value={initiativeFilter}
              options={[
                { value: "all", label: "All initiatives" },
                ...initiatives.map((i) => ({ value: i.id, label: i.name })),
              ]}
              onChange={setInitiativeFilter}
            />
          </div>
        </div>

        {viewTab === "all" && (
          sortedProjects.length === 0 ? (
            <div className="flex-1 overflow-auto flex flex-col">
              <div className="flex items-center gap-2.5 px-4 sm:px-6 py-3 sm:py-2.5 border-b border-border hover:bg-muted/30 transition-colors">
                <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                  ref={createInputRef}
                  type="text"
                  placeholder="Add project... (Enter to create)"
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  enterKeyHint="done"
                  autoCapitalize="sentences"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleInlineCreate((e.target as HTMLInputElement).value)
                    }
                  }}
                  onBlur={(e) => {
                    const val = e.target.value.trim()
                    if (val) handleInlineCreate(val)
                  }}
                />
              </div>
              <div className="flex-1 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => navigate("/projects")}
                  className="flex items-center gap-4 w-full max-w-lg rounded-xl bg-muted/50 border border-border px-6 py-5 hover:bg-muted/80 hover:border-primary/30 transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10 shrink-0">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold">Generate with AI</div>
                    <div className="text-xs text-muted-foreground">Describe your goal and let AI create a plan</div>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <ItemListView
              columns={projectColumns}
              groups={listGroups}
              visibleColumns={displaySettings.visibleProperties}
              onItemClick={(p) => {
                if (fastEditSetting) {
                  setRenamingProjectId(p.id)
                } else {
                  navigate(`/project/${p.id}`)
                }
              }}
              getItemId={(p) => p.id}
              batchActions={getProjectBatchActions}
              sortColumn={displaySettings.orderBy}
              sortDirection={displaySettings.orderDirection}
              onSort={handleSort}
              footer={() => creating ? (
                <div className="flex items-center gap-2.5 px-4 sm:px-6 py-3 sm:py-2.5 border-b border-border hover:bg-muted/30 transition-colors">
                  <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <input
                    ref={createInputRef}
                    type="text"
                    placeholder="Project name... (Enter to create, Esc to cancel)"
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    enterKeyHint="done"
                    autoCapitalize="sentences"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        handleInlineCreate((e.target as HTMLInputElement).value)
                      }
                      if (e.key === "Escape") {
                        e.preventDefault()
                        setCreating(false)
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.trim()
                      if (val) handleInlineCreate(val)
                      else setCreating(false)
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex items-center gap-2.5 px-4 sm:px-6 min-h-[44px] sm:min-h-0 sm:h-9 w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors cursor-pointer border-b border-border"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add project</span>
                </button>
              )}
              renderMobileItem={(p) => {
                const health = healthConfig[p.health ?? "on_track"]
                const counts = projectTaskCounts[p.id]
                const pct = progressMap[p.id] ?? 0
                return (
                  <button
                    onClick={() => navigate(`/project/${p.id}`)}
                    className="w-full flex items-center gap-3.5 rounded-2xl bg-card p-4 transition-all shadow-sm hover:shadow-md border border-border text-left"
                  >
                    <ColorIconBadge color={p.color} icon={p.icon} type="project" />
                    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-base truncate">{p.name}</h3>
                        {(p.projectType === "github" || p.repository) && (
                          <Github className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className={cn("flex items-center gap-1", health.textClass)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", health.dotClass)} />
                          {health.label}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span>{counts?.total ?? 0} tasks</span>
                        <span className="text-muted-foreground/40">·</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            pct >= 95 ? "bg-success" : pct > 0 ? "bg-primary" : ""
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
          )
        )}

        {viewTab === "timeline" && (
          timelineRows.length > 0 ? (
            <ItemTimelineView
              rows={timelineRows}
              viewKey="projects-timeline"
              leftHeader="Projects"
              rowHeight={64}
              renderLeftCell={(proj) => {
                const counts = projectTaskCounts[proj.id]
                const pct = progressMap[proj.id] ?? 0
                const statusLabel =
                  pct >= 95
                    ? "completed"
                    : (counts?.inProgress ?? 0) > 0
                      ? `${counts.inProgress} in progress`
                      : pct === 0
                        ? "not started"
                        : `${pct}% done`
                return (
                  <Link
                    to={`/project/${proj.id}`}
                    className="flex items-center gap-3 w-full hover:bg-muted/30 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ColorIconBadge
                      color={proj.color}
                      icon={proj.icon}
                      type="project"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{proj.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {counts?.total ?? 0} tasks &middot; {statusLabel}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="h-1.5 w-12 rounded-full bg-border overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </Link>
                )
              }}
              onItemClick={(proj) => navigate(`/project/${proj.id}`)}
              onDateChange={(id, startDate, endDate) => updateProject(id, { startDate, targetDate: endDate })}
            />
          ) : (
            <div className="flex-1 overflow-auto">
              <EmptyState
                icon={Folder}
                title="No projects to display"
                description="Create a project to see it on the timeline."
                action={{ label: "Create Project", href: "/projects" }}
                className="h-full"
              />
            </div>
          )
        )}

        {viewTab === "board" && (
          <div className="flex flex-1 overflow-x-auto p-4 gap-4">
            {projects.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={Folder}
                  title="What are you working on?"
                  description="Create your first project and let AI help you break it down into a structured plan."
                  action={{
                    label: "Create Project",
                    href: "/projects",
                  }}
                />
              </div>
            ) : (
              (() => {
                const boardColumns: { key: string; label: string; dotClass: string; projects: Project[] }[] = [
                  { key: "on_track", label: "On track", dotClass: "bg-success", projects: [] },
                  { key: "at_risk", label: "At risk", dotClass: "bg-warning", projects: [] },
                  { key: "off_track", label: "Off track", dotClass: "bg-error", projects: [] },
                ]
                for (const p of sortedProjects) {
                  const h = p.health ?? "on_track"
                  const col = boardColumns.find((c) => c.key === h)
                  if (col) col.projects.push(p)
                }
                return boardColumns.map((col) => (
                  <div key={col.key} className="flex w-[300px] shrink-0 flex-col rounded-lg bg-muted/40">
                    <div className="flex items-center gap-2 px-3 py-3">
                      <span className={cn("h-2.5 w-2.5 rounded-full", col.dotClass)} />
                      <span className="text-sm font-medium">{col.label}</span>
                      <span className="text-xs text-muted-foreground">{col.projects.length}</span>
                    </div>
                    <div className="flex flex-col gap-2 px-2 pb-2 overflow-y-auto">
                      {col.projects.map((project) => {
                        const counts = projectTaskCounts[project.id]
                        const pct = progressMap[project.id] ?? 0
                        return (
                          <Link
                            key={project.id}
                            to={`/project/${project.id}`}
                            className="rounded-lg border border-border bg-card p-3 hover:border-primary/40 hover:shadow-sm transition-all"
                          >
                            <div className="flex items-start gap-2 mb-2">
                              <ColorIconBadge
                                color={project.color}
                                icon={project.icon}
                                type="project"
                              />
                              <span className="text-sm font-medium leading-snug">{project.name}</span>
                            </div>
                            <div className="mb-2">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] text-muted-foreground">{pct}% complete</span>
                                <span className="text-[11px] text-muted-foreground">
                                  {counts?.completed ?? 0}/{counts?.total ?? 0} tasks
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    pct >= 95 ? "bg-success" : pct > 0 ? "bg-primary" : ""
                                  )}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                              {getInitiativeName(project.initiativeId) && (
                                <span className="truncate">{getInitiativeName(project.initiativeId)}</span>
                              )}
                              {project.targetDate && (
                                <span className={cn(
                                  "shrink-0",
                                  isOverdue(project.targetDate, pct >= 100 ? "completed" : "planned")
                                    ? "text-error"
                                    : ""
                                )}>
                                  {formatShortDate(project.targetDate)}
                                </span>
                              )}
                            </div>
                          </Link>
                        )
                      })}
                      {col.projects.length === 0 && (
                        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                          No projects
                        </div>
                      )}
                    </div>
                  </div>
                ))
              })()
            )}
          </div>
        )}

        {/* Mobile FAB for project creation */}
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="fixed bottom-6 right-6 z-50 flex sm:hidden items-center justify-center h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 transition-transform"
          aria-label="Create project"
        >
          <Plus className="h-6 w-6" />
        </button>
    </div>
  )
}
