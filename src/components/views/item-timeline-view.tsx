import { useMemo, useState, useRef, useCallback, useEffect, type ReactNode } from "react"
import { ChevronRight, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDisplaySettingsStore, type ViewKey } from "@/stores/display-settings-store"
import { useBarDragResize } from "@/hooks/use-bar-drag-resize"
import {
  DAY_WIDTH,
  parseDate,
  diffDays,
  addDays,
  snapToMonday,
  isValidDateStr,
} from "@/lib/timeline-utils"
import { cn } from "@/lib/utils"

type ZoomLevel = "month" | "quarter" | "year"

export interface TimelineItem {
  id: string
  startDate: string     // YYYY-MM-DD
  endDate: string       // YYYY-MM-DD
  barClass: string      // Tailwind bg class
  progressClass?: string
  progressPct?: number  // 0-100
  label?: string        // shown on bar (if wide enough)
}

export type TimelineRow<T> =
  | { kind: "header"; label: string; count: number }
  | { kind: "item"; item: T; timeline: TimelineItem }

interface ItemTimelineViewProps<T> {
  rows: TimelineRow<T>[]
  viewKey: ViewKey
  renderLeftCell: (item: T) => ReactNode
  onItemClick?: (item: T) => void
  onDateChange?: (itemId: string, startDate: string, endDate: string) => void
  leftColumnWidth?: number
  rowHeight?: number
  footer?: ReactNode
  leftHeader?: string
}

interface ColumnInfo {
  label: string
  left: number
  width: number
}

// Preset ppd values for button presets
const PRESET_PPD: Record<ZoomLevel, number> = {
  month: DAY_WIDTH,    // 20px/day → ~140px/week
  quarter: 6,          // 6px/day → ~180px/month
  year: 2.2,           // 2.2px/day → ~200px/quarter
}

// Continuous ppd limits
const PPD_MIN_ABSOLUTE = 0.3
const PPD_MAX = 30

// Column granularity thresholds
const PPD_WEEKLY_THRESHOLD = 10   // above this: show weekly columns
const PPD_MONTHLY_THRESHOLD = 3   // above this: show monthly columns, else quarterly

const ROW_HEIGHT_DEFAULT = 40

function snapToMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function snapToQuarterStart(d: Date): Date {
  const q = Math.floor(d.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(d.getUTCFullYear(), q, 1))
}

function closestPreset(ppd: number): ZoomLevel {
  let best: ZoomLevel = "year"
  let bestDist = Infinity
  for (const [level, val] of Object.entries(PRESET_PPD) as [ZoomLevel, number][]) {
    const dist = Math.abs(Math.log(ppd) - Math.log(val))
    if (dist < bestDist) { bestDist = dist; best = level }
  }
  return best
}

