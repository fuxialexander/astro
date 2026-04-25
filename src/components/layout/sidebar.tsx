import { useEffect, useMemo, useCallback, useState, useRef } from "react"
import { useTranslation } from "react-i18next"
import { NavLink, useNavigate, useParams, useLocation } from "react-router"
import {
  Inbox, Activity, Settings, Server, FlaskConical, Folder,
  LogOut, PanelLeftClose, PanelLeft, AlertCircle, Loader2, User,
  Cpu, Zap, Sun, Moon, CheckSquare, GitBranch, Github, Terminal,
  Radio, Target, Plus, Minus, GripVertical, BookOpen, Palette,
  Globe, FileText, Layers, Box, Wrench, Code, Sparkles, X, LayoutTemplate,
  Pin, PinOff, ChevronRight, Search, ChevronsDownUp, ChevronsUpDown, Trash2, Lightbulb, Calendar, CalendarDays,
} from "lucide-react"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { getFaIcon } from "@/lib/color-icon-utils"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { useSettingsStore, getEffortOptions, EFFORT_LABELS } from "@/stores/settings-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useAuthStore } from "@/stores/auth-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useUIStore } from "@/stores/ui-store"
import { useSidebarStore } from "@/stores/sidebar-store"
import { useTeamStore } from "@/stores/team-store"
import { useExecutionStore, getNodeIdForProject } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useSessionStore } from "@/stores/session-store"
import { useWorkspaceFilterStore } from "@/stores/workspace-filter-store"
import { useInitiativeStore } from "@/stores/initiative-store"
import { useAutoReveal } from "@/hooks/use-auto-reveal"
import { isServerMode } from "@/lib/app-mode"
import { useIsHipaaMode } from "@/hooks/use-hipaa-mode"
import { isDesktop } from "@/lib/desktop-detect"
import { deriveActiveTasks } from "@/lib/active-tasks"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import { ColorIconBadge } from "@/components/color-icon-picker"
import type { Project } from "@/types"

function PieProgress({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(100, progress)) / 100
  const r = 5.5
  const cx = 7
  const cy = 7
  if (pct >= 1) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} className="fill-primary opacity-80" />
      </svg>
    )
  }
  if (pct <= 0) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" className="stroke-muted-foreground/25" strokeWidth="1.5" />
      </svg>
    )
  }
  const angle = 2 * Math.PI * pct
  const endX = cx + r * Math.sin(angle)
  const endY = cy - r * Math.cos(angle)
  const largeArcFlag = pct > 0.5 ? 1 : 0
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" className="stroke-muted-foreground/20" strokeWidth="1" />
      <path
        d={`M ${cx},${cy} L ${cx},${cy - r} A ${r},${r} 0 ${largeArcFlag},1 ${endX.toFixed(3)},${endY.toFixed(3)} Z`}
        className="fill-primary opacity-80"
      />
    </svg>
  )
}

const iconMap: Record<string, typeof CheckSquare> = {
  CheckSquare, GitBranch, Github, Terminal, Radio, Target, Cpu,
  BookOpen, Palette, Zap, Globe, FileText, Layers, Box, Wrench,
  Code, Sparkles, FlaskConical, LayoutTemplate, Inbox, Activity,
  Folder, Server, Plus, Minus, Calendar, CalendarDays,
}

const EMPTY_FLAGS: Record<string, boolean> = {}

const projectColors = [
  "#5B7F9A", "#7B9B7D", "#C09070", "#8B7BAD",
  "#B07B8B", "#BDA26B", "#7B97AD", "#A08B7B",
]

/* ─── Generic sortable wrapper ─── */
function SortableItem({ id, children, gripMode = "hover", groupClass }: { id: string; children: React.ReactNode; gripMode?: "hover" | "whole"; groupClass?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(gripMode === "whole" ? listeners : {})}
      className={cn("relative", groupClass, isDragging && "opacity-50 z-50", gripMode === "whole" && "cursor-grab")}
    >
      {gripMode === "hover" && (
        <div className="absolute left-0 top-0 bottom-0 flex items-center opacity-0 group-hover/sortable:opacity-100 transition-opacity cursor-grab" {...listeners}>
          <GripVertical className="h-3 w-3 text-muted-foreground/40" />
        </div>
      )}
      {children}
    </div>
  )
}


