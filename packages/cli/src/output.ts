/**
 * Output formatting utilities for CLI.
 *
 * Supports both human-readable table output and JSON for machine consumption.
 */

import chalk from 'chalk'

export interface ColumnDef {
  key: string
  label: string
  width?: number
  format?: (value: unknown) => string
}

/**
 * Format data as a colored table for terminal output.
 */
export function formatTable(
  rows: Record<string, unknown>[],
  columns: ColumnDef[]
): string {
  if (rows.length === 0) {
    return chalk.dim('No results found.')
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const labelWidth = col.label.length
    const maxDataWidth = Math.max(
      ...rows.map((row) => {
        const value = row[col.key]
        const formatted = col.format ? col.format(value) : String(value ?? '')
        // Strip ANSI codes for width calculation
        // eslint-disable-next-line no-control-regex
        return formatted.replace(/\x1b\[[0-9;]*m/g, '').length
      })
    )
    return col.width ?? Math.max(labelWidth, maxDataWidth, 4)
  })

  // Build header
  const header = columns
    .map((col, i) => chalk.bold(col.label.padEnd(widths[i])))
    .join('  ')

  // Build rows
  const dataRows = rows.map((row) =>
    columns
      .map((col, i) => {
        const value = row[col.key]
        const formatted = col.format ? col.format(value) : String(value ?? '')
        // Pad based on actual string length (accounting for ANSI codes)
        // eslint-disable-next-line no-control-regex
        const rawLength = formatted.replace(/\x1b\[[0-9;]*m/g, '').length
        const padding = Math.max(0, widths[i] - rawLength)
        return formatted + ' '.repeat(padding)
      })
      .join('  ')
  )

  return [header, ...dataRows].join('\n')
}

/**
 * Format data as JSON.
 */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

/**
 * Print data in the appropriate format based on --json flag.
 */
export function print(
  data: unknown,
  opts: { json?: boolean; columns?: ColumnDef[] }
): void {
  if (opts.json) {
    console.log(formatJson(data))
  } else if (opts.columns && Array.isArray(data)) {
    console.log(formatTable(data as Record<string, unknown>[], opts.columns))
  } else {
    console.log(formatJson(data))
  }
}

/**
 * Format a timestamp as a relative time string.
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return chalk.dim('never')

  const now = new Date()
  const then = typeof date === 'string' ? new Date(date) : date
  const diff = now.getTime() - then.getTime()

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return chalk.green('just now')
  if (minutes < 60) return chalk.green(`${minutes}m ago`)
  if (hours < 24) return chalk.yellow(`${hours}h ago`)
  if (days < 7) return chalk.dim(`${days}d ago`)

  return chalk.dim(then.toLocaleDateString())
}

/**
 * Format a status with appropriate color.
 */
export function formatStatus(status: string): string {
  switch (status) {
    case 'active':
      return chalk.green(status)
    case 'archived':
      return chalk.dim(status)
    case 'completed':
      return chalk.green(status)
    case 'in_progress':
      return chalk.yellow(status)
    case 'planned':
      return chalk.blue(status)
    case 'pruned':
      return chalk.red(status)
    case 'auto_verified':
      return chalk.green(status)
    case 'awaiting_approval':
    case 'awaiting_judgment':
      return chalk.yellow(status)
    default:
      return status
  }
}

/**
 * Truncate a string to a maximum length.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 1) + '\u2026' // ellipsis
}

/**
 * Print an error message.
 */
export function printError(message: string): void {
  console.error(chalk.red(`Error: ${message}`))
}

/**
 * Print a success message.
 */
export function printSuccess(message: string): void {
  console.log(chalk.green(`\u2713 ${message}`))
}

/**
 * Print a warning message.
 */
export function printWarning(message: string): void {
  console.log(chalk.yellow(`\u26A0 ${message}`))
}
