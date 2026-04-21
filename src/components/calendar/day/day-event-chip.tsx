import { cn } from '@/lib/utils'
import type { CalendarEvent } from '../types'
import { EventTooltip } from '../shared/event-tooltip'
import { minuteOfDay, durationMinutes, HOUR_HEIGHT } from './lane-utils'

interface DayEventChipProps {
  event: CalendarEvent
  lane: number
  laneCount: number
  className?: string
}

export function DayEventChip({ event, lane, laneCount, className }: DayEventChipProps) {
  const startMin = minuteOfDay(event.startAt)
  const durMin = durationMinutes(event.startAt, event.endAt)
  const top = (startMin / 60) * HOUR_HEIGHT
  const height = Math.max(18, (durMin / 60) * HOUR_HEIGHT - 2)

  const leftPct = (lane / laneCount) * 100
  const widthPct = 100 / laneCount

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
          'cal-chip absolute overflow-hidden',
          event.color !== 'external' && `cal-chip-${event.color}`,
          event.color === 'external' && 'cal-chip-external',
          event.isCompleted && 'opacity-60',
          event.isCancelled && 'opacity-40 line-through',
          className,
        )}
        style={{
          top,
          height,
          left: `calc(${leftPct}% + 4px)`,
          width: `calc(${widthPct}% - 8px)`,
          ...(externalColor ? { borderLeftColor: externalColor, color: externalColor } : {}),
        }}
      >
        <span className="block truncate leading-tight">
          {event.title}
        </span>
        {height > 28 && (
          <span className="block text-[10px] opacity-70 truncate">
            {new Date(event.startAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </div>
    </EventTooltip>
  )
}
