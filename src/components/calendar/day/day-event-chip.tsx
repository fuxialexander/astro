import { cn } from '@/lib/utils'
import type { CalendarEvent } from '../types'
import type { MergedCalendarEvent } from './lane-utils'
import { EventTooltip } from '../shared/event-tooltip'
import { minuteOfDay, durationMinutes, HOUR_HEIGHT } from './lane-utils'

interface DayEventChipProps {
  event: CalendarEvent | MergedCalendarEvent
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

  const mergedCount = (event as MergedCalendarEvent).mergedCount ?? 1
  const isMerged = mergedCount > 1

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
          event.isCompleted && !isMerged && 'opacity-60',
          event.isCancelled && !isMerged && 'opacity-40 line-through',
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
        <span className="flex items-center gap-1 leading-tight min-w-0">
          <span className="truncate">{event.title}</span>
          {isMerged && (
            <span className="shrink-0 rounded px-1 py-px text-[9px] font-semibold bg-black/10 leading-none">
              {mergedCount}
            </span>
          )}
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
