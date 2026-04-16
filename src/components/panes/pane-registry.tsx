/**
 * Pane registry — maps a `PaneKind` to the React component that renders it.
 *
 * Dockview wants `Record<string, FC<IDockviewPanelProps>>`, and each panel
 * receives `params` we use to thread `PaneState` through. Components are
 * lazy so a pane kind that pulls in heavy deps (e.g. xterm) only loads
 * when a tab of that kind is mounted for the first time.
 */
/* eslint-disable react-refresh/only-export-components */
import { lazy, Suspense, type ComponentType, type FunctionComponent } from 'react'
import type { IDockviewPanelProps } from 'dockview'

import type { PaneKind, PaneState } from './types'

const TerminalPane = lazy(() =>
  import('./kinds/terminal-pane').then((m) => ({ default: m.TerminalPane })),
)
const FileBrowserPane = lazy(() =>
  import('./kinds/file-browser-pane').then((m) => ({ default: m.FileBrowserPane })),
)
const GitPane = lazy(() =>
  import('./kinds/git-pane').then((m) => ({ default: m.GitPane })),
)
const ReferencePane = lazy(() =>
  import('./kinds/reference-pane').then((m) => ({ default: m.ReferencePane })),
)
const ChatPane = lazy(() =>
  import('./kinds/chat-pane').then((m) => ({ default: m.ChatPane })),
)
const PlanGraphPane = lazy(() =>
  import('./kinds/plan-graph-pane').then((m) => ({ default: m.PlanGraphPane })),
)
const TaskExecutionPane = lazy(() =>
  import('./kinds/task-execution-pane').then((m) => ({ default: m.TaskExecutionPane })),
)
const PluginPane = lazy(() =>
  import('./kinds/plugin-pane').then((m) => ({ default: m.PluginPane })),
)

function PanePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
      {label}
    </div>
  )
}

/** Wrap a lazy pane component so dockview gets a stable function component. */
function panel(
  Inner: ComponentType<{ paneState: PaneState }>,
): FunctionComponent<IDockviewPanelProps> {
  return function PaneWrapper(props: IDockviewPanelProps) {
    const paneState = (props.params ?? {}) as PaneState
    return (
      <Suspense fallback={<PanePlaceholder label="Loading…" />}>
        <Inner paneState={paneState} />
      </Suspense>
    )
  }
}

/**
 * Phase 3A registry. Phase 3B will add chat / plan-graph / task-execution.
 * Anything not yet implemented renders a placeholder so the layout JSON
 * round-trips even if a kind is referenced before its component lands.
 */
export const paneComponents: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  terminal: panel(TerminalPane),
  'file-browser': panel(FileBrowserPane),
  git: panel(GitPane),
  reference: panel(ReferencePane),
  chat: panel(ChatPane),
  'plan-graph': panel(PlanGraphPane),
  'task-execution': panel(TaskExecutionPane),
  plugin: panel(PluginPane),
}

/**
 * Direct-render components for non-dockview consumers (e.g. PanelStack).
 * Each component takes `{ paneState }` directly and should be wrapped in
 * `<Suspense>` by the caller.
 */
export const paneInnerComponents: Record<PaneKind, ComponentType<{ paneState: PaneState }>> = {
  terminal: TerminalPane,
  'file-browser': FileBrowserPane,
  git: GitPane,
  reference: ReferencePane,
  chat: ChatPane,
  'plan-graph': PlanGraphPane,
  'task-execution': TaskExecutionPane,
  plugin: PluginPane,
}

export function isKnownPaneKind(kind: string): kind is PaneKind {
  return kind in paneComponents
}
