/**
 * ThreadList — shows recent/active execution threads for a project.
 *
 * A "thread" maps to a running or recently completed task execution.
 * Each thread shows: status indicator, short description, timestamp.
 */
import { cn } from '@desktop/lib/utils'
import { timeAgo } from '@desktop/lib/utils'
import type { TaskExecution } from '@desktop/types'

interface ThreadListProps {
  executions: TaskExecution[]
  onSelectThread?: (execution: TaskExecution) => void
  className?: string
}

const STATUS_CONFIG: Record<
  TaskExecution['status'],
  { dot: string; label: string }
> = {
  pending: { dot: 'bg-muted-foreground animate-pulse', label: 'Pending' },
  queued: { dot: 'bg-warning animate-pulse', label: 'Queued' },
  running: { dot: 'bg-primary animate-pulse', label: 'Running' },
  completed: { dot: 'bg-success', label: 'Done' },
  failed: { dot: 'bg-error', label: 'Failed' },
  cancelled: { dot: 'bg-muted-foreground', label: 'Cancelled' },
  timeout: { dot: 'bg-error', label: 'Timeout' },
}

function ThreadItem({
  execution,
  onClick,
}: {
  execution: TaskExecution
  onClick?: () => void
}) {
  const config = STATUS_CONFIG[execution.status]

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-left',
        'transition-colors duration-150',
        'hover:bg-muted rounded-sm',
      )}
    >
      {/* Status dot */}
      <span
        className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', config.dot)}
        title={config.label}
      />

      {/* Summary or fallback */}
      <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
        {execution.summary ?? `Thread ${execution.id.slice(0, 8)}`}
      </span>

      {/* Timestamp */}
      <span className="text-xs text-muted-foreground opacity-60 flex-shrink-0">
        {timeAgo(execution.updatedAt)}
      </span>
    </button>
  )
}

export function ThreadList({ executions, onSelectThread, className }: ThreadListProps) {
  if (executions.length === 0) return null

  return (
    <div className={cn('flex flex-col', className)}>
      {executions.slice(0, 5).map((ex) => (
        <ThreadItem
          key={ex.id}
          execution={ex}
          onClick={() => onSelectThread?.(ex)}
        />
      ))}
    </div>
  )
}
