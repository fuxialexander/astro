import { useState, useRef, useEffect } from "react"
import { useParams, Link, useNavigate, useSearchParams } from "react-router"
import { useProjectData } from "@/hooks/use-project-data"
import { ArrowLeft, Square, Loader2, RotateCcw, Check, AlertCircle, CheckCircle2, XCircle, FileText, Info, FileDiff, Folder } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useMachinesStore } from "@/stores/machines-store"
import { UnifiedActivityView } from "@/components/task-detail/unified-activity-view"
import { TaskContentTab } from "@/components/task-detail/task-content-tab"
import { ApprovalCard } from "@/components/approval-card"
import { TaskPropertiesBar } from "@/components/task-properties-bar"
import { TaskWorkdirBar } from "@/components/task-detail/task-workdir-bar"
import { FileBrowser } from "@/components/file-browser"
import { getProjectFileBrowserRoot, resolveFilePathForBrowsing } from "@/components/task-detail/file-path-utils"
import { PrStatusCard } from "@/components/task-detail/pr-status-card"
import { formatDuration } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import { useStreamEvents } from "@/hooks/use-stream-events"
import { useMediaQuery } from "@/hooks/use-media-query"
import { ExecutionSwitcher } from "@/components/task-detail/execution-switcher"

export type PanelSize = 'default' | 'three-quarter' | 'full'

// Build a folder tree from flat file paths
interface TreeNode { name: string; children: Map<string, TreeNode>; isFile: boolean; action?: string }
function buildFileTree(files: Array<{ path: string; action: string }>): Map<string, TreeNode> {
  const root = new Map<string, TreeNode>()
  for (const { path, action } of files) {
    const parts = path.split("/")
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!cur.has(part)) {
        cur.set(part, { name: part, children: new Map(), isFile: i === parts.length - 1, action })
      }
      const node = cur.get(part)!
      if (i === parts.length - 1) { node.isFile = true; node.action = action }
      cur = node.children
    }
  }
  return root
}

const actionColors: Record<string, string> = {
  created: "text-success",
  modified: "text-info",
  deleted: "text-error opacity-60",
}

function FileTreeNodes({ nodes, depth = 0 }: { nodes: Map<string, TreeNode>; depth?: number }) {
  return (
    <>
      {Array.from(nodes.entries()).map(([, node]) => (
        <div key={node.name}>
          <div style={{ paddingLeft: depth * 12 }} className="flex items-center gap-1 py-[1px] min-w-0">
            {node.isFile ? (
              <FileDiff className={cn("h-3 w-3 shrink-0", actionColors[node.action ?? "modified"] ?? "text-muted-foreground")} />
            ) : (
              <Folder className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            )}
            <span className={cn(
              "text-xs truncate",
              node.isFile ? (actionColors[node.action ?? "modified"] ?? "text-foreground") : "text-muted-foreground"
            )}>
              {node.name}
            </span>
          </div>
          {!node.isFile && node.children.size > 0 && (
            <FileTreeNodes nodes={node.children} depth={depth + 1} />
          )}
        </div>
      ))}
    </>
  )
}

