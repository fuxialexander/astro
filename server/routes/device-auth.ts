/**
 * Device Authentication Routes
 *
 * Implements OAuth2 Device Authorization Grant (RFC 8628)
 * for registering machines with the platform.
 *
 * Endpoints:
 * - POST /device/authorize   - Request device authorization code
 * - POST /device/token       - Poll for authorization / exchange code for tokens
 * - POST /device/register    - Register authenticated machine
 * - POST /device/refresh     - Refresh access token
 * - POST /device/revoke      - Revoke a token
 * - GET  /device/machines    - List registered machines for user
 * - DELETE /device/machines/:id - Revoke a machine
 */

import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import type {
  DeviceAuthRequest,
  DeviceAuthResponse,
  DeviceTokenRequest,
  DeviceTokenResponse,
  DeviceTokenError,
  MachineRegisterResponse,
  TokenRefreshRequest,
  TokenRefreshResponse,
} from '../types/device-auth.js';
import {
  TOKEN_EXPIRY,
  DEFAULT_MACHINE_SCOPES,
} from '../types/device-auth.js';
import type { MachineInfo, ProviderType } from '../types/relay.js';
import {
  createDeviceCode,
  getDeviceCodeByUserCode,
  getDeviceCodeByDeviceCode,
  checkPollRate,
  authorizeDeviceCode,
  denyDeviceCode,
  markDeviceCodeUsed,
  getPendingDeviceCodes,
} from '../lib/device-code-store.js';
import {
  createAccessToken,
  createWebSocketToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  refreshTokens,
  revokeRefreshToken,
  revokeAllMachineTokens,
} from '../lib/token-manager.js';
import {
  registerMachine,
  getMachine,
  getUserMachines,
  revokeMachine,
  updateMachineName,
  updateMachineProviderConfigs,
  shareMachineWithTeam,
  unshareMachineFromTeam,
  getTeamMachines,
  decodeProviderConfigs,
} from '../lib/registered-machines-store.js';
import { encryptJsonb } from '../lib/encryption.js';
import { machineRegistry } from '../lib/machine-registry.js';
import { relayServer } from '../lib/relay-server.js';
import { db } from '../lib/db/index.js';
import { registeredMachines, machineTeamShares, deviceCodes } from '../lib/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { getServiceClient } from '../lib/supabase.js'
import { isServerMode } from '../lib/app-mode.js';
import { storeUserDispatchPublicKey } from '../lib/user-dispatch-public-keys.js';
import { requireAuth } from '../middleware/auth.js';
import { logAuditEvent, AuditActions, ResourceTypes } from '../middleware/audit.js';

export const deviceAuthRoute = new Hono();

// ============================================================================
// Rate Limiting
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
  failedAttempts: number;
  lockedUntil?: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check and update rate limit for an IP or user code
 */
function checkRateLimit(key: string, isFailure: boolean = false): { allowed: boolean; reason?: string } {
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  // Clean up expired entries
  if (entry && entry.resetAt < now && (!entry.lockedUntil || entry.lockedUntil < now)) {
    rateLimitStore.delete(key);
    entry = undefined;
  }

  // Check if locked out
  if (entry?.lockedUntil && entry.lockedUntil > now) {
    const remainingSeconds = Math.ceil((entry.lockedUntil - now) / 1000);
    return { allowed: false, reason: `Too many failed attempts. Try again in ${remainingSeconds} seconds.` };
  }

  // Initialize or update entry
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
      failedAttempts: isFailure ? 1 : 0,
    };
  } else {
    entry.count++;
    if (isFailure) {
      entry.failedAttempts++;
    }
  }

  // Check if too many failed attempts
  if (entry.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
    rateLimitStore.set(key, entry);
    return { allowed: false, reason: 'Too many failed attempts. Account temporarily locked.' };
  }

  // Check if too many requests
  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    rateLimitStore.set(key, entry);
    return { allowed: false, reason: 'Too many requests. Please wait before trying again.' };
  }

  rateLimitStore.set(key, entry);
  return { allowed: true };
}

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now && (!entry.lockedUntil || entry.lockedUntil < now)) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Base URL for device verification (configurable via env)
// Derives from CLOUDFLARED_DOMAIN if not explicitly set
const BASE_URL = process.env.ASTRO_BASE_URL
  || (process.env.CLOUDFLARED_DOMAIN ? `https://astro.${process.env.CLOUDFLARED_DOMAIN}` : 'http://localhost:5173');
const RELAY_URL = process.env.RELAY_WS_URL
  || (process.env.CLOUDFLARED_DOMAIN ? `wss://astro-relay.${process.env.CLOUDFLARED_DOMAIN}` : 'ws://localhost:3002');

// ============================================================================
// Device Authorization Flow
// ============================================================================

/**
 * POST /device/authorize
 * Request a device authorization code
 *
 * This is step 1 of the device flow: the agent runner requests a code
 * to display to the user.
 */
