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
import { eq, gt, and, inArray, lt, sql } from 'drizzle-orm'

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

    // Delete buffer SYNCHRONOUSLY before the async DB insert to prevent
    // concurrent flushText() calls (heartbeat vs structural event) from
    // reading the same buffer and inserting duplicate text rows.
    this.textBuffers.delete(executionId)
    const text = chunks.join('')

    try {
      const [row] = await db.insert(streamingEvents).values({
        executionId,
        eventType: 'text',
        data: { text },
      }).returning({ seq: streamingEvents.seq })
      return row.seq
    } catch (err) {
      console.error('[streaming-event-log] Failed to flush text for', executionId, ':', (err as Error).message)
      // On failure, re-insert chunks so they aren't lost.
      // Prepend to any new chunks that accumulated during the failed insert.
      const currentChunks = this.textBuffers.get(executionId) || []
      this.textBuffers.set(executionId, [...chunks, ...currentChunks])
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
   * Discard the in-memory text buffer for an execution without writing to DB.
   * Use this for one-shot tasks (executeViaRelay) where text output is captured
   * in a local variable and persistence is not needed.
   */
  discardText(executionId: string): void {
    this.textBuffers.delete(executionId)
  }

  /**
   * Get pending steer messages for an execution, ordered by seq.
   */
  async getPendingSteerMessages(executionId: string): Promise<StreamingEvent[]> {
    try {
      const rows = await db.select()
        .from(streamingEvents)
        .where(
          and(
            eq(streamingEvents.executionId, executionId),
            eq(streamingEvents.eventType, 'steer_message'),
            sql`${streamingEvents.data}->>'status' = 'pending'`,
          ),
        )
        .orderBy(streamingEvents.seq)

      return rows.map((r: { seq: number; executionId: string; eventType: string; data: unknown; createdAt: Date }) => ({
        seq: r.seq,
        executionId: r.executionId,
        eventType: r.eventType,
        data: r.data,
        createdAt: r.createdAt,
      }))
    } catch (err) {
      console.warn('[streaming-event-log] Failed to getPendingSteerMessages:', (err as Error).message)
      return []
    }
  }

  /**
   * Atomically claim pending steer messages by updating status to 'sent' and returning them.
   * Prevents race conditions between the steer endpoint and drainPendingSteers.
   */
  async claimPendingSteers(executionId: string, batchId: string): Promise<StreamingEvent[]> {
    try {
      const rows = await db.execute(sql`
        UPDATE streaming_events
        SET data = data || ${JSON.stringify({ status: 'sent', batchId })}::jsonb
        WHERE execution_id = ${executionId}
          AND event_type = 'steer_message'
          AND data->>'status' = 'pending'
        RETURNING seq, execution_id AS "executionId", event_type AS "eventType", data, created_at AS "createdAt"
      `)
      return (rows.rows as Array<{ seq: number; executionId: string; eventType: string; data: unknown; createdAt: Date }>).map((r) => ({
        seq: r.seq,
        executionId: r.executionId,
        eventType: r.eventType,
        data: r.data,
        createdAt: r.createdAt,
      }))
    } catch (err) {
      console.warn('[streaming-event-log] Failed to claimPendingSteers:', (err as Error).message)
      return []
    }
  }

  /**
   * Update the status of a steer_message event by seq number.
   */
  async updateSteerStatus(seq: number, status: 'sent' | 'acknowledged' | 'timed_out', batchId?: string): Promise<void> {
    try {
      const update: Record<string, unknown> = { status }
      if (batchId) update.batchId = batchId
      await db.update(streamingEvents)
        .set({
          data: sql`${streamingEvents.data} || ${JSON.stringify(update)}::jsonb`,
        })
        .where(eq(streamingEvents.seq, seq))
    } catch (err) {
      console.warn('[streaming-event-log] Failed to updateSteerStatus:', (err as Error).message)
    }
  }

  /**
   * Batch update status for multiple steer_message events.
   */
  async batchUpdateSteerStatus(seqs: number[], status: 'pending' | 'sent' | 'acknowledged' | 'timed_out', batchId?: string): Promise<void> {
    if (seqs.length === 0) return
    try {
      const update: Record<string, unknown> = { status }
      if (batchId) update.batchId = batchId
      await db.update(streamingEvents)
        .set({
          data: sql`${streamingEvents.data} || ${JSON.stringify(update)}::jsonb`,
        })
        .where(inArray(streamingEvents.seq, seqs))
    } catch (err) {
      console.warn('[streaming-event-log] Failed to batchUpdateSteerStatus:', (err as Error).message)
    }
  }

  /**
   * Update all 'sent' steer_message events for an execution to a new status.
   * Used when the agent acks (or rejects) all pending steers at once.
   */
  async updateSentSteersStatus(executionId: string, status: 'acknowledged' | 'timed_out'): Promise<void> {
    try {
      await db.update(streamingEvents)
        .set({
          data: sql`${streamingEvents.data} || ${JSON.stringify({ status })}::jsonb`,
        })
        .where(
          and(
            eq(streamingEvents.executionId, executionId),
            eq(streamingEvents.eventType, 'steer_message'),
            sql`${streamingEvents.data}->>'status' = 'sent'`,
          ),
        )
    } catch (err) {
      console.warn('[streaming-event-log] Failed to updateSentSteersStatus:', (err as Error).message)
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
