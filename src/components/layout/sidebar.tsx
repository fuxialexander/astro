import { NavLink, useNavigate } from "react-router"
import { Hexagon, LayoutDashboard, CheckSquare, Settings, Folder, Monitor, LogOut, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useAuthStore } from "@/stores/auth-store"
import { shouldUseSupabase } from "@/lib/supabase-client"
import { Separator } from "@/components/ui/separator"
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
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-3 px-4 bg-sidebar-accent/20">
        <div className="relative">
          <Hexagon className="h-6 w-6 text-primary" />
          <div
            className={cn(
              "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-sidebar",
              connectionStatus === "connected" ? "bg-success" : connectionStatus === "checking" ? "bg-warning animate-pulse" : "bg-destructive"
            )}
          />
        </div>
        <span className="font-primary text-lg font-semibold tracking-tight text-sidebar-primary-foreground">
          Nexus
        </span>
      </div>

      <Separator className="bg-sidebar-border" />

      <nav className="flex flex-1 flex-col gap-0.5 px-4 py-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )
            }
          >
            <item.icon className="h-[18px] w-[18px]" />
            <span className="flex-1">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <Separator className="bg-sidebar-border" />

      {!showAuth && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
          <div className="h-2 w-2 rounded-full bg-yellow-500" />
          IndexedDB Mode (Local Only)
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-3 px-4 py-3 hover:bg-sidebar-accent/50 transition-colors">
            <Avatar>
              <AvatarImage src={profile.avatarUrl} />
              <AvatarFallback>{getInitials(profile.name)}</AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate text-left text-sm text-sidebar-accent-foreground">
              {profile.name || "User"}
            </span>
            <ChevronRight className="h-4 w-4 text-sidebar-foreground" />
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
