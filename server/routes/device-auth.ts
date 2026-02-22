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
import type { MachineInfo } from '../types/relay.js';
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
} from '../lib/registered-machines-store.js';
import { machineRegistry } from '../lib/machine-registry.js';
import { relayServer } from '../lib/relay-server.js';
import { getServiceClient, createUserClient } from '../lib/supabase.js'
import { isServerMode } from '../lib/app-mode.js';
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

    // Validate required fields
    if (!body.machineInfo?.environmentType) {
      console.error('[device-auth] Missing required field: machineInfo.environmentType');
      return c.json({
        error: 'invalid_request',
        error_description: 'machineInfo.environmentType is required',
      }, 400);
    }

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

        // Create tokens (machine ID will be assigned during registration)
        // For now, create a temporary access token for registration
        // Note: Refresh token will be created during machine registration
        const tempMachineId = `temp-${body.userCode}`;
        const scopes = entry.scopes.length > 0 ? entry.scopes : DEFAULT_MACHINE_SCOPES;

        const accessToken = createAccessToken({
          machineId: tempMachineId,
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

        const response: DeviceTokenResponse = {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
          scopes,
          // Note: refresh token will be provided after machine registration
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

    const body = await c.req.json() as { machineInfo: MachineInfo };

    if (!body.machineInfo) {
      return c.json({ error: 'Missing machineInfo' }, 400);
    }

    const { machineInfo } = body;

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
      environmentType: machineInfo.environmentType || 'local',
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
        environmentType: machine.environmentType,
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
    console.error('[device-auth] Error registering machine:', err);
    return c.json({ error: 'Failed to register machine' }, 500);
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
 */
deviceAuthRoute.post('/code/:code/authorize', async (c) => {
  const code = c.req.param('code');

  // In a real app, get userId from session/auth
  // For now, accept it from the request body
  const body = await c.req.json() as { userId: string };

  if (!body.userId) {
    return c.json({ error: 'Missing userId' }, 400);
  }

  const success = await authorizeDeviceCode(code, body.userId);

  if (!success) {
    return c.json({ error: 'Failed to authorize device code' }, 400);
  }

  return c.json({
    success: true,
    message: 'Device authorized. You can close this page.',
  });
});

/**
 * POST /device/code/:code/deny
 * Deny a device code (called from the web UI)
 */
deviceAuthRoute.post('/code/:code/deny', async (c) => {
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
    // Supabase mode: Use RLS for filtering (user-scoped client)
    // Extract token from Authorization header or query param
    let token: string | undefined;
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else {
      token = c.req.query('token');
    }

    if (!token) {
      return c.json({ error: 'Missing authentication token' }, 401);
    }

    // Create user-scoped client (respects RLS)
    const userSupabase = createUserClient(token);
    const { data, error } = await userSupabase
      .from('registered_machines')
      .select('*')
      .eq('is_revoked', false)
      .order('registered_at', { ascending: false });

    if (error) {
      console.error('[device-auth] Failed to fetch machines from Supabase:', error);
      return c.json({ error: 'Failed to fetch machines' }, 500);
    }

    // Cross-reference DB status with live relay connections
    const liveIds = new Set(machineRegistry.getAll().map(m => m.machineId));

    const machines = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      hostname: row.hostname as string,
      platform: row.platform as string,
      environmentType: row.environment_type as string,
      providers: row.providers as string[],
      providerConfigs: row.provider_configs ?? [],
      userId: row.user_id as string,
      registeredAt: new Date(row.registered_at as string),
      lastSeenAt: new Date(row.last_seen_at as string),
      isConnected: liveIds.has(row.id as string),
      isRevoked: row.is_revoked as boolean,
    }));

    return c.json({
      machines,
      count: machines.length,
    });
  } else {
    // IndexedDB mode: Use manual filtering (SQLite)
    const machines = await getUserMachines(user.id);
    // Cross-reference DB status with live relay connections
    const liveIds = new Set(machineRegistry.getAll().map(m => m.machineId));

    return c.json({
      machines: machines.map((m) => ({
        id: m.id,
        name: m.name,
        hostname: m.hostname,
        platform: m.platform,
        environmentType: m.environmentType,
        providers: m.providers,
        providerConfigs: m.providerConfigs ?? [],
        userId: m.userId,
        registeredAt: m.registeredAt,
        lastSeenAt: m.lastSeenAt,
        isConnected: liveIds.has(m.id),
        isRevoked: m.isRevoked,
      })),
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
    // Supabase mode: Use RLS for filtering
    let token: string | undefined;
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else {
      token = c.req.query('token');
    }

    if (!token) {
      return c.json({ error: 'Missing authentication token' }, 401);
    }

    const userSupabase = createUserClient(token);
    const { data, error } = await userSupabase
      .from('registered_machines')
      .select('*')
      .eq('id', id)
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
        environmentType: data.environment_type,
        providers: data.providers,
        registeredAt: new Date(data.registered_at),
        lastSeenAt: new Date(data.last_seen_at),
        isConnected: data.is_connected,
        isRevoked: data.is_revoked,
        metadata: data.metadata,
      },
    });
  } else {
    // IndexedDB mode: Use manual ownership check
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
        environmentType: machine.environmentType,
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
    // Supabase mode: Use RLS for update
    let token: string | undefined;
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    if (!token) {
      return c.json({ error: 'Missing authentication token' }, 401);
    }

    const userSupabase = createUserClient(token);

    // Build update object
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.providerConfigs !== undefined) updates.provider_configs = body.providerConfigs;

    const { data, error } = await userSupabase
      .from('registered_machines')
      .update(updates)
      .eq('id', id)
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
        providerConfigs: data.provider_configs,
      },
    });
  } else {
    // IndexedDB mode: Manual ownership check
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
    // Supabase mode: Use RLS for delete
    let token: string | undefined;
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    if (!token) {
      return c.json({ error: 'Missing authentication token' }, 401);
    }

    const userSupabase = createUserClient(token);

    // First, fetch the machine details for audit log
    const { data: machine, error: fetchError } = await userSupabase
      .from('registered_machines')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !machine) {
      return c.json({ error: 'Machine not found or not authorized' }, 404);
    }

    // Revoke all tokens for this machine
    await revokeAllMachineTokens(id);

    // Mark machine as revoked (using RLS)
    const { error: updateError } = await userSupabase
      .from('registered_machines')
      .update({ is_revoked: true, is_connected: false })
      .eq('id', id);

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
    // IndexedDB mode: Manual ownership check
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
// Admin / Debug Endpoints
// ============================================================================

