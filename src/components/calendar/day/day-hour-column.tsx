import { useRef, useCallback } from 'react'
import type { CalendarEvent, CreateDraftKind } from '../types'
import { useCalendarStore } from '@/stores/calendar-store'
import { DayEventChip } from './day-event-chip'
import { assignLanes, mergeProjectEvents, HOUR_HEIGHT } from './lane-utils'
import { useCalendarDrag } from '@/hooks/use-calendar-drag'
import { EventTooltip } from '../shared/event-tooltip'
import { cn } from '@/lib/utils'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

interface DayHourColumnProps {
  dateStr: string
  events: CalendarEvent[]
  isToday: boolean
  defaultDraftKind?: CreateDraftKind
}

function nowMinutes(): number {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

export function DayHourColumn({ dateStr, events, isToday, defaultDraftKind = 'task' }: DayHourColumnProps) {
  const setCreateDraft = useCalendarStore((s) => s.setCreateDraft)
  const colRef = useRef<HTMLDivElement>(null)

  const onDraftReady = useCallback(
    (startAt: string, endAt: string, anchorRect: DOMRect) => {
      setCreateDraft({
        startAt,
        endAt,
        kind: defaultDraftKind,
        anchorRect,
        isMultiDay: false,
      })
    },
    [defaultDraftKind, setCreateDraft],
  )

  const { onMouseDown } = useCalendarDrag({
    dateStr,
    columnRef: colRef,
    hourHeight: HOUR_HEIGHT,
    onDraftReady,
  })

  const timed = events.filter((e) => !e.allDay)
  const merged = mergeProjectEvents(timed)
  const laned = assignLanes(merged)
  const nowMin = isToday ? nowMinutes() : -1
  const nowTop = (nowMin / 60) * HOUR_HEIGHT

  return (
    <div
      ref={colRef}
      className="relative flex-1 select-none"
      onMouseDown={onMouseDown}
    >
      {/* Hour grid */}
      {HOURS.map((h) => (
        <div key={h} className="cal-hour-slot">
          <div className="cal-hour-slot-half" />
        </div>
      ))}

      {/* Current time indicator */}
      {isToday && nowMin >= 0 && (
        <div
          className="cal-now-line"
          style={{ top: nowTop }}
          aria-hidden
        />
      )}

      {/* Events */}
      {laned.map(({ event, lane, laneCount }) => (
        <DayEventChip
          key={event.id}
          event={event}
          lane={lane}
          laneCount={laneCount}
        />
      ))}
    </div>
  )
}

interface AllDayEventsRowProps {
  events: CalendarEvent[]
  className?: string
}

export function AllDayEventsRow({ events, className }: AllDayEventsRowProps) {
  return (
    <div className={cn('cal-all-day-row flex flex-col gap-0.5 p-1 overflow-hidden', className)}>
      {events.map((ev) => {
        const externalColor = ev.color === 'external'
          ? (ev.raw as { calendarColor?: string } | undefined)?.calendarColor
          : undefined
        return (
          <EventTooltip key={ev.id} event={ev}>
            <div
              data-event
              tabIndex={0}
              role="button"
              aria-label={ev.title}
              className={cn(
                'cal-chip text-xs cursor-pointer w-full min-w-0',
                ev.color !== 'external' && `cal-chip-${ev.color}`,
                ev.color === 'external' && 'cal-chip-external',
              )}
              style={externalColor ? { borderLeftColor: externalColor, color: externalColor } : undefined}
            >
              {ev.title}
            </div>
          </EventTooltip>
        )
      })}
    </div>
  )
}
