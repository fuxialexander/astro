/**
 * Envelope Encryption Helper
 *
 * Provides AES-256-GCM encryption for at-rest secrets (connected-account
 * credentials, machine provider configs, and — in later HIPAA phases — PHI
 * columns such as streaming event payloads).
 *
 * Design:
 *   - A single **Data Encryption Key (DEK)** is derived from the
 *     `ASTRO_ENCRYPTION_KEY` env var (base64-encoded 32 bytes).
 *   - Each `encrypt()` call generates a fresh 96-bit IV.
 *   - Ciphertext is packaged as a JSON blob `{ kid, iv, ct, tag }`, then
 *     base64-encoded for storage as a plain string.
 *   - A key-id (`kid`) identifies which DEK was used, leaving room for
 *     future key rotation and KMS-backed key sourcing. In Phase 0 we always
 *     use `kid="local-v1"`.
 *
 * Later phases will replace key sourcing with an AWS KMS-wrapped DEK (the
 * "envelope" in envelope encryption) — `getDek()` is the seam for that
 * change, and the on-disk format already carries a `kid` to support rotation.
 *
 * In **local mode** (PGlite, no auth, single-user dev) the helper falls back
 * to an **ephemeral in-memory key** generated once at module load — useless
 * across restarts, but enough to exercise the encryption path end-to-end
 * without forcing every contributor to generate and export a key.
 *
 * In **server mode** (Supabase / Fly.io / any shared environment) we refuse
 * to start without `ASTRO_ENCRYPTION_KEY`: an ephemeral key there would
 * silently make every encrypted row unrecoverable across the first rolling
 * restart. `loadDek()` throws a loud, instructive error instead.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'
import { isLocalMode } from './app-mode.js'

// ─────────────────────────────────────────────────────────────────────────────
// Key sourcing
// ─────────────────────────────────────────────────────────────────────────────

const KID_LOCAL_V1 = 'local-v1'
const KID_EPHEMERAL = 'ephemeral-v1'

interface DekEntry {
  kid: string
  key: Buffer
  /** True if this key was auto-generated and will vanish on restart. */
  ephemeral: boolean
}

let cachedDek: DekEntry | null = null

function loadDek(): DekEntry {
  if (cachedDek) return cachedDek

  const raw = process.env.ASTRO_ENCRYPTION_KEY?.trim()
  if (raw) {
    let key: Buffer
    try {
      key = Buffer.from(raw, 'base64')
    } catch {
      throw new Error(
        '[encryption] ASTRO_ENCRYPTION_KEY is set but is not valid base64.',
      )
    }
    if (key.length !== 32) {
      throw new Error(
        `[encryption] ASTRO_ENCRYPTION_KEY must decode to 32 bytes (AES-256); ` +
          `got ${key.length} bytes. Generate one with: ` +
          `\`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"\``,
      )
    }
    cachedDek = { kid: KID_LOCAL_V1, key, ephemeral: false }
    return cachedDek
  }

  // No key configured. In server mode this is a hard failure — an ephemeral
  // key would silently make every encrypted row (credentials, provider
  // configs, and future PHI columns) unrecoverable on the first rolling
  // restart. Only local mode gets the ephemeral fallback, for dev UX.
  if (!isLocalMode()) {
    throw new Error(
      '[encryption] ASTRO_ENCRYPTION_KEY is not set.\n' +
        '\n' +
        '  Why this matters: all encrypted data (connected-account credentials,\n' +
        '  machine provider configs, and future PHI columns) is sealed with a\n' +
        '  Data Encryption Key (DEK) derived from ASTRO_ENCRYPTION_KEY. Without\n' +
        '  a stable key, every encrypted row becomes UNRECOVERABLE on the next\n' +
        '  restart (Fly.io rolling deploys, crash recovery, scale-to-zero).\n' +
        '\n' +
        '  How to generate one (32 random bytes, base64-encoded):\n' +
        '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n' +
        '\n' +
        '  Where to put it:\n' +
        '    Fly.io:    fly secrets set ASTRO_ENCRYPTION_KEY="<base64>" --app astro-backend-deploy\n' +
        '    Local dev: add ASTRO_ENCRYPTION_KEY=<base64> to .env.local\n' +
        '\n' +
        '  This value must be backed up — losing it loses all encrypted data.',
    )
  }

  // Local-mode fallback: ephemeral in-memory key. Logs a warning so devs
  // know this path is in effect and not the production path.
  const ephemeral = randomBytes(32)
  console.warn(
    '\n' +
      '⚠️  [encryption] ASTRO_ENCRYPTION_KEY is not set — using an EPHEMERAL\n' +
      '   in-memory key. This is LOCAL-MODE ONLY: any data encrypted during\n' +
      '   this process lifetime will be UNRECOVERABLE after restart. Server\n' +
      '   mode refuses to start without ASTRO_ENCRYPTION_KEY.\n',
  )
  cachedDek = { kid: KID_EPHEMERAL, key: ephemeral, ephemeral: true }
  return cachedDek
}

