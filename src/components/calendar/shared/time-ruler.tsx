import { cn } from '@/lib/utils'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function formatHour(h: number): string {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

interface TimeRulerProps {
  hourHeight?: number
  className?: string
}

export function TimeRuler({ hourHeight = 60, className }: TimeRulerProps) {
  return (
    <div
      className={cn('select-none shrink-0', className)}
      style={{ width: 44 }}
      aria-hidden
    >
      {HOURS.map((h) => (
        <div
          key={h}
          className="cal-time-label flex items-start"
          style={{ height: hourHeight }}
        >
          <span className="mt-[-7px]">{h === 0 ? '' : formatHour(h)}</span>
        </div>
      ))}
    </div>
  )
}
