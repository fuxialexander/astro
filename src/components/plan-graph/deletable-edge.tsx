import { memo, useState, useRef, useCallback } from "react"
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface DeletableEdgeData {
  onDelete?: (source: string, target: string) => void
  readOnly?: boolean
  [key: string]: unknown
}

export const DeletableEdge = memo(function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  source,
  target,
  style,
  data,
  animated,
}: EdgeProps & { data?: DeletableEdgeData }) {
  const [hovered, setHovered] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showEdge = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    setHovered(true)
  }, [])

  const hideEdge = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setHovered(false)
    }, 200)
  }, [])

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <>
      {/* Invisible wider path for easier hover targeting */}
      {!data?.readOnly && (
        <path
          d={edgePath}
          fill="none"
          strokeWidth={16}
          stroke="transparent"
          className="react-flow__edge-interaction"
          onMouseEnter={showEdge}
          onMouseLeave={hideEdge}
        />
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: hovered && !data?.readOnly ? "var(--destructive)" : style?.stroke,
          strokeWidth: hovered && !data?.readOnly ? 2 : (style?.strokeWidth ?? 1.5),
          transition: "stroke 150ms, stroke-width 150ms",
        }}
        className={cn(animated && "animated")}
      />
      {!data?.readOnly && hovered && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="absolute flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md hover:bg-destructive/90 transition-colors cursor-pointer pointer-events-auto"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            onMouseEnter={showEdge}
            onMouseLeave={hideEdge}
            onClick={(e) => {
              e.stopPropagation()
              data?.onDelete?.(source, target)
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
})