deviceAuthRoute.post('/authorize', async (c) => {
  try {
    const body = await c.req.json() as DeviceAuthRequest;

    const { deviceCode, userCode, expiresIn, interval } = await createDeviceCode(body);

    // Verify device code was actually created
    if (!deviceCode || !userCode) {
      console.error('[device-auth] Failed to generate device code - got null values');
      return c.json({
        error: 'server_error',
        error_description: 'Failed to generate device code',
      }, 500);
    }

    const response: DeviceAuthResponse = {
      deviceCode,
      userCode,
      verificationUri: `${BASE_URL}/device`,
      verificationUriComplete: `${BASE_URL}/device?code=${deviceCode}`,
      expiresIn,
      interval,
    };

    return c.json(response);
  } catch (err) {
    console.error('[device-auth] Error creating device code:', err);
    return c.json({
      error: 'server_error',
      error_description: 'Failed to create device code',
      details: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

/**
 * POST /device/token
 * Poll for authorization or exchange code for tokens
 *
 * This is step 2 of the device flow: the agent runner polls this endpoint
 * until the user authorizes the device.
 */
deviceAuthRoute.post('/token', async (c) => {
  try {
    const body = await c.req.json() as DeviceTokenRequest;

    if (body.grantType !== 'urn:ietf:params:oauth:grant-type:device_code') {
      return c.json({
        error: 'unsupported_grant_type',
        errorDescription: 'Grant type must be urn:ietf:params:oauth:grant-type:device_code',
      } as DeviceTokenError, 400);
    }

    // Rate limiting: 10 requests per minute per IP
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
                     c.req.header('x-real-ip') ||
                     'unknown';
    const ipRateLimit = checkRateLimit(`ip:${clientIp}`, false);
    if (!ipRateLimit.allowed) {
      return c.json({
        error: 'slow_down',
        errorDescription: ipRateLimit.reason,
      } as DeviceTokenError, 429);
    }

    const entry = await getDeviceCodeByUserCode(body.userCode);

    if (!entry) {
      // Track failed attempt by IP
      checkRateLimit(`ip:${clientIp}`, true);
      return c.json({
        error: 'expired_token',
        errorDescription: 'Invalid or expired device code',
      } as DeviceTokenError, 400);
    }

    // Rate limiting: 5 failed attempts per user code = lock
    const userCodeRateLimit = checkRateLimit(`usercode:${body.userCode}`, false);
    if (!userCodeRateLimit.allowed) {
      return c.json({
        error: 'slow_down',
        errorDescription: userCodeRateLimit.reason,
      } as DeviceTokenError, 429);
    }

    // Check polling rate
    if (await checkPollRate(body.userCode)) {
      return c.json({
        error: 'slow_down',
        errorDescription: 'Polling too fast. Please wait before retrying.',
      } as DeviceTokenError, 400);
    }

    // Check status
    switch (entry.status) {
      case 'pending':
        return c.json({
          error: 'authorization_pending',
          errorDescription: 'User has not yet authorized. Please continue polling.',
        } as DeviceTokenError, 400);

      case 'denied':
        // Track failed attempt
        checkRateLimit(`usercode:${body.userCode}`, true);
        return c.json({
          error: 'access_denied',
          errorDescription: 'User denied the authorization request.',
        } as DeviceTokenError, 400);

      case 'expired':
        // Track failed attempt
        checkRateLimit(`usercode:${body.userCode}`, true);
        return c.json({
          error: 'expired_token',
          errorDescription: 'Device code has expired. Please request a new code.',
        } as DeviceTokenError, 400);

      case 'used':
        // Track failed attempt
        checkRateLimit(`usercode:${body.userCode}`, true);
        return c.json({
          error: 'expired_token',
          errorDescription: 'Device code has already been used.',
        } as DeviceTokenError, 400);

      case 'authorized': {
        // Success! Issue tokens
        if (!entry.authorizedBy) {
          return c.json({ error: 'Internal error: missing authorizer' }, 500);
        }

        // Mark code as used
        await markDeviceCodeUsed(body.userCode);

        const scopes = entry.scopes.length > 0 ? entry.scopes : DEFAULT_MACHINE_SCOPES;

        // CLI login: create access token without a machine ID.
        // The CLI authenticates a user, not a machine — machine registration
        // happens separately via /device/register for agent runners.
        const accessToken = createAccessToken({
          machineId: 'cli',
          userId: entry.authorizedBy,
          scopes,
          expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
        });

        // Validate token was created successfully
        if (!accessToken) {
          console.error('[device-auth] Failed to create access token');
          return c.json({
            error: 'server_error',
            error_description: 'Failed to create authentication token',
          }, 500);
        }

        // Note: No refresh token for CLI login — the refresh_tokens table
        // has an FK to registered_machines, and the CLI isn't a machine.
        // CLI will re-login when the access token expires.
        // Agent runners get proper refresh tokens via /device/register.
        const response: DeviceTokenResponse = {
          accessToken,
          refreshToken: '',
          tokenType: 'Bearer',
          expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
          scopes,
          ...(entry.dispatchPublicKey && { dispatchPublicKey: entry.dispatchPublicKey }),
        };

        return c.json(response);
      }
    }
  } catch (err) {
    console.error('[device-auth] Error processing token request:', err);
    return c.json({ error: 'Failed to process token request' }, 500);
  }
});

/**
 * POST /device/register
 * Register an authenticated machine
 *
 * This is step 3: after obtaining tokens, the agent runner registers
 * the machine with its metadata.
 */
deviceAuthRoute.post('/register', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid authorization header' }, 401);
    }

    const accessToken = authHeader.slice(7);
    const payload = verifyAccessToken(accessToken);

    if (!payload) {
      return c.json({ error: 'Invalid or expired access token' }, 401);
    }

    const body = await c.req.json() as { machineInfo: MachineInfo; dispatchPublicKey?: JsonWebKey };

    if (!body.machineInfo) {
      return c.json({ error: 'Missing machineInfo' }, 400);
    }

    const { machineInfo, dispatchPublicKey } = body;

    // Validate user exists in auth.users (prevents foreign key constraint violation)
    if (isServerMode()) {
      // Skip validation for dev user in test mode
      const isDev = process.env.NODE_ENV !== 'production';
      const isDevUser = payload.userId === '00000000-0000-0000-0000-000000000000';

      if (!(isDev && isDevUser)) {
        const supabase = getServiceClient();
        const { data, error: userError } = await supabase.auth.admin.getUserById(payload.userId);

        if (userError || !data?.user) {
          console.error('[device-auth] User not found in auth.users:', payload.userId, userError);
          return c.json({
            error: 'User not found. Your authentication may be stale. Please log out, log back in, and try device authorization again.',
          }, 400);
        }

        console.log('[device-auth] User validated:', data.user.id);
      } else {
        console.log('[device-auth] Skipping validation for dev user in test mode');
      }
    }

    // Register the machine — use client's hardware-based ID if provided
    const machine = await registerMachine({
      id: machineInfo.machineId || undefined,
      name: machineInfo.name || machineInfo.hostname || 'Unknown',
      hostname: machineInfo.hostname || 'unknown',
      platform: machineInfo.platform || 'unknown',
      providers: machineInfo.providers?.map(p => p.type) || [],
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      refreshTokenHash: '', // Will be updated when refresh token is created
      metadata: machineInfo.metadata,
    });

    // Create new tokens with the real machine ID
    const newAccessToken = createAccessToken({
      machineId: machine.id,
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      scopes: payload.scopes,
      expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
    });

    const { token: newRefreshToken, entry: refreshEntry } = await createRefreshToken({
      machineId: machine.id,
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      scopes: payload.scopes,
      expiresIn: TOKEN_EXPIRY.REFRESH_TOKEN,
    });

    // Update machine with refresh token hash
    machine.refreshTokenHash = refreshEntry.tokenHash;

    // Store dispatch public key on the registered machine if provided
    if (dispatchPublicKey) {
      await db.update(registeredMachines)
        .set({ dispatchPublicKey })
        .where(eq(registeredMachines.id, machine.id));
    }

    // Create WebSocket JWT for relay connection (uses RELAY_JWT_SECRET)
    const wsToken = createWebSocketToken({
      machineId: machine.id,
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      scopes: ['machine:connect', 'machine:execute'],
      expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
    });

    // Validate all tokens were created successfully
    if (!newAccessToken || !newRefreshToken || !wsToken) {
      console.error('[device-auth] Failed to create tokens during registration');
      console.error('[device-auth] newAccessToken:', newAccessToken ? 'OK' : 'NULL');
      console.error('[device-auth] newRefreshToken:', newRefreshToken ? 'OK' : 'NULL');
      console.error('[device-auth] wsToken:', wsToken ? 'OK' : 'NULL');
      return c.json({
        error: 'server_error',
        error_description: 'Failed to create authentication tokens for machine registration',
      }, 500);
    }

    // Validate machine ID
    if (!machine.id) {
      console.error('[device-auth] Machine registration succeeded but machine ID is null');
      return c.json({
        error: 'server_error',
        error_description: 'Failed to assign machine ID',
      }, 500);
    }

    const response: MachineRegisterResponse = {
      machineId: machine.id,
      machineName: machine.name,
      relayUrl: RELAY_URL,
      wsToken,
      message: `Machine "${machine.name}" registered successfully`,
      ...(dispatchPublicKey && { dispatchPublicKey }),
    };

    // Audit log the machine registration
    await logAuditEvent({
      userId: payload.userId,
      action: AuditActions.MACHINE_REGISTER,
      resourceType: ResourceTypes.MACHINE,
      resourceId: machine.id,
      details: {
        machineName: machine.name,
        hostname: machine.hostname,
        platform: machine.platform,
      },
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
    });

    // Also return the new tokens
    return c.json({
      ...response,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[device-auth] Error registering machine:', message);
    if (err instanceof Error && err.stack) {
      console.error('[device-auth] Stack:', err.stack);
    }

    // Surface actionable error details to the agent-runner
    const msgLower = message.toLowerCase();
    const isFkViolation = msgLower.includes('foreign key') || message.includes('23503');
    const isSchemaError = msgLower.includes('column') || msgLower.includes('relation') || message.includes('42703') || message.includes('42P01');

    if (isFkViolation) {
      return c.json({
        error: 'Failed to register machine',
        error_description: 'Database constraint violation — your user account may not exist in the database. Try logging out and re-authenticating.',
        detail: message,
      }, 500);
    }

    if (isSchemaError) {
      return c.json({
        error: 'Failed to register machine',
        error_description: 'Database schema mismatch — the server may need a migration update.',
        detail: message,
      }, 500);
    }

    return c.json({
      error: 'Failed to register machine',
      error_description: message,
    }, 500);
  }
});

/**
 * POST /device/refresh
 * Refresh an access token and WebSocket token
 */
deviceAuthRoute.post('/refresh', async (c) => {
  try {
    const body = await c.req.json() as TokenRefreshRequest;

    if (body.grantType !== 'refresh_token') {
      return c.json({ error: 'Invalid grant type' }, 400);
    }

    const result = await refreshTokens(body.refreshToken, false);

    if (!result) {
      return c.json({ error: 'Invalid or expired refresh token' }, 401);
    }

    // Verify the refresh token to get machine info for wsToken
    const verified = await verifyRefreshToken(body.refreshToken);
    if (!verified) {
      return c.json({ error: 'Invalid refresh token' }, 401);
    }

    const { entry } = verified;

    // Create a new WebSocket token (uses RELAY_JWT_SECRET)
    const wsToken = createWebSocketToken({
      machineId: entry.machineId,
      userId: entry.userId,
      workspaceId: entry.workspaceId,
      scopes: ['machine:connect', 'machine:execute'],
      expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
    });

    const response: TokenRefreshResponse = {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: result.expiresIn,
      refreshToken: result.refreshToken,
      wsToken, // Include refreshed WebSocket token
    };

    return c.json(response);
  } catch (err) {
    console.error('[device-auth] Error refreshing token:', err);
    return c.json({ error: 'Failed to refresh token' }, 500);
  }
});

/**
 * POST /device/revoke
 * Revoke a token (access or refresh)
 */
deviceAuthRoute.post('/revoke', async (c) => {
  try {
    const body = await c.req.json() as { token: string; tokenTypeHint?: string };

    if (!body.token) {
      return c.json({ error: 'Missing token' }, 400);
    }

    // Try to revoke as refresh token
    const revoked = await revokeRefreshToken(body.token);

    // RFC 7009: Always return 200 even if token was not found
    return c.json({ success: true, revoked });
  } catch (err) {
    console.error('[device-auth] Error revoking token:', err);
    return c.json({ error: 'Failed to revoke token' }, 500);
  }
});

// ============================================================================
// User Authorization Page Support
// ============================================================================

/**
 * GET /device/code/:code
 * Get device code info for the authorization page
 */
deviceAuthRoute.get('/code/:code', async (c) => {
  const code = c.req.param('code');
  const entry = await getDeviceCodeByDeviceCode(code);

  if (!entry) {
    return c.json({ error: 'Invalid or expired device code' }, 404);
  }

  if (entry.status !== 'pending') {
    return c.json({
      error: 'Code already used or expired',
      status: entry.status,
    }, 400);
  }

  return c.json({
    deviceCode: entry.deviceCode,
    machineInfo: entry.machineInfo,
    scopes: entry.scopes,
    expiresAt: entry.expiresAt,
  });
});

/**
 * POST /device/code/:code/authorize
 * Authorize a device code (called from the web UI)
 * Requires authentication — uses the authenticated user's ID.
 */
deviceAuthRoute.post('/code/:code/authorize', requireAuth, async (c) => {
  const code = c.req.param('code');
  const user = c.get('user') as { id: string };
  const body = await c.req.json() as { dispatchPublicKey?: JsonWebKey };

  // Always use authenticated user's ID — never accept userId from body
  const success = await authorizeDeviceCode(code, user.id, body.dispatchPublicKey);

  if (!success) {
    return c.json({ error: 'Failed to authorize device code' }, 400);
  }

  if (body.dispatchPublicKey) {
    try {
      await storeUserDispatchPublicKey(user.id, body.dispatchPublicKey);
    } catch (err) {
      console.warn('[device-auth] Failed to persist user dispatch public key:', err);
    }
  }

  return c.json({
    success: true,
    message: 'Device authorized. You can close this page.',
  });
});

/**
 * POST /device/code/:code/deny
 * Deny a device code (called from the web UI)
 * Requires authentication.
 */
deviceAuthRoute.post('/code/:code/deny', requireAuth, async (c) => {
  const code = c.req.param('code');
  const success = await denyDeviceCode(code);

  if (!success) {
    return c.json({ error: 'Failed to deny device code' }, 400);
  }

  return c.json({
    success: true,
    message: 'Device authorization denied.',
  });
});

// ============================================================================
// Pair Flow (Electron-style: callback over deep-link, no polling)
// ============================================================================
// Unlike RFC 8628 device flow (designed for devices that can't receive a
// callback — CLIs, smart TVs), the pair flow assumes the desktop app
// can receive a custom-protocol deep-link from the browser. The browser
// completes auth + machine registration in one call, and the resulting
// tokens ride directly in the astro://pair/callback URL — same pattern
// as astro://auth/callback for Supabase login. No polling, no slow_down,
// no race between background loops and one-shot verifies.
//
// Endpoints:
//   POST /device/pair-init        — open: app requests a pair token
//   GET  /device/pair/:token      — open: page shows machine info
//   POST /device/pair/:token/complete — auth-required: register + issue tokens

/**
 * POST /device/pair-init
 * App-side entry point. Generates a secret pair token and stores the
 * supplied machineInfo + dispatchPublicKey in the device_codes table.
 * Returns the token + a `pairUrl` the app should open in the browser.
 */
deviceAuthRoute.post('/pair-init', async (c) => {
  try {
    const body = await c.req.json() as {
      hostname?: string
      platform?: string
      providers?: string[]
      dispatchPublicKey?: JsonWebKey
    }
    if (!body.hostname || !body.platform) {
      return c.json({ error: 'Missing hostname or platform' }, 400)
    }

    // Reject obviously oversized inputs from anonymous callers — the body
    // is stored verbatim in machineInfo and shown on the /pair approval
    // page. Without bounds an attacker could pad the providers array to
    // bloat the device_codes table.
    if (typeof body.hostname !== 'string' || body.hostname.length > 255) {
      return c.json({ error: 'Invalid hostname' }, 400)
    }
    if (typeof body.platform !== 'string' || body.platform.length > 64) {
      return c.json({ error: 'Invalid platform' }, 400)
    }
    let providers: string[] | undefined
    if (body.providers !== undefined) {
      if (!Array.isArray(body.providers) || body.providers.length > 20) {
        return c.json({ error: 'Invalid providers list' }, 400)
      }
      for (const p of body.providers) {
        if (typeof p !== 'string' || p.length === 0 || p.length > 64) {
          return c.json({ error: 'Invalid provider entry' }, 400)
        }
      }
      providers = body.providers
    }

    // 32 bytes = 64 hex chars: not user-typeable, but only used in URL.
    const pairToken = randomBytes(32).toString('hex')
    // Internal primary key — kept distinct from pairToken so the token in
    // the URL is the only secret that grants access to this row.
    const userCodeKey = `pair-${randomBytes(12).toString('hex')}`
    const now = new Date()
    const expiresAt = new Date(now.getTime() + TOKEN_EXPIRY.DEVICE_CODE * 1000)

    await db.insert(deviceCodes).values({
      userCode: userCodeKey,
      deviceCode: pairToken,
      scopes: DEFAULT_MACHINE_SCOPES,
      machineInfo: {
        hostname: body.hostname,
        platform: body.platform,
        ...(providers && { providers }),
      },
      status: 'pending',
      expiresAt,
      createdAt: now,
      ...(body.dispatchPublicKey && { dispatchPublicKey: body.dispatchPublicKey }),
    })

    return c.json({
      pairToken,
      pairUrl: `${BASE_URL}/pair?token=${pairToken}`,
      expiresIn: TOKEN_EXPIRY.DEVICE_CODE,
    })
  } catch (err) {
    console.error('[device-auth] pair-init error:', err)
    return c.json({
      error: 'server_error',
      error_description: 'Failed to create pair token',
      details: err instanceof Error ? err.message : String(err),
    }, 500)
  }
})

/**
 * GET /device/pair/:token
 * Browser-side: returns machineInfo + status so the /pair page can show
 * "Authorize this Mac (hostname / platform)?" before the user clicks.
 * No auth required — knowing the token is the only credential needed
 * (and the token is a 256-bit secret, never enumerable).
 */
deviceAuthRoute.get('/pair/:token', async (c) => {
  const token = c.req.param('token')
  const entry = await getDeviceCodeByDeviceCode(token)
  if (!entry) {
    return c.json({ error: 'Invalid or expired pair token' }, 404)
  }
  if (entry.status === 'expired') {
    return c.json({ error: 'Pair token expired', status: 'expired' }, 410)
  }
  if (entry.status === 'used' || entry.status === 'authorized') {
    return c.json({ error: 'Pair token already used', status: entry.status }, 410)
  }
  if (entry.status === 'denied') {
    return c.json({ error: 'Pair was denied', status: 'denied' }, 410)
  }
  return c.json({
    machineInfo: entry.machineInfo,
    status: entry.status,
    expiresAt: entry.expiresAt,
  })
})

/**
 * POST /device/pair/:token/complete
 * Browser-side: the user has clicked Approve. Authenticates as the
 * current Supabase user, registers the machine, issues access/refresh
 * tokens, and returns everything in one shot. The browser then puts
 * these in an astro://pair/callback?... deep-link and the desktop app
 * receives them directly — no polling.
 */
deviceAuthRoute.post('/pair/:token/complete', requireAuth, async (c) => {
  const token = c.req.param('token')
  const user = c.get('user') as { id: string; teamIds: string[] }

  try {
    const entry = await getDeviceCodeByDeviceCode(token)
    if (!entry) {
      return c.json({ error: 'Invalid pair token' }, 404)
    }
    if (entry.status === 'expired' || entry.expiresAt < new Date()) {
      return c.json({ error: 'Pair token expired' }, 410)
    }
    if (entry.status === 'used' || entry.status === 'authorized') {
      return c.json({ error: 'Pair token already used' }, 410)
    }

    // Validate user exists in auth.users to prevent FK violation downstream.
    if (isServerMode()) {
      const isDev = process.env.NODE_ENV !== 'production'
      const isDevUser = user.id === '00000000-0000-0000-0000-000000000000'
      if (!(isDev && isDevUser)) {
        const supabase = getServiceClient()
        const { data, error: userError } = await supabase.auth.admin.getUserById(user.id)
        if (userError || !data?.user) {
          console.error('[device-auth] pair-complete: user not found', user.id, userError)
          return c.json({
            error: 'User not found. Try logging out and back in.',
          }, 400)
        }
      }
    }

    const machineInfo = entry.machineInfo as
      | { hostname?: string; platform?: string; providers?: string[] }
      | null
    if (!machineInfo?.hostname || !machineInfo.platform) {
      return c.json({ error: 'Pair token missing machine info' }, 400)
    }

    // Atomic CAS via authorizeDeviceCode (WHERE status='pending'). If two
    // requests race on the same token, only one succeeds.
    const dispatchPublicKey = entry.dispatchPublicKey
    const claimed = await authorizeDeviceCode(token, user.id, dispatchPublicKey)
    if (!claimed) {
      return c.json({ error: 'Pair token already used or expired' }, 410)
    }

    if (dispatchPublicKey) {
      try {
        await storeUserDispatchPublicKey(user.id, dispatchPublicKey)
      } catch (err) {
        console.warn('[device-auth] pair-complete: failed to persist dispatch key', err)
      }
    }

    // Register + mint in a single failure domain. If anything between
    // registerMachine and the wsToken issuance throws or returns null, the
    // machine row would otherwise be left orphaned (no refreshTokenHash, no
    // tokens issued) AND the pair token is already consumed by the CAS
    // above so the client can't retry. Revoke the machine on failure so
    // it can't be used and so the user's machine list isn't polluted.
    const scopes = DEFAULT_MACHINE_SCOPES
    let machine: Awaited<ReturnType<typeof registerMachine>> | undefined
    let accessToken = ''
    let refreshToken = ''
    let wsToken = ''
    try {
      machine = await registerMachine({
        name: machineInfo.hostname,
        hostname: machineInfo.hostname,
        platform: machineInfo.platform,
        providers: (machineInfo.providers ?? []) as ProviderType[],
        userId: user.id,
        refreshTokenHash: '',
      })

      const at = createAccessToken({
        machineId: machine.id,
        userId: user.id,
        scopes,
        expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
      })
      const refreshResult = await createRefreshToken({
        machineId: machine.id,
        userId: user.id,
        scopes,
        expiresIn: TOKEN_EXPIRY.REFRESH_TOKEN,
      })
      machine.refreshTokenHash = refreshResult.entry.tokenHash

      if (dispatchPublicKey) {
        await db.update(registeredMachines)
          .set({ dispatchPublicKey })
          .where(eq(registeredMachines.id, machine.id))
      }

      const ws = createWebSocketToken({
        machineId: machine.id,
        userId: user.id,
        scopes: ['machine:connect', 'machine:execute'],
        expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
      })

      if (!at || !refreshResult.token || !ws) {
        throw new Error('Token mint returned empty value')
      }
      accessToken = at
      refreshToken = refreshResult.token
      wsToken = ws
    } catch (err) {
      console.error('[device-auth] pair-complete: register/mint failed:', err)
      if (machine?.id) {
        // Best-effort cleanup so the user doesn't see a dead machine entry.
        // Failure here is logged but not surfaced — there's nothing the
        // client can do about it.
        await revokeMachine(machine.id).catch((cleanupErr) => {
          console.warn('[device-auth] pair-complete: revoke after failure failed:', cleanupErr)
        })
      }
      return c.json({
        error: 'server_error',
        error_description: 'Failed to register machine or create tokens',
      }, 500)
    }

    // Mark token as 'used' so it can't be replayed. Past this point the
    // pair is committed — every remaining step must be safe to fail
    // without poisoning the user's deep-link delivery.
    await markDeviceCodeUsed(entry.userCode)

    // Audit logging is best-effort. A logging failure must not 500 the
    // response: by this point the user's machine is registered and tokens
    // are minted; the browser needs the JSON back to fire astro://pair/callback.
    try {
      await logAuditEvent({
        userId: user.id,
        action: AuditActions.MACHINE_REGISTER,
        resourceType: ResourceTypes.MACHINE,
        resourceId: machine.id,
        details: {
          machineName: machine.name,
          hostname: machine.hostname,
          platform: machine.platform,
          flow: 'pair',
        },
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
      })
    } catch (err) {
      console.warn('[device-auth] pair-complete: audit log failed:', err)
    }

    return c.json({
      accessToken,
      refreshToken,
      wsToken,
      machineId: machine.id,
      machineName: machine.name,
      apiUrl: BASE_URL,
      relayUrl: RELAY_URL,
      expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
      ...(dispatchPublicKey && { dispatchPublicKey }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[device-auth] pair-complete error:', message)
    if (err instanceof Error && err.stack) {
      console.error('[device-auth] Stack:', err.stack)
    }
    return c.json({
      error: 'Failed to complete pairing',
      error_description: message,
    }, 500)
  }
})

// ============================================================================
// Machine Management
// ============================================================================

/**
 * GET /device/machines
 * List registered machines for the authenticated user
 */
deviceAuthRoute.get('/machines', requireAuth, async (c) => {
  // Get userId from auth middleware (required by requireAuth)
  const user = c.get('user') as { id: string };

  if (isServerMode()) {
    // Supabase mode: Use service client with explicit user_id filter
    // (CLI tokens are custom JWTs, not Supabase JWTs, so RLS won't work)
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('registered_machines')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_revoked', false)
      .order('registered_at', { ascending: false });

    if (error) {
      console.error('[device-auth] Failed to fetch machines from Supabase:', error);
      return c.json({ error: 'Failed to fetch machines' }, 500);
    }

    // Cross-reference DB status with live relay connections
    const liveIds = new Set(machineRegistry.getAll().map(m => m.machineId));

    // Load teamIds from join table for all machines
    const machineIds = (data || []).map((row: Record<string, unknown>) => row.id as string);
    const machineTeamMap = new Map<string, string[]>();
    if (machineIds.length > 0) {
      const shareRows = await db.select({
        machineId: machineTeamShares.machineId,
        teamId: machineTeamShares.teamId,
      }).from(machineTeamShares)
        .where(sql`${machineTeamShares.machineId} IN (${sql.join(machineIds.map(id => sql`${id}`), sql`, `)})`);
      for (const r of shareRows) {
        const arr = machineTeamMap.get(r.machineId) ?? [];
        arr.push(r.teamId);
        machineTeamMap.set(r.machineId, arr);
      }
    }

    const machines = (data || []).map((row: Record<string, unknown>) => {
      const id = row.id as string;
      const tIds = machineTeamMap.get(id) ?? [];
      return {
        id,
        name: row.name as string,
        hostname: row.hostname as string,
        platform: row.platform as string,
        providers: row.providers as string[],
        providerConfigs: decodeProviderConfigs(row.provider_configs),
        defaultInstructionId: (row.default_instruction_id as string) ?? null,
        userId: row.user_id as string,
        teamId: tIds[0] ?? (row.team_id as string) ?? null,
        teamIds: tIds,
        registeredAt: new Date(row.registered_at as string),
        lastSeenAt: new Date(row.last_seen_at as string),
        isConnected: liveIds.has(id),
        isRevoked: row.is_revoked as boolean,
      };
    });

    return c.json({
      machines,
      count: machines.length,
    });
  } else {
    // Local mode: Use Drizzle ORM
    const machines = await getUserMachines(user.id);
    const liveIds = new Set(machineRegistry.getAll().map(m => m.machineId));

    // Load teamIds from join table
    const machineIds = machines.map(m => m.id);
    const machineTeamMap = new Map<string, string[]>();
    if (machineIds.length > 0) {
      const shareRows = await db.select({
        machineId: machineTeamShares.machineId,
        teamId: machineTeamShares.teamId,
      }).from(machineTeamShares)
        .where(sql`${machineTeamShares.machineId} IN (${sql.join(machineIds.map(id => sql`${id}`), sql`, `)})`);
      for (const r of shareRows) {
        const arr = machineTeamMap.get(r.machineId) ?? [];
        arr.push(r.teamId);
        machineTeamMap.set(r.machineId, arr);
      }
    }

    return c.json({
      machines: machines.map((m) => {
        const tIds = machineTeamMap.get(m.id) ?? [];
        return {
          id: m.id,
          name: m.name,
          hostname: m.hostname,
          platform: m.platform,
          providers: m.providers,
          providerConfigs: m.providerConfigs ?? [],
          defaultInstructionId: m.defaultInstructionId ?? null,
          userId: m.userId,
          teamId: tIds[0] ?? m.teamId ?? null,
          teamIds: tIds,
          registeredAt: m.registeredAt,
          lastSeenAt: m.lastSeenAt,
          isConnected: liveIds.has(m.id),
          isRevoked: m.isRevoked,
        };
      }),
      count: machines.length,
    });
  }
});

/**
 * GET /device/machines/:id
 * Get a specific registered machine
 */
deviceAuthRoute.get('/machines/:id', requireAuth, async (c) => {
  const user = c.get('user') as { id: string };
  const id = c.req.param('id');

  if (isServerMode()) {
    // Supabase mode: Use service client with explicit user_id filter
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('registered_machines')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return c.json({ error: 'Machine not found' }, 404);
    }

    return c.json({
      machine: {
        id: data.id,
        name: data.name,
        hostname: data.hostname,
        platform: data.platform,
        providers: data.providers,
        registeredAt: new Date(data.registered_at),
        lastSeenAt: new Date(data.last_seen_at),
        isConnected: data.is_connected,
        isRevoked: data.is_revoked,
        metadata: data.metadata,
      },
    });
  } else {
    // Local mode: Use manual ownership check
    const machine = await getMachine(id);

    if (!machine) {
      return c.json({ error: 'Machine not found' }, 404);
    }

    // Verify ownership
    if (machine.userId !== user.id) {
      return c.json({ error: 'Not authorized to view this machine' }, 403);
    }

    return c.json({
      machine: {
        id: machine.id,
        name: machine.name,
        hostname: machine.hostname,
        platform: machine.platform,
        providers: machine.providers,
        registeredAt: machine.registeredAt,
        lastSeenAt: machine.lastSeenAt,
        isConnected: machine.isConnected,
        isRevoked: machine.isRevoked,
        metadata: machine.metadata,
      },
    });
  }
});

/**
 * PATCH /device/machines/:id
 * Update a machine (e.g., rename, update provider configs)
 */
deviceAuthRoute.patch('/machines/:id', requireAuth, async (c) => {
  const user = c.get('user') as { id: string };
  const id = c.req.param('id');
  const body = await c.req.json() as {
    name?: string
    providerConfigs?: Array<{
      provider: string
      apiKey?: string
      defaultModel?: string
      enabled: boolean
      settings?: Record<string, unknown>
    }>
  };

  if (!body.name && !body.providerConfigs) {
    return c.json({ error: 'Missing update fields (name or providerConfigs)' }, 400);
  }

  if (isServerMode()) {
    // Supabase mode: Use service client with explicit user_id filter
    const supabase = getServiceClient();

    // Build update object
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.providerConfigs !== undefined) updates.provider_configs = encryptJsonb(body.providerConfigs);

    const { data, error } = await supabase
      .from('registered_machines')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, name, provider_configs')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return c.json({ error: 'Machine not found or not authorized' }, 404);
      }
      console.error('[device-auth] Failed to update machine:', error);
      return c.json({ error: 'Failed to update machine' }, 500);
    }

    return c.json({
      success: true,
      machine: {
        id: data.id,
        name: data.name,
        providerConfigs: decodeProviderConfigs(data.provider_configs),
      },
    });
  } else {
    // Local mode: Manual ownership check
    const machine = await getMachine(id);

    if (!machine) {
      return c.json({ error: 'Machine not found' }, 404);
    }

    // Verify ownership
    if (machine.userId !== user.id) {
      return c.json({ error: 'Not authorized to update this machine' }, 403);
    }

    // Update name if provided
    if (body.name !== undefined) {
      const updated = await updateMachineName(id, body.name);
      if (!updated) {
        return c.json({ error: 'Failed to update machine name' }, 500);
      }
    }

    // Update provider configs if provided
    if (body.providerConfigs !== undefined) {
      const updated = await updateMachineProviderConfigs(id, body.providerConfigs);
      if (!updated) {
        return c.json({ error: 'Failed to update provider configs' }, 500);
      }
    }

    return c.json({
      success: true,
      machine: {
        id: machine.id,
        name: body.name || machine.name,
        providerConfigs: body.providerConfigs || machine.providerConfigs,
      },
    });
  }
});

/**
 * DELETE /device/machines/:id
 * Revoke a machine's access (soft delete)
 */
deviceAuthRoute.delete('/machines/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user') as { id: string };

  if (isServerMode()) {
    // Supabase mode: Use service client with explicit user_id filter
    const supabase = getServiceClient();

    // First, fetch the machine details for audit log
    const { data: machine, error: fetchError } = await supabase
      .from('registered_machines')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !machine) {
      return c.json({ error: 'Machine not found or not authorized' }, 404);
    }

    // Revoke all tokens for this machine
    await revokeAllMachineTokens(id);

    // Mark machine as revoked
    const { error: updateError } = await supabase
      .from('registered_machines')
      .update({ is_revoked: true, is_connected: false })
      .eq('id', id)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('[device-auth] Failed to revoke machine:', updateError);
      return c.json({ error: 'Failed to revoke machine' }, 500);
    }

    // Audit log the machine revocation
    await logAuditEvent({
      userId: user.id,
      action: AuditActions.MACHINE_REVOKE,
      resourceType: ResourceTypes.MACHINE,
      resourceId: id,
      details: {
        machineName: machine.name,
        hostname: machine.hostname,
        platform: machine.platform,
      },
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
    });

    return c.json({
      success: true,
      message: `Machine "${machine.name}" has been revoked`,
    });
  } else {
    // Local mode: Manual ownership check
    const machine = await getMachine(id);

    if (!machine) {
      return c.json({ error: 'Machine not found' }, 404);
    }

    // Verify the user owns this machine
    if (machine.userId !== user.id) {
      return c.json({ error: 'Not authorized to revoke this machine' }, 403);
    }

    // Revoke all tokens for this machine
    await revokeAllMachineTokens(id);

    // Mark machine as revoked
    await revokeMachine(id);

    // Audit log the machine revocation
    await logAuditEvent({
      userId: user.id,
      action: AuditActions.MACHINE_REVOKE,
      resourceType: ResourceTypes.MACHINE,
      resourceId: id,
      details: {
        machineName: machine.name,
        hostname: machine.hostname,
        platform: machine.platform,
      },
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
    });

    return c.json({
      success: true,
      message: `Machine "${machine.name}" has been revoked`,
    });
  }
});

