import { memo, useState, useCallback, useEffect, useRef } from "react"
import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react"
import { Plus, GitPullRequest, GitPullRequestCreateArrow, Sparkles, Check, GitMerge, Loader2, CheckCircle2, XCircle, RotateCw, Eye, ShieldCheck, Diamond } from "lucide-react"
import { cn } from "@/lib/utils"
import { STATUS_DOT_COLOR, PRIORITY_PIP_COLOR, type MilestoneColor } from "@/components/plan-graph/plan-node-shared"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useKeyboardNavStore } from "@/stores/keyboard-nav-store"
import { usePlanStore } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { formatRelativeTime } from "@/lib/date-utils"

const statusConfig: Record<string, { bg: string; border: string; dotColor: string }> = {
  planned: { bg: "bg-card", border: "border-border", dotColor: "bg-muted-foreground" },
  dispatched: { bg: "bg-card", border: "border-border", dotColor: "bg-info" },
  in_progress: { bg: "bg-card", border: "border-border", dotColor: "bg-info" },
  auto_verified: { bg: "bg-card", border: "border-border", dotColor: "bg-success" },
  awaiting_judgment: { bg: "bg-card", border: "border-border", dotColor: "bg-warning" },
  completed: { bg: "bg-card", border: "border-border", dotColor: "bg-success" },
  pruned: { bg: "bg-card", border: "border-border", dotColor: "bg-muted-foreground" },
}

const priorityHighlight: Record<string, { bg: string; border: string }> = {
  urgent: { bg: "bg-card", border: "border-border" },
  high: { bg: "bg-card", border: "border-border" },
  medium: { bg: "bg-card", border: "border-border" },
  low: { bg: "bg-card", border: "border-border" },
  none: { bg: "bg-card", border: "border-border" },
}

const neutralHighlight = { bg: "bg-card", border: "border-border" }

type TaskNodeData = Node<{
  title: string
  number?: number | null
  description?: string
  status: string
  nodeType: string
  executionId?: string
  priority?: string
  dueDate?: string
  prUrl?: string
  mergeQueueStatus?: string
  autoPr?: boolean
  githubIssueNumber?: number
  githubIssueUrl?: string
  highlightBy?: string
  checked?: boolean
  selectionActive?: boolean
  onDecompose?: (nodeId: string) => void
  onToggleSelect?: (nodeId: string) => void
  governedCount?: number
  readOnly?: boolean
  loopCurrentIteration?: number | null
  loopMaxIterations?: number
  loopBestMetricValue?: number | null
  loopStatus?: string | null
  milestoneColor?: MilestoneColor | null
  milestoneTotal?: number
  milestoneDone?: number
  fastEdit?: boolean
  onFastEdit?: (nodeId: string, title: string) => void
}>

