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
    console.warn('[phi-encryption] Failed to decrypt text:', (err as Error).message)
    return value
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
    console.warn('[phi-encryption] Failed to decrypt jsonb:', (err as Error).message)
    return value as T
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
    console.warn('[phi-encryption] Failed to decrypt streaming_events.data:', (err as Error).message)
    return data
  }
}

export type { IndexField }
