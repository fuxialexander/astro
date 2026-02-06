/**
 * Slurm Job List Component
 *
 * Displays a list of Slurm jobs with status, queue position, and actions.
 */

import { useEffect } from "react"
import {
  Clock,
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Timer,
  Server,
  Hash,
  Cpu,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  useSlurmStore,
  getJobStateColor,
  getJobStateLabel,
  formatSlurmTime,
  type SlurmJob,
  type SlurmJobState,
} from "@/stores/slurm-store"

interface JobListProps {
  filter?: 'all' | 'active' | 'queued' | 'completed'
  projectId?: string
  clusterId?: string
  maxItems?: number
  showCluster?: boolean
  compact?: boolean
}

export function JobList({
  filter = 'all',
  projectId,
  clusterId,
  maxItems,
  showCluster = true,
  compact = false,
}: JobListProps) {
  const allJobs = useSlurmStore((s) => s.jobs)
  const loading = useSlurmStore((s) => s.loading)
  const fetchJobs = useSlurmStore((s) => s.fetchJobs)
  const getActiveJobs = useSlurmStore((s) => s.getActiveJobs)
  const getQueuedJobs = useSlurmStore((s) => s.getQueuedJobs)
  const getCompletedJobs = useSlurmStore((s) => s.getCompletedJobs)
  const getJobsByProject = useSlurmStore((s) => s.getJobsByProject)
  const getJobsByCluster = useSlurmStore((s) => s.getJobsByCluster)

  useEffect(() => {
    fetchJobs()
    // Refresh every 10 seconds
    const interval = setInterval(fetchJobs, 10000)
    return () => clearInterval(interval)
  }, [fetchJobs])

  // Filter jobs based on props
  let jobs: SlurmJob[] = []

  if (projectId) {
    jobs = getJobsByProject(projectId)
  } else if (clusterId) {
    jobs = getJobsByCluster(clusterId)
  } else {
    switch (filter) {
      case 'active':
        jobs = getActiveJobs()
        break
      case 'queued':
        jobs = getQueuedJobs()
        break
      case 'completed':
        jobs = getCompletedJobs()
        break
      default:
        jobs = allJobs
    }
  }

  // Apply additional filters
  if (projectId && filter !== 'all') {
    switch (filter) {
      case 'active':
        jobs = jobs.filter(j => ['RUNNING', 'COMPLETING', 'SUSPENDED'].includes(j.state))
        break
      case 'queued':
        jobs = jobs.filter(j => j.state === 'PENDING')
        break
      case 'completed':
        jobs = jobs.filter(j =>
          ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY'].includes(j.state)
        )
        break
    }
  }

  // Limit items if specified
  if (maxItems && jobs.length > maxItems) {
    jobs = jobs.slice(0, maxItems)
  }

  if (loading && jobs.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading jobs...
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center p-4">
        No {filter !== 'all' ? filter : ''} jobs found
      </div>
    )
  }

  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        {jobs.map((job) => (
          <CompactJobItem key={job.taskId} job={job} showCluster={showCluster} />
        ))}
      </div>
    )
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="flex flex-col gap-3 p-1">
        {jobs.map((job) => (
          <JobCard key={job.taskId} job={job} showCluster={showCluster} />
        ))}
      </div>
    </ScrollArea>
  )
}

interface JobCardProps {
  job: SlurmJob
  showCluster?: boolean
}

