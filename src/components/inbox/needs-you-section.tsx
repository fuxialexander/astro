import { useMemo, useState } from "react"
import { Link } from "react-router"
import {
  Check,
  Zap,
  AlertCircle,
  RotateCcw,
  Scissors,
  Loader2,
  CheckCircle2,
  ClipboardCheck,
  FileText,
} from "lucide-react"
import { stripHtml } from "@/lib/html-utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { ApprovalCard } from "@/components/approval-card"
import { InlineApprovalCard } from "@/components/plan-generation/inline-approval-card"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { cn } from "@/lib/utils"

export function NeedsYouSection() {
  const projects = useProjectStore((s) => s.projects)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const updateNode = usePlanStore((s) => s.updateNode)
  const pendingApprovals = useExecutionStore((s) => s.pendingApprovals)
  const respondToApproval = useExecutionStore((s) => s.respondToApproval)
  const getExecution = useExecutionStore((s) => s.getExecution)
  const executionsLoaded = useExecutionStore((s) => s.loaded)
  const resetExecution = useExecutionStore((s) => s.resetExecution)
  const dynamicApprovals = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)
  const [resettingId, setResettingId] = useState<string | null>(null)

  const pendingNodes = useMemo(
    () => nodes.filter((n) => n.status === "awaiting_judgment" || n.status === "awaiting_approval"),
    [nodes],
  )

  const hasAttention = pendingNodes.length > 0 || dynamicApprovals.size > 0
  const totalCount = pendingNodes.length + dynamicApprovals.size

  if (!hasAttention) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold tracking-wide">Needs You</h2>
        <div className="flex items-center gap-4 rounded-xl border border-success/15 bg-success/[0.02] px-5 py-4 backdrop-blur-sm">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-success/10 shrink-0">
            <CheckCircle2 className="h-4 w-4 text-success/80" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium">All caught up</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">No items need your attention right now.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold tracking-wide">
          Needs You
          <span className="ml-2 text-[11px] text-muted-foreground/50">({totalCount})</span>
        </h2>
        <Button variant="ghost" size="sm" asChild className="h-6 text-[11px] text-muted-foreground/60 px-2">
          <Link to="/tasks">View All</Link>
        </Button>
      </div>

      {Array.from(dynamicApprovals.values()).map((approval) => (
        <Card key={approval.requestId} className="rounded-xl border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-3.5 w-3.5 text-info" />
              <span className="text-[11px] font-semibold text-info">Agent Question</span>
            </div>
            <InlineApprovalCard
              requestId={approval.requestId}
              question={approval.question}
              options={approval.options}
              answered={false}
              onRespond={async (_requestId, answer) => {
                await respondToDynamicApproval(approval.taskId, approval.requestId, answer)
              }}
            />
          </CardContent>
        </Card>
      ))}

      {pendingNodes.map((node) => {
        const project = projects.find((p) => p.id === node.projectId)
        const approval = Array.from(pendingApprovals.values()).find((a) => a.nodeId === node.id)

        if (node.status === "awaiting_approval" && approval) {
          return <ApprovalCard key={node.id} approval={approval} onRespond={respondToApproval} />
        }

        const execution = getExecution(node.id)
        const summary = execution?.summary
        const error = node.executionError || execution?.error
        const isLoadingExecution = !executionsLoaded && !execution

        return (
          <Card key={node.id} className="rounded-xl border-border/60">
            <CardContent className="flex flex-col gap-0 p-0">
              <div className="flex flex-col gap-2.5 p-4">
                <div className="flex items-center justify-between">
                  <StatusBadge status="awaiting" />
                  <span className="text-[11px] text-muted-foreground/60">{project?.name}</span>
                </div>
                <Link
                  to={`/project/${node.projectId}/task/${node.id}`}
                  className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
                >
                  {node.title}
                </Link>
                <p className="text-xs text-muted-foreground/70 line-clamp-2">
                  {node.content ? stripHtml(node.content) : node.description}
                </p>

                {isLoadingExecution ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading...</span>
                  </div>
                ) : summary ? (
                  <div
                    className={cn(
                      "rounded-lg border p-3",
                      summary.status === "success"
                        ? "border-success/20 bg-success/[0.03]"
                        : summary.status === "partial"
                          ? "border-warning/20 bg-warning/[0.03]"
                          : "border-error/20 bg-error/[0.03]",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant={
                          summary.status === "success"
                            ? "success"
                            : summary.status === "partial"
                              ? "warning"
                              : "destructive"
                        }
                        className="text-[10px]"
                      >
                        {summary.status}
                      </Badge>
                      {summary.filesChanged.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/50">
                          {summary.filesChanged.length} file{summary.filesChanged.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {summary.keyFindings && summary.keyFindings.length > 0 ? (
                      <ul className="space-y-0.5">
                        {summary.keyFindings.map((finding, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                            <span className="text-muted-foreground/40 mt-0.5 shrink-0">-</span>
                            <span>{finding}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-foreground/80">{summary.workCompleted}</p>
                    )}
                    {summary.followUps.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wide">
                          Follow-ups
                        </span>
                        <ul className="mt-1 space-y-0.5">
                          {summary.followUps.map((f, i) => (
                            <li key={i} className="text-[11px] text-muted-foreground/60">
                              - {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : error ? (
                  <div className="rounded-lg border border-error/20 bg-error/[0.03] p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-3.5 w-3.5 text-error/70 mt-0.5 shrink-0" />
                      <p className="text-xs text-error/80 line-clamp-3">{error}</p>
                    </div>
                  </div>
                ) : executionsLoaded && execution && (execution.status === "pending" || execution.status === "running") ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading summary...</span>
                  </div>
                ) : executionsLoaded && execution ? (
                  <div className="rounded-lg border border-border/30 p-3">
                    <p className="text-[11px] text-muted-foreground/60 line-clamp-3">
                      {node.executionOutput || execution?.streamText || execution?.summary?.workCompleted || "No output captured."}
                    </p>
                  </div>
                ) : executionsLoaded && !execution ? (
                  <div className="rounded-lg border border-warning/20 bg-warning/[0.03] p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-3.5 w-3.5 text-warning/70 mt-0.5 shrink-0" />
                      <p className="text-xs text-warning/80">Execution data not found.</p>
                    </div>
                  </div>
                ) : null}

                {execution?.planTodos && execution.planTodos.length > 0 && (
                  <div className="rounded-lg border border-info/20 bg-info/[0.03] p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <FileText className="h-3.5 w-3.5 text-info/70" />
                      <span className="text-[11px] font-semibold text-info">Plan Todos</span>
                    </div>
                    <ul className="space-y-1">
                      {execution.planTodos.map((todo, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs">
                          {todo.status === "completed" ? (
                            <Check className="h-3 w-3 text-success mt-0.5 shrink-0" />
                          ) : todo.status === "in_progress" ? (
                            <Loader2 className="h-3 w-3 text-info mt-0.5 shrink-0 animate-spin" />
                          ) : (
                            <div className="h-3 w-3 mt-0.5 shrink-0 rounded-full border border-muted-foreground/30" />
                          )}
                          <span className={cn(todo.status === "completed" ? "text-muted-foreground/50 line-through" : "text-foreground/80")}>
                            {todo.content}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {execution?.planQuestions && execution.planQuestions.length > 0 && (
                  <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-primary/70" />
                      <span className="text-[11px] font-semibold text-primary">Questions</span>
                    </div>
                    <ul className="space-y-1.5">
                      {execution.planQuestions.map((q, i) => (
                        <li key={i} className="text-xs">
                          <p className="font-medium text-foreground/80 mb-0.5">{q.question}</p>
                          <ul className="ml-3 space-y-0.5">
                            {q.options.map((opt, j) => (
                              <li key={j} className="text-muted-foreground/60">
                                - {opt}
                              </li>
                            ))}
                          </ul>
                          {q.answer && <p className="mt-1 text-primary font-medium">Answer: {q.answer}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {node.acceptanceCriteria && node.acceptanceCriteria.length > 0 && (
                  <div className="rounded-lg border border-border/30 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground/50" />
                      <span className="text-[11px] font-semibold">Acceptance Criteria</span>
                    </div>
                    <ul className="space-y-1">
                      {node.acceptanceCriteria.map((c) => (
                        <li key={c.id} className="flex items-start gap-2 text-xs">
                          <div className="h-3 w-3 mt-0.5 shrink-0 rounded-full border border-muted-foreground/30" />
                          <span>{c.description}</span>
                          {c.command && (
                            <code className="text-[10px] text-muted-foreground/40 ml-auto shrink-0">{c.command}</code>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="border-t border-border/30 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => updateNode(node.id, { status: "completed" })} className="h-8 text-xs">
                    <Check className="h-3 w-3 mr-1" /> Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resettingId === node.id}
                    onClick={async () => {
                      setResettingId(node.id)
                      try {
                        await resetExecution(node.id)
                      } finally {
                        setResettingId(null)
                      }
                    }}
                    className="h-8 text-xs border-border/60"
                  >
                    <RotateCcw className={cn("h-3 w-3 mr-1", resettingId === node.id && "animate-spin")} />
                    {resettingId === node.id ? "Resetting..." : "Reset"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateNode(node.id, { status: "pruned" })}
                    className="h-8 text-xs text-muted-foreground/50"
                  >
                    <Scissors className="h-3 w-3 mr-1" /> Prune
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
