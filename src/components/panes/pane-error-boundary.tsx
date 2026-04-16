import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  paneKind: string
  onReload?: () => void
}

interface State {
  hasError: boolean
  error?: Error
}

/**
 * Error boundary for individual pane kinds. A crash in one pane (bad data
 * from the store, null reference, lazy chunk failure) must not unmount the
 * whole PaneHost.
 */
export class PaneErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `[PaneErrorBoundary] Pane "${this.props.paneKind}" crashed:`,
      error,
      errorInfo.componentStack,
    )
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: undefined })
    this.props.onReload?.()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-sm font-medium text-destructive">Pane crashed</p>
        <p className="text-xs text-muted-foreground">
          The {this.props.paneKind} pane encountered an error.
        </p>
        {this.state.error && (
          <p className="max-w-md font-mono text-xs text-muted-foreground">
            {this.state.error.message}
          </p>
        )}
        <button
          type="button"
          onClick={this.handleReload}
          className="mt-2 rounded-md border border-border bg-background px-3 py-1 text-xs hover:bg-accent"
        >
          Reload pane
        </button>
      </div>
    )
  }
}
