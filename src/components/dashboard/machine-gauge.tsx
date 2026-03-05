import { useRef, useEffect } from "react"
import * as d3 from "d3"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface MachineGaugeProps {
  name: string
  cpuPercent: number
  memoryPercent: number
  activeTasks: number
  connected: boolean
  size?: number
  className?: string
}

const utilizationColor = d3
  .scaleLinear<string>()
  .domain([0, 50, 80, 100])
  .range(["#94a3b8", "#a8a29e", "#d97706", "#dc2626"])
  .clamp(true)

export function MachineGauge({
  name,
  cpuPercent,
  memoryPercent,
  activeTasks,
  connected,
  size = 100,
  className,
}: MachineGaugeProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove()

    const cx = size / 2
    const cy = size / 2
    const outerRadius = size / 2 - 4
    const innerRadius = outerRadius - 8
    const innerArcRadius = innerRadius - 3
    const innerArcWidth = innerArcRadius - 8

    const tau = 2 * Math.PI

    // Background arcs
    const bgArc = d3.arc().startAngle(0).endAngle(tau).cornerRadius(2)

    svg
      .append("path")
      .attr("transform", `translate(${cx},${cy})`)
      .attr(
        "d",
        bgArc({ innerRadius: innerRadius, outerRadius: outerRadius } as never) as string,
      )
      .attr("fill", "currentColor")
      .attr("class", "text-muted/20")

    svg
      .append("path")
      .attr("transform", `translate(${cx},${cy})`)
      .attr(
        "d",
        bgArc({
          innerRadius: innerArcWidth,
          outerRadius: innerArcRadius,
        } as never) as string,
      )
      .attr("fill", "currentColor")
      .attr("class", "text-muted/20")

    // CPU arc (outer)
    const cpuArc = d3.arc().startAngle(0).cornerRadius(2)
    svg
      .append("path")
      .attr("transform", `translate(${cx},${cy})`)
      .datum({ endAngle: 0 })
      .attr(
        "d",
        cpuArc({ innerRadius: innerRadius, outerRadius: outerRadius, endAngle: 0 } as never) as string,
      )
      .attr("fill", utilizationColor(cpuPercent))
      .transition()
      .duration(600)
      .ease(d3.easeCubicOut)
      .attrTween("d", function () {
        const interp = d3.interpolate(0, (cpuPercent / 100) * tau)
        return (t: number) =>
          cpuArc({
            innerRadius: innerRadius,
            outerRadius: outerRadius,
            endAngle: interp(t),
          } as never) as string
      })

    // Memory arc (inner)
    const memArc = d3.arc().startAngle(0).cornerRadius(2)
    svg
      .append("path")
      .attr("transform", `translate(${cx},${cy})`)
      .datum({ endAngle: 0 })
      .attr(
        "d",
        memArc({
          innerRadius: innerArcWidth,
          outerRadius: innerArcRadius,
          endAngle: 0,
        } as never) as string,
      )
      .attr("fill", utilizationColor(memoryPercent))
      .attr("opacity", 0.7)
      .transition()
      .duration(600)
      .ease(d3.easeCubicOut)
      .attrTween("d", function () {
        const interp = d3.interpolate(0, (memoryPercent / 100) * tau)
        return (t: number) =>
          memArc({
            innerRadius: innerArcWidth,
            outerRadius: innerArcRadius,
            endAngle: interp(t),
          } as never) as string
      })

    // Center text
    svg
      .append("text")
      .attr("x", cx)
      .attr("y", cy + 1)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("class", "fill-foreground")
      .attr("font-size", size * 0.24)
      .attr("font-weight", "600")
      .text(activeTasks)
  }, [cpuPercent, memoryPercent, activeTasks, size])

  return (
    <TooltipProvider delayDuration={80}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("flex flex-col items-center gap-1.5 cursor-default transition-transform duration-300 hover:scale-105", className)}>
            <svg ref={svgRef} width={size} height={size} />
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "h-1.5 w-1.5 rounded-full shrink-0",
                  connected ? "bg-success" : "bg-muted-foreground/40",
                )}
              />
              <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                {name}
              </span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          <p className="font-semibold">{name}</p>
          <p>CPU: {Math.round(cpuPercent)}%</p>
          <p>Memory: {Math.round(memoryPercent)}%</p>
          <p>Active tasks: {activeTasks}</p>
          <p className={connected ? "text-success" : "text-muted-foreground"}>
            {connected ? "Connected" : "Disconnected"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
