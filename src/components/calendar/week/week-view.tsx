import { useEffect, useRef } from 'react'
import { useCalendarEvents } from '@/hooks/use-calendar-events'
import { useCalendarStore } from '@/stores/calendar-store'
import { TimeRuler } from '../shared/time-ruler'
import { DayHourColumn, AllDayEventsRow } from '../day/day-hour-column'
import { DayCreatePopover } from '../day/day-create-popover'
import { HOUR_HEIGHT } from '../day/lane-utils'
import { cn } from '@/lib/utils'
import { addDays, snapToMonday, parseDate, fmtDate } from '@/lib/timeline-utils'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getWeekDays(focusedDate: string): string[] {
  // Start from Monday of the week containing focusedDate
  const d = parseDate(focusedDate)
  const monday = snapToMonday(d)
  return Array.from({ length: 7 }, (_, i) => fmtDate(addDays(monday, i)))
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

interface WeekViewProps {
  focusedDate: string
}

export function WeekView({ focusedDate }: WeekViewProps) {
  const { byDay } = useCalendarEvents()
  const createDraft = useCalendarStore((s) => s.createDraft)
  const scrollRef = useRef<HTMLDivElement>(null)
  const today = todayStr()
  const weekDays = getWeekDays(focusedDate)

  // Scroll to 7 AM on mount
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = 7 * HOUR_HEIGHT
  }, [focusedDate])

  // minmax(0, 1fr) prevents long chip text from expanding columns beyond equal widths
  const colTemplate = `44px repeat(7, minmax(0, 1fr))`

  return (
    <div className="flex flex-col h-full">
      {/* Header + all-day in one shared grid so columns are pixel-perfect aligned */}
      <div className="grid shrink-0 border-b border-border" style={{ gridTemplateColumns: colTemplate }}>
        {/* Row 1: day headers */}
        <div /> {/* ruler spacer */}
        {weekDays.map((day) => {
          const isToday = day === today
          const date = new Date(`${day}T12:00:00Z`)
          const dayOfWeek = DAYS[date.getUTCDay()]
          const dayNum = date.getUTCDate()
          return (
            <div
              key={`h-${day}`}
              className={cn('cal-week-header-cell border-r border-border last:border-r-0', isToday && 'cal-week-header-cell-today')}
            >
              <span className="text-[10px] uppercase tracking-wider">{dayOfWeek}</span>
              {isToday ? (
                <span className="cal-week-header-day-num-today">{dayNum}</span>
              ) : (
                <span className="cal-week-header-day-num">{dayNum}</span>
              )}
            </div>
          )
        })}

        {/* Row 2: all-day chips */}
        <div /> {/* ruler spacer */}
        {weekDays.map((day) => {
          const allDay = (byDay.get(day) ?? []).filter((e) => e.allDay)
          return (
            <AllDayEventsRow
              key={`a-${day}`}
              events={allDay}
              className="border-r border-border last:border-r-0"
            />
          )
        })}
      </div>

      {/* Time grid */}
      <div ref={scrollRef} className="flex flex-1 overflow-y-auto items-start cal-time-scroll">
        <TimeRuler hourHeight={HOUR_HEIGHT} />
        {weekDays.map((day) => {
          const events = byDay.get(day) ?? []
          const isToday = day === today
          return (
            <div
              key={day}
              className={cn(
                'flex-1 border-r border-border last:border-r-0 relative',
                isToday && 'bg-primary/[0.02]',
              )}
            >
              <DayHourColumn
                dateStr={day}
                events={events}
                isToday={isToday}
                defaultDraftKind="task"
              />
            </div>
          )
        })}
      </div>

      {createDraft && <DayCreatePopover draft={createDraft} />}
    </div>
  )
}
