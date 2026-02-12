import { useRef, useEffect, useCallback } from "react"
import { fmtDate, parseDate, addDays, diffDays } from "@/lib/timeline-utils"

interface DragState {
  active: boolean
  edge: "left" | "right"
  itemId: string
  barEl: HTMLElement
  startDate: Date
  endDate: Date
  initialMouseX: number
  initialLeft: number
  initialWidth: number
}

interface UseBarDragResizeConfig {
  /** Returns current pixels-per-day value */
  getPpd: () => number
  /** Returns the timeline start date (left edge = day 0) */
  getTimelineStart: () => Date
  /** Called on mouseup with final dates if they changed */
  onCommit: (itemId: string, startDate: string, endDate: string) => void
  /** Minimum bar duration in days (default 1) */
  minDurationDays?: number
}

export function useBarDragResize(config: UseBarDragResizeConfig) {
  const { getPpd, getTimelineStart, onCommit, minDurationDays = 1 } = config
  const dragRef = useRef<DragState | null>(null)

  const handleMouseDown = useCallback(
    (
      e: React.MouseEvent,
      edge: "left" | "right",
      itemId: string,
      barEl: HTMLElement,
      startDate: string,
      endDate: string,
    ) => {
      e.preventDefault()
      e.stopPropagation()

      const start = parseDate(startDate)
      const end = parseDate(endDate)
      const rect = barEl.getBoundingClientRect()

      dragRef.current = {
        active: true,
        edge,
        itemId,
        barEl,
        startDate: start,
        endDate: end,
        initialMouseX: e.clientX,
        initialLeft: barEl.offsetLeft,
        initialWidth: rect.width,
      }

      barEl.classList.add("dragging")
      document.body.classList.add("timeline-dragging")
    },
    [],
  )

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      const drag = dragRef.current
      if (!drag?.active) return

      const ppd = getPpd()
      const deltaX = e.clientX - drag.initialMouseX
      const deltaDays = Math.round(deltaX / ppd)

      if (drag.edge === "left") {
        // Moving left edge: shift start date, keep end date fixed
        const newStart = addDays(drag.startDate, deltaDays)
        const maxStart = addDays(drag.endDate, -minDurationDays)
        const clampedStart = newStart > maxStart ? maxStart : newStart

        const timelineStart = getTimelineStart()
        const newLeft = diffDays(timelineStart, clampedStart) * ppd
        const newWidth = diffDays(clampedStart, drag.endDate) * ppd

        drag.barEl.style.left = `${newLeft}px`
        drag.barEl.style.width = `${Math.max(newWidth, minDurationDays * ppd)}px`
      } else {
        // Moving right edge: keep start date, shift end date
        const newEnd = addDays(drag.endDate, deltaDays)
        const minEnd = addDays(drag.startDate, minDurationDays)
        const clampedEnd = newEnd < minEnd ? minEnd : newEnd

        const newWidth = diffDays(drag.startDate, clampedEnd) * ppd
        drag.barEl.style.width = `${Math.max(newWidth, minDurationDays * ppd)}px`
      }
    }

    function handleMouseUp(e: MouseEvent) {
      const drag = dragRef.current
      if (!drag?.active) return

      const ppd = getPpd()
      const deltaX = e.clientX - drag.initialMouseX
      const deltaDays = Math.round(deltaX / ppd)

      let finalStart = drag.startDate
      let finalEnd = drag.endDate

      if (drag.edge === "left") {
        const newStart = addDays(drag.startDate, deltaDays)
        const maxStart = addDays(drag.endDate, -minDurationDays)
        finalStart = newStart > maxStart ? maxStart : newStart
      } else {
        const newEnd = addDays(drag.endDate, deltaDays)
        const minEnd = addDays(drag.startDate, minDurationDays)
        finalEnd = newEnd < minEnd ? minEnd : newEnd
      }

      drag.barEl.classList.remove("dragging")
      document.body.classList.remove("timeline-dragging")

      const startStr = fmtDate(finalStart)
      const endStr = fmtDate(finalEnd)
      const origStart = fmtDate(drag.startDate)
      const origEnd = fmtDate(drag.endDate)

      // Reset inline styles so React re-render takes over
      drag.barEl.style.left = ""
      drag.barEl.style.width = ""

      dragRef.current = null

      if (startStr !== origStart || endStr !== origEnd) {
        onCommit(drag.itemId, startStr, endStr)
      }
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [getPpd, getTimelineStart, onCommit, minDurationDays])

  return { handleMouseDown }
}
