/**
 * Pane system types. The pane host is dockview-backed but the kinds and
 * state shapes are defined here so non-dockview consumers (detached windows,
 * persistence, codegen) don't have to import dockview directly.
 */

/** All built-in pane kinds. Plugin-contributed kinds extend this at runtime. */
export type PaneKind =
  // Phase 3A — desktop-only
  | 'terminal'
  | 'file-browser'
  | 'git'
  | 'reference'
  // Phase 3B — wraps existing src/ views
  | 'chat'
  | 'plan-graph'
  | 'task-execution'
  // Phase 4 — plugin contribution
  | 'plugin'

/** Per-pane persisted state. Each kind picks the fields it cares about. */
export interface PaneState {
  /** Project the pane is bound to. Most kinds need this. */
  projectId?: string
  /** Working directory for terminal/file-browser/git panes. */
  cwd?: string
  /** Reference id for the PDF/reference pane. */
  referenceId?: string
  /** Plugin id for plugin-contributed panes. */
  pluginId?: string
  /** Free-form extras for kinds that need them. */
  extras?: Record<string, unknown>
}

/** Snapshot of the entire dockview layout — stored in pane-store. */
export interface PaneLayoutSnapshot {
  /** Schema version — bump when the dockview JSON shape changes. */
  version: number
  /** Raw dockview `api.toJSON()` payload. */
  layout: unknown
}

/** Density bands derived from a pane's measured size. */
export type PaneDensity = 'compact' | 'comfortable' | 'spacious'
