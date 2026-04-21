import { useRef, useCallback } from 'react'
import type { CreateDraftKind } from '@/components/calendar/types'

const SNAP_MINUTES = 15

function snapToGrid(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES
}

function minutesToISO(dateStr: string, minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`
}

interface DragState {
  startY: number
  startMinutes: number
  dateStr: string
  columnHeight: number
  hourHeight: number
}

interface UseDragCreateOptions {
  dateStr: string
  columnRef: React.RefObject<HTMLElement | null>
  hourHeight?: number
  onDraftReady: (startAt: string, endAt: string, anchorRect: DOMRect, isMultiDay: boolean) => void
  defaultKind?: CreateDraftKind
}

export function useCalendarDrag({
  dateStr,
  columnRef,
  hourHeight = 60,
  onDraftReady,
}: UseDragCreateOptions) {
  const dragState = useRef<DragState | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('[data-event]')) return
      e.preventDefault()

      const col = columnRef.current
      if (!col) return
      const rect = col.getBoundingClientRect()
      const relY = e.clientY - rect.top + col.scrollTop
      const rawMinutes = (relY / hourHeight) * 60
      const startMinutes = snapToGrid(Math.max(0, Math.min(rawMinutes, 1439)))

      dragState.current = {
        startY: e.clientY,
        startMinutes,
        dateStr,
        columnHeight: rect.height,
        hourHeight,
      }

      // Create ghost element
      const ghost = document.createElement('div')
      ghost.className = 'cal-drag-ghost'
      ghost.style.cssText = `
        position: absolute;
        left: 4px;
        right: 4px;
        top: ${(startMinutes / 60) * hourHeight}px;
        height: ${hourHeight / 4}px;
        border-radius: 6px;
        pointer-events: none;
        z-index: 20;
      `
      col.style.position = 'relative'
      col.appendChild(ghost)
      ghostRef.current = ghost

      const onMouseMove = (me: MouseEvent) => {
        const ds = dragState.current
        if (!ds || !ghostRef.current) return
        const colRect = col.getBoundingClientRect()
        const relY2 = me.clientY - colRect.top + col.scrollTop
        const rawEndM = (relY2 / hourHeight) * 60
        const endMinutes = snapToGrid(Math.max(0, Math.min(rawEndM, 1440)))
        const topM = Math.min(ds.startMinutes, endMinutes)
        const botM = Math.max(ds.startMinutes, endMinutes)
        const heightPx = Math.max(hourHeight / 4, ((botM - topM) / 60) * hourHeight)
        ghostRef.current.style.top = `${(topM / 60) * hourHeight}px`
        ghostRef.current.style.height = `${heightPx}px`
      }

      const onMouseUp = (me: MouseEvent) => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)

        const ds = dragState.current
        if (!ds) return
        dragState.current = null

        const ghost = ghostRef.current
        if (ghost) {
          const anchorRect = ghost.getBoundingClientRect()
          ghost.remove()
          ghostRef.current = null

          const colRect = col.getBoundingClientRect()
          const relY2 = me.clientY - colRect.top + col.scrollTop
          const rawEndM = (relY2 / hourHeight) * 60
          const endMinutes = snapToGrid(Math.max(ds.startMinutes + SNAP_MINUTES, Math.min(rawEndM, 1440)))

          const startAt = minutesToISO(ds.dateStr, ds.startMinutes)
          const endAt = minutesToISO(ds.dateStr, endMinutes)
          onDraftReady(startAt, endAt, anchorRect, false)
        }
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [dateStr, columnRef, hourHeight, onDraftReady],
  )

  return { onMouseDown }
}

// Month/week multi-day drag
interface MultiDayDragOptions {
  onDraftReady: (startDate: string, endDate: string, anchorRect: DOMRect, isMultiDay: boolean) => void
}

export function useMultiDayDrag({ onDraftReady }: MultiDayDragOptions) {
  const startDateRef = useRef<string | null>(null)
  const currentDateRef = useRef<string | null>(null)

  const onCellMouseDown = useCallback(
    (dateStr: string, e: React.MouseEvent<HTMLElement>) => {
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('[data-event]')) return
      e.preventDefault()
      startDateRef.current = dateStr
      currentDateRef.current = dateStr

      const onMouseUp = (me: MouseEvent) => {
        document.removeEventListener('mouseup', onMouseUp)
        const start = startDateRef.current
        const end = currentDateRef.current
        startDateRef.current = null
        currentDateRef.current = null
        if (!start || !end) return
        const [s, en] = start <= end ? [start, end] : [end, start]
        const isMultiDay = s !== en
        const anchorRect = (me.target as HTMLElement).getBoundingClientRect?.() ?? new DOMRect(me.clientX, me.clientY, 0, 0)
        onDraftReady(`${s}T00:00:00.000Z`, `${en}T23:59:00.000Z`, anchorRect, isMultiDay)
      }

      const onMouseEnter = (dateStr: string) => {
        currentDateRef.current = dateStr
      }

      document.addEventListener('mouseup', onMouseUp)
      return { onMouseEnter }
    },
    [onDraftReady],
  )

  return { onCellMouseDown }
}
