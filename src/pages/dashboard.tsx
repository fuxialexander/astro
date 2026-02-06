import { Link } from "react-router"
import { Plus, AlertCircle, Activity, CheckCircle2, FileText, Monitor, XCircle, Server } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useRealtimeStore, type ActivityEvent } from "@/stores/realtime-store"
import { useSlurmStore } from "@/stores/slurm-store"
import { ClusterStatus } from "@/components/slurm/cluster-status"
import { JobList } from "@/components/slurm/job-list"
import { useEffect } from "react"

function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diff = now - new Date(date).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

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
    <div className="flex items-center gap-3 py-3">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config.bg}`}>
        <Icon className={`h-4 w-4 ${config.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{event.text}</p>
        <p className="text-xs text-muted-foreground">{formatRelativeTime(event.timestamp)}</p>
      </div>
    </div>
  )
}

export function Dashboard() {
  const projects = useProjectStore((s) => s.projects)
  const nodes = usePlanStore((s) => s.nodes)
  const machines = useRealtimeStore((s) => s.machines)
  const activityFeed = useRealtimeStore((s) => s.activityFeed)
  const connected = useRealtimeStore((s) => s.connected)

  // Slurm/HPC state
  const slurmClusters = useSlurmStore((s) => s.clusters)
  const fetchClusters = useSlurmStore((s) => s.fetchClusters)
  const getActiveJobs = useSlurmStore((s) => s.getActiveJobs)
  const getQueuedJobs = useSlurmStore((s) => s.getQueuedJobs)

  // Fetch Slurm clusters on mount
  useEffect(() => {
    fetchClusters()
  }, [fetchClusters])

  const connectedClusters = slurmClusters.filter(c => c.connectionStatus === 'connected')
  const activeHpcJobs = getActiveJobs()
  const queuedHpcJobs = getQueuedJobs()

  const activeTasks = nodes.filter((n) => n.status === "in_progress" || n.status === "dispatched").length + activeHpcJobs.length
  const completedToday = nodes.filter((n) => n.status === "completed" || n.status === "auto_verified").length
  const pendingDecisions = nodes.filter((n) => n.status === "awaiting_judgment").length

  return (
    <div className="flex flex-col gap-6 p-8 px-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-primary text-[28px] font-semibold">Good morning, Alex</h1>
          <p className="text-sm text-muted-foreground">
            You have {pendingDecisions} pending decision{pendingDecisions !== 1 ? "s" : ""} and {activeTasks} active task{activeTasks !== 1 ? "s" : ""}
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

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Pending Decisions</p>
              <p className="font-primary text-[32px] font-bold">{pendingDecisions}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-status-warning/10">
              <AlertCircle className="h-6 w-6 text-status-warning" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Active Tasks</p>
              <p className="font-primary text-[32px] font-bold">{activeTasks}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
              <Activity className="h-6 w-6 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Completed Today</p>
              <p className="font-primary text-[32px] font-bold">{completedToday}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">HPC Clusters</p>
              <p className="font-primary text-[32px] font-bold">{connectedClusters.length}</p>
              <p className="text-xs text-muted-foreground">
                {activeHpcJobs.length + queuedHpcJobs.length} jobs
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10">
              <Server className="h-6 w-6 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Content Columns */}
      <div className="flex gap-6 flex-1">
        {/* Left: Pending Decisions */}
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pending Decisions</h2>
            <Button variant="outline" size="sm" asChild>
              <Link to="/judgment">View All</Link>
            </Button>
          </div>
          <div className="flex flex-col gap-3">
            {nodes.filter(n => n.status === "awaiting_judgment").map((node) => (
              <Card key={node.id}>
                <CardContent className="flex flex-col gap-3 p-5">
                  <div className="flex items-center justify-between">
                    <Badge variant="warning">Awaiting Judgment</Badge>
                    <span className="text-xs text-muted-foreground">
                      {projects.find(p => p.id === node.projectId)?.name}
                    </span>
                  </div>
                  <p className="text-base font-semibold">{node.title}</p>
                  <p className="text-sm text-muted-foreground">{node.description}</p>
                  <div className="flex justify-end gap-3 border-t border-border pt-4">
                    <Button variant="outline" size="sm">Reject</Button>
                    <Button size="sm">Approve</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {nodes.filter(n => n.status === "awaiting_judgment").length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">No pending decisions</p>
            )}
          </div>
        </div>

        {/* Right: Projects + Agent Activity + HPC */}
        <div className="flex w-[400px] shrink-0 flex-col gap-6">
          {/* Active Projects */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Active Projects</h2>
              <Button variant="outline" size="sm" asChild>
                <Link to="/projects">View All</Link>
              </Button>
            </div>
            {projects.filter(p => p.status === "active").slice(0, 2).map((project) => (
              <Link key={project.id} to={`/project/${project.id}`}>
                <Card className="hover:border-primary/40 transition-colors">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{project.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{project.description}</p>
                    </div>
                    <Badge variant="secondary">Active</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Agent Activity */}
          <Card className="flex-1">
            <CardContent className="flex flex-col p-0">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h2 className="text-base font-semibold">Agent Activity</h2>
                <div className="flex items-center gap-1.5">
                  <div className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-muted-foreground"}`} />
                  <span className={`text-xs font-medium ${connected ? "text-green-600" : "text-muted-foreground"}`}>
                    {connected ? "Live" : "Offline"}
                  </span>
                </div>
              </div>
              <div className="flex flex-col px-5">
                {activityFeed.length > 0 ? (
                  activityFeed.slice(0, 8).map((event) => (
                    <ActivityItem key={event.id} event={event} />
                  ))
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {connected
                      ? `${machines.size} machine${machines.size !== 1 ? "s" : ""} connected. Waiting for activity...`
                      : "Connect to see real-time agent activity"}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* HPC Cluster Status */}
          {connectedClusters.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">HPC Jobs</h2>
              {activeHpcJobs.length > 0 || queuedHpcJobs.length > 0 ? (
                <>
                  <JobList filter="active" maxItems={3} compact showCluster />
                  {queuedHpcJobs.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {queuedHpcJobs.length} job{queuedHpcJobs.length > 1 ? 's' : ''} queued
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No active HPC jobs</p>
              )}
            </div>
          )}

          {/* Cluster Status Compact */}
          {slurmClusters.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Clusters</h2>
              <ClusterStatus compact />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
