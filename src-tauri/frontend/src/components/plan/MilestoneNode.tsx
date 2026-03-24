/**
 * MilestoneNode — custom React Flow node for milestones and decision points.
 *
 * Diamond shape for decision nodes, hexagonal shape for milestones.
 */
import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Flag, GitBranch } from 'lucide-react'
import { cn } from '@desktop/lib/utils'

interface MilestoneNodeData {
  label: string
  nodeType: 'milestone' | 'decision'
  selected?: boolean
}

export const MilestoneNode = memo(function MilestoneNode({ data }: { data: MilestoneNodeData }) {
  const isDecision = data.nodeType === 'decision'
  const Icon = isDecision ? GitBranch : Flag

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2" />
      <div
        className={cn(
          'flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-card shadow-sm',
          'transition-all duration-200',
          isDecision
            ? 'border-warning/30 bg-warning/5'
            : 'border-primary/30 bg-primary/5',
          data.selected && 'ring-2 ring-primary',
        )}
      >
        <Icon
          className={cn(
            'w-4 h-4 flex-shrink-0',
            isDecision ? 'text-warning' : 'text-primary',
          )}
        />
        <span className="text-xs font-semibold text-foreground whitespace-nowrap">
          {data.label}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border !w-2 !h-2" />
    </>
  )
})
