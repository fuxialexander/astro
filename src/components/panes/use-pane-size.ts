/**
 * usePaneSize — ResizeObserver-driven size + density hook for any pane.
 *
 * Density is derived from the *measured* element width, not viewport media
 * queries, so a 320px-wide pane is compact whether the window is 600px or
 * 4000px. This is the foundation for the "size-responsive, clutter-free"
 * design principle from the migration plan.
 *
 * Thresholds (px width):
 *   <  480 → compact
 *   < 1024 → comfortable
 *   ≥ 1024 → spacious
 */
import { useEffect, useState, type RefObject } from 'react'

import type { PaneDensity } from './types'

export interface PaneSize {
  width: number
  height: number
  density: PaneDensity
}

const COMPACT_MAX = 480
const COMFORTABLE_MAX = 1024

function deriveDensity(width: number): PaneDensity {
  if (width < COMPACT_MAX) return 'compact'
  if (width < COMFORTABLE_MAX) return 'comfortable'
  return 'spacious'
}

export function usePaneSize(ref: RefObject<HTMLElement | null>): PaneSize {
  const [size, setSize] = useState<PaneSize>({ width: 0, height: 0, density: 'comfortable' })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame: number | null = null
    let pendingWidth = 0
    let pendingHeight = 0

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      pendingWidth = entry.contentRect.width
      pendingHeight = entry.contentRect.height

      if (frame !== null) return

      frame = window.requestAnimationFrame(() => {
        frame = null
        setSize((prev) => {
          const density = deriveDensity(pendingWidth)
          // Pane consumers currently only react to density changes; avoid
          // forcing subtree rerenders on every drag pixel.
          if (prev.density === density) {
            return prev
          }
          return { width: pendingWidth, height: pendingHeight, density }
        })
      })
    })

    observer.observe(el)
    return () => {
      observer.disconnect()
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [ref])

  return size
}