/** Test-only: reset the cached DEK so env changes take effect. */
export function __resetEncryptionForTests(): void {
  cachedDek = null
}

// ─────────────────────────────────────────────────────────────────────────────
// On-disk blob format
// ─────────────────────────────────────────────────────────────────────────────

interface EncryptedBlob {
  /** Key ID, for future rotation / KMS wrapping. */
  kid: string
  /** Base64 IV (12 bytes for GCM). */
  iv: string
  /** Base64 ciphertext. */
  ct: string
  /** Base64 GCM auth tag (16 bytes). */
  tag: string
  /** Format version tag so we can evolve the blob shape. */
  v: 1
}

const BLOB_PREFIX = 'enc:v1:'

function isEncryptedBlob(obj: unknown): obj is EncryptedBlob {
  if (!obj || typeof obj !== 'object') return false
  const b = obj as Record<string, unknown>
  return (
    typeof b.kid === 'string' &&
    typeof b.iv === 'string' &&
    typeof b.ct === 'string' &&
    typeof b.tag === 'string' &&
    b.v === 1
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string or JSON-serializable object.
 *
 * Returns a single string suitable for storage in a text/jsonb column:
 *   `"enc:v1:<base64(JSON({kid,iv,ct,tag,v}))>"`.
 */
export function encrypt(plaintext: string | object): string {
  const dek = loadDek()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', dek.key, iv)

  const raw =
    typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext)
  const ct = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  const blob: EncryptedBlob = {
    kid: dek.kid,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
    v: 1,
  }
  return BLOB_PREFIX + Buffer.from(JSON.stringify(blob), 'utf8').toString('base64')
}

/**
 * Decrypt a blob produced by `encrypt()`. Returns the original plaintext
 * string. Callers that stored JSON should `JSON.parse()` the result.
 *
 * Throws if the blob is malformed, the auth tag fails, or the key-id is
 * unknown.
 */
export function decrypt(blob: string): string {
  if (typeof blob !== 'string' || !blob.startsWith(BLOB_PREFIX)) {
    throw new Error('[encryption] Not an encrypted blob')
  }
  let parsed: EncryptedBlob
  try {
    const json = Buffer.from(blob.slice(BLOB_PREFIX.length), 'base64').toString(
      'utf8',
    )
    parsed = JSON.parse(json) as EncryptedBlob
  } catch (err) {
    throw new Error(
      `[encryption] Failed to parse encrypted blob: ${(err as Error).message}`,
    )
  }
  if (!isEncryptedBlob(parsed)) {
    throw new Error('[encryption] Blob is missing required fields')
  }

  const dek = loadDek()
  // Only reject KID mismatch when we can't reach the older key. For now we
  // have exactly one live key, so any mismatch is unrecoverable — but if
  // the running key is KID_LOCAL_V1 and the blob claims KID_EPHEMERAL
  // (leftover from a prior dev run) we surface a targeted error.
  if (parsed.kid !== dek.kid) {
    throw new Error(
      `[encryption] Key id mismatch: blob encrypted with "${parsed.kid}" ` +
        `but current key is "${dek.kid}". Data is unrecoverable with the ` +
        `current key material.`,
    )
  }

  const iv = Buffer.from(parsed.iv, 'base64')
  const ct = Buffer.from(parsed.ct, 'base64')
  const tag = Buffer.from(parsed.tag, 'base64')

  const decipher = createDecipheriv('aes-256-gcm', dek.key, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ct), decipher.final()])
  return plain.toString('utf8')
}

/**
 * Heuristic: has this value already been encrypted by `encrypt()`?
 *
 * Accepts either:
 *  - a raw string blob beginning with `enc:v1:`, or
 *  - a JSONB wrapper object `{ encrypted: "enc:v1:..." }` (the shape we
 *    use for columns that are typed `jsonb` in Postgres).
 */
export function isEncrypted(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith(BLOB_PREFIX)
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (typeof v.encrypted === 'string' && v.encrypted.startsWith(BLOB_PREFIX)) {
      return true
    }
  }
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// JSONB helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a JSON value and wrap it as `{ encrypted: "enc:v1:..." }` so it
 * can live in an existing `jsonb` column without a schema change.
 */
export function encryptJsonb(value: unknown): { encrypted: string } {
  return { encrypted: encrypt(typeof value === 'string' ? value : JSON.stringify(value)) }
}

/**
 * Given a `jsonb` value that may be either a plaintext object (legacy) or
 * a `{ encrypted: "..." }` wrapper, return the plaintext object. Pass a
 * type parameter for the expected decoded shape.
 */
export function decryptJsonb<T = unknown>(value: unknown): T {
  if (value == null) return value as T
  if (
    typeof value === 'object' &&
    value !== null &&
    'encrypted' in (value as Record<string, unknown>) &&
    typeof (value as { encrypted: unknown }).encrypted === 'string'
  ) {
    const plain = decrypt((value as { encrypted: string }).encrypted)
    try {
      return JSON.parse(plain) as T
    } catch {
      // Stored as a bare string
      return plain as unknown as T
    }
  }
  // Legacy plaintext — return as-is.
  return value as T
}