export const TaskNode = memo(function TaskNode({ id, data }: NodeProps<TaskNodeData>) {
  const statusCfg = statusConfig[data.status] ?? statusConfig.planned
  const isMilestone = data.nodeType === "milestone"
  const isTask = data.nodeType === "task"
  const [hovered, setHovered] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { updateNode } = useReactFlow()
  const [editingTitle, setEditingTitle] = useState(false)
  const [editValue, setEditValue] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)
  const focusedId = useKeyboardNavStore((s) => s.focusedId)
  const isFocused = focusedId === id
  const isRecentlyUpdated = usePlanStore((s) => s.recentlyUpdatedNodeIds.has(id))

  useEffect(() => {
    if (editingTitle) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingTitle])

  // Show tooltip with delay to avoid flicker on quick mouse passes
  useEffect(() => {
    if (hovered && (data.title.length > 25 || data.description)) {
      tooltipTimer.current = setTimeout(() => setShowTooltip(true), 150)
    } else {
      setShowTooltip(false) // eslint-disable-line react-hooks/set-state-in-effect -- synchronous tooltip dismiss on unhover
    }
    return () => {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    }
  }, [hovered, data.title, data.description])

  // Elevate node above milestones when tooltip is visible
  useEffect(() => {
    updateNode(id, { zIndex: showTooltip ? 1000 : 0 })
  }, [id, showTooltip, updateNode])

  // Resolve highlight colors based on highlightBy mode (used by loop node)
  const highlight = (() => {
    const mode = data.highlightBy ?? "status"
    if (mode === "priority") {
      const h = priorityHighlight[data.priority ?? "none"] ?? neutralHighlight
      return { bg: h.bg, border: h.border, dotColor: statusCfg.dotColor }
    }
    if (mode === "none") {
      return { bg: neutralHighlight.bg, border: neutralHighlight.border, dotColor: statusCfg.dotColor }
    }
    return { bg: statusCfg.bg, border: statusCfg.border, dotColor: statusCfg.dotColor }
  })()

  // Get live progress from realtime store
  const taskStream = useRealtimeStore((s) =>
    data.executionId ? s.taskStreams.get(data.executionId) : undefined
  )
  const progress = taskStream?.progress ?? 0
  const isRunning = data.status === "in_progress" || data.status === "dispatched"

  // Execution attribution: "Ran by [name], [time ago]"
  const execution = useExecutionStore((s) => s.executions.get(id))
  const currentUserId = useUserProfileStore((s) => s.profile.id)
  const currentUserName = useUserProfileStore((s) => s.profile.name)
  const hasExecution = !!execution && (execution.status === "success" || execution.status === "failure" || execution.status === "cancelled")
  const attribution = (() => {
    if (!hasExecution || !execution) return null
    const time = execution.completedAt ?? execution.startedAt
    if (!time) return null
    const timeAgo = formatRelativeTime(time)
    let name = "Unknown"
    if (execution.userId) {
      name = execution.userId === currentUserId ? (currentUserName || "You") : "Team member"
    }
    return { name, timeAgo }
  })()

  // Verification state
  const isVerified = !!execution?.verifiedBy
  const needsVerification = data.status === "awaiting_judgment" && !isVerified

  // Selection state
  const showCheckbox = !data.readOnly && (hovered || data.selectionActive)
  const isChecked = data.checked ?? false

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    data.onToggleSelect?.(id)
  }, [data, id])

  // ── Milestone node ─────────────────────────────────────────────
  if (isMilestone) {
    const mc = data.milestoneColor ?? null
    return (
      <div
        className={cn(
          "relative rounded-lg shadow-sm select-none flex items-center gap-2 px-3 py-2 border-2 cursor-pointer",
          data.status === "pruned" && "opacity-50",
          isChecked && "ring-2 ring-primary ring-offset-1 ring-offset-background",
          isFocused && "shadow-[0_0_0_3px_rgba(var(--primary),0.4)] scale-[1.05] z-50",
          isRecentlyUpdated && "ring-2 ring-info/50 animate-pulse"
        )}
        style={{
          width: 200,
          minHeight: 40,
          borderColor: mc?.border ?? '#f59e0b',
          backgroundColor: mc?.bg ?? 'rgba(245,158,11,0.08)',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Target handles — always present for edge routing */}
        <Handle type="target" position={Position.Left} id="left"
          isConnectable={!data.readOnly}
          className={cn(
            "!border-none !rounded-full transition-all duration-150",
            data.readOnly
              ? "!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0"
              : hovered ? "!w-6 !h-6 !bg-primary shadow-md cursor-crosshair" : "!w-2 !h-2 !bg-border"
          )} />
        <Handle type="target" position={Position.Top} id="top"
          isConnectable={false}
          className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0 !border-0" />
        {!data.readOnly && hovered && (
          <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 pointer-events-none z-20">
            <Plus className="h-3 w-3 text-primary-foreground" />
          </div>
        )}

        {showTooltip && (
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-[280px] z-30 pointer-events-none bg-popover border shadow-lg rounded-lg p-3">
            <p className="text-xs font-semibold text-foreground leading-snug">{data.title}</p>
            {data.description && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-4">
                {data.description.slice(0, 200)}{data.description.length > 200 ? "..." : ""}
              </p>
            )}
          </div>
        )}

        <Diamond className="h-3.5 w-3.5 shrink-0 relative z-10" style={{ color: mc?.text ?? '#b45309' }} />
        {editingTitle ? (
          <input
            ref={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Enter") {
                e.preventDefault()
                const t = editValue.trim()
                if (t) data.onFastEdit?.(id, t)
                setEditingTitle(false)
              } else if (e.key === "Escape") {
                e.preventDefault()
                setEditingTitle(false)
              }
            }}
            onBlur={() => {
              const t = editValue.trim()
              if (t && t !== data.title) data.onFastEdit?.(id, t)
              setEditingTitle(false)
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-transparent text-[11px] font-bold tracking-tight outline-none relative z-10"
            style={{ color: mc?.text ?? '#b45309' }}
          />
        ) : (
          <span
            className={cn("text-[11px] font-bold tracking-tight truncate flex-1 relative z-10", data.fastEdit && "cursor-text")}
            style={{ color: mc?.text ?? '#b45309' }}
            onClick={data.fastEdit ? (e) => {
              e.stopPropagation()
              setEditValue(data.title)
              setEditingTitle(true)
            } : undefined}
          >
            {data.number != null && <span className="font-normal opacity-60 mr-1">#{data.number}</span>}
            {data.title}
          </span>
        )}

        {/* Completion pie */}
        {(data.milestoneTotal ?? 0) > 0 && (() => {
          const total = data.milestoneTotal!
          const done = data.milestoneDone ?? 0
          const pct = done / total
          const r = 7
          const circ = 2 * Math.PI * r
          const dash = pct * circ
          return (
            <svg width="18" height="18" className="shrink-0 relative z-10" viewBox="0 0 18 18">
              <circle cx="9" cy="9" r={r} fill="none" stroke={(mc?.border ?? '#b45309') + '30'} strokeWidth="2.5" />
              <circle cx="9" cy="9" r={r} fill="none" stroke={mc?.border ?? '#b45309'} strokeWidth="2.5"
                strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                transform="rotate(-90 9 9)" />
              <text x="9" y="9" dominantBaseline="central" textAnchor="middle"
                fontSize="5" fontWeight="bold" fill={mc?.text ?? '#b45309'}>
                {done}/{total}
              </text>
            </svg>
          )
        })()}

        {/* Source handles — always present for edge routing */}
        <Handle type="source" position={Position.Right} id="right"
          isConnectable={!data.readOnly}
          className={cn(
            "!border-none !rounded-full transition-all duration-150",
            data.readOnly
              ? "!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0"
              : hovered ? "!w-6 !h-6 !bg-primary shadow-md cursor-crosshair" : "!w-2 !h-2 !bg-border"
          )} />
        <Handle type="source" position={Position.Bottom} id="bottom"
          isConnectable={false}
          className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0 !border-0" />
        {!data.readOnly && hovered && (
          <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 pointer-events-none z-20">
            <Plus className="h-3 w-3 text-primary-foreground" />
          </div>
        )}
      </div>
    )
  }

  // ── Loop node ─────────────────────────────────────────────────
  if (data.nodeType === "loop") {
    const iterLabel = data.loopCurrentIteration != null && data.loopMaxIterations
      ? `${data.loopCurrentIteration}/${data.loopMaxIterations}`
      : ""
    const bestLabel = data.loopBestMetricValue != null ? data.loopBestMetricValue.toFixed(4) : ""
    const isLoopRunning = data.loopStatus === "iterating"

    return (
      <div
        className={cn(
          "relative flex items-center gap-2 border-2 px-3 shadow-sm transition-all duration-200",
          "h-[48px] w-[200px] rounded-xl",
          isLoopRunning ? "border-violet-400 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-500/60" : highlight.border,
          !isLoopRunning && highlight.bg,
          data.status === "pruned" && "opacity-50",
          isChecked && "ring-2 ring-primary ring-offset-1 ring-offset-background",
          isFocused && "shadow-[0_0_0_3px_rgba(var(--primary),0.4)] scale-[1.05] z-50",
          isRecentlyUpdated && "ring-2 ring-info/50 animate-pulse",
          isLoopRunning && "shadow-lg shadow-violet-300/30 dark:shadow-violet-500/20"
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Target handles — always present for edge routing */}
        <Handle type="target" position={Position.Left} id="left"
          isConnectable={!data.readOnly}
          className={cn("!border-none !rounded-full transition-all duration-150",
            data.readOnly
              ? "!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0"
              : hovered ? "!w-6 !h-6 !bg-primary shadow-md cursor-crosshair" : "!w-2 !h-2 !bg-border"
          )} />
        <Handle type="target" position={Position.Top} id="top"
          isConnectable={false}
          className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0 !border-0" />
        {!data.readOnly && hovered && (
          <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 pointer-events-none z-20">
            <Plus className="h-3 w-3 text-primary-foreground" />
          </div>
        )}

        {showTooltip && (
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-[280px] z-30 pointer-events-none bg-popover border shadow-lg rounded-lg p-3">
            <p className="text-xs font-semibold text-foreground leading-snug">{data.title}</p>
            {iterLabel && <p className="text-[11px] text-muted-foreground mt-1">Iteration {iterLabel}</p>}
            {bestLabel && <p className="text-[11px] text-muted-foreground">Best: {bestLabel}</p>}
            {data.description && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-4">
                {data.description.slice(0, 200)}{data.description.length > 200 ? "..." : ""}
              </p>
            )}
          </div>
        )}

        {/* Loop icon */}
        <RotateCw className={cn(
          "h-3.5 w-3.5 shrink-0 relative z-10",
          isLoopRunning ? "text-violet-500 animate-spin" : "text-violet-400"
        )} style={isLoopRunning ? { animationDuration: "3s" } : undefined} />

        <div className="flex flex-col min-w-0 relative z-10">
          <span className={cn(
            "truncate text-xs font-medium",
            data.status === "pruned" ? "text-muted-foreground line-through" : "text-foreground"
          )}>
            {data.number != null && <span className="text-muted-foreground mr-1">#{data.number}</span>}
            {data.title}
          </span>
          <div className="flex gap-2 text-[10px] text-muted-foreground">
            {iterLabel && <span>iter {iterLabel}</span>}
            {bestLabel && <span>best: {bestLabel}</span>}
          </div>
        </div>

        {/* Source handles — always present for edge routing */}
        <Handle type="source" position={Position.Right} id="right"
          isConnectable={!data.readOnly}
          className={cn("!border-none !rounded-full transition-all duration-150",
            data.readOnly
              ? "!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0"
              : hovered ? "!w-6 !h-6 !bg-primary shadow-md cursor-crosshair" : "!w-2 !h-2 !bg-border"
          )} />
        <Handle type="source" position={Position.Bottom} id="bottom"
          isConnectable={false}
          className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0 !border-0" />
        {!data.readOnly && hovered && (
          <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 pointer-events-none z-20">
            <Plus className="h-3 w-3 text-primary-foreground" />
          </div>
        )}
      </div>
    )
  }

  // ── Regular task node ──────────────────────────────────────────
  const mc = data.milestoneColor ?? null
  const priorityPipColor = data.priority ? PRIORITY_PIP_COLOR[data.priority] : null
  return (
    <div
      className={cn(
        "relative rounded-md border bg-card shadow-sm select-none",
        data.status === "pruned" && "opacity-40",
        isChecked && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        isFocused && "shadow-[0_0_0_3px_rgba(var(--primary),0.4)] scale-[1.05] z-50",
        isRecentlyUpdated && "ring-2 ring-info/50 animate-pulse"
      )}
      style={{
        width: 164,
        minHeight: 56,
        borderColor: mc ? mc.border + '60' : undefined,
        backgroundColor: mc ? mc.bg : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Target handles — always present for edge routing */}
      <Handle type="target" position={Position.Left} id="left"
        isConnectable={!data.readOnly}
        className={cn(
          "!border-none !rounded-full transition-all duration-150",
          data.readOnly || data.status === "pruned"
            ? "!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0"
            : hovered
              ? "!w-6 !h-6 !bg-primary shadow-md cursor-crosshair"
              : "!w-2 !h-2 !bg-border"
        )} />
      <Handle type="target" position={Position.Top} id="top"
        isConnectable={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0 !border-0" />
      {!data.readOnly && hovered && data.status !== "pruned" && (
        <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 pointer-events-none z-20">
          <Plus className="h-3 w-3 text-primary-foreground" />
        </div>
      )}

      {/* Hover tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-[280px] z-30 pointer-events-none bg-popover border shadow-lg rounded-lg p-3">
          <p className="text-xs font-semibold text-foreground leading-snug">{data.title}</p>
          {data.description && (
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-4">
              {data.description.slice(0, 200)}{data.description.length > 200 ? "..." : ""}
            </p>
          )}
        </div>
      )}

      {/* Running glow */}
      {isRunning && (
        <div className="absolute -inset-4 -z-10 opacity-20 pointer-events-none">
          <div className="absolute inset-0 rounded-full blur-xl"
            style={{ background: "radial-gradient(ellipse 160px 60px at center, rgba(59, 130, 246, 0.25) 0%, rgba(59, 130, 246, 0) 70%)" }} />
        </div>
      )}

      {/* Progress bar overlay */}
      {isRunning && progress > 0 && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-md">
          <div className="absolute left-0 top-0 bottom-0 bg-info/10 transition-all duration-500"
            style={{ width: `${progress}%` }} />
        </div>
      )}

      <div className="px-2.5 py-1.5 flex flex-col gap-1">
        {/* Title row */}
        <div className="flex items-start gap-1.5 min-w-0">
          {showCheckbox && (
            <button
              type="button"
              onClick={handleCheckboxClick}
              className={cn(
                "relative z-10 flex h-3.5 w-3.5 shrink-0 mt-px items-center justify-center rounded-full border-[1.5px] transition-colors cursor-pointer",
                isChecked
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40 bg-transparent hover:border-primary/60"
              )}
            >
              {isChecked && <Check className="h-2 w-2" strokeWidth={3} />}
            </button>
          )}
          {editingTitle ? (
            <input
              ref={editInputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === "Enter") {
                  e.preventDefault()
                  const t = editValue.trim()
                  if (t) data.onFastEdit?.(id, t)
                  setEditingTitle(false)
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  setEditingTitle(false)
                }
              }}
              onBlur={() => {
                const t = editValue.trim()
                if (t && t !== data.title) data.onFastEdit?.(id, t)
                setEditingTitle(false)
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-transparent text-[11px] font-medium leading-tight text-foreground/90 outline-none border-b border-primary/60 relative z-10"
            />
          ) : (
            <span
              className={cn(
                "text-[11px] font-medium leading-tight line-clamp-2 text-foreground/90 relative z-10",
                data.status === "pruned" && "line-through text-muted-foreground",
                data.fastEdit && "cursor-text"
              )}
              onClick={data.fastEdit ? (e) => {
                e.stopPropagation()
                setEditValue(data.title)
                setEditingTitle(true)
              } : undefined}
            >
              {data.number != null && <span className="text-muted-foreground/60 mr-1">#{data.number}</span>}
              {data.title}
            </span>
          )}
        </div>

        {/* Status / meta row */}
        <div className="flex items-center gap-1.5 relative z-10">
          <span className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ background: STATUS_DOT_COLOR[data.status] ?? '#94a3b8' }} />

          {/* Verification / attribution */}
          {isVerified ? (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium rounded-full bg-success/12 text-success px-1 py-px border border-success/20">
              <ShieldCheck className="h-2 w-2 shrink-0" />Verified
            </span>
          ) : needsVerification ? (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium rounded-full bg-warning/12 text-warning px-1 py-px border border-warning/20">
              <Eye className="h-2 w-2 shrink-0" />Review
            </span>
          ) : attribution ? (
            <span className="truncate text-[9px] text-muted-foreground/60">{attribution.name}</span>
          ) : null}

          {/* Right side icons + priority pip */}
          <div className="ml-auto flex items-center gap-1">
            {isRunning && progress > 0 && (
              <span className="text-[9px] font-medium text-info">{progress}%</span>
            )}
            {data.mergeQueueStatus && (
              <span title={`Merge queue: ${data.mergeQueueStatus}`}>
                {data.mergeQueueStatus === 'queued' && <GitMerge className="h-2.5 w-2.5 text-info" />}
                {data.mergeQueueStatus === 'testing' && <Loader2 className="h-2.5 w-2.5 text-warning animate-spin" />}
                {data.mergeQueueStatus === 'merged' && <CheckCircle2 className="h-2.5 w-2.5 text-success" />}
                {data.mergeQueueStatus === 'failed' && <XCircle className="h-2.5 w-2.5 text-error" />}
              </span>
            )}
            {data.prUrl && !data.mergeQueueStatus && (
              <GitPullRequest className="h-2.5 w-2.5 text-primary" />
            )}
            {data.autoPr && !data.prUrl && !data.mergeQueueStatus && (
              <GitPullRequestCreateArrow className="h-2.5 w-2.5 text-info" />
            )}
            {priorityPipColor && (
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: priorityPipColor }} />
            )}
          </div>
        </div>
      </div>

      {/* in_progress ring overlay */}
      {isRunning && (
        <div className="absolute inset-0 rounded-md ring-1 ring-inset pointer-events-none"
          style={{ borderColor: mc?.stripe ?? '#60a5fa', opacity: 0.4 }} />
      )}

      {/* Decompose button */}
      {!data.readOnly && hovered && isTask && data.status !== "pruned" && data.onDecompose && (
        <button
          type="button"
          title="Decompose into sub-tasks"
          className="absolute -top-3 -right-3 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-white shadow-md hover:bg-violet-600 transition-colors cursor-pointer"
          onClick={(e) => { e.stopPropagation(); data.onDecompose?.(id) }}
        >
          <Sparkles className="h-3 w-3" />
        </button>
      )}

      {/* Source handles — always present for edge routing */}
      <Handle type="source" position={Position.Right} id="right"
        isConnectable={!data.readOnly}
        className={cn(
          "!border-none !rounded-full transition-all duration-150",
          data.readOnly || data.status === "pruned"
            ? "!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0"
            : hovered
              ? "!w-6 !h-6 !bg-primary shadow-md cursor-crosshair"
              : "!w-2 !h-2 !bg-border"
        )} />
      <Handle type="source" position={Position.Bottom} id="bottom"
        isConnectable={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0 !border-0" />
      {!data.readOnly && hovered && data.status !== "pruned" && (
        <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 pointer-events-none z-20">
          <Plus className="h-3 w-3 text-primary-foreground" />
        </div>
      )}
    </div>
  )
})

