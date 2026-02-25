/**
 * Status → terminal color mapping.
 * Returns Ink-compatible color strings.
 */

export type StatusColor = 'green' | 'blue' | 'yellow' | 'cyan' | 'red' | 'magenta' | 'gray' | 'white'

const STATUS_COLOR_MAP: Record<string, StatusColor> = {
  // Project statuses
  active: 'green',
  archived: 'gray',

  // Plan node statuses
  planned: 'yellow',
  dispatched: 'cyan',
  in_progress: 'cyan',
  auto_verified: 'green',
  awaiting_approval: 'magenta',
  awaiting_judgment: 'magenta',
  completed: 'blue',
  pruned: 'gray',

  // Execution statuses
  pending: 'yellow',
  running: 'cyan',
  success: 'green',
  failure: 'red',
  cancelled: 'gray',
  error: 'red',
  timeout: 'red',

  // Machine connection
  connected: 'green',
  disconnected: 'gray',

  // Health
  on_track: 'green',
  at_risk: 'yellow',
  off_track: 'red',
}

export function getStatusColor(status: string): StatusColor {
  return STATUS_COLOR_MAP[status] ?? 'white'
}

export function getStatusSymbol(status: string): string {
  switch (status) {
    case 'completed':
    case 'auto_verified':
    case 'success':
      return '\u2713'  // ✓
    case 'in_progress':
    case 'running':
    case 'dispatched':
      return '\u25CB'  // ○ (spinning handled separately)
    case 'planned':
    case 'pending':
      return '\u2022'  // •
    case 'failure':
    case 'error':
      return '\u2717'  // ✗
    case 'pruned':
    case 'cancelled':
      return '\u2500'  // ─
    case 'awaiting_approval':
    case 'awaiting_judgment':
      return '?'
    default:
      return '\u2022'
  }
}

/** Format a status string as `[STATUS]` for the TUI */
export function formatStatusBadge(status: string): string {
  return `[${status}]`
}
