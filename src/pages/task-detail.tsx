import { useState } from "react"
import { useParams, Link, useNavigate, useSearchParams } from "react-router"
import { useProjectData } from "@/hooks/use-project-data"
import { ArrowLeft, Clock, Monitor, Square, Loader2, GitBranch, ExternalLink, RotateCcw, Check, Scissors, AlertCircle, CheckCircle2, XCircle, Layers, FileText, FolderEdit, PanelRight, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { UnifiedActivityView } from "@/components/task-detail/unified-activity-view"
import { FileChangesView } from "@/components/task-detail/file-changes-view"
import { TraceViewer } from "@/components/task-detail/trace-viewer"
import { TaskContentTab } from "@/components/task-detail/task-content-tab"
import { NodeInspectorContent, NodeInspectorSheet } from "@/components/node-inspector"
import { useMediaQuery } from "@/hooks/use-media-query"
import { ApprovalCard } from "@/components/approval-card"
import { PrStatusCard } from "@/components/task-detail/pr-status-card"
import { statusBadgeVariants } from "@/lib/status-config"
import { formatDuration } from "@/lib/date-utils"
import { cn, getShortId } from "@/lib/utils"
import { useStreamEvents } from "@/hooks/use-stream-events"

export type PanelSize = 'default' | 'three-quarter' | 'full'

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
  useProjectData(projectId) // Load full project data (content, executionOutput, streamText)
  const [searchParams, setSearchParams] = useSearchParams()
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

  // GitHub user login for self-approval guard — not available without OAuth, disabled for now
  const currentUserLogin = undefined

  // Mobile detection
  const isMobile = useMediaQuery("(max-width: 767px)")

  // Inspector sidebar toggle — default closed on mobile
  const [inspectorOpen, setInspectorOpen] = useState(
    () => !window.matchMedia("(max-width: 767px)").matches
  )

  // Compute executionId early for use in hooks
  const executionId = node?.executionId || execution?.executionId || ""

  // Check for pending approval
  const pendingApproval = nodeId ? getPendingApprovalForNode(nodeId) : undefined

  // Get realtime stream data
  const taskStream = useRealtimeStore((s) => {
    return executionId ? s.taskStreams.get(executionId) : undefined
  })

  const isRunning = !!node && (node.status === "in_progress" || node.status === "dispatched")
    && execution?.status !== "success" && execution?.status !== "failure" && execution?.status !== "cancelled"

  // Get file changes from unified stream events hook
  // Hook must be called before any early returns (Rules of Hooks)
  const { fileChanges: restoredFileChanges } = useStreamEvents(
    executionId || undefined,
    { execution },
  )

  if (!node || !projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Task not found</p>
        <Button variant="outline" asChild>
          <Link to={`/project/${projectId}/list`}>Back to Plan</Link>
        </Button>
      </div>
    )
  }

  // Deduplicate file changes (hook already merges execution + stream)
  const fileChanges = deduplicateFileChanges(restoredFileChanges.map(f => ({
    path: f.path,
    action: f.action,
    linesAdded: f.linesAdded,
    linesRemoved: f.linesRemoved,
    diff: f.diff,
    timestamp: f.timestamp,
  })))

  // Get machine ID for steering (from execution or realtime stream)
  const machineId = execution?.machineId || taskStream?.machineId || undefined

  return (
    <div className="flex h-dvh md:h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 md:gap-4 border-b border-border px-4 md:px-6 py-3 md:py-4">
        <Button variant="ghost" size="icon" className="h-8 w-8 md:h-9 md:w-9 shrink-0" onClick={() => {
          // Navigate back to the view we came from
          const returnView = searchParams.get("from")
          if (returnView && projectId) {
            navigate(`/project/${projectId}/${returnView}`)
          } else if (projectId) {
            navigate(`/project/${projectId}/list`)
          } else {
            navigate(-1)
          }
        }}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 md:gap-3 flex-wrap">
            <h1 className="text-base md:text-lg font-semibold truncate"><span className="text-muted-foreground font-normal font-mono mr-1.5">{getShortId(node.id)}</span>{node.title}</h1>
            <Badge variant={statusBadgeVariants[node.status] || "secondary"} className="text-[10px]">
              {node.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <p className="text-xs md:text-sm text-muted-foreground truncate mt-0.5">
            {project?.name} &middot; {node.type}
          </p>
        </div>

        {/* Inspector toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={inspectorOpen ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setInspectorOpen((o) => !o)}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{inspectorOpen ? "Hide" : "Show"} inspector</TooltipContent>
        </Tooltip>
      </div>

      {/* Meta Row - scrollable on mobile, hidden when empty */}
      {(node.executionStartedAt || isExecuting || isRunning || node.executionId || execution?.executionId || node.prUrl || execution?.prUrl || node.branchName || execution?.branchName) && (
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
        {taskStream?.progress != null && taskStream.progress > 0 && taskStream.progress < 100 && isRunning && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="h-1.5 w-16 md:w-24 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-info transition-all duration-500"
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
                  className="h-full rounded-full bg-info animate-pulse"
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
        {/* Delivery result: PR link, branch name, or direct indicator */}
        {(node.prUrl || execution?.prUrl) ? (
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
        ) : (node.branchName || execution?.branchName) ? (
          <div className="hidden md:flex items-center gap-1.5 text-muted-foreground shrink-0">
            <GitBranch className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">{node.branchName || execution?.branchName}</span>
          </div>
        ) : project?.deliveryMode === 'direct' && !isRunning && execution?.status === 'success' ? (
          <div className="hidden md:flex items-center gap-1.5 text-warning shrink-0">
            <FolderEdit className="h-3.5 w-3.5" />
            <span className="text-xs">Changes applied directly</span>
          </div>
        ) : null}
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
                const returnView = searchParams.get("from") || "list"
                navigate(`/project/${projectId}/${returnView}`)
              } finally {
                setIsResetting(false)
              }
            }}
          >
            <RotateCcw className={cn("h-3 w-3 md:h-3.5 md:w-3.5", isResetting && "animate-spin")} />
            <span className="hidden sm:inline ml-1.5">{isResetting ? "Resetting..." : "Reset"}</span>
          </Button>
        )}
        {isExecuting && (
          <div className="flex items-center gap-1.5 text-info shrink-0">
            <Loader2 className="h-3 w-3 md:h-3.5 md:w-3.5 animate-spin" />
            <span className="text-[10px] md:text-xs font-medium">Running</span>
          </div>
        )}
      </div>
      )}

      {/* Approval Card (if pending) */}
      {node.status === "awaiting_approval" && pendingApproval && (
        <div className="px-4 md:px-6 pt-4">
          <ApprovalCard
            approval={pendingApproval}
            onRespond={respondToApproval}
          />
        </div>
      )}

      {/* PR Status Card - shown when task has an associated PR */}
      {(() => {
        const thePrUrl = node.prUrl || execution?.prUrl
        const thePrNumber = node.prNumber || execution?.prNumber
        if (!thePrUrl || !thePrNumber) return null

        // Resolve owner/repo: prefer project fields, fall back to parsing the PR URL
        let prOwner = project?.githubOwner
        let prRepo = project?.githubRepo
        if (!prOwner || !prRepo) {
          const match = thePrUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\//)
          if (match) {
            prOwner = match[1]
            prRepo = match[2]
          }
        }
        if (!prOwner || !prRepo) return null

        return (
          <div className="px-4 md:px-6 pt-4">
            <PrStatusCard
              owner={prOwner}
              repo={prRepo}
              prNumber={thePrNumber}
              prUrl={thePrUrl}
              currentUserLogin={currentUserLogin}
            />
          </div>
        )
      })()}

      {/* Judgment Banner for awaiting_judgment tasks */}
      {node.status === "awaiting_judgment" && (
        <div className="px-4 md:px-6 pt-4">
          <Card className="rounded-2xl shadow-lg border-warning/40">
            <CardContent className="flex flex-col gap-0 p-0">
              {/* Summary or Error */}
              {execution?.summary ? (
                <div className={cn(
                  "m-4 rounded-lg border p-3",
                  execution.summary.status === 'success' ? "border-success/30 bg-success/5" :
                  execution.summary.status === 'partial' ? "border-warning/30 bg-warning/5" :
                  "border-error/30 bg-error/5"
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
                <div className="m-4 rounded-lg border border-error/30 bg-error/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-error mt-0.5 shrink-0" />
                    <p className="text-sm text-error">{node.executionError || execution?.error}</p>
                  </div>
                </div>
              ) : execution && (execution.status === 'pending' || execution.status === 'running') ? (
                <div className="flex items-center gap-2 m-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generating summary...</span>
                </div>
              ) : (
                <div className="m-4 rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground line-clamp-4">{node.executionOutput || execution?.streamText || 'No output captured.'}</p>
                </div>
              )}

              {/* Plan Mode Data: Todos */}
              {execution?.planTodos && execution.planTodos.length > 0 && (
                <div className="mx-4 mb-4 rounded-lg border border-info/30 bg-info/5 p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-info" />
                    <span className="text-xs font-semibold text-info">Plan Todos</span>
                  </div>
                  <ul className="space-y-1.5">
                    {execution.planTodos.map((todo, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        {todo.status === 'completed' ? (
                          <Check className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                        ) : todo.status === 'in_progress' ? (
                          <Loader2 className="h-3.5 w-3.5 text-info mt-0.5 shrink-0 animate-spin" />
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
                <div className="mx-4 mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4 text-primary" />
                    <span className="text-xs font-semibold text-primary">Plan Questions</span>
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
                          <p className="mt-1 text-primary font-medium">Answer: {q.answer}</p>
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
                <Button variant="outline" size="sm" disabled={isResetting} onClick={async () => {
                  if (!nodeId) return
                  setIsResetting(true)
                  try { await resetExecution(nodeId) } finally { setIsResetting(false) }
                }} className="min-h-9">
                  <RotateCcw className={cn("h-3.5 w-3.5 mr-1", isResetting && "animate-spin")} />
                  {isResetting ? "Resetting..." : "Reset"}
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

      {/* Completion Banner for finished tasks */}
      {(node.status === "auto_verified" || node.status === "completed") && node.executionCompletedAt && !isRunning && (
        <div className="px-4 md:px-6 pt-3 space-y-2">
          <div className={cn(
            "flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm",
            execution?.status === "failure"
              ? "border-error/30 bg-error/5 text-error"
              : "border-success/30 bg-success/5 text-success"
          )}>
            {execution?.status === "failure" ? (
              <XCircle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span className="font-medium">
              {execution?.status === "failure" ? "Task execution failed" : "Task completed successfully"}
            </span>
            {node.executionStartedAt && node.executionCompletedAt && (
              <>
                <span className="text-xs opacity-70">&middot;</span>
                <span className="text-xs opacity-70">{formatDuration(node.executionStartedAt, node.executionCompletedAt)}</span>
              </>
            )}
            {fileChanges.length > 0 && (
              <>
                <span className="text-xs opacity-70">&middot;</span>
                <span className="text-xs opacity-70">{fileChanges.length} file{fileChanges.length !== 1 ? "s" : ""}</span>
              </>
            )}
            {execution?.summary && (
              <>
                <span className="text-xs opacity-70">&middot;</span>
                <span className="text-xs opacity-70 truncate max-w-[300px]">{execution.summary.workCompleted}</span>
              </>
            )}
          </div>
          {/* Delivery status — success confirmation, soft info for no-remote repos, warning for real failures */}
          {execution?.deliveryStatus === "success" && (node.prUrl || execution?.prUrl) && (
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="font-medium">PR created and merged</span>
              <span className="text-xs opacity-70">&middot;</span>
              <a
                href={node.prUrl || execution?.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs hover:underline truncate"
              >#{node.prNumber || execution?.prNumber}</a>
            </div>
          )}
          {execution?.deliveryStatus === "failed" && execution?.deliveryError && (() => {
            const isNoRemote = /no remote origin|not a git/i.test(execution.deliveryError)
            return isNoRemote ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-muted/30 bg-muted/5 px-4 py-2.5 text-sm text-muted-foreground">
                <Info className="h-4 w-4 shrink-0" />
                <span className="text-xs opacity-70">Files saved locally (no git remote configured)</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-sm text-warning">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="font-medium">Delivery failed</span>
                <span className="text-xs opacity-70">&middot;</span>
                <span className="text-xs opacity-70 truncate">{execution.deliveryError}</span>
              </div>
            )
          })()}
        </div>
      )}

      {/* Main content area: Tabs + optional Inspector sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Tabbed Content: Content + Activity + Files */}
        <Tabs value={searchParams.get('tab') || "activity"} onValueChange={(v) => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', v); return next }, { replace: true })} className="flex-1 flex flex-col min-h-0 min-w-0">
          <TabsList className="mx-4 md:mx-6 mt-3 md:mt-4 w-fit">
            <TabsTrigger value="content" className="text-xs md:text-sm">
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Note
              {((node.attachments?.length || 0) + (node.links?.length || 0)) > 0 && (
                <span className="ml-1.5 text-muted-foreground">
                  ({(node.attachments?.length || 0) + (node.links?.length || 0)})
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity" className="text-xs md:text-sm">Activity</TabsTrigger>
            <TabsTrigger value="trace" className="text-xs md:text-sm">Trace</TabsTrigger>
            <TabsTrigger value="files" className="text-xs md:text-sm">
              Files {fileChanges.length > 0 && `(${fileChanges.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="flex-1 m-0 min-h-0 overflow-auto">
            <TaskContentTab node={node} projectId={projectId} panelSize="default" fileTree={project?.fileTree} />
          </TabsContent>
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
          <TabsContent value="trace" className="flex-1 m-0 min-h-0">
            <TraceViewer executionId={executionId} isRunning={isRunning} />
          </TabsContent>
          <TabsContent value="files" className="flex-1 m-0 min-h-0">
            <FileChangesView changes={fileChanges} machineId={machineId} />
          </TabsContent>
        </Tabs>

        {/* Node Inspector Sidebar (desktop) */}
        {!isMobile && inspectorOpen && (
          <div className="flex flex-col gap-5 border-l bg-card p-5 overflow-auto border-border w-[320px] shrink-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-muted-foreground">Inspector</h4>
            </div>
            <Separator />
            <NodeInspectorContent
              node={node}
              project={{
                id: projectId,
                workingDirectory: project?.workingDirectory,
                defaultMachineId: project?.defaultMachineId,
                fileTree: project?.fileTree,
              }}
              viewMode={searchParams.get('from') || 'graph'}
              onClose={() => setInspectorOpen(false)}
              onNodeUpdate={() => {}}
            />
          </div>
        )}

        {/* Node Inspector Sheet (mobile) */}
        {isMobile && (
          <NodeInspectorSheet
            open={inspectorOpen}
            node={node}
            project={{
              id: projectId,
              workingDirectory: project?.workingDirectory,
              defaultMachineId: project?.defaultMachineId,
              fileTree: project?.fileTree,
            }}
            viewMode={searchParams.get('from') || 'graph'}
            onClose={() => setInspectorOpen(false)}
            onNodeUpdate={() => {}}
          />
        )}
      </div>
    </div>
  )
}
