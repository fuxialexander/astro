/**
 * ActivityFeed — timeline-style feed of project events.
 *
 * Displays task executions, chat messages, file changes, and errors
 * with real-time updates via SSE. Supports filtering by event type.
 */
import { Activity, Filter } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import { useActivityStore } from '@desktop/stores/activity-store'
import { ActivityCard } from '@desktop/components/activity/ActivityCard'
import type { ActivityEventType } from '@desktop/stores/activity-store'

const FILTER_OPTIONS: Array<{ value: 'all' | ActivityEventType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'task_started', label: 'Started' },
  { value: 'task_completed', label: 'Completed' },
  { value: 'task_failed', label: 'Failed' },
  { value: 'file_change', label: 'Files' },
  { value: 'error', label: 'Errors' },
]

export function ActivityFeed() {
  const filter = useActivityStore((s) => s.filter)
  const expandedEventId = useActivityStore((s) => s.expandedEventId)
  const setFilter = useActivityStore((s) => s.setFilter)
  const setExpandedEvent = useActivityStore((s) => s.setExpandedEvent)
  const getFilteredEvents = useActivityStore((s) => s.getFilteredEvents)

  const events = getFilteredEvents()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Filter bar ──────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b flex-shrink-0">
        <Filter className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={cn(
              'px-2 py-0.5 rounded text-[10px] transition-colors duration-100',
              filter === opt.value
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* ── Event list ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 py-8">
            <Activity className="w-6 h-6 opacity-40" />
            <p className="text-xs">No activity yet</p>
            <p className="text-[10px] opacity-60">Events will appear here in real time</p>
          </div>
        ) : (
          <div className="py-1 space-y-0.5">
            {events.map((event) => (
              <ActivityCard
                key={event.id}
                event={event}
                expanded={expandedEventId === event.id}
                onToggle={() =>
                  setExpandedEvent(expandedEventId === event.id ? null : event.id)
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
