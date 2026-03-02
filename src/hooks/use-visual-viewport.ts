import { useState, useEffect, useCallback } from "react"

/**
 * Returns the visual viewport height, accounting for on-screen keyboards
 * and iPad keyboard accessory bars.
 *
 * On iPad/iOS, `window.innerHeight` does NOT change when the keyboard appears,
 * but `window.visualViewport.height` does. This hook provides a reactive value
 * that updates when the visual viewport resizes (e.g., keyboard show/hide).
 *
 * Falls back to `window.innerHeight` on browsers without VisualViewport API.
 */
export function useVisualViewportHeight(): number {
  const getHeight = useCallback(
    () => window.visualViewport?.height ?? window.innerHeight,
    []
  )

  const [height, setHeight] = useState(getHeight)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const onResize = () => setHeight(vv.height)
    vv.addEventListener("resize", onResize)
    return () => vv.removeEventListener("resize", onResize)
  }, [])

  return height
}

/**
 * Returns the current visual viewport height (non-reactive utility).
 * Use this in event handlers or callbacks where you need a one-shot read.
 */
export function getVisualViewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}