export function ItemTimelineView<T>({
  rows,
  viewKey,
  renderLeftCell,
  onItemClick,
  onDateChange,
  leftColumnWidth = 280,
  rowHeight = ROW_HEIGHT_DEFAULT,
  footer,
  leftHeader = "Task",
}: ItemTimelineViewProps<T>) {
  const displaySettings = useDisplaySettingsStore((s) => s.get(viewKey))
  const updateDisplaySettings = useDisplaySettingsStore((s) => s.update)
  const savedZoom = (displaySettings.zoom ?? "month") as ZoomLevel

  // Continuous ppd state — initialized from saved preset.
  // When savedZoom changes externally, reset ppd to the new preset.
  const [ppd, setPpd] = useState(() => PRESET_PPD[savedZoom])
  const [lastAppliedZoom, setLastAppliedZoom] = useState(savedZoom)
  if (savedZoom !== lastAppliedZoom) {
    setLastAppliedZoom(savedZoom)
    setPpd(PRESET_PPD[savedZoom])
  }
  const ppdRef = useRef(ppd)
  useEffect(() => { ppdRef.current = ppd }, [ppd])

  // Which button to highlight — nearest preset
  const activePreset = closestPreset(ppd)

  // Button handler: snap to preset + persist
  const setPreset = useCallback((level: ZoomLevel) => {
    setPpd(PRESET_PPD[level])
    updateDisplaySettings(viewKey, { zoom: level })
  }, [viewKey, updateDisplaySettings])

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = useCallback((label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

  const visibleRows = useMemo(() => {
    const result: TimelineRow<T>[] = []
    let currentGroupLabel: string | null = null
    for (const row of rows) {
      if (row.kind === "header") {
        currentGroupLabel = row.label
        result.push(row)
      } else {
        if (currentGroupLabel === null || !collapsed.has(currentGroupLabel)) {
          result.push(row)
        }
      }
    }
    return result
  }, [rows, collapsed])

  const scrollRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)

  // Track container width for dynamic min-ppd clamping
  const [containerWidth, setContainerWidth] = useState(800)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width)
    })
    ro.observe(el)
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const datedItems = useMemo(() => {
    return rows
      .filter((r): r is Extract<typeof r, { kind: "item" }> => r.kind === "item")
      .filter((r) => isValidDateStr(r.timeline.startDate) && isValidDateStr(r.timeline.endDate))
  }, [rows])

  // Compute the full date span (independent of ppd) — used to derive min ppd
  const { spanStart, spanEnd, totalSpanDays } = useMemo(() => {
    if (datedItems.length === 0) {
      const now = new Date()
      const s = snapToMonday(now)
      const e = addDays(s, 84)
      return { spanStart: s, spanEnd: e, totalSpanDays: 84 }
    }
    let minDate = parseDate(datedItems[0].timeline.startDate)
    let maxDate = parseDate(datedItems[0].timeline.endDate)
    for (const r of datedItems) {
      const s = parseDate(r.timeline.startDate)
      const e = parseDate(r.timeline.endDate)
      if (s < minDate) minDate = s
      if (e > maxDate) maxDate = e
    }
    // Extend: small padding before, +1 year after max
    const s = snapToQuarterStart(addDays(minDate, -30))
    const e = addDays(maxDate, 365)
    return { spanStart: s, spanEnd: e, totalSpanDays: diffDays(s, e) }
  }, [datedItems])

  // Dynamic min ppd: entire span must fit in the container (no right blank)
  const ppdMin = Math.max(PPD_MIN_ABSOLUTE, containerWidth / totalSpanDays)
  const ppdMinRef = useRef(ppdMin)
  useEffect(() => { ppdMinRef.current = ppdMin }, [ppdMin])

  // Clamp current ppd if it fell below the dynamic minimum
  const effectivePpd = Math.max(ppd, ppdMin)

  // Column granularity based on effective ppd
  const columnMode = effectivePpd >= PPD_WEEKLY_THRESHOLD ? "week" : effectivePpd >= PPD_MONTHLY_THRESHOLD ? "month" : "quarter"

  // Compute timeline bounds + columns using effectivePpd
  const { timelineStart, columnInfos, totalWidth } = useMemo(() => {
    if (datedItems.length === 0) {
      const start = spanStart
      const cols: ColumnInfo[] = Array.from({ length: 12 }, (_, i) => {
        const d = addDays(start, i * 7)
        return { label: formatColLabel(d, "week"), left: i * 7 * effectivePpd, width: 7 * effectivePpd }
      })
      return { timelineStart: start, columnInfos: cols, totalWidth: cols.length * 7 * effectivePpd }
    }

    // Use the full span for start; end adapts to column mode boundaries
    const start = spanStart
    const end = spanEnd

    const cols: ColumnInfo[] = []

    if (columnMode === "week") {
      const numWeeks = Math.max(8, Math.ceil(totalSpanDays / 7))
      for (let i = 0; i < numWeeks; i++) {
        const d = addDays(start, i * 7)
        cols.push({ label: formatColLabel(d, "week"), left: i * 7 * effectivePpd, width: 7 * effectivePpd })
      }
    } else if (columnMode === "month") {
      const cur = snapToMonthStart(start)
      while (cur <= end) {
        const colStart = new Date(cur)
        cur.setUTCMonth(cur.getUTCMonth() + 1)
        const colEnd = new Date(cur)
        cols.push({
          label: formatColLabel(colStart, "month"),
          left: diffDays(start, colStart) * effectivePpd,
          width: diffDays(colStart, colEnd) * effectivePpd,
        })
      }
    } else {
      const cur = new Date(start) // already quarter-aligned from spanStart
      while (cur <= end) {
        const colStart = new Date(cur)
        cur.setUTCMonth(cur.getUTCMonth() + 3)
        const colEnd = new Date(cur)
        cols.push({
          label: formatColLabel(colStart, "quarter"),
          left: diffDays(start, colStart) * effectivePpd,
          width: diffDays(colStart, colEnd) * effectivePpd,
        })
      }
    }

    const lastCol = cols[cols.length - 1]
    const tw = lastCol ? lastCol.left + lastCol.width : totalSpanDays * effectivePpd
    return { timelineStart: start, columnInfos: cols, totalWidth: tw }
  }, [datedItems, effectivePpd, columnMode, spanStart, spanEnd, totalSpanDays])

  const todayOffset = useMemo(() => diffDays(timelineStart, new Date()) * effectivePpd, [timelineStart, effectivePpd])

  const scrollToToday = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, todayOffset - scrollRef.current.clientWidth / 2)
    }
  }, [todayOffset])

  // Sync vertical scroll
  const handleGanttScroll = useCallback(() => {
    if (scrollRef.current && leftRef.current) {
      leftRef.current.scrollTop = scrollRef.current.scrollTop
    }
  }, [])

  const handleLeftScroll = useCallback(() => {
    if (leftRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = leftRef.current.scrollTop
    }
  }, [])

  // Refs for drag resize hook
  const effectivePpdRef = useRef(effectivePpd)
  useEffect(() => { effectivePpdRef.current = effectivePpd }, [effectivePpd])
  const timelineStartRef = useRef(timelineStart)
  useEffect(() => { timelineStartRef.current = timelineStart }, [timelineStart])

  const { handleMouseDown: handleDragMouseDown } = useBarDragResize({
    getPpd: () => effectivePpdRef.current,
    getTimelineStart: () => timelineStartRef.current,
    onCommit: (itemId, startDate, endDate) => onDateChange?.(itemId, startDate, endDate),
  })

  // Pinch-to-zoom: continuous ppd adjustment centered on pointer position
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()

      // Scale factor: small deltaY increments for smooth zoom
      const scale = Math.pow(1.01, -e.deltaY)
      const oldPpd = ppdRef.current
      const newPpd = Math.min(PPD_MAX, Math.max(ppdMinRef.current, oldPpd * scale))
      if (newPpd === oldPpd) return

      // Preserve the date under the pointer during zoom
      const rect = el.getBoundingClientRect()
      const pointerX = e.clientX - rect.left
      const scrollLeft = el.scrollLeft
      const dayAtPointer = (scrollLeft + pointerX) / oldPpd
      const newScrollLeft = dayAtPointer * newPpd - pointerX

      setPpd(newPpd)
      // Schedule scroll adjustment after React re-renders
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, newScrollLeft)
      })
    }

    el.addEventListener("wheel", handleWheel, { passive: false })
    return () => el.removeEventListener("wheel", handleWheel)
  }, [])

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left panel */}
      <div className="shrink-0 border-r border-border flex flex-col" style={{ width: `${leftColumnWidth}px` }}>
        <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase">{leftHeader}</span>
        </div>
        <div ref={leftRef} className="flex-1 overflow-auto" onScroll={handleLeftScroll} style={{ overflowX: "hidden" }}>
          <div className="h-10 shrink-0" />
          {visibleRows.map((row, i) =>
            row.kind === "header" ? (
              <button
                key={`header-${i}`}
                type="button"
                onClick={() => toggleGroup(row.label)}
                className="flex items-center gap-2 bg-muted/50 px-4 border-b border-border w-full h-8 text-left cursor-pointer hover:bg-muted/70 transition-colors"
              >
                <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !collapsed.has(row.label) && "rotate-90")} />
                <span className="text-xs font-semibold text-muted-foreground">{row.label}</span>
                <span className="text-[11px] text-muted-foreground">{row.count}</span>
              </button>
            ) : (
              <div
                key={row.timeline.id}
                onClick={() => onItemClick?.(row.item)}
                className={cn(
                  "flex items-center border-b border-border px-4 hover:bg-muted/30 transition-colors",
                  onItemClick && "cursor-pointer"
                )}
                style={{ height: `${rowHeight}px` }}
              >
                {renderLeftCell(row.item)}
              </div>
            )
          )}
          {footer}
        </div>
      </div>

      {/* Right column: toolbar + gantt */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex h-10 shrink-0 items-center justify-end border-b border-border px-4 gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={scrollToToday}>
            Today
          </Button>
          <div className="flex items-center rounded-lg bg-secondary p-0.5 gap-0.5">
            {(["month", "quarter", "year"] as ZoomLevel[]).map((level) => (
              <button
                key={level}
                onClick={() => setPreset(level)}
                className={cn(
                  "rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer capitalize",
                  activePreset === level ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Gantt chart */}
        <div ref={scrollRef} className="flex-1 overflow-auto relative" onScroll={handleGanttScroll}>
          {/* Column headers */}
          <div
            className="sticky top-0 h-10 border-b border-border bg-background z-10 relative"
            style={{ width: `${totalWidth}px` }}
          >
            {columnInfos.map((col, i) => (
              <span
                key={i}
                className="absolute top-0 h-full flex items-center justify-center text-[11px] text-muted-foreground border-l border-border/30"
                style={{ left: `${col.left}px`, width: `${col.width}px` }}
              >
                {col.label}
              </span>
            ))}
          </div>

          {/* Grid lines + today line + milestone markers */}
          <div className="absolute top-10 left-0 bottom-0" style={{ width: `${totalWidth}px` }}>
            {columnInfos.map((col, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 w-px bg-border opacity-30"
                style={{ left: `${col.left}px` }}
              />
            ))}
            {todayOffset > 0 && todayOffset < totalWidth && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-primary opacity-60"
                style={{ left: `${todayOffset}px` }}
              />
            )}
          </div>

          {/* Gantt rows */}
          <div className="relative" style={{ width: `${totalWidth}px` }}>
            {visibleRows.map((row, i) => {
              if (row.kind === "header") {
                return <div key={`header-${i}`} className="border-b border-border bg-muted/50 h-8" />
              }

              const tl = row.timeline
              if (!isValidDateStr(tl.startDate) || !isValidDateStr(tl.endDate)) {
                return <div key={tl.id} className="border-b border-border" style={{ height: `${rowHeight}px` }} />
              }

              const startD = parseDate(tl.startDate)
              const endD = parseDate(tl.endDate)
              const barLeft = diffDays(timelineStart, startD) * effectivePpd
              const barWidth = Math.max(diffDays(startD, endD) * effectivePpd, 4)
              const barTop = (rowHeight - 20) / 2

              return (
                <div key={tl.id} className="border-b border-border relative" style={{ height: `${rowHeight}px` }}>
                  <div
                    onClick={() => onItemClick?.(row.item)}
                    className={cn(
                      "absolute h-5 rounded transition hover:brightness-110 timeline-bar",
                      tl.barClass,
                      onItemClick && "cursor-pointer"
                    )}
                    style={{ left: `${barLeft}px`, width: `${barWidth}px`, top: `${barTop}px` }}
                    title={tl.label}
                  >
                    {tl.progressClass && tl.progressPct != null && tl.progressPct > 0 && tl.progressPct < 100 && (
                      <div className={cn("h-full rounded-l", tl.progressClass)} style={{ width: `${tl.progressPct}%` }} />
                    )}
                    {tl.label && barWidth > 60 && (
                      <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-white truncate">
                        {tl.label}
                      </span>
                    )}
                    {onDateChange && (
                      <>
                        <div
                          className="drag-handle absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize flex items-center justify-center"
                          onMouseDown={(e) => handleDragMouseDown(e, "left", tl.id, e.currentTarget.parentElement!, tl.startDate, tl.endDate)}
                        >
                          <div className="w-0.5 h-3 rounded-full bg-white/60" />
                        </div>
                        <div
                          className="drag-handle absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize flex items-center justify-center"
                          onMouseDown={(e) => handleDragMouseDown(e, "right", tl.id, e.currentTarget.parentElement!, tl.startDate, tl.endDate)}
                        >
                          <div className="w-0.5 h-3 rounded-full bg-white/60" />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatColLabel(d: Date, mode: "week" | "month" | "quarter"): string {
  if (mode === "week") {
    return `${d.toLocaleString("default", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`
  } else if (mode === "month") {
    return `${d.toLocaleString("default", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`
  } else {
    const q = Math.floor(d.getUTCMonth() / 3) + 1
    return `Q${q} ${d.getUTCFullYear()}`
  }
}

// Convenience: Add task footer row for timelines
export function TimelineAddTaskFooter({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-4 h-9 w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors cursor-pointer border-b border-border"
    >
      <Plus className="h-3.5 w-3.5" />
      Add task
    </button>
  )
}
