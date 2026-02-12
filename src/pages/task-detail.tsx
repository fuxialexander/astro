import { useParams, Link, useNavigate } from "react-router"
import { ArrowLeft, Clock, Monitor, Square, Loader2, GitBranch, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { UnifiedActivityView } from "@/components/task-detail/unified-activity-view"
import { FileChangesView } from "@/components/task-detail/file-changes-view"
import { statusBadgeVariants } from "@/lib/status-config"
import { formatDuration } from "@/lib/date-utils"

// Deduplicate file changes: keep latest per path
function deduplicateFileChanges(changes: Array<{ path: string; action: string; linesAdded?: number; linesRemoved?: number; diff?: string; timestamp: Date }>): Array<{ path: string; action: string; linesAdded?: number; linesRemoved?: number; diff?: string; timestamp: Date }> {
  const latest = new Map<string, typeof changes[number]>()
  for (const change of changes) {
    latest.set(change.path, change)
  }
  return Array.from(latest.values()).sort((a, b) => a.path.localeCompare(b.path))
}

export function TaskDetail() {
  const navigate = useNavigate()
  const { id: projectId, nodeId } = useParams<{ id: string; nodeId: string }>()
  const node = usePlanStore((s) => s.nodes.find((n) => n.id === nodeId))
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const execution = useExecutionStore((s) => nodeId ? s.getExecution(nodeId) : undefined)
  const cancelExecution = useExecutionStore((s) => s.cancelExecution)
  const isExecuting = useExecutionStore((s) => nodeId ? s.isExecuting(nodeId) : false)

  // Compute executionId early for use in hooks
  const executionId = node?.executionId || execution?.executionId || ""

  // Get realtime stream data
  const taskStream = useRealtimeStore((s) => {
    return executionId ? s.taskStreams.get(executionId) : undefined
  })

  if (!node || !projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Task not found</p>
        <Button variant="outline" asChild>
          <Link to={`/project/${projectId}`}>Back to Plan</Link>
        </Button>
      </div>
    )
  }

  const isRunning = node.status === "in_progress" || node.status === "dispatched"

  // Combine file changes from execution store and realtime store, then deduplicate
  const rawFileChanges = execution?.fileChanges?.length
    ? execution.fileChanges.map(f => ({
        path: f.path,
        action: f.action,
        linesAdded: f.linesAdded,
        linesRemoved: f.linesRemoved,
        diff: f.diff,
        timestamp: f.timestamp,
      }))
    : taskStream?.fileChanges || []
  const fileChanges = deduplicateFileChanges(rawFileChanges)

  // Get machine ID for steering (from execution or realtime stream)
  const machineId = execution?.machineId || taskStream?.machineId || ""

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-border px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold truncate">{node.title}</h1>
            <Badge variant={statusBadgeVariants[node.status] || "secondary"}>
              {node.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground truncate mt-0.5">
            {project?.name} &middot; {node.type}
          </p>
        </div>
      </div>

      {/* Meta Row */}
      <div className="flex items-center gap-6 border-b border-border px-6 py-3 text-sm">
        {node.executionStartedAt && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>{formatDuration(node.executionStartedAt, node.executionCompletedAt)}</span>
          </div>
        )}
        {taskStream?.progress != null && taskStream.progress > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${taskStream.progress}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{taskStream.progress}%</span>
          </div>
        )}
        {execution?.executionId && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Monitor className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">{execution.executionId.slice(0, 20)}</span>
          </div>
        )}
        {(node.branchName || execution?.branchName) && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">{node.branchName || execution?.branchName}</span>
          </div>
        )}
        {(node.prUrl || execution?.prUrl) && (
          <a
            href={node.prUrl || execution?.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5"
          >
            <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-accent">
              <ExternalLink className="h-3 w-3" />
              PR #{node.prNumber || execution?.prNumber}
            </Badge>
          </a>
        )}
        <div className="flex-1" />
        {/* Action buttons */}
        {isRunning && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => nodeId && cancelExecution(nodeId)}
          >
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}
        {isExecuting && (
          <div className="flex items-center gap-1.5 text-blue-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-xs font-medium">Running</span>
          </div>
        )}
      </div>

      {/* Tabbed Content: Activity + Files */}
      <Tabs defaultValue="activity" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-6 mt-4 w-fit">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="files">
            Files {fileChanges.length > 0 && `(${fileChanges.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="flex-1 m-0 min-h-0">
          <UnifiedActivityView
            node={node}
            projectId={projectId}
            execution={execution}
            taskStream={taskStream}
            isRunning={isRunning}
            executionId={executionId}
            machineId={machineId}
          />
        </TabsContent>
        <TabsContent value="files" className="flex-1 m-0 min-h-0">
          <FileChangesView changes={fileChanges} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
