import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export interface VisualWidgetProps {
  /** Raw HTML/SVG/JS content from the visualizer code fence */
  code: string
  /** Whether the content is still streaming */
  isStreaming?: boolean
  /** Callback when the iframe sends a sendPrompt message */
  onSendPrompt?: (text: string) => void
  /** Additional CSS class names */
  className?: string
}

/**
 * Read CSS custom properties from the document root to inject into the iframe.
 * Falls back to sensible defaults if properties are not set.
 */
function getThemeVariables(): string {
  if (typeof document === "undefined") return ""
  const style = getComputedStyle(document.documentElement)
  const vars = [
    "--background",
    "--foreground",
    "--card",
    "--card-foreground",
    "--popover",
    "--popover-foreground",
    "--primary",
    "--primary-foreground",
    "--secondary",
    "--secondary-foreground",
    "--muted",
    "--muted-foreground",
    "--accent",
    "--accent-foreground",
    "--destructive",
    "--destructive-foreground",
    "--border",
    "--input",
    "--ring",
    "--radius",
    // Visualise design system tokens
    "--color-bg-primary",
    "--color-bg-secondary",
    "--color-text-primary",
    "--color-text-secondary",
    "--color-accent",
    "--color-border",
  ]

  const declarations = vars
    .map((v) => {
      const value = style.getPropertyValue(v).trim()
      return value ? `${v}: ${value};` : null
    })
    .filter(Boolean)
    .join("\n    ")

  return declarations
}

/**
 * Build a full HTML document string that wraps the user's code with
 * theme variables, bridge scripts, and auto-resize logic.
 */
function buildDocument(code: string): string {
  const themeVars = getThemeVariables()

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    ${themeVars}
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: transparent;
    color: inherit;
  }
  body { padding: 8px; }
</style>
</head>
<body>
${code}
<script>
// Bridge API: sendPrompt and openLink
window.sendPrompt = function(text) {
  parent.postMessage({ type: 'visualise:sendPrompt', text: text }, '*');
};
window.openLink = function(url) {
  parent.postMessage({ type: 'visualise:openLink', url: url }, '*');
};

// Auto-resize: post height changes to the parent
(function() {
  var lastHeight = 0;
  function reportHeight() {
    var h = document.documentElement.scrollHeight;
    if (h !== lastHeight) {
      lastHeight = h;
      parent.postMessage({ type: 'visualise:resize', height: h }, '*');
    }
  }
  // Observe mutations for dynamic content
  var observer = new MutationObserver(reportHeight);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  // Also check on resize and load
  window.addEventListener('resize', reportHeight);
  window.addEventListener('load', reportHeight);
  // Initial report
  reportHeight();
  // Periodic fallback for animations / lazy content
  setInterval(reportHeight, 500);
})();
</script>
</body>
</html>`
}

/**
 * VisualWidget renders user-provided HTML/SVG/JS content inside a sandboxed iframe.
 *
 * Features:
 * - Sandboxed execution (allow-scripts only, no allow-same-origin)
 * - Auto-resizing via postMessage from the iframe
 * - Bridge functions: sendPrompt() and openLink() available inside the iframe
 * - Debounced updates during streaming to avoid excessive re-renders
 * - Blob URL cleanup on unmount
 */
export function VisualWidget({
  code,
  isStreaming = false,
  onSendPrompt,
  className,
}: VisualWidgetProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [iframeHeight, setIframeHeight] = useState(200)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentBlobRef = useRef<string | null>(null)

  // Build and set blob URL, with debouncing during streaming
  useEffect(() => {
    function createBlob() {
      // Revoke previous blob
      if (currentBlobRef.current) {
        URL.revokeObjectURL(currentBlobRef.current)
      }
      const html = buildDocument(code)
      const blob = new Blob([html], { type: "text/html" })
      const url = URL.createObjectURL(blob)
      currentBlobRef.current = url
      setBlobUrl(url)
    }

    if (isStreaming) {
      // Debounce during streaming
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(createBlob, 300)
    } else {
      // Immediate update when not streaming
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      createBlob()
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [code, isStreaming])

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (currentBlobRef.current) {
        URL.revokeObjectURL(currentBlobRef.current)
        currentBlobRef.current = null
      }
    }
  }, [])

  // Listen for postMessage events from the iframe
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (!event.data || typeof event.data !== "object") return

      switch (event.data.type) {
        case "visualise:resize":
          if (typeof event.data.height === "number" && event.data.height > 0) {
            setIframeHeight(event.data.height)
          }
          break
        case "visualise:sendPrompt":
          if (typeof event.data.text === "string" && onSendPrompt) {
            onSendPrompt(event.data.text)
          }
          break
        case "visualise:openLink":
          if (typeof event.data.url === "string") {
            window.open(event.data.url, "_blank", "noopener,noreferrer")
          }
          break
      }
    },
    [onSendPrompt]
  )

  useEffect(() => {
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [handleMessage])

  if (!blobUrl) return null

  return (
    <iframe
      ref={iframeRef}
      src={blobUrl}
      sandbox="allow-scripts"
      className={cn("w-full border-0", className)}
      style={{ height: `${iframeHeight}px` }}
      title="Visual widget"
    />
  )
}
