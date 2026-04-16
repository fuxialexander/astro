/**
 * PaneHost — root dockview shell.
 *
 * Wraps `DockviewReact` with our pane component registry, restores the saved
 * layout from `pane-store`, and persists every change back. The host is
 * intentionally dumb about pane *contents* — kinds register themselves via
 * `pane-registry` and receive their `PaneState` through dockview `params`.
 *
 * Detach support is wired via `onWillDragPanel` → `windows.detachPane`, but
 * only when running in the desktop shell. The browser fallback just keeps
 * everything inline — no detach UI, no broken IPC calls.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent } from 'dockview'
import 'dockview/dist/styles/dockview.css'
import './dockview-overrides.css'

import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge } from '@/lib/desktop-bridge'
import { usePaneStore } from '@/stores/pane-store'

import { paneComponents } from './pane-registry'
import { PaneTab } from './pane-tab'
import type { PaneKind, PaneState } from './types'

const paneTabComponents = { default: PaneTab }

export interface InitialPane {
  id: string
  title: string
  kind: PaneKind
  state?: PaneState
}

export interface PaneHostProps {
  /** Default panes opened on first run (when no saved snapshot exists). */
  defaultPanes?: InitialPane[]
  className?: string
  onApiReady?: (api: DockviewApi | null) => void
}

function applyDefaultLayout(api: DockviewApi, panes: InitialPane[]) {
  for (const p of panes) {
    api.addPanel({
      id: p.id,
      component: p.kind,
      title: p.title,
      params: (p.state ?? {}) as Record<string, unknown>,
    })
  }
}

export const PaneHost = memo(function PaneHost({ defaultPanes = [], className, onApiReady }: PaneHostProps) {
  const apiRef = useRef<DockviewApi | null>(null)
  const snapshot = usePaneStore((s) => s.snapshot)
  const saveSnapshot = usePaneStore((s) => s.saveSnapshot)
  const [dockviewThemeClass, setDockviewThemeClass] = useState<'dockview-theme-light' | 'dockview-theme-dark'>(() => {
    if (typeof document === 'undefined') return 'dockview-theme-light'
    return document.documentElement.classList.contains('dark')
      ? 'dockview-theme-dark'
      : 'dockview-theme-light'
  })

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api
      onApiReady?.(event.api)

      // Restore layout if we have one, otherwise seed with defaults.
      if (snapshot?.layout) {
        try {
          event.api.fromJSON(snapshot.layout as Parameters<DockviewApi['fromJSON']>[0])
        } catch {
          applyDefaultLayout(event.api, defaultPanes)
        }
      } else {
        applyDefaultLayout(event.api, defaultPanes)
      }

      // Persist on any layout change. Dockview fires this for tab moves,
      // splits, closes, renames, focus changes — all the things we want.
      const disposable = event.api.onDidLayoutChange(() => {
        try {
          saveSnapshot(event.api.toJSON())
        } catch {
          // ignore — next change will retry
        }
      })

      return () => disposable.dispose()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onApiReady],
  )

  useEffect(() => {
    return () => onApiReady?.(null)
  }, [onApiReady])

  useEffect(() => {
    if (typeof document === 'undefined') return

    const root = document.documentElement
    const updateTheme = () => {
      setDockviewThemeClass(
        root.classList.contains('dark') ? 'dockview-theme-dark' : 'dockview-theme-light',
      )
    }

    updateTheme()

    const observer = new MutationObserver(updateTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })

    return () => observer.disconnect()
  }, [])

  // Detach-pane wiring (desktop only). When dockview signals an external
  // drop, hand off to the Electron windows channel.
  useEffect(() => {
    if (!isDesktop()) return
    const api = apiRef.current
    if (!api) return

    const sub = api.onDidDrop((evt) => {
      // Only handle drops outside the host. Internal drops are layout
      // moves that dockview already handles for us.
      if (evt.api) return
      const panel = evt.panel
      if (!panel) return
      const paneKind = panel.view.contentComponent ?? 'unknown'
      void desktopBridge.windows
        .detachPane({
          paneKind,
          paneId: panel.id,
          paneTitle: panel.title ?? paneKind,
          paneState: panel.params ?? {},
        })
        .then(() => {
          // Remove the panel from the sending dockview so the pane only
          // lives in its new detached window.
          try {
            api.removePanel(panel)
          } catch {
            // panel may already be gone if dockview cleaned it up on drop
          }
        })
    })

    return () => sub.dispose()
  }, [])

  return (
    <div className={className ?? 'h-full w-full'}>
      <DockviewReact
        components={paneComponents}
        tabComponents={paneTabComponents}
        onReady={onReady}
        className={`${dockviewThemeClass} h-full w-full`}
      />
    </div>
  )
})