/**
 * POST /device/simulate-machine
 * Create a simulated machine for testing/demo purposes.
 * Registers in both the persistent store and live registry.
 */
deviceAuthRoute.post('/simulate-machine', async (c) => {
  try {
    const body = await c.req.json() as { type?: 'local' | 'hpc'; name?: string };
    const envType = body.type || 'local';
    const isHpc = envType === 'hpc';

    const machineId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const machineName = body.name || (isHpc ? 'Sherlock HPC' : `Dev Machine ${machineId.slice(-4)}`);
    const hostname = isHpc ? 'sh03-ln01.stanford.edu' : `${machineName.toLowerCase().replace(/\s+/g, '-')}.local`;
    const platform = isHpc ? 'linux' : 'darwin';
    const providers: Array<'claude-code' | 'claude-sdk' | 'aws' | 'gcp' | 'custom'> = ['claude-sdk'];

    // Register in persistent store
    const machine = await registerMachine({
      name: machineName,
      hostname,
      platform,
      environmentType: envType,
      providers,
      userId: 'current-user',
      refreshTokenHash: '',
      metadata: { simulated: 'true' },
    });

    // Register in live registry (simulated — no real WebSocket)
    machineRegistry.registerSimulated(machine.id, {
      name: machineName,
      hostname,
      platform,
      environmentType: envType,
      providers: providers.map((p) => ({
        type: p,
        status: 'available' as const,
        currentTasks: 0,
        maxConcurrentTasks: isHpc ? 10 : 3,
      })),
      load: {
        cpuPercent: Math.round(Math.random() * 30 + 5),
        memoryPercent: Math.round(Math.random() * 40 + 20),
        activeTasks: 0,
      },
    });

    // Emit machine:connected so the SSE bridge picks it up
    relayServer.emit('machine:connected', machine.id, 'current-user');

    return c.json({
      success: true,
      machine: {
        id: machine.id,
        name: machineName,
        hostname,
        platform,
        environmentType: envType,
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
 */
deviceAuthRoute.get('/stats', async (c) => {
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