// ============================================================================
// Team Machine Sharing
// ============================================================================

/**
 * GET /device/team-machines
 * List all machines shared with the current user's team.
 * Returns machines owned by other team members that have been contributed.
 */
deviceAuthRoute.get('/team-machines', requireAuth, async (c) => {
  const user = c.get('user') as { id: string; teamIds: string[] };
  const requestedTeamId = c.req.query('teamId');
  const teamId = requestedTeamId && user.teamIds.includes(requestedTeamId) ? requestedTeamId : null;

  if (!teamId) {
    return c.json({ machines: [], count: 0 });
  }

  const machines = await getTeamMachines(teamId);
  const liveIds = new Set(machineRegistry.getAll().map(m => m.machineId));

  return c.json({
    machines: machines.map(m => ({
      id: m.id,
      name: m.name,
      hostname: m.hostname,
      platform: m.platform,
      providers: m.providers,
      userId: m.userId,
      teamId: m.teamIds?.[0] ?? m.teamId,
      teamIds: m.teamIds ?? [],
      registeredAt: m.registeredAt,
      lastSeenAt: m.lastSeenAt,
      isConnected: liveIds.has(m.id),
      isRevoked: m.isRevoked,
    })),
    count: machines.length,
  });
});

/**
 * PATCH /device/machines/:id/share
 * Share or unshare a machine with a team (supports multi-team sharing).
 * Only the machine owner can share/unshare.
 * Body: { shared: boolean, teamId: string }
 */
