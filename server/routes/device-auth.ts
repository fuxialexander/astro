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
  createRefreshToken,
  verifyAccessToken,
  refreshTokens,
  revokeRefreshToken,
  revokeAllMachineTokens,
} from '../lib/token-manager.js';
import {
  registerMachine,
  getMachine,
  getUserMachines,
  revokeMachine,
} from '../lib/registered-machines-store.js';
import { machineRegistry } from '../lib/machine-registry.js';
import { relayServer } from '../lib/relay-server.js';

export const deviceAuthRoute = new Hono();

// Base URL for device verification (configurable via env)
const BASE_URL = process.env.NEXUS_BASE_URL || 'http://localhost:5173';
const RELAY_URL = process.env.RELAY_WS_URL
  || (process.env.CLOUDFLARED_DOMAIN ? `wss://nexus-relay.${process.env.CLOUDFLARED_DOMAIN}` : 'ws://localhost:3002');

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

    const { deviceCode, userCode, expiresIn, interval } = createDeviceCode(body);

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
    return c.json({ error: 'Failed to create device code' }, 500);
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

    const entry = getDeviceCodeByUserCode(body.userCode);

    if (!entry) {
      return c.json({
        error: 'expired_token',
        errorDescription: 'Invalid or expired device code',
      } as DeviceTokenError, 400);
    }

    // Check polling rate
    if (checkPollRate(body.userCode)) {
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
        return c.json({
          error: 'access_denied',
          errorDescription: 'User denied the authorization request.',
        } as DeviceTokenError, 400);

      case 'expired':
        return c.json({
          error: 'expired_token',
          errorDescription: 'Device code has expired. Please request a new code.',
        } as DeviceTokenError, 400);

      case 'used':
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
        markDeviceCodeUsed(body.userCode);

        // Create tokens (machine ID will be assigned during registration)
        // For now, create a temporary access token for registration
        const tempMachineId = `temp-${body.userCode}`;
        const scopes = entry.scopes.length > 0 ? entry.scopes : DEFAULT_MACHINE_SCOPES;

        const accessToken = createAccessToken({
          machineId: tempMachineId,
          userId: entry.authorizedBy,
          scopes,
          expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
        });

        const { token: refreshToken } = createRefreshToken({
          machineId: tempMachineId,
          userId: entry.authorizedBy,
          scopes,
          expiresIn: TOKEN_EXPIRY.REFRESH_TOKEN,
        });

        const response: DeviceTokenResponse = {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
          refreshToken,
          scopes,
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

    // Register the machine
    const machine = await registerMachine({
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

    const { token: newRefreshToken, entry: refreshEntry } = createRefreshToken({
      machineId: machine.id,
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      scopes: payload.scopes,
      expiresIn: TOKEN_EXPIRY.REFRESH_TOKEN,
    });

    // Update machine with refresh token hash
    machine.refreshTokenHash = refreshEntry.tokenHash;

    // Create WebSocket JWT for relay connection
    const wsToken = createAccessToken({
      machineId: machine.id,
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      scopes: ['machine:connect', 'machine:execute'],
      expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
    });

    const response: MachineRegisterResponse = {
      machineId: machine.id,
      machineName: machine.name,
      relayUrl: RELAY_URL,
      wsToken,
      message: `Machine "${machine.name}" registered successfully`,
    };

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
 * Refresh an access token
 */
deviceAuthRoute.post('/refresh', async (c) => {
  try {
    const body = await c.req.json() as TokenRefreshRequest;

    if (body.grantType !== 'refresh_token') {
      return c.json({ error: 'Invalid grant type' }, 400);
    }

    const result = refreshTokens(body.refreshToken, false);

    if (!result) {
      return c.json({ error: 'Invalid or expired refresh token' }, 401);
    }

    const response: TokenRefreshResponse = {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: result.expiresIn,
      refreshToken: result.refreshToken,
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
    const revoked = revokeRefreshToken(body.token);

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
deviceAuthRoute.get('/code/:code', (c) => {
  const code = c.req.param('code');
  const entry = getDeviceCodeByDeviceCode(code);

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

  const success = authorizeDeviceCode(code, body.userId);

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
deviceAuthRoute.post('/code/:code/deny', (c) => {
  const code = c.req.param('code');
  const success = denyDeviceCode(code);

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
deviceAuthRoute.get('/machines', async (c) => {
  // Get userId from auth middleware or query param
  const user = c.get('user') as { id: string } | undefined;
  const userId = user?.id || c.req.query('userId');

  if (!userId) {
    return c.json({ error: 'Missing userId' }, 400);
  }

  const machines = await getUserMachines(userId);

  return c.json({
    machines: machines.map((m) => ({
      id: m.id,
      name: m.name,
      hostname: m.hostname,
      platform: m.platform,
      environmentType: m.environmentType,
      providers: m.providers,
      registeredAt: m.registeredAt,
      lastSeenAt: m.lastSeenAt,
      isConnected: m.isConnected,
      isRevoked: m.isRevoked,
    })),
    count: machines.length,
  });
});

/**
 * GET /device/machines/:id
 * Get a specific registered machine
 */
deviceAuthRoute.get('/machines/:id', async (c) => {
  const id = c.req.param('id');
  const machine = await getMachine(id);

  if (!machine) {
    return c.json({ error: 'Machine not found' }, 404);
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
});

/**
 * PATCH /device/machines/:id
 * Update a machine (e.g., rename)
 */
deviceAuthRoute.patch('/machines/:id', async (c) => {
  const id = c.req.param('id');
  const machine = await getMachine(id);

  if (!machine) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  const body = await c.req.json() as { name?: string };

  if (body.name) {
    machine.name = body.name;
  }

  return c.json({
    success: true,
    machine: {
      id: machine.id,
      name: machine.name,
    },
  });
});

/**
 * DELETE /device/machines/:id
 * Revoke a machine's access (soft delete)
 */
deviceAuthRoute.delete('/machines/:id', async (c) => {
  const id = c.req.param('id');
  const machine = await getMachine(id);

  if (!machine) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  // Revoke all tokens for this machine
  revokeAllMachineTokens(id);

  // Mark machine as revoked
  await revokeMachine(id);

  return c.json({
    success: true,
    message: `Machine "${machine.name}" has been revoked`,
  });
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
    const providers: Array<'claude-code' | 'slurm' | 'aws' | 'gcp' | 'custom'> = isHpc ? ['slurm'] : ['claude-code'];

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
    relayServer.emit('machine:connected', machine.id);

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
  const pendingCodes = getPendingDeviceCodes();

  return c.json({
    pendingDeviceCodes: pendingCodes.length,
  });
});
