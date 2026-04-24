/**
 * PHI Encryption Helpers (Phase 4)
 *
 * Thin wrappers around `encryption.ts` that are gated by HIPAA mode.
 *
 * Design goals:
 *   1. **No-op outside HIPAA mode** — SaaS behavior is unchanged. Rows are
 *      written as plaintext JSON / text, exactly like before.
 *   2. **Read compat for legacy plaintext** — once HIPAA mode is turned on
 *      for an existing tenant, `maybeDecrypt*()` must still read the old
 *      plaintext rows, guarded by `isEncrypted()`.
 *   3. **Streaming-event-friendly** — the `streaming_events.data` jsonb
 *      column is queried by JSONB ->> filters on a small allowlist of
 *      non-PHI routing fields (requestId, approvalId, status, batchId,
 *      safetyTier, warning, linesAdded, synthetic). Those fields must
 *      remain in plaintext alongside the encrypted payload so existing
 *      queries keep working. PHI-ish fields (text, toolInput, toolResult,
 *      file paths, etc.) go inside the encrypted blob.
 *
 * TODO: once Phase 1 ships an `isHipaaMode()` helper in app-mode, switch
 * `isHipaaMode()` below to import it. For now we read the env var directly.
 */

import {
  encrypt,
  decrypt,
  isEncrypted,
  encryptJsonb,
  decryptJsonb,
} from './encryption.js'

/**
 * True when the process was started in HIPAA mode. Reads `ASTRO_HIPAA_MODE`
 * directly; Phase 1 will centralize this behind an `isHipaaMode()` helper
 * and this file should be updated to import it then.
 */
export function isHipaaMode(): boolean {
  return process.env.ASTRO_HIPAA_MODE === 'true'
}

// ─────────────────────────────────────────────────────────────────────────────
// Text columns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a string column value if HIPAA mode is on. No-op otherwise.
 * Safe to call on null/undefined — they pass through unchanged.
 */
export function maybeEncryptText(value: string | null | undefined): string | null | undefined {
  if (value == null) return value
  if (!isHipaaMode()) return value
  if (isEncrypted(value)) return value // don't double-encrypt
  return encrypt(value)
}

/**
 * Decrypt a string column value if it is an encrypted blob; return as-is
 * otherwise (legacy plaintext compat). Safe to call regardless of HIPAA mode.
 */
