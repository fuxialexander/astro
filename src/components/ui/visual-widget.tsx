import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/** Maximum iframe height in pixels to prevent layout abuse */
const MAX_IFRAME_HEIGHT = 8000

export interface VisualWidgetProps {
  /** Raw HTML/SVG/JS content from the visualizer code fence */
  code: string
  /** Whether the content is still streaming */
  isStreaming?: boolean
  /** Callback when the iframe sends a sendPrompt message */
  onSendPrompt?: (text: string) => void
  /** Callback when the iframe sends an openLink message. Defaults to window.open. */
  onOpenLink?: (url: string) => void
  /** Additional CSS class names */
  className?: string
  /** Additional inline styles */
  style?: React.CSSProperties
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
    // Visualise design system tokens (must match SKILL.md)
    "--color-background-primary",
    "--color-background-secondary",
    "--color-background-tertiary",
    "--color-background-info",
    "--color-background-danger",
    "--color-background-success",
    "--color-background-warning",
    "--color-text-primary",
    "--color-text-secondary",
    "--color-text-tertiary",
    "--color-text-info",
    "--color-text-danger",
    "--color-text-success",
    "--color-text-warning",
    "--color-border-primary",
    "--color-border-secondary",
    "--color-border-tertiary",
    "--font-sans",
    "--font-serif",
    "--font-mono",
    "--border-radius-md",
    "--border-radius-lg",
    "--border-radius-xl",
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
 * Extract the meaningful parts from a potentially full HTML document.
 * If the code is a full HTML page (has <html> or <!DOCTYPE>), extract
 * the head styles/scripts and body content so we can re-wrap it cleanly
 * without nesting <html> inside <html>.
 */
function extractBodyContent(code: string): { headContent: string; bodyContent: string } {
  const isFullDoc = /<!DOCTYPE|<html[\s>]/i.test(code)
  if (!isFullDoc) {
    return { headContent: '', bodyContent: code }
  }

  // Extract content from <head>...</head>
  const headMatch = code.match(/<head[^>]*>([\s\S]*?)<\/head>/i)
  const headContent = headMatch ? headMatch[1] : ''

  // Extract content from <body>...</body>
  const bodyMatch = code.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const bodyContent = bodyMatch ? bodyMatch[1] : code.replace(/<\/?(?:html|head|body|!doctype)[^>]*>/gi, '')

  return { headContent, bodyContent }
}

/**
 * Build a full HTML document string that wraps the user's code with
 * theme variables, bridge scripts, and auto-resize logic.
 */
function buildDocument(code: string): string {
  const themeVars = getThemeVariables()
  const { headContent, bodyContent } = extractBodyContent(code)

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
    overflow-x: hidden;
    overflow-y: auto;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: transparent;
    color: inherit;
    max-width: 100%;
  }
  body { padding: 8px; }
  /* Prevent any child from overflowing */
  body > * { max-width: 100%; overflow-x: auto; }
  /* Entrance animation — subtle fly-in for progressive rendering */
  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  body > * { animation: fadeSlideIn 0.3s ease-out both; }
  body > *:nth-child(2) { animation-delay: 0.05s; }
  body > *:nth-child(3) { animation-delay: 0.1s; }
  body > *:nth-child(4) { animation-delay: 0.15s; }
  body > *:nth-child(5) { animation-delay: 0.2s; }
  body > *:nth-child(6) { animation-delay: 0.25s; }
  svg > g { animation: fadeSlideIn 0.3s ease-out both; }
  svg > g:nth-child(2) { animation-delay: 0.05s; }
  svg > g:nth-child(3) { animation-delay: 0.1s; }
  svg > g:nth-child(4) { animation-delay: 0.15s; }
  svg > g:nth-child(5) { animation-delay: 0.2s; }
  svg > g:nth-child(6) { animation-delay: 0.25s; }
</style>
${headContent}
</head>
<body>
${bodyContent}
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
  onOpenLink,
  className,
  style,
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

  // Listen for postMessage events from the iframe.
  // Only accept messages from our own iframe's contentWindow to prevent
  // spoofing from other iframes or cross-origin scripts.
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Validate message source matches our iframe
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      if (!event.data || typeof event.data !== "object") return

      switch (event.data.type) {
        case "visualise:resize":
          if (typeof event.data.height === "number" && event.data.height > 0) {
            setIframeHeight(Math.min(event.data.height, MAX_IFRAME_HEIGHT))
          }
          break
        case "visualise:sendPrompt":
          if (typeof event.data.text === "string" && onSendPrompt) {
            onSendPrompt(event.data.text)
          }
          break
        case "visualise:openLink":
          if (typeof event.data.url === "string") {
            const url = event.data.url
            // Only allow http(s) URLs to prevent javascript: / data: attacks
            if (url.startsWith("https://") || url.startsWith("http://")) {
              if (onOpenLink) {
                onOpenLink(url)
              } else {
                window.open(url, "_blank", "noopener,noreferrer")
              }
            }
          }
          break
      }
    },
    [onSendPrompt, onOpenLink]
  )

  useEffect(() => {
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [handleMessage])

  if (!blobUrl) return null

  return (
    <div className={cn("w-full overflow-hidden rounded-lg border border-border/40", className)} style={style}>
      <iframe
        ref={iframeRef}
        src={blobUrl}
        sandbox="allow-scripts"
        className="w-full border-0"
        style={{ height: `${iframeHeight}px`, maxHeight: `${MAX_IFRAME_HEIGHT}px` }}
        title="Visual widget"
      />
    </div>
  )
}
