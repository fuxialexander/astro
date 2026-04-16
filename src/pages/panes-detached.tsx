/**
 * Detached pane page.
 *
 * Rendered in a dedicated BrowserWindow spawned by the main process when a
 * user drags a pane tab out of the dockview host. The page reads the pane
 * kind and base64-encoded state from the query string and renders a single
 * pane full-viewport — no sidebar, no dockview wrapper, no DataLoader.
 *
 * This is entered via a short-circuit in src/main.tsx when the URL carries
 * `?astroDetached=1`, so it bypasses the normal React Router tree.
 */
import { Suspense } from 'react'

import { paneComponents, isKnownPaneKind } from '@/components/panes/pane-registry'
import type { PaneState } from '@/components/panes/types'

interface DecodedState {
  id: string
  title: string
  state: PaneState
}

function decodeState(raw: string | null): DecodedState | null {
  if (!raw) return null
  try {
    const json = atob(raw)
    return JSON.parse(json) as DecodedState
  } catch {
    return null
  }
}

// Parse URL params once at module scope — the detached window never
// navigates, so recomputing per-render would just churn React Compiler's
// memoization heuristics.
const params = new URLSearchParams(window.location.search)
const paneKindFromUrl = params.get('kind') ?? ''
const decodedFromUrl = decodeState(params.get('state'))

export function PanesDetachedPage() {
  const kind = paneKindFromUrl
  const decoded = decodedFromUrl

  if (!isKnownPaneKind(kind)) {
    return (
      <div className="flex h-dvh w-dvw items-center justify-center bg-background text-sm text-muted-foreground">
        Unknown pane kind: {kind || '(none)'}
      </div>
    )
  }

  const Comp = paneComponents[kind]
  // The registry wraps components so dockview can call them with IDockviewPanelProps.
  // For the detached window we synthesize the minimum shape the wrapper uses:
  // it only reads `params` as PaneState, so a cast here is safe and keeps
  // the registry the single source of truth for rendering.
  const fakePanelProps = {
    params: decoded?.state ?? ({} as PaneState),
    api: undefined,
    containerApi: undefined,
  } as unknown as Parameters<typeof Comp>[0]

  return (
    <div className="h-dvh w-dvw bg-background">
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            Loading…
          </div>
        }
      >
        <Comp {...fakePanelProps} />
      </Suspense>
    </div>
  )
}
