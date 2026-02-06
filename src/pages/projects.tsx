import { Link } from "react-router"
import { Folder, Filter, Plus, ChevronDown, Rocket, FlaskConical, Circle, CheckCircle2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Header } from "@/components/layout/header"
import { useProjectStore } from "@/stores/project-store"

const statusConfig: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-green-500" },
  archived: { label: "Archived", color: "bg-gray-400" },
}

function HealthDot({ health }: { health: "good" | "warning" | "critical" }) {
  const colors = { good: "text-green-500", warning: "text-amber-500", critical: "text-red-500" }
  return health === "good" ? (
    <CheckCircle2 className={`h-3.5 w-3.5 ${colors[health]}`} />
  ) : health === "warning" ? (
    <AlertTriangle className={`h-3.5 w-3.5 ${colors[health]}`} />
  ) : (
    <Circle className={`h-3.5 w-3.5 ${colors[health]}`} />
  )
}

const projectMeta: Record<string, { group: string; health: "good" | "warning" | "critical"; agents: number; progress: number; start: string; target: string }> = {
  "proj-1": { group: "Product Development", health: "good", agents: 4, progress: 65, start: "Jan 15", target: "Mar 30" },
  "proj-2": { group: "Product Development", health: "good", agents: 3, progress: 30, start: "Feb 1", target: "May 15" },
  "proj-3": { group: "Product Development", health: "warning", agents: 2, progress: 15, start: "Feb 3", target: "Apr 1" },
  "proj-4": { group: "Research", health: "good", agents: 0, progress: 0, start: "Mar 1", target: "Jun 15" },
  "proj-5": { group: "Research", health: "critical", agents: 1, progress: 85, start: "Dec 10", target: "Feb 10" },
}

export function Projects() {
  const projects = useProjectStore((s) => s.projects)

  const groups = projects.reduce<Record<string, typeof projects>>((acc, p) => {
    const group = projectMeta[p.id]?.group ?? "Other"
    ;(acc[group] ??= []).push(p)
    return acc
  }, {})

  return (
    <div className="flex h-full flex-col">
      <Header>
        <div className="flex items-center gap-3">
          <Folder className="h-[18px] w-[18px] text-muted-foreground" />
          <span className="text-base font-semibold">Projects</span>
          <div className="flex items-center rounded-lg bg-secondary p-1 gap-0.5">
            <span className="rounded-md bg-card px-3.5 py-1 text-xs font-medium">List</span>
            <span className="rounded-md px-3.5 py-1 text-xs text-muted-foreground">Board</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm">
            <Filter className="h-3.5 w-3.5" />
            Filter
          </Button>
          <Button variant="secondary" size="sm">
            Display
          </Button>
          <Button size="sm" asChild>
            <Link to="/projects/new">
              <Plus className="h-3.5 w-3.5" />
              New Project
            </Link>
          </Button>
        </div>
      </Header>

      {/* Column headers */}
      <div className="flex items-center border-b border-border px-6 h-9">
        <span className="w-[340px] text-[11px] font-semibold text-muted-foreground uppercase">Name</span>
        <span className="w-[100px] text-[11px] font-semibold text-muted-foreground uppercase">Status</span>
        <span className="w-[80px] text-[11px] font-semibold text-muted-foreground uppercase">Health</span>
        <span className="w-[70px] text-[11px] font-semibold text-muted-foreground uppercase">Agents</span>
        <span className="w-[100px] text-[11px] font-semibold text-muted-foreground uppercase">Progress</span>
        <span className="w-[80px] text-[11px] font-semibold text-muted-foreground uppercase">Start</span>
        <span className="w-[80px] text-[11px] font-semibold text-muted-foreground uppercase">Target</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-auto">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <div className="flex items-center gap-2 bg-muted px-6 h-9">
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              {group === "Product Development" ? (
                <Rocket className="h-3.5 w-3.5 text-primary" />
              ) : (
                <FlaskConical className="h-3.5 w-3.5 text-status-info-foreground" />
              )}
              <span className="text-xs font-semibold">{group}</span>
              <span className="text-[11px] font-primary text-muted-foreground">{items.length}</span>
            </div>
            {items.map((project) => {
              const meta = projectMeta[project.id]
              const status = statusConfig[project.status]
              return (
                <Link
                  key={project.id}
                  to={`/project/${project.id}`}
                  className="flex items-center border-b border-border px-6 h-12 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex w-[340px] items-center gap-2.5">
                    <span className="text-sm">{project.name}</span>
                  </div>
                  <div className="w-[100px]">
                    <Badge variant="secondary" className="text-[10px] gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${status.color}`} />
                      {status.label}
                    </Badge>
                  </div>
                  <div className="w-[80px] flex items-center gap-1">
                    {meta && <HealthDot health={meta.health} />}
                  </div>
                  <div className="w-[70px] font-primary text-xs">
                    {meta?.agents ?? 0}
                  </div>
                  <div className="w-[100px] flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${meta?.progress ?? 0}%` }}
                      />
                    </div>
                    <span className="font-primary text-[11px] text-muted-foreground">{meta?.progress ?? 0}%</span>
                  </div>
                  <div className="w-[80px] font-primary text-[11px] text-muted-foreground">
                    {meta?.start}
                  </div>
                  <div className={`w-[80px] font-primary text-[11px] ${meta?.health === "critical" ? "text-red-500" : "text-muted-foreground"}`}>
                    {meta?.target}
                  </div>
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
