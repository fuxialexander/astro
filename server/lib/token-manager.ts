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
import { db } from './db/index.js';
import { refreshTokens as refreshTokensTable } from './db/schema.js';
import { eq, and, lt } from 'drizzle-orm';

// Validate JWT secrets
function validateJwtSecrets(): { JWT_SECRET: string; REFRESH_SECRET: string } {
  const isProduction = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';

  let jwtSecret = process.env.DEVICE_AUTH_JWT_SECRET;
  let refreshSecret = process.env.DEVICE_AUTH_REFRESH_SECRET;

  // In production, secrets MUST be provided via environment variables
  if (isProduction && (!jwtSecret || !refreshSecret)) {
    throw new Error(
      'CRITICAL: DEVICE_AUTH_JWT_SECRET and DEVICE_AUTH_REFRESH_SECRET must be set in production.\n' +
      'Generate secure secrets with:\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      'Set them in your environment variables before starting the server.'
    );
  }

  // In test mode, allow defaults
  if (isTest) {
    jwtSecret = jwtSecret || 'test-jwt-secret-min-32-chars-long-value';
    refreshSecret = refreshSecret || 'test-refresh-secret-min-32-chars-long';
  } else if (!jwtSecret || !refreshSecret) {
    // Development mode: generate random secrets
    jwtSecret = crypto.randomBytes(32).toString('hex');
    refreshSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[token-manager] ⚠️  WARNING: Using auto-generated JWT secrets (dev mode only)');
  }

  // Validate secret length (minimum 32 characters for security)
  if (jwtSecret.length < 32) {
    throw new Error('DEVICE_AUTH_JWT_SECRET must be at least 32 characters long');
  }
  if (refreshSecret.length < 32) {
    throw new Error('DEVICE_AUTH_REFRESH_SECRET must be at least 32 characters long');
  }

  return { JWT_SECRET: jwtSecret, REFRESH_SECRET: refreshSecret };
}

const { JWT_SECRET, REFRESH_SECRET } = validateJwtSecrets();

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
 * Create a WebSocket token for relay server connection
 * Uses RELAY_JWT_SECRET instead of DEVICE_AUTH_JWT_SECRET
 */
export function createWebSocketToken(payload: {
  machineId: string;
  userId: string;
  workspaceId?: string;
  scopes: string[];
  expiresIn?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = payload.expiresIn || 60 * 60; // 1 hour default
  const relaySecret = process.env.RELAY_JWT_SECRET || JWT_SECRET;

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

  return jwt.sign(tokenPayload, relaySecret, { algorithm: 'HS256' });
}

/**
 * Create a refresh token JWT
 */
export async function createRefreshToken(payload: {
  machineId: string;
  userId: string;
  workspaceId?: string;
  scopes: string[];
  expiresIn?: number;
}): Promise<{ token: string; entry: RefreshTokenEntry }> {
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

  // Store the entry in database
  await db.insert(refreshTokensTable).values({
    tokenHash,
    machineId: payload.machineId,
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    scopes: payload.scopes,
    expiresAt: entry.expiresAt,
    isRevoked: false,
  });

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
export async function verifyRefreshToken(token: string): Promise<{ payload: RefreshTokenPayload; entry: RefreshTokenEntry } | null> {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET, { algorithms: ['HS256'] }) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') {
      return null;
    }

    const tokenHash = hashToken(token);
    const [dbEntry] = await db
      .select()
      .from(refreshTokensTable)
      .where(
        and(
          eq(refreshTokensTable.tokenHash, tokenHash),
          eq(refreshTokensTable.isRevoked, false)
        )
      );

    if (!dbEntry) {
      return null;
    }

    if (dbEntry.expiresAt < new Date()) {
      return null;
    }

    // Convert DB entry to RefreshTokenEntry format
    const entry: RefreshTokenEntry = {
      tokenHash: dbEntry.tokenHash,
      machineId: dbEntry.machineId,
      userId: dbEntry.userId,
      workspaceId: dbEntry.workspaceId ?? undefined,
      scopes: dbEntry.scopes,
      expiresAt: dbEntry.expiresAt,
      createdAt: dbEntry.createdAt,
      isRevoked: dbEntry.isRevoked,
    };

    return { payload: decoded, entry };
  } catch {
    return null;
  }
}

/**
 * Refresh tokens - issue new access token and optionally rotate refresh token
 */
export async function refreshTokens(refreshToken: string, rotateRefresh: boolean = false): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
} | null> {
  const verified = await verifyRefreshToken(refreshToken);
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
    await revokeRefreshToken(refreshToken);

    // Create new one
    const newRefresh = await createRefreshToken({
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
export async function revokeRefreshToken(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const result = await db
    .update(refreshTokensTable)
    .set({ isRevoked: true })
    .where(eq(refreshTokensTable.tokenHash, tokenHash));

  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Revoke all refresh tokens for a machine
 */
export async function revokeAllMachineTokens(machineId: string): Promise<number> {
  const result = await db
    .update(refreshTokensTable)
    .set({ isRevoked: true })
    .where(
      and(
        eq(refreshTokensTable.machineId, machineId),
        eq(refreshTokensTable.isRevoked, false)
      )
    );

  return result.rowCount ?? 0;
}

/**
 * Get all active refresh tokens for a user
 */
export async function getUserRefreshTokens(userId: string): Promise<RefreshTokenEntry[]> {
  const now = new Date();
  const dbEntries = await db
    .select()
    .from(refreshTokensTable)
    .where(
      and(
        eq(refreshTokensTable.userId, userId),
        eq(refreshTokensTable.isRevoked, false),
        lt(now, refreshTokensTable.expiresAt)
      )
    );

  // Convert DB entries to RefreshTokenEntry format
  return dbEntries.map(dbEntry => ({
    tokenHash: dbEntry.tokenHash,
    machineId: dbEntry.machineId,
    userId: dbEntry.userId,
    workspaceId: dbEntry.workspaceId ?? undefined,
    scopes: dbEntry.scopes,
    expiresAt: dbEntry.expiresAt,
    createdAt: dbEntry.createdAt,
    isRevoked: dbEntry.isRevoked,
  }));
}

/**
 * Clean up expired tokens (should be called periodically)
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const now = new Date();
  const result = await db
    .delete(refreshTokensTable)
    .where(
      lt(refreshTokensTable.expiresAt, now)
    );

  return result.rowCount ?? 0;
}

// Export for testing
export const __testing = {
  JWT_SECRET,
  REFRESH_SECRET,
};
