/**
 * PanelStack — floating vertical stack of closeable panel cards.
 *
 * Replaces the dockview split/tab layout on the right side of AppLayout
 * with a simpler, Claude Code-style stack: each active panel renders as
 * an independent rounded card with its own compact header (icon, title,
 * X close button), and panels share remaining vertical space via flex-1.
 */
import { Suspense, useMemo } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore, type RightPanelKind } from '@/stores/ui-store'
import type { Project } from '@/types'
import { paneInnerComponents } from './pane-registry'
import { PANEL_META } from './panel-meta'
import type { PaneState } from './types'
import { getProjectFileBrowserRoot } from '@/components/task-detail/file-path-utils'

interface PanelStackProps {
  project: Project | undefined
  className?: string
}

function buildPaneState(kind: RightPanelKind, project: Project | undefined): PaneState {
  if (!project) return {}
  switch (kind) {
    case 'chat':
    case 'plan-graph':
      return { projectId: project.id }
    case 'file-browser':
    case 'git':
    case 'terminal':
      return {
        projectId: project.id,
        cwd: kind === 'file-browser'
          ? getProjectFileBrowserRoot(project)
          : project.workingDirectory ?? undefined,
      }
  }
}

function PanelCard({
  kind,
  project,
  onClose,
}: {
  kind: RightPanelKind
  project: Project | undefined
  onClose: () => void
}) {
  const meta = PANEL_META[kind]!
  const Inner = paneInnerComponents[kind]
  const paneState = useMemo(() => buildPaneState(kind, project), [kind, project])

  return (
    <section
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden',
        'rounded-lg bg-background desktop-panel-card',
        'shadow-[0_0_6px_-2px_rgba(0,0,0,0.16),0_0_18px_-10px_rgba(0,0,0,0.16)]',
        'dark:shadow-[0_0_6px_-2px_rgba(0,0,0,0.65),0_0_18px_-10px_rgba(0,0,0,0.65)]',
      )}
    >
      {/* Header */}
      <header
        className={cn(
          'flex h-8 shrink-0 items-center gap-2',
          'px-2.5 bg-background desktop-panel-card-header rounded-t-lg',
        )}
      >
        <meta.Icon className="h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={2} />
        <h3 className="flex-1 truncate text-[11px] font-medium tracking-wide text-foreground">
          {meta.label}
        </h3>
        <button
          onClick={onClose}
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded',
            'text-muted-foreground/60 hover:text-foreground hover:bg-muted',
            'transition-colors',
          )}
          title={`Close ${meta.label}`}
        >
          <X className="h-2.5 w-2.5" strokeWidth={2.5} />
        </button>
      </header>

      {/* Content — `relative` + absolute inner ensures the pane fills the
          flex cell with an *explicit* pixel height, which xterm/ResizeObserver
          based children (TerminalPane, PlanGraphPane, etc.) require to render. */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div className="absolute inset-0">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                Loading…
              </div>
            }
          >
            <Inner paneState={paneState} />
          </Suspense>
        </div>
      </div>
    </section>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="h-8 w-8 rounded-md border border-dashed border-border/60" />
      <p className="text-[11px] text-muted-foreground">
        No panels open. Use the panel menu to add Chat, Plan, Files, Diff, or Terminal.
      </p>
    </div>
  )
}

export function PanelStack({ project, className }: PanelStackProps) {
  const stack = useUIStore((s) => s.rightPanelStack)
  const closeRightPanel = useUIStore((s) => s.closeRightPanel)

  if (stack.length === 0) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <EmptyState />
      </div>
    )
  }

  return (
    <div
      className={cn(
        // `overflow-visible` lets each card's drop shadow extend past the
        // column's edges instead of being clipped into a hard gray rectangle
        // that reads as a split line.
        'flex h-full min-h-0 flex-col gap-3 pr-3 pt-3',
        className,
      )}
    >
      {stack.map((kind) => (
        <PanelCard
          key={kind}
          kind={kind}
          project={project}
          onClose={() => closeRightPanel(kind)}
        />
      ))}
    </div>
  )
}
