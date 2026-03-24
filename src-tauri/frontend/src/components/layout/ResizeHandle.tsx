/**
 * ResizeHandle — draggable panel divider with visual feedback.
 *
 * Renders as a thin vertical bar between panels. On hover/drag,
 * shows a highlighted indicator line. Double-click resets panel sizes.
 */
import { useState } from 'react'
import { cn } from '@desktop/lib/utils'
import { useLayoutStore } from '@desktop/stores/layout-store'

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  onDoubleClick?: () => void
  className?: string
}

export function ResizeHandle({ onMouseDown, onDoubleClick, className }: ResizeHandleProps) {
  const [hovered, setHovered] = useState(false)
  const resetPanelSizes = useLayoutStore((s) => s.resetPanelSizes)

  return (
    <div
      className={cn(
        'relative flex-shrink-0 w-[5px] cursor-col-resize group select-none',
        'hover:bg-transparent',
        className,
      )}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={onDoubleClick ?? resetPanelSizes}
      role="separator"
      aria-orientation="vertical"
    >
      {/* The visible indicator bar — centered, only a few px wide */}
      <div
        className={cn(
          'absolute inset-y-0 left-[2px] w-[1px] transition-all duration-150',
          hovered ? 'bg-primary/60 w-[2px] left-[1px]' : 'bg-border',
        )}
      />
    </div>
  )
}
