import { useCallback } from 'react'
import { cn } from '@/lib/utils'
import type { CalendarEvent } from '../types'
import { useCalendarStore } from '@/stores/calendar-store'
import { MonthHeatOverlay } from './month-heat-overlay'
import { MonthEventPill } from './month-event-pill'

const MAX_PILLS = 3

interface MonthDayCellProps {
  dateStr: string
  events: CalendarEvent[]
  heatIntensity: number
  isToday: boolean
  isOutsideMonth: boolean
  onDayClick: (dateStr: string) => void
}

export function MonthDayCell({
  dateStr,
  events,
  heatIntensity,
  isToday,
  isOutsideMonth,
  onDayClick,
}: MonthDayCellProps) {
  const setCreateDraft = useCalendarStore((s) => s.setCreateDraft)

  const dayNum = new Date(`${dateStr}T12:00:00Z`).getUTCDate()

  // Month view: only show deadlines, milestones, external events (not execution times)
  const visibleEvents = events.filter(
    (e) => e.kind === 'deadline' || e.kind === 'milestone' || e.kind === 'external'
  )
  // Aggregate scheduled events
  const scheduledCount = events.filter((e) => e.kind === 'scheduled' || e.kind === 'execution').length

  const overflowCount = visibleEvents.length > MAX_PILLS ? visibleEvents.length - MAX_PILLS + 1 : 0
  const shown = overflowCount > 0 ? visibleEvents.slice(0, MAX_PILLS - 1) : visibleEvents

  const handleCellMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('[data-event], button')) return
      const anchorRect = e.currentTarget.getBoundingClientRect()
      setCreateDraft({
        startAt: `${dateStr}T00:00:00.000Z`,
        endAt: `${dateStr}T23:59:00.000Z`,
        kind: 'milestone',
        anchorRect,
        isMultiDay: false,
      })
    },
    [dateStr, setCreateDraft],
  )

  return (
    <div
      className={cn(
        'cal-month-cell',
        isToday && 'cal-month-cell-today',
        isOutsideMonth && 'cal-month-cell-outside',
      )}
      onMouseDown={handleCellMouseDown}
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
