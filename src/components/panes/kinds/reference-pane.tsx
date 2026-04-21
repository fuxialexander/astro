/**
 * Reference pane — minimal PDF viewer for a single Reference.
 *
 * Phase 3A scope: load the PDF URL via `getPdfViewUrl()` and render in an
 * `<iframe>`. The full reference viewer (annotations, highlights, citation
 * jump-to) is Phase 3B. This is the placeholder that lets us round-trip the
 * pane kind through dockview persistence today.
 */
import { useMemo, useRef } from 'react'

import { useReferenceStore } from '@/stores/reference-store'
import { getPdfViewUrl } from '@/lib/pdf-downloader'
import { usePaneSize } from '../use-pane-size'
import type { PaneState } from '../types'

interface Props {
  paneState: PaneState
}

export function ReferencePane({ paneState }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = usePaneSize(ref)

  const reference = useReferenceStore((s) => {
    if (!paneState.referenceId) return undefined
    return s.library.find((r) => r.id === paneState.referenceId)
  })

  const url = useMemo(() => (reference ? getPdfViewUrl(reference) : null), [reference])

  return (
    <div ref={ref} className="h-full w-full flex flex-col" data-density={size.density}>
      {!reference ? (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
          No reference selected
        </div>
      ) : !url ? (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
          PDF not available for {reference.title ?? 'this reference'}
        </div>
      ) : (
        <iframe
          src={url}
          title={reference.title ?? 'PDF'}
          className="flex-1 w-full border-0 bg-background"
        />
      )}
    </div>
  )
}
