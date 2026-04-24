/**
 * Audit Logging Middleware
 *
 * Logs security-relevant operations for compliance and forensics.
 * Tracks: account operations, API key operations, machine registration, project access.
 */

import type { Context, Next } from 'hono';
import { db } from '../lib/db/index.js';
import { auditLogs } from '../lib/db/schema.js';
import { isLocalMode, isHipaaMode } from '../lib/app-mode.js';
import { encryptAuditLogWrite } from '../lib/phi-encryption.js';

interface AuditLogEntry {
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log an audit event
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  // In HIPAA mode, audit writes are REQUIRED (against PGlite). In plain local
  // mode (no HIPAA), skip because there is no audit table wired up.
  // In SaaS/server mode we always write.
  if (isLocalMode() && !isHipaaMode()) {
    return;
  }

  try {
    await db.insert(auditLogs).values(encryptAuditLogWrite({
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      details: entry.details ?? {},
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    }));
  } catch (error: unknown) {
    // Surface every audit failure at error level with a full stack. HIPAA
    // mode (Phase 5) will escalate this to a hard failure so a broken audit
    // pipeline cannot silently drop evidence; for Phase 0 we keep it
    // non-fatal to avoid a SaaS regression, but we log loudly enough that
    // the on-call is paged by log alerts.
    const err = error as { cause?: { code?: string }; stack?: string; message?: string };
    const pgCode = err?.cause?.code;
    const context = {
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      userId: entry.userId,
      pgCode,
    };
    if (pgCode === '42P01') {
      // The `audit_logs` table is missing. This used to be treated as a
      // benign "backward compat" case; it is in fact a deployment bug
      // (migrations haven't been applied) and must be visible.
      console.error(
        '[audit] audit_logs table not found — audit event dropped. Run migrations.',
        context,
      );
    } else {
      console.error(
        '[audit] Failed to persist audit event:',
        err?.message ?? error,
        context,
      );
      if (err?.stack) console.error(err.stack);
    }
    // Emit a metric if the observability pipeline is wired up. We resolve
    // the recorder lazily so this module does not force the import graph.
    try {
      const mod = await import('../lib/observability/observation-collector.js');
      const rec = (mod as unknown as {
        recordMetric?: (name: string, value: number, tags?: Record<string, string>) => void;
      }).recordMetric;
      if (typeof rec === 'function') {
        rec('audit.write_failed', 1, {
          action: entry.action,
          resourceType: entry.resourceType,
          pgCode: pgCode ?? 'unknown',
        });
      }
    } catch {
      // Observability pipeline unavailable; the console.error above is
      // still emitted, so we do not mask the original audit failure.
    }
    // Phase 5: in HIPAA mode, a broken audit pipeline MUST fail the request.
    // HIPAA §164.312(b) requires audit controls; silently dropping evidence
    // is not acceptable. SaaS/server mode remains non-fatal to avoid
    // regressing Phase 0's behavior under known-flaky deploy windows.
    if (isHipaaMode()) {
      throw new Error(
        `[audit] HIPAA mode: failed to persist audit event for ${entry.action} on ${entry.resourceType}. ` +
          `Request aborted to preserve audit integrity.`,
        { cause: error },
      );
    }
  }
}

/**
 * Alias for logAuditEvent — this is the ONLY approved write path for the
 * `audit_logs` table. All direct `db.insert(auditLogs)` calls outside this
 * module are disallowed by `scripts/check-audit-log-writes.ts`.
 */
export const writeAuditLog = logAuditEvent;

/**
 * Extract IP address from request
 */
function getClientIp(c: Context): string | undefined {
  // Check common headers for real IP (reverse proxy/CDN)
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = c.req.header('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Cloudflare header
  const cfConnectingIp = c.req.header('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  return undefined;
}

/**
 * Audit middleware - attaches audit helper to context
 */
export function auditMiddleware() {
  return async (c: Context, next: Next) => {
    const user = c.get('user');

    // Attach audit helper to context
    c.set('audit', async (action: string, resourceType: string, resourceId?: string, details?: Record<string, unknown>) => {
      if (!user) return;

      await logAuditEvent({
        userId: user.id,
        action,
        resourceType,
        resourceId,
        details,
        ipAddress: getClientIp(c),
        userAgent: c.req.header('user-agent'),
      });
    });

    await next();
  };
}

/**
 * Audit actions enum for consistency
 */
export const AuditActions = {
  // Account operations
  ACCOUNT_CREATE: 'account.create',
  ACCOUNT_LOGIN: 'account.login',
  ACCOUNT_LOGOUT: 'account.logout',
  ACCOUNT_DELETE: 'account.delete',

  // API key operations
  API_KEY_CREATE: 'api_key.create',
  API_KEY_DELETE: 'api_key.delete',
  API_KEY_REVOKE: 'api_key.revoke',

  // Machine operations
  MACHINE_REGISTER: 'machine.register',
  MACHINE_REVOKE: 'machine.revoke',
  MACHINE_RENAME: 'machine.rename',

  // Project operations
  PROJECT_CREATE: 'project.create',
  PROJECT_DELETE: 'project.delete',
  PROJECT_SHARE: 'project.share',
  PROJECT_ACCESS: 'project.access',

  // Data operations
  DATA_EXPORT: 'data.export',
  DATA_DELETE: 'data.delete',

  // Auth internals
  INTERNAL_DISPATCH_USED: 'auth.internal_dispatch_used',

  // HIPAA / compliance
  PHI_ACCESS: 'phi.access',
  AUTH_POLICY_CHANGE: 'auth.policy_change',
  HIPAA_MODE_TOGGLED: 'hipaa.mode_toggled',
} as const;

/**
 * Resource types enum for consistency
 */
export const ResourceTypes = {
  ACCOUNT: 'account',
  API_KEY: 'api_key',
  MACHINE: 'machine',
  PROJECT: 'project',
  DATA: 'data',
} as const;
