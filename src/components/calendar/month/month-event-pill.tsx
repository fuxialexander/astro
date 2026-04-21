import { cn } from '@/lib/utils'
import type { CalendarEvent } from '../types'
import { EventTooltip } from '../shared/event-tooltip'

interface MonthEventPillProps {
  event: CalendarEvent
}

export function MonthEventPill({ event }: MonthEventPillProps) {
  const externalColor = event.color === 'external'
    ? (event.raw as { calendarColor?: string } | undefined)?.calendarColor
    : undefined

  return (
    <EventTooltip event={event}>
      <div
        data-event
        tabIndex={0}
        role="button"
        aria-label={event.title}
        className={cn(
          'cal-month-pill',
          event.color !== 'external' && `cal-chip-${event.color}`,
          event.color === 'external' && 'cal-chip-external',
          event.isCompleted && 'opacity-60',
          event.isCancelled && 'opacity-40 line-through',
        )}
        style={externalColor ? { borderLeftColor: externalColor, color: externalColor } : undefined}
      >
        {event.title}
      </div>
    </EventTooltip>
  )
}
