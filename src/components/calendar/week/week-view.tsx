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

  return (
    <div className="flex flex-col h-full">
      {/* Week day headers */}
      <div className="flex shrink-0">
        <div style={{ width: 44 }} className="border-b border-border" />
        {weekDays.map((day) => {
          const isToday = day === today
          const date = new Date(`${day}T12:00:00Z`)
          const dayOfWeek = DAYS[date.getUTCDay()]
          const dayNum = date.getUTCDate()
          return (
            <div
              key={day}
              className={cn('cal-week-header-cell flex-1', isToday && 'cal-week-header-cell-today')}
            >
              <span className="text-[10px] uppercase tracking-wider">{dayOfWeek}</span>
              <span className={cn('cal-week-header-day-num', isToday && 'cal-week-header-day-num-today')}>
                {dayNum}
              </span>
            </div>
          )
        })}
      </div>

      {/* All-day row */}
      <div className="flex shrink-0">
        <div style={{ width: 44 }} className="border-b border-border" />
        {weekDays.map((day) => {
          const allDay = (byDay.get(day) ?? []).filter((e) => e.allDay)
          return (
            <AllDayEventsRow
              key={day}
              events={allDay}
              className="flex-1 border-r border-border last:border-r-0"
            />
          )
        })}
      </div>

      {/* Time grid */}
      <div ref={scrollRef} className="flex flex-1 overflow-y-auto">
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
