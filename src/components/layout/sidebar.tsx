import { NavLink, useNavigate } from "react-router"
import { Hexagon, LayoutDashboard, CheckSquare, Inbox, Scale, Settings, Folder } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/projects", icon: Folder, label: "Projects" },
  { to: "/tasks", icon: CheckSquare, label: "My Tasks" },
  { to: "/inbox", icon: Inbox, label: "Inbox" },
  { to: "/judgment", icon: Scale, label: "Judgment Queue" },
]

export function Sidebar() {
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)
  const navigate = useNavigate()

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center gap-2.5 px-4">
        <div className="relative">
          <Hexagon className="h-6 w-6 text-primary" />
          <div
            className={cn(
              "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-sidebar",
              connectionStatus === "connected" ? "bg-success" : connectionStatus === "checking" ? "bg-warning animate-pulse" : "bg-destructive"
            )}
          />
        </div>
        <span className="font-primary text-lg font-bold text-sidebar-primary-foreground">
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

      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar>
          <AvatarFallback>U</AvatarFallback>
        </Avatar>
        <span className="flex-1 truncate text-sm text-sidebar-accent-foreground">User</span>
        <button onClick={() => navigate("/settings")} className="rounded p-1 text-sidebar-foreground hover:bg-sidebar-accent cursor-pointer">
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </aside>
  )
}
