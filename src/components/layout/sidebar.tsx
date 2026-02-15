import { NavLink, useNavigate } from "react-router"
import { Hexagon, LayoutDashboard, CheckSquare, Settings, Folder, Monitor, LogOut, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useAuthStore } from "@/stores/auth-store"
import { shouldUseSupabase } from "@/lib/supabase-client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/projects", icon: Folder, label: "Projects" },
  { to: "/tasks", icon: CheckSquare, label: "My Tasks" },
  { to: "/environments", icon: Monitor, label: "Environments" },
]

export function Sidebar() {
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)
  const profile = useUserProfileStore((s) => s.profile)
  const signOut = useAuthStore((s) => s.signOut)
  const navigate = useNavigate()
  const showAuth = shouldUseSupabase()

  const getInitials = (name: string) => {
    if (!name) return "U"
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const handleSignOut = async () => {
    await signOut()
    navigate("/login")
  }

  return (
    <aside className="hidden md:flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-white dark:bg-[#0D1117] dark:border-[#1E293B]/25">
      {/* Logo Section */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-5 py-5">
        <div className="relative">
          <Hexagon className="h-6 w-6 text-primary" />
          <div
            className={cn(
              "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-white dark:border-[#0D1117]",
              connectionStatus === "connected" ? "bg-success" : connectionStatus === "checking" ? "bg-warning animate-pulse" : "bg-destructive"
            )}
          />
        </div>
        <span className="font-primary text-xl font-semibold text-foreground">
          Nexus
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-1 px-5 py-6">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition-colors",
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

      {/* IndexedDB Mode Badge */}
      {!showAuth && (
        <div className="flex items-center gap-2 px-5 py-3 text-xs text-muted-foreground border-t border-border dark:border-[#1E293B]/25">
          <div className="h-2 w-2 rounded-full bg-yellow-500" />
          IndexedDB Mode (Local Only)
        </div>
      )}

      {/* User Profile */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2.5 border-t border-border dark:border-[#1E293B]/25 px-5 py-3 hover:bg-muted/50 transition-colors">
            <Avatar className="h-8 w-8">
              <AvatarImage src={profile.avatarUrl} />
              <AvatarFallback className="text-[13px] font-bold">{getInitials(profile.name)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-1 flex-col items-start gap-0.5 min-w-0">
              <span className="text-[13px] font-semibold text-foreground truncate w-full">
                {profile.name || "User"}
              </span>
              {profile.email && (
                <span className="text-[11px] text-muted-foreground truncate w-full">
                  {profile.email}
                </span>
              )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => navigate("/settings")}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
          {showAuth && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </aside>
  )
}
