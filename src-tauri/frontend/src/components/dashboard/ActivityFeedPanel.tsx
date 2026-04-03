/**
 * ActivityFeedPanel — recent activity events in a compact timeline.
 */
import {
  Activity, CheckCircle2, XCircle, FileText, Monitor, Zap, MessageSquare,
} from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import type { ActivityEvent } from '@desktop/stores/activity-store'

const typeIcons: Record<string, { icon: typeof Activity; color: string }> = {
  task_started: { icon: Zap, color: 'text-info' },
  task_completed: { icon: CheckCircle2, color: 'text-success' },
  task_failed: { icon: XCircle, color: 'text-error' },
  chat_message: { icon: MessageSquare, color: 'text-info' },
  file_change: { icon: FileText, color: 'text-warning' },
  error: { icon: XCircle, color: 'text-error' },
  system: { icon: Monitor, color: 'text-muted-foreground' },
}

interface ActivityFeedPanelProps {
  events: ActivityEvent[]
  maxItems?: number
}

export function ActivityFeedPanel({ events, maxItems = 20 }: ActivityFeedPanelProps) {
  const visible = events.slice(0, maxItems)

  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Recent Activity
      </h3>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No recent activity</p>
      ) : (
        <div className="flex flex-col">
          {visible.map((event) => {
            const config = typeIcons[event.type] ?? typeIcons.system
            const Icon = config.icon
            return (
              <div key={event.id} className="flex items-center gap-2.5 py-1.5 group">
                <Icon className={cn('h-3 w-3 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity', config.color)} />
                <p className="text-[11px] truncate flex-1 min-w-0 text-muted-foreground group-hover:text-foreground transition-colors">
                  {event.title}
                </p>
                <span className="text-[10px] text-muted-foreground/40 shrink-0">
                  {formatRelative(event.timestamp)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatRelative(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
