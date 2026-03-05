import { useRef, useEffect, useMemo } from "react"
import * as d3 from "d3"
import { useNavigate } from "react-router"
import { cn } from "@/lib/utils"

interface TimelineTask {
  id: string
  title: string
  projectId: string
  projectName: string
  projectColor?: string
  machineName: string
  machineId: string
  startedAt: number
  progress: number
  progressMessage?: string
  costUsd?: number
}

interface TaskTimelineProps {
  tasks: TimelineTask[]
  machines: string[]
  className?: string
}

const DEFAULT_COLORS = [
  "#6b8fa3", "#a3826b", "#7a9b6b", "#8b7aab", "#ab7a8b",
  "#6baab0", "#b0a06b", "#8baab0",
]

export function TaskTimeline({ tasks, machines, className }: TaskTimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const colorMap = useMemo(() => {
    const map = new Map<string, string>()
    const projectIds = [...new Set(tasks.map((t) => t.projectId))]
    projectIds.forEach((pid, i) => {
      const task = tasks.find((t) => t.projectId === pid)
      map.set(pid, task?.projectColor || DEFAULT_COLORS[i % DEFAULT_COLORS.length])
    })
    return map
  }, [tasks])

  useEffect(() => {
    const svg = d3.select(svgRef.current)
    const tooltip = d3.select(tooltipRef.current)
    svg.selectAll("*").remove()

    const container = svgRef.current?.parentElement
    if (!container) return
    const width = container.clientWidth
    const margin = { top: 20, right: 16, bottom: 24, left: 100 }
    const laneHeight = 36
    const barHeight = 22
    const height = margin.top + margin.bottom + Math.max(machines.length, 1) * laneHeight

    svg.attr("width", width).attr("height", height)

    const now = Date.now()
    const twoHoursAgo = now - 2 * 60 * 60 * 1000

    const x = d3
      .scaleTime()
      .domain([twoHoursAgo, now])
      .range([margin.left, width - margin.right])

    const y = d3
      .scaleBand()
      .domain(machines)
      .range([margin.top, height - margin.bottom])
      .padding(0.15)

    // X axis
    svg
      .append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(4)
          .tickFormat((d) => d3.timeFormat("%H:%M")(d as Date)),
      )
      .call((g) => g.select(".domain").remove())
      .call((g) =>
        g
          .selectAll(".tick text")
          .attr("class", "fill-muted-foreground")
          .attr("font-size", "10px"),
      )
      .call((g) => g.selectAll(".tick line").attr("stroke", "currentColor").attr("class", "text-border/30"))

    // Y axis (machine labels)
    svg
      .append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).tickSize(0))
      .call((g) => g.select(".domain").remove())
      .call((g) =>
        g
          .selectAll(".tick text")
          .attr("class", "fill-muted-foreground")
          .attr("font-size", "11px")
          .attr("dx", -4),
      )

    // Horizontal grid lines
    svg
      .append("g")
      .selectAll("line")
      .data(machines)
      .join("line")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", (d) => (y(d) ?? 0) + (y.bandwidth() / 2))
      .attr("y2", (d) => (y(d) ?? 0) + (y.bandwidth() / 2))
      .attr("stroke", "currentColor")
      .attr("class", "text-border/10")

    // Task bars
    const barGroup = svg
      .append("g")
      .selectAll("g")
      .data(tasks)
      .join("g")
      .attr("cursor", "pointer")
      .on("click", (_, d) => {
        navigate(`/project/${d.projectId}/task/${d.id}`)
      })
      .on("mouseenter", (event, d) => {
        const elapsed = Math.round((now - d.startedAt) / 60000)
        tooltip
          .html(
            `<strong>${d.title}</strong><br/>` +
              `<span class="text-muted-foreground">${d.projectName}</span><br/>` +
              `${d.machineName} · ${elapsed}m` +
              (d.progressMessage ? `<br/>${d.progressMessage}` : "") +
              (d.costUsd ? `<br/>$${d.costUsd.toFixed(2)}` : ""),
          )
          .style("opacity", 1)
          .style("left", `${event.offsetX + 12}px`)
          .style("top", `${event.offsetY - 10}px`)
      })
      .on("mouseleave", () => {
        tooltip.style("opacity", 0)
      })

    // Background rect
    barGroup
      .append("rect")
      .attr("x", (d) => x(Math.max(d.startedAt, twoHoursAgo)))
      .attr("y", (d) => (y(d.machineName) ?? 0) + (y.bandwidth() - barHeight) / 2)
      .attr("width", (d) => Math.max(4, x(now) - x(Math.max(d.startedAt, twoHoursAgo))))
      .attr("height", barHeight)
      .attr("rx", 4)
      .attr("fill", (d) => colorMap.get(d.projectId) || DEFAULT_COLORS[0])
      .attr("opacity", 0.25)

    // Progress fill
    barGroup
      .append("rect")
      .attr("x", (d) => x(Math.max(d.startedAt, twoHoursAgo)))
      .attr("y", (d) => (y(d.machineName) ?? 0) + (y.bandwidth() - barHeight) / 2)
      .attr("width", (d) => {
        const totalW = Math.max(4, x(now) - x(Math.max(d.startedAt, twoHoursAgo)))
        return totalW * (d.progress / 100)
      })
      .attr("height", barHeight)
      .attr("rx", 4)
      .attr("fill", (d) => colorMap.get(d.projectId) || DEFAULT_COLORS[0])
      .attr("opacity", 0.7)

    // Pulsing dot at trailing edge
    barGroup
      .append("circle")
      .attr("cx", () => x(now) - 2)
      .attr("cy", (d) => (y(d.machineName) ?? 0) + y.bandwidth() / 2)
      .attr("r", 3)
      .attr("fill", (d) => colorMap.get(d.projectId) || DEFAULT_COLORS[0])
      .attr("class", "animate-pulse")
  }, [tasks, machines, colorMap, navigate])

  if (tasks.length === 0) {
    return (
      <div className={cn("flex items-center justify-center py-8 text-muted-foreground/40 text-sm", className)}>
        All quiet — no running tasks
      </div>
    )
  }

  return (
    <div className={cn("relative w-full", className)}>
      <svg ref={svgRef} className="w-full" />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none bg-popover border border-border/60 rounded-lg px-3 py-2 text-xs shadow-lg opacity-0 transition-opacity z-10 max-w-[240px]"
      />
    </div>
  )
}
