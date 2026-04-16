/**
 * Chat pane — wraps the existing ChatPanel for a given project. The pane
 * state must carry `projectId`; the rest of the chat plumbing (vision doc,
 * stores, streaming) is unchanged from the page-level usage.
 */
import { useRef } from 'react'

import { ChatPanel } from '@/components/agent/chat-panel'
import { useProjectStore } from '@/stores/project-store'
import { usePaneSize } from '../use-pane-size'
import type { PaneState } from '../types'

interface Props {
  paneState: PaneState
}

export function ChatPane({ paneState }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = usePaneSize(ref)
  const project = useProjectStore((s) =>
    paneState.projectId ? s.projects.find((p) => p.id === paneState.projectId) : undefined,
  )

  if (!paneState.projectId) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        No project bound to this pane
      </div>
    )
  }

  return (
    <div ref={ref} className="h-full w-full" data-density={size.density}>
      <ChatPanel
        projectId={paneState.projectId}
        visionDoc={project?.visionDoc}
        compact={size.density === 'compact'}
      />
    </div>
  )
}
