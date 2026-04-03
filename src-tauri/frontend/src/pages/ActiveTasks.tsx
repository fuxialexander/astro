/**
 * ActiveTasks — shows currently running and recent tasks across all projects.
 */
import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { Zap, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import { usePlanStore } from '@desktop/stores/plan-store'
import { useProjectStore } from '@desktop/stores/project-store'
import type { PlanNode } from '@desktop/types'

const statusConfig: Record<string, { icon: typeof Zap; color: string; label: string }> = {
  in_progress: { icon: Zap, color: 'text-info', label: 'Running' },
  dispatched: { icon: Clock, color: 'text-info', label: 'Dispatched' },
  awaiting_judgment: { icon: AlertCircle, color: 'text-warning', label: 'Awaiting judgment' },
  awaiting_approval: { icon: Clock, color: 'text-warning', label: 'Awaiting approval' },
  completed: { icon: CheckCircle2, color: 'text-success', label: 'Completed' },
  auto_verified: { icon: CheckCircle2, color: 'text-success', label: 'Verified' },
}

export function ActiveTasks() {
  const navigate = useNavigate()
  const { nodes, loadNodes } = usePlanStore()
  const { projects, loadProjects } = useProjectStore()

  useEffect(() => {
    void loadNodes()
    void loadProjects()
  }, [loadNodes, loadProjects])

  const activeTasks = useMemo(() =>
    nodes
      .filter((n) => n.type !== 'milestone' && ['in_progress', 'dispatched', 'awaiting_judgment', 'awaiting_approval'].includes(n.status))
      .sort((a, b) => {
        const order = ['in_progress', 'dispatched', 'awaiting_judgment', 'awaiting_approval']
        return order.indexOf(a.status) - order.indexOf(b.status)
      }),
    [nodes],
  )

  const recentCompleted = useMemo(() =>
    nodes
      .filter((n) => n.status === 'completed' || n.status === 'auto_verified')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10),
    [nodes],
  )

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-[900px] w-full mx-auto px-8 py-8 flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Zap className="w-5 h-5 text-info" />
            Active Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeTasks.length} task{activeTasks.length !== 1 ? 's' : ''} in progress
          </p>
        </div>

        {activeTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <Zap className="w-8 h-8 opacity-30" />
            <p className="text-sm">No active tasks right now</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {activeTasks.map((node) => (
              <TaskRow key={node.id} node={node} projects={projects} onClick={() => navigate(`/project/${node.projectId}`)} />
            ))}
          </div>
        )}

        {recentCompleted.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Recently Completed
            </h3>
            <div className="flex flex-col gap-1">
              {recentCompleted.map((node) => (
                <TaskRow key={node.id} node={node} projects={projects} onClick={() => navigate(`/project/${node.projectId}`)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TaskRow({ node, projects, onClick }: { node: PlanNode; projects: { id: string; name: string; icon?: string }[]; onClick: () => void }) {
  const config = statusConfig[node.status]
  const project = projects.find((p) => p.id === node.projectId)
  const Icon = config?.icon ?? Zap

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-left w-full',
        'hover:bg-muted/50 transition-colors duration-100',
      )}
    >
      <Icon className={cn('w-4 h-4 flex-shrink-0', config?.color ?? 'text-muted-foreground')} />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{node.title}</p>
        {project && (
          <p className="text-[10px] text-muted-foreground truncate">
            {project.icon ?? '📋'} {project.name}
          </p>
        )}
      </div>
      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', config?.color ?? 'text-muted-foreground')}>
        {config?.label ?? node.status}
      </span>
    </button>
  )
}
