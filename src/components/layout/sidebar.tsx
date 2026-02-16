import { NavLink, useNavigate, useParams } from "react-router"
import { Hexagon, Radio, GitBranch, Target, Cpu, Terminal, Settings, LogOut, Sun, Moon, CheckSquare, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { useSettingsStore } from "@/stores/settings-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useAuthStore } from "@/stores/auth-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useUIStore } from "@/stores/ui-store"
import { shouldUseSupabase } from "@/lib/supabase-client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

const navItems = [
  { to: "/", icon: Radio, label: "Pulse" },
  { to: "/projects", icon: GitBranch, label: "Plan" },
  { to: "/tasks", icon: CheckSquare, label: "My Tasks" },
  { to: "/initiatives", icon: Target, label: "Initiatives" },
  { to: "/agents", icon: Cpu, label: "Agents" },
  { to: "/environments", icon: Terminal, label: "Environments" },
]

// Project color palette (matching ios.pen design)
const projectColors = [
  "#3B82F6", // Blue
  "#10B981", // Green
  "#F97316", // Coral/Orange
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#F59E0B", // Amber
  "#06B6D4", // Cyan
  "#EF4444", // Red
]

export function Sidebar() {
  const { theme, setTheme } = useTheme()
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)
  const profile = useUserProfileStore((s) => s.profile)
  const projects = useProjectStore((s) => s.projects)
  const planNodes = usePlanStore((s) => s.nodes)
  const signOut = useAuthStore((s) => s.signOut)
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const navigate = useNavigate()
  const params = useParams()
  const showAuth = shouldUseSupabase()

  const activeProjectId = params.id
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

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

  const getInitials = (name: string) => {
    if (!name) return "U"
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
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

  return (
    <aside className="hidden md:flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-card">
      {/* Logo Section */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-5 py-5">
        <div className="relative">
          {/* Gradient hex with shadow */}
          <div className="relative flex h-7 w-7 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#60A5FA] via-[#3B82F6] to-[#2563EB]" style={{ boxShadow: '0px 2px 8px rgba(59, 130, 246, 0.25)' }}>
            <Hexagon className="h-4 w-4 text-white fill-white" />
          </div>
          <div
            className={cn(
              "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-white dark:border-card",
              connectionStatus === "connected" ? "bg-success" : connectionStatus === "checking" ? "bg-warning animate-pulse" : "bg-destructive"
            )}
          />
        </div>
        <span className="font-secondary text-xl font-semibold text-foreground">
          Nexus
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
      <nav className="flex flex-col gap-1 px-4 py-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-[15px] font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted/50"
              )
            }
          >
            <item.icon className="h-5 w-5" />
            <span className="flex-1">{item.label}</span>
          </NavLink>
        ))}
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
                <button
                  key={project.id}
                  onClick={() => navigate(`/project/${project.id}`)}
                  className={cn(
                    "flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 transition-colors text-left",
                    isActive
                      ? "bg-accent"
                      : "hover:bg-muted/50"
                  )}
                >
                  {/* Color dot */}
                  <div
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />

                  {/* Project name */}
                  <span className={cn(
                    "flex-1 text-sm truncate",
                    isActive
                      ? "text-accent-foreground font-semibold"
                      : "text-muted-foreground font-medium"
                  )}>
                    {project.name}
                  </span>

                  {/* Health bar */}
                  <div className="w-10 h-1 bg-muted rounded-sm overflow-hidden shrink-0">
                    <div
                      className="h-full rounded-sm bg-gradient-to-b from-[#60A5FA] to-[#3B82F6]"
                      style={{ width: `${healthWidth}px` }}
                    />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Spacer to push content to bottom */}
      <div className="flex-1" />

      {/* IndexedDB Mode Badge */}
      {!showAuth && (
        <div className="flex items-center gap-2 px-5 py-3 text-xs text-muted-foreground border-t border-border dark:border-border">
          <div className="h-2 w-2 rounded-full bg-yellow-500" />
          IndexedDB Mode (Local Only)
        </div>
      )}

      {/* Theme Toggle */}
      <div className="px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
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
            <AvatarFallback className="text-[13px] font-bold">{getInitials(profile.name)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col items-start gap-0.5 min-w-0">
            <span className="text-[13px] font-semibold text-foreground truncate w-full">
              {profile.name || "User"}
            </span>
            {profile.email && (
              <span className="text-[11px] text-muted-foreground truncate w-full">
                {profile.email}
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
