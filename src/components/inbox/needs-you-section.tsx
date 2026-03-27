/**
 * NeedsYouSection — Inbox "Needs You" panel
 *
 * Renders pending approval cards (execution-store) and dynamic approvals
 * (realtime-store) plus awaiting_judgment / awaiting_approval nodes.
 * Max 5 visible items; overflow links to /tasks?status=awaiting_judgment.
 * Auto-dismisses dynamic approvals in YOLO mode.
 * Shows a calm "All caught up" state when empty.
 */

import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { CheckCircle2, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import { ApprovalCard } from "@/components/approval-card"
import { InlineApprovalCard } from "@/components/plan-generation/inline-approval-card"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import { formatRelativeTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"

const MAX_VISIBLE = 5

interface NeedsYouSectionProps {
  className?: string
}

export function NeedsYouSection({ className }: NeedsYouSectionProps) {
  const { t } = useTranslation("dashboard")

  // ── Store selectors ──
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const updateNode = usePlanStore((s) => s.updateNode)
  const projects = useProjectStore((s) => s.projects)

  const pendingApprovals = useExecutionStore((s) => s.pendingApprovals)
  const respondToApproval = useExecutionStore((s) => s.respondToApproval)

  const dynamicApprovals = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)

  const yoloMode = useSettingsStore((s) => s.yoloMode)

  // ── Auto-dismiss in YOLO mode (mirrors dashboard lines 97-103) ──
  useEffect(() => {
    if (!yoloMode || dynamicApprovals.size === 0) return
    for (const approval of dynamicApprovals.values()) {
      respondToDynamicApproval(approval.taskId, approval.requestId, approval.options[0])
    }
  }, [yoloMode, dynamicApprovals, respondToDynamicApproval])

  // ── Derived data ──
  const pendingNodes = useMemo(
    () => nodes.filter((n) => n.status === "awaiting_judgment" || n.status === "awaiting_approval"),
    [nodes],
  )

  const dynamicApprovalList = useMemo(
    () => Array.from(dynamicApprovals.values()),
    [dynamicApprovals],
  )

  const totalItems = dynamicApprovalList.length + pendingNodes.length
  const hasAttention = totalItems > 0
  const visibleDynamic = dynamicApprovalList.slice(0, MAX_VISIBLE)
  const remainingSlots = Math.max(0, MAX_VISIBLE - visibleDynamic.length)
  const visibleNodes = pendingNodes.slice(0, remainingSlots)
  const overflowCount = totalItems - (visibleDynamic.length + visibleNodes.length)

  // ── Empty state ──
  if (!hasAttention) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <h2 className="text-[13px] font-semibold tracking-wide">{t("needsAttention")}</h2>
        <div className="flex items-center gap-4 rounded-xl border border-success/15 bg-success/[0.02] px-5 py-4 backdrop-blur-sm">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-success/10 shrink-0">
            <CheckCircle2 className="h-4 w-4 text-success/80" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium">{t("allCaughtUp")}</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">{t("noActiveTasks")}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold tracking-wide">{t("needsAttention")}</h2>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-6 text-[11px] text-muted-foreground/60 px-2"
        >
          <Link to="/tasks?status=awaiting_judgment">{t("viewAll")}</Link>
        </Button>
      </div>

      {/* Dynamic approvals (agent questions) */}
      {visibleDynamic.map((approval) => {
        const taskNode = nodes.find((n) => n.id === approval.taskId)
        const project = taskNode
          ? projects.find((p) => p.id === taskNode.projectId)
          : undefined

        return (
          <Card key={approval.requestId} className="rounded-xl border-border/60">
            <CardContent className="p-4">
              {/* Compact header: project dot · task title · time · action */}
              <div className="flex items-center gap-2 mb-2">
                {project && (
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: project.color || "var(--color-info)" }}
                  />
                )}
                <span className="text-[11px] font-medium text-foreground/80 truncate flex-1 min-w-0">
                  {taskNode?.title || approval.taskId}
                </span>
                <span className="text-[10px] text-muted-foreground/40 shrink-0">
                  {formatRelativeTime(approval.timestamp)}
                </span>
                <Zap className="h-3 w-3 text-info shrink-0" />
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
        )
      })}

      {/* Pending approval / awaiting judgment nodes */}
      {visibleNodes.map((node) => {
        const project = projects.find((p) => p.id === node.projectId)
        const approval = Array.from(pendingApprovals.values()).find((a) => a.nodeId === node.id)

        // Execution-level approval — reuse the full ApprovalCard
        if (node.status === "awaiting_approval" && approval) {
          return (
            <div key={node.id} className="flex flex-col gap-1">
              {/* Compact context row */}
              <div className="flex items-center gap-2 px-1">
                {project && (
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: project.color || "var(--color-info)" }}
                  />
                )}
                <span className="text-[11px] text-muted-foreground/60 truncate">
                  {project?.name}
                </span>
              </div>
              <ApprovalCard approval={approval} onRespond={respondToApproval} />
            </div>
          )
        }

        // Awaiting judgment — compact card with approve/reject actions
        return (
          <Card key={node.id} className="rounded-xl border-border/60">
            <CardContent className="p-4">
              {/* Compact header: project dot · title · time · status */}
              <div className="flex items-center gap-2 mb-2">
                {project && (
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: project.color || "var(--color-info)" }}
                  />
                )}
                <Link
                  to={`/project/${node.projectId}/task/${node.id}`}
                  className="text-[11px] font-medium text-foreground/80 truncate flex-1 min-w-0 hover:text-primary transition-colors"
                >
                  {node.title}
                </Link>
                {node.executionCompletedAt && (
                  <span className="text-[10px] text-muted-foreground/40 shrink-0">
                    {formatRelativeTime(new Date(node.executionCompletedAt))}
                  </span>
                )}
                <StatusBadge status="awaiting" />
              </div>

              {node.description && (
                <p className="text-xs text-muted-foreground/60 line-clamp-2 mb-3">
                  {node.description}
                </p>
              )}

              {/* Action row: REJECT small, APPROVE prominent */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => updateNode(node.id, { status: "completed" })}
                  className="h-7 text-xs flex-1"
                >
                  {t("approve")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateNode(node.id, { status: "pruned" })}
                  className="h-7 text-xs border-border/60"
                >
                  {t("prune")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* Overflow indicator */}
      {overflowCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-7 text-[11px] text-muted-foreground/50 w-full"
        >
          <Link to="/tasks?status=awaiting_judgment">
            +{overflowCount} more item{overflowCount !== 1 ? "s" : ""}
          </Link>
        </Button>
      )}
    </div>
  )
}
