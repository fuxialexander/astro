/**
 * Git pane — wraps the desktop GitChangesPanel for a project repo.
 */
import { useRef } from 'react'

import { GitChangesPanel } from '@/components/desktop/GitChangesPanel'
import { usePaneSize } from '../use-pane-size'
import type { PaneState } from '../types'

interface Props {
  paneState: PaneState
}

export function GitPane({ paneState }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = usePaneSize(ref)

  return (
    <div ref={ref} className="h-full w-full" data-density={size.density}>
      <GitChangesPanel repoPath={paneState.cwd ?? null} />
    </div>
  )
}
