/**
 * Task execution pane — embeds the existing task detail route. Each pane
 * gets its own scrollable execution feed, so N concurrent agents = N panes
 * with independent streams. State remains shared via the global SSE bus
 * + activity store, so nothing diverges between embedded views.
 */
import { useRef } from 'react'

import { usePaneSize } from '../use-pane-size'
import type { PaneState } from '../types'

interface Props {
  paneState: PaneState
}

export function TaskExecutionPane({ paneState }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = usePaneSize(ref)
  const nodeId = paneState.extras?.nodeId as string | undefined

  if (!paneState.projectId || !nodeId) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Pane needs both a projectId and an extras.nodeId
      </div>
    )
  }

  return (
    <div ref={ref} className="h-full w-full" data-density={size.density}>
      <iframe
        src={`/project/${paneState.projectId}/task/${nodeId}?embedded=1`}
        title="Task execution"
        className="h-full w-full border-0 bg-background"
      />
    </div>
  )
}
