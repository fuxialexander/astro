/**
 * Daily audit log export to S3 Object Lock bucket (HIPAA Phase 5).
 *
 * HIPAA requires audit evidence be retained and tamper-evident. The in-DB
 * `audit_logs` table is append-only at the code/DB level, but we ALSO
 * ship a daily NDJSON (gzipped) to an S3 bucket configured with Object
 * Lock in Compliance mode. Once written, the object cannot be deleted or
 * overwritten until its retention expires — this is the external WORM
 * store required by §164.312(b).
 *
 * Scope for this PR: scaffolding only.
 *   - Function `exportAuditLogsToS3(since, until)` reads rows in the window,
 *     serializes them as NDJSON, gzips, and uploads.
 *   - Gated on `isHipaaMode()` — no-op outside HIPAA.
 *   - CLI entry at `scripts/audit-log-export.ts` (`npm run audit:export -- --date YYYY-MM-DD`).
 *   - NOT wired to any scheduler in this PR. Operators will run via cron/EventBridge.
 *
 * Env vars:
 *   S3_AUDIT_BUCKET     — target bucket name (required in HIPAA; asserted at boot).
 *   S3_AUDIT_PREFIX     — optional key prefix, default "audit".
 *   AWS_REGION          — required (HIPAA boot assertion).
 */

import { gzipSync } from 'node:zlib'
import { and, gte, lt, asc } from 'drizzle-orm'
import { db } from './db/index.js'
import { auditLogs } from './db/schema.js'
import { isHipaaMode } from './app-mode.js'
import { decryptAuditLogRow } from './phi-encryption.js'

export interface ExportResult {
  /** Full s3:// URI of the written object. */
  uri: string
  /** Number of audit rows included. */
  rowCount: number
  /** Compressed bytes uploaded. */
  bytes: number
}

/**
 * Export audit_logs rows in `[since, until)` to S3 as NDJSON.gz.
 *
 * Returns null (no-op) when HIPAA mode is not active.
 */
export async function exportAuditLogsToS3(since: Date, until: Date): Promise<ExportResult | null> {
  if (!isHipaaMode()) {
    console.warn('[audit-export] isHipaaMode() is false — skipping. This exporter only runs in HIPAA deployments.')
    return null
  }

  const bucket = process.env.S3_AUDIT_BUCKET
  if (!bucket) {
    throw new Error('[audit-export] S3_AUDIT_BUCKET is required in HIPAA mode')
  }
  const region = process.env.AWS_REGION
  if (!region) {
    throw new Error('[audit-export] AWS_REGION is required in HIPAA mode')
  }
  const prefix = process.env.S3_AUDIT_PREFIX ?? 'audit'

  if (!(since < until)) {
    throw new Error(`[audit-export] invalid window: since=${since.toISOString()} must be < until=${until.toISOString()}`)
  }

  // Read the window. audit_logs is small relative to other tables (a few
  // million rows/year at most). A single query with order-by-createdAt is
  // fine; if this ever scales, switch to a cursor loop.
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(gte(auditLogs.createdAt, since), lt(auditLogs.createdAt, until)))
    .orderBy(asc(auditLogs.createdAt))

  const ndjson = rows.map((r) => JSON.stringify(decryptAuditLogRow(r as Record<string, unknown>))).join('\n') + (rows.length > 0 ? '\n' : '')
  const body = gzipSync(Buffer.from(ndjson, 'utf8'))

  // Key: audit/YYYY/MM/DD.jsonl.gz (UTC). One object per day is the unit of
  // Object Lock retention.
  const y = since.getUTCFullYear()
  const m = String(since.getUTCMonth() + 1).padStart(2, '0')
  const d = String(since.getUTCDate()).padStart(2, '0')
  const key = `${prefix}/${y}/${m}/${d}.jsonl.gz`

  // Lazy-import the AWS SDK so non-HIPAA builds don't pay the load cost
  // and a missing dependency can never crash the server start.
  type PutObjectInput = {
    Bucket: string
    Key: string
    Body: Buffer
    ContentType: string
    ContentEncoding: string
    ChecksumAlgorithm?: string
  }
  type S3ClientLike = {
    send: (cmd: unknown) => Promise<unknown>
  }
  type ClientS3Module = {
    S3Client: new (cfg: { region: string }) => S3ClientLike
    PutObjectCommand: new (input: PutObjectInput) => unknown
  }
  let mod: ClientS3Module
  try {
    mod = (await import('@aws-sdk/client-s3')) as unknown as ClientS3Module
  } catch (err) {
    throw new Error(
      '[audit-export] @aws-sdk/client-s3 is not installed. Run `pnpm install` in the HIPAA build.',
      { cause: err },
    )
  }

  const client = new mod.S3Client({ region })
  const command = new mod.PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/x-ndjson',
    ContentEncoding: 'gzip',
    // SHA-256 checksum so the bucket's Object Lock / integrity policies
    // can verify the upload end-to-end.
    ChecksumAlgorithm: 'SHA256',
  })
  await client.send(command)

  const result: ExportResult = {
    uri: `s3://${bucket}/${key}`,
    rowCount: rows.length,
    bytes: body.byteLength,
  }
  console.log(
    `[audit-export] wrote ${result.rowCount} rows (${result.bytes} bytes gz) to ${result.uri}`,
  )
  return result
}
