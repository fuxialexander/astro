/**
 * Device Code Storage
 *
 * Persistent storage for device authorization codes using Drizzle ORM
 * against the `device_codes` table in Postgres/PGlite.
 */

import type {
  DeviceCodeEntry,
  DeviceAuthRequest,
} from '../types/device-auth.js';
import {
  generateDeviceCode,
  generateUserCode,
} from './token-manager.js';
import { TOKEN_EXPIRY, DEFAULT_POLL_INTERVAL } from '../types/device-auth.js';
import { db } from './db/index.js';
import { deviceCodes } from './db/schema.js';
import { eq, and, gt, lt, or } from 'drizzle-orm';

/**
 * Map a database row to a DeviceCodeEntry interface object.
 */
function rowToEntry(row: typeof deviceCodes.$inferSelect): DeviceCodeEntry {
  return {
    deviceCode: row.deviceCode,
    userCode: row.userCode,
    scopes: row.scopes,
    machineInfo: row.machineInfo as DeviceCodeEntry['machineInfo'],
    status: row.status as DeviceCodeEntry['status'],
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    authorizedBy: row.authorizedBy ?? undefined,
    authorizedAt: row.authorizedAt ?? undefined,
    lastPolledAt: row.lastPolledAt ?? undefined,
  };
}

/**
 * Create a new device authorization code
 */
export async function createDeviceCode(request: DeviceAuthRequest): Promise<{
  deviceCode: string;
  userCode: string;
  expiresIn: number;
  interval: number;
}> {
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_EXPIRY.DEVICE_CODE * 1000);

  await db.insert(deviceCodes).values({
    userCode,
    deviceCode,
    scopes: request.scopes || [],
    machineInfo: request.machineInfo ?? null,
    status: 'pending',
    expiresAt,
    createdAt: now,
  });

  return {
    deviceCode,
    userCode,
    expiresIn: TOKEN_EXPIRY.DEVICE_CODE,
    interval: DEFAULT_POLL_INTERVAL,
  };
}

/**
 * Get device code entry by user code (for polling)
 */
export async function getDeviceCodeByUserCode(userCode: string): Promise<DeviceCodeEntry | null> {
  const rows = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.userCode, userCode))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];

  // Check if expired (pending code past its expiry)
  if (row.expiresAt < new Date() && row.status === 'pending') {
    // Update status to expired in the DB
    await db
      .update(deviceCodes)
      .set({ status: 'expired' })
      .where(eq(deviceCodes.userCode, userCode));

    return {
      ...rowToEntry(row),
      status: 'expired',
    };
  }

  return rowToEntry(row);
}

/**
 * Get device code entry by device code (for user authorization page)
 */
export async function getDeviceCodeByDeviceCode(deviceCode: string): Promise<DeviceCodeEntry | null> {
  const rows = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.deviceCode, deviceCode))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];

  // Check if expired (pending code past its expiry)
  if (row.expiresAt < new Date() && row.status === 'pending') {
    await db
      .update(deviceCodes)
      .set({ status: 'expired' })
      .where(eq(deviceCodes.userCode, row.userCode));

    return {
      ...rowToEntry(row),
      status: 'expired',
    };
  }

  return rowToEntry(row);
}

/**
 * Check if polling is too fast (rate limiting)
 * Returns true if polling too fast, false otherwise.
 * Also updates lastPolledAt.
 */
export async function checkPollRate(userCode: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.userCode, userCode))
    .limit(1);

  if (rows.length === 0) {
    return false;
  }

  const row = rows[0];

  if (row.lastPolledAt) {
    const timeSinceLastPoll = Date.now() - row.lastPolledAt.getTime();
    // Allow polling at minimum interval (with 500ms tolerance)
    if (timeSinceLastPoll < (DEFAULT_POLL_INTERVAL - 0.5) * 1000) {
      return true; // Too fast
    }
  }

  // Update last poll time
  await db
    .update(deviceCodes)
    .set({ lastPolledAt: new Date() })
    .where(eq(deviceCodes.userCode, userCode));

  return false;
}

/**
 * Authorize a device code (called when user approves)
 */