function JobCard({ job, showCluster }: JobCardProps) {
  return (
    <Card className="hover:border-primary/40 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <JobStateIcon state={job.state} />
              <span className="font-medium text-sm truncate">{job.name}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <Hash className="h-3 w-3" />
              <span>{job.slurmJobId}</span>
              {showCluster && (
                <>
                  <span>on</span>
                  <span className="font-medium">{job.clusterName}</span>
                </>
              )}
            </div>
          </div>
          <JobStateBadge state={job.state} />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <Server className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Partition:</span>
            <span>{job.partition}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">CPUs:</span>
            <span>{job.cpus}</span>
          </div>
          {job.state === 'PENDING' && job.queuePosition !== undefined && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Queue:</span>
              <span>#{job.queuePosition}</span>
            </div>
          )}
          {job.timeUsed && (
            <div className="flex items-center gap-1.5">
              <Timer className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Time:</span>
              <span>{formatSlurmTime(job.timeUsed)}</span>
            </div>
          )}
          {job.nodeList && (
            <div className="flex items-center gap-1.5 col-span-2">
              <Server className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Nodes:</span>
              <span className="truncate">{job.nodeList}</span>
            </div>
          )}
          {job.stateReason && job.state === 'PENDING' && (
            <div className="flex items-center gap-1.5 col-span-2 text-muted-foreground">
              <AlertTriangle className="h-3 w-3" />
              <span>{job.stateReason}</span>
            </div>
          )}
        </div>

        {/* Exit code for completed jobs */}
        {job.exitCode !== undefined && ['COMPLETED', 'FAILED'].includes(job.state) && (
          <div className="mt-2 pt-2 border-t text-xs">
            <span className="text-muted-foreground">Exit code: </span>
            <span className={job.exitCode === 0 ? "text-green-600" : "text-red-600"}>
              {job.exitCode}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CompactJobItem({ job, showCluster }: JobCardProps) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
      <JobStateIcon state={job.state} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{job.name}</span>
          <span className="text-xs text-muted-foreground">#{job.slurmJobId}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {showCluster && <span>{job.clusterName}</span>}
          <span>{job.partition}</span>
          {job.state === 'PENDING' && job.queuePosition !== undefined && (
            <span>Queue #{job.queuePosition}</span>
          )}
          {job.timeUsed && <span>{formatSlurmTime(job.timeUsed)}</span>}
        </div>
      </div>
      <JobStateBadge state={job.state} size="sm" />
    </div>
  )
}

interface JobStateIconProps {
  state: SlurmJobState
  size?: 'sm' | 'md'
}

function JobStateIcon({ state, size = 'md' }: JobStateIconProps) {
  const sizeClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const colorClass = getJobStateColor(state)

  switch (state) {
    case 'PENDING':
      return <Clock className={`${sizeClass} ${colorClass}`} />
    case 'RUNNING':
    case 'COMPLETING':
      return <Play className={`${sizeClass} ${colorClass} animate-pulse`} />
    case 'COMPLETED':
      return <CheckCircle2 className={`${sizeClass} ${colorClass}`} />
    case 'FAILED':
    case 'NODE_FAIL':
    case 'OUT_OF_MEMORY':
      return <XCircle className={`${sizeClass} ${colorClass}`} />
    case 'CANCELLED':
    case 'PREEMPTED':
    case 'TIMEOUT':
      return <AlertTriangle className={`${sizeClass} ${colorClass}`} />
    default:
      return <Clock className={`${sizeClass} text-gray-500`} />
  }
}

interface JobStateBadgeProps {
  state: SlurmJobState
  size?: 'sm' | 'md'
}

function JobStateBadge({ state, size = 'md' }: JobStateBadgeProps) {
  const label = getJobStateLabel(state)

  const variantMap: Record<SlurmJobState, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info'> = {
    PENDING: 'warning',
    RUNNING: 'info',
    SUSPENDED: 'secondary',
    COMPLETING: 'info',
    COMPLETED: 'success',
    FAILED: 'destructive',
    CANCELLED: 'secondary',
    TIMEOUT: 'warning',
    PREEMPTED: 'warning',
    NODE_FAIL: 'destructive',
    OUT_OF_MEMORY: 'destructive',
    UNKNOWN: 'secondary',
  }

  return (
    <Badge
      variant={variantMap[state] || 'secondary'}
      className={size === 'sm' ? 'text-[10px] px-1.5 py-0' : ''}
    >
      {label}
    </Badge>
  )
}
