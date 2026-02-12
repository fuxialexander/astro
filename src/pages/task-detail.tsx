import { useParams, Link, useNavigate } from "react-router"
import { ArrowLeft, Clock, Monitor, Square, Loader2, GitBranch, ExternalLink } from "lucide-react"
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
import { TaskChat } from "@/components/task-detail/task-chat"
import { statusBadgeVariants } from "@/lib/status-config"
import { formatDuration } from "@/lib/date-utils"

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

  // Get attached sessions for this task
  // Note: use the raw map + useMemo to avoid returning a new array reference on every render
  const sessionsMap = useRealtimeStore((s) => s.attachedSessions)
  const attachedSessions = Array.from(sessionsMap.values()).filter((s) => s.taskId === executionId)

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
            <TabsTrigger value="chat">Chat</TabsTrigger>
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
          <TabsContent value="chat" className="flex-1 m-0 min-h-0">
            <TaskChat
              node={node}
              projectId={projectId}
              visionDoc={project?.visionDoc}
              taskOutput={outputText}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Steer Chat Sidebar */}
      {isRunning && executionId && (
        <SteerChat
          taskId={executionId}
          machineId={machineId}
          projectId={projectId}
          taskStream={taskStream}
        />
      )}
    </div>
  )
}
