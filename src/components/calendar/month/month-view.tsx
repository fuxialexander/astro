import { useState, useEffect, useCallback, useRef } from 'react'
import { useCalendarEvents } from '@/hooks/use-calendar-events'
import { useCalendarStore } from '@/stores/calendar-store'
import { MonthDayCell } from './month-day-cell'
import { DayCreatePopover } from '../day/day-create-popover'
import { parseDate, fmtDate, addDays } from '@/lib/timeline-utils'

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getMonthGrid(focusedDate: string): string[] {
  const d = parseDate(focusedDate)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()

  const firstOfMonth = new Date(Date.UTC(year, month, 1))
  // Monday-first: day 0=Mon, 6=Sun
  const firstDow = (firstOfMonth.getUTCDay() + 6) % 7
  const gridStart = addDays(firstOfMonth, -firstDow)

  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0))
  const lastDow = (lastOfMonth.getUTCDay() + 6) % 7
  const gridEnd = addDays(lastOfMonth, 6 - lastDow)

  const days: string[] = []
  let cur = gridStart
  while (cur <= gridEnd) {
    days.push(fmtDate(cur))
    cur = addDays(cur, 1)
  }
  return days
}

function isCurrentMonth(dateStr: string, focusedDate: string): boolean {
  return dateStr.slice(0, 7) === focusedDate.slice(0, 7)
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

interface MonthViewProps {
  focusedDate: string
}

export function MonthView({ focusedDate }: MonthViewProps) {
  const { byDay, heatMap } = useCalendarEvents()
  const createDraft = useCalendarStore((s) => s.createDraft)
  const setCreateDraft = useCalendarStore((s) => s.setCreateDraft)
  const setView = useCalendarStore((s) => s.setView)
  const setFocusedDate = useCalendarStore((s) => s.setFocusedDate)
  const today = todayStr()
  const grid = getMonthGrid(focusedDate)

  const [dragRange, setDragRange] = useState<{ start: string; end: string } | null>(null)
  const dragActiveRef = useRef(false)

  const handleDayClick = (dateStr: string) => {
    setFocusedDate(dateStr)
    setView('day')
  }

  const getDateFromPoint = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)
    const cell = el?.closest('[data-date]') as HTMLElement | null
    return cell?.dataset.date ?? null
  }

  const handleGridMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-event], button')) return
    const dateStr = getDateFromPoint(e.clientX, e.clientY)
    if (!dateStr) return
    e.preventDefault()
    dragActiveRef.current = true
    setDragRange({ start: dateStr, end: dateStr })
  }, [])

  const handleGridMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragActiveRef.current) return
    const dateStr = getDateFromPoint(e.clientX, e.clientY)
    if (dateStr) setDragRange((prev) => prev ? { ...prev, end: dateStr } : null)
  }, [])

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (!dragActiveRef.current) return
      dragActiveRef.current = false
      const cursorRect = new DOMRect(e.clientX, e.clientY, 0, 0)
      setDragRange((prev) => {
        if (!prev) return null
        const [start, end] = [prev.start, prev.end].sort()
        setCreateDraft({
          startAt: `${start}T00:00:00.000Z`,
          endAt: `${end}T23:59:00.000Z`,
          kind: 'task',
          isMultiDay: start !== end,
          anchorRect: cursorRect,
        })
        return null
      })
    }
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [setCreateDraft])

  const [dragStart, dragEnd] = dragRange ? [dragRange.start, dragRange.end].sort() : ['', '']

  return (
    <div className="flex flex-col h-full">
      {/* DOW header row */}
      <div className="grid grid-cols-7 border-b border-border shrink-0">
        {DOW_LABELS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div
        className="grid grid-cols-7 flex-1 border-l border-t border-border overflow-y-auto"
        onMouseDown={handleGridMouseDown}
        onMouseMove={handleGridMouseMove}
      >
        {grid.map((dateStr) => (
          <MonthDayCell
            key={dateStr}
            dateStr={dateStr}
            events={byDay.get(dateStr) ?? []}
            heatIntensity={heatMap.get(dateStr) ?? 0}
            isToday={dateStr === today}
            isOutsideMonth={!isCurrentMonth(dateStr, focusedDate)}
            onDayClick={handleDayClick}
            isDragSelected={!!dragRange && dateStr >= dragStart && dateStr <= dragEnd}
          />
        ))}
      </div>

      {createDraft && <DayCreatePopover draft={createDraft} />}
    </div>
  )
}
