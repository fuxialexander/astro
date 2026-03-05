import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export interface StatusSegment {
  label: string
  count: number
  color: string
}

interface StatusStackedBarProps {
  segments: StatusSegment[]
  height?: number
  className?: string
}

export function StatusStackedBar({
  segments,
  height = 8,
  className,
}: StatusStackedBarProps) {
  const total = segments.reduce((s, seg) => s + seg.count, 0)
  if (total === 0) return null

  return (
    <TooltipProvider delayDuration={80}>
      <div
        className={cn("w-full flex rounded-full overflow-hidden", className)}
        style={{ height }}
      >
        {segments.map((seg) => {
          if (seg.count === 0) return null
          const pct = (seg.count / total) * 100
          return (
            <Tooltip key={seg.label}>
              <TooltipTrigger asChild>
                <div
                  className={cn("transition-all duration-300 cursor-default", seg.color)}
                  style={{ width: `${pct}%` }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <strong>{seg.count}</strong> {seg.label} ({Math.round(pct)}%)
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
