/**
 * StreamingEventLog
 *
 * Persist-then-notify streaming event log for SSE catch-up.
 * Structural events (tool_use, tool_result, file_change, etc.) are
 * persisted immediately. Text is accumulated per-execution and flushed
 * when the next structural event arrives or on disconnect/completion.
 */

import { db } from './db/index.js'
import { streamingEvents } from './db/schema.js'
import { gt, and, inArray, lt } from 'drizzle-orm'

export interface StreamingEvent {
  seq: number
  executionId: string
  eventType: string
  data: unknown
  createdAt: Date
}

class StreamingEventLog {
  private textBuffers = new Map<string, string[]>()

  /**
   * Flush accumulated text for an execution, writing it as a single 'text' row.
   * Returns the seq number of the written row, or null if buffer was empty.
   */
  async flushText(executionId: string): Promise<number | null> {
    const chunks = this.textBuffers.get(executionId)
    if (!chunks || chunks.length === 0) return null

    const text = chunks.join('')
    this.textBuffers.delete(executionId)

    try {
      const [row] = await db.insert(streamingEvents).values({
        executionId,
        eventType: 'text',
        data: { text },
      }).returning({ seq: streamingEvents.seq })
      return row.seq
    } catch (err) {
      console.warn('[streaming-event-log] Failed to flush text:', (err as Error).message)
      return null
    }
  }

  /**
   * Persist a structural event. Automatically flushes any pending text first
   * to preserve chronological ordering (text appears before tool call).
   * Returns the seq number of the structural event.
   */
  async append(executionId: string, eventType: string, data: unknown): Promise<number> {
    // Flush pending text before the structural event
    await this.flushText(executionId)

    try {
      const [row] = await db.insert(streamingEvents).values({
        executionId,
        eventType,
        data: data as Record<string, unknown>,
      }).returning({ seq: streamingEvents.seq })
      return row.seq
    } catch (err) {
      console.warn('[streaming-event-log] Failed to append:', (err as Error).message)
      return 0
    }
  }

  /**
   * Accumulate text in-memory for an execution. Does NOT write to DB.
   * Text is flushed when append() is called (next structural event)
   * or explicitly via flushText().
   */
  appendText(executionId: string, text: string): void {
    const existing = this.textBuffers.get(executionId)
    if (existing) {
      existing.push(text)
    } else {
      this.textBuffers.set(executionId, [text])
    }
  }

  /**
   * Catch-up query: get events after a given seq for a set of execution IDs.
   */
  async getAfter(
    executionIds: string[],
    afterSeq: number,
    limit = 1000,
  ): Promise<StreamingEvent[]> {
    if (executionIds.length === 0) return []

    try {
      const rows = await db.select()
        .from(streamingEvents)
        .where(
          and(
            inArray(streamingEvents.executionId, executionIds),
            gt(streamingEvents.seq, afterSeq),
          ),
        )
        .orderBy(streamingEvents.seq)
        .limit(limit)

      return rows.map((r: { seq: number; executionId: string; eventType: string; data: unknown; createdAt: Date }) => ({
        seq: r.seq,
        executionId: r.executionId,
        eventType: r.eventType,
        data: r.data,
        createdAt: r.createdAt,
      }))
    } catch (err) {
      console.warn('[streaming-event-log] Failed to getAfter:', (err as Error).message)
      return []
    }
  }

  /**
   * Cleanup: delete events older than a given date.
   * Returns the number of rows deleted.
   */
  async cleanup(olderThan: Date): Promise<number> {
    try {
      const result = await db.delete(streamingEvents)
        .where(lt(streamingEvents.createdAt, olderThan))
      return result.rowCount ?? 0
    } catch (err) {
      console.warn('[streaming-event-log] Failed to cleanup:', (err as Error).message)
      return 0
    }
  }

  /**
   * Flush all text buffers (for graceful shutdown).
   */
  async flushAll(): Promise<void> {
    const execIds = Array.from(this.textBuffers.keys())
    await Promise.allSettled(execIds.map(id => this.flushText(id)))
  }
}

export const streamingEventLog = new StreamingEventLog()