deviceAuthRoute.patch('/machines/:id/share', requireAuth, async (c) => {
  const user = c.get('user') as { id: string; teamIds: string[] };
  const id = c.req.param('id');
  const body = await c.req.json() as { shared: boolean; teamId?: string | null };

  if (typeof body.shared !== 'boolean') {
    return c.json({ error: 'Missing required field: shared (boolean)' }, 400);
  }
  if (!body.teamId || !user.teamIds.includes(body.teamId)) {
    return c.json({ error: 'A valid teamId is required' }, 400);
  }

  // Verify ownership
  const machine = await getMachine(id);
  if (!machine) {
    return c.json({ error: 'Machine not found' }, 404);
  }
  if (machine.userId !== user.id) {
    return c.json({ error: 'Not authorized — only the machine owner can share it' }, 403);
  }

  const teamIds = body.shared
    ? await shareMachineWithTeam(id, body.teamId)
    : await unshareMachineFromTeam(id, body.teamId);

  return c.json({
    success: true,
    shared: body.shared,
    teamId: body.teamId,
    teamIds,
  });
});

// ============================================================================
// Admin / Debug Endpoints
// ============================================================================

/**
 * POST /device/simulate-machine
 * Create a simulated machine for testing/demo purposes.
 * Registers in both the persistent store and live registry.
 * Requires authentication + non-production environment.
 */
