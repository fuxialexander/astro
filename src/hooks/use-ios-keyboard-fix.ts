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

    // Keyboard height tracking — works on iOS and Android.
    // On iOS, we only apply position: fixed on html while the keyboard is open
    // to prevent document scrolling on focus. When the keyboard is closed, we
    // remove it so Safari can collapse its toolbar on scroll.
    const visualViewport = window.visualViewport
    if (visualViewport) {
      let wasKeyboardOpen = false

      const handleViewportChange = () => {
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
          if (isIOS) {
            // Lock the document when keyboard opens to prevent iOS from
            // force-scrolling the page. Reset any scroll that already happened.
            document.documentElement.classList.add("ios-viewport-fix")
            if (window.scrollX !== 0 || window.scrollY !== 0) {
              window.scrollTo(0, 0)
            }
          }
        } else {
          document.documentElement.removeAttribute("data-keyboard-open")
          if (isIOS && wasKeyboardOpen) {
            // Unlock when keyboard closes so Safari can collapse its toolbar
            // on normal scroll.
            document.documentElement.classList.remove("ios-viewport-fix")
          }
        }

        wasKeyboardOpen = isKeyboardOpen
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

    // No fallback needed — VisualViewport is supported on all modern iOS/Android browsers
  }, [])
}
