/**
 * ActiveTasksSummary — overview of running and pending tasks across all projects.
 */
import { Zap, AlertCircle, Clock, CheckCircle2 } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import type { PlanNode } from '@desktop/types'

interface ActiveTasksSummaryProps {
  nodes: PlanNode[]
}

export function ActiveTasksSummary({ nodes }: ActiveTasksSummaryProps) {
  const running = nodes.filter((n) => n.status === 'in_progress' || n.status === 'dispatched').length
  const awaitingJudgment = nodes.filter((n) => n.status === 'awaiting_judgment').length
  const awaitingApproval = nodes.filter((n) => n.status === 'awaiting_approval').length
  const completed = nodes.filter((n) => n.status === 'completed' || n.status === 'auto_verified').length
  const total = nodes.filter((n) => n.type !== 'milestone').length

  if (total === 0) return null

  const stats = [
    { label: 'Running', count: running, icon: Zap, color: 'text-info' },
    { label: 'Awaiting judgment', count: awaitingJudgment, icon: AlertCircle, color: 'text-warning' },
    { label: 'Awaiting approval', count: awaitingApproval, icon: Clock, color: 'text-warning' },
    { label: 'Completed', count: completed, icon: CheckCircle2, color: 'text-success' },
  ].filter((s) => s.count > 0)

  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Task Overview
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-center gap-2.5">
            <div className={cn('w-8 h-8 rounded-lg bg-muted flex items-center justify-center', stat.color)}>
              <stat.icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-lg font-semibold leading-none">{stat.count}</p>
              <p className="text-[10px] text-muted-foreground">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
