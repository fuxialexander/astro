import { useEffect, useRef } from 'react'
import { useCalendarEvents } from '@/hooks/use-calendar-events'
import { TimeRuler } from '../shared/time-ruler'
import { DayHourColumn, AllDayEventsRow } from './day-hour-column'
import { DayCreatePopover } from './day-create-popover'
import { useCalendarStore } from '@/stores/calendar-store'
import { HOUR_HEIGHT } from './lane-utils'

const CURRENT_HOUR_OFFSET = 6 // scroll 6 hours before current time into view

interface DayViewProps {
  focusedDate: string
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export function DayView({ focusedDate }: DayViewProps) {
  const { byDay } = useCalendarEvents()
  const createDraft = useCalendarStore((s) => s.createDraft)
  const scrollRef = useRef<HTMLDivElement>(null)

  const events = byDay.get(focusedDate) ?? []
  const allDayEvents = events.filter((e) => e.allDay)
  const isToday = focusedDate === todayStr()

  // Scroll to current time (or 8 AM) on mount
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const now = new Date()
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const targetMinutes = Math.max(0, currentMinutes - CURRENT_HOUR_OFFSET * 60)
    el.scrollTop = (targetMinutes / 60) * HOUR_HEIGHT
  }, [focusedDate])

  // Format the date header
  const dateLabel = new Date(`${focusedDate}T12:00:00Z`).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="flex flex-col h-full">
      {/* Day header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">{dateLabel}</span>
          {isToday && <span className="text-xs text-primary font-medium">Today</span>}
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* All-day row */}
      <div className="flex shrink-0">
        <div style={{ width: 44 }} className="border-b border-border" />
        <AllDayEventsRow events={allDayEvents} className="flex-1 border-b border-border" />
      </div>

      {/* Time grid */}
      <div ref={scrollRef} className="flex flex-1 overflow-y-auto">
        <TimeRuler hourHeight={HOUR_HEIGHT} />
        <DayHourColumn
          dateStr={focusedDate}
          events={events}
          isToday={isToday}
        />
      </div>

      {/* Create popover */}
      {createDraft && <DayCreatePopover draft={createDraft} />}
    </div>
  )
}
