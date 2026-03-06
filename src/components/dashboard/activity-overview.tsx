/**
 * Activity Overview — dual-mode heatmap.
 *
 * "Hours × Day" (default): 24-hour columns × last 14 days rows.
 * "Day × Month": GitHub-style contribution graph (weeks × day-of-week).
 */
import { useCallback, useMemo, useState } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { DailyActivity, HourlyActivity } from "@/stores/stats-store"

type HeatmapMode = "hours" | "days"

interface ActivityOverviewProps {
  data: DailyActivity[]
  hourlyData?: HourlyActivity[]
  className?: string
}

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function formatHour(h: number): string {
  if (h === 0) return "12a"
  if (h < 12) return `${h}a`
  if (h === 12) return "12p"
  return `${h - 12}p`
}

function getIntensityClass(intensity: number, count: number): string {
  if (count === 0) return "bg-muted/25 dark:bg-muted/15"
  if (intensity <= 0.25) return "bg-emerald-200/80 dark:bg-emerald-800/50"
  if (intensity <= 0.5) return "bg-emerald-400/80 dark:bg-emerald-600/60"
  if (intensity <= 0.75) return "bg-emerald-500/90 dark:bg-emerald-500/70"
  return "bg-emerald-600 dark:bg-emerald-400"
}

const CELL = 11
const GAP = 2
const COL_WIDTH = CELL + GAP
const LABEL_WIDTH = 28

// ── Day × Month view (existing GitHub-style) ────────────────────────

