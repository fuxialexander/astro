/**
 * Session Logger
 *
 * Writes JSONL and Markdown session logs for task executions.
 * Logs are stored at ~/.astro/logs/sessions/{executionId}.jsonl and .md.
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { TaskResult } from './types.js'

const SESSIONS_DIR = join(homedir(), '.astro', 'logs', 'sessions')

export class SessionLogger {
  private jsonlStream: WriteStream | null = null
  private taskId: string
  private startTime: number
  private toolCalls: Array<{ name: string; timestamp: number }> = []
  private model: string | undefined
  private sessionId: string | undefined
  private outputText = ''

  constructor(taskId: string) {
    this.taskId = taskId
    this.startTime = Date.now()

    try {
      mkdirSync(SESSIONS_DIR, { recursive: true })
      this.jsonlStream = createWriteStream(
        join(SESSIONS_DIR, `${taskId}.jsonl`),
        { flags: 'a' }
      )
    } catch (err) {
      console.warn(`[session-logger] Failed to create log stream for ${taskId}:`, err)
    }
  }

  /**
   * Log a raw SDK message as a JSONL line (non-blocking).
   */
  log(entry: { type: string; [key: string]: unknown }): void {
    if (!this.jsonlStream) return

    // Track metadata for markdown summary
    if (entry.type === 'system' && entry.subtype === 'init') {
      this.model = entry.model as string
      this.sessionId = entry.session_id as string
    }
    if (entry.type === 'tool_use') {
      this.toolCalls.push({ name: entry.toolName as string, timestamp: Date.now() })
    }
    if (entry.type === 'text') {
      this.outputText += entry.text as string
    }

    try {
      const line = JSON.stringify({ ...entry, _ts: Date.now() })
      this.jsonlStream.write(line + '\n')
    } catch {
      // Non-blocking: swallow serialization errors
    }
  }

  /**
   * Finalize the session log and write a markdown summary.
   */
  async finalize(result: TaskResult): Promise<void> {
    // Close JSONL stream
    if (this.jsonlStream) {
      this.jsonlStream.end()
      this.jsonlStream = null
    }

    // Write markdown summary
    const durationSec = ((result.metrics?.durationMs ?? (Date.now() - this.startTime)) / 1000).toFixed(1)
    const costStr = result.metrics?.estimatedCostUsd != null
      ? `$${result.metrics.estimatedCostUsd.toFixed(4)}`
      : 'N/A'

    const lines: string[] = [
      `# Session: ${this.taskId}`,
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Task ID | \`${this.taskId}\` |`,
      `| Session ID | \`${this.sessionId ?? 'N/A'}\` |`,
      `| Model | ${this.model ?? result.metrics?.model ?? 'unknown'} |`,
      `| Status | ${result.status} |`,
      `| Duration | ${durationSec}s |`,
      `| Cost | ${costStr} |`,
      `| Turns | ${result.metrics?.turnsUsed ?? 'N/A'} |`,
      `| Input tokens | ${result.metrics?.inputTokens ?? 'N/A'} |`,
      `| Output tokens | ${result.metrics?.outputTokens ?? 'N/A'} |`,
      '',
    ]

    if (this.toolCalls.length > 0) {
      lines.push('## Tool Calls', '')
      for (const tc of this.toolCalls) {
        lines.push(`- \`${tc.name}\``)
      }
      lines.push('')
    }

    if (this.outputText) {
      lines.push('## Output', '', '```', this.outputText.slice(0, 10000), '```', '')
    }

    if (result.errorMessage) {
      lines.push('## Error', '', '```', result.errorMessage, '```', '')
    }

    try {
      await writeFile(join(SESSIONS_DIR, `${this.taskId}.md`), lines.join('\n'))
    } catch (err) {
      console.warn(`[session-logger] Failed to write markdown summary for ${this.taskId}:`, err)
    }
  }
}
