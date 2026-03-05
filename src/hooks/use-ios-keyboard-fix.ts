import { useEffect } from "react"

/**
 * Prevents iOS/iPadOS from shifting the entire page when the virtual keyboard
 * (or toolbar/suggestions bar with external keyboard) appears, and tracks
 * keyboard height for layout-aware components.
 *
 * ## What this hook does
 *
 * 1. **iOS scroll prevention**: Adds `.ios-viewport-fix` class to `<html>` (enables
 *    `position: fixed; inset: 0` in CSS) and resets any forced document scrolling.
 *
 * 2. **Keyboard height tracking** (all mobile): Listens to `VisualViewport` resize
 *    events and sets:
 *    - `--keyboard-height` CSS custom property on `<html>` (e.g. `"260px"` or `"0px"`)
 *    - `data-keyboard-open` attribute on `<html>` when keyboard is visible
 *
 *    Components use `--keyboard-height` to shrink their container so inputs stay
 *    visible above the keyboard, and `data-keyboard-open` to hide elements like
 *    the mobile bottom tab bar via CSS.
 *
 * Works alongside the `interactive-widget=resizes-visual` viewport meta tag
 * (which tells the browser to only resize the visual viewport, not the layout
 * viewport, when the keyboard appears).
 */
export function useIOSKeyboardFix() {
  useEffect(() => {
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

    // iOS-specific: position: fixed on html to prevent document scrolling on focus
    if (isIOS) {
      document.documentElement.classList.add("ios-viewport-fix")
    }

    // Keyboard height tracking — works on iOS and Android
    const visualViewport = window.visualViewport
    if (visualViewport) {
      const handleViewportChange = () => {
        // iOS scroll reset: prevent document-level scrolling during viewport transitions
        if (isIOS && (window.scrollX !== 0 || window.scrollY !== 0)) {
          window.scrollTo(0, 0)
        }

        // Calculate keyboard height from visual viewport difference.
        // On iOS, visualViewport.offsetTop accounts for any shift (e.g. scroll into
        // view behavior). The keyboard height is the gap between the layout viewport
        // bottom and the visual viewport bottom.
        const keyboardHeight = window.innerHeight - visualViewport.height - visualViewport.offsetTop
        const isKeyboardOpen = keyboardHeight > 100 // threshold to ignore toolbar-only changes

        document.documentElement.style.setProperty(
          "--keyboard-height",
          isKeyboardOpen ? `${keyboardHeight}px` : "0px"
        )

        if (isKeyboardOpen) {
          document.documentElement.setAttribute("data-keyboard-open", "")
        } else {
          document.documentElement.removeAttribute("data-keyboard-open")
        }
      }

      visualViewport.addEventListener("resize", handleViewportChange)
      visualViewport.addEventListener("scroll", handleViewportChange)

      return () => {
        document.documentElement.classList.remove("ios-viewport-fix")
        document.documentElement.style.removeProperty("--keyboard-height")
        document.documentElement.removeAttribute("data-keyboard-open")
        visualViewport.removeEventListener("resize", handleViewportChange)
        visualViewport.removeEventListener("scroll", handleViewportChange)
      }
    }

    // Fallback for browsers without VisualViewport: just prevent scroll on iOS
    if (isIOS) {
      const preventDocumentScroll = () => {
        if (window.scrollX !== 0 || window.scrollY !== 0) {
          window.scrollTo(0, 0)
        }
      }
      window.addEventListener("scroll", preventDocumentScroll)
      return () => {
        document.documentElement.classList.remove("ios-viewport-fix")
        window.removeEventListener("scroll", preventDocumentScroll)
      }
    }
  }, [])
}
