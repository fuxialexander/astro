/**
 * /panes — desktop-only multi-pane workspace.
 *
 * Renders the dockview-backed `PaneHost` full-screen with a sensible default
 * layout: a chat pane, a plan-graph pane, and a file-browser pane for the
 * user's most recently opened project. The web build redirects this route
 * to /dashboard since dockview detach + native panes aren't useful in a tab.
 */
import { Navigate } from 'react-router'

import { isDesktop } from '@/lib/desktop-detect'
import { PaneHost } from '@/components/panes/PaneHost'
import { getDefaultPanes } from '@/components/panes/default-panes'
import { useProjectStore } from '@/stores/project-store'

export function PanesPage() {
  const project = useProjectStore((s) => s.projects[0])

  if (!isDesktop()) {
    return <Navigate to="/dashboard" replace />
  }

  return <PaneHost defaultPanes={getDefaultPanes(project)} />
}
