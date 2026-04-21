import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCalendarStore } from '@/stores/calendar-store'
import { CalendarFilterPopover } from './calendar-filter-popover'
import type { CalendarView } from './types'
import { cn } from '@/lib/utils'

const VIEW_LABELS: Record<CalendarView, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
}

const VIEW_KEYS: Record<CalendarView, string> = {
  day: 'D',
  week: 'W',
  month: 'M',
}

function formatHeaderDate(view: CalendarView, focusedDate: string): string {
  const d = new Date(`${focusedDate}T12:00:00Z`)
  if (view === 'day') {
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }
  if (view === 'week') {
    const monday = new Date(d)
    const dow = (d.getUTCDay() + 6) % 7
    monday.setUTCDate(d.getUTCDate() - dow)
    const sunday = new Date(monday)
    sunday.setUTCDate(monday.getUTCDate() + 6)
    const ms = monday.toLocaleDateString([], { month: 'short', day: 'numeric' })
    const se = sunday.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    return `${ms} – ${se}`
  }
  return d.toLocaleDateString([], { month: 'long', year: 'numeric' })
}

export function CalendarToolbar() {
  const view = useCalendarStore((s) => s.view)
  const focusedDate = useCalendarStore((s) => s.focusedDate)
  const setView = useCalendarStore((s) => s.setView)
  const navigateBy = useCalendarStore((s) => s.navigateBy)
  const setFocusedDate = useCalendarStore((s) => s.setFocusedDate)
  const setCreateDraft = useCalendarStore((s) => s.setCreateDraft)

  const isToday = focusedDate === new Date().toISOString().slice(0, 10)

  const handleNew = () => {
    const now = new Date()
    const roundedMin = Math.ceil(now.getMinutes() / 15) * 15
    const start = new Date(now)
    start.setMinutes(roundedMin, 0, 0)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    setCreateDraft({
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      kind: 'task',
      isMultiDay: false,
    })
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
      {/* Title */}
      <h2 className="text-sm font-semibold text-foreground tabular-nums min-w-[200px]">
        {formatHeaderDate(view, focusedDate)}
      </h2>

      {/* Navigation */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => navigateBy(-1)}
          aria-label="Previous"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-7 text-xs px-2', isToday && 'text-primary')}
          onClick={() => setFocusedDate(new Date().toISOString().slice(0, 10))}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => navigateBy(1)}
          aria-label="Next"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* View toggle */}
      <div className="flex items-center rounded-md border border-border overflow-hidden ml-2">
        {(Object.entries(VIEW_LABELS) as [CalendarView, string][]).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              'h-7 px-2.5 text-xs font-medium transition-colors border-r border-border last:border-r-0',
              view === v
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
            title={`${label} view (${VIEW_KEYS[v]})`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <CalendarFilterPopover />
        <Button
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={handleNew}
          title="New event (N)"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </Button>
      </div>
    </div>
  )
}
