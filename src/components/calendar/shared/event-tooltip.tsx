import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { CalendarDays, Clock, FolderOpen, RefreshCw, MapPin } from 'lucide-react'
import type { CalendarEvent } from '../types'
import { RecurrenceLabel } from './recurrence-label'
import { cn } from '@/lib/utils'

interface EventTooltipProps {
  event: CalendarEvent
  children: React.ReactNode
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

const COLOR_DOT: Record<string, string> = {
  blue: 'bg-primary',
  green: 'bg-success',
  amber: 'bg-warning',
  red: 'bg-destructive',
  purple: 'bg-[#A898C0]',
  gray: 'bg-muted-foreground',
  external: 'bg-muted-foreground',
}

export function EventTooltip({ event, children }: EventTooltipProps) {
  const raw = event.raw as { calendarColor?: string; location?: string } | undefined
  const externalColor = event.color === 'external' ? raw?.calendarColor : undefined
  const location = raw?.location

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="calendar-popup-surface w-72 p-3 text-sm"
        side="right"
        sideOffset={6}
        align="start"
      >
        <div className="flex items-start gap-2">
          <div
            className={cn('mt-1 w-2.5 h-2.5 rounded-full shrink-0', COLOR_DOT[event.color])}
            style={externalColor ? { background: externalColor } : undefined}
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground leading-tight">{event.title}</p>
            {event.description && (
              <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{event.description}</p>
            )}
          </div>
        </div>

        <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
          {event.allDay ? (
            <div className="flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span>{formatDate(event.startAt)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>{formatDate(event.startAt)}, {formatTime(event.startAt)} – {formatTime(event.endAt)}</span>
            </div>
          )}

          {event.projectName && (
            <div className="flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{event.projectName}</span>
            </div>
          )}

          {location && (
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{location}</span>
            </div>
          )}

          {event.cronExpression && (
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <RecurrenceLabel cronExpression={event.cronExpression} timezone={event.timezone} />
            </div>
          )}
        </div>

        <div className="mt-2 flex gap-1 flex-wrap">
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
            {event.kind}
          </Badge>
          {event.isCompleted && (
            <Badge className="text-[10px] h-4 px-1.5 bg-success/15 text-success border-0">
              completed
            </Badge>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
