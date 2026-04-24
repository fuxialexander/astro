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
import { eq, gt, and, inArray, lt, sql, desc, isNull } from 'drizzle-orm'
import {
  maybeEncryptStreamingEventData,
  maybeDecryptStreamingEventData,
  isHipaaMode,
} from './phi-encryption.js'

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
        data: maybeEncryptStreamingEventData({ text }) as Record<string, unknown>,
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
        data: maybeEncryptStreamingEventData(data) as Record<string, unknown>,
      }).returning({ seq: streamingEvents.seq })
      return row.seq
    } catch (err) {
      console.warn('[streaming-event-log] Failed to append:', (err as Error).message)
      return 0
    }
  }

  /**
   * Persist a terminal event exactly once per execution.
   * If a terminal row already exists ('result' or 'error'), return its seq.
   */
  async appendTerminalIfAbsent(
    executionId: string,
    eventType: 'result' | 'error',
    data: unknown,
  ): Promise<number> {
    await this.flushText(executionId)

    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`streaming-terminal:${executionId}`}))`)

        const existing = await tx.select({ seq: streamingEvents.seq })
          .from(streamingEvents)
          .where(
            and(
              eq(streamingEvents.executionId, executionId),
              inArray(streamingEvents.eventType, ['result', 'error']),
            ),
          )
          .orderBy(desc(streamingEvents.seq))
          .limit(1)

        if (existing[0]) return existing[0].seq

        const [row] = await tx.insert(streamingEvents).values({
          executionId,
          eventType,
          data: maybeEncryptStreamingEventData(data) as Record<string, unknown>,
        }).returning({ seq: streamingEvents.seq })

        return row.seq
      })
    } catch (err) {
      console.error('[streaming-event-log] Failed to append terminal event:', (err as Error).message)
      throw err
    }
  }

  /**
   * Persist a real task result, overriding any existing synthetic error.
   *
   * When the agent runner reconnects after a grace period expiry and delivers
   * a real result, this method soft-deletes the synthetic disconnect error
   * and inserts the actual result. Non-synthetic terminal events are never
   * overridden (first real terminal wins).
   *
   * Returns { seq, overrodeSynthetic } so the caller knows whether DB
   * recovery (plan_nodes, task_executions) is needed.
   */
  async appendResultOverridingSyntheticError(
    executionId: string,
    data: unknown,
  ): Promise<{ seq: number; overrodeSynthetic: boolean }> {
    await this.flushText(executionId)

    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`streaming-terminal:${executionId}`}))`)

        const existing = await tx.select({
          seq: streamingEvents.seq,
          eventType: streamingEvents.eventType,
          data: streamingEvents.data,
        })
          .from(streamingEvents)
          .where(
            and(
              eq(streamingEvents.executionId, executionId),
              inArray(streamingEvents.eventType, ['result', 'error']),
              isNull(streamingEvents.deletedAt),
            ),
          )
          .orderBy(desc(streamingEvents.seq))
          .limit(1)

        if (existing[0]) {
          // Decrypt before reading `synthetic` — in HIPAA mode the raw row may
          // be a `{ encrypted: ..., ...indexFields }` envelope. `synthetic` is
          // an index field today and would survive at the top level, but
          // routing through `maybeDecryptStreamingEventData` keeps this code
          // correct even if the index-field allowlist changes.
          const existingData = maybeDecryptStreamingEventData(existing[0].data) as Record<string, unknown> | null
          const isSynthetic = existingData?.synthetic === true

          if (!isSynthetic) {
            // Non-synthetic terminal exists — don't override
            return { seq: existing[0].seq, overrodeSynthetic: false }
          }

          // Soft-delete the synthetic error
          await tx.update(streamingEvents)
            .set({ deletedAt: new Date() })
            .where(eq(streamingEvents.seq, existing[0].seq))

          // Insert the real result
          const [row] = await tx.insert(streamingEvents).values({
            executionId,
            eventType: 'result',
            data: maybeEncryptStreamingEventData(data) as Record<string, unknown>,
          }).returning({ seq: streamingEvents.seq })

          return { seq: row.seq, overrodeSynthetic: true }
        }

        // No terminal event exists — insert normally
        const [row] = await tx.insert(streamingEvents).values({
          executionId,
          eventType: 'result',
          data: maybeEncryptStreamingEventData(data) as Record<string, unknown>,
        }).returning({ seq: streamingEvents.seq })

        return { seq: row.seq, overrodeSynthetic: false }
      })
    } catch (err) {
      console.error('[streaming-event-log] Failed to append result overriding synthetic:', (err as Error).message)
      throw err
    }
  }

  /**
   * Persist an approval_request exactly once per execution/requestId pair.
   */
  async appendApprovalRequestIfAbsent(
    executionId: string,
    data: {
      requestId: string
      question: string
      options: string[]
      machineId?: string
    },
  ): Promise<number> {
    await this.flushText(executionId)

    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`streaming-approval:${executionId}:${data.requestId}`}))`)

        // In HIPAA mode, `requestId` is currently kept at the top level so the
        // JSONB `->> 'requestId'` filter still works. We defend in depth by
        // fetching candidates and matching after decryption — keeps this code
        // correct if the index-field allowlist ever changes.
        let existingSeq: number | null = null
        if (isHipaaMode()) {
          const candidates = await tx.select({ seq: streamingEvents.seq, data: streamingEvents.data })
            .from(streamingEvents)
            .where(
              and(
                eq(streamingEvents.executionId, executionId),
                eq(streamingEvents.eventType, 'approval_request'),
              ),
            )
            .orderBy(desc(streamingEvents.seq))
          for (const row of candidates) {
            const decoded = maybeDecryptStreamingEventData(row.data) as { requestId?: string } | null
            if (decoded?.requestId === data.requestId) {
              existingSeq = row.seq
              break
            }
          }
        } else {
          const existing = await tx.select({ seq: streamingEvents.seq })
            .from(streamingEvents)
            .where(
              and(
                eq(streamingEvents.executionId, executionId),
                eq(streamingEvents.eventType, 'approval_request'),
                sql`${streamingEvents.data}->>'requestId' = ${data.requestId}`,
              ),
            )
            .orderBy(desc(streamingEvents.seq))
            .limit(1)
          if (existing[0]) existingSeq = existing[0].seq
        }

        if (existingSeq !== null) return existingSeq

        const [row] = await tx.insert(streamingEvents).values({
          executionId,
          eventType: 'approval_request',
          data: maybeEncryptStreamingEventData(data) as Record<string, unknown>,
        }).returning({ seq: streamingEvents.seq })

        return row.seq
      })
    } catch (err) {
      console.warn('[streaming-event-log] Failed to append approval_request:', (err as Error).message)
      return 0
    }
  }

  /**
   * Persist an approval_response exactly once per execution/requestId pair.
   * Prevents duplicate approval_response rows on multi-tab or retry scenarios.
   */
  async appendApprovalResponseIfAbsent(
    executionId: string,
    data: {
      requestId: string
      answer: string
      answered: boolean
    },
  ): Promise<number> {
    await this.flushText(executionId)

    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`streaming-approval-resp:${executionId}:${data.requestId}`}))`)

        let existingSeq: number | null = null
        if (isHipaaMode()) {
          const candidates = await tx.select({ seq: streamingEvents.seq, data: streamingEvents.data })
            .from(streamingEvents)
            .where(
              and(
                eq(streamingEvents.executionId, executionId),
                eq(streamingEvents.eventType, 'approval_response'),
              ),
            )
            .orderBy(desc(streamingEvents.seq))
          for (const row of candidates) {
            const decoded = maybeDecryptStreamingEventData(row.data) as { requestId?: string } | null
            if (decoded?.requestId === data.requestId) {
              existingSeq = row.seq
              break
            }
          }
        } else {
          const existing = await tx.select({ seq: streamingEvents.seq })
            .from(streamingEvents)
            .where(
              and(
                eq(streamingEvents.executionId, executionId),
                eq(streamingEvents.eventType, 'approval_response'),
                sql`${streamingEvents.data}->>'requestId' = ${data.requestId}`,
              ),
            )
            .orderBy(desc(streamingEvents.seq))
            .limit(1)
          if (existing[0]) existingSeq = existing[0].seq
        }

        if (existingSeq !== null) return existingSeq

        const [row] = await tx.insert(streamingEvents).values({
          executionId,
          eventType: 'approval_response',
          data: maybeEncryptStreamingEventData(data) as Record<string, unknown>,
        }).returning({ seq: streamingEvents.seq })

        return row.seq
      })
    } catch (err) {
      console.warn('[streaming-event-log] Failed to append approval_response:', (err as Error).message)
      return 0
    }
  }

  /**
   * Persist a safety_prompt exactly once per execution/safety prompt tuple.
   */
  async appendSafetyPromptIfAbsent(
    executionId: string,
    data: {
      safetyTier: string
      warning?: string
      machineId?: string
      options: Array<{ id: string; label: string; description?: string }>
    },
  ): Promise<number> {
    await this.flushText(executionId)

    try {
      return await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`streaming-safety:${executionId}:${data.safetyTier}:${data.warning ?? ''}`}))`,
        )

        const existing = await tx.select({ seq: streamingEvents.seq })
          .from(streamingEvents)
          .where(
            and(
              eq(streamingEvents.executionId, executionId),
              eq(streamingEvents.eventType, 'safety_prompt'),
              sql`${streamingEvents.data}->>'safetyTier' = ${data.safetyTier}`,
              sql`coalesce(${streamingEvents.data}->>'warning', '') = ${data.warning ?? ''}`,
            ),
          )
          .orderBy(desc(streamingEvents.seq))
          .limit(1)

        if (existing[0]) return existing[0].seq

        const [row] = await tx.insert(streamingEvents).values({
          executionId,
          eventType: 'safety_prompt',
          data: maybeEncryptStreamingEventData(data) as Record<string, unknown>,
        }).returning({ seq: streamingEvents.seq })

        return row.seq
      })
    } catch (err) {
      console.warn('[streaming-event-log] Failed to append safety_prompt:', (err as Error).message)
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
            isNull(streamingEvents.deletedAt),
          ),
        )
        .orderBy(streamingEvents.seq)
        .limit(limit)

      return rows.map((r: { seq: number; executionId: string; eventType: string; data: unknown; createdAt: Date }) => ({
        seq: r.seq,
        executionId: r.executionId,
        eventType: r.eventType,
        data: maybeDecryptStreamingEventData(r.data),
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
            isNull(streamingEvents.deletedAt),
          ),
        )
        .orderBy(streamingEvents.seq)

      return rows.map((r: { seq: number; executionId: string; eventType: string; data: unknown; createdAt: Date }) => ({
        seq: r.seq,
        executionId: r.executionId,
        eventType: r.eventType,
        data: maybeDecryptStreamingEventData(r.data),
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
   *
   * Note on HIPAA mode: in HIPAA mode the row stores a `{ encrypted, ...indexFields }`
   * envelope. The JSONB `||` shallow-merge would only update top-level index
   * fields and leaves the encrypted blob untouched (which is what we want for
   * `status` / `batchId`, both index fields). We still take the SELECT → mutate
   * → re-encrypt path under HIPAA so the rewrite remains correct even if a
   * future encryption change ever moves these fields inside the encrypted
   * payload.
   */
  async claimPendingSteers(executionId: string, batchId: string): Promise<StreamingEvent[]> {
    if (isHipaaMode()) {
      try {
        return await db.transaction(async (tx) => {
          // Lock + fetch pending rows in a stable order
          const rows = await tx.execute(sql`
            SELECT seq, execution_id AS "executionId", event_type AS "eventType", data, created_at AS "createdAt"
            FROM streaming_events
            WHERE execution_id = ${executionId}
              AND event_type = 'steer_message'
              AND data->>'status' = 'pending'
            ORDER BY seq
            FOR UPDATE
          `)
          const rowArray = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<{ seq: number; executionId: string; eventType: string; data: unknown; createdAt: Date }>

          const claimed: StreamingEvent[] = []
          for (const r of rowArray) {
            const decrypted = maybeDecryptStreamingEventData(r.data) as Record<string, unknown>
            const mutated = { ...decrypted, status: 'sent', batchId }
            const reEncrypted = maybeEncryptStreamingEventData(mutated) as Record<string, unknown>
            await tx.update(streamingEvents)
              .set({ data: reEncrypted })
              .where(eq(streamingEvents.seq, r.seq))
            claimed.push({
              seq: r.seq,
              executionId: r.executionId,
              eventType: r.eventType,
              data: mutated,
              createdAt: r.createdAt,
            })
          }
          return claimed
        })
      } catch (err) {
        console.warn('[streaming-event-log] Failed to claimPendingSteers (hipaa):', (err as Error).message)
        return []
      }
    }

    try {
      const rows = await db.execute(sql`
        UPDATE streaming_events
        SET data = data || ${JSON.stringify({ status: 'sent', batchId })}::jsonb
        WHERE execution_id = ${executionId}
          AND event_type = 'steer_message'
          AND data->>'status' = 'pending'
        RETURNING seq, execution_id AS "executionId", event_type AS "eventType", data, created_at AS "createdAt"
      `)
      // db.execute() returns rows directly with postgres-js, but { rows } with node-postgres/PGlite
      const rowArray = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<{ seq: number; executionId: string; eventType: string; data: unknown; createdAt: Date }>
      return rowArray.map((r) => ({
        seq: r.seq,
        executionId: r.executionId,
        eventType: r.eventType,
        data: maybeDecryptStreamingEventData(r.data),
        createdAt: r.createdAt,
      }))
    } catch (err) {
      console.warn('[streaming-event-log] Failed to claimPendingSteers:', (err as Error).message)
      return []
    }
  }

  /**
   * Update the status of a steer_message event by seq number.
   * In HIPAA mode: SELECT FOR UPDATE → decrypt → mutate → re-encrypt → UPDATE.
   */
  async updateSteerStatus(seq: number, status: 'sent' | 'acknowledged' | 'timed_out', batchId?: string): Promise<void> {
    if (isHipaaMode()) {
      try {
        await db.transaction(async (tx) => {
          const rows = await tx.execute(sql`
            SELECT data FROM streaming_events WHERE seq = ${seq} FOR UPDATE
          `)
          const rowArray = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<{ data: unknown }>
          if (rowArray.length === 0) return
          const decrypted = maybeDecryptStreamingEventData(rowArray[0].data) as Record<string, unknown>
          const mutated: Record<string, unknown> = { ...decrypted, status }
          if (batchId) mutated.batchId = batchId
          const reEncrypted = maybeEncryptStreamingEventData(mutated) as Record<string, unknown>
          await tx.update(streamingEvents).set({ data: reEncrypted }).where(eq(streamingEvents.seq, seq))
        })
      } catch (err) {
        console.warn('[streaming-event-log] Failed to updateSteerStatus (hipaa):', (err as Error).message)
      }
      return
    }

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
   * In HIPAA mode: SELECT FOR UPDATE → decrypt → mutate → re-encrypt → UPDATE per row.
   */
  async batchUpdateSteerStatus(seqs: number[], status: 'pending' | 'sent' | 'acknowledged' | 'timed_out', batchId?: string): Promise<void> {
    if (seqs.length === 0) return

    if (isHipaaMode()) {
      try {
        await db.transaction(async (tx) => {
          const rows = await tx.execute(sql`
            SELECT seq, data FROM streaming_events
            WHERE seq = ANY(${seqs})
            ORDER BY seq
            FOR UPDATE
          `)
          const rowArray = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<{ seq: number; data: unknown }>
          for (const r of rowArray) {
            const decrypted = maybeDecryptStreamingEventData(r.data) as Record<string, unknown>
            const mutated: Record<string, unknown> = { ...decrypted, status }
            if (batchId) mutated.batchId = batchId
            const reEncrypted = maybeEncryptStreamingEventData(mutated) as Record<string, unknown>
            await tx.update(streamingEvents).set({ data: reEncrypted }).where(eq(streamingEvents.seq, r.seq))
          }
        })
      } catch (err) {
        console.warn('[streaming-event-log] Failed to batchUpdateSteerStatus (hipaa):', (err as Error).message)
      }
      return
    }

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
    if (isHipaaMode()) {
      try {
        await db.transaction(async (tx) => {
          const rows = await tx.execute(sql`
            SELECT seq, data FROM streaming_events
            WHERE execution_id = ${executionId}
              AND event_type = 'steer_message'
              AND data->>'status' = 'sent'
            ORDER BY seq
            FOR UPDATE
          `)
          const rowArray = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<{ seq: number; data: unknown }>
          for (const r of rowArray) {
            const decrypted = maybeDecryptStreamingEventData(r.data) as Record<string, unknown>
            const mutated = { ...decrypted, status }
            const reEncrypted = maybeEncryptStreamingEventData(mutated) as Record<string, unknown>
            await tx.update(streamingEvents).set({ data: reEncrypted }).where(eq(streamingEvents.seq, r.seq))
          }
        })
      } catch (err) {
        console.warn('[streaming-event-log] Failed to updateSentSteersStatus (hipaa):', (err as Error).message)
      }
      return
    }

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
