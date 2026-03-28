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
  ChevronRight,
} from "lucide-react"
import { stripHtml } from "@/lib/html-utils"
import { Button } from "@/components/ui/button"
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
        <h2 className="text-[13px] font-semibold tracking-wide text-muted-foreground/70 uppercase">Needs You</h2>
        <div className="flex items-center gap-4 rounded-xl border border-success/15 bg-success/[0.02] px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10 shrink-0">
            <CheckCircle2 className="h-3.5 w-3.5 text-success/70" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-foreground/80">All caught up</p>
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">No items need your attention right now.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[13px] font-semibold tracking-wide text-muted-foreground/70 uppercase">Needs You</h2>
          <span className="flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-warning/15 text-[10px] font-bold text-warning tabular-nums">
            {totalCount}
          </span>
        </div>
        <Button variant="ghost" size="sm" asChild className="h-6 text-[11px] text-muted-foreground/50 px-2 gap-1">
          <Link to="/tasks">
            View All
            <ChevronRight className="h-3 w-3" />
          </Link>
        </Button>
      </div>

      {/* Dynamic approvals (agent questions) */}
      {Array.from(dynamicApprovals.values()).map((approval) => (
        <div
          key={approval.requestId}
          className="rounded-xl border border-info/20 bg-info/[0.02] overflow-hidden"
        >
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex h-5 w-5 items-center justify-center rounded-md bg-info/10">
                <Zap className="h-3 w-3 text-info" />
              </div>
              <span className="text-[11px] font-semibold text-info tracking-wide uppercase">Agent Question</span>
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
          </div>
        </div>
      ))}

      {/* Pending judgment/approval nodes */}
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
          <div
            key={node.id}
            className="rounded-xl border border-border/50 bg-card/50 overflow-hidden transition-colors hover:border-border/80"
          >
            {/* Card body */}
            <div className="flex flex-col gap-3 p-4">
              {/* Header: status + project */}
              <div className="flex items-center justify-between">
                <StatusBadge status="awaiting" />
                <span className="text-[11px] text-muted-foreground/50 font-medium">{project?.name}</span>
              </div>

              {/* Title */}
              <Link
                to={`/project/${node.projectId}/task/${node.id}`}
                className="text-sm font-semibold text-foreground hover:text-primary transition-colors leading-snug"
              >
                {node.title}
              </Link>

              {/* Description */}
              {(node.content || node.description) && (
                <p className="text-xs text-muted-foreground/60 line-clamp-2 leading-relaxed">
                  {node.content ? stripHtml(node.content) : node.description}
                </p>
              )}

              {/* Execution summary */}
              {isLoadingExecution ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground/50 py-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading...</span>
                </div>
              ) : summary ? (
                <SummaryBlock summary={summary} />
              ) : error ? (
                <div className="rounded-lg border border-error/15 bg-error/[0.02] p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 text-error/60 mt-0.5 shrink-0" />
                    <p className="text-xs text-error/70 line-clamp-3 leading-relaxed">{error}</p>
                  </div>
                </div>
              ) : executionsLoaded && execution && (execution.status === "pending" || execution.status === "running") ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground/50 py-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading summary...</span>
                </div>
              ) : executionsLoaded && execution ? (
                <div className="rounded-lg border border-border/30 bg-muted/20 p-3">
                  <p className="text-[11px] text-muted-foreground/60 line-clamp-3 leading-relaxed">
                    {node.executionOutput || execution?.streamText || execution?.summary?.workCompleted || "No output captured."}
                  </p>
                </div>
              ) : executionsLoaded && !execution ? (
                <div className="rounded-lg border border-warning/15 bg-warning/[0.02] p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 text-warning/60 mt-0.5 shrink-0" />
                    <p className="text-xs text-warning/70">Execution data not found.</p>
                  </div>
                </div>
              ) : null}

              {/* Plan todos */}
              {execution?.planTodos && execution.planTodos.length > 0 && (
                <div className="rounded-lg border border-border/30 bg-muted/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-3 w-3 text-muted-foreground/40" />
                    <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Todos</span>
                  </div>
                  <ul className="space-y-1.5">
                    {execution.planTodos.map((todo, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        {todo.status === "completed" ? (
                          <Check className="h-3 w-3 text-success/70 mt-0.5 shrink-0" />
                        ) : todo.status === "in_progress" ? (
                          <Loader2 className="h-3 w-3 text-info/70 mt-0.5 shrink-0 animate-spin" />
                        ) : (
                          <div className="h-3 w-3 mt-0.5 shrink-0 rounded-full border border-muted-foreground/25" />
                        )}
                        <span className={cn(todo.status === "completed" ? "text-muted-foreground/40 line-through" : "text-foreground/70")}>
                          {todo.content}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Plan questions */}
              {execution?.planQuestions && execution.planQuestions.length > 0 && (
                <div className="rounded-lg border border-primary/15 bg-primary/[0.02] p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-3 w-3 text-primary/50" />
                    <span className="text-[10px] font-semibold text-primary/60 uppercase tracking-wider">Questions</span>
                  </div>
                  <ul className="space-y-2">
                    {execution.planQuestions.map((q, i) => (
                      <li key={i} className="text-xs">
                        <p className="font-medium text-foreground/70 mb-0.5">{q.question}</p>
                        <ul className="ml-3 space-y-0.5">
                          {q.options.map((opt, j) => (
                            <li key={j} className="text-muted-foreground/50">
                              - {opt}
                            </li>
                          ))}
                        </ul>
                        {q.answer && <p className="mt-1 text-primary/80 font-medium">Answer: {q.answer}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Acceptance criteria */}
              {node.acceptanceCriteria && node.acceptanceCriteria.length > 0 && (
                <div className="rounded-lg border border-border/30 bg-muted/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <ClipboardCheck className="h-3 w-3 text-muted-foreground/40" />
                    <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Acceptance Criteria</span>
                  </div>
                  <ul className="space-y-1.5">
                    {node.acceptanceCriteria.map((c) => (
                      <li key={c.id} className="flex items-start gap-2 text-xs">
                        <div className="h-3 w-3 mt-0.5 shrink-0 rounded-full border border-muted-foreground/25" />
                        <span className="text-foreground/70 flex-1">{c.description}</span>
                        {c.command && (
                          <code className="text-[10px] text-muted-foreground/35 font-mono shrink-0">{c.command}</code>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Action footer */}
            <div className="border-t border-border/30 px-4 py-2.5 bg-muted/[0.03]">
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={() => updateNode(node.id, { status: "completed" })}
                  className="h-7 text-[11px] font-medium px-3 gap-1.5"
                >
                  <Check className="h-3 w-3" />
                  Approve
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
                  className="h-7 text-[11px] px-3 border-border/40 gap-1.5"
                >
                  <RotateCcw className={cn("h-3 w-3", resettingId === node.id && "animate-spin")} />
                  {resettingId === node.id ? "Resetting..." : "Reset"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateNode(node.id, { status: "pruned" })}
                  className="h-7 text-[11px] text-muted-foreground/40 hover:text-error/70 px-3 gap-1.5 ml-auto"
                >
                  <Scissors className="h-3 w-3" />
                  Prune
                </Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Extracted summary block for cleaner rendering */
function SummaryBlock({ summary }: { summary: { status: string; filesChanged: string[]; keyFindings?: string[]; workCompleted?: string; followUps: string[] } }) {
  const borderColor =
    summary.status === "success"
      ? "border-success/15"
      : summary.status === "partial"
        ? "border-warning/15"
        : "border-error/15"
  const bgColor =
    summary.status === "success"
      ? "bg-success/[0.02]"
      : summary.status === "partial"
        ? "bg-warning/[0.02]"
        : "bg-error/[0.02]"

  return (
    <div className={cn("rounded-lg border p-3", borderColor, bgColor)}>
      <div className="flex items-center gap-2 mb-1.5">
        <Badge
          variant={
            summary.status === "success"
              ? "success"
              : summary.status === "partial"
                ? "warning"
                : "destructive"
          }
          className="text-[10px] h-5"
        >
          {summary.status}
        </Badge>
        {summary.filesChanged.length > 0 && (
          <span className="text-[10px] text-muted-foreground/40">
            {summary.filesChanged.length} file{summary.filesChanged.length !== 1 ? "s" : ""} changed
          </span>
        )}
      </div>
      {summary.keyFindings && summary.keyFindings.length > 0 ? (
        <ul className="space-y-0.5">
          {summary.keyFindings.map((finding, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-foreground/70 leading-relaxed">
              <span className="text-muted-foreground/30 mt-px shrink-0 select-none">&bull;</span>
              <span>{finding}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-foreground/70 leading-relaxed">{summary.workCompleted}</p>
      )}
      {summary.followUps.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/20">
          <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Follow-ups</span>
          <ul className="mt-1 space-y-0.5">
            {summary.followUps.map((f, i) => (
              <li key={i} className="text-[11px] text-muted-foreground/50 leading-relaxed">
                &bull; {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
