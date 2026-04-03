/**
 * ApprovalCards — shows tasks awaiting user judgment or approval.
 */
import { AlertCircle } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import type { PlanNode, Project } from '@desktop/types'

interface ApprovalCardsProps {
  nodes: PlanNode[]
  projects: Project[]
  onNavigate: (projectId: string) => void
}

export function ApprovalCards({ nodes, projects, onNavigate }: ApprovalCardsProps) {
  const attentionNodes = nodes.filter(
    (n) => n.status === 'awaiting_judgment' || n.status === 'awaiting_approval',
  )

  if (attentionNodes.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Needs Your Attention
      </h3>
      {attentionNodes.map((node) => {
        const project = projects.find((p) => p.id === node.projectId)
        return (
          <button
            key={node.id}
            onClick={() => onNavigate(node.projectId)}
            className={cn(
              'flex items-start gap-3 p-3 rounded-xl border text-left',
              'bg-warning/5 border-warning/20 hover:border-warning/40',
              'transition-colors duration-150 w-full',
            )}
          >
            <AlertCircle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{node.title}</p>
              <div className="flex items-center gap-2 mt-1">
                {project && (
                  <span className="text-[10px] text-muted-foreground">
                    {project.icon ?? '📋'} {project.name}
                  </span>
                )}
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                  node.status === 'awaiting_judgment'
                    ? 'bg-warning/10 text-warning'
                    : 'bg-info/10 text-info',
                )}>
                  {node.status === 'awaiting_judgment' ? 'Awaiting judgment' : 'Awaiting approval'}
                </span>
              </div>
              {node.executionOutput && (
                <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">
                  {node.executionOutput}
                </p>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
