import { useParams, Link } from "react-router"
import { ArrowLeft, Clock, Monitor, Square, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { TaskOutputView } from "@/components/task-detail/task-output-view"
import { ToolTraceView } from "@/components/task-detail/tool-trace-view"
import { FileChangesView } from "@/components/task-detail/file-changes-view"
import { SteerChat } from "@/components/task-detail/steer-chat"
import { SessionActivityView } from "@/components/task-detail/session-activity-view"

const statusBadgeVariants: Record<string, "default" | "secondary" | "destructive" | "warning" | "success" | "info"> = {
  planned: "secondary",
  dispatched: "info",
  in_progress: "info",
  auto_verified: "success",
  awaiting_judgment: "warning",
  completed: "success",
  pruned: "secondary",
}

function formatDuration(start?: Date, end?: Date): string {
  if (!start) return "-"
  const endTime = end ? new Date(end).getTime() : Date.now()
  const ms = endTime - new Date(start).getTime()
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

export function TaskDetail() {
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

  // Get attached sessions for this task
  const attachedSessions = useRealtimeStore((s) => s.getSessionsForTask(executionId))

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

  // Combine output from execution store (local) and realtime store (relay)
  const outputText = execution?.streamText || taskStream?.stdout || node.executionOutput || ""

  // Combine tool traces and file changes from execution store and realtime store
  // Normalize to the format expected by the views
  const toolTraces = execution?.toolTraces?.length
    ? execution.toolTraces.map(t => ({
        toolName: t.toolName,
        toolInput: t.toolInput,
        toolResult: t.toolResult,
        success: t.success,
        duration: t.duration,
        timestamp: t.timestamp,
      }))
    : taskStream?.toolTraces || []
  const fileChanges = execution?.fileChanges?.length
    ? execution.fileChanges.map(f => ({
        path: f.path,
        action: f.action,
        linesAdded: f.linesAdded,
        linesRemoved: f.linesRemoved,
        timestamp: f.timestamp,
      }))
    : taskStream?.fileChanges || []

  // Get machine ID for steering (from execution or realtime stream)
  const machineId = execution?.machineId || taskStream?.machineId || ""

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-4 border-b border-border px-6 py-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to={`/project/${projectId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
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

        {/* Tabbed Content */}
        <Tabs defaultValue="output" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-6 mt-4 w-fit">
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="tools">
              Tools {toolTraces.length > 0 && `(${toolTraces.length})`}
            </TabsTrigger>
            <TabsTrigger value="files">
              Files {fileChanges.length > 0 && `(${fileChanges.length})`}
            </TabsTrigger>
            <TabsTrigger value="sessions">
              Sessions {attachedSessions.length > 0 && `(${attachedSessions.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="output" className="flex-1 m-0 min-h-0">
            <TaskOutputView text={outputText} isStreaming={isRunning} />
          </TabsContent>
          <TabsContent value="tools" className="flex-1 m-0 min-h-0">
            <ToolTraceView traces={toolTraces} />
          </TabsContent>
          <TabsContent value="files" className="flex-1 m-0 min-h-0">
            <FileChangesView changes={fileChanges} />
          </TabsContent>
          <TabsContent value="sessions" className="flex-1 m-0 min-h-0">
            <SessionActivityView sessions={attachedSessions} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Steer Chat Sidebar */}
      {isRunning && executionId && (
        <SteerChat
          taskId={executionId}
          machineId={machineId}
          taskStream={taskStream}
        />
      )}
    </div>
  )
}
