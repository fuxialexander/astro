import chalk from 'chalk'

export interface ColumnDef {
  key: string
  label: string
  width?: number
  format?: (v: unknown) => string
}

export function formatTable(rows: Record<string, unknown>[], columns: ColumnDef[]): string {
  if (rows.length === 0) return chalk.dim('  No results.')

  // Calculate column widths
  const widths = columns.map(col => {
    const headerLen = col.label.length
    const maxDataLen = rows.reduce((max, row) => {
      const val = col.format ? col.format(row[col.key]) : String(row[col.key] ?? '')
      return Math.max(max, val.length)
    }, 0)
    return col.width ?? Math.max(headerLen, Math.min(maxDataLen, 50))
  })

  // Header
  const header = columns.map((col, i) => col.label.padEnd(widths[i])).join('  ')
  const separator = columns.map((_, i) => '\u2500'.repeat(widths[i])).join('\u2500\u2500')

  // Rows
  const dataRows = rows.map(row =>
    columns.map((col, i) => {
      const val = col.format ? col.format(row[col.key]) : String(row[col.key] ?? '')
      return val.slice(0, widths[i]).padEnd(widths[i])
    }).join('  ')
  )

  return [chalk.bold(header), chalk.dim(separator), ...dataRows].join('\n')
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

export function print(data: unknown, opts: { json?: boolean; columns?: ColumnDef[] }): void {
  if (opts.json) {
    console.log(formatJson(data))
  } else if (opts.columns && Array.isArray(data)) {
    console.log(formatTable(data as Record<string, unknown>[], opts.columns))
  } else {
    console.log(formatJson(data))
  }
}

export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return chalk.dim('\u2014')
  const d = typeof date === 'string' ? new Date(date) : date
  const now = Date.now()
  const diff = now - d.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

/**
 * Parse a date filter string into a Date object.
 * Supports:
 * - Relative: "30m", "2h", "3d", "1w" (minutes, hours, days, weeks)
 * - Named: "today", "yesterday"
 * - ISO strings: "2024-01-15", "2024-01-15T10:30:00Z"
 */
export function parseDateFilter(value: string): Date {
  const trimmed = value.trim().toLowerCase()

  // Named dates
  if (trimmed === 'today') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (trimmed === 'yesterday') {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    d.setHours(0, 0, 0, 0)
    return d
  }

  // Relative: e.g. "30m", "2h", "3d", "1w"
  const relMatch = trimmed.match(/^(\d+)\s*(m|h|d|w)$/)
  if (relMatch) {
    const amount = parseInt(relMatch[1], 10)
    const unit = relMatch[2]
    const now = Date.now()
    const ms: Record<string, number> = {
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
    }
    return new Date(now - amount * ms[unit])
  }

  // ISO string
  const d = new Date(value)
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date filter: "${value}". Use relative (2d, 1h, 30m, 1w), named (today, yesterday), or ISO format.`)
  }
  return d
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * Examples: "5.2s", "2m 30s", "1h 15m"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

export function formatStatus(status: string): string {
  const colors: Record<string, (s: string) => string> = {
    active: chalk.green,
    completed: chalk.blue,
    planned: chalk.yellow,
    in_progress: chalk.cyan,
    dispatched: chalk.cyan,
    auto_verified: chalk.green,
    awaiting_approval: chalk.magenta,
    awaiting_judgment: chalk.magenta,
    pruned: chalk.dim,
    archived: chalk.dim,
    running: chalk.cyan,
    success: chalk.green,
    failure: chalk.red,
    cancelled: chalk.dim,
    pending: chalk.yellow,
  }
  const colorFn = colors[status] ?? chalk.white
  return colorFn(status)
}
