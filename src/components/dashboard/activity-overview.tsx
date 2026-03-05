/**
 * Activity Overview — full-width GitHub-style contribution heatmap.
 * Dynamically fills available width by measuring the container.
 */
import { useCallback, useMemo, useState } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { DailyActivity } from "@/stores/stats-store"

interface ActivityOverviewProps {
  data: DailyActivity[]
  className?: string
}

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

const CELL = 11
const GAP = 2
const COL_WIDTH = CELL + GAP
const LABEL_WIDTH = 28

export function ActivityOverview({ data, className }: ActivityOverviewProps) {
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

  // The grid's total pixel width (used to align month labels)
  const gridWidth = grid.length > 0 ? grid.length * COL_WIDTH - GAP : 0

  return (
    <TooltipProvider delayDuration={60}>
      <div ref={containerRef} className={cn("flex flex-col gap-1", className)}>
        {/* Month labels — aligned with grid columns */}
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
          {/* Day-of-week labels */}
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

          {/* Heatmap grid */}
          <div className="flex" style={{ gap: GAP }}>
            {grid.map((week, wi) => (
              <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
                {week.map((day, di) => {
                  const intensity = day.count / maxCount
                  const cls = day.count === 0
                    ? "bg-muted/25 dark:bg-muted/15"
                    : intensity <= 0.25
                      ? "bg-emerald-200/80 dark:bg-emerald-800/50"
                      : intensity <= 0.5
                        ? "bg-emerald-400/80 dark:bg-emerald-600/60"
                        : intensity <= 0.75
                          ? "bg-emerald-500/90 dark:bg-emerald-500/70"
                          : "bg-emerald-600 dark:bg-emerald-400"

                  return (
                    <Tooltip key={di}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "rounded-[2px] transition-opacity hover:opacity-70 cursor-default",
                            cls,
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
    </TooltipProvider>
  )
}