function FileTreePopover({ changes }: { changes: Array<{ path: string; action: string }> }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tree = buildFileTree(changes)

  const handleMouseEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const handleMouseLeave = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 100)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 focus-visible:ring-0 focus-visible:ring-offset-0"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <FileDiff className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{changes.length} file{changes.length !== 1 ? "s" : ""}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-2"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        sideOffset={6}
        align="end"
      >
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
          Files Changed
        </div>
        <div className="max-h-72 overflow-y-auto">
          <FileTreeNodes nodes={tree} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

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
  const [searchParams] = useSearchParams()
  const node = usePlanStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNode = usePlanStore((s) => s.updateNode)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const execution = useExecutionStore((s) => nodeId ? s.getExecution(nodeId) : undefined)
  const cancelExecution = useExecutionStore((s) => s.cancelExecution)
  const resetExecution = useExecutionStore((s) => s.resetExecution)
  const isExecuting = useExecutionStore((s) => nodeId ? s.isExecuting(nodeId) : false)
  const [isResetting, setIsResetting] = useState(false)
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false)
  const [fileBrowserWidth, setFileBrowserWidth] = useState(320)
  const [fileBrowserResizing, setFileBrowserResizing] = useState(false)
  const [initialFilePath, setInitialFilePath] = useState<string | undefined>(undefined)
  const isWide = useMediaQuery("(min-width: 1024px)")
  const machines = useMachinesStore((s) => s.machines)
  const getPendingApprovalForNode = useExecutionStore((s) => s.getPendingApprovalForNode)
  const respondToApproval = useExecutionStore((s) => s.respondToApproval)


  // GitHub user login for self-approval guard — not available without OAuth, disabled for now
  const currentUserLogin = undefined

  // Execution switcher: allow viewing a different execution's activity
  const [overrideExecutionId, setOverrideExecutionId] = useState<string | null>(null)
  const nodeExecutions = useExecutionStore((s) => nodeId ? s.nodeExecutions.get(nodeId) : undefined)
  const hasMultipleExecutions = (nodeExecutions?.length ?? 0) > 1

  // Find the override execution object when switching
  const overrideExecution = overrideExecutionId
    ? nodeExecutions?.find((e) => e.executionId === overrideExecutionId)
    : undefined

  // Compute executionId early for use in hooks
  const defaultExecutionId = node?.executionId || execution?.executionId || ""
  const executionId = overrideExecutionId || defaultExecutionId
  const activeExecution = overrideExecution || execution

  // Track execution chain for follow-up continuity: when the active execution changes
  // (follow-up dispatched), accumulate previous IDs so the activity feed shows them all.
  // Reset when the node changes (navigating to a different task).
  const [prevExecutionIds, setPrevExecutionIds] = useState<string[]>([])
  const lastDefaultIdRef = useRef("")
  useEffect(() => {
    const prev = lastDefaultIdRef.current
    if (prev && prev !== defaultExecutionId && defaultExecutionId) {
      setPrevExecutionIds((ids) => ids.includes(prev) ? ids : [...ids, prev])
    }
    lastDefaultIdRef.current = defaultExecutionId
  }, [defaultExecutionId])
  useEffect(() => {
    setPrevExecutionIds([])
    lastDefaultIdRef.current = ""
  }, [nodeId])

  // Check for pending approval
  const pendingApproval = nodeId ? getPendingApprovalForNode(nodeId) : undefined

  // Get realtime stream data
  const taskStream = useRealtimeStore((s) => {
    return executionId ? s.taskStreams.get(executionId) : undefined
  })

  const isRunning = !!node && (node.status === "in_progress" || node.status === "dispatched")
    && activeExecution?.status !== "success" && activeExecution?.status !== "failure" && activeExecution?.status !== "cancelled"

  // Get file changes from unified stream events hook
  // Hook must be called before any early returns (Rules of Hooks)
  const { fileChanges: restoredFileChanges } = useStreamEvents(
    executionId || undefined,
    { execution: activeExecution },
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
      <div className="flex items-center gap-3 border-b border-border px-4 md:px-6 h-14 shrink-0">
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
        <h1 className="flex-1 min-w-0 text-base md:text-lg font-semibold truncate">{node.title}</h1>

        {/* Header action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {isRunning && (
            <>
              <Button
                variant="destructive"
                size="sm"
                className="h-8"
                onClick={() => nodeId && cancelExecution(nodeId)}
              >
                <Square className="h-3.5 w-3.5" />
                <span className="hidden sm:inline ml-1.5">Stop</span>
              </Button>
              {isExecuting && (
                <div className="flex items-center gap-1.5 text-info">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="hidden sm:inline text-xs font-medium">Running</span>
                </div>
              )}
            </>
          )}
          {!isRunning && isExecuting && (
            <div className="flex items-center gap-1.5 text-info">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="hidden sm:inline text-xs font-medium">Running</span>
            </div>
          )}
          {fileChanges.length > 0 && (
            <FileTreePopover changes={fileChanges} />
          )}
          {!isRunning && node.executionId && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
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
              <RotateCcw className={cn("h-3.5 w-3.5", isResetting && "animate-spin")} />
              <span className="hidden sm:inline ml-1.5">{isResetting ? "Resetting..." : "Reset"}</span>
            </Button>
          )}
        </div>
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

      {/* Content row: main content + optional file browser sidebar */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main content column */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">

          {/* Unified task bar: Notes + properties */}
          {project && (
            <div className="border-b border-border/50 px-4 md:px-6 py-1.5 shrink-0">
              <TaskPropertiesBar
                node={node}
                project={{
                  id: project.id,
                  workingDirectory: project.workingDirectory,
                  defaultMachineId: project.defaultMachineId,
                  fileTree: project.fileTree,
                }}
                hasNote={!!(node.content || node.description)}
                attachmentCount={(node.attachments?.length ?? 0) + (node.links?.length ?? 0)}
              >
                <TaskContentTab node={node} projectId={projectId} panelSize="default" fileTree={project.fileTree} />
              </TaskPropertiesBar>
            </div>
          )}

          {/* Activity — primary content, takes all remaining height */}
          <div className="flex-1 min-h-0 flex flex-col">
            {hasMultipleExecutions && nodeId && executionId && (
              <div className="px-4 pt-2 pb-1 border-b border-border shrink-0">
                <ExecutionSwitcher
                  nodeId={nodeId}
                  activeExecutionId={executionId}
                  onSwitch={(eid) => setOverrideExecutionId(eid === defaultExecutionId ? null : eid)}
                />
              </div>
            )}
            <UnifiedActivityView
              node={node}
              projectId={projectId}
              execution={activeExecution}
              taskStream={taskStream}
              isRunning={isRunning}
              executionId={executionId}
              machineId={machineId}
              additionalExecutionIds={prevExecutionIds.filter(id => id !== executionId)}
              onFileSelect={(filePath) => {
                const fbWorkDir = getProjectFileBrowserRoot(project)
                if (fbWorkDir) {
                  setInitialFilePath(resolveFilePathForBrowsing(filePath, fbWorkDir))
                }
                setFileBrowserOpen(true)
              }}
            />
          </div>

        </div>

        {/* File browser sidebar (wide screens, right side) */}
        {(() => {
          const fbMachine = project?.defaultMachineId
            ? machines.find((m) => m.id === project.defaultMachineId)
            : machines.length === 1 ? machines[0] : undefined
          const fbWorkDir = getProjectFileBrowserRoot(project)
          return fileBrowserOpen && fbMachine && fbWorkDir && isWide ? (
            <div
              className="flex flex-col bg-background border-l border-border shrink-0 relative overflow-hidden"
              style={{ width: fileBrowserWidth, transition: fileBrowserResizing ? 'none' : undefined }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const startX = e.clientX
                  const startWidth = fileBrowserWidth
                  setFileBrowserResizing(true)
                  const onMouseMove = (ev: MouseEvent) => setFileBrowserWidth(Math.max(240, Math.min(600, startWidth - (ev.clientX - startX)))  )
                  const onMouseUp = () => {
                    setFileBrowserResizing(false)
                    document.body.style.cursor = ''
                    document.body.style.userSelect = ''
                    document.removeEventListener('mousemove', onMouseMove)
                    document.removeEventListener('mouseup', onMouseUp)
                  }
                  document.body.style.cursor = 'col-resize'
                  document.body.style.userSelect = 'none'
                  document.addEventListener('mousemove', onMouseMove)
                  document.addEventListener('mouseup', onMouseUp)
                }}
              />
              <FileBrowser
                machineId={fbMachine.id}
                machineName={fbMachine.name}
                workingDirectory={fbWorkDir}
                fallbackDirectory={project!.workingDirectory}
                initialFilePath={initialFilePath}
                embedded
                onClose={() => setFileBrowserOpen(false)}
              />
            </div>
          ) : fileBrowserOpen && fbMachine && fbWorkDir && !isWide ? (
            <Sheet open={fileBrowserOpen} onOpenChange={setFileBrowserOpen}>
              <SheetContent side="right" className="w-[85vw] max-w-[400px] p-0 flex flex-col">
                <FileBrowser
                  machineId={fbMachine.id}
                  machineName={fbMachine.name}
                  workingDirectory={fbWorkDir}
                  fallbackDirectory={project!.workingDirectory}
                  initialFilePath={initialFilePath}
                  embedded
                  onClose={() => setFileBrowserOpen(false)}
                />
              </SheetContent>
            </Sheet>
          ) : null
        })()}
      </div>

      {/* Workdir bar — same as project view, at bottom */}
      {project && (
        <TaskWorkdirBar
          node={node}
          project={project}
          viewMode={searchParams.get("from") || "list"}
          fileBrowserOpen={fileBrowserOpen}
          onToggleFileBrowser={
            (() => {
              const fbMachine = project.defaultMachineId
                ? machines.find((m) => m.id === project.defaultMachineId)
                : machines.length === 1 ? machines[0] : undefined
              const fbWorkDir = getProjectFileBrowserRoot(project)
              return fbMachine && fbWorkDir ? () => setFileBrowserOpen((v) => !v) : undefined
            })()
          }
        />
      )}
    </div>
  )
}