function DayMonthGrid({ data }: { data: DailyActivity[] }) {
  const dataMap = useMemo(() => new Map(data.map((d) => [d.date, d])), [data])
  const [weekCount, setWeekCount] = useState(0)

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const measure = () => {
      const available = node.clientWidth - LABEL_WIDTH
      setWeekCount(Math.max(4, Math.floor((available + GAP) / COL_WIDTH)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
  }, [])

  const { grid, monthLabels } = useMemo(() => {
    if (weekCount === 0) return { grid: [], monthLabels: [] }

    const today = new Date()
    const todayStr = toDateStr(today)
    const todayDow = today.getDay()

    const fullWeeks = weekCount - 1
    const totalDays = fullWeeks * 7 + todayDow + 1
    const start = new Date(today)
    start.setDate(start.getDate() - totalDays + 1)

    const cursor = new Date(start)
    const weeks: Array<Array<{ date: string; count: number }>> = []
    const labels: Array<{ text: string; col: number }> = []
    let lastMonth = -1

    while (toDateStr(cursor) <= todayStr) {
      const week: Array<{ date: string; count: number }> = []
      for (let d = 0; d < 7; d++) {
        const dateStr = toDateStr(cursor)
        if (dateStr > todayStr) break
        week.push({
          date: dateStr,
          count: dataMap.get(dateStr)?.tasksCompleted ?? 0,
        })
        cursor.setDate(cursor.getDate() + 1)
      }

      const firstDay = new Date(week[0].date + "T00:00:00")
      if (firstDay.getMonth() !== lastMonth) {
        lastMonth = firstDay.getMonth()
        labels.push({ text: MONTH_NAMES[lastMonth], col: weeks.length })
      }

      weeks.push(week)
    }

    return { grid: weeks, monthLabels: labels }
  }, [dataMap, weekCount])

  const maxCount = useMemo(() => Math.max(1, ...data.map((d) => d.tasksCompleted)), [data])
  const gridWidth = grid.length > 0 ? grid.length * COL_WIDTH - GAP : 0

  return (
    <div ref={containerRef} className="flex flex-col gap-1">
      {grid.length > 0 && (
        <div className="relative" style={{ marginLeft: LABEL_WIDTH, width: gridWidth, height: 14 }}>
          {monthLabels.map((label, i) => (
            <span
              key={i}
              className="text-[10px] text-muted-foreground/50 leading-none absolute top-0"
              style={{ left: label.col * COL_WIDTH }}
            >
              {label.text}
            </span>
          ))}
        </div>
      )}

      <div className="flex">
        <div className="flex flex-col shrink-0" style={{ width: LABEL_WIDTH, gap: GAP }}>
          {DAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="text-[9px] text-muted-foreground/40 leading-none flex items-center"
              style={{ height: CELL }}
            >
              {label}
            </div>
          ))}
        </div>

        <div className="flex" style={{ gap: GAP }}>
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
              {week.map((day, di) => {
                const intensity = day.count / maxCount
                return (
                  <Tooltip key={di}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "rounded-[2px] transition-opacity hover:opacity-70 cursor-default",
                          getIntensityClass(intensity, day.count),
                        )}
                        style={{ width: CELL, height: CELL }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <strong>{day.count}</strong> task{day.count !== 1 ? "s" : ""} — {formatDateLabel(day.date)}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Hours × Day view ────────────────────────────────────────────────

const HOUR_LABEL_WIDTH = 48
const HOUR_CELL = 11
const HOUR_GAP = 2

function HoursDayGrid({ data, hourlyData }: { data: DailyActivity[]; hourlyData: HourlyActivity[] }) {
  const { days, maxCount } = useMemo(() => {
    const today = new Date()
    const daysList: string[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      daysList.push(toDateStr(d))
    }

    // Build lookup: "YYYY-MM-DD:HH" → count
    const lookup = new Map<string, number>()
    for (const h of hourlyData) {
      lookup.set(`${h.date}:${h.hour}`, h.tasksCompleted)
    }

    // Also aggregate daily data as fallback if hourly is empty
    let max = 0
    for (const h of hourlyData) {
      if (h.tasksCompleted > max) max = h.tasksCompleted
    }
    if (max === 0) {
      // Fallback: use daily data spread evenly (won't have hour resolution)
      for (const d of data) {
        if (d.tasksCompleted > max) max = d.tasksCompleted
      }
    }

    return { days: daysList, maxCount: Math.max(1, max), lookup }
  }, [data, hourlyData])

  const lookup = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of hourlyData) {
      m.set(`${h.date}:${h.hour}`, h.tasksCompleted)
    }
    return m
  }, [hourlyData])

  // Hour labels: show every 3 hours
  const hours = Array.from({ length: 24 }, (_, i) => i)

  return (
    <div className="flex flex-col gap-1">
      {/* Hour labels row */}
      <div className="flex" style={{ marginLeft: HOUR_LABEL_WIDTH }}>
        {hours.map((h) => (
          <div
            key={h}
            className="text-[9px] text-muted-foreground/50 leading-none text-center"
            style={{ width: HOUR_CELL + HOUR_GAP }}
          >
            {h % 3 === 0 ? formatHour(h) : ""}
          </div>
        ))}
      </div>

      {/* Rows: one per day */}
      {days.map((dateStr) => {
        const d = new Date(dateStr + "T00:00:00")
        const dayName = SHORT_DAY_NAMES[d.getDay()]
        const dayNum = d.getDate()
        const monthAbbr = MONTH_NAMES[d.getMonth()]

        return (
          <div key={dateStr} className="flex items-center">
            {/* Day label */}
            <div
              className="text-[9px] text-muted-foreground/40 leading-none shrink-0 text-right pr-1.5"
              style={{ width: HOUR_LABEL_WIDTH }}
            >
              {dayName} {monthAbbr} {dayNum}
            </div>

            {/* Hour cells */}
            <div className="flex" style={{ gap: HOUR_GAP }}>
              {hours.map((h) => {
                const count = lookup.get(`${dateStr}:${h}`) ?? 0
                const intensity = count / maxCount
                return (
                  <Tooltip key={h}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "rounded-[2px] transition-opacity hover:opacity-70 cursor-default",
                          getIntensityClass(intensity, count),
                        )}
                        style={{ width: HOUR_CELL, height: HOUR_CELL }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <strong>{count}</strong> task{count !== 1 ? "s" : ""} — {formatDateLabel(dateStr)}, {formatHour(h)}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────

export function ActivityOverview({ data, hourlyData = [], className }: ActivityOverviewProps) {
  const [mode, setMode] = useState<HeatmapMode>("hours")

  return (
    <TooltipProvider delayDuration={60}>
      <div className={cn("flex flex-col gap-2", className)}>
        {/* Header with mode switcher */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground">Activity</h3>
          <div className="flex items-center gap-0.5 rounded-md bg-muted/50 p-0.5">
            <button
              onClick={() => setMode("hours")}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                mode === "hours"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Hours × Day
            </button>
            <button
              onClick={() => setMode("days")}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                mode === "days"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Day × Month
            </button>
          </div>
        </div>

        {mode === "hours" ? (
          <HoursDayGrid data={data} hourlyData={hourlyData} />
        ) : (
          <DayMonthGrid data={data} />
        )}
      </div>
    </TooltipProvider>
  )
}
