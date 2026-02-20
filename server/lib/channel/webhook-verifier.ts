/**
 * Webhook Verifier
 *
 * Shared HMAC-SHA256 verification for webhook signatures from
 * external services (Slack, GitHub, Linear, Telegram).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify an HMAC-SHA256 signature with timing-safe comparison.
 *
 * @param body - Raw request body string
 * @param signature - Signature from the webhook header
 * @param secret - Shared secret for HMAC computation
 * @param opts.prefix - Signature prefix to strip (e.g., "sha256=", "v0=")
 * @param opts.algorithm - Hash algorithm (default: sha256)
 */
export function verifyHmacSignature(
  body: string,
  signature: string,
  secret: string,
  opts?: { prefix?: string; algorithm?: string }
): boolean {
  const algorithm = opts?.algorithm ?? 'sha256'
  const prefix = opts?.prefix ?? ''

  const expected = createHmac(algorithm, secret).update(body).digest('hex')
  const expectedWithPrefix = prefix + expected

  // Timing-safe compare
  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expectedWithPrefix)

  if (sigBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(sigBuf, expectedBuf)
}

/**
 * Verify a Slack request signature.
 *
 * Slack signs requests with HMAC-SHA256 of `v0:{timestamp}:{body}`.
 * The signature header has a `v0=` prefix.
 * Rejects requests where the timestamp is older than 5 minutes (replay protection).
 *
 * @param body - Raw request body string
 * @param timestamp - X-Slack-Request-Timestamp header value
 * @param signature - X-Slack-Signature header value (e.g., "v0=abc123...")
 * @param secret - Slack signing secret
 */
export function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
  secret: string
): boolean {
  // Replay protection: reject if timestamp is >5 min old
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) return false

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > 300) return false

  // Compute HMAC of `v0:{timestamp}:{body}`
  const sigBasestring = `v0:${timestamp}:${body}`
  const expected = createHmac('sha256', secret).update(sigBasestring).digest('hex')
  const expectedSig = `v0=${expected}`

  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expectedSig)

  if (sigBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(sigBuf, expectedBuf)
}

/**
 * Verify a simple token comparison (e.g., Telegram's X-Telegram-Bot-Api-Secret-Token).
 * Uses timing-safe comparison.
 */
export function verifySimpleToken(header: string, secret: string): boolean {
  const headerBuf = Buffer.from(header)
  const secretBuf = Buffer.from(secret)

  if (headerBuf.length !== secretBuf.length) return false
  return timingSafeEqual(headerBuf, secretBuf)
}
