import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
  pluginId?: string
}

interface State {
  hasError: boolean
  error?: Error
}

/**
 * Error boundary for plugin-contributed React components.
 * Isolates plugin rendering failures from the rest of the app.
 */
export class PluginErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `[PluginErrorBoundary] Plugin "${this.props.pluginId || "unknown"}" crashed:`,
      error,
      errorInfo.componentStack
    )
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-sm font-medium text-destructive">Plugin Error</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {this.props.pluginId
              ? `Plugin "${this.props.pluginId}" encountered an error`
              : "A plugin encountered an error"}
          </p>
          {this.state.error && (
            <p className="mt-2 max-w-md text-xs text-muted-foreground font-mono">
              {this.state.error.message}
            </p>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
