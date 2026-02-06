/**
 * Device Code Storage
 *
 * In-memory storage for device authorization codes.
 * In production, this should be backed by Redis or a database.
 */

import type {
  DeviceCodeEntry,
  DeviceAuthRequest,
} from '../types/device-auth';
import {
  generateDeviceCode,
  generateUserCode,
} from './token-manager';
import { TOKEN_EXPIRY, DEFAULT_POLL_INTERVAL } from '../types/device-auth';

// In-memory store for device codes
// Key: userCode (internal identifier for polling)
const deviceCodeStore = new Map<string, DeviceCodeEntry>();

// Index: deviceCode -> userCode for quick lookup
const deviceCodeIndex = new Map<string, string>();

/**
 * Create a new device authorization code
 */
export function createDeviceCode(request: DeviceAuthRequest): {
  deviceCode: string;
  userCode: string;
  expiresIn: number;
  interval: number;
} {
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_EXPIRY.DEVICE_CODE * 1000);

  const entry: DeviceCodeEntry = {
    deviceCode,
    userCode,
    scopes: request.scopes || [],
    machineInfo: request.machineInfo,
    status: 'pending',
    expiresAt,
    createdAt: now,
  };

  deviceCodeStore.set(userCode, entry);
  deviceCodeIndex.set(deviceCode, userCode);

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
export function getDeviceCodeByUserCode(userCode: string): DeviceCodeEntry | null {
  const entry = deviceCodeStore.get(userCode);
  if (!entry) {
    return null;
  }

  // Check if expired
  if (entry.expiresAt < new Date()) {
    entry.status = 'expired';
    return entry;
  }

  return entry;
}

/**
 * Get device code entry by device code (for user authorization page)
 */
export function getDeviceCodeByDeviceCode(deviceCode: string): DeviceCodeEntry | null {
  const userCode = deviceCodeIndex.get(deviceCode);
  if (!userCode) {
    return null;
  }
  return getDeviceCodeByUserCode(userCode);
}

/**
 * Check if polling is too fast (rate limiting)
 */
export function checkPollRate(userCode: string): boolean {
  const entry = deviceCodeStore.get(userCode);
  if (!entry) {
    return false;
  }

  if (entry.lastPolledAt) {
    const timeSinceLastPoll = Date.now() - entry.lastPolledAt.getTime();
    // Allow polling at minimum interval (with 500ms tolerance)
    if (timeSinceLastPoll < (DEFAULT_POLL_INTERVAL - 0.5) * 1000) {
      return true; // Too fast
    }
  }

  // Update last poll time
  entry.lastPolledAt = new Date();
  return false;
}

/**
 * Authorize a device code (called when user approves)
 */
export function authorizeDeviceCode(deviceCode: string, userId: string): boolean {
  const entry = getDeviceCodeByDeviceCode(deviceCode);
  if (!entry) {
    return false;
  }

  if (entry.status !== 'pending') {
    return false;
  }

  if (entry.expiresAt < new Date()) {
    entry.status = 'expired';
    return false;
  }

  entry.status = 'authorized';
  entry.authorizedBy = userId;
  entry.authorizedAt = new Date();
  return true;
}

/**
 * Deny a device code (called when user denies)
 */
export function denyDeviceCode(deviceCode: string): boolean {
  const entry = getDeviceCodeByDeviceCode(deviceCode);
  if (!entry) {
    return false;
  }

  if (entry.status !== 'pending') {
    return false;
  }

  entry.status = 'denied';
  return true;
}

/**
 * Mark device code as used (after token is issued)
 */
export function markDeviceCodeUsed(userCode: string): boolean {
  const entry = deviceCodeStore.get(userCode);
  if (!entry) {
    return false;
  }

  entry.status = 'used';
  return true;
}

/**
 * Get pending device codes (for admin/debug)
 */
export function getPendingDeviceCodes(): DeviceCodeEntry[] {
  const pending: DeviceCodeEntry[] = [];
  const now = new Date();

  for (const [, entry] of deviceCodeStore) {
    if (entry.status === 'pending' && entry.expiresAt > now) {
      pending.push(entry);
    }
  }

  return pending;
}

/**
 * Clean up expired device codes (should be called periodically)
 */
export function cleanupExpiredDeviceCodes(): number {
  let count = 0;
  const now = new Date();

  for (const [userCode, entry] of deviceCodeStore) {
    // Remove expired or used codes
    if (entry.expiresAt < now || entry.status === 'used') {
      deviceCodeStore.delete(userCode);
      deviceCodeIndex.delete(entry.deviceCode);
      count++;
    }
  }

  return count;
}

/**
 * Get statistics about device codes
 */
export function getDeviceCodeStats(): {
  total: number;
  pending: number;
  authorized: number;
  expired: number;
  used: number;
} {
  const stats = {
    total: 0,
    pending: 0,
    authorized: 0,
    expired: 0,
    used: 0,
  };

  const now = new Date();

  for (const [, entry] of deviceCodeStore) {
    stats.total++;

    if (entry.expiresAt < now && entry.status === 'pending') {
      stats.expired++;
    } else {
      switch (entry.status) {
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

// Export for testing
export const __testing = {
  deviceCodeStore,
  deviceCodeIndex,
};
