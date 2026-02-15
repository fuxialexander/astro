/**
 * Audit Logging Middleware
 *
 * Logs security-relevant operations for compliance and forensics.
 * Tracks: account operations, API key operations, machine registration, project access.
 */

import type { Context, Next } from 'hono';
import { db } from '../lib/db/index.js';
import { auditLogs } from '../lib/db/schema.js';
import { shouldUseSupabase } from '../lib/supabase.js';

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
  // Only log in Supabase mode (audit logs are in Postgres)
  if (!shouldUseSupabase()) {
    return;
  }

  try {
    await db.insert(auditLogs).values({
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      details: entry.details ?? {},
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch (error: unknown) {
    // Silently skip audit logging if table doesn't exist (backwards compatibility)
    const err = error as { cause?: { code?: string } }
    if (err?.cause?.code === '42P01') {
      // PostgreSQL error code for "relation does not exist"
      console.warn('[audit] Skipping - audit_logs table not found. Run migrations to enable.');
    } else {
      console.error('[audit] Failed to log audit event:', error);
    }
    // Don't throw - audit logging should not break the application
  }
}

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
