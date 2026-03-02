import { useEffect } from "react"

/**
 * Prevents iOS/iPadOS from shifting the entire page when the virtual keyboard
 * (or toolbar/suggestions bar with external keyboard) appears.
 *
 * ## Why this hook exists (not just CSS)
 *
 * On iOS WebKit, focusing a text input triggers the browser to programmatically
 * scroll the document to bring the input "into view" — even when the html element
 * has `overflow: hidden`. The only reliable CSS fix is `position: fixed` on html,
 * but that's an iOS-specific workaround that could break scroll restoration on
 * desktop browsers. So we scope it to iOS only:
 *
 * 1. Adds `.ios-viewport-fix` class to `<html>` → enables `position: fixed` (CSS)
 * 2. Listens for VisualViewport resize/scroll events and resets `window.scrollTo(0,0)`
 *
 * The scroll-reset (layer 2) is NOT redundant with `position: fixed` (layer 1):
 * iOS WebKit can still shift `window.scrollY` during visual viewport transitions
 * (keyboard appearing/disappearing) even with `position: fixed`. This is a known
 * WebKit behavior where the layout engine temporarily adjusts scroll offset during
 * viewport geometry changes. The JS handler catches and immediately reverts these.
 *
 * Works alongside the `interactive-widget=resizes-visual` viewport meta tag
 * (which tells the browser to only resize the visual viewport, not the layout
 * viewport, when the keyboard appears).
 */
export function useIOSKeyboardFix() {
  useEffect(() => {
    // Only needed on iOS/iPadOS (Safari and WebKit-based browsers)
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

    if (!isIOS) return

    // Apply iOS-specific CSS (position: fixed on html) via class toggle.
    // This is scoped to iOS to avoid affecting desktop scroll restoration
    // and Android keyboard behavior.
    document.documentElement.classList.add("ios-viewport-fix")

    // Reset any document-level scrolling that iOS applies when focusing inputs.
    // Even with position: fixed + overflow: hidden, iOS WebKit can force-scroll
    // the document during visual viewport transitions (keyboard show/hide).
    const preventDocumentScroll = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0)
      }
    }

    // Use the VisualViewport API to detect keyboard appearance and reset scroll
    const visualViewport = window.visualViewport
    if (visualViewport) {
      const handleViewportResize = () => {
        // Reset document scroll when visual viewport changes (keyboard shows/hides)
        preventDocumentScroll()
      }

      visualViewport.addEventListener("resize", handleViewportResize)
      visualViewport.addEventListener("scroll", handleViewportResize)

      return () => {
        document.documentElement.classList.remove("ios-viewport-fix")
        visualViewport.removeEventListener("resize", handleViewportResize)
        visualViewport.removeEventListener("scroll", handleViewportResize)
      }
    }

    // Fallback: listen for document scroll events
    window.addEventListener("scroll", preventDocumentScroll)
    return () => {
      document.documentElement.classList.remove("ios-viewport-fix")
      window.removeEventListener("scroll", preventDocumentScroll)
    }
  }, [])
}
