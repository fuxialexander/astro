import { useState } from "react"
import { useParams, Link, useNavigate, useSearchParams } from "react-router"
import { ArrowLeft, Clock, Monitor, Square, Loader2, GitBranch, ExternalLink, RotateCcw, Check, Scissors, AlertCircle, CheckCircle2, Layers, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MobileStatusBar } from "@/components/mobile/status-bar"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { UnifiedActivityView } from "@/components/task-detail/unified-activity-view"
import { FileChangesView } from "@/components/task-detail/file-changes-view"
import { ApprovalCard } from "@/components/approval-card"
import { statusBadgeVariants } from "@/lib/status-config"
import { formatDuration } from "@/lib/date-utils"
import { cn } from "@/lib/utils"

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
  const [searchParams] = useSearchParams()
  const node = usePlanStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNode = usePlanStore((s) => s.updateNode)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const execution = useExecutionStore((s) => nodeId ? s.getExecution(nodeId) : undefined)
  const cancelExecution = useExecutionStore((s) => s.cancelExecution)
  const resetExecution = useExecutionStore((s) => s.resetExecution)
  const isExecuting = useExecutionStore((s) => nodeId ? s.isExecuting(nodeId) : false)
  const [isResetting, setIsResetting] = useState(false)
  const getPendingApprovalForNode = useExecutionStore((s) => s.getPendingApprovalForNode)
  const respondToApproval = useExecutionStore((s) => s.respondToApproval)

  // Compute executionId early for use in hooks
  const executionId = node?.executionId || execution?.executionId || ""

  // Check for pending approval
  const pendingApproval = nodeId ? getPendingApprovalForNode(nodeId) : undefined

  // Get realtime stream data
  const taskStream = useRealtimeStore((s) => {
    return executionId ? s.taskStreams.get(executionId) : undefined
  })

  if (!node || !projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Task not found</p>
        <Button variant="outline" asChild>
          <Link to={`/project/${projectId}/graph`}>Back to Plan</Link>
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
      {/* Mobile Status Bar */}
      <MobileStatusBar />

      {/* Header */}
      <div className="flex items-center gap-3 md:gap-4 border-b border-border px-4 md:px-6 py-3 md:py-4">
        <Button variant="ghost" size="icon" className="h-8 w-8 md:h-9 md:w-9 shrink-0" onClick={() => {
          // Navigate back to the view we came from
          const returnView = searchParams.get("from")
          if (returnView && projectId) {
            navigate(`/project/${projectId}/plan?view=${returnView}`)
          } else if (projectId) {
            navigate(`/project/${projectId}/plan`)
          } else {
            navigate(-1)
          }
        }}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 md:gap-3 flex-wrap">
            <h1 className="text-base md:text-lg font-semibold truncate">{node.title}</h1>
            <Badge variant={statusBadgeVariants[node.status] || "secondary"} className="text-[10px]">
              {node.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <p className="text-xs md:text-sm text-muted-foreground truncate mt-0.5">
            {project?.name} &middot; {node.type}
          </p>
        </div>
      </div>

      {/* Meta Row - scrollable on mobile */}
      <div className={cn(
        "flex items-center gap-4 md:gap-6 border-b border-border px-4 md:px-6 py-2 md:py-3 text-xs md:text-sm",
        "overflow-x-auto"
      )}>
        {node.executionStartedAt && (
          <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
            <Clock className="h-3 w-3 md:h-3.5 md:w-3.5" />
            <span className="whitespace-nowrap">{formatDuration(node.executionStartedAt, node.executionCompletedAt)}</span>
          </div>
        )}
        {taskStream?.progress != null && taskStream.progress > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="h-1.5 w-16 md:w-24 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${taskStream.progress}%` }}
              />
            </div>
            <span className="text-[10px] md:text-xs text-muted-foreground whitespace-nowrap">{taskStream.progress}%</span>
          </div>
        )}
        {execution?.subroutineProgress && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Layers className="h-3 w-3 md:h-3.5 md:w-3.5 text-muted-foreground" />
            <span className="text-[10px] md:text-xs text-muted-foreground whitespace-nowrap">
              Step {execution.subroutineProgress.index + 1}/{execution.subroutineProgress.total}: {execution.subroutineProgress.name}
            </span>
            {execution.subroutineProgress.status === 'running' && (
              <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 animate-pulse"
                  style={{ width: `${((execution.subroutineProgress.index + 0.5) / execution.subroutineProgress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}
        {execution?.executionId && (
          <div className="hidden md:flex items-center gap-1.5 text-muted-foreground shrink-0">
            <Monitor className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">{execution.executionId.slice(0, 20)}</span>
          </div>
        )}
        {(node.branchName || execution?.branchName) && (
          <div className="hidden md:flex items-center gap-1.5 text-muted-foreground shrink-0">
            <GitBranch className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">{node.branchName || execution?.branchName}</span>
          </div>
        )}
        {(node.prUrl || execution?.prUrl) && (
          <a
            href={node.prUrl || execution?.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 shrink-0"
          >
            <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-accent text-[10px]">
              <ExternalLink className="h-3 w-3" />
              <span className="hidden sm:inline">PR </span>#{node.prNumber || execution?.prNumber}
            </Badge>
          </a>
        )}
        <div className="flex-1 min-w-[20px]" />
        {/* Action buttons */}
        {isRunning && (
          <Button
            variant="destructive"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => nodeId && cancelExecution(nodeId)}
          >
            <Square className="h-3 w-3 md:h-3.5 md:w-3.5" />
            <span className="hidden sm:inline ml-1.5">Stop</span>
          </Button>
        )}
        {!isRunning && node.executionId && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            disabled={isResetting}
            onClick={async () => {
              if (!nodeId) return
              setIsResetting(true)
              try {
                await resetExecution(nodeId)
                navigate(`/project/${projectId}/plan`)
              } finally {
                setIsResetting(false)
              }
            }}
          >
            <RotateCcw className={cn("h-3 w-3 md:h-3.5 md:w-3.5", isResetting && "animate-spin")} />
            <span className="hidden sm:inline ml-1.5">{isResetting ? "Resetting..." : "Re-execute"}</span>
          </Button>
        )}
        {isExecuting && (
          <div className="flex items-center gap-1.5 text-blue-500 shrink-0">
            <Loader2 className="h-3 w-3 md:h-3.5 md:w-3.5 animate-spin" />
            <span className="text-[10px] md:text-xs font-medium">Running</span>
          </div>
        )}
      </div>

      {/* Approval Card (if pending) */}
      {node.status === "awaiting_approval" && pendingApproval && (
        <div className="px-4 md:px-6 pt-4">
          <ApprovalCard
            approval={pendingApproval}
            onRespond={respondToApproval}
          />
        </div>
      )}

      {/* Judgment Banner for awaiting_judgment tasks */}
      {node.status === "awaiting_judgment" && (
        <div className="px-4 md:px-6 pt-4">
          <Card className="rounded-2xl shadow-lg border-amber-500/40">
            <CardContent className="flex flex-col gap-0 p-0">
              {/* Summary or Error */}
              {execution?.summary ? (
                <div className={cn(
                  "m-4 rounded-lg border p-3",
                  execution.summary.status === 'success' ? "border-green-500/30 bg-green-500/5" :
                  execution.summary.status === 'partial' ? "border-yellow-500/30 bg-yellow-500/5" :
                  "border-red-500/30 bg-red-500/5"
                )}>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold">Summary</span>
                        <Badge variant={execution.summary.status === 'success' ? 'success' : execution.summary.status === 'partial' ? 'warning' : 'destructive'} className="text-[10px]">
                          {execution.summary.status}
                        </Badge>
                        {execution.summary.filesChanged.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {execution.summary.filesChanged.length} file{execution.summary.filesChanged.length !== 1 ? 's' : ''} changed
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground">{execution.summary.workCompleted}</p>
                      {execution.summary.followUps.length > 0 && (
                        <div className="mt-2">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Follow-ups</span>
                          <ul className="mt-0.5">
                            {execution.summary.followUps.map((f, i) => (
                              <li key={i} className="text-xs text-muted-foreground">- {f}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (node.executionError || execution?.error) ? (
                <div className="m-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-600">{node.executionError || execution?.error}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 m-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generating summary...</span>
                </div>
              )}

              {/* Plan Mode Data: Todos */}
              {execution?.planTodos && execution.planTodos.length > 0 && (
                <div className="mx-4 mb-4 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3.5">
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
                <div className="mx-4 mb-4 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3.5">
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

              {/* Action buttons */}
              <div className="flex items-center gap-2 border-t px-5 py-4">
                <Button size="sm" onClick={() => nodeId && updateNode(nodeId, { status: "completed" })} className="min-h-9">
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Approve
                </Button>
                <Button variant="outline" size="sm" onClick={() => nodeId && updateNode(nodeId, { status: "planned" })} className="min-h-9">
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={() => nodeId && updateNode(nodeId, { status: "pruned" })} className="min-h-9 text-muted-foreground">
                  <Scissors className="h-3.5 w-3.5 mr-1" />
                  Prune
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabbed Content: Activity + Files */}
      <Tabs defaultValue="activity" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 md:mx-6 mt-3 md:mt-4 w-fit">
          <TabsTrigger value="activity" className="text-xs md:text-sm">Activity</TabsTrigger>
          <TabsTrigger value="files" className="text-xs md:text-sm">
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
          <FileChangesView changes={fileChanges} machineId={machineId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