export function maybeDecryptText(value: string | null | undefined): string | null | undefined {
  if (value == null) return value
  if (typeof value !== 'string') return value
  if (!isEncrypted(value)) return value
  try {
    return decrypt(value)
  } catch (err) {
    // Per HIPAA policy and CLAUDE.md "Never silently fall back to a degraded
    // mode": surface the failure instead of returning the raw ciphertext,
    // which would otherwise leak through to API responses / UI.
    throw new Error(`[phi-encryption] decrypt failed for text column: ${(err as Error).message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSONB columns (generic — whole value encrypted, no index passthrough)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt an entire JSONB value if HIPAA mode is on. No-op otherwise.
 * Wraps the value as `{ encrypted: "enc:v1:..." }`.
 */
export function maybeEncryptJsonb(value: unknown): unknown {
  if (value == null) return value
  if (!isHipaaMode()) return value
  if (isEncrypted(value)) return value
  return encryptJsonb(value)
}

/**
 * Decrypt a JSONB value that may be `{ encrypted: "..." }` or legacy
 * plaintext. Returns the decoded plaintext object.
 */
export function maybeDecryptJsonb<T = unknown>(value: unknown): T {
  if (value == null) return value as T
  if (!isEncrypted(value)) return value as T
  try {
    return decryptJsonb<T>(value)
  } catch (err) {
    // Hard-fail rather than returning ciphertext. See maybeDecryptText.
    throw new Error(`[phi-encryption] decrypt failed for jsonb column: ${(err as Error).message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming event data — index-aware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Routing / dedup index fields that are NOT PHI and must remain queryable
 * via `streaming_events.data ->> '<field>'`. These are copied out of the
 * payload and stored at the top level alongside the encrypted blob.
 *
 * Callers: streaming-event-log (approval/safety dedup, steer status/batchId),
 * stats.ts (file_change linesAdded aggregate), dispatch.ts (approval lookup).
 */
const STREAMING_EVENT_INDEX_FIELDS = [
  'requestId',
  'approvalId',
  'status',
  'batchId',
  'safetyTier',
  'warning',
  'linesAdded',
  'synthetic',
  'machineId',
  'sessionId',
  'answered',
] as const

type IndexField = (typeof STREAMING_EVENT_INDEX_FIELDS)[number]

/**
 * Encrypt a `streaming_events.data` JSONB payload. Non-PHI index fields are
 * kept at the top level so existing JSONB queries keep working; everything
 * else is encrypted into `encrypted`.
 *
 * Returns the value unchanged when HIPAA mode is off.
 */
export function maybeEncryptStreamingEventData(data: unknown): unknown {
  if (data == null) return data
  if (!isHipaaMode()) return data
  if (!data || typeof data !== 'object') return data
  if (isEncrypted(data)) return data

  const src = data as Record<string, unknown>
  const indexCopy: Record<string, unknown> = {}
  const payload: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src)) {
    if ((STREAMING_EVENT_INDEX_FIELDS as readonly string[]).includes(k)) {
      indexCopy[k] = v
    } else {
      payload[k] = v
    }
  }

  // Even if payload is empty, wrap so the row is recognized as encrypted.
  return {
    ...indexCopy,
    encrypted: encrypt(JSON.stringify(payload)),
  }
}

/**
 * Decrypt a `streaming_events.data` JSONB payload produced by
 * `maybeEncryptStreamingEventData`. Legacy plaintext rows pass through.
 *
 * Note: the decrypted payload is merged with the top-level index fields so
 * callers see the same shape they used to — `{ requestId, text, ... }`.
 */
export function maybeDecryptStreamingEventData(data: unknown): unknown {
  if (data == null) return data
  if (!data || typeof data !== 'object') return data
  const src = data as Record<string, unknown>
  if (typeof src.encrypted !== 'string' || !isEncrypted(src.encrypted)) {
    return data
  }
  try {
    const plain = decrypt(src.encrypted)
    let inner: Record<string, unknown>
    try {
      const parsed = JSON.parse(plain)
      inner = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      inner = {}
    }
    // Merge: index fields (e.g. status) reflect the LATEST value, since
    // `updateSteerStatus` mutates the outer jsonb. So outer wins.
    const { encrypted: _omit, ...indexFields } = src
    return { ...inner, ...indexFields }
  } catch (err) {
    // Hard-fail rather than returning ciphertext. See maybeDecryptText.
    throw new Error(`[phi-encryption] decrypt failed for streaming_events.data: ${(err as Error).message}`)
  }
}

export type { IndexField }

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4b — generic helpers + per-table sanitizers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alias for `maybeEncryptText` introduced in Phase 4b to match the rest of
 * the PHI inventory naming. Identical behavior; some call sites prefer the
 * `String` suffix because the underlying column is a `text` (not jsonb).
 */
export function maybeEncryptString(value: string | null | undefined): string | null | undefined {
  return maybeEncryptText(value)
}

/**
 * Alias for `maybeDecryptText`. See `maybeEncryptString`.
 */
export function maybeDecryptString(value: string | null | undefined): string | null | undefined {
  return maybeDecryptText(value)
}

/**
 * Apply a mapper to every property in `obj` and return a new object — used
 * to build the per-table sanitizers below without mutating caller-owned
 * values. `null`/`undefined` rows pass through untouched so callers can
 * chain on optional results from `db.select(...).at(0)`.
 */
// Mappers are intentionally typed with broad input/output to accept both the
// text variant (string | null | undefined) and the jsonb variant (unknown).
// Casting to `unknown` here is safe because individual encrypt/decrypt helpers
// validate their input shape internally.
type PhiMapper = (v: unknown) => unknown
function mapPhiFields<T extends Record<string, unknown>>(
  row: T | null | undefined,
  fields: readonly (keyof T)[],
  mapper: PhiMapper | ((v: string | null | undefined) => string | null | undefined),
): T | null | undefined {
  if (row == null) return row
  const out: Record<string, unknown> = { ...row }
  const fn = mapper as PhiMapper
  for (const f of fields) {
    if (f in out) out[f as string] = fn(out[f as string])
  }
  return out as T
}

// ── projects ────────────────────────────────────────────────────────────────
const PROJECT_TEXT_PHI = ['description', 'visionDoc'] as const

export function encryptProjectWrite<T extends Record<string, unknown>>(row: T): T {
  return mapPhiFields(row, PROJECT_TEXT_PHI as readonly (keyof T)[], maybeEncryptText) as T
}

export function decryptProjectRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  return mapPhiFields(row, PROJECT_TEXT_PHI as readonly (keyof T)[], maybeDecryptText)
}

export function decryptProjectRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptProjectRow(r) as T)
}