deviceAuthRoute.post('/simulate-machine', requireAuth, async (c) => {
  // Only allow in non-production environments
  if (process.env.NODE_ENV === 'production') {
    return c.json({ error: 'Simulate endpoint only available in development' }, 403);
  }

  try {
    const user = c.get('user') as { id: string };
    const body = await c.req.json() as { type?: 'local' | 'hpc'; name?: string };
    const isHpc = body.type === 'hpc';

    const machineId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const machineName = body.name || (isHpc ? 'Sherlock HPC' : `Dev Machine ${machineId.slice(-4)}`);
    const hostname = isHpc ? 'sh03-ln01.stanford.edu' : `${machineName.toLowerCase().replace(/\s+/g, '-')}.local`;
    const platform = isHpc ? 'linux' : 'darwin';
    const providers: Array<ProviderType> = ['claude-sdk'];

    // Register in persistent store — use authenticated user's ID
    const machine = await registerMachine({
      name: machineName,
      hostname,
      platform,
      providers,
      userId: user.id,
      refreshTokenHash: '',
      metadata: { simulated: 'true' },
    });

    // Register in live registry (simulated — no real WebSocket)
    machineRegistry.registerSimulated(machine.id, {
      name: machineName,
      hostname,
      platform,
      providers: providers.map((p) => ({
        type: p,
        status: 'available' as const,
        currentTasks: 0,
        maxConcurrentTasks: isHpc ? 20 : 5,
      })),
      load: {
        cpuPercent: Math.round(Math.random() * 30 + 5),
        memoryPercent: Math.round(Math.random() * 40 + 20),
        activeTasks: 0,
      },
    });

    // Emit machine:connected so the SSE bridge picks it up
    relayServer.emit('machine:connected', machine.id, user.id);

    return c.json({
      success: true,
      machine: {
        id: machine.id,
        name: machineName,
        hostname,
        platform,
        providers,
      },
    });
  } catch (err) {
    console.error('[device-auth] Error simulating machine:', err);
    return c.json({ error: 'Failed to simulate machine' }, 500);
  }
});

