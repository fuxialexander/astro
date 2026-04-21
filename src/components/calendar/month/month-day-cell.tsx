import { cn } from '@/lib/utils'
import type { CalendarEvent } from '../types'
import { MonthHeatOverlay } from './month-heat-overlay'
import { MonthEventPill } from './month-event-pill'

const MAX_PILLS = 3

interface MonthDayCellProps {
  dateStr: string
  events: CalendarEvent[]
  heatIntensity: number
  isToday: boolean
  isOutsideMonth: boolean
  isDragSelected?: boolean
  onDayClick: (dateStr: string) => void
}

export function MonthDayCell({
  dateStr,
  events,
  heatIntensity,
  isToday,
  isOutsideMonth,
  isDragSelected,
  onDayClick,
}: MonthDayCellProps) {
  const dayNum = new Date(`${dateStr}T12:00:00Z`).getUTCDate()

  // Month view: only show deadlines, milestones, external events (not execution times)
  const visibleEvents = events.filter(
    (e) => e.kind === 'deadline' || e.kind === 'milestone' || e.kind === 'external'
  )
  // Aggregate scheduled events
  const scheduledCount = events.filter((e) => e.kind === 'scheduled' || e.kind === 'execution').length

  const overflowCount = visibleEvents.length > MAX_PILLS ? visibleEvents.length - MAX_PILLS + 1 : 0
  const shown = overflowCount > 0 ? visibleEvents.slice(0, MAX_PILLS - 1) : visibleEvents

  return (
    <div
      data-date={dateStr}
      className={cn(
        'cal-month-cell',
        isToday && 'cal-month-cell-today',
        isOutsideMonth && 'cal-month-cell-outside',
        isDragSelected && 'bg-primary/10 ring-1 ring-inset ring-primary/30',
      )}
    >
      <MonthHeatOverlay intensity={heatIntensity} />

      {/* Day number */}
      <button
        type="button"
        className="cal-day-number mb-1"
        onClick={() => onDayClick(dateStr)}
        title={`View ${dateStr}`}
      >
        {dayNum}
      </button>

      {/* Event pills */}
      {shown.map((ev) => (
        <MonthEventPill key={ev.id} event={ev} />
      ))}

      {/* Overflow */}
      {overflowCount > 0 && (
        <div className="text-[10px] text-muted-foreground px-1 mt-0.5">
          +{overflowCount} more
        </div>
      )}

      {/* Scheduled count badge */}
      {scheduledCount > 0 && (
        <div className="absolute bottom-1 right-1 text-[9px] font-medium text-muted-foreground bg-muted/50 rounded px-1">
          {scheduledCount} run{scheduledCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
