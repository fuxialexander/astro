import { Component, useCallback, useState, type ReactNode } from "react"
import { Maximize2, Minimize2, Copy, Check, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { VisualWidget } from "./visual-widget"
import { useVisualiseEmbed } from "@/hooks/use-visualise-embed"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "./dialog"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisualiseEmbedProps {
  /** Raw HTML/SVG/JS content to render */
  html: string
  /** Accessible title for the iframe */
  title?: string
  /** Optional max height in px (default 600) */
  maxHeight?: number
  /** Additional CSS classes */
  className?: string
  /** Callback for sendPrompt bridge */
  onSendPrompt?: (text: string) => void
  /** Callback for openLink bridge (default: window.open) */
  onOpenLink?: (url: string) => void
}

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  fallback: (error: Error) => ReactNode
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

class VisualiseErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error)
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// Error Fallback
// ---------------------------------------------------------------------------

function ErrorFallback({ error, code }: { error: Error; code: string }) {
  const [showCode, setShowCode] = useState(false)

  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span>Visualizer failed to render</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
      <button
        onClick={() => setShowCode(!showCode)}
        className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
      >
        {showCode ? "Hide source" : "Show source"}
      </button>
      {showCode && (
        <pre className="mt-2 max-h-60 overflow-auto rounded bg-muted p-3 text-xs">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton({ maxHeight }: { maxHeight: number }) {
  return (
    <div
      className="animate-pulse rounded-lg bg-muted"
      style={{ height: Math.min(200, maxHeight) }}
    />
  )
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({
  title,
  isCopied,
  isFullscreen,
  onCopy,
  onToggleFullscreen,
}: {
  title?: string
  isCopied: boolean
  isFullscreen: boolean
  onCopy: () => void
  onToggleFullscreen: () => void
}) {
  return (
    <div className="flex items-center justify-between rounded-t-lg border border-b-0 bg-muted/50 px-3 py-1.5">
      <span className="truncate text-xs font-medium text-muted-foreground">
        {title || "Visualizer"}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={onCopy}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Copy source"
        >
          {isCopied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={onToggleFullscreen}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// VisualiseEmbed Component
// ---------------------------------------------------------------------------

export function VisualiseEmbed({
  html,
  title,
  maxHeight = 600,
  className,
  onSendPrompt,
  onOpenLink,
}: VisualiseEmbedProps) {
  const {
    isFullscreen,
    isCopied,
    isLoaded,
    toggleFullscreen,
    closeFullscreen,
    copySource,
  } = useVisualiseEmbed(html)

  const handleSendPrompt = useCallback(
    (text: string) => {
      onSendPrompt?.(text)
    },
    [onSendPrompt]
  )

  if (!html) return null

  const widgetElement = (
    <VisualWidget
      code={html}
      isStreaming={false}
      onSendPrompt={handleSendPrompt}
      onOpenLink={onOpenLink}
      className={cn("rounded-b-lg border")}
      style={!isFullscreen ? { maxHeight: `${maxHeight}px` } : undefined}
    />
  )

  const errorFallback = (error: Error) => (
    <ErrorFallback error={error} code={html} />
  )

  return (
    <div className={cn("overflow-hidden", className)}>
      {/* Inline view */}
      <Toolbar
        title={title}
        isCopied={isCopied}
        isFullscreen={isFullscreen}
        onCopy={copySource}
        onToggleFullscreen={toggleFullscreen}
      />

      {!isLoaded && <LoadingSkeleton maxHeight={maxHeight} />}

      <div className={cn(!isLoaded && "hidden")}>
        <VisualiseErrorBoundary fallback={errorFallback}>
          {widgetElement}
        </VisualiseErrorBoundary>
      </div>

      {/* Fullscreen dialog */}
      <Dialog open={isFullscreen} onOpenChange={(open) => !open && closeFullscreen()}>
        <DialogContent className="max-w-[90vw] h-[90vh] flex flex-col p-0 gap-0">
          <DialogTitle className="sr-only">{title || "Visualizer"}</DialogTitle>
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-medium">
              {title || "Visualizer"}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={copySource}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Copy source"
              >
                {isCopied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={closeFullscreen}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Exit fullscreen"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2">
            <VisualiseErrorBoundary fallback={errorFallback}>
              <VisualWidget
                code={html}
                isStreaming={false}
                onSendPrompt={handleSendPrompt}
                onOpenLink={onOpenLink}
                className="h-full min-h-[80vh]"
              />
            </VisualiseErrorBoundary>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
