import { useEffect } from "react"

/**
 * Prevents iOS/iPadOS from shifting the entire page when the virtual keyboard
 * (or toolbar/suggestions bar with external keyboard) appears.
 *
 * On iOS, focusing an input can cause `window.scrollTo` at the document level,
 * pushing the fixed-position app layout off-screen. This hook resets any
 * unwanted document-level scroll that iOS applies.
 *
 * Works alongside the `interactive-widget=resizes-visual` viewport meta tag
 * and `position: fixed` on html/body as a belt-and-suspenders approach.
 */
export function useIOSKeyboardFix() {
  useEffect(() => {
    // Only needed on iOS/iPadOS (Safari and WebKit-based browsers)
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

    if (!isIOS) return

    // Reset any document-level scrolling that iOS applies when focusing inputs.
    // This runs on scroll because iOS may force-scroll the document even with
    // overflow: hidden + position: fixed.
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
        visualViewport.removeEventListener("resize", handleViewportResize)
        visualViewport.removeEventListener("scroll", handleViewportResize)
      }
    }

    // Fallback: listen for document scroll events
    window.addEventListener("scroll", preventDocumentScroll)
    return () => {
      window.removeEventListener("scroll", preventDocumentScroll)
    }
  }, [])
}