/**
 * GET /device/stats
 * Get device auth statistics (for admin/debug)
 * Requires authentication.
 */
deviceAuthRoute.get('/stats', requireAuth, async (c) => {
  const pendingCodes = await getPendingDeviceCodes();

  return c.json({
    pendingDeviceCodes: pendingCodes.length,
  });
});

/**
 * POST /device/test/auto-approve
 * Auto-approve a device code for e2e testing
 * Only available in development mode
 * Uses authenticated user's ID from JWT
 */
deviceAuthRoute.post('/test/auto-approve', requireAuth, async (c) => {
  // Only allow in non-production environments
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) {
    return c.json({ error: 'Test endpoints only available in development' }, 403);
  }

  try {
    const { deviceCode } = await c.req.json() as { deviceCode: string };

    if (!deviceCode) {
      return c.json({ error: 'Missing deviceCode' }, 400);
    }

    // Get authenticated user ID from auth middleware
    const user = c.get('user') as { id: string };

    // Auto-approve with the authenticated user's ID
    const success = await authorizeDeviceCode(deviceCode, user.id);

    if (!success) {
      return c.json({ error: 'Failed to approve device code' }, 400);
    }

    return c.json({
      success: true,
      message: 'Device auto-approved for testing',
      userId: user.id,
    });
  } catch (err) {
    console.error('[device-auth] Error auto-approving device:', err);
    return c.json({ error: 'Failed to auto-approve device' }, 500);
  }
});
