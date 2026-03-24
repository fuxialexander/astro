/**
 * TaskNode — custom React Flow node for plan tasks.
 *
 * Displays task title, status badge, estimate, and priority.
 * Active/streaming tasks have animated borders.
 */
import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import {
  Circle, CheckCircle2, Loader2, Clock, XCircle, Eye, Zap,
} from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import type { PlanNodeStatus } from '@desktop/types'

interface TaskNodeData {
  label: string
  description?: string
  status: PlanNodeStatus
  priority?: string | null
  estimate?: string | null
  selected?: boolean
}

const STATUS_CONFIG: Record<PlanNodeStatus, {
  icon: React.ComponentType<{ className?: string }>
  color: string
  bgColor: string
  label: string
}> = {
  planned: { icon: Circle, color: 'text-muted-foreground', bgColor: 'bg-muted', label: 'Planned' },
  dispatched: { icon: Zap, color: 'text-info', bgColor: 'bg-info/10', label: 'Dispatched' },
  in_progress: { icon: Loader2, color: 'text-primary', bgColor: 'bg-primary/10', label: 'In Progress' },
  auto_verified: { icon: CheckCircle2, color: 'text-success', bgColor: 'bg-success/10', label: 'Verified' },
  awaiting_approval: { icon: Clock, color: 'text-warning', bgColor: 'bg-warning/10', label: 'Awaiting Approval' },
  awaiting_judgment: { icon: Eye, color: 'text-warning', bgColor: 'bg-warning/10', label: 'Awaiting Judgment' },
  completed: { icon: CheckCircle2, color: 'text-success', bgColor: 'bg-success/10', label: 'Completed' },
  pruned: { icon: XCircle, color: 'text-muted-foreground', bgColor: 'bg-muted', label: 'Pruned' },
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-error text-error-foreground',
  high: 'bg-warning text-warning-foreground',
  medium: 'bg-info text-info-foreground',
  low: 'bg-muted text-muted-foreground',
}

export const TaskNode = memo(function TaskNode({ data }: { data: TaskNodeData }) {
  const config = STATUS_CONFIG[data.status] ?? STATUS_CONFIG.planned
  const StatusIcon = config.icon
  const isActive = data.status === 'in_progress' || data.status === 'dispatched'

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2" />
      <div
        className={cn(
          'min-w-[180px] max-w-[260px] rounded-xl border bg-card shadow-sm',
          'transition-all duration-200',
          data.selected && 'ring-2 ring-primary',
          isActive && 'border-primary/40 shadow-md',
          data.status === 'pruned' && 'opacity-50',
        )}
      >
        {/* Active indicator bar */}
        {isActive && (
          <div className="h-0.5 bg-gradient-to-r from-primary/60 via-primary to-primary/60 rounded-t-xl animate-pulse" />
        )}

        <div className="px-3 py-2.5 space-y-1.5">
          {/* Header: status icon + title */}
          <div className="flex items-start gap-2">
            <StatusIcon
              className={cn(
                'w-4 h-4 flex-shrink-0 mt-0.5',
                config.color,
                data.status === 'in_progress' && 'animate-spin',
              )}
            />
            <span className="text-xs font-medium text-foreground leading-tight line-clamp-2">
              {data.label}
            </span>
          </div>

          {/* Description preview */}
          {data.description && (
            <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2 pl-6">
              {data.description}
            </p>
          )}

          {/* Footer: badges */}
          <div className="flex items-center gap-1.5 pl-6">
            {/* Status badge */}
            <span
              className={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                config.bgColor, config.color,
              )}
            >
              {config.label}
            </span>

            {/* Estimate badge */}
            {data.estimate && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                {data.estimate}
              </span>
            )}

            {/* Priority badge */}
            {data.priority && (
              <span
                className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                  PRIORITY_COLORS[data.priority] ?? 'bg-muted text-muted-foreground',
                )}
              >
                {data.priority}
              </span>
            )}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border !w-2 !h-2" />
    </>
  )
})
