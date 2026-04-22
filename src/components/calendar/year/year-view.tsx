import { useMemo } from 'react'
import { useCalendarEvents } from '@/hooks/use-calendar-events'
import { useCalendarStore } from '@/stores/calendar-store'
import { localDateStr } from '@/lib/timeline-utils'
import { cn } from '@/lib/utils'

const DOW_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface YearViewProps {
  focusedDate: string
}

/** Background heat using orange: 15%–65% of #F97316, matching the filter legend. */
function heatStyle(heat: number): React.CSSProperties | undefined {
  if (heat <= 0) return undefined
  const pct = Math.round(15 + heat * 50)
  return { background: `color-mix(in srgb, #F97316 ${pct}%, transparent)` }
}

interface MiniMonthProps {
  year: number
  month: number
  today: string
  byDay: Map<string, number>
  heatMap: Map<string, number>
  onDateClick: (dateStr: string) => void
}

function MiniMonth({ year, month, today, byDay, heatMap, onDateClick }: MiniMonthProps) {
  const isCurrentMonth = today.startsWith(
    `${year}-${String(month + 1).padStart(2, '0')}`,
  )

  const cells = useMemo(() => {
    const firstDay    = new Date(Date.UTC(year, month, 1))
    const startOffset = (firstDay.getUTCDay() + 6) % 7
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const daysInPrev  = new Date(Date.UTC(year, month, 0)).getUTCDate()

    const out: { dateStr: string; day: number; inMonth: boolean }[] = []

    for (let i = startOffset - 1; i >= 0; i--) {
      const d = daysInPrev - i
      const pm = month === 0 ? 11 : month - 1
      const py = month === 0 ? year - 1 : year
      out.push({ dateStr: `${py}-${String(pm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, day: d, inMonth: false })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, day: d, inMonth: true })
    }
    // Always pad to exactly 42 cells (6 rows × 7 cols) so every mini-month
    // uses the same row height regardless of how many weeks the month spans.
    const nm = month === 11 ? 0 : month + 1
    const ny = month === 11 ? year + 1 : year
    let nextDay = 1
    while (out.length < 42) {
      out.push({ dateStr: `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`, day: nextDay, inMonth: false })
      nextDay++
    }
    return out
  }, [year, month])

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Month name */}
      <div className={cn(
        'text-[12px] font-semibold mb-1 shrink-0',
        isCurrentMonth ? 'text-destructive' : 'text-foreground',
      )}>
        {MONTH_NAMES[month]}
      </div>

      {/* DOW headers */}
      <div className="grid grid-cols-7 shrink-0 mb-0.5">
        {DOW_LABELS.map((l, i) => (
          <div key={i} className="text-center text-[9px] font-medium text-muted-foreground/50">
            {l}
          </div>
        ))}
      </div>

      {/* Date grid — fixed 6 rows so all months have equal cell sizes */}
      <div
        className="grid grid-cols-7 flex-1 min-h-0"
        style={{ gridTemplateRows: 'repeat(6, 1fr)' }}
      >
        {cells.map(({ dateStr, day, inMonth }) => {
          const isToday   = dateStr === today
          const heat      = inMonth ? (heatMap.get(dateStr) ?? 0) : 0
          const hasEvents = inMonth && (byDay.get(dateStr) ?? 0) > 0
          const style     = !isToday && hasEvents ? heatStyle(heat) : undefined

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => inMonth && onDateClick(dateStr)}
              className={cn(
                'flex items-center justify-center text-[11px] leading-none w-full rounded-sm transition-colors',
                inMonth ? 'cursor-pointer hover:bg-accent/50' : 'opacity-20 pointer-events-none',
                inMonth && !isToday && 'text-foreground/75',
              )}
              style={style}
              tabIndex={inMonth ? 0 : -1}
            >
              {isToday ? (
                <span className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-destructive text-white text-[10px] font-semibold">
                  {day}
                </span>
              ) : (
                <span>{day}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function YearView({ focusedDate }: YearViewProps) {
  const { byDay, heatMap }  = useCalendarEvents()
  const setView             = useCalendarStore((s) => s.setView)
  const setFocusedDate      = useCalendarStore((s) => s.setFocusedDate)

  const year  = parseInt(focusedDate.slice(0, 4), 10)
  const today = localDateStr()

  const countByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const [d, evs] of byDay) m.set(d, evs.length)
    return m
  }, [byDay])

  const handleDateClick = (dateStr: string) => {
    setFocusedDate(dateStr)
    setView('day')
  }

  return (
    <div className="h-full overflow-hidden px-6 py-4 flex flex-col">
      <div className="flex-1 min-h-0 grid grid-cols-4 grid-rows-3 gap-x-8 gap-y-5">
        {Array.from({ length: 12 }, (_, m) => (
          <MiniMonth
            key={m}
            year={year}
            month={m}
            today={today}
            byDay={countByDay}
            heatMap={heatMap}
            onDateClick={handleDateClick}
          />
        ))}
      </div>
    </div>
  )
}
