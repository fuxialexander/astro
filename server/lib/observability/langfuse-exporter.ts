/**
 * Langfuse Exporter
 *
 * Optional hook that forwards observation events to a self-hosted Langfuse instance.
 * Enabled when LANGFUSE_ENABLED=true and connection env vars are set.
 * Falls back silently if Langfuse is unreachable.
 */

import type { AstroEvent, EventHook } from '../events/types.js'
import type { LangfuseExportConfig, ObservationEvent } from './types.js'

/** Batch size before flushing to Langfuse */
const LANGFUSE_BATCH_SIZE = 50

/** Flush interval in milliseconds */
const LANGFUSE_FLUSH_INTERVAL_MS = 10_000

/**
 * Load Langfuse config from environment variables.
 * Returns null if Langfuse export is not configured.
 */
function loadConfig(): LangfuseExportConfig | null {
  const enabled = process.env.LANGFUSE_ENABLED === 'true'
  const baseUrl = process.env.LANGFUSE_BASE_URL
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY

  if (!enabled || !baseUrl || !publicKey || !secretKey) return null

  return { enabled, baseUrl, publicKey, secretKey }
}

/**
 * Map an AstroEvent to Langfuse ingestion events.
 * Returns an array of Langfuse-compatible ingestion items.
 */
function mapToLangfuseEvents(event: AstroEvent): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = []

  switch (event.type) {
    case 'task.started':
      items.push({
        type: 'trace-create',
        body: {
          id: event.executionId,
          name: event.node?.title ?? `Task ${event.taskId}`,
          metadata: {
            projectId: event.projectId,
            nodeId: event.nodeId,
            taskId: event.taskId,
          },
          timestamp: event.timestamp.toISOString(),
        },
      })
      break

    case 'task.completed':
      items.push({
        type: 'trace-create',
        body: {
          id: event.executionId,
          output: event.result?.stdout?.slice(0, 10000),
          metadata: {
            status: event.result?.status,
            metrics: event.result?.metrics,
          },
          timestamp: event.timestamp.toISOString(),
        },
      })
      break

    case 'task.failed':
      items.push({
        type: 'trace-create',
        body: {
          id: event.executionId,
          metadata: {
            status: 'failed',
            error: event.error,
          },
          timestamp: event.timestamp.toISOString(),
        },
      })
      break
  }

  return items
}

class LangfuseExporter {
  private config: LangfuseExportConfig
  private buffer: Array<Record<string, unknown>> = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private consecutiveFailures = 0
  private static readonly MAX_RETRY_FAILURES = 3
  private static readonly MAX_BUFFER_SIZE = 500

  constructor(config: LangfuseExportConfig) {
    this.config = config
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        if (this.consecutiveFailures <= 1) {
          console.warn('[langfuse] Periodic flush failed:', err)
        }
      })
    }, LANGFUSE_FLUSH_INTERVAL_MS)
    console.log(`[langfuse] Exporter initialized, target: ${config.baseUrl}`)
  }

  /**
   * Buffer a lifecycle event for export.
   */
  handleEvent(event: AstroEvent): void {
    const items = mapToLangfuseEvents(event)
    this.buffer.push(...items)

    if (this.buffer.length >= LANGFUSE_BATCH_SIZE) {
      this.flush().catch((err) => {
        console.warn('[langfuse] Auto-flush failed:', err)
      })
    }
  }

  /**
   * Buffer observation events for export (called from observation collector).
   */
  exportObservations(observations: ObservationEvent[]): void {
    for (const obs of observations) {
      const langfuseType = obs.type === 'generation' ? 'generation-create'
        : obs.type === 'tool' ? 'span-create'
        : obs.type === 'span' ? 'span-create'
        : 'event-create'

      this.buffer.push({
        type: langfuseType,
        body: {
          id: obs.id,
          traceId: obs.traceId,
          parentObservationId: obs.parentObservationId,
          name: obs.name,
          startTime: obs.startTime.toISOString(),
          endTime: obs.endTime?.toISOString(),
          input: obs.input,
          output: obs.output,
          model: obs.model,
          usage: (obs.inputTokens || obs.outputTokens) ? {
            input: obs.inputTokens,
            output: obs.outputTokens,
          } : undefined,
          metadata: obs.metadata,
          level: obs.level?.toUpperCase(),
          statusMessage: obs.statusMessage,
        },
      })
    }

    if (this.buffer.length >= LANGFUSE_BATCH_SIZE) {
      this.flush().catch((err) => {
        console.warn('[langfuse] Auto-flush failed:', err)
      })
    }
  }

  /**
   * Send buffered events to Langfuse ingestion API.
   * On failure, re-queues events (up to MAX_BUFFER_SIZE) and suppresses
   * repeated error logs after MAX_RETRY_FAILURES consecutive failures.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const batch = this.buffer.splice(0)
    const url = `${this.config.baseUrl}/api/public/ingestion`
    const auth = Buffer.from(`${this.config.publicKey}:${this.config.secretKey}`).toString('base64')

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
        },
        body: JSON.stringify({ batch }),
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) {
        this.handleFlushFailure(batch, `${response.status} ${response.statusText}`)
      } else {
        if (this.consecutiveFailures > 0) {
          console.log(`[langfuse] Connection recovered after ${this.consecutiveFailures} failure(s)`)
        }
        this.consecutiveFailures = 0
        console.log(`[langfuse] Exported ${batch.length} events`)
      }
    } catch (err) {
      this.handleFlushFailure(batch, (err as Error).message)
    }
  }

  private handleFlushFailure(batch: Array<Record<string, unknown>>, reason: string): void {
    this.consecutiveFailures++

    // Log first failure and periodic reminders, suppress the rest
    if (this.consecutiveFailures === 1) {
      console.warn(`[langfuse] Export failed: ${reason}`)
    } else if (this.consecutiveFailures === LangfuseExporter.MAX_RETRY_FAILURES) {
      console.warn(`[langfuse] Export failed ${this.consecutiveFailures} times in a row, suppressing further warnings`)
    }

    // Re-queue events for retry, but cap buffer to avoid unbounded growth
    if (this.consecutiveFailures <= LangfuseExporter.MAX_RETRY_FAILURES) {
      const headroom = LangfuseExporter.MAX_BUFFER_SIZE - this.buffer.length
      if (headroom > 0) {
        this.buffer.unshift(...batch.slice(0, headroom))
      }
    }
    // After MAX_RETRY_FAILURES, drop events — Langfuse is likely down
  }

  /**
   * Stop the exporter and flush remaining events.
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush()
    console.log('[langfuse] Exporter stopped')
  }
}

// Initialize exporter if configured
const config = loadConfig()
const exporter = config ? new LangfuseExporter(config) : null

/** EventHook for astroEventTransport (null if Langfuse not configured) */
export const langfuseExportHook: EventHook | null = exporter
  ? (event) => { exporter.handleEvent(event) }
  : null

/** Export the exporter instance for direct observation export */
export const langfuseExporter = exporter
