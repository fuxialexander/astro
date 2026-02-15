import { Link, useNavigate } from "react-router"
import {
  Plus,
  Eye,
  Activity,
  CircleCheck,
  Brain,
  Shield,
  Check,
  Play,
  FileText,
  Monitor,
  CheckCircle2,
  XCircle,
  Folder,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useRealtimeStore, type ActivityEvent } from "@/stores/realtime-store"
import { useUsageStore } from "@/stores/usage-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { cn } from "@/lib/utils"
import { formatRelativeTime } from "@/lib/date-utils"

const activityIcons: Record<string, { icon: typeof Activity; bg: string; color: string }> = {
  success: { icon: CheckCircle2, bg: "bg-green-500/10", color: "text-green-600" },
  failure: { icon: XCircle, bg: "bg-red-500/10", color: "text-red-600" },
  progress: { icon: Activity, bg: "bg-blue-500/10", color: "text-blue-600" },
  machine: { icon: Monitor, bg: "bg-purple-500/10", color: "text-purple-600" },
  file_change: { icon: FileText, bg: "bg-amber-500/10", color: "text-amber-600" },
}

function ActivityItem({ event }: { event: ActivityEvent }) {
  const config = activityIcons[event.type] || activityIcons.progress
  const Icon = config.icon

  return (
    <div className="flex items-center gap-3 py-2">
      <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", config.bg)}>
        <Icon className={cn("h-3.5 w-3.5", config.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs truncate">{event.text}</p>
      </div>
      <span className="text-[11px] text-muted-foreground shrink-0">{formatRelativeTime(event.timestamp)}</span>
    </div>
  )
}

export function Dashboard() {
  const projects = useProjectStore((s) => s.projects)
  const nodes = usePlanStore((s) => s.nodes)
  const updateNode = usePlanStore((s) => s.updateNode)
  const machines = useRealtimeStore((s) => s.machines)
  const activityFeed = useRealtimeStore((s) => s.activityFeed)
  const connected = useRealtimeStore((s) => s.connected)
  const sessionMetrics = useUsageStore((s) => s.sessionMetrics)
  const profile = useUserProfileStore((s) => s.profile)
  const navigate = useNavigate()

  const activeTasks = nodes.filter(
    (n) => n.status === "in_progress" || n.status === "dispatched"
  ).length
  const completedToday = nodes.filter(
    (n) => n.status === "completed" || n.status === "auto_verified"
  ).length
  const pendingDecisions = nodes.filter(
    (n) => n.status === "awaiting_judgment"
  ).length

  const pendingNodes = nodes.filter((n) => n.status === "awaiting_judgment")
  const activeProjects = projects.filter((p) => p.status === "active")

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header Row */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] font-semibold">
            Good morning{profile.name ? `, ${profile.name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            You have {pendingDecisions} pending decision{pendingDecisions !== 1 ? "s" : ""} and{" "}
            {activeTasks} active task{activeTasks !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild>
            <Link to="/projects/new">
              <Plus className="h-4 w-4" />
              New Project
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/settings">Settings</Link>
          </Button>
        </div>
      </div>

      {/* Stats Row - 3 cards */}
      <div className="grid grid-cols-3 gap-4">
        {/* Needs Attention */}
        <Card className="rounded-xl shadow-sm cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate("/tasks?status=awaiting_judgment")}>
          <CardContent className="flex items-center justify-between p-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Needs Attention</p>
              <p className="text-[32px] font-bold">{pendingDecisions}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-warning">
              <Eye className="h-6 w-6 text-warning-foreground" />
            </div>
          </CardContent>
        </Card>

        {/* Active Tasks */}
        <Card className="rounded-xl shadow-sm cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate("/tasks?status=in_progress")}>
          <CardContent className="flex items-center justify-between p-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Active Tasks</p>
              <p className="text-[32px] font-bold">{activeTasks}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-info">
              <Activity className="h-6 w-6 text-info-foreground" />
            </div>
          </CardContent>
        </Card>

        {/* Completed Today */}
        <Card className="rounded-xl shadow-sm cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate("/tasks?status=completed")}>
          <CardContent className="flex items-center justify-between p-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Completed Today</p>
              <p className="text-[32px] font-bold">{completedToday}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-success">
              <CircleCheck className="h-6 w-6 text-success-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Content Columns */}
      <div className="flex gap-6 flex-1">
        {/* Left Column: My Attention */}
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">My Attention</h2>
            <Button variant="outline" size="sm" asChild>
              <Link to="/tasks">View All</Link>
            </Button>
          </div>
          <div className="flex flex-col gap-3">
            {pendingNodes.length > 0 ? (
              pendingNodes.map((node) => {
                const project = projects.find((p) => p.id === node.projectId)
                return (
                  <Card key={node.id} className="rounded-xl shadow-sm">
                    <CardContent className="flex flex-col gap-0 p-0">
                      {/* Card Header */}
                      <div className="flex flex-col gap-3 p-5">
                        <div className="flex items-center justify-between">
                          <Badge variant="warning">Awaiting Judgment</Badge>
                          <span className="text-xs text-muted-foreground">
                            {project?.name}
                          </span>
                        </div>
                        <p className="text-base font-semibold">{node.title}</p>
                        <p className="text-sm text-muted-foreground">{node.description}</p>

                        {/* Confidence / Risk Row */}
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Brain className="h-4 w-4" />
                            <span>High confidence</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Shield className="h-4 w-4" />
                            <span>Low risk</span>
                          </div>
                        </div>

                        {/* Verification Evidence */}
                        <div className="rounded-lg bg-muted p-3.5">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 text-sm">
                              <Check className="h-4 w-4 text-green-600" />
                              <span>All tests passing</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <Check className="h-4 w-4 text-green-600" />
                              <span>Build successful</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Card Actions */}
                      <div className="flex items-center justify-between border-t px-5 py-4">
                        <input
                          type="text"
                          placeholder="Add guidance..."
                          className="flex-1 mr-3 rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <Button size="sm" onClick={() => updateNode(node.id, { status: "completed" })}>Approve</Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            ) : (
              <Card className="rounded-xl">
                <CardContent className="p-0">
                  <EmptyState
                    icon={CheckCircle2}
                    title="All caught up!"
                    description={activeTasks > 0
                      ? `Your agents are working on ${activeTasks} task${activeTasks !== 1 ? 's' : ''}. You'll be notified when decisions need your input.`
                      : "No active tasks running. Start executing your plan to see progress here."
                    }
                    action={activeTasks === 0 && projects.length > 0 ? {
                      label: "View Projects",
                      onClick: () => navigate("/projects"),
                    } : undefined}
                    variant="success"
                    className="py-6"
                  />
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="flex w-[400px] shrink-0 flex-col gap-6">
          {/* Active Projects */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Active Projects</h2>
              <Button variant="outline" size="sm" asChild>
                <Link to="/projects?status=active">View All</Link>
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {activeProjects.length > 0 ? (
                activeProjects.slice(0, 4).map((project) => {
                  const projectTasks = nodes.filter(
                    (n) =>
                      n.projectId === project.id &&
                      (n.status === "in_progress" || n.status === "dispatched")
                  )
                  return (
                    <Link key={project.id} to={`/project/${project.id}`}>
                      <Card className="rounded-xl hover:border-primary/40 transition-colors">
                        <CardContent className="flex items-center justify-between p-4">
                          <div className="flex flex-col gap-0.5">
                            <p className="text-sm font-semibold">{project.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {projectTasks.length} task{projectTasks.length !== 1 ? "s" : ""} in
                              progress
                            </p>
                          </div>
                          <Badge variant="success">Active</Badge>
                        </CardContent>
                      </Card>
                    </Link>
                  )
                })
              ) : (
                <Card className="rounded-xl">
                  <CardContent className="p-0">
                    <EmptyState
                      icon={Folder}
                      title="No active projects"
                      description="Create a project to get started with AI-assisted planning and execution."
                      action={{
                        label: "Create Project",
                        onClick: () => navigate("/projects/new"),
                      }}
                      className="py-6"
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* System Health */}
          <Card className="flex-1 rounded-xl shadow-sm">
            <CardContent className="flex flex-col p-0">
              {/* Header */}
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="text-base font-semibold">System Health</h2>
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      connected ? "bg-green-500" : "bg-muted-foreground"
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs font-medium",
                      connected ? "text-green-600" : "text-muted-foreground"
                    )}
                  >
                    {connected ? "Live" : "Offline"}
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="flex flex-col gap-4 p-5">
                {/* Metrics Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-[11px] font-medium text-muted-foreground">Token Spend</p>
                    <p className="text-lg font-semibold">${sessionMetrics.totalCostUsd.toFixed(2)}</p>
                    <p className="text-[11px] text-muted-foreground">session</p>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-[11px] font-medium text-muted-foreground">Throughput</p>
                    <p className="text-lg font-semibold">{sessionMetrics.tasksCompleted}/{sessionMetrics.tasksCompleted + sessionMetrics.tasksFailed}</p>
                    <p className="text-[11px] text-muted-foreground">tasks</p>
                  </div>
                </div>

                {/* Active Agents */}
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Active Agents
                  </p>
                  {machines.size > 0 ? (
                    Array.from(machines.values()).map((machine) => (
                      <div key={machine.machineId} className="flex items-center gap-2 py-1">
                        <div
                          className={cn(
                            "h-2 w-2 rounded-full",
                            machine.connectionStatus === "connected"
                              ? "bg-green-500"
                              : "bg-muted-foreground"
                          )}
                        />
                        <span className="text-sm flex-1 truncate">
                          {machine.name || machine.machineId}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {machine.load.activeTasks > 0
                            ? `${machine.load.activeTasks} task${machine.load.activeTasks !== 1 ? "s" : ""}`
                            : "Idle"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-2 py-1">
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      <span className="text-sm flex-1">Claude</span>
                      <span className="text-xs text-muted-foreground">
                        <Play className="h-3 w-3 inline mr-1" />
                        Running
                      </span>
                    </div>
                  )}
                </div>

                {/* Recent Events */}
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Recent Events
                  </p>
                  {activityFeed.length > 0 ? (
                    activityFeed.slice(0, 5).map((event) => (
                      <ActivityItem key={event.id} event={event} />
                    ))
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-4 text-center">
                      <Zap className="h-5 w-5 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">
                        {connected
                          ? "No agents running. Start executing your plan to see activity."
                          : "Connect to see real-time agent activity."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