// ── planNodes ───────────────────────────────────────────────────────────────
const PLAN_NODE_TEXT_PHI = ['description', 'content', 'executionOutput'] as const

export function encryptPlanNodeWrite<T extends Record<string, unknown>>(row: T): T {
  return mapPhiFields(row, PLAN_NODE_TEXT_PHI as readonly (keyof T)[], maybeEncryptText) as T
}

export function decryptPlanNodeRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  return mapPhiFields(row, PLAN_NODE_TEXT_PHI as readonly (keyof T)[], maybeDecryptText)
}

export function decryptPlanNodeRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptPlanNodeRow(r) as T)
}

// ── sessions ────────────────────────────────────────────────────────────────
const SESSION_TEXT_PHI = ['streamText'] as const
const SESSION_JSONB_PHI = ['messages', 'activityEvents', 'toolTraces', 'fileChanges'] as const

export function encryptSessionWrite<T extends Record<string, unknown>>(row: T): T {
  let out = mapPhiFields(row, SESSION_TEXT_PHI as readonly (keyof T)[], maybeEncryptText) as T
  out = mapPhiFields(out, SESSION_JSONB_PHI as readonly (keyof T)[], maybeEncryptJsonb) as T
  return out
}

export function decryptSessionRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  let out = mapPhiFields(row, SESSION_TEXT_PHI as readonly (keyof T)[], maybeDecryptText)
  out = mapPhiFields(out, SESSION_JSONB_PHI as readonly (keyof T)[], (v) => maybeDecryptJsonb(v))
  return out
}

export function decryptSessionRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptSessionRow(r) as T)
}

// ── taskExecutions ──────────────────────────────────────────────────────────
const TASK_EXECUTION_TEXT_PHI = ['streamText'] as const

export function encryptTaskExecutionWrite<T extends Record<string, unknown>>(row: T): T {
  return mapPhiFields(row, TASK_EXECUTION_TEXT_PHI as readonly (keyof T)[], maybeEncryptText) as T
}

export function decryptTaskExecutionRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  return mapPhiFields(row, TASK_EXECUTION_TEXT_PHI as readonly (keyof T)[], maybeDecryptText)
}

export function decryptTaskExecutionRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptTaskExecutionRow(r) as T)
}

// ── taskChatMessages ────────────────────────────────────────────────────────
const TASK_CHAT_TEXT_PHI = ['content'] as const

export function encryptTaskChatMessageWrite<T extends Record<string, unknown>>(row: T): T {
  return mapPhiFields(row, TASK_CHAT_TEXT_PHI as readonly (keyof T)[], maybeEncryptText) as T
}

export function decryptTaskChatMessageRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  return mapPhiFields(row, TASK_CHAT_TEXT_PHI as readonly (keyof T)[], maybeDecryptText)
}

export function decryptTaskChatMessageRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptTaskChatMessageRow(r) as T)
}

// ── observationEvents ───────────────────────────────────────────────────────
const OBSERVATION_JSONB_PHI = ['input', 'output'] as const

export function encryptObservationWrite<T extends Record<string, unknown>>(row: T): T {
  return mapPhiFields(row, OBSERVATION_JSONB_PHI as readonly (keyof T)[], maybeEncryptJsonb) as T
}

export function decryptObservationRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  return mapPhiFields(row, OBSERVATION_JSONB_PHI as readonly (keyof T)[], (v) => maybeDecryptJsonb(v))
}

export function decryptObservationRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptObservationRow(r) as T)
}