/** Dashed placeholder node shown to the right of the last milestone.
 *  Clicking activates inline editing that visually matches a real milestone node.
 */
export const AddMilestoneNode = memo(function AddMilestoneNode({
  data,
}: {
  data: { onCreate: (title: string) => void }
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = useCallback(() => {
    const title = value.trim()
    if (title) data.onCreate(title)
    setValue('')
    setEditing(false)
  }, [value, data])

  const cancel = useCallback(() => {
    setValue('')
    setEditing(false)
  }, [])

  if (editing) {
    // Editing state: visually matches a real milestone node (border-2, same dimensions)
    return (
      <div
        className="relative rounded-lg flex items-center gap-2 px-3 py-2 border-2"
        style={{
          width: 200,
          minHeight: 40,
          borderColor: 'var(--border)',
          backgroundColor: 'var(--muted)',
        }}
      >
        <Diamond className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
            e.stopPropagation()
          }}
          onBlur={commit}
          placeholder="Milestone name"
          className="flex-1 min-w-0 bg-transparent text-[11px] font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
        />
      </div>
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="flex items-center gap-1.5 px-3 rounded-lg cursor-pointer select-none"
      style={{
        width: 200,
        height: 40,
        border: '1.5px dashed',
        borderColor: 'var(--border)',
        background: 'transparent',
        color: 'var(--muted-foreground)',
        opacity: 0.55,
        transition: 'opacity 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.opacity = '1' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = '0.55' }}
    >
      <Diamond className="h-3 w-3 shrink-0" />
      <span className="text-[11px] font-medium">New milestone</span>
    </div>
  )
})
