import { Link } from "react-router"
import { Plus, Settings, Activity, CheckCircle2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"

export function Dashboard() {
  const projects = useProjectStore((s) => s.projects)
  const nodes = usePlanStore((s) => s.nodes)

  const activeAgents = 7
  const completedToday = nodes.filter((n) => n.status === "completed").length
  const pendingDecisions = nodes.filter((n) => n.status === "awaiting_judgment").length

  return (
    <div className="flex flex-col gap-7 p-8 px-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Good morning</h1>
        <div className="flex items-center gap-3">
          <Button asChild>
            <Link to="/projects/new">
              <Plus className="h-4 w-4" />
              New Project
            </Link>
          </Button>
          <Button variant="secondary" size="icon">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Active Agents</p>
            <p className="mt-1 font-primary text-xl font-bold">{activeAgents} running</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Tasks Completed</p>
            <p className="mt-1 font-primary text-xl font-bold">{completedToday} today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Pending Decisions</p>
            <p className="mt-1 font-primary text-xl font-bold text-primary">{pendingDecisions}</p>
          </CardContent>
        </Card>
      </div>

      {/* Content row */}
      <div className="flex gap-5 flex-1">
        {/* Left: Decisions */}
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Pending Decisions</h2>
            <Link to="/judgment" className="text-sm text-muted-foreground hover:text-foreground">
              View all
            </Link>
          </div>
          {nodes.filter(n => n.status === "awaiting_judgment").map((node) => (
            <Card key={node.id} className="cursor-pointer hover:border-primary/40 transition-colors">
              <CardContent className="flex items-start gap-3 p-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{node.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 truncate">{node.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="warning" className="text-[10px]">Awaiting Judgment</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {projects.find(p => p.id === node.projectId)?.name}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {nodes.filter(n => n.status === "awaiting_judgment").length === 0 && (
            <p className="text-sm text-muted-foreground">No pending decisions</p>
          )}
        </div>

        {/* Right: Projects + Activity */}
        <div className="flex w-[340px] shrink-0 flex-col gap-5">
          <h2 className="text-base font-semibold">Active Projects</h2>
          {projects.filter(p => p.status === "active").slice(0, 2).map((project) => (
            <Link key={project.id} to={`/project/${project.id}`}>
              <Card className="hover:border-primary/40 transition-colors">
                <CardContent className="p-4 flex flex-col gap-2">
                  <p className="font-medium text-sm">{project.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{project.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className="text-[10px]">Active</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}

          <h2 className="text-base font-semibold mt-2">Agent Activity</h2>
          <div className="flex flex-col gap-2">
            {[
              { icon: CheckCircle2, text: "Auth module tests passed", time: "2m ago", color: "text-green-600" },
              { icon: Activity, text: "GraphQL resolvers generating", time: "5m ago", color: "text-blue-500" },
              { icon: CheckCircle2, text: "DB migration applied", time: "12m ago", color: "text-green-600" },
              { icon: Activity, text: "Navigation UI in progress", time: "18m ago", color: "text-amber-500" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <item.icon className={`h-4 w-4 shrink-0 ${item.color}`} />
                <span className="flex-1 truncate">{item.text}</span>
                <span className="text-xs text-muted-foreground">{item.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