export async function authorizeDeviceCode(deviceCode: string, userId: string): Promise<boolean> {
  const entry = await getDeviceCodeByDeviceCode(deviceCode);
  if (!entry) {
    return false;
  }

  if (entry.status !== 'pending') {
    return false;
  }

  if (entry.expiresAt < new Date()) {
    return false;
  }

  const now = new Date();
  await db
    .update(deviceCodes)
    .set({
      status: 'authorized',
      authorizedBy: userId,
      authorizedAt: now,
    })
    .where(
      and(
        eq(deviceCodes.deviceCode, deviceCode),
        eq(deviceCodes.status, 'pending'),
        gt(deviceCodes.expiresAt, new Date()),
      )
    );

  // Drizzle update returns the result; check rowCount if available
  // For safety, re-read to confirm the update took effect
  const updated = await db
    .select()
    .from(deviceCodes)
    .where(
      and(
        eq(deviceCodes.deviceCode, deviceCode),
        eq(deviceCodes.status, 'authorized'),
      )
    )
    .limit(1);

  return updated.length > 0;
}

/**
 * Deny a device code (called when user denies)
 */
export async function denyDeviceCode(deviceCode: string): Promise<boolean> {
  const entry = await getDeviceCodeByDeviceCode(deviceCode);
  if (!entry) {
    return false;
  }

  if (entry.status !== 'pending') {
    return false;
  }

  await db
    .update(deviceCodes)
    .set({ status: 'denied' })
    .where(
      and(
        eq(deviceCodes.deviceCode, deviceCode),
        eq(deviceCodes.status, 'pending'),
      )
    );

  const updated = await db
    .select()
    .from(deviceCodes)
    .where(
      and(
        eq(deviceCodes.deviceCode, deviceCode),
        eq(deviceCodes.status, 'denied'),
      )
    )
    .limit(1);

  return updated.length > 0;
}

/**
 * Mark device code as used (after token is issued)
 */
export async function markDeviceCodeUsed(userCode: string): Promise<boolean> {
  await db
    .update(deviceCodes)
    .set({ status: 'used' })
    .where(eq(deviceCodes.userCode, userCode));

  const updated = await db
    .select()
    .from(deviceCodes)
    .where(
      and(
        eq(deviceCodes.userCode, userCode),
        eq(deviceCodes.status, 'used'),
      )
    )
    .limit(1);

  return updated.length > 0;
}

/**
 * Get pending device codes (for admin/debug)
 */
export async function getPendingDeviceCodes(): Promise<DeviceCodeEntry[]> {
  const now = new Date();

  const rows = await db
    .select()
    .from(deviceCodes)
    .where(
      and(
        eq(deviceCodes.status, 'pending'),
        gt(deviceCodes.expiresAt, now),
      )
    );

  return rows.map(rowToEntry);
}

/**
 * Clean up expired device codes (should be called periodically)
 */
export async function cleanupExpiredDeviceCodes(): Promise<number> {
  const now = new Date();

  // Delete expired or used codes
  const result = await db
    .delete(deviceCodes)
    .where(
      or(
        lt(deviceCodes.expiresAt, now),
        eq(deviceCodes.status, 'used'),
      )
    )
    .returning();

  return result.length;
}

/**
 * Get statistics about device codes
 */
export async function getDeviceCodeStats(): Promise<{
  total: number;
  pending: number;
  authorized: number;
  expired: number;
  used: number;
}> {
  const now = new Date();

  const rows = await db
    .select({
      status: deviceCodes.status,
      expiresAt: deviceCodes.expiresAt,
    })
    .from(deviceCodes);

  const stats = {
    total: 0,
    pending: 0,
    authorized: 0,
    expired: 0,
    used: 0,
  };

  for (const row of rows) {
    stats.total++;

    if (row.expiresAt < now && row.status === 'pending') {
      stats.expired++;
    } else {
      switch (row.status) {
        case 'pending':
          stats.pending++;
          break;
        case 'authorized':
          stats.authorized++;
          break;
        case 'expired':
          stats.expired++;
          break;
        case 'used':
          stats.used++;
          break;
      }
    }
  }

  return stats;
}