// ── toolTraces (standalone table) ───────────────────────────────────────────
const TOOL_TRACE_JSONB_PHI = ['toolInput', 'toolResult'] as const

export function encryptToolTraceWrite<T extends Record<string, unknown>>(row: T): T {
  return mapPhiFields(row, TOOL_TRACE_JSONB_PHI as readonly (keyof T)[], maybeEncryptJsonb) as T
}

export function decryptToolTraceRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  return mapPhiFields(row, TOOL_TRACE_JSONB_PHI as readonly (keyof T)[], (v) => maybeDecryptJsonb(v))
}

export function decryptToolTraceRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptToolTraceRow(r) as T)
}

// ── fileChanges (standalone table) ──────────────────────────────────────────
const FILE_CHANGE_TEXT_PHI = ['path'] as const

export function encryptFileChangeWrite<T extends Record<string, unknown>>(row: T): T {
  return mapPhiFields(row, FILE_CHANGE_TEXT_PHI as readonly (keyof T)[], maybeEncryptText) as T
}

export function decryptFileChangeRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  return mapPhiFields(row, FILE_CHANGE_TEXT_PHI as readonly (keyof T)[], maybeDecryptText)
}

export function decryptFileChangeRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptFileChangeRow(r) as T)
}

// ── machineInstructions ─────────────────────────────────────────────────────
const MACHINE_INSTRUCTION_TEXT_PHI = ['content'] as const

export function encryptMachineInstructionWrite<T extends Record<string, unknown>>(row: T): T {
  return mapPhiFields(row, MACHINE_INSTRUCTION_TEXT_PHI as readonly (keyof T)[], maybeEncryptText) as T
}

export function decryptMachineInstructionRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  return mapPhiFields(row, MACHINE_INSTRUCTION_TEXT_PHI as readonly (keyof T)[], maybeDecryptText)
}

export function decryptMachineInstructionRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptMachineInstructionRow(r) as T)
}

// ── skills ──────────────────────────────────────────────────────────────────
const SKILL_TEXT_PHI = ['instructions'] as const
const SKILL_JSONB_PHI = ['config'] as const

export function encryptSkillWrite<T extends Record<string, unknown>>(row: T): T {
  let out = mapPhiFields(row, SKILL_TEXT_PHI as readonly (keyof T)[], maybeEncryptText) as T
  out = mapPhiFields(out, SKILL_JSONB_PHI as readonly (keyof T)[], maybeEncryptJsonb) as T
  return out
}

export function decryptSkillRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  let out = mapPhiFields(row, SKILL_TEXT_PHI as readonly (keyof T)[], maybeDecryptText)
  out = mapPhiFields(out, SKILL_JSONB_PHI as readonly (keyof T)[], (v) => maybeDecryptJsonb(v))
  return out
}

export function decryptSkillRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptSkillRow(r) as T)
}

// ── blobs ───────────────────────────────────────────────────────────────────
const BLOB_TEXT_PHI = ['data'] as const

export function encryptBlobWrite<T extends Record<string, unknown>>(row: T): T {
  return mapPhiFields(row, BLOB_TEXT_PHI as readonly (keyof T)[], maybeEncryptText) as T
}

export function decryptBlobRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  return mapPhiFields(row, BLOB_TEXT_PHI as readonly (keyof T)[], maybeDecryptText)
}

// ── auditLogs ───────────────────────────────────────────────────────────────
// Defensive encryption: details should never contain PHI by policy, but we
// encrypt anyway when HIPAA mode is on so accidental leaks (e.g. a route
// stuffing a request body into details) are still encrypted at rest.
const AUDIT_LOG_JSONB_PHI = ['details'] as const

export function encryptAuditLogWrite<T extends Record<string, unknown>>(row: T): T {
  return mapPhiFields(row, AUDIT_LOG_JSONB_PHI as readonly (keyof T)[], maybeEncryptJsonb) as T
}

export function decryptAuditLogRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
  return mapPhiFields(row, AUDIT_LOG_JSONB_PHI as readonly (keyof T)[], (v) => maybeDecryptJsonb(v))
}

export function decryptAuditLogRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptAuditLogRow(r) as T)
}
