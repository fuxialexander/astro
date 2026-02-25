import { useState, useRef, useEffect, useMemo } from "react"
import { NavLink, useNavigate, useParams } from "react-router"
import { GitBranch, Terminal, Settings, LogOut, Sun, Moon, CheckSquare, Search, Radio, Target, Cpu, Plus, Minus, GripVertical, BookOpen, Palette, Zap, Globe, FileText, Layers, Box, Wrench, Code, Loader2, Sparkles, X } from "lucide-react"
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
import { useAgentStore } from "@/stores/agent-store"
import { useAutoReveal } from "@/hooks/use-auto-reveal"
import { isServerMode } from "@/lib/app-mode"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
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

export function Sidebar() {
  const { theme, setTheme } = useTheme()
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)
  const profile = useUserProfileStore((s) => s.profile)
  const authUser = useAuthStore((s) => s.user)
  const projects = useProjectStore((s) => s.projects)
  const updateProject = useProjectStore((s) => s.updateProject)
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const signOut = useAuthStore((s) => s.signOut)
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)
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
  const showAuth = isServerMode()

  const activeProjectId = params.id
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

  // Auto-reveal sidebar items based on usage thresholds
  useAutoReveal()

  // Active task tracking for sidebar indicators
  const executions = useExecutionStore((s) => s.executions)
  const agentSessions = useAgentStore((s) => s.sessions)

  // Count total active tasks + generations, and which projects have running work
  const { activeCount, projectsWithRunning } = useMemo(() => {
    let count = 0
    const running = new Set<string>()

    // Count running executions
    for (const [nodeId, exec] of executions) {
      if (exec.status === "pending" || exec.status === "running") {
        count++
        const node = planNodes.find((n) => n.id === nodeId)
        if (node?.projectId) running.add(node.projectId)
        if (exec.projectId) running.add(exec.projectId)
      }
    }

    // Count active plan generations
    for (const [projectId, session] of agentSessions) {
      if (session.status === "active") {
        count++
        running.add(projectId)
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
  }, [executions, agentSessions, planNodes])

  // Long press state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const longPressTimer = useRef<number | null>(null)

  // Rename state
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)

  // Subscribe to realtime changes (multi-device sync)
  useEffect(() => {
    const unsubscribe = subscribeToChanges()
    return () => unsubscribe()
  }, [subscribeToChanges])

  // Removed: syncWithProjectCount was hiding Tasks when < 2 projects
  // Tasks is always visible as the home route

  const handleLongPressStart = () => {
    longPressTimer.current = window.setTimeout(() => {
      setEditing(true)
    }, 500) // 500ms long press
  }

  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

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

  const visibleItems = sidebarItems.filter((item) => item.visible)

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

  return (
    <aside className="hidden md:flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-card">
      {/* Logo Section */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-5 py-5">
        <div className="relative">
          <img src="/icon-32.png" alt="Astro" className="h-7 w-7 rounded-[6px]" />
          <div
            className={cn(
              "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-white dark:border-card",
              connectionStatus === "connected" ? "bg-success" : connectionStatus === "checking" ? "bg-warning animate-pulse" : "bg-destructive"
            )}
          />
        </div>
        <span className="font-secondary text-2xl font-bold text-foreground">
          Astro
        </span>
      </div>

      {/* Command Palette Search Button */}
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

      {/* Navigation */}
      <nav
        className="flex flex-col gap-1 px-4 py-2"
        onMouseDown={handleLongPressStart}
        onMouseUp={handleLongPressEnd}
        onMouseLeave={handleLongPressEnd}
        onTouchStart={handleLongPressStart}
        onTouchEnd={handleLongPressEnd}
      >
        {/* Visible items */}
        {(isEditing ? sidebarItems : visibleItems).map((item, index) => {
          const Icon = iconMap[item.icon] || CheckSquare
          const isHidden = !item.visible

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
                </NavLink>
              ) : null}
            </div>
          )
        })}

        {/* Edit mode toggle button */}
        {isEditing && (
          <button
            onClick={() => setEditing(false)}
            className="mt-2 rounded-[10px] px-3.5 py-2.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Done
          </button>
        )}
      </nav>

      {/* Projects Section */}
      {projects.length > 0 && (
        <div className="flex flex-col gap-2 px-5 pb-6 font-primary">
          <div className="text-xs font-medium tracking-[0.5px] text-muted-foreground">
            PROJECTS
          </div>
          <div className="flex flex-col gap-2">
            {projects.filter(p => p.status === 'active').slice(0, 5).map((project, index) => {
              const isActive = activeProjectId === project.id
              const progress = calculateProgress(project.id)
              const healthWidth = getHealthBarWidth(progress)
              const color = getProjectColor(index)

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
                  {/* Colored icon */}
                  {(() => {
                    const projIcon = project.icon || "FaBox"
                    const projColor = project.color || color
                    const FaIcon = getFaIcon(projIcon)
                    if (FaIcon) {
                      return <FaIcon size={16} style={{ color: projColor }} className="shrink-0" />
                    }
                    return <span className="text-base leading-none shrink-0">{projIcon}</span>
                  })()}

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
                      onClick={() => navigate(`/project/${project.id}/list`)}
                      className={cn(
                        "flex-1 text-sm truncate cursor-pointer",
                        isActive
                          ? "text-accent-foreground font-semibold"
                          : "text-muted-foreground font-medium"
                      )}
                    >
                      {project.number != null && <span className="text-muted-foreground font-normal mr-1">#{project.number}</span>}{project.name}
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

      {/* Spacer to push content to bottom */}
      <div className="flex-1" />

      {/* Local Mode Badge */}
      {!showAuth && (
        <div className="flex items-center gap-2 px-5 py-3 text-xs text-muted-foreground border-t border-border dark:border-border">
          <div className="h-2 w-2 rounded-full bg-warning" />
          Local Mode
        </div>
      )}

      {/* Theme Toggle — Light ↔ Dark */}
      <div className="px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTheme(theme === "dark" ? "light" : "dark")
          }}
          className="w-full justify-start gap-3 rounded-[10px] px-3.5 py-2.5 h-auto font-medium text-[15px] text-muted-foreground hover:bg-muted/50"
        >
          {theme === "dark" ? (
            <>
              <Sun className="h-5 w-5" />
              <span>Light Mode</span>
            </>
          ) : (
            <>
              <Moon className="h-5 w-5" />
              <span>Dark Mode</span>
            </>
          )}
        </Button>
      </div>

      {/* User Profile - Icon Row */}
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
    </aside>
  )
}
