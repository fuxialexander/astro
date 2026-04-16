/**
 * Terminal pane — wraps the desktop TerminalTab in a single-active container.
 * The pane is always considered active while mounted; dockview hides
 * inactive tabs at the DOM level so the inner `active` flag is true.
 */
import { useRef } from 'react'

import { TerminalTab } from '@/components/desktop/TerminalTab'
import { usePaneSize } from '../use-pane-size'
import type { PaneState } from '../types'

interface Props {
  paneState: PaneState
}

export function TerminalPane({ paneState }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = usePaneSize(ref)
  const cwd = paneState.cwd ?? '.'

  return (
    <div ref={ref} className="h-full w-full" data-density={size.density}>
      <TerminalTab cwd={cwd} active />
    </div>
  )
}
