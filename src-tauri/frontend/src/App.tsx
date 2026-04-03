import { Component, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { WorkspaceLayout } from '@desktop/components/layout/WorkspaceLayout'
import { Workspace } from '@desktop/pages/Workspace'
import { InboxHome } from '@/pages/inbox-home'
import { ActiveTasks } from '@desktop/pages/ActiveTasks'
import { Environments } from '@desktop/pages/Environments'
import { setBaseUrl } from '@desktop/lib/api-client'

// Connect to the configured backend — localStorage override or production default.
const savedUrl = localStorage.getItem('astro-desktop-api-url')
setBaseUrl(savedUrl ?? 'http://localhost:3001')

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-sm font-mono overflow-auto h-full">
          <p className="text-red-500 font-bold mb-2">React error — please report this</p>
          <p className="text-red-400 mb-4">{this.state.error.message}</p>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{this.state.error.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * WorkspaceLayout is the top-level shell for all routes:
 *   /              → Welcome pane (sidebar shows projects)
 *   /project/:id   → Project workspace
 */
export function App() {
  return (
    <BrowserRouter>
      <div className="h-screen w-screen bg-background text-foreground font-primary overflow-hidden">
        <ErrorBoundary>
          <Routes>
            <Route element={<WorkspaceLayout />}>
              <Route index element={<InboxHome />} />
              <Route path="/active" element={<ActiveTasks />} />
              <Route path="/environments" element={<Environments />} />
              <Route path="/project/:id" element={<Workspace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ErrorBoundary>
      </div>
    </BrowserRouter>
  )
}
