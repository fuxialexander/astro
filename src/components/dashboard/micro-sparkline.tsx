import { useRef, useEffect } from "react"
import * as d3 from "d3"

interface MicroSparklineProps {
  data: number[]
  width?: number
  height?: number
  strokeColor?: string
  className?: string
}

export function MicroSparkline({
  data,
  width = 80,
  height = 20,
  strokeColor = "currentColor",
  className,
}: MicroSparklineProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove()

    if (data.length < 2) return

    const x = d3.scaleLinear().domain([0, data.length - 1]).range([1, width - 1])
    const y = d3
      .scaleLinear()
      .domain([0, Math.max(1, d3.max(data) ?? 1)])
      .range([height - 2, 2])

    const line = d3
      .line<number>()
      .x((_, i) => x(i))
      .y((d) => y(d))
      .curve(d3.curveMonotoneX)

    const area = d3
      .area<number>()
      .x((_, i) => x(i))
      .y0(height)
      .y1((d) => y(d))
      .curve(d3.curveMonotoneX)

    svg
      .append("path")
      .datum(data)
      .attr("d", area)
      .attr("fill", strokeColor)
      .attr("opacity", 0.05)

    svg
      .append("path")
      .datum(data)
      .attr("d", line)
      .attr("fill", "none")
      .attr("stroke", strokeColor)
      .attr("stroke-width", 1.5)
      .attr("stroke-linecap", "round")
  }, [data, width, height, strokeColor])

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className={className}
      style={{ display: "block" }}
    />
  )
}
