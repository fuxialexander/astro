import { useEffect, useCallback } from "react"
import { useKeyboardNavStore } from "@/stores/keyboard-nav-store"
import { useUIStore } from "@/stores/ui-store"

interface UseKeyboardNavOptions {
  /** Callback when Enter is pressed on focused item */
  onActivate?: (id: string) => void
  /** Whether to enable keyboard navigation for this view */
  enabled?: boolean
}

/**
 * Global keyboard navigation hook
 * Handles arrow key navigation and Enter activation
 * Integrates with command palette to disable when palette is open
 */
export function useKeyboardNav({ onActivate, enabled = true }: UseKeyboardNavOptions = {}) {
  const focusNext = useKeyboardNavStore((s) => s.focusNext)
  const focusPrev = useKeyboardNavStore((s) => s.focusPrev)
  const focusedId = useKeyboardNavStore((s) => s.focusedId)
  const setActive = useKeyboardNavStore((s) => s.setActive)
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Disable keyboard nav when command palette is open
      if (commandPaletteOpen || !enabled) return

      // Ignore if user is typing in an input
      const target = e.target as HTMLElement
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return
      }

      switch (e.key) {
        case "ArrowDown":
        case "j": // Vim-style
          e.preventDefault()
          focusNext()
          break
        case "ArrowUp":
        case "k": // Vim-style
          e.preventDefault()
          focusPrev()
          break
        case "Enter":
          if (focusedId && onActivate) {
            e.preventDefault()
            onActivate(focusedId)
          }
          break
        case "Escape":
          e.preventDefault()
          setActive(false)
          break
      }
    },
    [commandPaletteOpen, enabled, focusNext, focusPrev, focusedId, onActivate, setActive]
  )

  useEffect(() => {
    if (!enabled) return

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown, enabled])

  return {
    focusedId,
  }
}
