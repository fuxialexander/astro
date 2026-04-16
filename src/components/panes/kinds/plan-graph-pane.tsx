/**
 * Plan graph pane — embeds the existing `/project/:id/graph` route via an
 * iframe so the React Flow tree, layout engine, and route-driven view-mode
 * switching all work without re-plumbing them as standalone components.
 *
 * Iframe isolation is intentional: the parent and child share the same
 * Zustand stores via the SPA's data layer (server SSE + dataClient), so
 * state stays in sync across panes. A cleaner React-native embed is a
 * later cleanup if/when PlanView is decoupled from `useParams()`.
 */
import { useRef } from 'react'

import { usePaneSize } from '../use-pane-size'
import type { PaneState } from '../types'

interface Props {
  paneState: PaneState
}

export function PlanGraphPane({ paneState }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = usePaneSize(ref)

  if (!paneState.projectId) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        No project bound to this pane
      </div>
    )
  }

  return (
    <div ref={ref} className="h-full w-full" data-density={size.density}>
      <iframe
        src={`/project/${paneState.projectId}/graph?embedded=1`}
        title="Plan graph"
        className="h-full w-full border-0 bg-background"
      />
    </div>
  )
}
