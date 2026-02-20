import { useEffect, useMemo } from "react"
import { Link, useNavigate } from "react-router"
import {
  Plus,
  Eye,
  Activity,
  CircleCheck,
  Check,
  FileText,
  Monitor,
  CheckCircle2,
  XCircle,
  Folder,
  Zap,
  AlertCircle,
  RotateCcw,
  Scissors,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useRealtimeStore, type ActivityEvent } from "@/stores/realtime-store"
import { useUsageStore } from "@/stores/usage-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useExecutionStore } from "@/stores/execution-store"
import { ApprovalCard } from "@/components/approval-card"
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
  const projectsLoaded = useProjectStore((s) => s.loaded)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const updateNode = usePlanStore((s) => s.updateNode)
  const machines = useRealtimeStore((s) => s.machines)
  const activityFeed = useRealtimeStore((s) => s.activityFeed)
  const connected = useRealtimeStore((s) => s.connected)
  const sessionMetrics = useUsageStore((s) => s.sessionMetrics)
  const profile = useUserProfileStore((s) => s.profile)
  const pendingApprovals = useExecutionStore((s) => s.pendingApprovals)
  const respondToApproval = useExecutionStore((s) => s.respondToApproval)
  const getExecution = useExecutionStore((s) => s.getExecution)
  const executionsLoaded = useExecutionStore((s) => s.loaded)
  const navigate = useNavigate()

  // Redirect first-time users to welcome screen (dashboard is now secondary)
  useEffect(() => {
    if (projectsLoaded && projects.length === 0) {
      navigate("/welcome")
    }
  }, [projectsLoaded, projects.length, navigate])

  const activeTasks = nodes.filter(
    (n) => n.status === "in_progress" || n.status === "dispatched"
  ).length
  const completedToday = nodes.filter(
    (n) => n.status === "completed" || n.status === "auto_verified"
  ).length
  const pendingDecisions = nodes.filter(
    (n) => n.status === "awaiting_judgment" || n.status === "awaiting_approval"
  ).length

  const pendingNodes = nodes.filter((n) => n.status === "awaiting_judgment" || n.status === "awaiting_approval")
  const activeProjects = projects.filter((p) => p.status === "active")

  return (
    <div className="flex flex-col gap-4 p-4 md:gap-6 md:p-8">
      {/* Header Row */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold font-secondary md:text-[28px]">
            Good morning{profile.name && !profile.name.includes("@") ? `, ${profile.name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            You have {pendingDecisions} pending decision{pendingDecisions !== 1 ? "s" : ""} and{" "}
            {activeTasks} active task{activeTasks !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <Button asChild className="min-h-11">
            <Link to="/projects/new">
              <Plus className="h-4 w-4" />
              New Project
            </Link>
          </Button>
          <Button variant="outline" asChild className="min-h-11">
            <Link to="/settings">Settings</Link>
          </Button>
        </div>
      </div>

      {/* Stats Row - 3 cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {/* Needs Attention */}
        <Card className="w-full rounded-2xl shadow cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate("/tasks?status=awaiting_judgment")}>
          <CardContent className="flex items-center justify-between p-4 md:p-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Needs Attention</p>
              <p className="text-2xl font-bold md:text-[32px]">{pendingDecisions}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning md:h-12 md:w-12">
              <Eye className="h-5 w-5 text-warning-foreground md:h-6 md:w-6" />
            </div>
          </CardContent>
        </Card>

        {/* Active Tasks */}
        <Card className="w-full rounded-2xl shadow cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate("/tasks?status=in_progress")}>
          <CardContent className="flex items-center justify-between p-4 md:p-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Active Tasks</p>
              <p className="text-2xl font-bold md:text-[32px]">{activeTasks}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-info md:h-12 md:w-12">
              <Activity className="h-5 w-5 text-info-foreground md:h-6 md:w-6" />
            </div>
          </CardContent>
        </Card>

        {/* Completed Today */}
        <Card className="w-full rounded-2xl shadow cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate("/tasks?status=completed")}>
          <CardContent className="flex items-center justify-between p-4 md:p-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Completed Today</p>
              <p className="text-2xl font-bold md:text-[32px]">{completedToday}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success md:h-12 md:w-12">
              <CircleCheck className="h-5 w-5 text-success-foreground md:h-6 md:w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Content Columns */}
      <div className="flex flex-col gap-4 md:flex-row md:gap-6 flex-1">
        {/* Left Column: My Attention */}
        <div className="flex flex-1 flex-col gap-3 md:gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold md:text-lg">My Attention</h2>
            <Button variant="outline" size="sm" asChild className="min-h-9">
              <Link to="/tasks">View All</Link>
            </Button>
          </div>
          <div className="flex flex-col gap-3">
            {pendingNodes.length > 0 ? (
              pendingNodes.map((node) => {
                const project = projects.find((p) => p.id === node.projectId)
                // Check if this node has a pending approval request
                const approval = Array.from(pendingApprovals.values()).find(
                  (a) => a.nodeId === node.id
                )

                // If awaiting approval, show ApprovalCard
                if (node.status === "awaiting_approval" && approval) {
                  return (
                    <ApprovalCard
                      key={node.id}
                      approval={approval}
                      onRespond={respondToApproval}
                    />
                  )
                }

                // Otherwise, show judgment card
                const execution = getExecution(node.id)
                const summary = execution?.summary
                const error = node.executionError || execution?.error

                // Check if we're still loading executions data
                const isLoadingExecution = !executionsLoaded && !execution

                return (
                  <Card key={node.id} className="rounded-2xl shadow-lg">
                    <CardContent className="flex flex-col gap-0 p-0">
                      {/* Card Header */}
                      <div className="flex flex-col gap-3 p-5">
                        <div className="flex items-center justify-between">
                          <StatusBadge status="awaiting" />
                          <span className="text-xs text-muted-foreground">
                            {project?.name}
                          </span>
                        </div>
                        <Link to={`/project/${node.projectId}/task/${node.id}`} className="text-base font-semibold text-foreground hover:underline">
                          {node.title}
                        </Link>
                        <p className="text-sm text-muted-foreground line-clamp-2">{node.description}</p>

                        {/* Summary or Error or Loading */}
                        {isLoadingExecution ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Loading execution data...</span>
                          </div>
                        ) : summary ? (
                          <div className={cn(
                            "rounded-lg border p-3.5",
                            summary.status === 'success' ? "border-green-500/30 bg-green-500/5" :
                            summary.status === 'partial' ? "border-yellow-500/30 bg-yellow-500/5" :
                            "border-red-500/30 bg-red-500/5"
                          )}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <Badge variant={summary.status === 'success' ? 'success' : summary.status === 'partial' ? 'warning' : 'destructive'} className="text-[10px]">
                                {summary.status}
                              </Badge>
                              {summary.filesChanged.length > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                  {summary.filesChanged.length} file{summary.filesChanged.length !== 1 ? 's' : ''} changed
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-foreground">{summary.workCompleted}</p>
                            {summary.followUps.length > 0 && (
                              <ul className="mt-2">
                                {summary.followUps.map((f, i) => (
                                  <li key={i} className="text-xs text-muted-foreground">- {f}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : error ? (
                          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3.5">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                              <p className="text-sm text-red-600 line-clamp-3">{error}</p>
                            </div>
                          </div>
                        ) : executionsLoaded && execution ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Generating summary...</span>
                          </div>
                        ) : executionsLoaded && !execution ? (
                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                              <p className="text-sm text-amber-700">Execution data not found. The task may have completed before execution tracking was enabled.</p>
                            </div>
                          </div>
                        ) : null}

                        {/* Plan Mode Data: Todos */}
                        {execution?.planTodos && execution.planTodos.length > 0 && (
                          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3.5">
                            <div className="flex items-center gap-2 mb-2">
                              <FileText className="h-4 w-4 text-blue-600" />
                              <span className="text-xs font-semibold text-blue-700">Plan Todos</span>
                            </div>
                            <ul className="space-y-1.5">
                              {execution.planTodos.map((todo, i) => (
                                <li key={i} className="flex items-start gap-2 text-xs">
                                  {todo.status === 'completed' ? (
                                    <Check className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
                                  ) : todo.status === 'in_progress' ? (
                                    <Loader2 className="h-3.5 w-3.5 text-blue-600 mt-0.5 shrink-0 animate-spin" />
                                  ) : (
                                    <div className="h-3.5 w-3.5 mt-0.5 shrink-0 rounded-full border border-muted-foreground" />
                                  )}
                                  <span className={cn(
                                    todo.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'
                                  )}>{todo.content}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Plan Mode Data: Questions */}
                        {execution?.planQuestions && execution.planQuestions.length > 0 && (
                          <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3.5">
                            <div className="flex items-center gap-2 mb-2">
                              <AlertCircle className="h-4 w-4 text-purple-600" />
                              <span className="text-xs font-semibold text-purple-700">Plan Questions</span>
                            </div>
                            <ul className="space-y-2">
                              {execution.planQuestions.map((q, i) => (
                                <li key={i} className="text-xs">
                                  <p className="font-medium text-foreground mb-1">{q.question}</p>
                                  <ul className="ml-3 space-y-0.5">
                                    {q.options.map((opt, j) => (
                                      <li key={j} className="text-muted-foreground">• {opt}</li>
                                    ))}
                                  </ul>
                                  {q.answer && (
                                    <p className="mt-1 text-purple-700 font-medium">Answer: {q.answer}</p>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Card Actions */}
                      <div className="flex items-center gap-2 border-t px-4 py-3 md:px-5 md:py-4">
                        <Button size="sm" onClick={() => updateNode(node.id, { status: "completed" })} className="min-h-9">
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Approve
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => updateNode(node.id, { status: "planned" })} className="min-h-9">
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          Retry
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => updateNode(node.id, { status: "pruned" })} className="min-h-9 text-muted-foreground">
                          <Scissors className="h-3.5 w-3.5 mr-1" />
                          Prune
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            ) : (
              <Card className="rounded-2xl">
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
        <div className="flex w-full shrink-0 flex-col gap-4 md:w-[400px] md:gap-6">
          {/* Active Projects */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold md:text-lg">Active Projects</h2>
              <Button variant="outline" size="sm" asChild className="min-h-9">
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
                    <Link key={project.id} to={`/project/${project.id}/graph`}>
                      <Card className="rounded-2xl hover:border-primary/40 transition-colors">
                        <CardContent className="flex items-center justify-between p-4">
                          <div className="flex flex-col gap-0.5">
                            <p className="text-sm font-semibold text-foreground">{project.name}</p>
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
                <Card className="rounded-2xl">
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
          <Card className="flex-1 rounded-2xl shadow">
            <CardContent className="flex flex-col p-0">
              {/* Header */}
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="text-base font-semibold text-foreground">System Health</h2>
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
                    <p className="text-xs text-muted-foreground py-1">
                      No machines connected. Add one in Environments.
                    </p>
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
