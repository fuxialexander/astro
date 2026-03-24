import { useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { WorkspaceLayout } from '@desktop/components/layout/WorkspaceLayout'
import { Workspace } from '@desktop/pages/Workspace'
import { WelcomePane } from '@desktop/pages/WelcomePane'
import { SplashScreen } from '@desktop/components/common/SplashScreen'
import { useSidecar } from '@desktop/hooks/use-sidecar'

/**
 * Application router with sidecar readiness gate.
 *
 * Shows a splash screen while the sidecar agent starts up.
 * Once ready, fades into the workspace shell.
 *
 * WorkspaceLayout is the top-level shell for all routes:
 *   /              → Welcome pane (sidebar shows projects)
 *   /project/:id   → Project workspace
 */
export function App() {
  const { ready, error } = useSidecar()
  const [splashDismissed, setSplashDismissed] = useState(false)

  const handleFadeComplete = useCallback(() => {
    setSplashDismissed(true)
  }, [])

  return (
    <BrowserRouter>
      <div className="h-screen w-screen bg-background text-foreground font-primary overflow-hidden">
        {/* Splash screen overlay — shown until sidecar is ready */}
        {!splashDismissed && (
          <SplashScreen
            ready={ready}
            error={error}
            onFadeComplete={handleFadeComplete}
          />
        )}

        {/* Main app — rendered immediately but behind splash */}
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