export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { t, i18n } = useTranslation("nav")
  const navigate = useNavigate()
  const params = useParams()
  const location = useLocation()

  const connectionStatus = useSettingsStore((s) => s.connectionStatus)
  const profile = useUserProfileStore((s) => s.profile)
  const authUser = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const projects = useProjectStore((s) => s.projects)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const projectsLoaded = useProjectStore((s) => s.loaded)
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const nodesLoaded = usePlanStore((s) => s.loaded)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const sidebarItems = useSidebarStore((s) => s.items)
  const teamFeatureFlags = useTeamStore((s) => s.teams[0]?.featureFlags) ?? EMPTY_FLAGS
  const isEditing = useSidebarStore((s) => s.isEditing)
  const setEditing = useSidebarStore((s) => s.setEditing)
  const toggleItemVisibility = useSidebarStore((s) => s.toggleItemVisibility)
  const reorderItems = useSidebarStore((s) => s.reorderItems)
  const pinnedItems = useSidebarStore((s) => s.pinnedItems)
  const pinItem = useSidebarStore((s) => s.pinItem)
  const unpinItem = useSidebarStore((s) => s.unpinItem)
  const reorderPinnedItems = useSidebarStore((s) => s.reorderPinnedItems)
  const collapsedInitiatives = useSidebarStore((s) => s.collapsedInitiatives)
  const toggleInitiativeCollapse = useSidebarStore((s) => s.toggleInitiativeCollapse)
  const setAllInitiativesCollapsed = useSidebarStore((s) => s.setAllInitiativesCollapsed)
  const subscribeToChanges = useSidebarStore((s) => s.subscribeToChanges)
  const dismissAutoReveal = useSidebarStore((s) => s.dismissAutoReveal)
  const autoCollapse = useSidebarStore((s) => s.autoCollapse)
  const setAutoCollapse = useSidebarStore((s) => s.setAutoCollapse)
  const executions = useExecutionStore((s) => s.executions)
  const batchExecutions = useExecutionStore((s) => s.batchExecutions)
  const streamingSessions = useSessionStore((s) => s.streamingSessions)
  const allSessions = useSessionStore((s) => s.sessions)
  const workspaceFilter = useWorkspaceFilterStore((s) => s.workspaceFilter)
  const dynamicApprovals = useRealtimeStore((s) => s.dynamicApprovals)
  const initiatives = useInitiativeStore((s) => s.initiatives)
  const { theme, setTheme } = useTheme()
  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  const modelTier = useSettingsStore((s) => s.modelTier)
  const setModelTier = useSettingsStore((s) => s.setModelTier)
  const modelEffort = useSettingsStore((s) => s.modelEffort)
  const setModelEffort = useSettingsStore((s) => s.setModelEffort)
  const defaultProvider = useSettingsStore((s) => s.defaultProvider)
  const yoloMode = useSettingsStore((s) => s.yoloMode)
  const setYoloMode = useSettingsStore((s) => s.setYoloMode)
  const [effortPopoverTier, setEffortPopoverTier] = useState<string | null>(null)
  const effortPopoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [navHovered, setNavHovered] = useState(false)
  const showAuth = isServerMode()
  const isHipaa = useIsHipaaMode()
  const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0
  const activeProjectId = params.id

  // Auto-reveal sidebar items based on usage thresholds
  useAutoReveal()

  const openEffortPopover = useCallback((tier: string) => {
    if (effortPopoverTimer.current) clearTimeout(effortPopoverTimer.current)
    setEffortPopoverTier(tier)
  }, [])

  const closeEffortPopover = useCallback(() => {
    effortPopoverTimer.current = setTimeout(() => setEffortPopoverTier(null), 120)
  }, [])

  const effectiveProvider = defaultProvider || "claude-sdk"

  useEffect(() => {
    const unsubscribe = subscribeToChanges()
    return () => unsubscribe()
  }, [subscribeToChanges])

  // Items available for editing (respects feature flags + auth gates)
  const editableItems = sidebarItems.filter((item) => {
    if (item.id === 'community' && !showAuth) return false
    if (item.featureFlag && !teamFeatureFlags[item.featureFlag]) return false
    if (isHipaa && item.disableInHipaa) return false
    return true
  })

  const visibleItems = editableItems.filter((item) => item.visible)

  // ⌘/Ctrl+1-9 navigate to visible page items in order
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(isMac ? e.metaKey : e.ctrlKey)) return
      const idx = parseInt(e.key, 10) - 1
      if (isNaN(idx) || idx < 0 || idx >= visibleItems.length) return
      e.preventDefault()
      navigate(visibleItems[idx].to)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visibleItems, navigate, isMac])

  const pinnedIds = useMemo(() => new Set(pinnedItems.map((p) => p.id)), [pinnedItems])

  // DnD sensors for @dnd-kit
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleNavDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const items = isEditing ? editableItems : visibleItems
    const oldIndex = items.findIndex((i) => i.id === active.id)
    const newIndex = items.findIndex((i) => i.id === over.id)
    if (oldIndex !== -1 && newIndex !== -1) {
      reorderItems(oldIndex, newIndex)
    }
  }, [isEditing, editableItems, visibleItems, reorderItems])

  const handlePinnedDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = pinnedItems.findIndex((p) => p.id === active.id)
    const newIndex = pinnedItems.findIndex((p) => p.id === over.id)
    if (oldIndex !== -1 && newIndex !== -1) {
      reorderPinnedItems(oldIndex, newIndex)
    }
  }, [pinnedItems, reorderPinnedItems])


  const getItemLabel = (item: { id: string; label: string }): string => {
    return t(item.id === "active" ? "active" : item.id, { defaultValue: item.label })
  }

  const { activeCount, projectsWithRunning } = useMemo(() => (
    deriveActiveTasks({
      executions, batchExecutions, rawNodes: rawPlanNodes, liveNodes: planNodes,
      nodesLoaded, projects, projectsLoaded, streamingSessions, allSessions, workspaceFilter,
    })
  ), [executions, batchExecutions, rawPlanNodes, planNodes, nodesLoaded, projects, projectsLoaded, streamingSessions, allSessions, workspaceFilter])

  const inboxCount = useMemo(() => {
    const pending = planNodes.filter(
      (n) => n.status === "awaiting_judgment" || n.status === "awaiting_approval"
    ).length
    return pending + dynamicApprovals.size
  }, [planNodes, dynamicApprovals])

  const navigateToProject = useCallback((projectId: string) => {
    const nodeId = getNodeIdForProject(projectId, executions)
    const exec = nodeId ? executions.get(nodeId) : undefined
    const isGenerating = exec?.status === "running" || exec?.status === "pending"
    if (isGenerating && nodeId?.startsWith('session-')) {
      navigate(`/playground?projectId=${projectId}`)
    } else if (isGenerating && nodeId?.startsWith('plan-')) {
      navigate(`/project/${projectId}`)
    } else if (isGenerating && nodeId?.startsWith('playground-')) {
      navigate(`/playground?projectId=${projectId}`)
    } else {
      navigate(`/project/${projectId}`)
    }
  }, [executions, navigate])

  const getInitials = (s: string) => {
    if (!s) return "U"
    if (s.includes("@")) {
      const u = s.split("@")[0]
      const p = u.split(/[._-]/)
      return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : u.slice(0, 2).toUpperCase()
    }
    const p = s.trim().split(/\s+/)
    return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : s.slice(0, 2).toUpperCase()
  }

  const getDisplayName = (s: string) => {
    if (!s) return "User"
    if (s.includes("@")) {
      return s.split("@")[0].split(/[._-]/)
        .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ")
    }
    return s
  }

  // Categorization: SESSION only if projectType === 'playground' AND no plan nodes.
  // Manually-created projects (projectType 'default') stay in PROJECTS even before
  // plan generation populates nodes.
  const { activeProjects, recentSessions } = useMemo(() => {
    const projectIdsWithNodes = new Set<string>()
    for (const node of planNodes) projectIdsWithNodes.add(node.projectId)
    const withNodes: typeof projects = []
    const recent: typeof projects = []
    for (const p of projects) {
      if (p.status !== "active") continue
      if (pinnedIds.has(p.id)) continue // Pinned items shown in pages section
      const hasNodes = projectIdsWithNodes.has(p.id)
      const isSession = !hasNodes && p.projectType === "playground"
      if (isSession) recent.push(p)
      else withNodes.push(p)
    }
    withNodes.sort((a, b) => a.name.localeCompare(b.name))
    recent.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return { activeProjects: withNodes, recentSessions: recent.slice(0, 5) }
  }, [projects, planNodes, pinnedIds])

  // Group projects by initiative (order within groups preserved from activeProjects sort)
  const { initiativeGroups, ungroupedProjects } = useMemo(() => {
    const activeInitiatives = initiatives.filter((i) => i.status === "active")
    if (!activeInitiatives.length) return { initiativeGroups: [], ungroupedProjects: activeProjects }
    const groups = new Map<string, { initiative: typeof activeInitiatives[0]; projects: Project[] }>()
    const ungrouped: Project[] = []
    for (const p of activeProjects) {
      if (p.initiativeId) {
        const init = activeInitiatives.find((i) => i.id === p.initiativeId)
        if (init) {
          if (!groups.has(init.id)) groups.set(init.id, { initiative: init, projects: [] })
          groups.get(init.id)!.projects.push(p)
          continue
        }
      }
      ungrouped.push(p)
    }
    return { initiativeGroups: Array.from(groups.values()), ungroupedProjects: ungrouped }
  }, [activeProjects, initiatives])

  const getProjectColor = (i: number) => projectColors[i % projectColors.length]

  const calculateProgress = (projectId: string) => {
    const tasks = planNodes.filter(n => n.projectId === projectId && n.type !== "milestone")
    if (!tasks.length) return 0
    const done = tasks.filter(n => n.status === "completed" || n.status === "auto_verified")
    return Math.round((done.length / tasks.length) * 100)
  }

  const handleSignOut = async () => {
    await signOut()
    navigate("/login")
  }

  const getBadge = (id: string) => {
    if (id === "dashboard" && inboxCount > 0) return { count: inboxCount, variant: "warning" as const }
    if (id === "active" && activeCount > 0) return { count: activeCount, variant: "info" as const }
    return null
  }

  // Resolve pinned items to actual project/session data
  const resolvedPinnedItems = useMemo(() => {
    return pinnedItems
      .map((pin) => {
        const project = projects.find((p) => p.id === pin.id)
        if (!project) return null
        return { ...pin, project }
      })
      .filter(Boolean) as Array<{ id: string; type: 'project' | 'session'; project: Project }>
  }, [pinnedItems, projects])

  /* ─── Render a project row (shared between sections) ─── */
  function renderProjectRow(project: Project, index: number, isPinned: boolean) {
    const isActive = activeProjectId === project.id
    const progress = calculateProgress(project.id)
    const color = getProjectColor(index)

    const projectIcon = (() => {
      if (!project.icon) return null
      const FaIcon = getFaIcon(project.icon)
      if (FaIcon) return <FaIcon size={collapsed ? 18 : 16} style={{ color: project.color || color }} className="shrink-0" />
      return <span className="text-base leading-none shrink-0">{project.icon}</span>
    })()

    if (collapsed) {
      return (
        <div key={project.id} className="flex justify-center w-full">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigateToProject(project.id)}
                className={cn(
                  "flex items-center justify-center h-9 w-9 rounded-lg transition-colors relative",
                  isActive ? "bg-accent" : "hover:bg-muted/50"
                )}
              >
                {projectIcon}
                {projectsWithRunning.has(project.id) && (
                  <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center h-3 w-3">
                    <Loader2 className="h-3 w-3 text-info animate-spin" />
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{project.name}</TooltipContent>
          </Tooltip>
        </div>
      )
    }

    return (
      <div
        key={project.id}
        onClick={() => navigateToProject(project.id)}
        className={cn(
          "group/proj flex items-center gap-3 rounded-[10px] px-3.5 py-2 transition-colors cursor-pointer",
          isActive ? "bg-accent" : "hover:bg-muted/50"
        )}
      >
        {projectIcon}
        <span className={cn(
          "flex-1 text-[15px] truncate",
          isActive ? "text-accent-foreground font-semibold" : "text-muted-foreground font-medium"
        )}>
          {project.name.includes("/") ? project.name.split("/").slice(1).join("/") : project.name}
        </span>
        {/* Pin/unpin button on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (isPinned) { unpinItem(project.id) } else { pinItem(project.id, 'project') }
          }}
          className={cn(
            "shrink-0 p-0.5 rounded transition-colors",
            isPinned
              ? "text-muted-foreground/60 hover:text-destructive"
              : "opacity-0 group-hover/proj:opacity-100 text-muted-foreground/40 hover:text-muted-foreground"
          )}
        >
          {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        </button>
        {projectsWithRunning.has(project.id) ? (
          <Loader2 className="h-3.5 w-3.5 text-info animate-spin shrink-0" />
        ) : (
          <PieProgress progress={progress} />
        )}
      </div>
    )
  }

  /* Sidebar renders as a fixed floating rounded white card. Visibility is
   * controlled by the parent wrapper in app-layout (translate + opacity).
   * The `collapsed` prop is still accepted for API compatibility but the
   * inner content always renders in "expanded" mode — the user toggles the
   * sidebar via show/hide, not via an icon-rail state. */
  const desktopMode = isDesktop()
  // Show keyboard shortcut badges only in Electron or fullscreen/standalone web apps
  const showShortcuts = desktopMode || (
    typeof window !== 'undefined' && (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches
    )
  )
  const shouldCollapseNav = !collapsed && autoCollapse

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        "group/sidebar flex flex-col overflow-hidden h-full w-full",
        desktopMode
          ? cn(
              "rounded-xl text-sidebar-foreground",
              // Liquid glass: translucent fill + heavy blur + saturate boost
              "bg-white/55 dark:bg-white/[0.04]",
              "backdrop-blur-2xl backdrop-saturate-150",
              // Hairline ring (replaces solid border) + bright top sheen
              "ring-1 ring-inset ring-white/40 dark:ring-white/[0.06]",
              // Softer shadow — lighter than demo, just enough to lift the card
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_4px_20px_-10px_rgba(0,0,0,0.08)]",
              "dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_4px_20px_-10px_rgba(0,0,0,0.45)]",
            )
          : "border-r bg-card",
      )}
    >

      {/* ─── Header ─── desktop: workspace switcher; web: Astro branding + search. */}
      {desktopMode ? (
        <div className={cn(
          "flex shrink-0 items-center gap-1.5 px-2",
          collapsed ? "flex-col py-2" : "h-10 flex-row",
        )}>
          <WorkspaceSwitcher iconOnly={!collapsed} collapsed={collapsed} />
          {!collapsed && <div className="flex-1" />}
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => navigate("/onboarding")} className={cn("flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors", location.pathname === "/onboarding" && "text-primary bg-primary/10")}>
                <Lightbulb className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side={collapsed ? "right" : "bottom"}>Workflow guide</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button data-tour-id="search" onClick={() => setCommandPaletteOpen(true)} className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors">
                <Search className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side={collapsed ? "right" : "bottom"}>Search ({isMac ? "⌘" : "Ctrl+"}K)</TooltipContent>
          </Tooltip>
          {!collapsed && (
            <div
              className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                connectionStatus === "connected" ? "bg-success"
                  : connectionStatus === "checking" ? "bg-warning animate-pulse"
                  : "bg-destructive"
              )}
              title={`Connection: ${connectionStatus}`}
            />
          )}
        </div>
      ) : collapsed ? (
        <div className="flex flex-col items-center gap-1 py-2 border-b border-border/50">
          <div className="relative shrink-0">
            <img src="/icon-192.png" alt="Astro" className="h-7 w-7 rounded-[6px]" />
            <div className={cn(
              "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-white dark:border-card",
              connectionStatus === "connected" ? "bg-success"
                : connectionStatus === "checking" ? "bg-warning animate-pulse"
                : "bg-destructive"
            )} />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => navigate("/onboarding")} className={cn("flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors", location.pathname === "/onboarding" && "text-primary bg-primary/10")}>
                <Lightbulb className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Workflow guide</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button data-tour-id="search" onClick={() => setCommandPaletteOpen(true)} className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors">
                <Search className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Search ({isMac ? "⌘" : "Ctrl+"}K)</TooltipContent>
          </Tooltip>
          <WorkspaceSwitcher collapsed />
        </div>
      ) : (
        <div className="flex h-14 shrink-0 items-center gap-2 px-4 border-b border-border/50">
          <div className="relative shrink-0">
            <img src="/icon-192.png" alt="Astro" className="h-7 w-7 rounded-[6px]" />
            <div className={cn(
              "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-white dark:border-card",
              connectionStatus === "connected" ? "bg-success"
                : connectionStatus === "checking" ? "bg-warning animate-pulse"
                : "bg-destructive"
            )} />
          </div>
          <span className="font-secondary text-2xl font-bold text-foreground flex-1">
            {i18n.language.startsWith("zh") ? "Astro｜摘星" : "Astro"}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => navigate("/onboarding")} className={cn("flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors", location.pathname === "/onboarding" && "text-primary bg-primary/10")}>
                <Lightbulb className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Workflow guide</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button data-tour-id="search" onClick={() => setCommandPaletteOpen(true)} className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors">
                <Search className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Search ({isMac ? "⌘" : "Ctrl+"}K)</TooltipContent>
          </Tooltip>
          <WorkspaceSwitcher iconOnly />
        </div>
      )}

      {/* ─── Pages section (sticky, does NOT scroll) ─── */}
      {/* min-height reserves space for one nav item when overlay mode is active */}
      <div className="shrink-0" style={shouldCollapseNav && !collapsed ? { minHeight: '3.5rem' } : undefined}>
        {/* Hover zone: nav items + customize button collapse/expand together */}
        <div
          className={cn(shouldCollapseNav && !collapsed && "relative z-10 w-full")}
          onMouseEnter={() => !collapsed && setNavHovered(true)}
          onMouseLeave={() => setNavHovered(false)}
        >
          {!isEditing ? (
            <>
              {/* When shouldCollapseNav: nav is absolutely positioned so it overlays content below */}
              <nav
                className={cn(
                  "flex flex-col py-2",
                  collapsed ? "items-center" : "px-4",
                  shouldCollapseNav && !collapsed && cn(
                    "absolute top-0 left-0 right-0 w-full",
                    navHovered && cn(
                      "bg-white/55 dark:bg-white/[0.04] backdrop-blur-2xl backdrop-saturate-150",
                      "ring-1 ring-inset ring-white/40 dark:ring-white/[0.06]",
                      "rounded-b-[12px]",
                      "shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_8px_24px_-12px_rgba(0,0,0,0.18)]",
                      "dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_-12px_rgba(0,0,0,0.6)]",
                    ),
                  ),
                )}
              >
                {visibleItems.map((item, index) => {
                  const Icon = iconMap[item.icon] || CheckSquare
                  const badge = getBadge(item.id)
                  const isItemActive = location.pathname === item.to
                    || (item.id === "projects" && location.pathname.startsWith("/project/"))
                  const shortcutLabel = showShortcuts && index < 9 ? `${isMac ? '⌘' : '^'}${index + 1}` : null
                  const isVisible = shouldCollapseNav ? (isItemActive || navHovered) : true

                  if (collapsed) {
                    const active = isItemActive || location.pathname === item.to
                    return (
                      <div key={item.id} className="flex justify-center w-full mb-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => navigate(item.to)}
                              data-tour-id={item.id}
                              className={cn(
                                "flex items-center justify-center h-9 w-9 rounded-[10px] transition-colors",
                                active
                                  ? "bg-foreground/[0.08] dark:bg-foreground/[0.12] text-foreground"
                                  : "text-muted-foreground hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]",
                              )}
                            >
                              <Icon className="h-[18px] w-[18px] shrink-0" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {getItemLabel(item)}{shortcutLabel ? ` (${shortcutLabel})` : ''}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={item.id}
                      className="overflow-hidden"
                      style={{
                        maxHeight: isVisible ? '52px' : '0px',
                        marginBottom: isVisible ? '4px' : '0px',
                        opacity: isVisible ? 1 : 0,
                        transition: 'max-height 220ms cubic-bezier(0.4,0,0.2,1), margin-bottom 220ms cubic-bezier(0.4,0,0.2,1), opacity 180ms ease',
                      }}
                    >
                      <NavLink
                        to={item.to}
                        end
                        data-tour-id={item.id}
                        className={({ isActive }) => {
                          const active = isActive || isItemActive
                          return cn(
                            "group/navitem flex items-center rounded-[10px] text-[15px] font-medium transition-colors",
                            "gap-3 px-3.5 py-2.5 w-full",
                            active
                              ? "bg-foreground/[0.08] dark:bg-foreground/[0.12] text-foreground font-semibold"
                              : "text-muted-foreground hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]",
                          )
                        }}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" />
                        <span className="flex-1 truncate">{getItemLabel(item)}</span>
                        {badge && (
                          <span
                            className={cn(
                              "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold shrink-0",
                              badge.variant === "warning" ? "bg-warning/10 text-warning" : "bg-info/10 text-info",
                            )}
                          >
                            {badge.variant === "info" && (
                              <div className="relative h-1.5 w-1.5">
                                <div className="absolute inset-0 rounded-full border border-info border-t-transparent animate-spin" />
                              </div>
                            )}
                            {badge.variant === "warning" && <AlertCircle className="h-3 w-3" />}
                            {badge.count}
                          </span>
                        )}
                        {shortcutLabel && (
                          <span className="opacity-0 group-hover/navitem:opacity-100 transition-opacity text-[10px] text-muted-foreground/40 font-mono tabular-nums shrink-0 pr-0.5">
                            {shortcutLabel}
                          </span>
                        )}
                      </NavLink>
                    </div>
                  )
                })}

                {/* Customize button lives inside the nav when in overlay mode */}
                {shouldCollapseNav && !collapsed && (
                  <div
                    className="overflow-hidden"
                    style={{
                      maxHeight: navHovered ? '36px' : '0px',
                      opacity: navHovered ? 1 : 0,
                      transition: 'max-height 220ms cubic-bezier(0.4,0,0.2,1), opacity 180ms ease',
                    }}
                  >
                    <button
                      onClick={() => setEditing(true)}
                      className="px-3.5 py-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors whitespace-nowrap"
                    >
                      Customize sidebar...
                    </button>
                  </div>
                )}
              </nav>

              {/* Customize button in normal flow when not in overlay mode */}
              {!shouldCollapseNav && !collapsed && (
                <div
                  className="px-5 overflow-hidden"
                  style={{
                    maxHeight: navHovered ? '36px' : '0px',
                    opacity: navHovered ? 1 : 0,
                    transition: 'max-height 220ms cubic-bezier(0.4,0,0.2,1), opacity 180ms ease',
                  }}
                >
                  <button
                    onClick={() => setEditing(true)}
                    className="px-3.5 py-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors whitespace-nowrap"
                  >
                    Customize sidebar...
                  </button>
                </div>
              )}
            </>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={isEditing ? handleNavDragEnd : handlePinnedDragEnd}>
              <nav className="flex flex-col gap-1 py-2 px-4">
                <SortableContext items={(isEditing ? editableItems : visibleItems).map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  {(isEditing ? editableItems : visibleItems).map((item) => {
                    const Icon = iconMap[item.icon] || CheckSquare
                    const isHidden = !item.visible
                    const badge = getBadge(item.id)

                    if (isEditing) {
                      return (
                        <SortableItem key={item.id} id={item.id} gripMode="whole" groupClass={cn(isHidden && "opacity-40")}>
                          <div className={cn(
                            "flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[15px] font-medium bg-muted/30 border-2 border-dashed",
                            isHidden ? "border-muted-foreground/20" : "border-muted-foreground/40"
                          )}>
                            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground cursor-grab" />
                            <div className="h-5 w-5 shrink-0 flex items-center justify-center">
                              <Icon className="h-[18px] w-[18px]" />
                            </div>
                            <span className="flex-1 truncate">{getItemLabel(item)}</span>
                            {!item.protected ? (
                              <button
                                onClick={() => toggleItemVisibility(item.id)}
                                className={cn(
                                  "flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors",
                                  isHidden
                                    ? "text-muted-foreground hover:text-success hover:bg-success/10"
                                    : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                )}
                              >
                                {isHidden ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                              </button>
                            ) : (
                              <div className="w-5 shrink-0" />
                            )}
                          </div>
                        </SortableItem>
                      )
                    }

                    return (
                      <NavLink
                        key={item.id}
                        to={item.to}
                        end
                        data-tour-id={item.id}
                        className={({ isActive }) => {
                          const active = isActive || (item.id === "projects" && location.pathname.startsWith("/project/"))
                          return cn(
                            "flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-[15px] font-medium transition-colors",
                            active ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:bg-muted/50"
                          )
                        }}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="flex-1">{getItemLabel(item)}</span>
                        {item.autoRevealed && (
                          <>
                            <span className="text-[9px] font-semibold bg-info/10 text-info rounded-full px-1.5 py-0.5">New</span>
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismissAutoReveal(item.id) }}
                              className="p-0.5 rounded-sm hover:bg-muted/80 transition-colors"
                            >
                              <X className="h-3 w-3 text-muted-foreground" />
                            </button>
                          </>
                        )}
                        {badge && (
                          <span className={cn(
                            "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                            badge.variant === "warning" ? "bg-warning/10 text-warning" : "bg-info/10 text-info"
                          )}>
                            {badge.variant === "info" && (
                              <div className="relative h-1.5 w-1.5">
                                <div className="absolute inset-0 rounded-full border border-info border-t-transparent animate-spin" />
                              </div>
                            )}
                            {badge.variant === "warning" && <AlertCircle className="h-3 w-3" />}
                            {badge.count}
                          </span>
                        )}
                      </NavLink>
                    )
                  })}
                </SortableContext>

                {/* Edit mode: auto-collapse toggle + Done */}
                {isEditing && (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 mt-1 rounded-[10px] bg-muted/20">
                      <ChevronsDownUp className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground flex-1">Auto-collapse</span>
                      <button
                        onClick={() => setAutoCollapse(!autoCollapse)}
                        className={cn(
                          "relative h-5 w-9 rounded-full transition-colors shrink-0",
                          autoCollapse ? "bg-primary" : "bg-muted-foreground/25"
                        )}
                      >
                        <div className={cn(
                          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          autoCollapse ? "translate-x-4" : "translate-x-0.5"
                        )} />
                      </button>
                    </div>
                    <button
                      onClick={() => setEditing(false)}
                      className="mt-2 rounded-[10px] px-3.5 py-2.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Done
                    </button>
                  </>
                )}
              </nav>
            </DndContext>
          )}

        </div>

      </div>

      {/* Pinned items — outside nav overlay zone so expanding nav doesn't cover them */}
      {!isEditing && resolvedPinnedItems.length > 0 && (
        <div className={cn(
          "shrink-0 border-b border-border/40",
          shouldCollapseNav && !collapsed && "relative z-0",
        )}>
          {!collapsed && (
            <div className="flex flex-col gap-0.5 px-4 py-1.5">
              {resolvedPinnedItems.map((item, index) => (
                <div key={item.id}>{renderProjectRow(item.project, index, true)}</div>
              ))}
            </div>
          )}
          {collapsed && (
            <div className="flex flex-col items-center gap-1 py-1.5">
              {resolvedPinnedItems.map((item, index) => (
                <div key={item.id}>{renderProjectRow(item.project, index, true)}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Scrollable area: projects + sessions ─── */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={collapsed ? { scrollbarWidth: "none" } : undefined}>

        {/* Initiative-grouped projects */}
        {initiativeGroups.length > 0 && (
          <div className={cn("flex flex-col gap-1 py-2 font-primary", collapsed ? "items-center" : "px-5")}>
            {!collapsed && (
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium tracking-[0.5px] text-muted-foreground">PROJECTS</div>
                <button
                  onClick={() => {
                    const allIds = initiativeGroups.map((g) => g.initiative.id)
                    const allCollapsed = allIds.every((id) => collapsedInitiatives.has(id))
                    setAllInitiativesCollapsed(allIds, !allCollapsed)
                  }}
                  className="p-0.5 rounded hover:bg-muted/50 transition-colors text-muted-foreground/50 hover:text-muted-foreground"
                  title={initiativeGroups.every((g) => collapsedInitiatives.has(g.initiative.id)) ? "Expand all" : "Fold all"}
                >
                  {initiativeGroups.every((g) => collapsedInitiatives.has(g.initiative.id))
                    ? <ChevronsUpDown className="h-3 w-3" />
                    : <ChevronsDownUp className="h-3 w-3" />}
                </button>
              </div>
            )}
            {collapsed && <div className="w-6 h-px bg-border my-1" />}

            {initiativeGroups.map(({ initiative, projects: groupProjects }) => {
              const isGroupCollapsed = collapsedInitiatives.has(initiative.id)
              return (
                <div key={initiative.id}>
                  {!collapsed && (
                    <button
                      onClick={() => toggleInitiativeCollapse(initiative.id)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors text-left"
                    >
                      <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !isGroupCollapsed && "rotate-90")} />
                      <ColorIconBadge color={initiative.color} icon={initiative.icon} type="initiative" />
                      <span className="text-[15px] font-medium text-muted-foreground flex-1 truncate">{initiative.name}</span>
                      <span className="text-[11px] text-muted-foreground/60">{groupProjects.length}</span>
                    </button>
                  )}
                  {!isGroupCollapsed && !collapsed && (
                    <div className="flex flex-col gap-0.5 ml-3">
                      {groupProjects.map((project, index) => (
                        <div key={project.id}>{renderProjectRow(project, index, false)}</div>
                      ))}
                    </div>
                  )}
                  {!isGroupCollapsed && collapsed && (
                    <div className="flex flex-col items-center gap-1">
                      {groupProjects.map((project, index) => renderProjectRow(project, index, false))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Ungrouped projects (no initiative) */}
            {ungroupedProjects.length > 0 && !collapsed && (
              <div className="flex flex-col gap-0.5">
                {ungroupedProjects.map((project, index) => (
                  <div key={project.id}>{renderProjectRow(project, index + initiativeGroups.length * 10, false)}</div>
                ))}
              </div>
            )}
            {ungroupedProjects.length > 0 && collapsed && (
              <div className="flex flex-col items-center gap-1">
                {ungroupedProjects.map((project, index) => renderProjectRow(project, index + initiativeGroups.length * 10, false))}
              </div>
            )}
          </div>
        )}

        {/* Flat projects list (no initiatives) */}
        {initiativeGroups.length === 0 && activeProjects.length > 0 && (
          <div className={cn("flex flex-col gap-2 py-2 font-primary", collapsed ? "items-center" : "px-5")}>
            {!collapsed && (
              <div className="text-xs font-medium tracking-[0.5px] text-muted-foreground">PROJECTS</div>
            )}
            {collapsed && <div className="w-6 h-px bg-border my-1" />}
            {!collapsed ? (
              <div className="flex flex-col gap-0.5">
                {activeProjects.map((project, index) => (
                  <div key={project.id}>{renderProjectRow(project, index, false)}</div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                {activeProjects.map((project, index) => renderProjectRow(project, index, false))}
              </div>
            )}
          </div>
        )}

        {/* Recent sessions */}
        {recentSessions.length > 0 && (
          <div className={cn("flex flex-col gap-2 py-2 font-primary", collapsed ? "items-center" : "px-5")}>
            {!collapsed && (
              <div className="text-xs font-medium tracking-[0.5px] text-muted-foreground">RECENT</div>
            )}
            {collapsed && <div className="w-6 h-px bg-border my-1" />}
            <div className={cn("flex flex-col", collapsed ? "items-center gap-1" : "gap-0.5")}>
              {recentSessions.filter((s) => !pinnedIds.has(s.id)).map((project) => {
                const isActive = location.search.includes(project.id) && location.pathname === "/playground"

                if (collapsed) {
                  return (
                    <div key={project.id} className="flex justify-center w-full">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => navigate(`/playground?projectId=${project.id}`)}
                            className={cn(
                              "flex items-center justify-center h-9 w-9 rounded-lg transition-colors relative",
                              isActive ? "bg-accent" : "hover:bg-muted/50"
                            )}
                          >
                            <FlaskConical className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">{project.name}</TooltipContent>
                      </Tooltip>
                    </div>
                  )
                }

                return (
                  <div
                    key={project.id}
                    className="group/proj flex items-center gap-3 rounded-[10px] px-3.5 py-2 transition-colors cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/playground?projectId=${project.id}`)}
                  >
                    <FlaskConical className={cn("h-4 w-4 shrink-0", isActive ? "text-accent-foreground" : "text-muted-foreground")} />
                    <span className={cn(
                      "flex-1 text-[15px] truncate",
                      isActive ? "text-accent-foreground font-semibold" : "text-muted-foreground font-medium"
                    )}>
                      {project.name}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (pinnedIds.has(project.id)) { unpinItem(project.id) } else { pinItem(project.id, 'session') }
                      }}
                      className="shrink-0 p-0.5 rounded transition-colors opacity-0 group-hover/proj:opacity-100 text-muted-foreground/40 hover:text-muted-foreground"
                    >
                      <Pin className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteProject(project.id)
                      }}
                      className="shrink-0 p-0.5 rounded transition-colors opacity-0 group-hover/proj:opacity-100 text-muted-foreground/40 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    {projectsWithRunning.has(project.id) && (
                      <Loader2 className="h-3.5 w-3.5 text-info animate-spin shrink-0" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>

      {/* ─── Local Mode badge ─── */}
      {!showAuth && (
        collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex justify-center py-2 border-t border-border">
                <div className="h-2 w-2 rounded-full bg-warning" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">Local Mode</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex items-center gap-2 px-5 py-3 text-xs text-muted-foreground border-t border-border">
            <div className="h-2 w-2 rounded-full bg-warning" />
            Local Mode
          </div>
        )
      )}

      {/* ─── Quick Settings ─── */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 py-2 border-t border-border">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06] transition-colors">
                <Cpu className="h-[18px] w-[18px] text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="center" className="w-auto p-2">
              <div className="flex items-center gap-2">
                {(["small", "medium", "large"] as const).map((tier) => {
                  const tierLabel = tier === "small" ? "Small (Haiku)" : tier === "medium" ? "Medium (Sonnet)" : "Large (Opus)"
                  const effortOpts = getEffortOptions(effectiveProvider, tier)
                  return (
                    <Popover key={tier} open={effortPopoverTier === `collapsed-${tier}`}>
                      <PopoverTrigger asChild>
                        <button
                          onClick={() => setModelTier(tier)}
                          onMouseEnter={() => openEffortPopover(`collapsed-${tier}`)}
                          onMouseLeave={closeEffortPopover}
                          className={cn(
                            "flex items-center justify-center rounded-full transition-colors",
                            tier === "small" ? "h-5 w-5" : tier === "medium" ? "h-6 w-6" : "h-7 w-7",
                            modelTier === tier ? "bg-primary" : "bg-muted-foreground/20 hover:bg-muted-foreground/40"
                          )}
                        >
                          <div className={cn(
                            "rounded-full",
                            tier === "small" ? "h-2 w-2" : tier === "medium" ? "h-2.5 w-2.5" : "h-3 w-3",
                            modelTier === tier ? "bg-primary-foreground" : "bg-muted-foreground/60"
                          )} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="top"
                        align="center"
                        className="w-32 p-1.5"
                        onMouseEnter={() => openEffortPopover(`collapsed-${tier}`)}
                        onMouseLeave={closeEffortPopover}
                      >
                        <p className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5">{tierLabel}</p>
                        <div className="h-px bg-border mx-1 my-1" />
                        <p className="text-[10px] font-medium text-muted-foreground px-1.5 pb-0.5">Effort</p>
                        {effortOpts.map((opt) => (
                          <button
                            key={opt}
                            onClick={() => setModelEffort(opt)}
                            className={cn(
                              "w-full flex items-center gap-2 px-1.5 py-1 rounded text-xs transition-colors text-left",
                              modelEffort === opt ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                            )}
                          >
                            {EFFORT_LABELS[opt]}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <button data-tour-id="yolo" onClick={() => setYoloMode(!yoloMode)} className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06] transition-colors">
                <Zap className={cn("h-[18px] w-[18px]", yoloMode ? "text-warning fill-warning" : "text-muted-foreground")} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">YOLO: {yoloMode ? "On" : "Off"} — Auto-approve all tasks across all projects</TooltipContent>
            </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => setTheme(isDark ? "light" : "dark")} className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06] transition-colors">
                {isDark ? <Sun className="h-[18px] w-[18px] text-muted-foreground" /> : <Moon className="h-[18px] w-[18px] text-muted-foreground" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Toggle {isDark ? "Light" : "Dark"} Mode</TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-5 py-2 border-t border-border">
          <div className="flex items-center gap-1.5" data-tour-id="model-tier">
            <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
            {(["small", "medium", "large"] as const).map((tier) => {
              const tierLabel = tier === "small" ? "Small (Haiku)" : tier === "medium" ? "Medium (Sonnet)" : "Large (Opus)"
              const effortOpts = getEffortOptions(effectiveProvider, tier)
              return (
                <Popover key={tier} open={effortPopoverTier === `expanded-${tier}`}>
                  <PopoverTrigger asChild>
                    <button
                      onClick={() => setModelTier(tier)}
                      onMouseEnter={() => openEffortPopover(`expanded-${tier}`)}
                      onMouseLeave={closeEffortPopover}
                      className={cn(
                        "flex items-center justify-center rounded-full transition-colors",
                        tier === "small" ? "h-4 w-4" : tier === "medium" ? "h-5 w-5" : "h-6 w-6",
                        modelTier === tier ? "bg-primary" : "bg-muted-foreground/20 hover:bg-muted-foreground/40"
                      )}
                    >
                      <div className={cn(
                        "rounded-full",
                        tier === "small" ? "h-1.5 w-1.5" : tier === "medium" ? "h-2 w-2" : "h-2.5 w-2.5",
                        modelTier === tier ? "bg-primary-foreground" : "bg-muted-foreground/60"
                      )} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="center"
                    className="w-32 p-1.5"
                    onMouseEnter={() => openEffortPopover(`expanded-${tier}`)}
                    onMouseLeave={closeEffortPopover}
                  >
                    <p className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5">{tierLabel}</p>
                    <div className="h-px bg-border mx-1 my-1" />
                    <p className="text-[10px] font-medium text-muted-foreground px-1.5 pb-0.5">Effort</p>
                    {effortOpts.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setModelEffort(opt)}
                        className={cn(
                          "w-full flex items-center gap-2 px-1.5 py-1 rounded text-xs transition-colors text-left",
                          modelEffort === opt ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                        )}
                      >
                        {EFFORT_LABELS[opt]}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )
            })}
          </div>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button data-tour-id="yolo" onClick={() => setYoloMode(!yoloMode)} className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted/50 transition-colors">
                <Zap className={cn("h-4 w-4", yoloMode ? "text-warning fill-warning" : "text-muted-foreground")} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">YOLO: {yoloMode ? "On" : "Off"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => setTheme(isDark ? "light" : "dark")} className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted/50 transition-colors">
                {isDark ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Toggle {isDark ? "Light" : "Dark"} Mode</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* ─── User Profile ─── */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 border-t border-border py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => navigate("/stats")} className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06] transition-colors">
                <User className="h-[18px] w-[18px] text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Profile & Stats</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => navigate("/settings")} className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06] transition-colors">
                <Settings className="h-[18px] w-[18px] text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={toggleSidebar} className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06] transition-colors">
                <PanelLeft className="h-[18px] w-[18px] text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <div className="flex items-center justify-between border-t border-border px-5 py-3 gap-2">
          <button
            onClick={() => navigate("/stats")}
            className="flex items-center gap-2 min-w-0 flex-1 rounded-md hover:bg-muted/50 transition-colors px-1 py-1 -mx-1 text-left"
          >
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={profile.avatarUrl} />
              <AvatarFallback className="text-[13px] font-bold">
                {getInitials(profile.name || authUser?.email || "")}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col items-start gap-0.5 min-w-0">
              <span className="text-[13px] font-semibold text-foreground truncate w-full">
                {getDisplayName(profile.name || authUser?.email || "")}
              </span>
              {(profile.email || authUser?.email) && (
                <span className="text-[11px] text-muted-foreground truncate w-full">
                  {profile.email || authUser?.email}
                </span>
              )}
            </div>
          </button>
          <div className="flex items-center gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => navigate("/settings")} className="p-2 rounded-md hover:bg-muted/50 transition-colors">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Settings</TooltipContent>
            </Tooltip>
            <button onClick={toggleSidebar} className="p-2 rounded-md hover:bg-muted/50 transition-colors">
              <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
            </button>
            {showAuth && (
              <button onClick={handleSignOut} className="p-2 rounded-md hover:bg-destructive/10 transition-colors">
                <LogOut className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
