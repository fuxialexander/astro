import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { NavLink, useNavigate, useParams, useLocation } from "react-router"
import { GitBranch, Terminal, Settings, LogOut, Sun, Moon, CheckSquare, Search, Radio, Target, Cpu, Plus, Minus, GripVertical, BookOpen, Palette, Zap, Globe, FileText, Layers, Box, Wrench, Code, Loader2, Sparkles, X, FlaskConical, PanelLeftClose, PanelLeft, AlertCircle, LayoutTemplate, ChevronRight, ChevronDown, MessageSquare } from "lucide-react"
import { getFaIcon } from "@/lib/color-icon-utils"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { useSettingsStore } from "@/stores/settings-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useAuthStore } from "@/stores/auth-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useUIStore } from "@/stores/ui-store"
import { useSidebarStore } from "@/stores/sidebar-store"
import { useToastStore } from "@/stores/toast-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useAutoReveal } from "@/hooks/use-auto-reveal"
import { isServerMode } from "@/lib/app-mode"
import { TERMINAL_NODE_STATUSES } from "@/lib/status-config"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { InlineRenameInput } from "@/components/inline-rename-input"

const iconMap: Record<string, typeof CheckSquare> = {
  CheckSquare,
  GitBranch,
  Terminal,
  Radio,
  Target,
  Cpu,
  BookOpen,
  Palette,
  Zap,
  Globe,
  FileText,
  Layers,
  Box,
  Wrench,
  Code,
  Sparkles,
  FlaskConical,
  LayoutTemplate,
}

