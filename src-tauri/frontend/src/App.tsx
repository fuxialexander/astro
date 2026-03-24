import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { WorkspaceLayout } from '@desktop/components/layout/WorkspaceLayout'
import { Workspace } from '@desktop/pages/Workspace'
import { WelcomePane } from '@desktop/pages/WelcomePane'

/**
 * Application router.
 *
 * WorkspaceLayout is the top-level shell for all routes:
 *   /              → Welcome pane (sidebar shows projects)
 *   /project/:id   → Project workspace
 *
 * The sidebar always renders inside WorkspaceLayout and shows the full
 * project list — so ProjectList as a standalone page is no longer needed.
 */
export function App() {
  return (
    <BrowserRouter>
      <div className="h-screen w-screen bg-background text-foreground font-primary overflow-hidden">
        <Routes>
          {/* Layout route — WorkspaceLayout renders <Outlet /> in main panel */}
          <Route element={<WorkspaceLayout />}>
            <Route index element={<WelcomePane />} />
            <Route path="/project/:id" element={<Workspace />} />
            {/* Catch-all → home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  )
}
