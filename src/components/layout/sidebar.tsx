import { NavLink, useNavigate } from "react-router"
import { Hexagon, LayoutDashboard, Eye, Inbox, Scale, Settings, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/attention", icon: Eye, label: "My Attention" },
  { to: "/inbox", icon: Inbox, label: "Inbox" },
  { to: "/judgment", icon: Scale, label: "Judgment Queue" },
]

export function Sidebar() {
  const projects = useProjectStore((s) => s.projects)
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

      <nav className="flex flex-col gap-0.5 px-4 py-2">
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

      <Separator className="mx-4 bg-sidebar-border" />

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">
          Projects
        </span>
        <button
          onClick={() => navigate("/projects/new")}
          className="rounded p-0.5 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <ScrollArea className="flex-1 px-4 py-1">
        <div className="flex flex-col gap-0.5">
          {projects.filter(p => p.status === "active").map((project) => (
            <NavLink
              key={project.id}
              to={`/project/${project.id}`}
              className={({ isActive }) =>
                cn(
                  "flex h-8 items-center rounded-md px-2.5 text-sm truncate transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                )
              }
            >
              {project.name}
            </NavLink>
          ))}
        </div>
      </ScrollArea>

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