// Project color palette — Morandi muted tones
const projectColors = [
  "#5B7F9A", // Steel blue
  "#7B9B7D", // Sage green
  "#C09070", // Dusty terracotta
  "#8B7BAD", // Dusty lavender
  "#B07B8B", // Dusty rose
  "#BDA26B", // Dusty gold
  "#7B97AD", // Dusty sky
  "#A08B7B", // Warm taupe
]

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme()
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)
  const modelTier = useSettingsStore((s) => s.modelTier)
  const setModelTier = useSettingsStore((s) => s.setModelTier)
  const yoloMode = useSettingsStore((s) => s.yoloMode)
  const setYoloMode = useSettingsStore((s) => s.setYoloMode)
  const profile = useUserProfileStore((s) => s.profile)
  const authUser = useAuthStore((s) => s.user)
  const projects = useProjectStore((s) => s.projects)
  const updateProject = useProjectStore((s) => s.updateProject)
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const signOut = useAuthStore((s) => s.signOut)
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const sidebarItems = useSidebarStore((s) => s.items)
  const isEditing = useSidebarStore((s) => s.isEditing)
  const setEditing = useSidebarStore((s) => s.setEditing)
  const toggleItemVisibility = useSidebarStore((s) => s.toggleItemVisibility)
  const reorderItems = useSidebarStore((s) => s.reorderItems)
  const subscribeToChanges = useSidebarStore((s) => s.subscribeToChanges)
  const dismissAutoReveal = useSidebarStore((s) => s.dismissAutoReveal)
  const addToast = useToastStore((s) => s.add)
  const navigate = useNavigate()
  const params = useParams()
  const location = useLocation()
  const showAuth = isServerMode()

  const activeProjectId = params.id
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

  // Auto-reveal sidebar items based on usage thresholds
  useAutoReveal()

  // Active task tracking for sidebar indicators
  const executions = useExecutionStore((s) => s.executions)

  // Navigate to generation activity view if plan is actively generating, otherwise list view
  const navigateToProject = useCallback((projectId: string) => {
    const planExec = executions.get(`plan-${projectId}`)
    const isGenerating = planExec?.status === "running" || planExec?.status === "pending"
    if (isGenerating) {
      navigate(`/plan?projectId=${projectId}`)
    } else {
      navigate(`/project/${projectId}/list`)
    }
  }, [executions, navigate])

  // O(1) lookup map for plan nodes by ID
  const planNodesById = useMemo(() => {
    const map = new Map<string, (typeof planNodes)[number]>()
    for (const node of planNodes) map.set(node.id, node)
    return map
  }, [planNodes])

  // Count total active tasks + generations, and which projects have running work
  const { activeCount, projectsWithRunning } = useMemo(() => {
    let count = 0
    const running = new Set<string>()

    // Count running executions (filter out stale ones where node is already completed)
    for (const [nodeId, exec] of executions) {
      if (exec.status === "pending" || exec.status === "running") {
        const node = planNodesById.get(nodeId)
        // Skip stale executions: node has terminal status but execution still shows running
        if (node && TERMINAL_NODE_STATUSES.has(node.status)) continue
        count++
        if (node?.projectId) running.add(node.projectId)
        if (exec.projectId) running.add(exec.projectId)
      }
    }

    // Also check node statuses for running tasks not in execution store
    for (const node of planNodes) {
      if ((node.status === "in_progress" || node.status === "dispatched") && !executions.has(node.id)) {
        count++
        running.add(node.projectId)
      }
    }

    return { activeCount: count, projectsWithRunning: running }
  }, [executions, planNodes, planNodesById])

  // Count pending plan approvals for the Plan nav badge
  const dynamicApprovals = useRealtimeStore((s) => s.dynamicApprovals)
  const pendingPlanApprovals = useMemo(() => {
    let count = 0
    for (const approval of dynamicApprovals.values()) {
      if (approval.taskId.startsWith("plan-")) count++
    }
    return count
  }, [dynamicApprovals])

  // Count actionable items for Dashboard badge (pending decisions + dynamic approvals)
  const dashboardAttentionCount = useMemo(() => {
    const pendingDecisionNodes = planNodes.filter(
      (n) => n.status === "awaiting_judgment" || n.status === "awaiting_approval"
    ).length
    return pendingDecisionNodes + dynamicApprovals.size
  }, [planNodes, dynamicApprovals])

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const [showHint, setShowHint] = useState(() => !localStorage.getItem("sidebar-hint-dismissed"))

  // Rename state
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)

  // Subscribe to realtime changes (multi-device sync)
  useEffect(() => {
    const unsubscribe = subscribeToChanges()
    return () => unsubscribe()
  }, [subscribeToChanges])

  // Removed: syncWithProjectCount was hiding Tasks when < 2 projects
  // Tasks is always visible as the home route

  const handleLongPressStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    longPressTimer.current = window.setTimeout(() => {
      setEditing(true)
      setShowHint(false)
      localStorage.setItem("sidebar-hint-dismissed", "1")
    }, 500)
    // Prevent iOS Safari link preview / context menu on touch
    if ("touches" in e) {
      e.preventDefault()
    }
  }, [setEditing])

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const dismissHint = useCallback(() => {
    setShowHint(false)
    localStorage.setItem("sidebar-hint-dismissed", "1")
  }, [])

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = "move"
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      reorderItems(draggedIndex, dropIndex)
    }
    setDraggedIndex(null)
  }

  const visibleItems = sidebarItems.filter((item) => {
    // Hide Community nav item in local mode
    if (item.id === 'community' && !showAuth) return false
    return item.visible
  })

  const calculateProgress = (projectId: string): number => {
    const projectTasks = planNodes.filter(
      (n) => n.projectId === projectId && n.type !== "milestone"
    )
    if (projectTasks.length === 0) return 0

    const completedTasks = projectTasks.filter(
      (n) => n.status === "completed" || n.status === "auto_verified"
    )
    return Math.round((completedTasks.length / projectTasks.length) * 100)
  }

  const getInitials = (nameOrEmail: string) => {
    if (!nameOrEmail) return "U"

    // If it's an email, use first part before @
    if (nameOrEmail.includes("@")) {
      const username = nameOrEmail.split("@")[0]
      // Handle dots/underscores in username (e.g., john.doe → JD)
      const parts = username.split(/[._-]/)
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase()
      }
      return username.slice(0, 2).toUpperCase()
    }

    // If it's a name, use first letters of first/last name
    const parts = nameOrEmail.trim().split(/\s+/)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }

    // Single word name - use first two letters
    return nameOrEmail.slice(0, 2).toUpperCase()
  }

  const getDisplayName = (nameOrEmail: string) => {
    if (!nameOrEmail) return "User"

    // If it's an email, show username part in a nicer format
    if (nameOrEmail.includes("@")) {
      const username = nameOrEmail.split("@")[0]
      // Replace dots/underscores with spaces and capitalize (e.g., john.doe → John Doe)
      return username
        .split(/[._-]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    }

    return nameOrEmail
  }

  const getProjectColor = (index: number) => {
    return projectColors[index % projectColors.length]
  }

  const getHealthBarWidth = (progress?: number) => {
    if (progress === undefined) return 0
    // Map 0-100 progress to 0-40px width (w-10 container = 40px)
    return Math.round((progress / 100) * 40)
  }

  const handleSignOut = async () => {
    await signOut()
    navigate("/login")
  }

  const handleProjectRename = async (projectId: string, newName: string) => {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return

    const oldName = project.name

    try {
      // Optimistic update
      updateProject(projectId, { name: newName })
      setRenamingProjectId(null)

      // Verify server sync (only in server mode)
      if (isServerMode()) {
        // In a real implementation, we'd check for conflicts here
        // For now, we'll just show a success message
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
  }

  const validateProjectName = (name: string): string | null => {
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
  }

  const activeProjects = useMemo(
    () => projects.filter(p => p.status === 'active' && p.projectType !== 'playground'),
    [projects]
  )

  const playgroundSessions = useMemo(
    () => projects
      .filter(p => p.projectType === 'playground')
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()),
    [projects]
  )
  const [playgroundExpanded, setPlaygroundExpanded] = useState(false)

  // Shared handler for Plan click — resets to fresh input when already on /plan.
  // Uses location.state to signal form reset even when URL doesn't change.
  const handlePlanClick = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault()
    if (location.pathname === "/plan") {
      // Already on /plan — use a unique state key to force reset detection
      navigate("/plan", { replace: true, state: { resetForm: Date.now() } })
    } else {
      navigate("/plan")
    }
  }, [location.pathname, navigate])

  return (
    <aside className={cn(
      "hidden md:flex h-full shrink-0 flex-col border-r border-border bg-card overflow-hidden",
      collapsed ? "w-[52px]" : "w-[260px]",
    )}>
      {/* Logo Section */}
      <div className={cn(
        "flex h-14 shrink-0 items-center",
        collapsed ? "justify-center px-0" : "gap-2 px-5 py-5"
      )}>
        <div className="relative shrink-0">
          <img src="/icon-192.png" alt="Astro" className="h-7 w-7 rounded-[6px]" />
          <div
            className={cn(
              "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-white dark:border-card",
              connectionStatus === "connected" ? "bg-success" : connectionStatus === "checking" ? "bg-warning animate-pulse" : "bg-destructive"
            )}
          />
        </div>
        {!collapsed && (
          <span className="font-secondary text-2xl font-bold text-foreground">
            Astro
          </span>
        )}
      </div>

      {/* Command Palette Search Button */}
      {collapsed ? (
        <div className="flex justify-center py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setCommandPaletteOpen(true)}
                className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                <Search className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Search ({isMac ? "⌘" : "Ctrl+"}K)</TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <div className="px-4 pt-4 pb-2">
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="flex w-full items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-[15px] font-medium text-muted-foreground bg-muted/30 hover:bg-muted/50 transition-colors border border-border/50"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left text-sm">Search...</span>
            <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-border/70 bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
              {isMac ? "⌘" : "Ctrl+"}K
            </kbd>
          </button>
        </div>
      )}

      {/* Scrollable middle section: navigation + projects */}
      <div
        className="flex-1 min-h-0 overflow-y-auto"
        style={collapsed ? { scrollbarWidth: "none" } : undefined}
      >
        {/* Navigation */}
        <nav
          className={cn("flex flex-col gap-1 py-2", collapsed ? "items-center" : "px-4")}
          style={{ WebkitTouchCallout: "none" } as React.CSSProperties}
          onMouseDown={collapsed ? undefined : handleLongPressStart}
          onMouseUp={collapsed ? undefined : handleLongPressEnd}
          onMouseLeave={collapsed ? undefined : handleLongPressEnd}
          onTouchStart={collapsed ? undefined : handleLongPressStart}
          onTouchEnd={collapsed ? undefined : handleLongPressEnd}
          onContextMenu={collapsed ? undefined : (e) => e.preventDefault()}
        >
          {/* Long-press hint bubble (expanded only) */}
          {!collapsed && showHint && !isEditing && (
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground mb-1">
              <span className="flex-1">Long press below to edit</span>
              <button onClick={dismissHint} className="p-0.5 rounded hover:bg-muted-foreground/10 transition-colors shrink-0">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {/* Visible items */}
          {(isEditing && !collapsed ? sidebarItems : visibleItems).map((item, index) => {
            const Icon = iconMap[item.icon] || CheckSquare
            const isHidden = !item.visible

            if (collapsed) {
              if (isHidden) return null
              const isItemActive = location.pathname === item.to
              return (
                <div key={item.id} className="flex justify-center w-full">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        data-tour-id={item.id}
                        onClick={item.id === "plan" ? (e: React.MouseEvent) => handlePlanClick(e) : () => navigate(item.to)}
                        className={cn(
                          "flex items-center justify-center h-9 w-9 rounded-lg transition-colors relative",
                          isItemActive
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-muted/50"
                        )}
                      >
                        <Icon className="h-[18px] w-[18px]" />
                        {item.id === "active" && activeCount > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center h-3.5 min-w-[14px] rounded-full bg-info text-[8px] font-bold text-white px-0.5">
                            {activeCount}
                          </span>
                        )}
                        {item.id === "plan" && pendingPlanApprovals > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-warning border-2 border-card" />
                        )}
                        {item.id === "dashboard" && dashboardAttentionCount > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center h-3.5 min-w-[14px] rounded-full bg-warning text-[8px] font-bold text-white px-0.5">
                            {dashboardAttentionCount}
                          </span>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                </div>
              )
            }

            return (
              <div
                key={item.id}
                draggable={isEditing}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
                className={cn(
                  "relative group",
                  isHidden && "opacity-40"
                )}
              >
                {isEditing ? (
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-[10px] px-3.5 py-2.5 text-[15px] font-medium bg-muted/30 border-2 border-dashed",
                      isHidden ? "border-muted-foreground/20" : "border-muted-foreground/40"
                    )}
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                    <Icon className="h-5 w-5" />
                    <span className="flex-1">{item.label}</span>
                    {!item.protected && (
                      <button
                        onClick={() => toggleItemVisibility(item.id)}
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full transition-colors",
                          isHidden
                            ? "bg-success hover:bg-success/90 text-white"
                            : "bg-error hover:bg-error/90 text-white"
                        )}
                      >
                        {isHidden ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                ) : !isHidden ? (
                  <NavLink
                    to={item.to}
                    end
                    data-tour-id={item.id}
                    onClick={item.id === "plan" ? (e: React.MouseEvent) => handlePlanClick(e) : undefined}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-[15px] font-medium transition-colors",
                        isActive
                          ? "bg-accent text-accent-foreground font-semibold"
                          : "text-muted-foreground hover:bg-muted/50"
                      )
                    }
                  >
                    <Icon className="h-5 w-5" />
                    <span className="flex-1">{item.label}</span>
                    {item.autoRevealed && (
                      <>
                        <span className="text-[9px] font-semibold bg-info/10 text-info rounded-full px-1.5 py-0.5">
                          New
                        </span>
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            dismissAutoReveal(item.id)
                          }}
                          className="p-0.5 rounded-sm hover:bg-muted/80 transition-colors"
                          aria-label={`Dismiss ${item.label}`}
                        >
                          <X className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </>
                    )}
                    {item.id === "active" && activeCount > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info">
                        <div className="relative h-1.5 w-1.5">
                          <div className="absolute inset-0 rounded-full border border-info border-t-transparent animate-spin" />
                        </div>
                        {activeCount}
                      </span>
                    )}
                    {item.id === "plan" && pendingPlanApprovals > 0 && (
                      <span className="flex items-center gap-1.5 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                        <AlertCircle className="h-3 w-3" />
                        {pendingPlanApprovals}
                      </span>
                    )}
                    {item.id === "dashboard" && dashboardAttentionCount > 0 && (
                      <span className="flex items-center gap-1.5 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                        <AlertCircle className="h-3 w-3" />
                        {dashboardAttentionCount}
                      </span>
                    )}
                  </NavLink>
                ) : null}
              </div>
            )
          })}

          {/* Edit mode: Done button / Normal mode: Customize link */}
          {!collapsed && (isEditing ? (
            <button
              onClick={() => setEditing(false)}
              className="mt-2 rounded-[10px] px-3.5 py-2.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Done
            </button>
          ) : sidebarItems.some((item) => !item.visible) && (
            <button
              onClick={() => setEditing(true)}
              className="mt-1 px-3.5 py-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              Customize sidebar...
            </button>
          ))}
        </nav>

        {/* Projects Section */}
        {activeProjects.length > 0 && (
          <div className={cn("flex flex-col gap-2 pb-6 font-primary", collapsed ? "items-center" : "px-5")}>
            {!collapsed && (
              <div className="text-xs font-medium tracking-[0.5px] text-muted-foreground">
                PROJECTS
              </div>
            )}
            {collapsed && <div className="w-6 h-px bg-border my-1" />}
            <div className={cn("flex flex-col", collapsed ? "items-center gap-1" : "gap-2")}>
              {activeProjects.map((project, index) => {
                const isActive = activeProjectId === project.id
                const progress = calculateProgress(project.id)
                const healthWidth = getHealthBarWidth(progress)
                const color = getProjectColor(index)

                const projectIcon = (() => {
                  const projIcon = project.icon || "FaBox"
                  const projColor = project.color || color
                  const FaIcon = getFaIcon(projIcon)
                  if (FaIcon) {
                    return <FaIcon size={collapsed ? 18 : 16} style={{ color: projColor }} className="shrink-0" />
                  }
                  return <span className="text-base leading-none shrink-0">{projIcon}</span>
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
                    className={cn(
                      "flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 transition-colors",
                      isActive
                        ? "bg-accent"
                        : "hover:bg-muted/50"
                    )}
                  >
                    {projectIcon}

                    {/* Project name - editable on double-click */}
                    {renamingProjectId === project.id ? (
                      <InlineRenameInput
                        value={project.name}
                        onSave={(newName) => handleProjectRename(project.id, newName)}
                        onCancel={() => setRenamingProjectId(null)}
                        validate={validateProjectName}
                        className="flex-1"
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          setRenamingProjectId(project.id)
                        }}
                        onClick={() => navigateToProject(project.id)}
                        className={cn(
                          "flex-1 text-sm truncate cursor-pointer",
                          isActive
                            ? "text-accent-foreground font-semibold"
                            : "text-muted-foreground font-medium"
                        )}
                      >
                        {project.name.includes('/') ? project.name.split('/').slice(1).join('/') : project.name}
                      </span>
                    )}

                    {/* Running indicator or health bar */}
                    {projectsWithRunning.has(project.id) ? (
                      <Loader2 className="h-3.5 w-3.5 text-info animate-spin shrink-0" />
                    ) : (
                      <div className="w-10 h-1 bg-muted rounded-sm overflow-hidden shrink-0">
                        <div
                          className="h-full rounded-sm bg-primary"
                          style={{ width: `${healthWidth}px` }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Playground Sessions */}
        {playgroundSessions.length > 0 && !collapsed && (
          <div className="flex flex-col gap-1 pb-6 font-primary px-5">
            <button
              onClick={() => setPlaygroundExpanded(!playgroundExpanded)}
              className="flex items-center gap-1 text-xs font-medium tracking-[0.5px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {playgroundExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              PLAYGROUND ({playgroundSessions.length})
            </button>
            {playgroundExpanded && (
              <div className="flex flex-col gap-0.5 max-h-[200px] overflow-y-auto">
                {playgroundSessions.map((session) => {
                  const isActive = location.pathname === "/playground" && new URLSearchParams(location.search).get("projectId") === session.id
                  const exec = executions.get(`playground-${session.id}`)
                  const isRunning = exec?.status === "running" || exec?.status === "pending"
                  return (
                    <button
                      key={session.id}
                      onClick={() => navigate(`/playground?projectId=${session.id}`)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors",
                        isActive ? "bg-accent" : "hover:bg-muted/50"
                      )}
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className={cn(
                        "flex-1 text-xs truncate",
                        isActive ? "text-accent-foreground font-medium" : "text-muted-foreground"
                      )}>
                        {session.name.replace(/^Playground:\s*/, '').slice(0, 40)}
                      </span>
                      {isRunning && <Loader2 className="h-3 w-3 text-info animate-spin shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {playgroundSessions.length > 0 && collapsed && (
          <div className="flex justify-center pb-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => navigate("/playground")}
                  className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Playground Sessions ({playgroundSessions.length})</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Local Mode Badge */}
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
          <div className="flex items-center gap-2 px-5 py-3 text-xs text-muted-foreground border-t border-border dark:border-border">
            <div className="h-2 w-2 rounded-full bg-warning" />
            Local Mode
          </div>
        )
      )}

      {/* Quick Settings */}
      {collapsed ? (
        <div className="flex flex-col gap-1 py-2">
          {/* Model Size — popup horizontal selector */}
          <div className="flex justify-center w-full">
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted/50 transition-colors">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="center" className="w-auto p-2">
                <div className="flex items-center gap-2">
                  {(["small", "medium", "large"] as const).map((tier) => (
                    <Tooltip key={tier}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setModelTier(tier)}
                          className={cn(
                            "flex items-center justify-center rounded-full transition-colors",
                            tier === "small" ? "h-5 w-5" : tier === "medium" ? "h-6 w-6" : "h-7 w-7",
                            modelTier === tier
                              ? "bg-primary"
                              : "bg-muted-foreground/20 hover:bg-muted-foreground/40"
                          )}
                        >
                          <div className={cn(
                            "rounded-full",
                            tier === "small" ? "h-2 w-2" : tier === "medium" ? "h-2.5 w-2.5" : "h-3 w-3",
                            modelTier === tier ? "bg-primary-foreground" : "bg-muted-foreground/60"
                          )} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {tier === "small" ? "Small (Haiku)" : tier === "medium" ? "Medium (Sonnet)" : "Large (Opus)"}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex justify-center w-full">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setYoloMode(!yoloMode)}
                  className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <Zap className={cn("h-4 w-4", yoloMode ? "text-warning fill-warning" : "text-muted-foreground")} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Auto Approval: {yoloMode ? "On" : "Off"}</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex justify-center w-full">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted/50 transition-colors"
                >
                  {theme === "dark" ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Toggle {theme === "dark" ? "Light" : "Dark"} Mode</TooltipContent>
            </Tooltip>
          </div>
        </div>
      ) : (
        <div className="px-4 py-2 flex flex-col gap-0.5">
          {/* Model Size Selector */}
          <div className="flex items-center justify-between rounded-[10px] px-3.5 py-2">
            <div className="flex items-center gap-3">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Model</span>
            </div>
            <div className="flex items-center gap-2">
              {(["small", "medium", "large"] as const).map((tier) => (
                <Tooltip key={tier}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setModelTier(tier)}
                      className={cn(
                        "flex items-center justify-center rounded-full transition-colors",
                        tier === "small" ? "h-5 w-5" : tier === "medium" ? "h-6 w-6" : "h-7 w-7",
                        modelTier === tier
                          ? "bg-primary"
                          : "bg-muted-foreground/20 hover:bg-muted-foreground/40"
                      )}
                    >
                      <div className={cn(
                        "rounded-full",
                        tier === "small" ? "h-2 w-2" : tier === "medium" ? "h-2.5 w-2.5" : "h-3 w-3",
                        modelTier === tier ? "bg-primary-foreground" : "bg-muted-foreground/60"
                      )} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {tier === "small" ? "Small (Haiku)" : tier === "medium" ? "Medium (Sonnet)" : "Large (Opus)"}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>

          {/* Auto Approval Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center justify-between rounded-[10px] px-3.5 py-2">
                <div className="flex items-center gap-3">
                  <Zap className={cn("h-4 w-4", yoloMode ? "text-warning fill-warning" : "text-muted-foreground")} />
                  <span className="text-sm font-medium text-muted-foreground">Auto Approval</span>
                </div>
                <Switch
                  checked={yoloMode}
                  onCheckedChange={setYoloMode}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">
              Auto-approve all agent decisions with the recommended option
            </TooltipContent>
          </Tooltip>

          {/* Dark Mode Toggle */}
          <div className="flex items-center justify-between rounded-[10px] px-3.5 py-2">
            <div className="flex items-center gap-3">
              {theme === "dark" ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
              <span className="text-sm font-medium text-muted-foreground">Dark Mode</span>
            </div>
            <Switch
              checked={theme === "dark"}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
            />
          </div>
        </div>
      )}

      {/* Bottom: User Profile / Expand button */}
      {collapsed ? (
        <div className="flex flex-col gap-1.5 border-t border-border py-3">
          <div className="flex justify-center w-full">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => navigate("/settings")}
                  className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted/50 transition-colors"
                  title="Settings"
                >
                  <Settings className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex justify-center w-full">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleSidebar}
                  className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <PanelLeft className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between border-t border-border dark:border-border px-5 py-3 gap-2">
          {/* User Avatar & Info */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={profile.avatarUrl} />
              <AvatarFallback className="text-[13px] font-bold">{getInitials(profile.name || authUser?.email || "")}</AvatarFallback>
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
          </div>

          {/* Icon Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => navigate("/settings")}
              className="p-2 rounded-md hover:bg-muted/50 transition-colors"
              title="Settings"
            >
              <Settings className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              onClick={toggleSidebar}
              className="p-2 rounded-md hover:bg-muted/50 transition-colors"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
            </button>
            {showAuth && (
              <button
                onClick={handleSignOut}
                className="p-2 rounded-md hover:bg-destructive/10 transition-colors"
                title="Sign Out"
              >
                <LogOut className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
