/**
 * ActivityCard — compact card for a single activity event.
 *
 * Expand-on-click to reveal details and metadata.
 */
import {
  Play, CheckCircle2, XCircle, MessageSquare, FileText, AlertTriangle, Info,
} from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import { timeAgo } from '@desktop/lib/utils'
import type { ActivityEvent, ActivityEventType } from '@desktop/stores/activity-store'

interface ActivityCardProps {
  event: ActivityEvent
  expanded: boolean
  onToggle: () => void
}

const EVENT_CONFIG: Record<ActivityEventType, {
  icon: React.ComponentType<{ className?: string }>
  color: string
  bgColor: string
}> = {
  task_started: { icon: Play, color: 'text-primary', bgColor: 'bg-primary/10' },
  task_completed: { icon: CheckCircle2, color: 'text-success', bgColor: 'bg-success/10' },
  task_failed: { icon: XCircle, color: 'text-error', bgColor: 'bg-error/10' },
  chat_message: { icon: MessageSquare, color: 'text-info', bgColor: 'bg-info/10' },
  file_change: { icon: FileText, color: 'text-warning', bgColor: 'bg-warning/10' },
  error: { icon: AlertTriangle, color: 'text-error', bgColor: 'bg-error/10' },
  system: { icon: Info, color: 'text-muted-foreground', bgColor: 'bg-muted' },
}

export function ActivityCard({ event, expanded, onToggle }: ActivityCardProps) {
  const config = EVENT_CONFIG[event.type] ?? EVENT_CONFIG.system
  const Icon = config.icon

  return (
    <button
      onClick={onToggle}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-lg transition-colors duration-100',
        'hover:bg-muted/50',
        expanded && 'bg-muted/30',
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Icon */}
        <div
          className={cn(
            'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5',
            config.bgColor,
          )}
        >
          <Icon className={cn('w-3 h-3', config.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground truncate">{event.title}</span>
            <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
              {timeAgo(event.timestamp)}
            </span>
          </div>

          {event.description && (
            <p
              className={cn(
                'text-[11px] text-muted-foreground mt-0.5',
                !expanded && 'line-clamp-1',
              )}
            >
              {event.description}
            </p>
          )}

          {/* Expanded metadata */}
          {expanded && event.metadata && (
            <div className="mt-2 space-y-1">
              {Object.entries(event.metadata).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2 text-[10px]">
                  <span className="text-muted-foreground font-mono">{key}:</span>
                  <span className="text-foreground font-mono truncate">
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
