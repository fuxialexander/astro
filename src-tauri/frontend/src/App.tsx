import { Component, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { WorkspaceLayout } from '@desktop/components/layout/WorkspaceLayout'
import { Workspace } from '@desktop/pages/Workspace'
import { InboxHome } from '@/pages/inbox-home'
import { ActiveTasks } from '@desktop/pages/ActiveTasks'
import { Environments } from '@desktop/pages/Environments'
import { setBaseUrl } from '@desktop/lib/api-client'

// Web-app stores that need bootstrapping
import { useProjectStore } from '@/stores/project-store'
import { usePlanStore } from '@/stores/plan-store'
import { useExecutionStore } from '@/stores/execution-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useActivityStore } from '@/stores/activity-store'
import { useExampleStore } from '@/stores/example-store'

// Connect to the configured backend.
// In dev mode, Vite proxies /api → localhost:4001, so use empty base (relative URLs).
// In production (Tauri webview with file:// protocol), use the configured URL.
const savedUrl = localStorage.getItem('astro-desktop-api-url')
const isDev = import.meta.env.DEV
setBaseUrl(savedUrl ?? (isDev ? '' : 'http://localhost:4001'))

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
 * Bootstrap web-app stores that InboxHome and other shared components depend on.
 * The web app does this in its own App.tsx; we replicate it here for the Tauri shell.
 */
function DataBootstrap({ children }: { children: ReactNode }) {
  const projectsLoaded = useProjectStore((s) => s.loaded)
  const loadProjects = useProjectStore((s) => s.load)
  const planLoaded = usePlanStore((s) => s.loaded)
  const loadPlan = usePlanStore((s) => s.load)
  const executionsLoaded = useExecutionStore((s) => s.loaded)
  const loadExecutions = useExecutionStore((s) => s.load)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const loadSettings = useSettingsStore((s) => s.load)
  const activitiesLoaded = useActivityStore((s) => s.loaded)
  const loadActivities = useActivityStore((s) => s.loadActivities)
  const examplesLoaded = useExampleStore((s) => s.loaded)
  const loadExamples = useExampleStore((s) => s.load)

  useEffect(() => {
    if (!projectsLoaded) loadProjects()
    if (!planLoaded) loadPlan()
    if (!executionsLoaded) loadExecutions()
    if (!settingsLoaded) loadSettings()
    if (!activitiesLoaded) loadActivities()
    if (!examplesLoaded) loadExamples()
  }, [
    projectsLoaded, loadProjects,
    planLoaded, loadPlan,
    executionsLoaded, loadExecutions,
    settingsLoaded, loadSettings,
    activitiesLoaded, loadActivities,
    examplesLoaded, loadExamples,
  ])

  return <>{children}</>
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
          <DataBootstrap>
            <Routes>
              <Route element={<WorkspaceLayout />}>
                <Route index element={<InboxHome />} />
                <Route path="/active" element={<ActiveTasks />} />
                <Route path="/environments" element={<Environments />} />
                <Route path="/project/:id" element={<Workspace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </DataBootstrap>
        </ErrorBoundary>
      </div>
    </BrowserRouter>
  )
}
