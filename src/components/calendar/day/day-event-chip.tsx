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

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function DayEventChip({ event, lane, laneCount, className }: DayEventChipProps) {
  const startMin = minuteOfDay(event.startAt)
  const durMin   = durationMinutes(event.startAt, event.endAt)
  const top      = (startMin / 60) * HOUR_HEIGHT
  const height   = Math.max(18, (durMin / 60) * HOUR_HEIGHT - 2)

  const leftPct  = (lane / laneCount) * 100
  const widthPct = 100 / laneCount

  const externalColor = event.color === 'external'
    ? (event.raw as { calendarColor?: string } | undefined)?.calendarColor
    : undefined

  const mergedCount = (event as MergedCalendarEvent).mergedCount ?? 1
  const isMerged    = mergedCount > 1
  const showTime    = height > 30
  const showCount   = isMerged && height > 22

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
          event.isCompleted && !isMerged && 'opacity-55',
          event.isCancelled && !isMerged && 'opacity-35 line-through',
          className,
        )}
        style={{
          top,
          height,
          left:  `calc(${leftPct}% + 3px)`,
          width: `calc(${widthPct}% - 6px)`,
          ...(externalColor ? { background: `color-mix(in srgb, ${externalColor} 22%, transparent)`, color: externalColor } : {}),
        }}
      >
        {/* Title row */}
        <span className="flex items-baseline gap-1 min-w-0">
          <span className="truncate font-medium leading-tight">{event.title}</span>
          {showCount && (
            <span className="shrink-0 rounded px-0.5 text-[9px] font-semibold bg-current/10 leading-none">
              {mergedCount}
            </span>
          )}
        </span>
        {/* Time sub-label */}
        {showTime && (
          <span className="block text-[9.5px] opacity-65 truncate leading-tight mt-px">
            {fmtTime(event.startAt)}
            {isMerged && ` – ${fmtTime(event.endAt)}`}
          </span>
        )}
      </div>
    </EventTooltip>
  )
}
