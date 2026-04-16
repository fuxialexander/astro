/**
 * File browser pane — wraps the desktop FileBrowser. `cwd` is read from
 * pane state; if absent the FileBrowser shows its empty state.
 */
import { useRef } from 'react'

import { FileBrowser } from '@/components/desktop/FileBrowser'
import { usePaneSize } from '../use-pane-size'
import type { PaneState } from '../types'

interface Props {
  paneState: PaneState
}

export function FileBrowserPane({ paneState }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = usePaneSize(ref)

  return (
    <div ref={ref} className="h-full w-full" data-density={size.density}>
      <FileBrowser rootPath={paneState.cwd ?? null} />
    </div>
  )
}
