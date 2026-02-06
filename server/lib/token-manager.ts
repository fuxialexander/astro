/**
 * Token Management for Device Authentication
 *
 * Handles JWT creation, validation, and refresh token management.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
  RefreshTokenEntry,
} from '../types/device-auth';

// Use environment variable or generate a random secret for development
const JWT_SECRET = process.env.DEVICE_AUTH_JWT_SECRET || crypto.randomBytes(32).toString('hex');
const REFRESH_SECRET = process.env.DEVICE_AUTH_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');

// In production, these should be stored in a database
// For now, using in-memory storage
const refreshTokenStore = new Map<string, RefreshTokenEntry>();

/**
 * Generate a cryptographically secure random string
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('base64url');
}

/**
 * Hash a token for storage (never store raw tokens)
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a device code (user-facing format: XXXX-XXXX)
 */
export function generateDeviceCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoiding confusing chars
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
    if (i === 3) code += '-';
  }
  return code;
}

/**
 * Generate a user code (internal identifier for polling)
 */
export function generateUserCode(): string {
  return generateSecureToken(16);
}

/**
 * Create an access token JWT
 */
export function createAccessToken(payload: {
  machineId: string;
  userId: string;
  workspaceId?: string;
  scopes: string[];
  expiresIn?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = payload.expiresIn || 60 * 60; // 1 hour default

  const tokenPayload: AccessTokenPayload = {
    sub: payload.machineId,
    iat: now,
    exp: now + expiresIn,
    type: 'access',
    machineId: payload.machineId,
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    scopes: payload.scopes,
  };

  return jwt.sign(tokenPayload, JWT_SECRET, { algorithm: 'HS256' });
}

/**
 * Create a refresh token JWT
 */
export function createRefreshToken(payload: {
  machineId: string;
  userId: string;
  workspaceId?: string;
  scopes: string[];
  expiresIn?: number;
}): { token: string; entry: RefreshTokenEntry } {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = payload.expiresIn || 30 * 24 * 60 * 60; // 30 days default
  const tokenId = generateSecureToken(16);

  const tokenPayload: RefreshTokenPayload = {
    sub: tokenId,
    iat: now,
    exp: now + expiresIn,
    type: 'refresh',
    machineId: payload.machineId,
    userId: payload.userId,
  };

  const token = jwt.sign(tokenPayload, REFRESH_SECRET, { algorithm: 'HS256' });
  const tokenHash = hashToken(token);

  const entry: RefreshTokenEntry = {
    tokenHash,
    machineId: payload.machineId,
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    scopes: payload.scopes,
    expiresAt: new Date((now + expiresIn) * 1000),
    createdAt: new Date(),
    isRevoked: false,
  };

  // Store the entry
  refreshTokenStore.set(tokenHash, entry);

  return { token, entry };
}

/**
 * Verify an access token
 */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AccessTokenPayload;
    if (decoded.type !== 'access') {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Verify a refresh token
 */
export function verifyRefreshToken(token: string): { payload: RefreshTokenPayload; entry: RefreshTokenEntry } | null {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET, { algorithms: ['HS256'] }) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') {
      return null;
    }

    const tokenHash = hashToken(token);
    const entry = refreshTokenStore.get(tokenHash);

    if (!entry || entry.isRevoked) {
      return null;
    }

    if (entry.expiresAt < new Date()) {
      return null;
    }

    return { payload: decoded, entry };
  } catch {
    return null;
  }
}

/**
 * Refresh tokens - issue new access token and optionally rotate refresh token
 */
export function refreshTokens(refreshToken: string, rotateRefresh: boolean = false): {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
} | null {
  const verified = verifyRefreshToken(refreshToken);
  if (!verified) {
    return null;
  }

  const { entry } = verified;
  const accessExpiresIn = 60 * 60; // 1 hour

  const accessToken = createAccessToken({
    machineId: entry.machineId,
    userId: entry.userId,
    workspaceId: entry.workspaceId,
    scopes: entry.scopes,
    expiresIn: accessExpiresIn,
  });

  const result: { accessToken: string; refreshToken?: string; expiresIn: number } = {
    accessToken,
    expiresIn: accessExpiresIn,
  };

  if (rotateRefresh) {
    // Revoke old token
    revokeRefreshToken(refreshToken);

    // Create new one
    const newRefresh = createRefreshToken({
      machineId: entry.machineId,
      userId: entry.userId,
      workspaceId: entry.workspaceId,
      scopes: entry.scopes,
    });
    result.refreshToken = newRefresh.token;
  }

  return result;
}

/**
 * Revoke a refresh token
 */
export function revokeRefreshToken(token: string): boolean {
  const tokenHash = hashToken(token);
  const entry = refreshTokenStore.get(tokenHash);
  if (entry) {
    entry.isRevoked = true;
    return true;
  }
  return false;
}

/**
 * Revoke all refresh tokens for a machine
 */
export function revokeAllMachineTokens(machineId: string): number {
  let count = 0;
  for (const [, entry] of refreshTokenStore) {
    if (entry.machineId === machineId && !entry.isRevoked) {
      entry.isRevoked = true;
      count++;
    }
  }
  return count;
}

/**
 * Get all active refresh tokens for a user
 */
export function getUserRefreshTokens(userId: string): RefreshTokenEntry[] {
  const tokens: RefreshTokenEntry[] = [];
  const now = new Date();
  for (const [, entry] of refreshTokenStore) {
    if (entry.userId === userId && !entry.isRevoked && entry.expiresAt > now) {
      tokens.push(entry);
    }
  }
  return tokens;
}

/**
 * Clean up expired tokens (should be called periodically)
 */
export function cleanupExpiredTokens(): number {
  let count = 0;
  const now = new Date();
  for (const [hash, entry] of refreshTokenStore) {
    if (entry.expiresAt < now || entry.isRevoked) {
      refreshTokenStore.delete(hash);
      count++;
    }
  }
  return count;
}

// Export for testing
export const __testing = {
  refreshTokenStore,
  JWT_SECRET,
  REFRESH_SECRET,
};
