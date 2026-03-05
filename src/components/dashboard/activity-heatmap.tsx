/**
 * Activity Heatmap — GitHub contribution graph style
 *
 * 52-week CSS grid of daily activity, colored by tasksCompleted.
 * Dynamically sizes cells to fill the container width.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { DailyActivity } from "@/stores/stats-store"

interface ActivityHeatmapProps {
  data: DailyActivity[]
  className?: string
}

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

function getIntensity(count: number): number {
  if (count === 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 9) return 3
  return 4
}

const INTENSITY_CLASSES = [
  "bg-muted/50",
  "bg-emerald-200 dark:bg-emerald-900",
  "bg-emerald-400 dark:bg-emerald-700",
  "bg-emerald-500 dark:bg-emerald-500",
  "bg-emerald-700 dark:bg-emerald-300",
]

const GAP = 2
const DAY_LABEL_WIDTH = 24
const DAY_LABEL_MARGIN = 4

export function ActivityHeatmap({ data, className }: ActivityHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width)
    })
    ro.observe(node)
    setContainerWidth(node.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  // Build 52-week grid with sparse data
  const { grid, monthLabels } = useMemo(() => {
    const dataMap = new Map(data.map((d) => [d.date, d]))

    // Start from 52 weeks ago, aligned to Sunday
    const today = new Date()
    const start = new Date(today)
    start.setDate(start.getDate() - (52 * 7) - start.getDay())

    const weeks: Array<Array<{ date: string; count: number; day: Date }>> = []
    const months: Array<{ label: string; col: number }> = []
    let lastMonth = -1

    const cursor = new Date(start)
    let weekIdx = 0

    while (cursor <= today) {
      const week: Array<{ date: string; count: number; day: Date }> = []
      for (let d = 0; d < 7; d++) {
        if (cursor > today) {
          week.push({ date: "", count: -1, day: new Date(cursor) })
        } else {
          const dateStr = cursor.toISOString().slice(0, 10)
          const entry = dataMap.get(dateStr)
          week.push({
            date: dateStr,
            count: entry?.tasksCompleted ?? 0,
            day: new Date(cursor),
          })

          const month = cursor.getMonth()
          if (month !== lastMonth) {
            months.push({ label: MONTH_LABELS[month], col: weekIdx })
            lastMonth = month
          }
        }
        cursor.setDate(cursor.getDate() + 1)
      }
      weeks.push(week)
      weekIdx++
    }

    return { grid: weeks, monthLabels: months }
  }, [data])

  // Calculate cell size to fill the container
  const numWeeks = grid.length
  const availableWidth = containerWidth - DAY_LABEL_WIDTH - DAY_LABEL_MARGIN
  const cellSize = numWeeks > 0
    ? Math.max(8, Math.floor((availableWidth - GAP * (numWeeks - 1)) / numWeeks))
    : 11
  const step = cellSize + GAP

  return (
    <div ref={containerRef} className={cn("flex flex-col gap-2", className)}>
      <h3 className="text-sm font-semibold">Activity</h3>

      {containerWidth > 0 && (
        <div className="flex flex-col gap-[2px]">
          {/* Month labels */}
          <div className="flex gap-[2px]" style={{ marginLeft: DAY_LABEL_WIDTH + DAY_LABEL_MARGIN }}>
            {monthLabels.map((m, i) => {
              const nextCol = i < monthLabels.length - 1 ? monthLabels[i + 1].col : grid.length
              const span = nextCol - m.col
              return (
                <div
                  key={`${m.label}-${i}`}
                  className="text-[10px] text-muted-foreground"
                  style={{ width: `${span * step - GAP}px` }}
                >
                  {span >= 3 ? m.label : ""}
                </div>
              )
            })}
          </div>

          {/* Grid: 7 rows (days) x N columns (weeks) */}
          <div className="flex gap-0">
            {/* Day labels */}
            <div className="flex flex-col gap-[2px] shrink-0" style={{ width: DAY_LABEL_WIDTH, marginRight: DAY_LABEL_MARGIN }}>
              {DAY_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="text-[10px] text-muted-foreground text-right"
                  style={{ height: cellSize, lineHeight: `${cellSize}px` }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Weeks */}
            <TooltipProvider delayDuration={100}>
              <div className="flex gap-[2px]">
                {grid.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-[2px]">
                    {week.map((day, di) => {
                      if (day.count < 0) {
                        return <div key={di} style={{ height: cellSize, width: cellSize }} />
                      }
                      const intensity = getIntensity(day.count)
                      return (
                        <Tooltip key={di}>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                "rounded-[2px] transition-colors",
                                INTENSITY_CLASSES[intensity]
                              )}
                              style={{ height: cellSize, width: cellSize }}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            <span className="font-semibold">{day.count} task{day.count !== 1 ? "s" : ""}</span>
                            {" on "}
                            {day.date}
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>
                ))}
              </div>
            </TooltipProvider>
          </div>
        </div>
      )}
    </div>
  )
}
