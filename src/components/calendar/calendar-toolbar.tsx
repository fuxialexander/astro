import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCalendarStore } from '@/stores/calendar-store'
import { CalendarFilterPopover } from './calendar-filter-popover'
import type { CalendarView } from './types'
import { cn } from '@/lib/utils'

const VIEWS: { key: CalendarView; label: string }[] = [
  { key: 'day',   label: 'Day'   },
  { key: 'week',  label: 'Week'  },
  { key: 'month', label: 'Month' },
  { key: 'year',  label: 'Year'  },
]

function formatTitle(view: CalendarView, focusedDate: string): { month: string; rest: string } {
  const d = new Date(`${focusedDate}T12:00:00Z`)
  if (view === 'year') {
    return { month: String(d.getUTCFullYear()), rest: '' }
  }
  if (view === 'day') {
    return {
      month: d.toLocaleDateString([], { month: 'long' }),
      rest:  d.toLocaleDateString([], { day: 'numeric', year: 'numeric' }),
    }
  }
  if (view === 'week') {
    const dow  = (d.getUTCDay() + 6) % 7
    const mon  = new Date(d); mon.setUTCDate(d.getUTCDate() - dow)
    const sun  = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
    const sameMonth = mon.getUTCMonth() === sun.getUTCMonth()
    if (sameMonth) {
      return {
        month: mon.toLocaleDateString([], { month: 'long' }),
        rest:  mon.toLocaleDateString([], { year: 'numeric' }),
      }
    }
    return {
      month: `${mon.toLocaleDateString([], { month: 'short' })} – ${sun.toLocaleDateString([], { month: 'short' })}`,
      rest:  sun.toLocaleDateString([], { year: 'numeric' }),
    }
  }
  return {
    month: d.toLocaleDateString([], { month: 'long' }),
    rest:  d.toLocaleDateString([], { year: 'numeric' }),
  }
}

export function CalendarToolbar() {
  const view         = useCalendarStore((s) => s.view)
  const focusedDate  = useCalendarStore((s) => s.focusedDate)
  const setView      = useCalendarStore((s) => s.setView)
  const navigateBy   = useCalendarStore((s) => s.navigateBy)
  const setFocusedDate = useCalendarStore((s) => s.setFocusedDate)
  const setCreateDraft = useCalendarStore((s) => s.setCreateDraft)

  const todayStr  = new Date().toISOString().slice(0, 10)
  const isToday   = focusedDate === todayStr
  const { month, rest } = formatTitle(view, focusedDate)

  const handleNew = () => {
    const now = new Date()
    const roundedMin = Math.ceil(now.getMinutes() / 15) * 15
    const start = new Date(now)
    start.setMinutes(roundedMin, 0, 0)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    setCreateDraft({ startAt: start.toISOString(), endAt: end.toISOString(), kind: 'task', isMultiDay: false })
  }

  return (
    <div className="flex items-center gap-3 px-4 h-13 border-b border-border shrink-0 select-none">

      {/* Title: bold month + light year */}
      <h2 className="text-[17px] leading-none shrink-0 min-w-0">
        <span className="font-semibold text-foreground">{month}</span>
        <span className="font-light text-foreground/60 ml-1.5">{rest}</span>
      </h2>

      {/* Navigation: < Today > */}
      <div className="flex items-center gap-0.5 ml-1">
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
          onClick={() => navigateBy(-1)}
          aria-label="Previous"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          className={cn(
            'h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors',
            isToday
              ? 'text-destructive hover:bg-destructive/8'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/60',
          )}
          onClick={() => setFocusedDate(todayStr)}
        >
          Today
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
          onClick={() => navigateBy(1)}
          aria-label="Next"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* View switcher — pill segmented control */}
      <div className="flex items-center bg-muted/50 rounded-lg p-0.5 gap-px">
        {VIEWS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={cn(
              'h-6 px-3 text-[11px] font-medium rounded-md transition-all duration-150',
              view === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <CalendarFilterPopover />
        <Button size="sm" className="h-7 text-xs gap-1 px-2.5" onClick={handleNew}>
          <Plus className="w-3.5 h-3.5" />
          New
        </Button>
      </div>
    </div>
  )
}
