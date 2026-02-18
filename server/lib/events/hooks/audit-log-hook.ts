/**
 * Audit Log Hook
 *
 * Logs all task execution events for debugging and compliance.
 * Creates structured JSONL logs in ~/.astro/logs/
 */

import { mkdirSync, existsSync, appendFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { EventHook } from '../types.js'

const LOGS_DIR = join(homedir(), '.astro', 'logs')

// Ensure logs directory exists
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true })
}

/**
 * Get log file path for today's date
 */
function getLogFilePath(): string {
  const date = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  return join(LOGS_DIR, `execution-${date}.jsonl`)
}

/**
 * Audit log hook - writes events to JSONL log files
 */
export const auditLogHook: EventHook = async (event) => {
  const logEntry = {
    timestamp: event.timestamp.toISOString(),
    type: event.type,
    ...event,
  }

  const logLine = JSON.stringify(logEntry) + '\n'

  try {
    appendFileSync(getLogFilePath(), logLine, 'utf-8')
  } catch (error) {
    console.error('[audit-log-hook] Failed to write log:', error)
  }
}
