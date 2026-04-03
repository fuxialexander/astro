/**
 * ProjectHealthCard — compact card showing project progress and status.
 */
import { Zap } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import type { Project, PlanNode } from '@desktop/types'

interface ProjectHealthCardProps {
  project: Project
  nodes: PlanNode[]
  runningCount: number
  onClick: () => void
}

export function ProjectHealthCard({ project, nodes, runningCount, onClick }: ProjectHealthCardProps) {
  const total = nodes.filter((n) => n.type !== 'milestone').length
  const completed = nodes.filter(
    (n) => n.type !== 'milestone' && (n.status === 'completed' || n.status === 'auto_verified'),
  ).length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const inProgress = nodes.filter((n) => n.status === 'in_progress' || n.status === 'dispatched').length
  const planned = nodes.filter((n) => n.status === 'planned').length

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col gap-2 p-4 rounded-xl border text-left',
        'bg-card hover:border-primary/40 hover:bg-muted/50',
        'transition-colors duration-150 w-full',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-lg flex-shrink-0">{project.icon ?? '📋'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{project.name}</p>
          {project.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{project.description}</p>
          )}
        </div>
        {runningCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-info font-medium flex-shrink-0">
            <Zap className="w-3 h-3" />
            {runningCount}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground font-mono w-8 text-right">{progress}%</span>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        {total > 0 && <span>{completed}/{total} done</span>}
        {inProgress > 0 && <span className="text-info">{inProgress} running</span>}
        {planned > 0 && <span>{planned} planned</span>}
        {total === 0 && <span>No tasks yet</span>}
      </div>
    </button>
  )
}
